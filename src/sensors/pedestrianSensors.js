import { CONFIG } from '../config.js';
import { createRng } from '../core/random.js';
import { simDate } from '../traffic/demand.js';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MAX_RECORDS = 200000;
export const PEDESTRIAN_COLUMNS = ['timestamp', 'weekday', 'sensor_id', 'sensor_name', 'x', 'z', 'count', 'count_walk', 'count_cross', 'present'];

const hash = (text) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
};

// Muestra de una Poisson de media `lambda`, con una semilla propia: el mismo sensor y el mismo intervalo dan siempre el mismo
// valor, así que tras una parada y una recuperación los registros salen idénticos.
export function poisson(lambda, seed) {
  if (!(lambda > 0)) return 0;
  const rng = createRng(seed);
  if (lambda > 30) {
    const gauss = Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gauss));
  }
  const limit = Math.exp(-lambda);
  let k = 0;
  for (let p = rng(); p > limit; p *= rng()) k++;
  return k;
}

// Sensores de peatones: cuentan, por intervalo simulado, los peatones que pasan por la acera de la calle donde están
// (en los dos sentidos) y los que cruzan por los pasos de peatones a menos de `radius`, y los presentes en esa zona.
// Se calculan con el modelo de flujo de `Pedestrians`, no con agentes: así el coste no depende de cuántos peatones haya.
export class PedestrianSensors {
  constructor({ graph, pedestrians, getSimTime, getParams }) {
    this.graph = graph;
    this.pedestrians = pedestrians;
    this.getParams = getParams;
    this.sensors = [];
    this.records = [];
    this.pending = [];
    this.nextId = 1;
    this.bucketSeconds = CONFIG.pedestrianSensors.bucketSeconds;
    this.bucketStart = Math.floor(getSimTime() / this.bucketSeconds) * this.bucketSeconds;
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  emit() {
    this.listeners.forEach((fn) => fn());
  }

  add(x, z, name = '', { id, total = 0 } = {}) {
    const g = this.graph;
    const hit = g.nearestSegment(x, z);
    if (!hit) return null;
    const { radius } = CONFIG.pedestrianSensors;
    // Tramos de la calle con acera (no autovía), en los dos sentidos.
    const edges = [hit.e, g.rev[hit.e]].filter((e) => e >= 0 && g.cls[e] !== 0);
    const c = this.pedestrians.crossings;
    const crossings = [];
    for (let j = 0; j < this.pedestrians.count * 5; j += 5) {
      if (Math.hypot(c[j] - hit.x, c[j + 1] - hit.z) <= radius) crossings.push(j);
    }
    const sensor = { id: id ?? `P${this.nextId++}`, name: name || '', x: hit.x, z: hit.z, edges, crossings, total };
    if (!sensor.name) sensor.name = `Peatones ${sensor.id.slice(1)}`;
    this.sensors.push(sensor);
    this.emit();
    return sensor;
  }

  remove(id) {
    const i = this.sensors.findIndex((s) => s.id === id);
    if (i < 0) return;
    this.sensors.splice(i, 1);
    this.emit();
  }

  rename(id, name) {
    const s = this.sensors.find((x) => x.id === id);
    if (s) s.name = name.slice(0, 60);
  }

  // Valores esperados del sensor `s` en una hora simulada: pasan por intervalo y hay presentes.
  expected(s, simSeconds, scenario, limit, bucketSeconds = this.bucketSeconds) {
    const P = CONFIG.pedestrians;
    const flow = this.pedestrians.flowAt(simSeconds, scenario, limit);
    const radius = CONFIG.pedestrianSensors.radius;
    const walk = flow.walkPerMetre * P.speed * bucketSeconds * s.edges.length;
    const cross = s.crossings.length * flow.crossPerCrossing * (bucketSeconds / P.slotSeconds);
    const presentWalk = flow.walkPerMetre * 2 * radius * s.edges.length;
    let presentCross = 0;
    for (const j of s.crossings) presentCross += (flow.crossPerCrossing / P.slotSeconds) * this.pedestrians.crossSeconds(j);
    return { walk, cross, present: presentWalk + presentCross };
  }

  // Peatones presentes ahora cerca del sensor (valor esperado), para mostrarlo en el visor.
  presentNow(s, simSeconds) {
    const { scenario, maxPedestrians } = this.getParams();
    return this.expected(s, simSeconds, scenario, maxPedestrians).present;
  }

  tick(simTime) {
    while (simTime >= this.bucketStart + this.bucketSeconds) {
      this.closeBucket();
      this.bucketStart += this.bucketSeconds;
    }
  }

  closeBucket() {
    const d = simDate(this.bucketStart);
    const timestamp = d.toISOString().slice(0, 19);
    const { scenario, maxPedestrians } = this.getParams();
    const middle = this.bucketStart + this.bucketSeconds / 2;
    for (const s of this.sensors) {
      const e = this.expected(s, middle, scenario, maxPedestrians);
      const seed = (salt) => hash(`${s.id}|${this.bucketStart}|${salt}`);
      const walk = poisson(e.walk, seed('walk'));
      const cross = poisson(e.cross, seed('cross'));
      s.total += walk + cross;
      const record = {
        timestamp,
        weekday: WEEKDAYS[d.getUTCDay()],
        sensor_id: s.id,
        sensor_name: s.name,
        x: Math.round(s.x),
        z: Math.round(s.z),
        count: walk + cross,
        count_walk: walk,
        count_cross: cross,
        present: poisson(e.present, seed('present')),
      };
      this.records.push(record);
      this.pending.push(record);
    }
    if (this.records.length > MAX_RECORDS) this.records.splice(0, this.records.length - MAX_RECORDS);
    this.emit();
  }

  serialize() {
    return {
      nextId: this.nextId,
      bucketSeconds: this.bucketSeconds,
      bucketStart: this.bucketStart,
      sensors: this.sensors.map((s) => ({ id: s.id, name: s.name, x: s.x, z: s.z, total: s.total })),
    };
  }

  // `state` puede faltar (instantánea de una versión anterior): sin sensores y con el intervalo alineado a la hora actual.
  restore(state, simTime) {
    this.sensors = [];
    this.bucketSeconds = state?.bucketSeconds ?? CONFIG.pedestrianSensors.bucketSeconds;
    this.bucketStart = state?.bucketStart ?? Math.floor(simTime / this.bucketSeconds) * this.bucketSeconds;
    for (const s of state?.sensors ?? []) this.add(s.x, s.z, s.name, { id: s.id, total: s.total });
    this.nextId = state?.nextId ?? 1;
    this.emit();
  }
}
