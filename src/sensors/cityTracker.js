import { CONFIG } from '../config.js';
import { simDate } from '../traffic/demand.js';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MAX_RECORDS = 200000;
export const CITY_COLUMNS = [
  'timestamp', 'weekday', 'cars', 'stopped', 'avg_speed_kmh', 'buses', 'bus_passengers', 'full_buses', 'bus_waiting',
  'suspended_lines', 'bikes_in_use', 'stations_empty', 'stations_full', 'parkings_full', 'closed_m', 'bus_only_m',
  'limited_m', 'signals_all_red',
];

// Indicadores globales de la ciudad cada `intervalSeconds` simulados, siempre activos (no hay que elegir nada).
// `sample(time)` devuelve la fila sin `timestamp` ni `weekday`. Como la simulación es determinista, dos ciudades con
// la misma historia graban exactamente las mismas filas.
export class CityTracker {
  constructor({ sample, getSimTime, intervalSeconds = CONFIG.cityTracking.intervalSeconds }) {
    this.sampleAt = sample;
    this.intervalSeconds = intervalSeconds;
    this.pending = [];
    this.nextSample = Math.ceil(getSimTime() / intervalSeconds) * intervalSeconds;
  }

  tick(simTime) {
    while (simTime >= this.nextSample) {
      const d = simDate(this.nextSample);
      this.pending.push({ timestamp: d.toISOString().slice(0, 19), weekday: WEEKDAYS[d.getUTCDay()], ...this.sampleAt(this.nextSample) });
      this.nextSample += this.intervalSeconds;
    }
    if (this.pending.length > MAX_RECORDS) this.pending.splice(0, this.pending.length - MAX_RECORDS);
  }

  serialize() {
    return { nextSample: this.nextSample };
  }

  restore(state) {
    if (Number.isFinite(state?.nextSample)) this.nextSample = state.nextSample;
  }
}
