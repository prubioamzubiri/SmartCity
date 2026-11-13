import { CONFIG } from '../config.js';
import { transitDemand } from '../traffic/demand.js';
import { eventCalendar } from '../events/calendar.js';
import { locate } from './lines.js';

const T = CONFIG.transit;

// Color de la barra de ocupación: verde con sitio, ámbar con bastante gente y rojo cuando el autobús va lleno.
export function loadColor(occupancy) {
  if (occupancy >= T.fullAt) return 0xff3b30;
  return occupancy >= 0.5 ? 0xffc107 : 0x3ddc84;
}

// Hash sin estado: número en [0, 1) para una combinación de enteros.
function rand(a, b, c, d) {
  let h = Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 0x7f4a7c15, 0x85ebca6b) ^ Math.imul(c + 0x165667b1, 0xc2b2ae35) ^ Math.imul(d + 0x27d4eb2f, 0x61c88647);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// Orden en el que los autobuses de una línea entran en servicio: bits invertidos, para que los que queden
// en servicio sigan repartidos a lo largo del recorrido en vez de agruparse.
function serviceRank(n) {
  let bits = 1;
  while (1 << bits < n) bits++;
  const order = [];
  for (let i = 0; i < 1 << bits; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    if (r < n) order.push(r);
  }
  const rank = new Int32Array(n);
  order.forEach((bus, k) => (rank[bus] = k));
  return rank;
}

// Se pide más flota de la que hay (la flota total es fija): el servidor responde 409.
export class FleetError extends Error {}

// Autobuses de la ciudad. No guardan estado: la posición y la ocupación de cada uno son una función del tiempo
// (como los peatones), así que no hace falta que el servidor los simule. Cada autobús recorre su línea de ida y vuelta,
// para en cada parada, deja bajar a parte de los pasajeros y sube a los que esperan hasta llenarse.
export class Buses {
  constructor(transit, graph) {
    this.g = graph;
    this.lines = transit.lines;
    this.max = this.lines.length * Math.max(T.maxFleet, ...this.lines.map((l) => l.buses)); // sitio para la flota máxima de cada línea
    this.x = new Float32Array(this.max);
    this.z = new Float32Array(this.max);
    this.heading = new Float32Array(this.max);
    this.load = new Int16Array(this.max);
    this.line = new Uint8Array(this.max);
    this.stop = new Int32Array(this.max); // parada alcanzada más recientemente
    this.dwelling = new Uint8Array(this.max);
    this.activeCount = 0;
    this.ranks = this.lines.map((l) => serviceRank(l.buses));
    // Flota total fija: la inicial de cada línea más una reserva. Se puede repartir entre líneas, pero no crecer.
    this.defaultFleet = this.lines.map((l) => l.buses);
    this.fleetTotal = Math.round(this.defaultFleet.reduce((a, b) => a + b, 0) * (1 + T.reserve));
    this.suspended = this.lines.map(() => false); // línea sin servicio porque su recorrido está cortado
    // Gente esperando en cada parada de cada línea (índice = offset de la línea + parada).
    this.stopOffset = [];
    let total = 0;
    for (const l of this.lines) {
      this.stopOffset.push(total);
      total += l.stops.length;
    }
    this.waiting = new Uint16Array(total);
    // Multiplicador de la demanda de cada parada por los eventos (se recalcula con la hora).
    this.stopFactor = new Float32Array(total).fill(1);
    // Autobuses que salen de la cochera hacia cada línea: [{ count, at }] (entran en servicio en `at`, hora simulada).
    this.pending = this.lines.map(() => []);
    // Demanda de autobús de más por causas que solo conoce el servidor (calles cortadas); el visor la recibe.
    this.extraDemand = 1;
    this.stats = this.lines.map(() => ({ active: 0, passengers: 0, full: 0, waiting: 0, demanded: 0, leftBehind: 0, gap: 0 }));
    this.demand = 0;
    this.rawDemand = 0;
    this.gap = null; // tiempo entre autobuses de la línea que se está calculando
    this.scratch = {};
  }

  // Autobuses asignados a todas las líneas (en servicio y de camino desde la cochera) y los que quedan en reserva.
  fleetInUse() {
    return this.lines.reduce((a, l, li) => a + this.committed(li), 0);
  }

  // Autobuses de una línea contando los que van de camino.
  committed(li) {
    return this.lines[li].buses + this.pending[li].reduce((a, p) => a + p.count, 0);
  }

  reserve() {
    return this.fleetTotal - this.fleetInUse();
  }

  // Autobuses de una línea (entre minFleet y maxFleet, y sin pasarse de la flota total). Quitar es inmediato (vuelven
  // a la cochera); los que se añaden salen de la cochera y entran en servicio `deployMinutes` después (hora simulada
  // `now`). Si había autobuses en camino y se piden menos, se cancelan primero esos. `limit: false` solo lo usa quien
  // aplica un reparto ya validado (el visor, un snapshot): cambia la flota en servicio al instante.
  setFleet(li, count, { limit = true, now = null } = {}) {
    const line = this.lines[li];
    if (!line || !Number.isInteger(count) || count < T.minFleet || count > T.maxFleet) {
      throw new RangeError(`La flota debe ser un entero entre ${T.minFleet} y ${T.maxFleet}`);
    }
    const committed = this.committed(li);
    if (limit && count - committed > this.reserve()) {
      throw new FleetError(`No hay autobuses suficientes: quedan ${this.reserve()} en reserva (flota total ${this.fleetTotal}). Quita autobuses de otra línea primero`);
    }
    if (!limit || now === null || !(T.deployMinutes > 0)) {
      this.pending[li] = [];
      this.applyFleet(li, count);
      return;
    }
    if (count > committed) {
      this.pending[li].push({ count: count - committed, at: now + T.deployMinutes * 60 });
      return;
    }
    // Menos autobuses: primero se cancelan los que iban de camino (los últimos en salir), luego se retiran.
    let remove = committed - count;
    const list = this.pending[li];
    while (remove > 0 && list.length) {
      const last = list[list.length - 1];
      const n = Math.min(remove, last.count);
      last.count -= n;
      remove -= n;
      if (!last.count) list.pop();
    }
    if (remove > 0) this.applyFleet(li, line.buses - remove);
  }

  applyFleet(li, count) {
    const line = this.lines[li];
    line.buses = count;
    line.headway = line.cycle / count;
    this.ranks[li] = serviceRank(count);
  }

  // Los autobuses que han llegado desde la cochera entran en servicio.
  tick(now) {
    this.pending.forEach((list, li) => {
      let arrived = 0;
      while (list.length && list[0].at <= now) arrived += list.shift().count;
      if (arrived) this.applyFleet(li, Math.min(T.maxFleet, this.lines[li].buses + arrived));
    });
  }

  // Lo que va de camino, para el API y los snapshots.
  pendingOf(li) {
    return this.pending[li].map((p) => ({ count: p.count, at: p.at }));
  }

  restorePending(li, list) {
    this.pending[li] = (list ?? []).filter((p) => Number.isInteger(p.count) && p.count > 0 && Number.isFinite(p.at)).map((p) => ({ count: p.count, at: p.at }));
  }

  setSuspended(li, suspended) {
    this.suspended[li] = suspended;
  }

  // Aplica la flota y las líneas suspendidas que publica el servidor (`state.buses.lines`).
  sync(lines, extraDemand = 1) {
    lines.forEach(({ id, fleet, suspended }) => {
      const li = this.lines.findIndex((l) => l.id === id);
      if (li < 0) return;
      if (Number.isInteger(fleet) && fleet !== this.lines[li].buses && fleet >= T.minFleet && fleet <= T.maxFleet) this.applyFleet(li, fleet);
      this.suspended[li] = !!suspended;
    });
    if (Number.isFinite(extraDemand) && extraDemand > 0) this.extraDemand = extraDemand;
  }

  // Demanda de cada parada por los eventos: antes de un evento, la gente va hacia la sede en las líneas que pasan
  // cerca (toda la línea); al terminar, sale toda a la vez desde las paradas cercanas a la sede.
  updateStopFactors(seconds) {
    this.stopFactor.fill(1);
    if (!CONFIG.events.enabled || !(T.eventRiders > 0)) return;
    for (const ev of eventCalendar.busDemandAt(seconds)) {
      const reach = ev.radius * T.eventReach;
      this.lines.forEach((line, li) => {
        const off = this.stopOffset[li];
        const near = [];
        line.stops.forEach((st, j) => {
          if (Math.hypot(st.x - ev.x, st.z - ev.z) <= reach) near.push(j);
        });
        if (!near.length) return;
        const extra = T.eventRiders * ev.weight;
        if (ev.phase === 'leave') {
          // La misma gente que llegó por toda la línea sale ahora desde unas pocas paradas.
          const k = (extra * line.stops.length) / near.length;
          for (const j of near) this.stopFactor[off + j] += k;
        } else {
          // La mayoría llega en la última hora: la demanda se concentra al final de la rampa de llegada.
          const k = ev.phase === 'arrive' ? extra * T.eventArrivalPeak * ev.level ** 2 : extra * 0.2;
          for (let j = 0; j < line.stops.length; j++) this.stopFactor[off + j] += k;
        }
      });
    }
  }

  // Reloj de los autobuses: la hora simulada dividida por la escala del servidor y multiplicada por `clockScale`
  // (tope: la escala del servidor), así que no van a la velocidad de los coches.
  updateAt(simSeconds, scenario, scale = 1) {
    const clock = Math.min(T.clockScale, scale);
    this.updateStopFactors(simSeconds);
    const demand = transitDemand(simSeconds, scenario);
    // Cuántos autobuses de la flota salen depende de la demanda normal; la que traen las calles cortadas la tiene que
    // cubrir el gestor (si no, contaría como sobrecoste de un grupo que no ha pedido ningún autobús).
    this.update((simSeconds * clock) / scale, demand * this.extraDemand, demand);
  }

  // `seconds`: reloj de autobuses; `demand`: demanda de la hora simulada (0..1).
  update(seconds, demand = 1, serviceDemand = demand) {
    this.rawDemand = Math.max(0, demand);
    this.demand = Math.min(1, Math.max(0, serviceDemand));
    const service = T.minService + (1 - T.minService) * this.demand;
    let n = 0;
    this.lines.forEach((line, li) => {
      const stats = this.stats[li];
      stats.active = stats.passengers = stats.full = stats.waiting = stats.demanded = stats.leftBehind = 0;
      const active = this.suspended[li] ? 0 : Math.min(line.buses, Math.ceil(line.buses * service));
      // Tiempo (reloj de autobús) entre dos autobuses en cada parada: con más autobuses, menos gente sube a cada uno.
      const gap = active ? line.cycle / active : Infinity;
      stats.gap = gap;
      stats.fleet = line.buses;
      this.gap = gap;
      const us = [];
      for (let b = 0; b < line.buses; b++) {
        if (this.ranks[li][b] >= active) continue;
        const shifted = seconds + (b * line.cycle) / line.buses;
        const trip = Math.floor(shifted / line.cycle);
        const u = shifted - trip * line.cycle;
        us.push(u);
        const p = locate(this.g, line, u, this.scratch);
        let load = this.loadAt(line, li, b, trip, p.stop, p.dwelling ? p.progress : 1, stats);
        // En la terminal de salida bajan los pasajeros del viaje anterior mientras suben los del siguiente.
        if (p.stop === 0 && p.dwelling) load += Math.round(this.loadAt(line, li, b, trip - 1, line.stops.length - 1, 1) * (1 - p.progress));
        this.x[n] = p.x;
        this.z[n] = p.z;
        this.heading[n] = Math.atan2(-p.dz, p.dx);
        this.load[n] = load;
        this.line[n] = li;
        this.stop[n] = p.stop;
        this.dwelling[n] = p.dwelling ? 1 : 0;
        stats.active++;
        stats.passengers += load;
        if (load >= T.capacity * T.fullAt) stats.full++;
        n++;
      }
      if (!active) {
        // Sin autobuses (línea suspendida o fuera de servicio): toda la gente que querría subir se queda en tierra.
        let rate = 0;
        for (let j = 0; j < line.stops.length; j++) rate += this.arrivalRate(li, j);
        stats.demanded = stats.leftBehind = (rate / line.stops.length) * line.cycle;
      }
      this.updateWaiting(line, li, us);
    });
    this.activeCount = n;
  }

  // Personas que llegan a una parada por segundo (reloj de autobús) a la hora actual.
  arrivalRate(li, j) {
    const stop = this.lines[li].stops[j];
    return (T.boardings / T.headway) * stop.weight * (0.1 + 0.9 * this.rawDemand) * this.stopFactor[this.stopOffset[li] + j];
  }

  // Pasajeros a bordo del autobús `bus` de la línea `li` en su viaje `trip` al llegar a la parada `j`. Se recorren las
  // paradas desde la salida; `progress` (0..1) es cuánto han bajado y subido en la última (1 = ya terminó). En cada
  // parada quiere subir la gente que ha llegado desde el autobús anterior; si no cabe, se queda en tierra. En la parada
  // actual se anota en `stats` cuánta gente quería subir y cuánta se ha quedado.
  loadAt(line, li, bus, trip, j, progress, stats = null) {
    const gap = Math.min(this.gap ?? line.headway, T.patienceSeconds);
    let load = 0;
    for (let k = 0; k <= j; k++) {
      const stop = line.stops[k];
      const part = k === j ? progress : 1;
      if (stop.turnaround) {
        load -= Math.round(load * part); // en el cambio de sentido bajan todos
      } else if (k > 0) {
        const share = T.alightMin + T.alightSpread * rand(li, bus, trip, k * 2);
        load -= Math.round(load * share * part);
      }
      const wanted = this.arrivalRate(li, k) * gap * (0.5 + rand(li, bus, trip, k * 2 + 1));
      const boarded = Math.min(T.capacity - load, Math.round(wanted * part));
      if (stats && k === j) {
        stats.demanded += wanted;
        stats.leftBehind += Math.max(0, wanted - (T.capacity - load));
      }
      load += Math.max(0, boarded);
    }
    return load;
  }

  // Gente esperando en cada parada: llega a su ritmo desde que pasó el último autobús (si pasa demasiado tiempo, se
  // cansa y se va) y se vacía mientras sube a uno. Si los autobuses van llenos, la que no cabe sigue esperando.
  updateWaiting(line, li, us) {
    const { stops, arrive, depart, cycle } = line;
    const st = this.stats[li];
    st.waiting = 0;
    const stranded = st.demanded > 0 ? Math.min(1, st.leftBehind / st.demanded) : 0;
    for (let j = 0; j < stops.length; j++) {
      let since = Infinity;
      let boarding = -1;
      for (const u of us) {
        if (u >= arrive[j] && u < depart[j]) boarding = Math.max(boarding, (u - arrive[j]) / stops[j].dwell);
        else since = Math.min(since, (((u - depart[j]) % cycle) + cycle) % cycle);
      }
      const rate = this.arrivalRate(li, j);
      const gap = Math.min(this.gap ?? line.headway, T.patienceSeconds);
      const arrived = boarding >= 0 ? rate * gap * (1 - boarding) : rate * Math.min(since, T.patienceSeconds);
      const waiting = Math.round(arrived * (1 + stranded));
      this.waiting[this.stopOffset[li] + j] = Math.min(T.maxWaiting, waiting); // en pantalla se dibujan como mucho `maxWaiting`
      st.waiting += waiting;
    }
    st.demanded = Math.round(st.demanded);
    st.leftBehind = Math.round(st.leftBehind);
  }

  // Gente que quiere ir en autobús, por hora de reloj de autobús (todas las paradas): la base de la métrica por viajero.
  riders() {
    let rate = 0;
    this.lines.forEach((line, li) => {
      for (let j = 0; j < line.stops.length; j++) rate += this.arrivalRate(li, j);
    });
    return rate * 3600;
  }

  // Fracción de quien quería ir en autobús que no ha podido (se queda en tierra o se cansa de esperar): es la gente que
  // acaba cogiendo el coche. Media de las líneas ponderada por la demanda.
  unservedShare() {
    let demanded = 0;
    let unserved = 0;
    this.stats.forEach((s, li) => {
      if (!(s.demanded > 0)) return;
      demanded += s.demanded;
      unserved += s.demanded * this.unservedOf(li);
    });
    return demanded > 0 ? unserved / demanded : 0;
  }

  // Lo mismo para una línea.
  unservedOf(li) {
    const s = this.stats[li];
    if (!(s.demanded > 0)) return 0;
    const tired = Number.isFinite(s.gap) ? Math.max(0, 1 - T.patienceSeconds / s.gap) : 1;
    return Math.min(1, s.leftBehind / s.demanded + tired);
  }

  isFull(i) {
    return this.load[i] >= T.capacity * T.fullAt;
  }

  // Sin conexión con el servidor no hay hora simulada: ningún autobús en servicio ni nadie esperando.
  clear() {
    this.activeCount = 0;
    this.waiting.fill(0);
    for (const st of this.stats) st.active = st.passengers = st.full = st.waiting = st.demanded = st.leftBehind = 0;
  }

  describe(i) {
    return { line: this.lines[this.line[i]].id, load: this.load[i], capacity: T.capacity, full: this.isFull(i), atStop: !!this.dwelling[i] };
  }
}
