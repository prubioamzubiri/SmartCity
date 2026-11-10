import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { SimEngine } from '../src/core/engine.js';
import { Store } from '../server/store.js';
import { Runtime, DEFAULT_SCALE } from '../server/runtime.js';
import { createApp } from '../server/app.js';

// Anillo cuadrado de 500 m centrado en el origen con circulación en ambos sentidos.
const city = () => ({
  nodes: [-250, -250, 250, -250, 250, 250, -250, 250],
  ways: [[4, 0, 0, 1, 2, 3, 0]],
  signals: [],
  parking: { underground: [[100, 100, 200, 1, 'Parking Test'], [300, 300, 0, 0, '']] },
});

const HOUR = 3600 * 1000;
const CHUNK = 10 * 60 * 1000; // 10 min reales ≈ 8,7 h simuladas

function clock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

function setup(store, now, { sensors = true } = {}) {
  const runtime = new Runtime({ engine: new SimEngine({ data: city(), maxCars: 80 }), store, now, checkpointMs: 1e9 });
  if (sensors && !runtime.engine.sensors.sensors.length) {
    runtime.mutate((e) => {
      e.sensors.add(0, -250, 'Norte');
      e.parking.setAll(true);
    });
  }
  return runtime;
}

function run(runtime, now, ms) {
  now.advance(ms);
  while (!runtime.tick()) { /* recuperación por tramos */ }
  runtime.checkpoint();
}

const csv = (store, kind) => [...store.iterate(kind)].map((r) => JSON.stringify(r));

test('a restored engine continues exactly like the original', () => {
  const a = new SimEngine({ data: city(), maxCars: 80 });
  a.sensors.add(0, -250);
  a.advanceTo(a.simTime + 1800);
  const snapshot = JSON.parse(JSON.stringify(a.snapshot()));
  a.drainRecords();
  a.advanceTo(a.simTime + 1800);

  const b = new SimEngine({ data: city(), maxCars: 80 });
  assert.equal(b.restore(snapshot), true);
  b.advanceTo(a.simTime);

  assert.deepEqual(b.drainRecords(), a.drainRecords());
  assert.deepEqual(b.sim.serialize(), a.sim.serialize());
  assert.ok(a.sensors.sensors[0].total > 0, 'cars must cross the sensor');
});

test('incompatible city data restores configuration but restarts the cars', () => {
  const a = new SimEngine({ data: city(), maxCars: 80 });
  a.sensors.add(0, -250, 'Norte');
  a.advanceTo(a.simTime + 600);
  const snapshot = JSON.parse(JSON.stringify(a.snapshot()));
  snapshot.graphKey = 'otra-ciudad';
  const b = new SimEngine({ data: city(), maxCars: 80 });
  assert.equal(b.restore(snapshot), false);
  assert.equal(b.sensors.sensors[0].name, 'Norte');
  assert.equal(b.sim.activeCount, 0);
});

test('stopping the server and catching up later yields the same data as running continuously', () => {
  const nowA = clock();
  const continuous = new Store();
  const a = setup(continuous, nowA);
  run(a, nowA, 3 * CHUNK);

  const nowB = clock();
  const restarted = new Store();
  let b = setup(restarted, nowB);
  run(b, nowB, 1 * CHUNK);
  b.checkpoint();
  // Reinicio del proceso: nuevo motor y nuevo runtime sobre la misma base de datos, 2 h después.
  b = setup(restarted, nowB);
  run(b, nowB, 2 * CHUNK);

  assert.ok(continuous.count('traffic') > 100);
  assert.ok(continuous.count('parking') > 100);
  assert.deepEqual(csv(restarted, 'traffic'), csv(continuous, 'traffic'));
  assert.deepEqual(csv(restarted, 'parking'), csv(continuous, 'parking'));
  // El histórico global se graba siempre y es idéntico: es lo que usa el panel del profesor para comparar ciudades.
  assert.ok(continuous.count('city') > 50);
  assert.deepEqual(csv(restarted, 'city'), csv(continuous, 'city'));
});

test('the city CSV has one row every 5 simulated minutes with the global indicators', async (t) => {
  const { call } = await api(t);
  const res = await call('/api/city.csv');
  assert.equal(res.status, 200);
  const [header, ...lines] = (await res.text()).trim().split('\n');
  assert.equal(header.split(',')[0], 'timestamp');
  assert.ok(header.includes('stopped') && header.includes('bus_waiting') && header.includes('closed_m'));
  assert.ok(lines.length > 10);
  const minutes = lines.slice(0, 3).map((l) => Number(l.slice(14, 16)));
  assert.deepEqual(minutes.map((m) => m % 5), [0, 0, 0]);
  assert.equal(minutes[1] - minutes[0], 5);
});

test('a week of wall time is a year of simulated time', () => {
  const now = clock();
  const runtime = setup(new Store(), now, { sensors: false });
  const start = runtime.simTimeAt(now());
  const year = runtime.simTimeAt(now() + 7 * 24 * HOUR) - start;
  assert.ok(Math.abs(year - 365 * 86400) < 1);
  assert.equal(runtime.scale, DEFAULT_SCALE);
});

test('crash between checkpoints loses nothing: the unsaved period is regenerated', () => {
  const now = clock();
  const store = new Store();
  let r = setup(store, now);
  run(r, now, CHUNK);
  const saved = store.count('traffic');
  now.advance(CHUNK);
  r.tick(); // progreso sin checkpoint que se pierde en el "fallo"
  r = setup(store, now);
  assert.equal(store.count('traffic'), saved);
  run(r, now, 0);

  const nowRef = clock();
  const ref = setup(new Store(), nowRef);
  run(ref, nowRef, 2 * CHUNK);
  assert.equal(store.count('traffic'), ref.store.count('traffic'));
});

async function api(t, { token = 'secreto', lockParams = false } = {}) {
  const now = clock();
  const store = new Store();
  const runtime = setup(store, now, { sensors: false });
  run(runtime, now, 2 * CHUNK);
  const server = http.createServer(createApp({ runtime, store, token, lockParams }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, { method = 'GET', body, auth } = {}) =>
    fetch(base + path, {
      method,
      headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { call, runtime, store, now };
}

test('API requires a token to write and rejects bad input', async (t) => {
  const { call } = await api(t);
  assert.equal((await call('/api/sensors', { method: 'POST', body: { x: 0, z: -250 } })).status, 401);
  assert.equal((await call('/api/sensors', { method: 'POST', body: { x: 0, z: -250 }, auth: 'mal' })).status, 401);
  assert.equal((await call('/api/sensors', { method: 'POST', body: { x: 'a', z: 0 }, auth: 'secreto' })).status, 400);
  assert.equal((await call('/api/sensors', { method: 'POST', body: { x: 9999, z: 9999 }, auth: 'secreto' })).status, 422);
  assert.equal((await call('/api/params', { method: 'PUT', body: { scenario: 'nope' }, auth: 'secreto' })).status, 400);
  assert.equal((await call('/api/traffic.csv?from=ayer')).status, 400);
  assert.equal((await call('/api/nada')).status, 404);
});

test('API is open for writes when no token is configured', async (t) => {
  const { call } = await api(t, { token: '' });
  assert.equal((await call('/api/sensors', { method: 'POST', body: { x: 0, z: -250 } })).status, 201);
  assert.equal((await call('/api/state')).status, 200);
});

test('LOCK_PARAMS blocks changes to the demand parameters', async (t) => {
  const locked = await api(t, { lockParams: true });
  const res = await locked.call('/api/params', { method: 'PUT', body: { maxCars: 10 }, auth: 'secreto' });
  assert.equal(res.status, 403);
  assert.notEqual(locked.runtime.engine.params.maxCars, 10);
  const open = await api(t);
  assert.equal((await open.call('/api/params', { method: 'PUT', body: { maxCars: 10 }, auth: 'secreto' })).status, 200);
});

test('sensors can be placed with lat/lon as well as x/z', async (t) => {
  const { call } = await api(t, { token: '' });
  const { xzToLatLon } = await import('../src/city/projection.js');
  const { lat, lon } = xzToLatLon(0, -250);
  for (const path of ['/api/sensors', '/api/pedestrian-sensors']) {
    const res = await call(path, { method: 'POST', body: { lat, lon, name: 'GPS' } });
    assert.equal(res.status, 201, path);
    assert.equal((await call(path, { method: 'POST', body: { name: 'sin punto' } })).status, 400, path);
  }
});

test('sensors recorded after creation can be exported as CSV by simulated date range', async (t) => {
  const { call, runtime, now } = await api(t);
  const created = await call('/api/sensors', { method: 'POST', body: { x: 0, z: -250, name: 'Entrada' }, auth: 'secreto' });
  assert.equal(created.status, 201);
  const createdAt = (await (await call('/api/state')).json()).simTime;
  const { id } = await created.json();
  assert.equal((await call('/api/parking/tracked', { method: 'PUT', body: { ids: ['U100_100'] }, auth: 'secreto' })).status, 200);

  run(runtime, now, 3 * CHUNK);

  const state = await (await call('/api/state')).json();
  assert.equal(state.sensors.length, 1);
  assert.equal(state.caughtUp, true);
  assert.ok(state.records.traffic > 0 && state.records.parking > 0);

  const all = await (await call('/api/traffic.csv')).text();
  const lines = all.trim().split('\n');
  assert.equal(lines[0], 'timestamp,weekday,sensor_id,sensor_name,x,z,count,count_fwd,count_bwd,avg_speed_kmh');
  assert.equal(lines.length - 1, state.records.traffic);
  assert.ok(lines[1].includes(`${id},Entrada`));

  // Números negativos intactos; textos que parecen fórmulas, neutralizados.
  const negative = await call('/api/sensors', { method: 'POST', body: { x: 0, z: 250, name: '=SUMA(A1)' }, auth: 'secreto' });
  assert.equal(negative.status, 201);
  run(runtime, now, CHUNK / 5);
  const withFormula = await (await call('/api/traffic.csv')).text();
  assert.ok(withFormula.includes("'=SUMA(A1)"));
  assert.ok(withFormula.includes(',0,-250,'));
  assert.ok(!/'-?\d/.test(withFormula));

  // Primera hora completa tras crear el sensor: 12 intervalos de 5 min.
  const nextHour = new Date(Math.ceil(Date.parse(`${createdAt}Z`) / HOUR) * HOUR).toISOString().slice(0, 13);
  const end = new Date(Date.parse(`${nextHour}:00:00Z`) + HOUR).toISOString().slice(0, 13);
  const hour = (await (await call(`/api/traffic.csv?from=${nextHour}:00&to=${end}:00&id=${id}`)).text()).trim().split('\n');
  assert.equal(hour.length - 1, 12);
  assert.ok(hour.slice(1).every((l) => l.startsWith(`${nextHour}:`)));

  const parking = (await (await call('/api/parking.csv')).text()).trim().split('\n');
  assert.ok(parking.length > 1 && parking[1].includes('U100_100'));

  assert.equal((await call(`/api/sensors/${id}`, { method: 'PATCH', body: { name: 'Salida' }, auth: 'secreto' })).status, 200);
  assert.equal((await call(`/api/sensors/${id}`, { method: 'DELETE', auth: 'secreto' })).status, 200);
  assert.equal((await call(`/api/sensors/${id}`, { method: 'DELETE', auth: 'secreto' })).status, 404);
});

test('a database from an older version gets the new city columns', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'smartcity-')), 'old.db');
  const old = new DatabaseSync(file);
  const { CITY_COLUMNS } = await import('../src/sensors/cityTracker.js');
  const previous = CITY_COLUMNS.filter((c) => !['trips_done', 'trip_min', 'delay_min', 'trips_lost'].includes(c));
  old.exec(`CREATE TABLE city_records (id INTEGER PRIMARY KEY AUTOINCREMENT, ${previous.map((c) => `${c} ${c === 'timestamp' || c === 'weekday' ? 'TEXT' : 'REAL'}`).join(', ')})`);
  old.close();
  const store = new Store(file);
  const columns = store.db.prepare('PRAGMA table_info(city_records)').all().map((c) => c.name);
  for (const c of ['trips_done', 'trip_min', 'delay_min', 'trips_lost']) assert.ok(columns.includes(c), c);
  store.close();
});

test('CSV exports read in batches, keep the order and always end even while rows keep arriving', () => {
  const store = new Store();
  const t0 = Date.UTC(2026, 0, 5);
  const bus = (i, line) => ({ timestamp: new Date(t0 + i * 300000).toISOString().slice(0, 19), weekday: 'lunes', line_id: line, stops: 1, buses: 1, passengers: i, capacity: 80, occupancy_pct: 1, full_buses: 0, waiting: 0 });
  // Dos líneas con la misma marca de tiempo: el orden es por tiempo y, a igualdad, por orden de llegada.
  store.checkpoint({}, { buses: Array.from({ length: 250 }, (_, i) => [bus(i, 'L1'), bus(i, 'L2')]).flat() });
  const seen = [];
  for (const row of store.iterate('buses', {}, 7)) {
    seen.push(row);
    // El simulador sigue escribiendo a mitad de la descarga: no se cuelga ni se alarga.
    if (seen.length % 50 === 0) store.checkpoint({}, { buses: [bus(1000 + seen.length, 'L1')] });
    assert.ok(seen.length <= 500, 'la exportación no termina');
  }
  assert.equal(seen.length, 500);
  assert.deepEqual(seen.slice(0, 3).map((r) => [r.passengers, r.line_id]), [[0, 'L1'], [0, 'L2'], [1, 'L1']]);
  assert.ok(seen.every((r, i) => i === 0 || r.timestamp >= seen[i - 1].timestamp));
  assert.ok(!('_id' in seen[0]) && !('_ts' in seen[0]));
  const l2 = [...store.iterate('buses', { id: 'L2', from: new Date(t0 + 100 * 300000).toISOString().slice(0, 19) }, 9)];
  assert.equal(l2.length, 150);
  assert.ok(l2.every((r) => r.line_id === 'L2'));
});
