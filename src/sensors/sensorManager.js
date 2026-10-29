import { CONFIG } from '../config.js';
import { simDate } from '../traffic/demand.js';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const csvSafe = (v) => {
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export class SensorManager {
  constructor({ graph, sim, getSimTime, view = null, storage = globalThis.localStorage }) {
    this.view = view;
    this.storage = storage;
    this.graph = graph;
    this.sim = sim;
    this.getSimTime = getSimTime;
    this.sensors = [];
    this.records = [];
    this.pending = [];
    this.selectedId = null;
    this.bucketSeconds = CONFIG.sensors.bucketSeconds;
    this.bucketStart = Math.floor(getSimTime() / this.bucketSeconds) * this.bucketSeconds;
    this.nextId = 1;
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  emit() {
    this.listeners.forEach((fn) => fn());
  }

  snap(x, z) {
    return this.graph.nearestSegment(x, z);
  }

  showGhost(x, z, visible) {
    this.view?.showGhost(x, z, visible);
  }

  add(x, z, name, { id, bucket, total, defer = false } = {}) {
    const hit = this.snap(x, z);
    if (!hit) return null;
    const g = this.graph;
    const sensor = {
      id: id ?? `S${this.nextId++}`,
      name: name || '',
      x: hit.x,
      z: hit.z,
      fwd: hit.e,
      bwd: g.rev[hit.e],
      sFwd: hit.t * g.len[hit.e],
      sBwd: g.rev[hit.e] >= 0 ? (1 - hit.t) * g.len[g.rev[hit.e]] : 0,
      bucket: bucket ?? { fwd: 0, bwd: 0, speedSum: 0 },
      total: total ?? 0,
    };
    if (!sensor.name) sensor.name = `Sensor ${sensor.id.slice(1)}`;
    this.view?.add(sensor);
    this.sensors.push(sensor);
    if (!defer) this.refresh();
    return sensor;
  }

  // Estado de configuración y del intervalo en curso (los registros cerrados se persisten aparte).
  serialize() {
    return {
      nextId: this.nextId,
      bucketSeconds: this.bucketSeconds,
      bucketStart: this.bucketStart,
      sensors: this.sensors.map((s) => ({ id: s.id, name: s.name, x: s.x, z: s.z, bucket: s.bucket, total: s.total })),
    };
  }

  restore(state) {
    for (const s of [...this.sensors]) this.remove(s.id);
    this.bucketSeconds = state.bucketSeconds;
    this.bucketStart = state.bucketStart;
    for (const s of state.sensors) this.add(s.x, s.z, s.name, { id: s.id, bucket: s.bucket, total: s.total, defer: true });
    this.nextId = state.nextId;
    this.refresh();
  }

  remove(id) {
    const i = this.sensors.findIndex((s) => s.id === id);
    if (i < 0) return;
    const [s] = this.sensors.splice(i, 1);
    this.view?.remove(s.id);
    if (this.selectedId === id) this.selectedId = null;
    this.refresh();
  }

  rename(id, name) {
    const s = this.sensors.find((x) => x.id === id);
    if (s) {
      s.name = name.slice(0, 60);
      this.save();
    }
  }

  select(id) {
    this.selectedId = id;
    this.view?.select(id);
  }

  pick(raycaster) {
    return this.view?.pick(raycaster) ?? null;
  }

  refresh() {
    const index = new Map();
    const push = (e, entry) => {
      if (e < 0) return;
      if (!index.has(e)) index.set(e, []);
      index.get(e).push(entry);
    };
    for (const s of this.sensors) {
      push(s.fwd, { sensor: s, s: s.sFwd, dir: 'fwd' });
      push(s.bwd, { sensor: s, s: s.sBwd, dir: 'bwd' });
    }
    this.sim.setSensorIndex(index);
    this.save();
    this.emit();
  }

  recordCrossing(sensor, dir, speed) {
    sensor.bucket[dir]++;
    sensor.bucket.speedSum += speed;
    sensor.total++;
  }

  setBucketSeconds(sec) {
    this.bucketSeconds = sec;
    this.bucketStart = Math.floor(this.getSimTime() / sec) * sec;
    for (const s of this.sensors) s.bucket = { fwd: 0, bwd: 0, speedSum: 0 };
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
    for (const s of this.sensors) {
      const count = s.bucket.fwd + s.bucket.bwd;
      const record = {
        timestamp,
        weekday: WEEKDAYS[d.getUTCDay()],
        sensor_id: s.id,
        sensor_name: s.name,
        x: Math.round(s.x),
        z: Math.round(s.z),
        count,
        count_fwd: s.bucket.fwd,
        count_bwd: s.bucket.bwd,
        avg_speed_kmh: count ? Math.round((s.bucket.speedSum / count) * 3.6 * 10) / 10 : null,
      };
      this.records.push(record);
      this.pending.push(record);
      s.bucket = { fwd: 0, bwd: 0, speedSum: 0 };
    }
    if (this.records.length > 200000) this.records.splice(0, this.records.length - 200000);
    this.emit();
  }

  currentCount(s) {
    return s.bucket.fwd + s.bucket.bwd;
  }

  save() {
    const data = this.sensors.map((s) => ({ name: s.name, x: Math.round(s.x * 10) / 10, z: Math.round(s.z * 10) / 10 }));
    this.storage?.setItem(CONFIG.sensors.storageKey, JSON.stringify({ version: 1, sensors: data }));
  }

  load() {
    try {
      const raw = this.storage?.getItem(CONFIG.sensors.storageKey);
      if (raw) this.importJson(JSON.parse(raw));
    } catch {
      /* datos corruptos: se ignoran */
    }
  }

  importJson(json) {
    const list = Array.isArray(json?.sensors) ? json.sensors : [];
    for (const item of list) {
      if (Number.isFinite(item?.x) && Number.isFinite(item?.z)) {
        this.add(item.x, item.z, typeof item.name === 'string' ? item.name.slice(0, 60) : '');
      }
    }
  }

  sensorsJson() {
    return JSON.stringify({ version: 1, sensors: this.sensors.map((s) => ({ name: s.name, x: s.x, z: s.z })) }, null, 2);
  }

  recordsCsv() {
    const cols = ['timestamp', 'weekday', 'sensor_id', 'sensor_name', 'x', 'z', 'count', 'count_fwd', 'count_bwd', 'avg_speed_kmh'];
    const lines = [cols.join(',')];
    for (const r of this.records) lines.push(cols.map((c) => csvSafe(r[c] ?? '')).join(','));
    return lines.join('\n');
  }
}
