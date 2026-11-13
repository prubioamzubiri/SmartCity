import { CONFIG } from '../config.js';
import { simDate } from '../traffic/demand.js';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MAX_RECORDS = 200000;
export const CITY_COLUMNS = [
  'timestamp', 'weekday', 'cars', 'stopped', 'avg_speed_kmh', 'buses', 'bus_passengers', 'full_buses', 'bus_waiting',
  'suspended_lines', 'bikes_in_use', 'stations_empty', 'stations_full', 'parkings_full', 'closed_m', 'bus_only_m',
  'limited_m', 'signals_all_red', 'trips_done', 'trip_min', 'delay_min', 'trips_lost', 'bus_unserved', 'bus_demand', 'ped_wait_s', 'ped_waiting', 'ped_space',
];

// Indicadores globales de la ciudad cada `intervalSeconds` simulados, siempre activos (no hay que elegir nada).
// `sample(time)` devuelve la fila sin `timestamp` ni `weekday`. Como la simulación es determinista, dos ciudades con
// la misma historia graban exactamente las mismas filas.
export class CityTracker {
  constructor({ sample, getSimTime, intervalSeconds = CONFIG.cityTracking.intervalSeconds }) {
    this.sampleAt = sample;
    this.intervalSeconds = intervalSeconds;
    this.pending = [];
    this.prevTrips = null; // acumulados de viajes en la fila anterior (cada fila lleva lo de su intervalo)
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

  // Viajes del intervalo a partir de los acumulados de la simulación.
  tripsSince(totals) {
    const prev = this.prevTrips ?? totals;
    const done = totals.done - prev.done;
    const row = {
      trips_done: done,
      trip_min: done ? Math.round(((totals.seconds - prev.seconds) / done / 60) * 10) / 10 : 0,
      delay_min: done ? Math.round(((totals.delay - prev.delay) / done / 60) * 10) / 10 : 0,
      trips_lost: totals.lost - prev.lost,
    };
    this.prevTrips = { ...totals };
    return row;
  }

  serialize() {
    return { nextSample: this.nextSample, prevTrips: this.prevTrips };
  }

  restore(state) {
    if (Number.isFinite(state?.nextSample)) this.nextSample = state.nextSample;
    this.prevTrips = state?.prevTrips ?? null;
  }
}
