import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { METRIC, INDICATORS, BUCKET_SECONDS, ROWS_PER_BUCKET, scoreWindow, indicatorsOf } from '../profesor/panel/metric.js';
import { Collector, diffSnapshots, parseCsv } from '../profesor/panel/collector.js';
import { CITY_COLUMNS } from '../src/sensors/cityTracker.js';
import { createPanel, parseGroups, REFERENCE } from '../profesor/panel/server.js';

const base = { cars: 1000, stopped: 100, speedXcars: 30000, busWaiting: 400, busActive: 40, busFull: 4, busPassengers: 2000, suspendedLines: 0, badStations: 10, saturatedLots: 3, restrictedKm: 0, allRed: 0 };
const times = (values, k) => Object.fromEntries(Object.entries(values).map(([key, v]) => [key, v * k]));
const rows = (values, n = 24) => Array.from({ length: n }, (_, bucket) => ({ bucket, n: ROWS_PER_BUCKET, sums: times({ ...base, ...values }, ROWS_PER_BUCKET) }));

test('a group identical to the reference scores 50', () => {
  const score = scoreWindow(rows({}), rows({}));
  assert.equal(score.index, 50);
  for (const v of Object.values(score.components)) assert.equal(v, 0);
  assert.equal(score.hours, 6);
});

test('fewer stopped cars and less waiting raise the index; each component is clamped', () => {
  const better = scoreWindow(rows({ stopped: 50, busWaiting: 200 }), rows({}));
  assert.ok(better.components.traffic > 0 && better.components.transit > 0);
  assert.ok(better.index > 50);
  const absurd = scoreWindow(rows({ stopped: 0, speedXcars: 1e9 }), rows({}));
  assert.ok(absurd.components.traffic <= METRIC.clamp + 1e-9);
});

test('closing streets has a cost even if the indicators do not change', () => {
  const score = scoreWindow(rows({ restrictedKm: 10 }), rows({}));
  assert.equal(score.components.cost, -METRIC.clamp);
  assert.ok(score.index < 50);
});

test('making one service much worse caps the index, and long suspensions are penalised', () => {
  const tradeoff = scoreWindow(rows({ stopped: 0, busWaiting: 4000, badStations: 0, saturatedLots: 0 }), rows({}));
  assert.ok(tradeoff.index <= METRIC.cap);
  assert.match(tradeoff.notes.join(), /Tope/);
  const plain = scoreWindow(rows({}), rows({}), { suspensions: 1 });
  assert.equal(plain.index, 50 - METRIC.suspensionPenalty);
});

test('only buckets present in both cities are compared', () => {
  const group = rows({}, 10);
  const ref = rows({}, 4);
  assert.equal(scoreWindow(group, ref).buckets, 4);
  assert.equal(scoreWindow(group, []), null);
});

test('indicators are read from a row of the city CSV', () => {
  const row = { timestamp: '2026-01-05T07:05:00', cars: '10', stopped: '2', avg_speed_kmh: '30', buses: '5', bus_passengers: '59', full_buses: '1',
    bus_waiting: '6', suspended_lines: '1', bikes_in_use: '3', stations_empty: '1', stations_full: '1', parkings_full: '1',
    closed_m: '1000', bus_only_m: '0', limited_m: '1000', signals_all_red: '1' };
  assert.deepEqual(Object.keys(row).sort(), CITY_COLUMNS.filter((c) => c !== 'weekday').sort());
  const v = indicatorsOf(row);
  assert.deepEqual(Object.keys(v).sort(), [...INDICATORS].sort());
  assert.equal(v.speedXcars, 300);
  assert.equal(v.badStations, 2);
  assert.equal(v.restrictedKm, METRIC.restrictionWeight.closed + METRIC.restrictionWeight.limited);
  assert.deepEqual(parseCsv('a,b\n"x, ""y""",2\n'), [{ a: 'x, "y"', b: '2' }]);
});

test('incomplete buckets are not compared', () => {
  const partial = rows({});
  partial[23] = { ...partial[23], n: 1 };
  assert.equal(scoreWindow(partial, rows({})).buckets, 23);
});

test('actions are detected between two polls, including undoing a change too soon', () => {
  const snap = (over = {}) => ({ restrictions: {}, fleet: { L1: 5 }, suspended: [], plan: { default: {}, signals: {} }, params: { maxCars: 1500 }, pending: {}, ...over });
  const memory = { fleet: {} };
  const created = diffSnapshots(snap(), snap({ restrictions: { R1: { mode: 'pedestrians_only', length: 300, since: 1000 } } }), 1000, memory);
  assert.match(created[0].text, /Crea R1/);
  const removed = diffSnapshots(snap({ restrictions: { R1: { mode: 'pedestrians_only', length: 300, since: 1000 } } }), snap(), 1600, memory);
  assert.deepEqual(removed.map((e) => e.kind), ['action', 'reversal']);
  diffSnapshots(snap(), snap({ fleet: { L1: 6 } }), 2000, memory);
  const down = diffSnapshots(snap({ fleet: { L1: 6 } }), snap({ fleet: { L1: 5 } }), 2600, memory);
  assert.deepEqual(down.map((e) => e.kind), ['action', 'reversal']);
  const later = diffSnapshots(snap({ fleet: { L1: 5 } }), snap({ fleet: { L1: 6 } }), 9000, memory);
  assert.deepEqual(later.map((e) => e.kind), ['action']);
  assert.equal(diffSnapshots(snap(), snap({ params: { maxCars: 10 } }), 0, memory)[0].kind, 'params');
  assert.match(diffSnapshots(snap(), snap({ plan: { default: {}, signals: { 7: { mode: 'off' } } } }), 0, memory)[0].text, /Semáforo 7/);
});

// Ciudad falsa: el estado se puede cambiar entre consultas y graba una fila de /api/city.csv cada 5 min simulados.
function fakeCity() {
  const iso = (s) => new Date(Date.UTC(2026, 0, 5) + s * 1000).toISOString().slice(0, 19);
  const city = {
    sim: 25200, restrictions: [], fleet: 5, params: { maxCars: 1500, maxPedestrians: 12000, scenario: 'auto' },
    state() {
      return {
        simSeconds: this.sim, simTime: iso(this.sim), scale: 52, caughtUp: true, cars: 100, params: this.params,
        traffic: { stopped: 10, avgKmh: 30 }, signalPlan: { default: {}, signals: {} }, parkings: [], bikes: { stations: [] },
        buses: { lines: [{ id: 'L1', fleet: this.fleet, suspended: false }] },
      };
    },
    csv(from) {
      const lines = [CITY_COLUMNS.join(',')];
      for (let s = 25200; s <= this.sim; s += 300) {
        if (iso(s) < from) continue;
        lines.push(CITY_COLUMNS.map((c) => (c === 'timestamp' ? iso(s) : c === 'weekday' ? 'lunes' : c === 'stopped' ? 10 : 1)).join(','));
      }
      return `${lines.join('\n')}\n`;
    },
  };
  const fetchJson = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/state') return city.state();
    if (path === '/api/restrictions') return { restrictions: city.restrictions };
    throw new Error(`no esperado: ${path}`);
  };
  const fetchText = async (url) => city.csv(new URL(url).searchParams.get('from'));
  return { city, fetchJson, fetchText };
}

test('the collector stores buckets, logs actions and detects a restarted city', async () => {
  const { city, fetchJson, fetchText } = fakeCity();
  const collector = new Collector({ file: ':memory:', instances: [{ name: 'g1', url: 'http://g1', kind: 'group' }], fetchJson, fetchText });
  await collector.pollAll();
  city.sim += 300;
  city.fleet = 7;
  await collector.pollAll();
  city.sim += 300;
  await collector.pollAll();
  await collector.pollAll(); // repetir la consulta no duplica filas
  const buckets = collector.buckets('g1');
  assert.equal(buckets.reduce((n, b) => n + b.n, 0), 3);
  assert.equal(buckets[0].bucket, Math.floor(25200 / BUCKET_SECONDS));
  assert.equal(buckets[0].sums.stopped, 30);
  assert.match(collector.events('g1')[0].text, /L1: flota 5 → 7/);
  city.sim = 25200; // reinicio
  await collector.pollAll();
  assert.equal(collector.epochOf('g1'), 1);
  assert.equal(collector.buckets('g1').length, 1);
  assert.equal(collector.buckets('g1')[0].n, 1);
  assert.equal(collector.events('g1', { allEpochs: true })[0].kind, 'reset');
  collector.close();
});

test('the panel requires the password and serves the overview', async (t) => {
  const { fetchJson, fetchText } = fakeCity();
  const groups = parseGroups('g1=http://g1');
  assert.throws(() => parseGroups('sin-igual'));
  const collector = new Collector({ file: ':memory:', instances: [{ name: REFERENCE, url: 'http://ref', kind: 'reference' }, ...groups], fetchJson, fetchText });
  await collector.pollAll();
  const server = http.createServer(createPanel({ collector, groups, password: 'clave' }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); collector.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${url}/data/overview`)).status, 401);
  assert.equal((await fetch(`${url}/data/overview`, { headers: { Authorization: `Basic ${btoa('profesor:mal')}` } })).status, 401);
  const auth = { Authorization: `Basic ${btoa('profesor:clave')}` };
  const overview = await (await fetch(`${url}/data/overview`, { headers: auth })).json();
  assert.equal(overview.groups[0].name, 'g1');
  assert.equal(overview.reference.ok, true);
  assert.equal((await fetch(`${url}/data/series?group=nadie`, { headers: auth })).status, 404);
  assert.equal((await fetch(`${url}/data/overview`, { method: 'POST', headers: auth })).status, 405);
  assert.equal((await fetch(`${url}/health`)).status, 200);
});

test('network errors are explained instead of a bare "fetch failed"', async () => {
  const { describeFetchError } = await import('../profesor/panel/collector.js');
  const failed = (code) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });
  assert.match(describeFetchError('http://x:1', failed('ECONNREFUSED')), /conexión rechazada/);
  assert.match(describeFetchError('http://x:1', failed('ENOTFOUND')), /no se encuentra/);
  assert.match(describeFetchError('https://x', failed('DEPTH_ZERO_SELF_SIGNED_CERT')), /DOMAIN=:80/);
  assert.match(describeFetchError('http://x:1', failed('EWHATEVER')), /EWHATEVER/);
});
