import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { SimEngine } from '../src/core/engine.js';
import { Store } from '../server/store.js';
import { Runtime } from '../server/runtime.js';
import { createApp } from '../server/app.js';
import { ApiClient, ApiError, nextDay, normalizeBaseUrl } from '../src/api/client.js';

const city = () => ({
  nodes: [-250, -250, 250, -250, 250, 250, -250, 250],
  ways: [[4, 0, 0, 1, 2, 3, 0]],
  signals: [],
  parking: { underground: [[100, 100, 200, 1, 'Parking Test']] },
});

async function start(t) {
  let wall = 1_000_000;
  const store = new Store();
  const runtime = new Runtime({ engine: new SimEngine({ data: city(), maxCars: 60 }), store, now: () => wall, checkpointMs: 1e9 });
  const server = http.createServer(createApp({ runtime, store, token: 'secreto' }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return { base: `http://127.0.0.1:${server.address().port}/`, runtime, advance: (ms) => { wall += ms; while (!runtime.tick()); runtime.checkpoint(); } };
}

test('url and date helpers', () => {
  assert.equal(normalizeBaseUrl(' https://app.fly.dev/ '), 'https://app.fly.dev');
  assert.equal(normalizeBaseUrl(''), '');
  assert.throws(() => normalizeBaseUrl('javascript:alert(1)'));
  assert.throws(() => normalizeBaseUrl('no es una url'));
  assert.throws(() => normalizeBaseUrl('/'), 'sin origen de página, una ruta relativa no es válida');
  globalThis.location = { origin: 'https://ciudad.test' };
  try {
    assert.equal(normalizeBaseUrl('/'), 'https://ciudad.test');
  } finally {
    delete globalThis.location;
  }
  assert.equal(nextDay('2026-01-31'), '2026-02-01');
  assert.equal(nextDay('2026-12-31'), '2027-01-01');
  assert.throws(() => nextDay('ayer'));
});

test('csvUrl validates filters and builds a streaming download url', () => {
  const api = new ApiClient({ baseUrl: 'https://x.test/', fetchFn: () => {} });
  assert.equal(api.csvUrl('traffic'), 'https://x.test/api/traffic.csv');
  assert.equal(api.csvUrl('parking', { from: '2026-03-01', to: '2026-04-01', id: 'U1_2' }), 'https://x.test/api/parking.csv?from=2026-03-01&to=2026-04-01&id=U1_2');
  assert.throws(() => api.csvUrl('otro'));
  assert.throws(() => api.csvUrl('traffic', { from: 'ayer' }));
});

test('writes need a token locally; wrong tokens are rejected by the server', async (t) => {
  const { base } = await start(t);
  const anonymous = new ApiClient({ baseUrl: base });
  await assert.rejects(() => anonymous.addSensor(0, -250), (e) => e instanceof ApiError && e.status === 401);
  const wrong = new ApiClient({ baseUrl: base, token: 'mal' });
  await assert.rejects(() => wrong.addSensor(0, -250), (e) => e.status === 401);
  assert.equal((await anonymous.state()).sensors.length, 0);
});

test('client manages sensors and the CSV url downloads the recorded data', async (t) => {
  const { base, advance } = await start(t);
  const api = new ApiClient({ baseUrl: base, token: 'secreto' });
  const { id } = await api.addSensor(0, -250, 'Norte');
  await api.setTrackedParkings(['U100_100']);
  await api.renameSensor(id, 'Norte 2');
  advance(10 * 60 * 1000);

  const state = await api.state();
  assert.equal(state.sensors[0].name, 'Norte 2');
  assert.ok(state.records.traffic > 0 && state.records.parking > 0);

  const res = await fetch(api.csvUrl('traffic', { from: '2026-01-05', to: nextDay('2026-01-05'), id }));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /attachment/);
  const lines = (await res.text()).trim().split('\n');
  assert.ok(lines.length > 1 && lines.slice(1).every((l) => l.startsWith('2026-01-05T')));

  await assert.rejects(() => api.removeSensor('S99'), (e) => e.status === 404);
  await api.removeSensor(id);
  assert.equal((await api.state()).sensors.length, 0);
});
