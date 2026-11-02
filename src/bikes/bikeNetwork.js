import { CONFIG } from '../config.js';
import { demandFactor, simDate } from '../traffic/demand.js';
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
    const rng = createRng(hash(`${Math.round(time / this.stepSeconds)}:${CONFIG.sim.seed}`));
    const demand = demandFactor(time, this.getParams().scenario);
    for (let i = 0; i < this.count; i++) {
      const lambda = (C.takesPerHour * this.stationList[i].weight * (this.stationList[i].capacity / DEFAULT_CAPACITY) * demand * this.stepSeconds) / 3600;
      const taken = Math.min(this.docked[i], poisson(lambda, rng));
      this.docked[i] -= taken;
      this.takes[i] += taken;
      this.inUse += taken;
    }
    const expected = this.inUse * (1 - Math.exp(-this.stepSeconds / C.tripSeconds));
    const arrivals = Math.min(this.inUse, Math.floor(expected) + (rng() < expected % 1 ? 1 : 0));
    for (let n = 0; n < arrivals; n++) {
      const i = this.pickReturn(rng());
      if (i < 0) break;
      this.docked[i]++;
      this.returns[i]++;
      this.inUse--;
    }
    if (time % this.intervalSeconds === 0) this.record(time);
  }

  // Estación donde deja la bicicleta: probabilidad ∝ popularidad × anclajes libres.
  pickReturn(u) {
    let total = 0;
    for (let i = 0; i < this.count; i++) total += (this.stationList[i].capacity - this.docked[i]) * this.stationList[i].weight;
    if (total <= 0) return -1;
    let target = u * total;
    for (let i = 0; i < this.count; i++) {
      target -= this.stationList[i].weight * (this.stationList[i].capacity - this.docked[i]);
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
    };
  }

  restore(state) {
    this.nextStep = state.nextStep;
    this.inUse = state.inUse;
    this.tracked = new Set(state.tracked.filter((id) => this.index.has(id)));
    this.changes = new Map((state.changes ?? []).filter(([id]) => this.index.has(id)).map(([id, capacity, effectiveAt]) => [id, { capacity, effectiveAt }]));
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
