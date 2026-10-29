import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { SimEngine } from '../src/core/engine.js';
import { Store } from '../server/store.js';
import { Runtime } from '../server/runtime.js';
import { createApp } from '../server/app.js';
import { ApiClient } from '../src/api/client.js';
import { ServerSync } from '../src/api/serverSync.js';
import { RemoteCars } from '../src/traffic/remoteCars.js';

const city = () => ({
  nodes: [-250, -250, 250, -250, 250, 250, -250, 250],
  ways: [[4, 0, 0, 1, 2, 3, 0]],
  signals: [],
  parking: { underground: [[100, 100, 200, 1, 'Parking Test']] },
});

test('server clock is extrapolated from the last state and survives a page reload', () => {
  let now = 1000;
  const state = { simSeconds: 25200, scale: 52, caughtUp: true };
  const first = new ServerSync({ now: () => now });
  assert.equal(first.simTime(), null);
  first.receive(state);
  now += 2000;
  assert.equal(first.simTime(), 25200 + 2 * 52);

  // Un visor nuevo (F5) solo depende del estado que le da el servidor.
  const reloaded = new ServerSync({ now: () => now });
  reloaded.receive({ ...state, simSeconds: 25304 });
  assert.equal(reloaded.simTime(), first.simTime());
});

test('while the server is catching up the clock is not extrapolated', () => {
  let now = 0;
  const sync = new ServerSync({ now: () => now });
  sync.receive({ simSeconds: 100, scale: 52, caughtUp: false });
  now += 5000;
  assert.equal(sync.simTime(), 100);
});

test('act refreshes the state even when the change is rejected', async () => {
  const calls = [];
  const client = { baseUrl: 'x', state: async () => { calls.push('state'); return { simSeconds: 0, scale: 1, caughtUp: true }; } };
  const sync = new ServerSync({ createClient: () => client });
  sync.client = client;
  await assert.rejects(() => sync.act(async () => { throw new Error('401'); }), /401/);
  assert.deepEqual(calls, ['state']);
  assert.equal(sync.state.simSeconds, 0);
  sync.disconnect();
  await assert.rejects(() => sync.act(async () => {}), /Sin conexión/);
});

test('server exposes its cars and live values for the viewer', async (t) => {
  let wall = 1_000_000;
  const store = new Store();
  const runtime = new Runtime({ engine: new SimEngine({ data: city(), maxCars: 60 }), store, now: () => wall, checkpointMs: 1e9 });
  const server = http.createServer(createApp({ runtime, store, token: 'secreto' }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const api = new ApiClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, token: 'secreto' });

  await api.addSensor(0, -250, 'Norte');
  await api.setTrackedParkings(['U100_100']);
  wall += 10 * 60 * 1000;
  while (!runtime.tick());

  const state = await api.state();
  assert.equal(state.graphKey, runtime.engine.graphKey);
  assert.equal(typeof state.traffic.avgKmh, 'number');
  assert.equal(typeof state.sensors[0].current, 'number');
  assert.ok(state.parkings[0].occupancy > 0 && state.parkings[0].occupancy <= 1);

  const payload = await api.cars();
  const cars = new RemoteCars(runtime.engine.graph, runtime.engine.graphKey);
  assert.equal(cars.apply(payload), true);
  const { sim } = runtime.engine;
  assert.equal(cars.activeCount, sim.activeCount);
  assert.ok(cars.activeCount > 0);
  assert.deepEqual([...cars.edge.subarray(0, cars.activeCount)], [...sim.edge.subarray(0, sim.activeCount)]);
  assert.deepEqual([...cars.pos.subarray(0, cars.activeCount)], [...sim.pos.subarray(0, sim.activeCount)]);

  const other = new RemoteCars(runtime.engine.graph, 'otra-ciudad');
  assert.equal(other.apply(payload), false);
  assert.equal(other.activeCount, 0);
});

test('cars follow the roads between snapshots and end on the server position', () => {
  const engine = new SimEngine({ data: city(), maxCars: 40 });
  let now = 0;
  const cars = new RemoteCars(engine.graph, engine.graphKey, { now: () => now });
  const snapshot = () => ({ graphKey: engine.graphKey, simSeconds: engine.simTime, ...engine.sim.positions() });
  // La calle es el cuadrado de lado 500 m; el desplazamiento lateral del carril es de unos 2 m.
  const offRoad = (i) => Math.min(Math.abs(Math.abs(cars.rx[i]) - 250), Math.abs(Math.abs(cars.rz[i]) - 250));

  engine.advanceTo(engine.simTime + 600);
  cars.apply(snapshot());
  assert.ok(cars.activeCount > 0);

  let turned = 0;
  for (let round = 0; round < 6; round++) {
    const shown = Array.from(cars.rx.subarray(0, cars.activeCount));
    now += 1000;
    engine.advanceTo(engine.simTime + 45);
    cars.apply(snapshot());
    for (let i = 0; i < shown.length; i++) assert.ok(Math.abs(cars.rx[i] - shown[i]) < 1e-3, 'starts where the car was shown');
    for (const k of [0, 0.25, 0.5, 0.75, 1]) {
      cars.update(now + k * 1000);
      for (let i = 0; i < cars.activeCount; i++) assert.ok(offRoad(i) < 3.5, `car ${i} left the road at k=${k}`);
    }
    for (let i = 0; i < cars.activeCount; i++) {
      assert.equal(cars.shownEdge[i], cars.edge[i]);
      assert.ok(Math.abs(cars.shownPos[i] - cars.pos[i]) < 1e-2);
      if (cars.pathCount[i] > 1) turned++;
    }
  }
  assert.ok(turned > 0, 'some cars must change street so the test covers corners');
});
