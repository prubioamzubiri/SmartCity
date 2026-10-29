import { CONFIG } from '../config.js';
import { simDate } from '../traffic/demand.js';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MAX_RECORDS = 200000;
const COLUMNS = ['timestamp', 'weekday', 'parking_id', 'parking_name', 'capacity', 'occupied', 'free', 'occupancy_pct'];

const csvSafe = (v) => {
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Registra periódicamente la ocupación de los parkings elegidos por el usuario.
// `lots`: [{ id, name, capacity, estimatedCapacity }]; `occupancyOf(lot, simTime)` devuelve 0..1.
export class ParkingTracker {
  constructor({ lots, occupancyOf, getSimTime, storage = globalThis.localStorage }) {
    this.lots = new Map(lots.map((l) => [l.id, l]));
    this.occupancyOf = occupancyOf;
    this.storage = storage;
    this.tracked = new Set();
    this.records = [];
    this.pending = [];
    this.listeners = new Set();
    this.setIntervalSeconds(CONFIG.parkingTracking.intervalSeconds, getSimTime());
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  emit() {
    this.listeners.forEach((fn) => fn());
  }

  isTracked(id) {
    return this.tracked.has(id);
  }

  setTracked(id, on) {
    if (!this.lots.has(id) || this.tracked.has(id) === on) return;
    if (on) this.tracked.add(id);
    else this.tracked.delete(id);
    this.save();
    this.emit();
  }

  toggle(id) {
    this.setTracked(id, !this.tracked.has(id));
  }

  setAll(on) {
    this.tracked = on ? new Set(this.lots.keys()) : new Set();
    this.save();
    this.emit();
  }

  setIntervalSeconds(sec, simTime) {
    this.intervalSeconds = sec;
    this.nextSample = Math.ceil(simTime / sec) * sec;
  }

  // Toma una muestra en cada límite de intervalo alcanzado por el reloj simulado.
  tick(simTime) {
    let sampled = false;
    while (simTime >= this.nextSample) {
      this.sample(this.nextSample);
      this.nextSample += this.intervalSeconds;
      sampled = true;
    }
    if (sampled) this.emit();
  }

  sample(time) {
    const d = simDate(time);
    const timestamp = d.toISOString().slice(0, 19);
    for (const id of this.tracked) {
      const lot = this.lots.get(id);
      const occupancy = this.occupancyOf(lot, time);
      const occupied = Math.round(occupancy * lot.capacity);
      const record = {
        timestamp,
        weekday: WEEKDAYS[d.getUTCDay()],
        parking_id: lot.id,
        parking_name: lot.name,
        capacity: lot.capacity,
        occupied,
        free: lot.capacity - occupied,
        occupancy_pct: Math.round(occupancy * 1000) / 10,
      };
      this.records.push(record);
      this.pending.push(record);
    }
    if (this.records.length > MAX_RECORDS) this.records.splice(0, this.records.length - MAX_RECORDS);
    if (this.pending.length > MAX_RECORDS) this.pending.splice(0, this.pending.length - MAX_RECORDS);
  }

  save() {
    try {
      this.storage?.setItem(CONFIG.parkingTracking.storageKey, JSON.stringify({ version: 1, tracked: [...this.tracked] }));
    } catch {
      /* almacenamiento no disponible: la selección no se conserva */
    }
  }

  load() {
    try {
      const raw = this.storage?.getItem(CONFIG.parkingTracking.storageKey);
      const list = raw ? JSON.parse(raw)?.tracked : null;
      if (Array.isArray(list)) this.tracked = new Set(list.filter((id) => this.lots.has(id)));
    } catch {
      /* datos corruptos: se ignoran */
    }
    this.emit();
  }

  serialize() {
    return { tracked: [...this.tracked], intervalSeconds: this.intervalSeconds, nextSample: this.nextSample };
  }

  restore(state) {
    this.tracked = new Set(state.tracked.filter((id) => this.lots.has(id)));
    this.intervalSeconds = state.intervalSeconds;
    this.nextSample = state.nextSample;
    this.emit();
  }

  recordsCsv() {
    const lines = [COLUMNS.join(',')];
    for (const r of this.records) lines.push(COLUMNS.map((c) => csvSafe(r[c] ?? '')).join(','));
    return lines.join('\n');
  }
}
