import { CONFIG } from '../config.js';
import { demandFactor } from '../traffic/demand.js';
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
    this.suspended = this.lines.map(() => false); // línea sin servicio porque su recorrido está cortado
    // Gente esperando en cada parada de cada línea (índice = offset de la línea + parada).
    this.stopOffset = [];
    let total = 0;
    for (const l of this.lines) {
      this.stopOffset.push(total);
      total += l.stops.length;
    }
    this.waiting = new Uint16Array(total);
    this.stats = this.lines.map(() => ({ active: 0, passengers: 0, full: 0, waiting: 0 }));
    this.demand = 0;
    this.scratch = {};
  }

  // Autobuses de una línea (entre minFleet y maxFleet): los que entran en servicio se recalculan al instante.
  setFleet(li, count) {
    const line = this.lines[li];
    if (!line || !Number.isInteger(count) || count < T.minFleet || count > T.maxFleet) {
      throw new RangeError(`La flota debe ser un entero entre ${T.minFleet} y ${T.maxFleet}`);
    }
    line.buses = count;
    line.headway = line.cycle / count;
    this.ranks[li] = serviceRank(count);
  }

  setSuspended(li, suspended) {
    this.suspended[li] = suspended;
  }

  // Aplica la flota y las líneas suspendidas que publica el servidor (`state.buses.lines`).
  sync(lines) {
    lines.forEach(({ id, fleet, suspended }) => {
      const li = this.lines.findIndex((l) => l.id === id);
      if (li < 0) return;
      if (Number.isInteger(fleet) && fleet !== this.lines[li].buses && fleet >= T.minFleet && fleet <= T.maxFleet) this.setFleet(li, fleet);
      this.suspended[li] = !!suspended;
    });
  }

  // Reloj de los autobuses: la hora simulada dividida por la escala del servidor y multiplicada por `clockScale`
  // (tope: la escala del servidor), así que no van a la velocidad de los coches.
  updateAt(simSeconds, scenario, scale = 1) {
    const clock = Math.min(T.clockScale, scale);
    this.update((simSeconds * clock) / scale, demandFactor(simSeconds, scenario));
  }

  // `seconds`: reloj de autobuses; `demand`: demanda de la hora simulada (0..1).
  update(seconds, demand = 1) {
    this.demand = Math.min(1, Math.max(0, demand));
    const service = T.minService + (1 - T.minService) * this.demand;
    let n = 0;
    this.lines.forEach((line, li) => {
      const stats = this.stats[li];
      stats.active = stats.passengers = stats.full = stats.waiting = 0;
      const active = this.suspended[li] ? 0 : Math.min(line.buses, Math.ceil(line.buses * service));
      const us = [];
      for (let b = 0; b < line.buses; b++) {
        if (this.ranks[li][b] >= active) continue;
        const shifted = seconds + (b * line.cycle) / line.buses;
        const trip = Math.floor(shifted / line.cycle);
        const u = shifted - trip * line.cycle;
        us.push(u);
        const p = locate(this.g, line, u, this.scratch);
        let load = this.loadAt(line, li, b, trip, p.stop, p.dwelling ? p.progress : 1);
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
      this.updateWaiting(line, li, us);
    });
    this.activeCount = n;
  }

  // Pasajeros que suben de media en una parada a la hora actual.
  boardingMean(stop) {
    return T.boardings * stop.weight * (0.1 + 0.9 * this.demand);
  }

  // Pasajeros a bordo del autobús `bus` de la línea `li` en su viaje `trip` al llegar a la parada `j`. Se recorren las
  // paradas desde la salida; `progress` (0..1) es cuánto han bajado y subido en la última (1 = ya terminó).
  loadAt(line, li, bus, trip, j, progress) {
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
      const wanted = Math.round(this.boardingMean(stop) * (0.5 + rand(li, bus, trip, k * 2 + 1)) * part);
      load = Math.min(T.capacity, load + wanted);
    }
    return load;
  }

  // Gente esperando en cada parada: crece desde que pasó el último autobús y se vacía mientras sube a uno.
  updateWaiting(line, li, us) {
    const { stops, arrive, depart, cycle } = line;
    this.stats[li].waiting = 0;
    for (let j = 0; j < stops.length; j++) {
      let since = Infinity;
      let boarding = -1;
      for (const u of us) {
        if (u >= arrive[j] && u < depart[j]) boarding = Math.max(boarding, (u - arrive[j]) / stops[j].dwell);
        else since = Math.min(since, (((u - depart[j]) % cycle) + cycle) % cycle);
      }
      const growth = boarding >= 0 ? 1 - boarding : Math.min(1, since / T.waitingSeconds);
      const waiting = Math.round(this.boardingMean(stops[j]) * 1.2 * growth);
      this.waiting[this.stopOffset[li] + j] = Math.min(T.maxWaiting, waiting); // en pantalla se dibujan como mucho `maxWaiting`
      this.stats[li].waiting += waiting;
    }
  }

  isFull(i) {
    return this.load[i] >= T.capacity * T.fullAt;
  }

  // Sin conexión con el servidor no hay hora simulada: ningún autobús en servicio ni nadie esperando.
  clear() {
    this.activeCount = 0;
    this.waiting.fill(0);
    for (const st of this.stats) st.active = st.passengers = st.full = st.waiting = 0;
  }

  describe(i) {
    return { line: this.lines[this.line[i]].id, load: this.load[i], capacity: T.capacity, full: this.isFull(i), atStop: !!this.dwelling[i] };
  }
}
