import { CONFIG } from '../config.js';
import { bikeDemand, scenarioForTime, simDate } from '../traffic/demand.js';
import { createRng } from '../core/random.js';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MAX_RECORDS = 200000;
const DEFAULT_CAPACITY = 12;
export const BIKE_COLUMNS = ['timestamp', 'weekday', 'station_id', 'station_name', 'x', 'z', 'capacity', 'bikes', 'free_docks', 'takes', 'returns', 'occupancy_pct'];

function hash(text) {
  let h = 2166136261;
  for (const char of String(text)) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function poisson(lambda, rng) {
  const limit = Math.exp(-lambda);
  let k = 0;
  for (let p = rng(); p > limit; p *= rng()) k++;
  return k;
}

// Red de estaciones de bicicletas compartidas. Los peatones cogen una bicicleta en una estación (más movimiento en
// las más "populares" y en las horas de más demanda), van a ×speedFactor y la dejan en otra con anclajes libres
// al cabo de ~tripSeconds. Es un modelo mesoscópico: cada paso de `stepSeconds` es una función del estado anterior
// y de un generador sembrado con el instante, así que se reproduce igual tras reiniciar o recuperar tiempo.
// Los recuentos son estimaciones de la simulación, no lecturas de sensores físicos.
export class BikeNetwork {
  constructor({ stations = [], getSimTime, getParams }) {
    this.getParams = getParams;
    this.stationList = stations
      .filter((s) => s?.id && Number.isFinite(s.x) && Number.isFinite(s.z))
      .map((s) => ({
        id: String(s.id),
        name: s.name || String(s.id),
        x: s.x,
        z: s.z,
        capacity: Number.isInteger(s.capacity) && s.capacity > 0 ? s.capacity : DEFAULT_CAPACITY,
        weight: 0.5 + hash(`w${s.id}`) / 4294967296, // popularidad fija en [0.5, 1.5)
        estimated: Boolean(s.estimatedCapacity),
      }));
    this.changes = new Map(); // id -> { capacity, effectiveAt }: cambios de anclajes pendientes
    this.index = new Map(this.stationList.map((s, i) => [s.id, i]));
    const C = CONFIG.bicycles;
    this.docked = this.stationList.map((s) => Math.round(s.capacity * C.initialFill));
    this.takes = new Array(this.stationList.length).fill(0);
    this.returns = new Array(this.stationList.length).fill(0);
    this.inUse = 0;
    this.stepSeconds = C.stepSeconds;
    this.intervalSeconds = C.intervalSeconds;
    this.nextStep = Math.ceil(getSimTime() / this.stepSeconds) * this.stepSeconds;
    this.tracked = new Set();
    this.pending = [];
    // Puestos del centro (1), de barrio (-1) o intermedios (0), para la ida y vuelta al trabajo.
    const M = C.commute;
    this.zone = this.stationList.map((s) => {
      const d = Math.hypot(s.x, s.z);
      return d <= M.centerRadius ? 1 : d >= M.suburbRadius ? -1 : 0;
    });
    // Furgonetas: posición, ocupada hasta y trabajo en curso.
    this.vans = Array.from({ length: C.vans.count }, (_, k) => ({ id: `F${k + 1}`, x: 0, z: 0, job: null }));
    this.moved = 0; // bicis movidas en furgoneta desde el arranque
  }

  // Multiplicadores de coger y dejar bici en el puesto `i` a la hora `time` (marea de ida y vuelta al trabajo).
  tide(i, time) {
    const M = CONFIG.bicycles.commute;
    const z = this.zone[i];
    // Días de trabajo (laborables y vísperas de festivo); en fin de semana y festivos no hay marea.
    if (!z || !['weekday', 'preholiday'].includes(scenarioForTime(time, this.getParams().scenario))) return [1, 1];
    const h = simDate(time).getUTCHours();
    const way = h >= M.morning[0] && h < M.morning[1] ? 1 : h >= M.evening[0] && h < M.evening[1] ? -1 : 0;
    if (!way) return [1, 1];
    // Mañana: los barrios (z = -1) se vacían y el centro (z = 1) se llena; tarde, al revés.
    const f = 1 + M.strength;
    return z * way > 0 ? [1 / f, f] : [f, 1 / f];
  }

  // Encarga a una furgoneta libre mover hasta `bikes` bicis del puesto `from` al `to`. Va al origen, carga las que haya
  // (como mucho su capacidad), va al destino y descarga las que quepan; las que no caben las deja en circulación.
  moveBikes(from, to, bikes, now) {
    const V = CONFIG.bicycles.vans;
    const a = this.index.get(from);
    const b = this.index.get(to);
    if (a === undefined || b === undefined) throw new Error('Estación desconocida');
    if (a === b) throw new Error('El origen y el destino deben ser distintos');
    if (!Number.isInteger(bikes) || bikes < 1 || bikes > V.capacity) throw new Error(`bikes debe ser un entero entre 1 y ${V.capacity}`);
    const free = this.vans.filter((v) => !v.job);
    if (!free.length) return null;
    const A = this.stationList[a];
    const B = this.stationList[b];
    const van = free.reduce((best, v) => (Math.hypot(v.x - A.x, v.z - A.z) < Math.hypot(best.x - A.x, best.z - A.z) ? v : best));
    const loadAt = now + Math.hypot(van.x - A.x, van.z - A.z) / V.speed + V.handlingSeconds;
    const unloadAt = loadAt + Math.hypot(A.x - B.x, A.z - B.z) / V.speed + V.handlingSeconds;
    van.job = { from, to, bikes, loadAt, unloadAt, loaded: null, unloaded: null };
    return van;
  }

  // Avanza las furgonetas hasta `time`: cargan al llegar al origen y descargan al llegar al destino.
  moveVans(time) {
    for (const van of this.vans) {
      const job = van.job;
      if (!job) continue;
      if (job.loaded === null && job.loadAt <= time) {
        const a = this.index.get(job.from);
        job.loaded = Math.min(job.bikes, this.docked[a]);
        this.docked[a] -= job.loaded;
        van.x = this.stationList[a].x;
        van.z = this.stationList[a].z;
      }
      if (job.loaded !== null && job.unloadAt <= time) {
        const b = this.index.get(job.to);
        const fit = Math.min(job.loaded, this.stationList[b].capacity - this.docked[b]);
        this.docked[b] += fit;
        this.inUse += job.loaded - fit; // las que no caben se dejan en otro puesto (en circulación)
        this.moved += job.loaded;
        van.x = this.stationList[b].x;
        van.z = this.stationList[b].z;
        van.job = null;
      }
    }
  }

  vansState() {
    const iso = (t) => simDate(t).toISOString().slice(0, 19);
    return this.vans.map((v) => ({
      id: v.id, x: Math.round(v.x), z: Math.round(v.z), busy: !!v.job,
      job: v.job ? { from: v.job.from, to: v.job.to, bikes: v.job.bikes, loaded: v.job.loaded, loadAt: iso(v.job.loadAt), unloadAt: iso(v.job.unloadAt) } : null,
    }));
  }

  get count() {
    return this.stationList.length;
  }

  isTracked(id) {
    return this.tracked.has(id);
  }

  setTracked(id, on) {
    if (!this.index.has(id)) return;
    if (on) this.tracked.add(id);
    else this.tracked.delete(id);
  }

  setAll(on) {
    this.tracked = on ? new Set(this.index.keys()) : new Set();
  }

  // Programa un cambio de anclajes que se aplica `capacityDelaySeconds` después de `now`; `null` cancela el pendiente.
  scheduleCapacity(id, capacity, now) {
    if (!this.index.has(id)) throw new Error(`Estación desconocida: ${id}`);
    if (capacity === null) {
      this.changes.delete(id);
      return;
    }
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > CONFIG.bicycles.maxCapacity) {
      throw new Error(`La capacidad debe ser un entero entre 1 y ${CONFIG.bicycles.maxCapacity}`);
    }
    if (capacity === this.stationList[this.index.get(id)].capacity) this.changes.delete(id);
    else this.changes.set(id, { capacity, effectiveAt: now + CONFIG.bicycles.capacityDelaySeconds });
  }

  applyChanges(time) {
    for (const [id, change] of this.changes) {
      if (change.effectiveAt > time) continue;
      const i = this.index.get(id);
      const station = this.stationList[i];
      station.capacity = change.capacity;
      station.estimated = false;
      // Las bicicletas que ya no caben salen a circulación y se dejan en otro puesto.
      if (this.docked[i] > station.capacity) {
        this.inUse += this.docked[i] - station.capacity;
        this.docked[i] = station.capacity;
      }
      this.changes.delete(id);
    }
  }

  tick(simTime) {
    while (simTime >= this.nextStep) {
      this.step(this.nextStep);
      this.nextStep += this.stepSeconds;
    }
  }

  step(time) {
    if (!this.count) return;
    const C = CONFIG.bicycles;
    this.applyChanges(time);
    this.moveVans(time);
    const rng = createRng(hash(`${Math.round(time / this.stepSeconds)}:${CONFIG.sim.seed}`));
    const demand = bikeDemand(time, this.getParams().scenario);
    for (let i = 0; i < this.count; i++) {
      const lambda = (C.takesPerHour * this.stationList[i].weight * (this.stationList[i].capacity / DEFAULT_CAPACITY) * demand * this.tide(i, time)[0] * this.stepSeconds) / 3600;
      const taken = Math.min(this.docked[i], poisson(lambda, rng));
      this.docked[i] -= taken;
      this.takes[i] += taken;
      this.inUse += taken;
    }
    const expected = this.inUse * (1 - Math.exp(-this.stepSeconds / C.tripSeconds));
    const arrivals = Math.min(this.inUse, Math.floor(expected) + (rng() < expected % 1 ? 1 : 0));
    for (let n = 0; n < arrivals; n++) {
      const i = this.pickReturn(rng(), time);
      if (i < 0) break;
      this.docked[i]++;
      this.returns[i]++;
      this.inUse--;
    }
    if (time % this.intervalSeconds === 0) this.record(time);
  }

  // Estación donde deja la bicicleta: probabilidad ∝ popularidad × anclajes libres.
  pickReturn(u, time) {
    const w = this.stationList.map((s, i) => s.weight * (s.capacity - this.docked[i]) * (time === undefined ? 1 : this.tide(i, time)[1]));
    let total = 0;
    for (let i = 0; i < this.count; i++) total += w[i];
    if (total <= 0) return -1;
    let target = u * total;
    for (let i = 0; i < this.count; i++) {
      target -= w[i];
      if (target < 0) return i;
    }
    return this.count - 1;
  }

  record(time) {
    const d = simDate(time);
    const timestamp = d.toISOString().slice(0, 19);
    for (let i = 0; i < this.count; i++) {
      const s = this.stationList[i];
      if (this.tracked.has(s.id)) {
        this.pending.push({
          timestamp,
          weekday: WEEKDAYS[d.getUTCDay()],
          station_id: s.id,
          station_name: s.name,
          x: Math.round(s.x),
          z: Math.round(s.z),
          capacity: s.capacity,
          bikes: this.docked[i],
          free_docks: s.capacity - this.docked[i],
          takes: this.takes[i],
          returns: this.returns[i],
          occupancy_pct: Math.round((this.docked[i] / s.capacity) * 1000) / 10,
        });
      }
      this.takes[i] = 0;
      this.returns[i] = 0;
    }
    if (this.pending.length > MAX_RECORDS) this.pending.splice(0, this.pending.length - MAX_RECORDS);
  }

  // Estado actual para la API: bicicletas ancladas en cada estación y bicicletas en circulación.
  state() {
    return {
      inUse: this.inUse,
      vans: this.vansState(),
      moved: this.moved,
      stations: this.stationList.map((s, i) => ({
        id: s.id,
        name: s.name,
        x: Math.round(s.x * 10) / 10,
        z: Math.round(s.z * 10) / 10,
        capacity: s.capacity,
        available: this.docked[i],
        tracked: this.tracked.has(s.id),
        estimated: s.estimated,
        pending: this.changes.has(s.id) ? { ...this.changes.get(s.id) } : null,
      })),
    };
  }

  serialize() {
    return {
      nextStep: this.nextStep,
      inUse: this.inUse,
      tracked: [...this.tracked],
      changes: [...this.changes].map(([id, c]) => [id, c.capacity, c.effectiveAt]),
      stations: this.stationList.map((s, i) => [s.id, this.docked[i], this.takes[i], this.returns[i], s.capacity]),
      vans: this.vans.map((v) => ({ x: v.x, z: v.z, job: v.job })),
      moved: this.moved,
    };
  }

  restore(state) {
    this.nextStep = state.nextStep;
    this.inUse = state.inUse;
    this.tracked = new Set(state.tracked.filter((id) => this.index.has(id)));
    this.changes = new Map((state.changes ?? []).filter(([id]) => this.index.has(id)).map(([id, capacity, effectiveAt]) => [id, { capacity, effectiveAt }]));
    (state.vans ?? []).forEach((v, k) => {
      if (this.vans[k]) Object.assign(this.vans[k], { x: v.x, z: v.z, job: v.job && this.index.has(v.job.from) && this.index.has(v.job.to) ? v.job : null });
    });
    this.moved = state.moved ?? 0;
    for (const [id, docked, takes, returns, capacity] of state.stations) {
      const i = this.index.get(id);
      if (i === undefined) continue;
      if (Number.isInteger(capacity) && capacity !== this.stationList[i].capacity) {
        this.stationList[i].capacity = capacity;
        this.stationList[i].estimated = false;
      }
      this.docked[i] = Math.min(docked, this.stationList[i].capacity);
      this.takes[i] = takes;
      this.returns[i] = returns;
    }
  }
}
