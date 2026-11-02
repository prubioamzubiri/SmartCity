import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { SimEngine } from '../src/core/engine.js';
import { Store, BIKE_COLUMNS } from '../server/store.js';
import { Runtime } from '../server/runtime.js';
import { createApp } from '../server/app.js';

const SIDE = 5;
const STEP = 100;

// Calles en cuadrícula y estaciones de bicicletas repartidas por ella.
function city() {
  const nodes = [];
  for (let i = 0; i < SIDE; i++) for (let j = 0; j < SIDE; j++) nodes.push((i - 2) * STEP, (j - 2) * STEP);
  const ways = [];
  for (let i = 0; i < SIDE; i++) {
    ways.push([2, 0, ...Array.from({ length: SIDE }, (_, j) => i * SIDE + j)]);
    ways.push([2, 0, ...Array.from({ length: SIDE }, (_, j) => j * SIDE + i)]);
  }
  const bicycleStations = Array.from({ length: 8 }, (_, i) => ({ id: `node/${i}`, name: `Puesto ${i}`, x: (i - 4) * 40, z: 10, capacity: 10 }));
  return { nodes, ways, signals: [], pois: [], bicycleStations };
}

function clock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

test('API: the server simulates the bike stations, the riders and records the tracked ones', async (t) => {
  const now = clock();
  const store = new Store();
  const engine = new SimEngine({ data: city(), maxCars: 5 });
  const runtime = new Runtime({ engine, store, now, checkpointMs: 1e9 });
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

  const before = await (await call('/api/state')).json();
  assert.equal(before.bikes.stations.length, 8);
  assert.ok(before.bikes.stations.every((s) => s.available > 0 && !s.tracked));
  assert.equal(before.records.bikes, 0);

  assert.equal((await call('/api/bikes/tracked', { method: 'PUT', body: { ids: ['node/1'] } })).status, 401);
  assert.equal((await call('/api/bikes/tracked', { method: 'PUT', body: { ids: 'node/1' }, auth: 'secreto' })).status, 400);
  const put = await call('/api/bikes/tracked', { method: 'PUT', body: { ids: ['node/1', 'otra'] }, auth: 'secreto' });
  assert.deepEqual((await put.json()).tracked, ['node/1']);

  now.advance(10 * 60 * 1000);
  while (!runtime.tick()) { /* recuperación por tramos */ }
  runtime.checkpoint();

  const live = await (await call('/api/bikes')).json();
  assert.equal(live.stations.length, 8);
  assert.ok(live.inUse > 0);
  const fleet = live.stations.reduce((n, s) => n + s.available, 0) + live.inUse;
  assert.equal(fleet, before.bikes.stations.reduce((n, s) => n + s.available, 0));

  const csv = (await (await call('/api/bikes.csv')).text()).trim().split('\n');
  assert.equal(csv[0], BIKE_COLUMNS.join(','));
  assert.ok(csv.length > 1);
  assert.ok(csv.slice(1).every((row) => row.split(',')[2] === 'node/1'));
});

test('the pedestrians of the server ride the bikes that are out', () => {
  const engine = new SimEngine({ data: city(), maxCars: 5 });
  engine.bikes.inUse = 3;
  engine.pedestrianPositions(52);
  assert.equal(engine.pedestrians.bikeRiders, 3);
});

test('bike state survives a snapshot', () => {
  const a = new SimEngine({ data: city(), maxCars: 5 });
  a.advanceTo(a.simTime + 6 * 3600);
  const b = new SimEngine({ data: city(), maxCars: 5 });
  assert.ok(b.restore(JSON.parse(JSON.stringify(a.snapshot()))));
  assert.deepEqual(b.bikes.state(), a.bikes.state());
});

const DELAY = 30 * 86400;

test('a capacity change only takes effect after 30 simulated days', () => {
  const net = new SimEngine({ data: city(), maxCars: 5 }).bikes;
  const start = net.nextStep;
  net.scheduleCapacity('node/0', 20, start);
  net.scheduleCapacity('node/1', 4, start);
  net.tick(start + DELAY - 300);
  assert.equal(net.state().stations[0].capacity, 10);
  assert.equal(net.state().stations[0].pending.capacity, 20);
  const fleet = net.state().stations.reduce((n, s) => n + s.available, 0) + net.inUse;
  net.tick(start + DELAY + 300);
  const [a, b] = net.state().stations;
  assert.equal(a.capacity, 20);
  assert.equal(a.pending, null);
  assert.equal(b.capacity, 4);
  assert.ok(b.available <= 4);
  assert.equal(net.state().stations.reduce((n, s) => n + s.available, 0) + net.inUse, fleet);
});

test('capacity changes are validated, can be cancelled and survive a snapshot', () => {
  const net = new SimEngine({ data: city(), maxCars: 5 }).bikes;
  assert.throws(() => net.scheduleCapacity('node/0', 0, 0), /entero/);
  assert.throws(() => net.scheduleCapacity('node/0', 2.5, 0), /entero/);
  assert.throws(() => net.scheduleCapacity('nope', 5, 0), /desconocida/);
  net.scheduleCapacity('node/0', 15, 100);
  net.scheduleCapacity('node/2', 15, 100);
  net.scheduleCapacity('node/2', null, 100);
  const copy = new SimEngine({ data: city(), maxCars: 5 }).bikes;
  copy.restore(JSON.parse(JSON.stringify(net.serialize())));
  assert.deepEqual(copy.state().stations[0].pending, { capacity: 15, effectiveAt: 100 + DELAY });
  assert.equal(copy.state().stations[2].pending, null);
  copy.tick(copy.nextStep + DELAY + 600);
  const again = new SimEngine({ data: city(), maxCars: 5 }).bikes;
  again.restore(JSON.parse(JSON.stringify(copy.serialize())));
  assert.equal(again.state().stations[0].capacity, 15);
});

test('API: schedule capacities, all-or-nothing, and see them applied', async (t) => {
  const now = clock();
  const store = new Store();
  const runtime = new Runtime({ engine: new SimEngine({ data: city(), maxCars: 0 }), store, now, checkpointMs: 1e9 });
  const server = http.createServer(createApp({ runtime, store, token: 'secreto' }));
  server.keepAliveTimeout = 120_000; // el catch-up bloquea el servidor más que el timeout por defecto
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const put = (body, auth = 'secreto') => fetch(`${base}/api/bikes/capacity`, {
    method: 'PUT',
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal((await put({ changes: { 'node/0': 20 } }, null)).status, 401);
  assert.equal((await put({ changes: [] })).status, 400);
  assert.equal((await put({ changes: { 'node/9': 20 } })).status, 400);
  assert.equal((await put({ changes: { 'node/0': 20, 'node/1': 0 } })).status, 400);
  const none = await (await fetch(`${base}/api/bikes`)).json();
  assert.ok(none.stations.every((s) => !s.pending), 'a rejected request schedules nothing');

  const ok = await put({ changes: { 'node/0': 20 } });
  assert.equal(ok.status, 200);
  const [first] = (await ok.json()).stations;
  assert.equal(first.capacity, 10);
  assert.equal(first.pending.capacity, 20);

  now.advance(16 * 3600 * 1000); // ≈ 34 días simulados
  while (!runtime.tick()) { /* recuperación por tramos */ }
  const after = (await (await fetch(`${base}/api/bikes`)).json()).stations[0];
  assert.equal(after.capacity, 20);
  assert.equal(after.pending, null);
});
