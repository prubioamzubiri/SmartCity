import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { CONFIG } from '../src/config.js';
import { SimEngine } from '../src/core/engine.js';
import { Store } from '../server/store.js';
import { Runtime } from '../server/runtime.js';
import { createApp } from '../server/app.js';
import { ApiClient } from '../src/api/client.js';
import { poisson, PEDESTRIAN_COLUMNS } from '../src/sensors/pedestrianSensors.js';
import { demandFactor } from '../src/traffic/demand.js';
import { pedestrianDensity } from '../src/pedestrians/pedestrians.js';

// Anillo cuadrado de 500 m (calles residenciales, dos sentidos); el paso de peatones está cerca del sensor de (0, -250).
const city = ({ crossings = [10, -250, 0, 1, 4] } = {}) => ({
  nodes: [-250, -250, 250, -250, 250, 250, -250, 250],
  ways: [[4, 0, 0, 1, 2, 3, 0]],
  signals: [],
  parking: { underground: [] },
  crossings,
});

const HOUR = 3600;

test('poisson samples are deterministic and have the requested mean', () => {
  assert.equal(poisson(7, 123), poisson(7, 123));
  assert.equal(poisson(0, 1), 0);
  assert.equal(poisson(-3, 1), 0);
  for (const lambda of [0.5, 4, 25, 200]) {
    let sum = 0;
    const n = 4000;
    for (let seed = 1; seed <= n; seed++) sum += poisson(lambda, seed * 7919);
    assert.ok(Math.abs(sum / n - lambda) < Math.max(0.1, lambda * 0.05), `media ${sum / n} para λ=${lambda}`);
  }
});

test('the flow model matches the pedestrians that the agents produce', () => {
  const engine = new SimEngine({ data: city({ crossings: [] }) });
  const { pedestrians, pedSensors } = engine;
  const s = pedSensors.add(0, -250);
  assert.equal(s.edges.length, 2, 'los dos sentidos de la calle');
  const t = 3 * 86400 + 8 * HOUR; // laborable, hora punta
  const density = pedestrianDensity(demandFactor(t, 'weekday'));

  // Peatones dentro del radio del sensor, promediados a lo largo de muchos paseos distintos.
  let sum = 0;
  let samples = 0;
  for (let ms = 0; ms < 8 * 3600 * 1000; ms += 97_000) {
    pedestrians.update(ms, density);
    for (let i = 0; i < pedestrians.activeCount; i++) {
      if (Math.abs(pedestrians.x[i] - s.x) <= CONFIG.pedestrianSensors.radius && Math.abs(pedestrians.z[i] - s.z) <= 10) sum++;
    }
    samples++;
  }
  const expected = pedSensors.expected(s, t, 'weekday', pedestrians.max).present;
  assert.ok(expected > 50, `esperados ${expected}`);
  assert.ok(Math.abs(sum / samples - expected) / expected < 0.1, `agentes ${(sum / samples).toFixed(1)} frente a ${expected.toFixed(1)} esperados`);
});

test('pedestrian flow follows the demand, the maximum and the crossings', () => {
  const engine = new SimEngine({ data: city() });
  const s = engine.pedSensors.add(0, -250);
  assert.equal(s.crossings.length, 1);
  const peak = engine.pedSensors.expected(s, 3 * 86400 + 8 * HOUR, 'weekday', 12000);
  const night = engine.pedSensors.expected(s, 3 * 86400 + 3 * HOUR, 'weekday', 12000);
  assert.ok(peak.walk > night.walk * 3 && peak.cross > night.cross * 3);
  const half = engine.pedSensors.expected(s, 3 * 86400 + 8 * HOUR, 'weekday', 6000);
  assert.ok(Math.abs(half.walk * 2 - peak.walk) < 1e-6);
  const none = engine.pedSensors.expected(s, 3 * 86400 + 8 * HOUR, 'weekday', 0);
  assert.deepEqual(none, { walk: 0, cross: 0, present: 0 });

  // Sin pasos de peatones todos caminan; en una autovía no hay acera.
  const noCrossings = new SimEngine({ data: city({ crossings: [] }) });
  const a = noCrossings.pedSensors.add(0, -250);
  assert.equal(noCrossings.pedSensors.expected(a, 3 * 86400 + 8 * HOUR, 'weekday', 12000).cross, 0);
  const motorway = new SimEngine({ data: { ...city(), ways: [[0, 0, 0, 1, 2, 3, 0]] } });
  const m = motorway.pedSensors.add(0, -250);
  assert.deepEqual(m.edges, []);
  assert.equal(motorway.pedSensors.expected(m, 3 * 86400 + 8 * HOUR, 'weekday', 12000).walk, 0);
});

test('sensor records add up to the expected flow and have the CSV columns', () => {
  const engine = new SimEngine({ data: city(), maxCars: 5 });
  const s = engine.pedSensors.add(0, -250, 'Plaza');
  const start = engine.simTime;
  engine.advanceTo(start + 12 * HOUR);
  const { pedestrians } = engine.drainRecords();
  assert.equal(pedestrians.length, 12 * 12, 'un registro cada 5 min simulados');
  assert.deepEqual(Object.keys(pedestrians[0]), PEDESTRIAN_COLUMNS);
  assert.equal(pedestrians[0].sensor_name, 'Plaza');
  assert.ok(pedestrians.every((r) => r.count === r.count_walk + r.count_cross && r.present >= 0));
  assert.equal(s.total, pedestrians.reduce((n, r) => n + r.count, 0));

  let expected = 0;
  for (let t = start; t < start + 12 * HOUR; t += 300) expected += (({ walk, cross }) => walk + cross)(engine.pedSensors.expected(s, t + 150, 'auto', 12000));
  assert.ok(Math.abs(s.total - expected) / expected < 0.03, `${s.total} registrados frente a ${expected.toFixed(0)} esperados`);

  // Por la noche pasa mucha menos gente que a la hora punta.
  const hourly = (h) => pedestrians.filter((r) => r.timestamp.slice(11, 13) === String(h).padStart(2, '0')).reduce((n, r) => n + r.count, 0);
  assert.ok(hourly(8) > hourly(3) * 2, `${hourly(8)} a las 8 frente a ${hourly(3)} a las 3`);
});

test('a restored engine records exactly the same pedestrian data', () => {
  const a = new SimEngine({ data: city(), maxCars: 5 });
  a.pedSensors.add(0, -250, 'Norte');
  a.advanceTo(a.simTime + 3 * HOUR);
  const snapshot = JSON.parse(JSON.stringify(a.snapshot()));
  a.drainRecords();
  a.advanceTo(a.simTime + 3 * HOUR);

  const b = new SimEngine({ data: city(), maxCars: 5 });
  assert.equal(b.restore(snapshot), true);
  b.advanceTo(a.simTime);
  const expected = a.drainRecords().pedestrians;
  assert.ok(expected.length > 30);
  assert.deepEqual(b.drainRecords().pedestrians, expected);
  assert.equal(b.pedSensors.sensors[0].total, a.pedSensors.sensors[0].total);
});

test('a snapshot from before the pedestrian sensors still restores', () => {
  const a = new SimEngine({ data: city(), maxCars: 5 });
  a.advanceTo(a.simTime + 1800);
  const snapshot = JSON.parse(JSON.stringify(a.snapshot()));
  delete snapshot.pedSensors;
  delete snapshot.params.maxPedestrians;
  const b = new SimEngine({ data: city(), maxCars: 5 });
  assert.equal(b.restore(snapshot), true);
  assert.equal(b.params.maxPedestrians, CONFIG.pedestrians.max);
  assert.deepEqual(b.pedSensors.sensors, []);
  assert.equal(b.pedSensors.bucketStart % 300, 0);
  b.advanceTo(b.simTime + 900);
  assert.ok(b.pedSensors.bucketStart > snapshot.simTime - 300);
});

test('the pedestrian maximum is a server parameter', () => {
  const engine = new SimEngine({ data: city() });
  engine.setParams({ maxPedestrians: 3000.4 });
  assert.equal(engine.params.maxPedestrians, 3000);
  engine.setParams({ maxPedestrians: 1e9 });
  assert.equal(engine.params.maxPedestrians, CONFIG.pedestrians.max);
  engine.setParams({ maxPedestrians: -5 });
  assert.equal(engine.params.maxPedestrians, 0);
  engine.pedestrianPositions();
  assert.equal(engine.pedestrians.activeCount, 0);
});

function clock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

const CHUNK = 10 * 60 * 1000;

function run(runtime, now, ms) {
  now.advance(ms);
  while (!runtime.tick()) { /* recuperación por tramos */ }
  runtime.checkpoint();
}

async function serve(t, { store = new Store(), now = clock(), token = 'secreto' } = {}) {
  const runtime = new Runtime({ engine: new SimEngine({ data: city(), maxCars: 5 }), store, now, checkpointMs: 1e9 });
  const server = http.createServer(createApp({ runtime, store, token }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { runtime, store, now, baseUrl, api: new ApiClient({ baseUrl, token }), call: (path, init) => fetch(baseUrl + path, init) };
}

test('API creates, renames, deletes and exports pedestrian sensors', async (t) => {
  const { api, call, baseUrl, runtime, now } = await serve(t);
  const anonymous = new ApiClient({ baseUrl });
  await assert.rejects(() => anonymous.addPedestrianSensor(0, -250), /Token/);
  await assert.rejects(() => api.addPedestrianSensor(9999, 9999), /calle/);
  await assert.rejects(() => api.addPedestrianSensor('a', 0), /número/);

  const created = await api.addPedestrianSensor(0, -250, 'Plaza');
  assert.match(created.id, /^P\d+$/);
  run(runtime, now, 3 * CHUNK);

  const state = await api.state();
  assert.equal(state.pedestrianSensors.length, 1);
  assert.equal(state.pedestrianSensors[0].name, 'Plaza');
  assert.ok(state.pedestrianSensors[0].total > 0 && state.pedestrianSensors[0].current > 0);
  assert.ok(state.pedestrians.expected > 0);
  assert.ok(state.records.pedestrians > 0);
  assert.equal(state.params.maxPedestrians, CONFIG.pedestrians.max);

  const text = await (await call('/api/pedestrians.csv')).text();
  const lines = text.trim().split('\n');
  assert.equal(lines[0], PEDESTRIAN_COLUMNS.join(','));
  assert.equal(lines.length - 1, state.records.pedestrians);
  assert.ok(lines[1].includes(`${created.id},Plaza`));
  assert.equal((await (await call(`/api/pedestrians.csv?id=${created.id}`)).text()).trim().split('\n').length, lines.length);
  assert.equal((await (await call('/api/pedestrians.csv?id=P99')).text()).trim().split('\n').length, 1);
  assert.equal((await call('/api/pedestrians.csv?from=ayer')).status, 400);
  assert.equal(api.csvUrl('pedestrians', { id: created.id }), `${baseUrl}/api/pedestrians.csv?id=${created.id}`);

  // Los sensores de tráfico y los de peatones tienen identificadores y tablas independientes.
  const traffic = await (await call('/api/traffic.csv')).text();
  assert.equal(traffic.trim().split('\n').length, 1);

  await api.renamePedestrianSensor(created.id, '=SUMA(A1)');
  run(runtime, now, CHUNK / 5);
  assert.ok((await (await call('/api/pedestrians.csv')).text()).includes("'=SUMA(A1)"));
  await api.removePedestrianSensor(created.id);
  await assert.rejects(() => api.removePedestrianSensor(created.id), /no encontrado/);
  assert.equal((await api.state()).pedestrianSensors.length, 0);
  assert.ok((await api.state()).records.pedestrians > 0, 'el histórico se conserva');
});

test('API changes the pedestrian maximum and rejects bad values', async (t) => {
  const { api, runtime, now } = await serve(t);
  await assert.rejects(() => api.setParams({ maxPedestrians: 'muchos' }), /número/);
  assert.equal((await api.setParams({ maxPedestrians: 4000 })).maxPedestrians, 4000);
  const created = await api.addPedestrianSensor(0, -250);
  const before = (await api.state()).pedestrianSensors[0].total;
  await api.setParams({ maxPedestrians: 0 });
  run(runtime, now, 2 * CHUNK);
  const state = await api.state();
  assert.equal(state.pedestrianSensors[0].total, before, 'sin peatones no se cuenta a nadie');
  assert.equal(state.pedestrians.expected, 0);
  assert.equal(created.id, state.pedestrianSensors[0].id);
  const positions = await api.pedestrians();
  assert.equal(positions.activeCount, 0);
});

test('stopping the server and catching up later yields the same pedestrian data', async (t) => {
  const nowA = clock();
  const continuous = await serve(t, { nowA, now: nowA });
  await continuous.api.addPedestrianSensor(0, -250, 'Norte');
  run(continuous.runtime, nowA, 3 * CHUNK);

  const nowB = clock();
  const store = new Store();
  const first = await serve(t, { store, now: nowB });
  await first.api.addPedestrianSensor(0, -250, 'Norte');
  run(first.runtime, nowB, CHUNK);
  // Reinicio del proceso: nuevo motor y nuevo runtime sobre la misma base de datos.
  const second = await serve(t, { store, now: nowB });
  run(second.runtime, nowB, 2 * CHUNK);

  const rows = (s) => [...s.iterate('pedestrians')].map((r) => JSON.stringify(r));
  assert.ok(continuous.store.count('pedestrians') > 50);
  assert.deepEqual(rows(store), rows(continuous.store));
  assert.equal(second.runtime.engine.pedSensors.sensors[0].name, 'Norte');
});
