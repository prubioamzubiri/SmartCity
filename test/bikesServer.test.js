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
