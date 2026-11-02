import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFIG } from '../src/config.js';
import { SimEngine } from '../src/core/engine.js';
import { BusTracker } from '../src/sensors/busTracker.js';
import { Store, BUS_COLUMNS } from '../server/store.js';
import { Runtime, DEFAULT_SCALE } from '../server/runtime.js';
import { createApp } from '../server/app.js';

const SIDE = 41;
const STEP = 200;

// Ciudad sintética de 8 km con calles en cuadrícula y paradas de autobús junto a cada cruce (ver transit.test.js).
function city() {
  const nodes = [];
  const id = (i, j) => i * SIDE + j;
  for (let i = 0; i < SIDE; i++) for (let j = 0; j < SIDE; j++) nodes.push((i - 20) * STEP, (j - 20) * STEP);
  const ways = [];
  for (let i = 0; i < SIDE; i++) {
    ways.push([2, 0, ...Array.from({ length: SIDE }, (_, j) => id(i, j))]);
    ways.push([2, 0, ...Array.from({ length: SIDE }, (_, j) => id(j, i))]);
  }
  const pois = [];
  for (let i = 0; i < SIDE; i++) for (let j = 0; j < SIDE; j++) pois.push((i - 20) * STEP + 8, (j - 20) * STEP, 2, (i - 20) * STEP - 8, (j - 20) * STEP, 2);
  return { nodes, ways, signals: [], pois };
}

const data = city();
const newEngine = () => new SimEngine({ data, maxCars: 20 });
const INTERVAL = CONFIG.busTracking.intervalSeconds;

function clock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

test('only tracked lines are sampled, once per interval boundary', () => {
  const engine = newEngine();
  const [first, second] = engine.transit.lines;
  assert.ok(second);
  engine.advanceTo(engine.simTime + 3 * INTERVAL);
  assert.equal(engine.drainRecords().buses.length, 0);

  engine.busTracker.setTracked(first.id, true);
  engine.busTracker.setTracked('no-existe', true);
  const start = engine.simTime;
  engine.advanceTo(start + 4 * INTERVAL);
  const { buses } = engine.drainRecords();
  assert.equal(buses.length, 4);
  assert.ok(buses.every((r) => r.line_id === first.id && r.stops === first.stops.length));
  assert.deepEqual(Object.keys(buses[0]), BUS_COLUMNS);
  assert.equal(new Set(buses.map((r) => r.timestamp)).size, 4);

  // Cada registro es coherente: pasajeros dentro de la capacidad y ocupación en porcentaje.
  for (const r of buses) {
    assert.ok(r.buses > 0 && r.passengers >= 0 && r.passengers <= r.capacity);
    assert.equal(r.capacity, r.buses * CONFIG.transit.capacity);
    assert.equal(r.occupancy_pct, Math.round((r.passengers / r.capacity) * 1000) / 10);
    assert.ok(r.full_buses >= 0 && r.full_buses <= r.buses && r.waiting >= 0);
  }
});

test('bus records follow the demand: more buses and passengers at the peak than at night', () => {
  const engine = newEngine();
  engine.busTracker.setAll(true);
  const at = (hour) => {
    engine.simTime = 24 * 3600 + hour * 3600; // martes
    engine.busTracker.nextSample = engine.simTime;
    engine.advanceTo(engine.simTime + INTERVAL);
    const rows = engine.drainRecords().buses;
    return { buses: rows.reduce((n, r) => n + r.buses, 0), passengers: rows.reduce((n, r) => n + r.passengers, 0) };
  };
  const peak = at(8);
  const night = at(3);
  assert.ok(peak.buses > night.buses);
  assert.ok(peak.passengers > 3 * night.passengers);
});

test('the tracked lines survive a snapshot and the records are identical after restoring', () => {
  const a = newEngine();
  a.scale = DEFAULT_SCALE;
  a.busTracker.setTracked(a.transit.lines[0].id, true);
  a.advanceTo(a.simTime + 6 * INTERVAL);
  const snapshot = JSON.parse(JSON.stringify(a.snapshot()));
  a.drainRecords();
  a.advanceTo(a.simTime + 6 * INTERVAL);

  const b = newEngine();
  b.scale = DEFAULT_SCALE;
  assert.equal(b.restore(snapshot), true);
  assert.deepEqual([...b.busTracker.tracked], [a.transit.lines[0].id]);
  b.advanceTo(a.simTime);
  assert.deepEqual(b.drainRecords().buses, a.drainRecords().buses);

  // Un snapshot de antes de los autobuses (sin `buses`) se restaura igualmente
  const old = JSON.parse(JSON.stringify(a.snapshot()));
  delete old.buses;
  assert.equal(newEngine().restore(old), true);
});

test('the sampling depends on the clock scale, which the runtime fixes from the database', () => {
  const engine = newEngine();
  const runtime = new Runtime({ engine, store: new Store(), now: clock(), checkpointMs: 1e9 });
  assert.equal(engine.scale, runtime.scale);
  assert.equal(engine.scale, DEFAULT_SCALE);
});

test('a tracker without lines never records anything', () => {
  const tracker = new BusTracker({ lines: [], statsAt: () => [], getSimTime: () => 0 });
  tracker.setAll(true);
  tracker.tick(10 * INTERVAL);
  assert.equal(tracker.pending.length, 0);
});

test('API: choose lines, read their state and export the records as CSV', async (t) => {
  const now = clock();
  const store = new Store();
  const runtime = new Runtime({ engine: newEngine(), store, now, checkpointMs: 1e9 });
  const server = http.createServer(createApp({ runtime, store, token: 'secreto' }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, { method = 'GET', body, auth } = {}) =>
    fetch(base + path, {
      method,
      headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const state = await (await call('/api/state')).json();
  assert.ok(state.buses.lines.length >= 3);
  assert.ok(state.buses.lines.every((l) => !l.tracked && l.fleet > 0 && l.stops > 0));
  assert.equal(state.records.buses, 0);

  const [a, b] = state.buses.lines.map((l) => l.id);
  assert.equal((await call('/api/buses/tracked', { method: 'PUT', body: { ids: [a] } })).status, 401);
  assert.equal((await call('/api/buses/tracked', { method: 'PUT', body: { ids: 'L1' }, auth: 'secreto' })).status, 400);
  const put = await call('/api/buses/tracked', { method: 'PUT', body: { ids: [a, b, 'otra'] }, auth: 'secreto' });
  assert.deepEqual((await put.json()).tracked, [a, b]);

  now.advance(10 * 60 * 1000); // 10 min reales ≈ 8,7 h simuladas
  while (!runtime.tick()) { /* recuperación por tramos */ }
  runtime.checkpoint();

  const live = await (await call('/api/buses')).json();
  assert.equal(live.lines.length, state.buses.lines.length);
  assert.ok(live.lines.some((l) => l.active > 0 && l.passengers > 0));

  const after = await (await call('/api/state')).json();
  assert.ok(after.records.buses > 0);
  const csv = (await (await call('/api/buses.csv')).text()).trim().split('\n');
  assert.equal(csv[0], BUS_COLUMNS.join(','));
  assert.equal(csv.length - 1, after.records.buses);
  assert.ok(csv.slice(1).every((row) => row.split(',')[2] === a || row.split(',')[2] === b));
  const onlyA = (await (await call(`/api/buses.csv?id=${a}`)).text()).trim().split('\n');
  assert.ok(onlyA.length > 1 && onlyA.length < csv.length);
  assert.ok(onlyA.slice(1).every((row) => row.split(',')[2] === a));

  await call('/api/buses/tracked', { method: 'PUT', body: { ids: [] }, auth: 'secreto' });
  const none = await (await call('/api/state')).json();
  assert.ok(none.buses.lines.every((l) => !l.tracked));
});

test('the bus table is created in a database that already existed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sc-'));
  try {
    const file = join(dir, 'old.db');
    const old = new Store(file);
    old.db.exec('DROP TABLE bus_records');
    old.close();
    const reopened = new Store(file);
    assert.equal(reopened.count('buses'), 0);
    reopened.checkpoint({ any: 1 }, { buses: [{ timestamp: '2026-01-05T07:05:00', weekday: 'lunes', line_id: 'L1', stops: 3, buses: 2, passengers: 10, capacity: 160, occupancy_pct: 6.3, full_buses: 0, waiting: 4 }] });
    assert.equal(reopened.count('buses'), 1);
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true });
  }
});
