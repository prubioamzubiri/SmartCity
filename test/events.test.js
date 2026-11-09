import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { CONFIG } from '../src/config.js';
import { createEventCalendar, eventCalendar as calendar } from '../src/events/calendar.js';
import { createDemandModel, demandFactor } from '../src/traffic/demand.js';
import { TrafficSim } from '../src/traffic/sim.js';
import { buildGraph } from '../src/traffic/graph.js';
import { SimEngine } from '../src/core/engine.js';
import { Store } from '../server/store.js';
import { Runtime } from '../server/runtime.js';
import { createApp } from '../server/app.js';
import { monthGrid } from '../src/ui/eventCalendar.js';
import { ApiClient } from '../src/api/client.js';
import { EVENT_COLUMNS } from '../server/app.js';

const HOUR = 3600;
const DAY = 86400;
const iso = (seconds) => new Date(CONFIG.sim.baseDate + seconds * 1000).toISOString().slice(0, 16);
const year = (y) => calendar.eventsBetween(calendar.secondsOf(y, 0, 1), calendar.secondsOf(y + 1, 0, 1));
const named = (list, text) => list.filter((e) => e.name.includes(text));

test('the calendar is deterministic, differs between years and covers every kind of event', () => {
  const again = createEventCalendar();
  assert.deepEqual(year(2026), again.eventsBetween(again.secondsOf(2026, 0, 1), again.secondsOf(2027, 0, 1)));
  assert.notDeepEqual(year(2026).map((e) => e.start - calendar.secondsOf(2026, 0, 1)), year(2027).map((e) => e.start - calendar.secondsOf(2027, 0, 1)));
  const types = new Set(year(2026).map((e) => e.type));
  assert.deepEqual([...types].sort(), Object.keys(CONFIG.events.types).sort());
  assert.equal(new Set(year(2026).map((e) => e.id)).size, year(2026).length);
});

test('the big fiestas fall on their usual dates', () => {
  const events = year(2026);
  const grandWeek = named(events, 'Semana Grande');
  assert.equal(iso(grandWeek[0].start), '2026-08-08T12:00');
  assert.equal(iso(grandWeek.at(-1).start), '2026-08-15T12:00');
  assert.equal(named(events, 'fuegos artificiales').length, 6);
  const film = events.filter((e) => e.type === 'film');
  assert.equal(film.length, 9);
  assert.equal(iso(film[0].start), '2026-09-18T16:00');
  const jazz = events.filter((e) => e.type === 'jazz');
  assert.deepEqual([iso(jazz[0].start), iso(jazz[4].start)], ['2026-07-22T18:00', '2026-07-26T18:00']);
  assert.equal(iso(named(events, 'Cabalgata')[0].start), '2026-01-05T18:00');
  assert.equal(iso(named(events, 'Santo Tomás')[0].start), '2026-12-21T10:00');
});

test('football and basketball home games are at their venues and mostly on weekends', () => {
  const events = year(2026);
  const football = events.filter((e) => e.type === 'football');
  const basketball = events.filter((e) => e.type === 'basketball');
  assert.equal(football.length, 19);
  assert.ok(basketball.length >= 10);
  assert.ok(football.every((e) => e.venue === 'anoeta' && e.attendance >= 30000));
  assert.ok(basketball.every((e) => e.venue === 'illunbe'));
  const weekend = football.filter((e) => [0, 6].includes(new Date(CONFIG.sim.baseDate + e.start * 1000).getUTCDay()));
  assert.ok(weekend.length >= football.length / 2);
  assert.ok(events.filter((e) => e.type === 'protest').length >= 20);
});

test('venues are projected around the city centre', () => {
  for (const venue of Object.values(calendar.venues)) {
    assert.ok(Math.hypot(venue.x, venue.z) < 4000, venue.name);
  }
  assert.ok(calendar.venues.anoeta.z > 0, 'Anoeta is south of the centre');
  assert.ok(calendar.venues.kursaal.x > 0, 'Kursaal is east of the centre');
});

test('an event ramps up while people arrive, peaks during it and fades afterwards', () => {
  const match = year(2026).find((e) => e.type === 'football');
  const before = (hours) => match.start - hours * HOUR;
  assert.equal(calendar.intensity(match, before(10)), 0);
  const arriving = [before(2.5), before(1), before(0.1)].map((t) => calendar.intensity(match, t));
  assert.ok(arriving[0] > 0 && arriving[0] < arriving[1] && arriving[1] < arriving[2] && arriving[2] < 1);
  assert.equal(calendar.intensity(match, match.start + HOUR), 1);
  const leaving = [match.end + 0.1 * HOUR, match.end + HOUR].map((t) => calendar.intensity(match, t));
  assert.ok(leaving[0] > leaving[1] && leaving[1] > 0);
  assert.equal(calendar.intensity(match, match.end + 2 * HOUR), 0);
});

test('events add demand on top of the daily profile and overlapping events add up with a cap', () => {
  const config = structuredClone(CONFIG.traffic);
  config.dailyVariation = 0;
  const plain = createDemandModel(config);
  const withEvents = createDemandModel(config, CONFIG.sim.baseDate, calendar);
  const match = year(2026).find((e) => e.type === 'football');
  const t = match.start + HOUR;
  assert.ok(calendar.boostAt(t) >= match.boost);
  assert.ok(Math.abs(withEvents.demandFactor(t) - plain.demandFactor(t) - calendar.boostAt(t)) < 1e-9);
  const quiet = calendar.secondsOf(2026, 1, 3, 4);
  assert.equal(calendar.boostAt(quiet), 0);
  assert.equal(withEvents.demandFactor(quiet), plain.demandFactor(quiet));

  const crowded = createEventCalendar({ ...CONFIG.events, maxBoost: 0.05 });
  assert.equal(Math.max(...Array.from({ length: 24 }, (_, h) => crowded.boostAt(crowded.secondsOf(2026, 7, 12, h)))), 0.05);
});

test('the default demand model includes the events unless they are disabled', () => {
  const fireworks = named(year(2026), 'fuegos')[0];
  assert.ok(CONFIG.events.enabled);
  assert.ok(demandFactor(fireworks.start + 600) >= calendar.boostAt(fireworks.start + 600));
  assert.ok(calendar.boostAt(fireworks.start + 600) >= fireworks.boost * 0.99);
});

test('attractors list only the events in progress and the invalid times are rejected', () => {
  const fireworks = named(year(2026), 'fuegos')[0];
  const attractors = calendar.attractorsAt(fireworks.start);
  const mine = attractors.find((a) => a.id === fireworks.id);
  assert.ok(mine && mine.weight > 0.5 && mine.radius === calendar.venues.concha.radius);
  assert.deepEqual(calendar.attractorsAt(calendar.secondsOf(2026, 1, 3, 4)), []);
  assert.throws(() => calendar.boostAt(NaN), /valid number/);
  assert.equal(calendar.upcoming(fireworks.start - HOUR, 3)[0].start <= fireworks.start, true);
});

// Cuadrícula de calles de 100 m con la sede del evento en la esquina inferior izquierda.
function grid(n = 21) {
  const nodes = [];
  const ways = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) nodes.push(i * 100, j * 100);
  for (let i = 0; i < n; i++) {
    // [clase, sentido (0 = doble), ...nodos]
    ways.push([4, 0, ...Array.from({ length: n }, (_, j) => i * n + j)]);
    ways.push([4, 0, ...Array.from({ length: n }, (_, j) => j * n + i)]);
  }
  return { nodes, ways, signals: [] };
}

test('cars appear near a venue and head towards it while its event is on', () => {
  const graph = buildGraph(grid());
  const corner = (sim) => {
    let near = 0;
    for (let i = 0; i < sim.activeCount; i++) {
      const e = sim.edge[i];
      if (Math.hypot(graph.nx[graph.A[e]], graph.nz[graph.A[e]]) < 500) near++;
    }
    return near / sim.activeCount;
  };
  const run = (attractors) => {
    const sim = new TrafficSim(graph, { stateForEdge: () => 0 }, () => {});
    sim.setAttractors(attractors);
    sim.setTarget(400);
    for (let i = 0; i < 400; i++) sim.step(CONFIG.sim.step);
    return sim;
  };
  const without = corner(run([]));
  const sim = run([{ id: 'test', x: 0, z: 0, radius: 400, weight: 1 }]);
  assert.ok(corner(sim) > without * 2, `${corner(sim)} vs ${without}`);
  assert.equal(sim.activeCount, 400);
});

test('a restored engine with events in progress continues exactly like the original', () => {
  const city = { ...grid(5), parking: { underground: [] } };
  const start = named(year(2026), 'Cabalgata')[0].start - HOUR; // la sede está lejos de la rejilla, pero el evento ya cuenta
  const a = new SimEngine({ data: city, maxCars: 60, startSeconds: start });
  a.advanceTo(a.simTime + 600);
  assert.ok(a.sim.attractors.length > 0);
  const snapshot = JSON.parse(JSON.stringify(a.snapshot()));
  a.advanceTo(a.simTime + 600);
  const b = new SimEngine({ data: city, maxCars: 60 });
  assert.equal(b.restore(snapshot), true);
  b.advanceTo(a.simTime);
  assert.deepEqual(b.sim.serialize(), a.sim.serialize());
});

test('the month grid starts on Monday and numbers the days like the simulated calendar', () => {
  const cells = monthGrid(2026, 0); // 1 de enero de 2026: jueves
  assert.equal(cells.length, 42);
  assert.equal(cells[0].inMonth, false);
  assert.equal(cells[3].date, 1);
  assert.equal(cells[3].day, -4); // la simulación empieza el 5 de enero
  assert.equal(cells.filter((c) => c.inMonth).length, 31);
  assert.equal(monthGrid(2026, 0)[7].day, cells[0].day + 7);
  assert.equal(monthGrid(2026, 5)[0].date, 1);
  assert.equal(monthGrid(2026, 1)[6].day * DAY, calendar.secondsOf(2026, 1, 1)); // febrero empieza en domingo
});

async function withServer(fn) {
  const runtime = new Runtime({ engine: new SimEngine({ data: { ...grid(5), parking: { underground: [] } }, maxCars: 20 }), store: new Store(), now: () => 1_000_000, checkpointMs: 1e9 });
  const server = http.createServer(createApp({ runtime, store: runtime.store }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const get = async (path) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    const csv = (res.headers.get('content-type') ?? '').startsWith('text/csv');
    return { status: res.status, body: csv ? await res.text() : await res.json(), headers: res.headers };
  };
  try {
    await fn(get, runtime);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('the API lists the events of a date range and the state reports those in progress', async () => {
  await withServer(async (get, runtime) => {
    const { status, body } = await get('/api/events?from=2026-08-08&to=2026-08-16');
    assert.equal(status, 200);
    assert.ok(body.events.length >= 14);
    const first = body.events[0];
    assert.deepEqual(Object.keys(first).sort(), ['attendance', 'end', 'extraDemand', 'id', 'name', 'series', 'start', 'type', 'venue', 'venueName', 'x', 'z']);
    assert.match(first.start, /^2026-08-08T\d\d:\d\d:\d\d$/);
    assert.ok(body.events.every((e) => e.attendance === null && e.extraDemand === null), 'future events do not reveal their attendance');
    assert.ok(body.events.every((e) => e.start < '2026-08-16T00:00:00'));

    const defaults = await get('/api/events');
    assert.equal(defaults.status, 200);
    assert.ok(Array.isArray(defaults.body.events));
    assert.equal((await get('/api/events?from=hoy')).status, 400);
    assert.equal((await get('/api/events?from=2026-01-01&to=2028-01-01')).status, 400);

    const fireworks = named(year(2026), 'fuegos')[0];
    runtime.engine.simTime = fireworks.start + 600;
    const state = (await get('/api/state')).body;
    assert.ok(state.events.boost > 0.5);
    assert.ok(state.events.active.some((e) => e.id === fireworks.id && e.intensity === 1));
    assert.equal(state.events.active.find((e) => e.id === fireworks.id).attendance, null, 'in progress: attendance still unknown');

    runtime.engine.simTime = fireworks.end + 600;
    const over = (await get('/api/events?from=2026-08-09T23:00&to=2026-08-10T00:00')).body.events.find((e) => e.id === fireworks.id);
    assert.equal(over.attendance, fireworks.attendance);
    assert.equal(over.extraDemand, Math.round(fireworks.boost * 1000) / 1000);
    const trail = (await get('/api/state')).body.events.active.find((e) => e.id === fireworks.id);
    assert.equal(trail.attendance, fireworks.attendance, 'once over, the attendance is public');
    runtime.engine.simTime = calendar.secondsOf(2026, 1, 3, 4);
    assert.deepEqual((await get('/api/state')).body.events, { boost: 0, active: [] });
  });
});

const parseCsv = (text) => {
  const [header, ...lines] = text.trim().split('\n');
  return lines.map((line) => Object.fromEntries(header.split(',').map((c, i) => [c, line.split(',')[i]])));
};

test('the events CSV exports a period and hides the attendance of the events that have not ended', async () => {
  await withServer(async (get, runtime) => {
    const fireworks = named(year(2026), 'fuegos');
    const [done, running, future] = [fireworks[0], fireworks[1], fireworks[2]];
    runtime.engine.simTime = running.start + 600;
    const res = await get('/api/events.csv?from=2026-08-09&to=2026-08-13');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /eventos\.csv/);
    assert.equal(res.body.split('\n')[0], EVENT_COLUMNS.join(','));
    const rows = parseCsv(res.body).filter((r) => r.name.includes('fuegos'));
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.equal(byId[done.id].status, 'finished');
    assert.equal(byId[done.id].attendance, String(done.attendance));
    assert.ok(Number(byId[done.id].extra_demand) > 0);
    assert.equal(byId[running.id].status, 'in_progress');
    assert.equal(byId[future.id].status, 'upcoming');
    for (const hidden of [byId[running.id], byId[future.id]]) assert.deepEqual([hidden.attendance, hidden.extra_demand], ['', '']);

    const films = parseCsv((await get('/api/events.csv?from=2026-09-01&to=2026-10-01&type=film')).body);
    assert.equal(films.length, 9);
    assert.ok(films.every((r) => r.type === 'film' && r.attendance === ''));
    assert.equal((await get('/api/events?from=2026-09-01&to=2026-10-01&type=film')).body.events.length, 9);
    assert.equal((await get('/api/events.csv?type=otro')).status, 400);
    assert.equal((await get('/api/events.csv?from=ayer')).status, 400);
    assert.equal((await get('/api/events.csv?from=2026-01-01&to=2028-01-01')).status, 400);
  });
});

test('the client builds the events CSV url with its period and type', () => {
  const api = new ApiClient({ baseUrl: 'https://x.test' });
  assert.equal(api.csvUrl('events', { from: '2026-08-01', to: '2026-09-01', type: 'film' }), 'https://x.test/api/events.csv?from=2026-08-01&to=2026-09-01&type=film');
  assert.equal(api.csvUrl('events'), 'https://x.test/api/events.csv');
});
