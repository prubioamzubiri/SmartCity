import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createFaults, absurd } from '../server/faults.js';
import { CONFIG } from '../src/config.js';
import { SimEngine } from '../src/core/engine.js';
import { Store } from '../server/store.js';
import { Runtime } from '../server/runtime.js';
import { createApp } from '../server/app.js';

const often = { enabled: true, valueRate: 0.05, missingRowRate: 0.02, coordRate: 0.05, liveRate: 0.05 };
const rows = Array.from({ length: 4000 }, (_, i) => ({
  timestamp: `2026-01-05T${String(Math.floor(i / 12) % 24).padStart(2, '0')}:${String((i % 12) * 5).padStart(2, '0')}:00`,
  weekday: 'lunes', sensor_id: `S${Math.floor(i / 288)}`, sensor_name: 'x', x: 10.5, z: -3.5, count: 12, count_fwd: 7, count_bwd: 5, avg_speed_kmh: 31.2,
}));

test('sensor faults: rare, deterministic, and only on measured values or coordinates', () => {
  const f = createFaults({ seed: 7, config: often });
  const out = rows.map((r) => f.csvRow('traffic', r));
  const again = rows.map((r) => f.csvRow('traffic', r));
  assert.deepEqual(out, again, 'la misma fila falla siempre igual');
  const missing = out.filter((r) => r === null).length / rows.length;
  assert.ok(missing > 0.01 && missing < 0.03, `filas que faltan: ${missing}`);
  let values = 0;
  let coords = 0;
  out.forEach((r, i) => {
    if (!r) return;
    for (const k of ['timestamp', 'weekday', 'sensor_id', 'sensor_name']) assert.equal(r[k], rows[i][k]);
    if (r.x === '' || r.z === '') coords++;
    for (const k of ['count', 'count_fwd', 'count_bwd', 'avg_speed_kmh']) {
      if (r[k] === rows[i][k]) continue;
      values++;
      assert.ok(r[k] === '' || r[k] < 0 || r[k] >= 1000, `${k}: ${r[k]}`);
    }
  });
  assert.ok(values / rows.length > 0.03 && values / rows.length < 0.07, `valores: ${values}`);
  assert.ok(coords / rows.length > 0.03 && coords / rows.length < 0.07, `coordenadas: ${coords}`);
  // Otra ciudad (otra semilla), otros fallos; sin fallos, la fila sale tal cual.
  assert.notDeepEqual(rows.map((r) => createFaults({ seed: 8, config: often }).csvRow('traffic', r)), out);
  assert.equal(createFaults({ config: { enabled: false } }).csvRow('traffic', rows[0]), rows[0]);
  assert.ok(absurd(12, 0.1) < 0 && absurd(12, 0.9) >= 1000 && absurd(0.5, 0.2) < 0);
});

test('live API faults touch measurements, never the manager settings', () => {
  const f = createFaults({ seed: 3, config: { ...often, liveRate: 0.5 } });
  const body = {
    buses: { lines: Array.from({ length: 30 }, (_, i) => ({ id: `L${i}`, fleet: 8, target: 8, passengers: 40, waiting: 12 })) },
    sensors: Array.from({ length: 30 }, (_, i) => ({ id: `S${i}`, x: 1, z: 2, current: 5 })),
    signals: [{ id: 1, active: true, state: { ew: 'green', ns: 'red' }, approaching: { ew: 3, ns: 4 } }],
  };
  const out = f.live('/api/state', structuredClone(body), 100);
  assert.deepEqual(f.live('/api/state', structuredClone(body), 100), out, 'el mismo minuto, los mismos fallos');
  assert.ok(out.buses.lines.every((l) => l.fleet === 8 && l.target === 8));
  assert.ok(out.buses.lines.some((l) => l.passengers !== 40));
  assert.ok(out.sensors.some((s) => s.x === null || s.z === null));
  assert.deepEqual(out.signals[0].state, { ew: 'green', ns: 'red' });
});

test('the server stores the real data, downloads it with faults and logs each fault (real and shown)', async (t) => {
  const saved = { ...CONFIG.faults };
  Object.assign(CONFIG.faults, often);
  t.after(() => Object.assign(CONFIG.faults, saved));
  const faults = createFaults();
  const store = new Store(':memory:', { faults });
  let wall = 1_000_000;
  const now = () => wall;
  const runtime = new Runtime({ engine: new SimEngine({ data: { nodes: [0, 0, 400, 0, 400, 400], ways: [[2, 0, 0, 1, 2]], signals: [] }, maxCars: 5 }), store, now, checkpointMs: 1e9 });
  const server = http.createServer(createApp({ runtime, store, rawKey: 'profe', faults }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  server.keepAliveTimeout = 60_000;
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (path, key) => (await fetch(base + path, { headers: key ? { 'X-Raw-Key': key } : {} }));

  wall += 20 * 60 * 1000; // 20 min reales ≈ 17 h simuladas de city.csv
  while (!runtime.tick()) { /* recuperación */ }
  runtime.checkpoint();

  const parse = (text) => {
    const [head, ...lines] = text.trim().split('\n');
    const cols = head.split(',');
    return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
  };
  const real = parse(await (await get('/api/city.csv', 'profe')).text());
  const shown = parse(await (await get('/api/city.csv')).text());
  assert.ok(real.length > 150, `${real.length} filas`);
  assert.equal((await get('/api/faults.csv')).status, 403, 'el registro de fallos solo con la clave');
  const log = parse(await (await get('/api/faults.csv', 'profe')).text());
  assert.ok(log.length > 0, 'hay fallos anotados');
  // Lo que se descarga es lo guardado con exactamente los fallos anotados.
  const byTime = new Map(shown.map((r) => [r.timestamp, r]));
  for (const f of log) {
    const r = real.find((x) => x.timestamp === f.timestamp);
    if (f.column_name === '*') {
      assert.ok(!byTime.has(f.timestamp), 'la fila que falta no se descarga');
      continue;
    }
    assert.equal(String(r[f.column_name]), f.dato_real);
    assert.equal(byTime.get(f.timestamp)[f.column_name], f.dato_mostrado);
  }
  const differing = real.filter((r) => byTime.has(r.timestamp) && JSON.stringify(r) !== JSON.stringify(byTime.get(r.timestamp))).length;
  assert.equal(differing + log.filter((f) => f.column_name === '*').length, new Set(log.map((f) => f.timestamp)).size);
});
