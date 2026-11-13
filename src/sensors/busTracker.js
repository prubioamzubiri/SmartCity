import { CONFIG } from '../config.js';
import { simDate } from '../traffic/demand.js';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MAX_RECORDS = 200000;
export const BUS_COLUMNS = ['timestamp', 'weekday', 'line_id', 'stops', 'buses', 'passengers', 'capacity', 'occupancy_pct', 'full_buses', 'waiting', 'left_behind'];

// Registra periódicamente qué ocurre en las líneas de autobús elegidas: autobuses en servicio, pasajeros a bordo,
// ocupación, autobuses llenos y gente esperando en las paradas. `lines`: [{ id, stops: [...] }];
// `statsAt(time)` devuelve, por línea y en ese instante simulado, { active, passengers, full, waiting }.
export class BusTracker {
  constructor({ lines, statsAt, getSimTime, capacity = CONFIG.transit.capacity }) {
    this.lines = new Map(lines.map((l, i) => [l.id, { index: i, stops: l.stops.length }]));
    this.statsAt = statsAt;
    this.capacity = capacity;
    this.tracked = new Set();
    this.pending = [];
    this.listeners = new Set();
    this.intervalSeconds = CONFIG.busTracking.intervalSeconds;
    this.nextSample = Math.ceil(getSimTime() / this.intervalSeconds) * this.intervalSeconds;
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
    if (!this.lines.has(id) || this.tracked.has(id) === on) return;
    if (on) this.tracked.add(id);
    else this.tracked.delete(id);
    this.emit();
  }

  setAll(on) {
    this.tracked = on ? new Set(this.lines.keys()) : new Set();
    this.emit();
  }

  // Toma una muestra en cada límite de intervalo alcanzado por el reloj simulado.
  tick(simTime) {
    while (simTime >= this.nextSample) {
      if (this.tracked.size) this.sample(this.nextSample);
      this.nextSample += this.intervalSeconds;
    }
  }

  sample(time) {
    const d = simDate(time);
    const timestamp = d.toISOString().slice(0, 19);
    const stats = this.statsAt(time);
    for (const [id, { index, stops }] of this.lines) {
      if (!this.tracked.has(id)) continue;
      const s = stats[index];
      const capacity = s.active * this.capacity;
      this.pending.push({
        timestamp,
        weekday: WEEKDAYS[d.getUTCDay()],
        line_id: id,
        stops,
        buses: s.active,
        passengers: s.passengers,
        capacity,
        occupancy_pct: capacity ? Math.round((s.passengers / capacity) * 1000) / 10 : 0,
        full_buses: s.full,
        waiting: s.waiting,
        left_behind: s.leftBehind ?? 0,
      });
    }
    if (this.pending.length > MAX_RECORDS) this.pending.splice(0, this.pending.length - MAX_RECORDS);
  }

  serialize() {
    return { tracked: [...this.tracked], nextSample: this.nextSample };
  }

  restore(state) {
    this.tracked = new Set(state.tracked.filter((id) => this.lines.has(id)));
    this.nextSample = state.nextSample;
    this.emit();
  }
}
