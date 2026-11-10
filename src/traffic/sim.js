import { CONFIG } from '../config.js';
import { createRng } from '../core/random.js';
import { fromBase64, toBase64 } from '../core/binary.js';
import { TripPlanner } from './trips.js';
import { UNCONTROLLED } from './signals.js';

const C = CONFIG.cars;
const E = CONFIG.events;
const T = CONFIG.trips;
const U = CONFIG.signals.unsignalized;

export class TrafficSim {
  constructor(graph, signals, onCross, { rng = createRng(CONFIG.sim.seed) } = {}) {
    this.g = graph;
    this.signals = signals;
    this.onCross = onCross;
    this.rng = rng;
    const n = C.max;
    this.edge = new Int32Array(n);
    this.pos = new Float32Array(n);
    this.speed = new Float32Array(n);
    this.factor = new Float32Array(n);
    this.next = new Int32Array(n * 3).fill(-1);
    this.stuck = new Float32Array(n);
    this.edgeCars = new Array(graph.edgeCount);
    this.sensorsByEdge = new Map();
    this.activeCount = 0;
    this.targetCount = 0;
    this.speedScale = 1; // multiplicador de la velocidad de todos los coches (el tiempo: lluvia)
    this.attractors = []; // sedes de eventos en curso que atraen coches
    this.venueEdges = new Map(); // id de la sede -> tramos cercanos (solo se calculan una vez)
    this.closed = new Uint8Array(graph.edgeCount); // 1 = tramo cortado a los coches
    this.zone = new Int32Array(graph.edgeCount); // zona con límite de entrada a la que pertenece el tramo (0 = ninguna)
    this.zoneLimit = new Map(); // zona -> coches que puede haber dentro como máximo
    this.zoneCount = new Map(); // zona -> coches que hay dentro ahora
    for (let i = 0; i < n; i++) this.factor[i] = 0.85 + this.rng() * 0.25;
    // Viajes: zona de destino de cada coche, cuándo salió y cuánto tardaría sin tráfico ni cortes.
    // Sin coordenadas (grafos mínimos de algunos tests) no hay zonas: los coches circulan al azar como antes.
    this.trips = graph.nx && graph.nodeCount ? new TripPlanner(graph) : null;
    this.dest = new Int32Array(n);
    this.tripStart = new Float64Array(n);
    this.tripFree = new Float32Array(n);
    this.routed = new Uint8Array(n); // 1 = el viaje tenía camino al destino al empezar
    this.clock = 0; // segundos simulados que ha avanzado esta simulación
    // Acumulados: viajes terminados, sus segundos y su retraso, y viajes perdidos (cortes, atascos, vueltas sin fin).
    this.tripTotals = { done: 0, seconds: 0, delay: 0, lost: 0 };
  }

  setSensorIndex(map) {
    this.sensorsByEdge = map;
  }

  // Estado completo de los coches y del PRNG para reanudar la simulación exactamente.
  serialize() {
    const n = this.activeCount;
    return {
      activeCount: n,
      targetCount: this.targetCount,
      rng: this.rng.getState(),
      edge: toBase64(this.edge.subarray(0, n)),
      pos: toBase64(this.pos.subarray(0, n)),
      speed: toBase64(this.speed.subarray(0, n)),
      next: toBase64(this.next.subarray(0, n * 3)),
      factor: toBase64(this.factor),
      stuck: toBase64(this.stuck.subarray(0, n)),
      dest: toBase64(this.dest.subarray(0, n)),
      tripStart: toBase64(this.tripStart.subarray(0, n)),
      tripFree: toBase64(this.tripFree.subarray(0, n)),
      routed: toBase64(this.routed.subarray(0, n)),
      clock: this.clock,
      tripTotals: { ...this.tripTotals },
    };
  }

  // Posición actual de los coches (sin el estado interno) para que un visor los dibuje.
  positions() {
    const n = this.activeCount;
    return {
      activeCount: n,
      edge: toBase64(this.edge.subarray(0, n)),
      pos: toBase64(this.pos.subarray(0, n)),
      speed: toBase64(this.speed.subarray(0, n)),
    };
  }

  restore(state) {
    const n = state.activeCount;
    this.edge.set(fromBase64(state.edge, Int32Array));
    this.pos.set(fromBase64(state.pos, Float32Array));
    this.speed.set(fromBase64(state.speed, Float32Array));
    this.next.set(fromBase64(state.next, Int32Array));
    this.factor.set(fromBase64(state.factor, Float32Array));
    this.stuck.fill(0);
    if (state.stuck) this.stuck.set(fromBase64(state.stuck, Float32Array));
    this.edgeCars = new Array(this.g.edgeCount);
    this.zoneCount.clear();
    this.activeCount = n;
    this.targetCount = state.targetCount;
    for (let i = 0; i < n; i++) this.place(i, this.edge[i]);
    this.rng.setState(state.rng);
    this.clock = state.clock ?? 0;
    this.tripTotals = { done: 0, seconds: 0, delay: 0, lost: 0, ...state.tripTotals };
    if (state.dest) {
      this.dest.set(fromBase64(state.dest, Int32Array));
      this.tripStart.set(fromBase64(state.tripStart, Float64Array));
      this.tripFree.set(fromBase64(state.tripFree, Float32Array));
      if (state.routed) this.routed.set(fromBase64(state.routed, Uint8Array));
    } else if (this.trips) {
      // Snapshot de antes de los viajes: cada coche recibe un destino desde donde está.
      for (let i = 0; i < n; i++) this.startTrip(i, this.edge[i], this.pos[i]);
    }
  }

  setTarget(n) {
    this.targetCount = Math.max(0, Math.min(C.max, Math.round(n)));
  }

  // Sedes de eventos [{ id, x, z, radius, weight }]: los coches nuevos aparecen cerca de ellas y los demás tienden a ir hacia allí.
  setAttractors(list) {
    this.attractors = list.map((a) => ({ ...a, pull: Math.min(1, a.weight) * E.steering, edges: this.edgesNear(a) }));
  }

  edgesNear({ id, x, z, radius }) {
    let edges = this.venueEdges.get(id);
    if (!edges) {
      const g = this.g;
      const near = [];
      const roads = [];
      for (let e = 0; e < g.edgeCount; e++) {
        const mx = (g.nx[g.A[e]] + g.nx[g.B[e]]) / 2;
        const mz = (g.nz[g.A[e]] + g.nz[g.B[e]]) / 2;
        if (Math.hypot(mx - x, mz - z) > radius) continue;
        near.push(e);
        if (g.cls[e] > 0) roads.push(e); // sin autovías: no se aparca en ellas
      }
      edges = Int32Array.from(roads.length ? roads : near);
      this.venueEdges.set(id, edges);
    }
    return edges;
  }

  spawnEdge() {
    const list = this.attractors;
    if (list.length) {
      let total = 0;
      for (const a of list) total += a.edges.length ? a.weight : 0;
      if (total > 0 && this.rng() < Math.min(E.spawnShare, total)) {
        let r = this.rng() * total;
        for (const a of list) {
          if (!a.edges.length) continue;
          r -= a.weight;
          if (r <= 0) {
            const e = a.edges[(this.rng() * a.edges.length) | 0];
            return this.restricted(e) ? this.randomEdge() : e;
          }
        }
      }
    }
    return this.randomEdge();
  }

  // Sesgo de elegir el tramo `c` por acercar el coche a la sede de un evento (1 = sin sesgo). Dentro de la
  // mitad del radio ya no tira de ellos: se quedan por la zona.
  pull(c) {
    const g = this.g;
    let factor = 1;
    for (const a of this.attractors) {
      const dB = Math.hypot(g.nx[g.B[c]] - a.x, g.nz[g.B[c]] - a.z);
      if (dB < a.radius / 2) continue;
      const toward = (Math.hypot(g.nx[g.A[c]] - a.x, g.nz[g.A[c]] - a.z) - dB) / Math.max(1, g.len[c]);
      if (toward > 0) factor += a.pull * toward;
    }
    return factor;
  }

  // Los coches nuevos no aparecen en tramos cortados ni dentro de zonas con límite de entrada.
  restricted(e) {
    return this.closed[e] === 1 || this.zone[e] !== 0;
  }

  // Los coches nuevos aparecen en el núcleo de la red, desde donde se llega a cualquier destino.
  outside(e) {
    return this.trips !== null && !this.trips.inMain[this.g.B[e]];
  }

  randomEdge() {
    const g = this.g;
    for (let tries = 0; tries < 6; tries++) {
      const e = (this.rng() * g.edgeCount) | 0;
      if ((this.rng() * 5 < 5 - g.cls[e] || tries === 5) && !this.restricted(e) && !this.outside(e)) return e;
    }
    for (let e = 0; e < g.edgeCount; e++) if (!this.restricted(e) && !this.outside(e)) return e;
    for (let e = 0; e < g.edgeCount; e++) if (!this.restricted(e)) return e;
    return 0;
  }

  // Un coche del tramo `from` puede pasar al `to` (from = -1: aparece de la nada). El límite de una zona se comprueba al
  // elegir la ruta, así que los coches que ya la tienen elegida pueden pasarlo por unidades.
  allows(from, to) {
    if (this.closed[to] === 1) return false;
    const z = this.zone[to];
    if (z === 0 || (from >= 0 && this.zone[from] === z)) return true;
    return (this.zoneCount.get(z) ?? 0) < this.zoneLimit.get(z);
  }

  // Tramos cortados y zonas de acceso restringido: { closed, zone, limits }. Con `evict`, los coches que están en un
  // tramo cortado reaparecen en otro sitio y los que llevan una ruta que ya no se permite la recalculan.
  setRestrictions({ closed, zone, limits }, { evict = true } = {}) {
    this.trips?.setClosed(closed);
    this.closed = closed;
    this.zone = zone;
    this.zoneLimit = limits;
    this.zoneCount.clear();
    for (let e = 0; e < this.g.edgeCount; e++) {
      const z = zone[e];
      if (z !== 0 && this.edgeCars[e]) this.zoneCount.set(z, (this.zoneCount.get(z) ?? 0) + this.edgeCars[e].length);
    }
    if (!evict) return;
    for (let i = 0; i < this.activeCount; i++) {
      const e = this.edge[i];
      if (closed[e] === 1) {
        this.endTrip(i, false, true); // el corte interrumpe el viaje
        continue;
      }
      // Con cortes nuevos el mejor camino puede cambiar aunque el previsto siga abierto: todos recalculan.
      this.route(i, e);
    }
  }

  // Siguiente tramo tras `e`. Con un coche `i`, el que menos tiempo le deja hasta su destino (con algo de azar entre
  // opciones parecidas); sin coche, o si el destino ya no tiene camino, al azar como antes.
  chooseNext(e, i = -1) {
    if (e < 0) return -1;
    if (i >= 0 && this.trips) {
      const c = this.towards(e, this.trips.live[this.dest[i]]);
      if (c !== -2) return c;
    }
    const g = this.g;
    const node = g.B[e];
    const rev = g.rev[e];
    let total = 0;
    let fallback = -1;
    const start = g.outStart[node];
    const end = g.outStart[node + 1];
    for (let k = start; k < end; k++) {
      const c = g.outList[k];
      if (c === rev) {
        fallback = c;
        continue;
      }
      total += this.weight(e, c);
    }
    if (total === 0) return fallback >= 0 && this.allows(e, fallback) ? fallback : -1;
    let r = this.rng() * total;
    for (let k = start; k < end; k++) {
      const c = g.outList[k];
      if (c === rev) continue;
      r -= this.weight(e, c);
      if (r <= 0) return c;
    }
    return fallback >= 0 && this.allows(e, fallback) ? fallback : -1;
  }

  // Tramo hacia el destino según su campo de tiempos (-2 si ningún tramo permitido tiene camino).
  towards(e, field) {
    const g = this.g;
    const node = g.B[e];
    const rev = g.rev[e];
    const start = g.outStart[node];
    const end = g.outStart[node + 1];
    let best = Infinity;
    for (let k = start; k < end; k++) {
      const c = g.outList[k];
      if (c === rev && end - start > 1) continue;
      if (!this.allows(e, c)) continue;
      const cost = this.trips.time[c] + field[g.B[c]];
      if (cost < best) best = cost;
    }
    if (best === Infinity) {
      // Cambio de sentido solo si no queda otra (callejón o calle cortada más adelante).
      if (rev >= 0 && this.allows(e, rev) && field[g.B[rev]] < Infinity) return rev;
      return -2;
    }
    let total = 0;
    for (let k = start; k < end; k++) {
      const c = g.outList[k];
      if (c === rev && end - start > 1) continue;
      if (!this.allows(e, c)) continue;
      const cost = this.trips.time[c] + field[g.B[c]];
      if (cost < Infinity) total += Math.exp((best - cost) / T.choiceSeconds);
    }
    let r = this.rng() * total;
    let last = -2;
    for (let k = start; k < end; k++) {
      const c = g.outList[k];
      if (c === rev && end - start > 1) continue;
      if (!this.allows(e, c)) continue;
      const cost = this.trips.time[c] + field[g.B[c]];
      if (cost === Infinity) continue;
      last = c;
      r -= Math.exp((best - cost) / T.choiceSeconds);
      if (r <= 0) return c;
    }
    return last;
  }

  weight(e, c) {
    if (!this.allows(e, c)) return 0;
    const g = this.g;
    const dot = g.ux[e] * g.ux[c] + g.uz[e] * g.uz[c];
    const w = (1 + 3 * Math.max(0, dot)) * (5 - g.cls[c]);
    return this.attractors.length ? w * this.pull(c) : w;
  }

  place(i, e) {
    const list = (this.edgeCars[e] ??= []);
    list.push(i);
    this.edge[i] = e;
    const z = this.zone[e];
    if (z !== 0) this.zoneCount.set(z, (this.zoneCount.get(z) ?? 0) + 1);
  }

  detach(i) {
    const list = this.edgeCars[this.edge[i]];
    if (!list) return;
    const k = list.indexOf(i);
    if (k >= 0) {
      list[k] = list[list.length - 1];
      list.pop();
      const z = this.zone[this.edge[i]];
      if (z !== 0) this.zoneCount.set(z, this.zoneCount.get(z) - 1);
    }
  }

  spawn(i) {
    const e = this.spawnEdge();
    this.place(i, e);
    this.pos[i] = this.rng() * this.g.len[e];
    this.speed[i] = 0;
    this.stuck[i] = 0;
    this.startTrip(i, e, this.pos[i]);
    this.route(i, e);
  }

  // Elige destino para un viaje que empieza en el tramo `e`. Si un corte deja el destino elegido sin camino (y sin
  // cortes lo tendría), ese viaje no se hace: cuenta como perdido y se elige otro.
  startTrip(i, e, pos) {
    const t = this.trips;
    if (!t) return;
    const node = this.g.B[e];
    let zone = 0;
    for (let tries = 0; tries < 8; tries++) {
      zone = this.pickZone();
      if (t.live[zone][node] < Infinity) break;
      if (t.free[zone][node] < Infinity) this.tripTotals.lost++;
    }
    this.dest[i] = zone;
    this.routed[i] = t.live[zone][node] < Infinity ? 1 : 0;
    this.tripStart[i] = this.clock;
    const free = t.free[zone][node];
    this.tripFree[i] = (free < Infinity ? free : 0) + (this.g.len[e] - pos) / this.g.speed[e];
  }

  // Con eventos en curso, parte de los viajes van a la zona de la sede.
  pickZone() {
    const list = this.attractors;
    if (list.length) {
      let total = 0;
      for (const a of list) total += a.weight;
      if (total > 0 && this.rng() < Math.min(E.spawnShare, total)) {
        let r = this.rng() * total;
        for (const a of list) {
          r -= a.weight;
          if (r <= 0) return (a.zone ??= this.trips.nearest(a.x, a.z));
        }
      }
    }
    return this.trips.pick(this.rng());
  }

  // Los tres próximos tramos del coche `i` desde el tramo `e`.
  route(i, e) {
    const n0 = this.chooseNext(e, i);
    const n1 = this.chooseNext(n0, i);
    this.next[i * 3] = n0;
    this.next[i * 3 + 1] = n1;
    this.next[i * 3 + 2] = this.chooseNext(n1, i);
  }

  // Termina el viaje del coche `i` (`arrived` = llegó a su destino). Con `respawn` el coche reaparece en otro punto
  // (atascado o en una calle que se acaba de cortar); si no, encadena otro viaje desde donde está.
  endTrip(i, arrived, respawn = false) {
    if (this.trips) {
      if (arrived) {
        const seconds = this.clock - this.tripStart[i];
        this.tripTotals.done++;
        this.tripTotals.seconds += seconds;
        this.tripTotals.delay += Math.max(0, seconds - this.tripFree[i]);
      } else if (this.routed[i]) {
        this.tripTotals.lost++;
      }
    }
    if (respawn || !this.trips) {
      this.detach(i);
      this.spawn(i);
      return;
    }
    const e = this.edge[i];
    this.startTrip(i, e, this.pos[i]);
    this.route(i, e);
  }

  adjustPopulation() {
    for (let k = 0; k < 20 && this.activeCount !== this.targetCount; k++) {
      if (this.activeCount < this.targetCount) {
        this.spawn(this.activeCount++);
      } else {
        this.detach(--this.activeCount);
      }
    }
  }

  // Un coche de fuera solo entra en la rotonda si no llega por el anillo otro coche que vaya a pasar por la entrada.
  canEnter(entry) {
    return !this.ringTraffic(entry, entry, CONFIG.roundabouts.yieldDistance);
  }

  // Hay un coche del anillo que pasará por `target` y está a menos de `budget` metros del inicio de `e`.
  ringTraffic(target, e, budget) {
    const g = this.g;
    const feeders = g.ringIn[e];
    if (!feeders) return false;
    for (const f of feeders) {
      const list = this.edgeCars[f];
      if (list) {
        for (const j of list) {
          if (g.len[f] - this.pos[j] < budget && this.heads(j, target)) return true;
        }
      }
      if (g.len[f] < budget && this.ringTraffic(target, f, budget - g.len[f])) return true;
    }
    return false;
  }

  // La ruta conocida del coche pasa por `edge` (un coche que sale de la rotonda antes no estorba).
  heads(i, edge) {
    return this.next[i * 3] === edge || this.next[i * 3 + 1] === edge || this.next[i * 3 + 2] === edge;
  }

  // Distancia libre hasta el primer obstáculo (coche delante, semáforo no verde o entrada a rotonda sin hueco).
  freeGap(i) {
    const g = this.g;
    const sig = this.signals;
    let e = this.edge[i];
    const p = this.pos[i];
    const v = this.speed[i];
    let gap = Infinity;

    const own = this.edgeCars[e];
    for (let k = 0; k < own.length; k++) {
      const j = own[k];
      if (j !== i && this.pos[j] > p) {
        const d = this.pos[j] - p - C.length;
        if (d < gap) gap = d;
      }
    }

    let dist = g.len[e] - p;
    for (let step = 0; ; step++) {
      const state = sig.stateForEdge(e);
      if (state === UNCONTROLLED) {
        // Cruce sin regular: se llega despacio y se para si cruzan peatones o viene un coche por la calle con prioridad.
        const stopDist = dist - C.stopGap;
        if (stopDist >= -1) {
          const s = g.sig[e];
          if (sig.crossingBusy(s) || this.mustYield(e, s)) {
            if (stopDist < gap) gap = Math.max(0, stopDist);
          } else {
            const slow = stopDist + C.minGap + (U.approachSpeed * U.approachSpeed) / (2 * C.decel);
            if (slow < gap) gap = slow;
          }
        }
      } else if (state !== 0) {
        const stopDist = dist - C.stopGap;
        if (stopDist >= -1) {
          const mustStop = state === 2 || stopDist > (v * v) / (2 * 6);
          if (mustStop && stopDist < gap) gap = Math.max(0, stopDist);
        }
      }
      const entering = step < 3 && dist <= C.lookAhead ? this.next[i * 3 + step] : -1;
      if (entering >= 0 && g.ringId && g.ringId[entering] >= 0 && g.ringId[e] < 0 && !this.canEnter(entering)) {
        const stopDist = dist - C.stopGap;
        if (stopDist >= -1 && stopDist < gap) gap = Math.max(0, stopDist);
      }
      if (step === 3 || dist > C.lookAhead || gap < dist) break;
      const ne = this.next[i * 3 + step];
      if (ne < 0) break;
      const list = this.edgeCars[ne];
      if (list) {
        let minPos = Infinity;
        for (let k = 0; k < list.length; k++) if (this.pos[list[k]] < minPos) minPos = this.pos[list[k]];
        if (minPos !== Infinity) {
          const d = dist + minPos - C.length;
          if (d < gap) gap = d;
          break;
        }
      }
      dist += g.len[ne];
      e = ne;
    }
    return gap;
  }

  // En el cruce sin regular `s`, el coche que llega por `e` cede el paso si viene alguien por una calle con prioridad
  // (de más categoría; a igual categoría, el eje este-oeste). Como la prioridad es un orden estricto, nunca se esperan
  // dos coches mutuamente.
  mustYield(e, s) {
    const g = this.g;
    for (const a of this.signals.signals[s].approaches) {
      if (g.grp[a] === g.grp[e]) continue;
      if (g.cls[a] > g.cls[e] || (g.cls[a] === g.cls[e] && g.grp[a] > g.grp[e])) continue;
      const list = this.edgeCars[a];
      if (!list) continue;
      for (const j of list) {
        const left = g.len[a] - this.pos[j];
        if (left >= 0 && left <= U.yieldDistance) return true;
      }
    }
    return false;
  }

  step(dt) {
    this.clock += dt;
    this.adjustPopulation();
    const g = this.g;
    for (let i = 0; i < this.activeCount; i++) {
      if (this.trips && this.clock - this.tripStart[i] > T.maxTripSeconds) this.endTrip(i, false);
      const gap = this.freeGap(i);
      const e0 = this.edge[i];
      const vmax = g.speed[e0] * this.factor[i] * this.speedScale;
      const safe = gap === Infinity ? vmax : Math.sqrt(2 * C.decel * Math.max(0, gap - C.minGap));
      const v = Math.max(0, Math.min(this.speed[i] + C.accel * dt, vmax, safe));
      this.speed[i] = v;
      if (v < 0.5) {
        this.stuck[i] += dt;
        if (this.stuck[i] > C.stuckSeconds) {
          this.endTrip(i, false, true);
          continue;
        }
      } else {
        this.stuck[i] = 0;
      }
      this.advance(i, v * dt, v);
    }
  }

  advance(i, distance, v) {
    const g = this.g;
    let e = this.edge[i];
    let p = this.pos[i];
    let remaining = distance;
    while (p + remaining >= g.len[e]) {
      this.checkSensors(e, p, g.len[e], v);
      remaining -= g.len[e] - p;
      let ne = this.next[i * 3];
      if (ne < 0) {
        this.endTrip(i, false, true); // sin salida
        return;
      }
      // El límite de una zona se vuelve a comprobar al entrar: la ruta se eligió unos tramos antes y puede haberse
      // llenado. Si está llena busca otra salida desde este cruce; si no la hay, espera al final del tramo.
      if (!this.allows(e, ne)) {
        ne = this.chooseNext(e, i);
        if (ne < 0 || !this.allows(e, ne)) {
          this.pos[i] = g.len[e];
          this.speed[i] = 0;
          return;
        }
        this.next[i * 3] = ne;
        this.next[i * 3 + 1] = this.chooseNext(ne, i);
        this.next[i * 3 + 2] = this.chooseNext(this.next[i * 3 + 1], i);
      }
      this.detach(i);
      this.place(i, ne);
      e = ne;
      p = 0;
      const left = this.trips ? this.trips.live[this.dest[i]][g.B[ne]] : 1;
      // Sin camino desde el principio (encerrado por cortes) sigue dando vueltas sin contar más viajes perdidos.
      if (left <= T.arriveSeconds || (left === Infinity && this.routed[i])) {
        // Llegó (o un corte le ha dejado sin camino): encadena otro viaje desde aquí y sigue avanzando.
        this.endTrip(i, left !== Infinity);
        continue;
      }
      const n1 = this.next[i * 3 + 1];
      this.next[i * 3] = n1;
      this.next[i * 3 + 1] = this.next[i * 3 + 2];
      this.next[i * 3 + 2] = this.chooseNext(n1 >= 0 ? this.next[i * 3 + 1] : -1, i);
    }
    const np = p + remaining;
    this.checkSensors(e, p, np, v);
    this.pos[i] = np;
  }

  checkSensors(e, from, to, v) {
    const list = this.sensorsByEdge.get(e);
    if (!list) return;
    for (const entry of list) {
      if (entry.s > from && entry.s <= to) this.onCross(entry.sensor, entry.dir, v);
    }
  }

  stats() {
    let sum = 0;
    let stopped = 0;
    for (let i = 0; i < this.activeCount; i++) {
      sum += this.speed[i];
      if (this.speed[i] < 0.5) stopped++;
    }
    return {
      active: this.activeCount,
      avgKmh: this.activeCount ? (sum / this.activeCount) * 3.6 : 0,
      stopped,
    };
  }
}
