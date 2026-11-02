import { CONFIG } from '../config.js';
import { demandFactor } from '../traffic/demand.js';

const P = CONFIG.pedestrians;
const STRIDE = 5; // x, z, dirX, dirZ, clase de vía
const BRIDGE_LANE = 0.7; // fracción del semiancho de la calzada por la que caminan en un puente
const MAX_STEPS = 400; // tramos máximos que recorre un paseo

// Hash sin estado: número en [0, 1) para el peatón `i`, la ventana `k` y el uso `salt`.
function rand(i, k, salt) {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(k + 0x7f4a7c15, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// Peatones de la ciudad (los simula el servidor). No guardan estado: la posición de cada uno es una función
// del tiempo y, en cada ventana, elige qué hacer: caminar por la acera de una calle o cruzar por un paso de
// peatones de OSM (en ese caso solo se ve mientras cruza).
export class Pedestrians {
  constructor(crossings = [], { max = P.max, graph = null, walkFraction = P.walkFraction, water = null, weights = null, signals = null } = {}) {
    this.crossings = crossings;
    this.count = Math.floor(crossings.length / STRIDE);
    this.graph = graph;
    this.water = water;
    this.walkFraction = walkFraction;
    this.bikeRiders = 0;
    // Pesos de atracción por tramo y por paso de peatones (ver weights.js); sin ellos todos valen 1.
    this.edgeWeight = weights?.edge ?? null;
    this.crossWeight = weights?.crossing ?? null;
    this.sidewalks = graph ? sidewalkEdges(graph, this.edgeWeight) : null;
    this.crossCumulative = new Float64Array(this.count);
    for (let j = 0, total = 0; j < this.count; j++) this.crossCumulative[j] = total += this.crossWeight ? this.crossWeight[j] : 1;
    this.crossTotal = this.count ? this.crossCumulative[this.count - 1] : 0;
    // Semáforo que regula cada paso (índice en signals.signals, -1 = sin regular) y el eje de coches que cruzan.
    this.signals = signals;
    this.crossSignal = new Int32Array(this.count).fill(-1);
    this.crossGroup = new Uint8Array(this.count);
    if (signals) this.linkSignals();
    this.simNow = 0;
    this.simPerSecond = 1; // segundos simulados por segundo del reloj de peatones
    this.timings = [];
    this.max = max;
    this.x = new Float32Array(max);
    this.z = new Float32Array(max);
    this.heading = new Float32Array(max); // giro sobre Y que apunta el triángulo (+X) hacia donde camina
    this.bike = new Uint8Array(max);
    this.activeCount = 0;
    // Caché del paseo de cada peatón (solo acelera: el resultado es el mismo que calculándolo desde cero).
    this.walkSlot = new Float64Array(max).fill(NaN);
    this.walkS = new Float64Array(max);
    this.walkEdge = new Int32Array(max);
    this.walkStep = new Int32Array(max);
    this.walkStart = new Float64Array(max);
    this.walkP0 = new Float64Array(max);
  }

  // Posición a una hora simulada: el servidor y el visor usan esta misma función, así que coinciden.
  // Los peatones tienen su propio reloj: la hora simulada se divide por la escala del servidor (simulada / real) y se
  // multiplica por `clockScale` (tope: la escala del servidor), así que van a ×clockScale en vez de a ×52. La densidad sí sigue la hora simulada.
  updateAt(simSeconds, scenario, scale = 1, limit = this.max) {
    const clock = Math.min(P.clockScale, scale);
    this.simNow = simSeconds;
    this.simPerSecond = scale / clock;
    this.update(((simSeconds * clock) / scale) * 1000, pedestrianDensity(demandFactor(simSeconds, scenario)), limit);
  }

  setBikeRiders(count) {
    if (!Number.isFinite(count)) throw new Error('Bike rider count must be a finite number');
    this.bikeRiders = Math.max(0, Math.min(this.max, Math.round(count)));
  }

  // Asocia cada paso al semáforo activo más cercano (dentro de `signalRadius`) y al eje de la calle que cruza.
  linkSignals() {
    const list = this.signals.signals;
    const c = this.crossings;
    for (let j = 0; j < this.count; j++) {
      let best = -1;
      let bestD = P.signalRadius;
      for (let s = 0; s < list.length; s++) {
        if (!list[s].active) continue;
        const d = Math.hypot(list[s].x - c[j * STRIDE], list[s].z - c[j * STRIDE + 1]);
        if (d <= bestD) {
          bestD = d;
          best = s;
        }
      }
      this.crossSignal[j] = best;
      // La calle va perpendicular a la dirección de cruce; grupo 0 = calle E-O, 1 = N-S (igual que los tramos).
      this.crossGroup[j] = Math.abs(c[j * STRIDE + 3]) >= Math.abs(c[j * STRIDE + 2]) ? 0 : 1;
    }
  }

  // Ciclo del semáforo `s` a la hora simulada actual (se calcula una vez por actualización).
  timingOf(s) {
    let t = this.timings[s];
    if (!t) {
      const { gA, gB, y } = this.signals.timing(this.signals.signals[s], this.simNow);
      t = this.timings[s] = { gA, gB, y, cycle: gA + gB + 2 * y, offset: this.signals.offsets[s] };
    }
    return t;
  }

  // Ventana de rojo para los coches del grupo `g` del semáforo `s` que empieza en `from` o la siguiente:
  // { start, length, current } con tiempos simulados absolutos.
  redWindow(s, g, from) {
    const { gA, y, cycle, offset } = this.timingOf(s);
    const length = g === 0 ? cycle - gA - y : gA + y;
    const begin = g === 0 ? gA + y : 0;
    const phase = (((from + offset * cycle) % cycle) + cycle) % cycle;
    const into = phase - begin;
    if (into >= 0 && into < length) return { start: from - into, length, current: true };
    return { start: from + ((begin - phase + cycle) % cycle), length, current: false };
  }

  // Flujo esperado de peatones a una hora simulada: el modelo en el que se basan los sensores de peatones y el que
  // generan en media los agentes de `update` (mismas proporciones, mismo reparto por tramos y mismos pasos).
  //   walkPerWeight: caminantes por metro de tramo (dirigido) con acera y peso 1; un tramo de peso w tiene w veces más.
  //   crossPerWeight: peatones que cruzan un paso de peso 1 en una ventana de `slotSeconds`; uno de peso w, w veces más.
  //   onStreet: peatones en la calle en un instante (caminantes más los que están cruzando).
  flowAt(simSeconds, scenario, limit = this.max) {
    const total = Math.min(limit, this.max) * pedestrianDensity(demandFactor(simSeconds, scenario));
    const hasWalk = !!this.sidewalks;
    const hasCross = this.count > 0;
    const walkShare = hasWalk ? (hasCross ? this.walkFraction : 1) : 0;
    const crossers = hasCross ? total * (1 - walkShare) : 0;
    const walkers = total * walkShare;
    const weightedLength = hasWalk ? this.sidewalks.cumulative[this.sidewalks.cumulative.length - 1] : 0;
    return {
      total: hasWalk || hasCross ? total : 0,
      walkPerWeight: hasWalk ? walkers / weightedLength : 0,
      crossPerWeight: hasCross ? crossers / this.crossTotal : 0,
      onStreet: walkers + (hasCross ? (crossers * this.meanCrossSeconds()) / P.slotSeconds : 0),
    };
  }

  // Segundos que tarda un peatón en cruzar, de media entre todos los pasos (ponderada por su peso).
  meanCrossSeconds() {
    if (this.crossMean === undefined) {
      let sum = 0;
      for (let j = 0; j < this.count; j++) sum += this.crossWeightAt(j * STRIDE) * this.crossSeconds(j * STRIDE);
      this.crossMean = this.count ? sum / this.crossTotal : 0;
    }
    return this.crossMean;
  }

  // Peso del tramo `e` y del paso de peatones que empieza en `crossings[j]`.
  weightOf(e) {
    return this.edgeWeight ? this.edgeWeight[e] : 1;
  }

  crossWeightAt(j) {
    return this.crossWeight ? this.crossWeight[j / STRIDE] : 1;
  }

  // Segundos que tarda un peatón en cruzar el paso que empieza en `c[j]`.
  crossSeconds(j) {
    return (2 * (CONFIG.roads.halfWidth[this.crossings[j + 4]] + P.margin)) / P.speed;
  }

  // `density` en [0, 1]: fracción de los peatones que pueden estar en la calle.
  update(nowMs, density = 1, limit = this.max) {
    const t = nowMs / 1000;
    this.timings.length = 0;
    const crossSlot = Math.floor(t / P.slotSeconds);
    const crossLocal = t - crossSlot * P.slotSeconds;
    const allowed = this.count || this.sidewalks ? Math.min(this.max, Math.round(Math.min(limit, this.max) * Math.max(0, Math.min(1, density)))) : 0;
    let n = 0;
    for (let i = 0; i < allowed; i++) {
      // Cada peatón tiene su propia fase: sus paseos no empiezan ni terminan todos a la vez.
      const tw = t + rand(i, 0, 11) * P.walkSeconds;
      const walkSlot = Math.floor(tw / P.walkSeconds);
      const byBike = i < this.bikeRiders;
      const before = n;
      if (this.sidewalks && (byBike || this.count === 0 || rand(i, walkSlot, 6) < this.walkFraction)) {
        n = this.walk(i, walkSlot, tw - walkSlot * P.walkSeconds, n, byBike);
      } else if (this.count) {
        n = this.cross(i, crossSlot, crossLocal, n);
      }
      if (n > before) this.bike[before] = byBike ? 1 : 0;
    }
    this.activeCount = n;
  }

  // Índice de un paso de peatones elegido en proporción a su peso (`u` en [0, 1)).
  pickCrossing(u) {
    const target = u * this.crossTotal;
    const cum = this.crossCumulative;
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] > target) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  // Cruza la calle por un paso de peatones; solo se ve mientras cruza.
  cross(i, k, local, n) {
    const c = this.crossings;
    const slot = P.slotSeconds;
    const j = this.pickCrossing(rand(i, k, 1)) * STRIDE;
    const road = CONFIG.roads.halfWidth[c[j + 4]];
    // En un puente solo se pisa la calzada: la acera quedaría suspendida sobre el agua.
    const half = this.inWater(c[j], c[j + 1]) ? road : road + P.margin;
    const speed = P.speed * (0.8 + 0.4 * rand(i, k, 2));
    const duration = (2 * half) / speed;
    let start = rand(i, k, 3) * Math.max(0, slot - duration);
    let span = duration;
    const sig = this.crossSignal[j / STRIDE];
    let waiting = false;
    if (sig >= 0) {
      // Paso con semáforo: espera en el bordillo y cruza dentro de la ventana de rojo de los coches (a ritmo de hora
      // simulada, comprimiendo el cruce si el rojo es corto). Si no cabe antes de acabar la ventana de tiempo, no cruza.
      const f = this.simPerSecond;
      const slotStart = this.simNow - local * f;
      const wanted = slotStart + start * f;
      const w = this.redWindow(sig, this.crossGroup[j / STRIDE], wanted);
      const room = w.length - 2 * P.redMargin;
      if (room < P.minRedWindow) return n;
      const lengthSim = Math.min(duration * f, room);
      const lo = w.start + P.redMargin;
      const begin = w.current ? Math.min(Math.max(wanted, lo), lo + room - lengthSim) : lo;
      if (begin + lengthSim > slotStart + slot * f) return n;
      start = (begin - slotStart) / f;
      span = lengthSim / f;
      waiting = this.simNow >= wanted;
      if (!waiting) return n;
    }
    let s = (local - start) / span;
    if (s > 1) return n;
    if (s < 0) {
      if (!waiting) return n;
      s = 0;
    }
    const dir = rand(i, k, 4) < 0.5 ? 1 : -1;
    const along = (2 * s - 1) * half * dir;
    const lateral = (rand(i, k, 5) - 0.5) * P.laneWidth;
    const dx = c[j + 2];
    const dz = c[j + 3];
    const x = c[j] + dx * along - dz * lateral;
    const z = c[j + 1] + dz * along + dx * lateral;
    if (this.inWaterOffBridge(x, z, c[j], c[j + 1])) return n;
    this.x[n] = x;
    this.z[n] = z;
    this.heading[n] = Math.atan2(-dz * dir, dx * dir);
    return n + 1;
  }

  // Camina por la acera desde un punto de salida aleatorio (tramo elegido en proporción a su longitud) y en cada
  // cruce sigue por una calle conectada, con preferencia por seguir recto. Solo desaparece en un callejón sin salida
  // de autovía o al terminar el paseo.
  walk(i, k, local, n, byBike = false) {
    const g = this.graph;
    const speedFactor = byBike ? CONFIG.bicycles.speedFactor : 1;
    const s = P.speed * speedFactor * (0.8 + 0.4 * rand(i, k, 2)) * local; // metros recorridos desde la salida
    if (this.walkSlot[i] !== k || s < this.walkS[i]) this.startWalk(i, k);
    this.walkS[i] = s;
    let e = this.walkEdge[i];
    if (e < 0) return n;
    let step = this.walkStep[i];
    let start = this.walkStart[i];
    const p0 = this.walkP0[i];
    let end = start + (step === 0 ? g.len[e] - p0 : g.len[e]);
    while (s > end) {
      start = end;
      step++;
      e = step < MAX_STEPS ? this.nextEdge(e, i, k, step - 1) : -1;
      if (e < 0) {
        this.walkEdge[i] = -1;
        return n;
      }
      end = start + g.len[e];
    }
    this.walkEdge[i] = e;
    this.walkStep[i] = step;
    this.walkStart[i] = start;
    const p = step === 0 ? p0 + s : s - start;
    const dx = g.ux[e];
    const dz = g.uz[e];
    const a = g.A[e];
    const cx = g.nx[a] + dx * p;
    const cz = g.nz[a] + dz * p;
    const road = CONFIG.roads.halfWidth[g.cls[e]];
    const reach = this.inWater(cx, cz) ? road * BRIDGE_LANE : road + P.margin / 2;
    let offset = (rand(i, k, 10) < 0.5 ? 1 : -1) * reach;
    let x = cx - dz * offset;
    let z = cz + dx * offset;
    if (this.inWaterOffBridge(x, z, cx, cz)) {
      // Acera en el agua (muelle, ría): prueba la acera de enfrente y, si tampoco, no se ve.
      offset = -offset;
      x = cx - dz * offset;
      z = cz + dx * offset;
      if (this.inWaterOffBridge(x, z, cx, cz)) return n;
    }
    this.x[n] = x;
    this.z[n] = z;
    this.heading[n] = Math.atan2(-dz, dx);
    return n + 1;
  }

  // Elige el tramo y el punto de salida del paseo `k` del peatón `i`.
  startWalk(i, k) {
    const { edges, cumulative } = this.sidewalks;
    const target = rand(i, k, 7) * cumulative[cumulative.length - 1];
    let lo = 0;
    let hi = edges.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] > target) hi = mid;
      else lo = mid + 1;
    }
    this.walkSlot[i] = k;
    this.walkEdge[i] = edges[lo];
    this.walkStep[i] = 0;
    this.walkStart[i] = 0;
    this.walkP0[i] = rand(i, k, 9) * this.graph.len[edges[lo]];
  }

  inWater(x, z) {
    return !!this.water && this.water.inWater(x, z);
  }

  // Un peatón no pisa el agua, salvo en un puente: ahí el eje de la calle (cx, cz) también está sobre el agua.
  inWaterOffBridge(x, z, cx, cz) {
    return this.inWater(x, z) && !this.inWater(cx, cz);
  }

  // Siguiente tramo al llegar al final de `e`: el que más sigue recto (con algo de azar), sin autovías ni dar la vuelta.
  nextEdge(e, i, k, step) {
    const g = this.graph;
    const node = g.B[e];
    let best = -1;
    let bestScore = -Infinity;
    for (let c = g.outStart[node], j = 0; c < g.outStart[node + 1]; c++, j++) {
      const f = g.outList[c];
      const weight = this.weightOf(f);
      if (g.cls[f] === 0 || weight <= 0 || f === g.rev[e]) continue;
      const score = g.ux[e] * g.ux[f] + g.uz[e] * g.uz[f] + 1.2 * rand(i, k, 1000 + step * 16 + (j & 15)) + P.attraction * Math.log(weight);
      if (score > bestScore) {
        bestScore = score;
        best = f;
      }
    }
    return best >= 0 ? best : g.rev[e] >= 0 && g.cls[g.rev[e]] !== 0 ? g.rev[e] : -1;
  }
}

// Tramos con acera (peso > 0: todas las clases menos autovía) y su longitud ponderada acumulada, para elegir uno en
// proporción a su longitud y a su peso.
function sidewalkEdges(g, weights) {
  const edges = [];
  const cumulative = [];
  let total = 0;
  for (let e = 0; e < g.edgeCount; e++) {
    const weight = weights ? weights[e] : g.cls[e] === 0 ? 0 : 1;
    if (weight <= 0) continue;
    total += g.len[e] * weight;
    edges.push(e);
    cumulative.push(total);
  }
  return edges.length ? { edges, cumulative } : null;
}

// Fracción de peatones activa según la demanda de tráfico (0 a 1 y pico) y el mínimo configurado.
export const pedestrianDensity = (demand) => P.minDensity + (1 - P.minDensity) * Math.min(1, Math.max(0, demand));
