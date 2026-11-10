import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { CONFIG } from '../src/config.js';
import { SimEngine } from '../src/core/engine.js';
import { Store } from '../server/store.js';
import { Runtime } from '../server/runtime.js';
import { createApp } from '../server/app.js';

const SIDE = 41; // cuadrícula de 41 × 41 cruces cada 200 m, centrada en el origen
const STEP = 200;
const id = (i, j) => i * SIDE + j;

// Ciudad sintética con calles de doble sentido, paradas de autobús junto a cada cruce y dos semáforos en el centro.
function city() {
  const nodes = [];
  for (let i = 0; i < SIDE; i++) for (let j = 0; j < SIDE; j++) nodes.push((i - 20) * STEP, (j - 20) * STEP);
  const ways = [];
  for (let i = 0; i < SIDE; i++) {
    ways.push([2, 0, ...Array.from({ length: SIDE }, (_, j) => id(i, j))]);
    ways.push([2, 0, ...Array.from({ length: SIDE }, (_, j) => id(j, i))]);
  }
  const pois = [];
  for (let i = 0; i < SIDE; i++) for (let j = 0; j < SIDE; j++) pois.push((i - 20) * STEP + 8, (j - 20) * STEP, 2, (i - 20) * STEP - 8, (j - 20) * STEP, 2);
  return { nodes, ways, signals: [id(20, 20), 5001, id(21, 20), 5002], pois };
}

const NOON = 12 * 3600;
const engineOf = (maxCars = 400) => {
  const engine = new SimEngine({ data: city(), maxCars, startSeconds: NOON });
  engine.advanceTo(engine.simTime + 600);
  return engine;
};

function carsOn(engine, edges) {
  let n = 0;
  for (const e of edges) n += engine.sim.edgeCars[e]?.length ?? 0;
  return n;
}

const edgesOfWays = (engine, ways) => {
  const g = engine.graph;
  return Array.from({ length: g.edgeCount }, (_, e) => e).filter((e) => ways.includes(g.way[e]));
};

test('a closed street ends up without cars and never gets them again; reopening brings them back', () => {
  const engine = engineOf();
  const g = engine.graph;
  const hit = g.nearestSegment(0, 0, 50);
  const way = g.way[hit.e];
  const edges = edgesOfWays(engine, [way]);
  engine.advanceTo(engine.simTime + 1800);
  assert.ok(carsOn(engine, edges) > 0, 'sin cortar, la calle tiene coches');

  const item = engine.restrictions.add({ mode: 'pedestrians_only', ways: [way] });
  assert.equal(carsOn(engine, edges), 0, 'los coches de la calle salen al cortarla');
  for (let k = 0; k < 6; k++) {
    engine.advanceTo(engine.simTime + 600);
    assert.equal(carsOn(engine, edges), 0);
  }
  assert.equal(engine.sim.activeCount > 100, true, 'el resto de la ciudad sigue con tráfico');

  assert.equal(engine.restrictions.remove(item.id), true);
  engine.advanceTo(engine.simTime + 3 * 3600);
  assert.ok(carsOn(engine, edges) > 0, 'reabierta, vuelven los coches');
});

test('a closed area also stops cars that were about to drive into it', () => {
  const engine = engineOf();
  const item = engine.restrictions.add({ mode: 'buses_and_pedestrians', area: { x: 0, z: 0, radius: 150 } });
  assert.ok(item.edges.length > 4);
  for (let k = 0; k < 12; k++) {
    engine.advanceTo(engine.simTime + 300);
    assert.equal(carsOn(engine, item.edges), 0);
  }
});

test('an entry limit lets the cars inside leave but keeps new ones out', () => {
  const engine = engineOf(600);
  const item = engine.restrictions.add({ mode: 'entry_limit', area: { x: 0, z: 0, radius: 450 }, limit: 0 });
  let inside = engine.restrictions.carsInside(item);
  assert.ok(inside > 0, 'hay coches dentro de la zona al crearla');
  const first = inside;
  for (let k = 0; k < 30; k++) {
    engine.advanceTo(engine.simTime + 120);
    const now = engine.restrictions.carsInside(item);
    assert.ok(now <= inside, `no entran coches nuevos (${now} > ${inside})`);
    inside = now;
  }
  assert.ok(inside < first, 'los coches salen con el tiempo');
});

test('an entry limit above zero lets some cars in, but far fewer than without it', () => {
  const zoneMax = (limit) => {
    const engine = engineOf(CONFIG.cars.max);
    const item = engine.restrictions.add({ mode: 'entry_limit', area: { x: 0, z: 0, radius: 600 }, limit });
    let max = 0;
    for (let k = 0; k < 30; k++) {
      engine.advanceTo(engine.simTime + 120);
      max = Math.max(max, engine.restrictions.carsInside(item));
    }
    return max;
  };
  const free = zoneMax(CONFIG.cars.max);
  const limited = zoneMax(20);
  assert.ok(free > 40, `sin límite hay mucho tráfico dentro (${free})`);
  assert.ok(limited < free / 2, `con límite 20 hay muchos menos coches dentro (${limited} frente a ${free})`);
});

test('restrictions are validated', () => {
  const engine = engineOf(50);
  const add = (def) => () => engine.restrictions.add(def);
  assert.throws(add({ mode: 'nope', area: { x: 0, z: 0, radius: 10 } }), /mode/);
  assert.throws(add({ mode: 'pedestrians_only' }), /zona/);
  assert.throws(add({ mode: 'pedestrians_only', area: { x: 0, z: 0, radius: 10 }, ways: [0] }), /ambas/);
  assert.throws(add({ mode: 'pedestrians_only', area: { x: 0, z: 0, radius: 99999 } }), /radius/);
  assert.throws(add({ mode: 'pedestrians_only', area: { x: 1e7, z: 1e7, radius: 10 } }), /No hay calles/);
  assert.throws(add({ mode: 'pedestrians_only', ways: [1e6] }), /no existen/);
  assert.throws(add({ mode: 'pedestrians_only', area: { x: 0, z: 0, radius: 10 }, limit: 3 }), /limit/);
  assert.throws(add({ mode: 'entry_limit', area: { x: 0, z: 0, radius: 10 }, limit: -1 }), /limit/);
  assert.equal(engine.restrictions.items.length, 0);
});

test('closing a street on a bus route suspends the line unless buses may pass', () => {
  const engine = engineOf(100);
  const [line] = engine.transit.lines;
  const way = engine.graph.way[line.route.edge[Math.floor(line.route.edge.length / 2)]];
  const { buses } = engine;
  buses.updateAt(engine.simTime, engine.params.scenario, 1);
  assert.ok(buses.stats[0].active > 0);

  const item = engine.restrictions.add({ mode: 'pedestrians_only', ways: [way] });
  buses.updateAt(engine.simTime, engine.params.scenario, 1);
  assert.equal(buses.stats[0].active, 0);
  assert.ok(engine.restrictions.describe(item).suspendedLines.includes(line.id));

  engine.restrictions.update(item.id, { mode: 'buses_and_pedestrians' });
  buses.updateAt(engine.simTime, engine.params.scenario, 1);
  assert.ok(buses.stats[0].active > 0, 'con buses_and_pedestrians el autobús pasa');

  engine.restrictions.update(item.id, { mode: 'pedestrians_only' });
  engine.restrictions.remove(item.id);
  buses.updateAt(engine.simTime, engine.params.scenario, 1);
  assert.ok(buses.stats[0].active > 0);
});

test('the fleet of a line can be changed within limits', () => {
  const engine = engineOf(50);
  const [line] = engine.transit.lines;
  const before = line.buses;
  assert.equal(engine.setBusFleet(line.id, 20), true);
  engine.buses.updateAt(NOON, engine.params.scenario, 1);
  assert.equal(line.buses, 20);
  assert.equal(line.headway, line.cycle / 20);
  assert.ok(engine.buses.stats[0].active <= 20 && engine.buses.stats[0].active >= before * CONFIG.transit.minService - 1);
  assert.equal(engine.setBusFleet('L99', 5), false);
  assert.throws(() => engine.setBusFleet(line.id, 0), RangeError);
  assert.throws(() => engine.setBusFleet(line.id, CONFIG.transit.maxFleet + 1), RangeError);
  assert.throws(() => engine.setBusFleet(line.id, 3.5), RangeError);
  assert.equal(line.buses, 20);
});

test('signals can be switched off, set to all-red and timed individually', () => {
  const engine = engineOf(50);
  const s = engine.signals;
  const signal = s.byId.get(5001);
  assert.ok(signal.active);
  const states = () => [s.states[0], s.states[1]];

  s.setSignalOverride(5001, { mode: 'off' });
  s.update(engine.simTime);
  assert.deepEqual(states(), [3, 3], 'apagado: cruce sin regular');
  s.setSignalOverride(5001, { mode: 'flashing' });
  s.update(engine.simTime);
  assert.deepEqual(states(), [3, 3], 'ámbar intermitente: cruce sin regular');
  s.setSignalOverride(5001, { mode: 'all_red' });
  s.update(engine.simTime);
  assert.deepEqual(states(), [2, 2]);

  s.setSignalOverride(5001, { greenA: 50, greenB: 10, yellow: 4 });
  assert.deepEqual(s.timing(signal, engine.simTime), { gA: 50, gB: 10, y: 4 });
  s.setSignalOverride(5001, {});
  assert.deepEqual(s.timing(signal, engine.simTime), { gA: CONFIG.signals.green, gB: CONFIG.signals.green, y: CONFIG.signals.yellow });
});

test('point queries count what is around a point right now', () => {
  const engine = engineOf(600);
  const all = engine.pointStats(0, 0, 100000);
  assert.equal(all.cars.count, engine.sim.activeCount);
  assert.ok(all.cars.stopped <= all.cars.count);
  const near = engine.pointStats(0, 0, 300);
  assert.ok(near.cars.count > 0 && near.cars.count < all.cars.count);
  assert.deepEqual(engine.pointStats(1e6, 1e6, 100).cars, { count: 0, stopped: 0, avgKmh: 0 });
  assert.ok(all.pedestrians.count > 0);
  assert.equal(all.buses.count, engine.buses.activeCount);
});

test('restrictions, fleet and signals survive a snapshot and the restored engine keeps simulating identically', () => {
  const a = engineOf();
  const g = a.graph;
  a.restrictions.add({ mode: 'pedestrians_only', ways: [g.way[g.nearestSegment(0, 0, 50).e]], name: 'Centro' });
  a.restrictions.add({ mode: 'entry_limit', area: { x: 600, z: 0, radius: 300 }, limit: 10 });
  a.setBusFleet('L1', 9);
  a.signals.setSignalOverride(5002, { mode: 'off' });
  a.advanceTo(a.simTime + 1200);

  const snapshot = JSON.parse(JSON.stringify(a.snapshot()));
  const b = new SimEngine({ data: city(), maxCars: 400, startSeconds: NOON });
  assert.equal(b.restore(snapshot), true);
  assert.deepEqual(b.restrictions.items.map((r) => r.id), ['R1', 'R2']);
  assert.equal(b.transit.lines[0].buses, 9);
  assert.equal(b.signals.modeOf(b.signals.byId.get(5002)), 'off');
  assert.equal(b.restrictions.nextId, 3);

  a.advanceTo(a.simTime + 1800);
  b.advanceTo(a.simTime);
  assert.deepEqual(b.sim.serialize(), a.sim.serialize());
  assert.equal(b.restrictions.carsInside(b.restrictions.items[0]), 0);
});

async function api(t, { token = 'secreto' } = {}) {
  const engine = engineOf();
  const store = new Store();
  const runtime = new Runtime({ engine, store, now: () => 1_000_000, checkpointMs: 1e9 });
  const server = http.createServer(createApp({ runtime, store, token }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, { method = 'GET', body, auth = token } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  return { call, engine, runtime };
}

test('API: roads near a point can be closed, listed, changed and reopened', async (t) => {
  const { call, engine } = await api(t);
  const found = await call('/api/roads?x=0&z=0&radius=60');
  assert.equal(found.status, 200);
  assert.ok(found.body.roads.length >= 2);
  const [road] = found.body.roads;
  assert.deepEqual(Object.keys(road).sort(), ['cars', 'class', 'distance', 'edges', 'from', 'length', 'oneway', 'to', 'way']);
  assert.equal((await call(`/api/roads/${road.way}`)).body.way, road.way);
  assert.equal((await call('/api/roads/9999999')).status, 404);

  assert.equal((await call('/api/restrictions', { method: 'POST', body: { mode: 'pedestrians_only', ways: [road.way] }, auth: '' })).status, 401);
  const created = await call('/api/restrictions', { method: 'POST', body: { mode: 'pedestrians_only', ways: [road.way], name: 'Obras' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.id, 'R1');
  assert.equal(created.body.cars, 0);
  assert.equal(engine.restrictions.items.length, 1);

  const changed = await call('/api/restrictions/R1', { method: 'PATCH', body: { mode: 'buses_and_pedestrians' } });
  assert.equal(changed.body.mode, 'buses_and_pedestrians');
  assert.equal((await call('/api/restrictions')).body.restrictions.length, 1);
  assert.equal((await call('/api/restrictions/R1', { method: 'PATCH', body: { mode: 'x' } })).status, 400);

  assert.equal((await call('/api/restrictions/R1', { method: 'DELETE' })).status, 200);
  assert.equal((await call('/api/restrictions/R1')).status, 404);
  assert.equal((await call('/api/restrictions')).body.restrictions.length, 0);
});

test('API: restriction input is validated and lat/lon are accepted', async (t) => {
  const { call } = await api(t);
  const post = (body) => call('/api/restrictions', { method: 'POST', body });
  assert.equal((await post({ mode: 'pedestrians_only' })).status, 400);
  assert.equal((await post({ mode: 'pedestrians_only', x: 0, z: 0 })).status, 400);
  assert.equal((await post({ mode: 'pedestrians_only', x: 'a', z: 0, radius: 10 })).status, 400);
  assert.equal((await post({ mode: 'pedestrians_only', x: 0, z: 0, radius: 5000 })).status, 400);
  assert.equal((await post({ mode: 'entry_limit', x: 0, z: 0, radius: 100, limit: 'muchos' })).status, 400);
  const byLatLon = await post({ mode: 'entry_limit', lat: CONFIG.events.origin.lat, lon: CONFIG.events.origin.lon, radius: 100, limit: 5 });
  assert.equal(byLatLon.status, 201);
  assert.equal(byLatLon.body.limit, 5);
  assert.ok(Math.abs(byLatLon.body.area.x) < 1e-6 && Math.abs(byLatLon.body.area.z) < 1e-6);
});

test('API: point query, signals and bus fleet', async (t) => {
  const { call, engine } = await api(t);
  const point = await call('/api/point?x=0&z=0&radius=300');
  assert.equal(point.status, 200);
  assert.ok(point.body.cars.count > 0);
  assert.ok(point.body.signals.some((s) => s.id === 5001));
  assert.equal((await call('/api/point?radius=10')).status, 400);
  assert.equal((await call('/api/point?x=0&z=0&radius=99999')).status, 400);
  const geo = await call(`/api/point?lat=${CONFIG.events.origin.lat}&lon=${CONFIG.events.origin.lon}&radius=50`);
  assert.deepEqual(geo.body.point, { x: 0, z: 0 });

  const list = await call('/api/signals');
  assert.deepEqual(list.body.signals.map((s) => s.id).sort(), [5001, 5002]);
  assert.equal((await call('/api/signals?x=0&z=0&radius=1')).body.signals.length, 1);
  const off = await call('/api/signals/5001', { method: 'PATCH', body: { mode: 'off' } });
  assert.equal(off.status, 200);
  assert.deepEqual([off.body.mode, off.body.state], ['off', { ew: 'uncontrolled', ns: 'uncontrolled' }]);
  const timed = await call('/api/signals/5001', { method: 'PATCH', body: { mode: 'normal', greenA: 40, yellow: 4 } });
  assert.deepEqual(timed.body.timing, { greenEw: 40, greenNs: CONFIG.signals.green, yellow: 4, cycle: 40 + CONFIG.signals.green + 8 });
  const cleared = await call('/api/signals/5001', { method: 'PATCH', body: { greenA: null } });
  assert.equal(cleared.body.timing.greenEw, CONFIG.signals.green);
  assert.equal((await call('/api/signals/5001', { method: 'PATCH', body: { reset: true } })).body.override, null);
  assert.equal((await call('/api/signals/5001', { method: 'PATCH', body: { mode: 'roto' } })).status, 400);
  assert.equal((await call('/api/signals/5001', { method: 'PATCH', body: { greenA: 1 } })).status, 400);
  assert.equal((await call('/api/signals/5001', { method: 'PATCH', body: { color: 'rojo' } })).status, 400);
  assert.equal((await call('/api/signals/5001', { method: 'PATCH', body: { mode: 'off' }, auth: 'mal' })).status, 401);
  assert.equal((await call('/api/signals/1234', { method: 'PATCH', body: { mode: 'off' } })).status, 404);
  assert.equal((await call('/api/signals/plan', { method: 'PUT', body: { plan: { signals: { 5001: { mode: 'x' } } } } })).status, 400);
  assert.equal((await call('/api/signals/plan', { method: 'PUT', body: { plan: { signals: { 5001: { mode: 'all_red' } } } } })).status, 200);
  assert.equal(engine.signals.modeOf(engine.signals.byId.get(5001)), 'all_red');

  const buses = await call('/api/buses');
  const line = buses.body.lines[0];
  assert.deepEqual([line.minFleet, line.maxFleet, line.suspended], [CONFIG.transit.minFleet, CONFIG.transit.maxFleet, false]);
  const fleet = await call(`/api/buses/${line.id}`, { method: 'PATCH', body: { fleet: 22 } });
  assert.equal(fleet.status, 200);
  assert.equal(fleet.body.fleet, 22);
  assert.equal((await call('/api/state')).body.buses.lines[0].fleet, 22);
  assert.equal((await call(`/api/buses/${line.id}`, { method: 'PATCH', body: { fleet: 0 } })).status, 400);
  assert.equal((await call(`/api/buses/${line.id}`, { method: 'PATCH', body: { fleet: 5 }, auth: '' })).status, 401);
  assert.equal((await call('/api/buses/L99', { method: 'PATCH', body: { fleet: 5 } })).status, 404);
});

test('a restriction reports the metres of street it affects, counting two-way streets once', async () => {
  const { describeWay } = await import('../src/traffic/restrictions.js');
  const engine = engineOf(50);
  const g = engine.graph;
  const way = g.way[g.nearestSegment(0, 0, 50).e];
  const item = engine.restrictions.add({ mode: 'pedestrians_only', ways: [way] });
  const expected = describeWay(g, way).length;
  assert.ok(expected > 1000);
  assert.equal(engine.restrictions.describe(item).length, expected);
  const zone = engine.restrictions.describe(engine.restrictions.add({ mode: 'entry_limit', area: { x: 0, z: 0, radius: 150 }, limit: 0 }));
  assert.ok(zone.length > 0 && zone.length < 4 * 300, `zona de 150 m: ${zone.length} m`);
});

test('cars make trips to destination zones and the delay over free flow is measured', () => {
  const engine = engineOf(400);
  const before = { ...engine.sim.tripTotals };
  engine.advanceTo(engine.simTime + 3600);
  const t = engine.sim.tripTotals;
  const done = t.done - before.done;
  assert.ok(done > 200, `viajes completados en 1 h: ${done}`);
  assert.ok(t.delay - before.delay >= 0);
  assert.ok((t.seconds - before.seconds) / done > 60, 'un viaje dura más de un minuto');
  assert.ok(t.lost - before.lost < done / 20, `pocos viajes perdidos sin cortes (${t.lost - before.lost})`);
});

test('closing the centre of a destination zone makes trips to it impossible', () => {
  const lostIn = (close) => {
    const engine = engineOf(400);
    const zone = engine.sim.trips.zones[Math.floor(engine.sim.trips.zones.length / 2)];
    if (close) engine.restrictions.add({ mode: 'pedestrians_only', area: { x: zone.x, z: zone.z, radius: 450 } });
    const before = engine.sim.tripTotals.lost;
    engine.advanceTo(engine.simTime + 3600);
    return engine.sim.tripTotals.lost - before;
  };
  const open = lostIn(false);
  const closed = lostIn(true);
  assert.ok(closed > open + 10, `perdidos con el corte ${closed}, sin él ${open}`);
});

test('the city CSV counts trips, their duration, delay and lost trips per interval', () => {
  const engine = engineOf(400);
  engine.drainRecords();
  engine.advanceTo(engine.simTime + 1800);
  const rows = engine.drainRecords().city;
  assert.ok(rows.length >= 5);
  const done = rows.reduce((a, r) => a + r.trips_done, 0);
  assert.ok(done > 50);
  for (const r of rows) {
    assert.ok(r.trip_min >= 0 && r.delay_min >= 0 && r.trips_lost >= 0);
    if (r.trips_done) assert.ok(r.delay_min <= r.trip_min);
  }
});

test('at an uncontrolled junction pedestrians occupy the crossing a share of the time that grows with the crowd', () => {
  const engine = engineOf(50);
  const s = engine.signals;
  const index = s.signals.findIndex((x) => x.id === 5001);
  const busyShare = (load) => {
    s.setPedestrianLoad(load);
    let busy = 0;
    for (let t = 0; t < 4000; t++) busy += s.pedestrianWindow(index, NOON + t).current ? 1 : 0;
    return busy / 4000;
  };
  s.setSignalOverride(5001, { mode: 'flashing' });
  assert.equal(busyShare(0), 0);
  const full = busyShare(1);
  assert.ok(Math.abs(full - CONFIG.signals.unsignalized.pedestrianShare.flashing) < 0.03, `ocupado ${full}`);
  assert.ok(busyShare(0.3) < full);
  // Apagado, el peatón espera a que haya hueco: ocupa menos el paso que en ámbar, donde tiene prioridad.
  s.setSignalOverride(5001, { mode: 'off' });
  const off = busyShare(1);
  assert.ok(Math.abs(off - CONFIG.signals.unsignalized.pedestrianShare.off) < 0.03, `ocupado apagado ${off}`);
  assert.ok(off < full);
});

test('at an uncontrolled junction cars give way to the priority road, never both at once, and slow down', () => {
  const engine = engineOf(0);
  const g = engine.graph;
  const sim = engine.sim;
  const signals = engine.signals;
  const index = signals.signals.findIndex((x) => x.id === 5001);
  signals.setSignalOverride(5001, { mode: 'off' });
  signals.setPedestrianLoad(0);
  signals.update(engine.simTime);
  const approaches = signals.signals[index].approaches;
  const ew = approaches.find((e) => g.grp[e] === 0);
  const ns = approaches.find((e) => g.grp[e] === 1);
  assert.ok(ew !== undefined && ns !== undefined && g.cls[ew] === g.cls[ns]);
  // Un coche del eje este-oeste (con prioridad, misma categoría) a 10 m de la línea.
  sim.activeCount = 2;
  sim.place(0, ew);
  sim.pos[0] = g.len[ew] - 10;
  sim.speed[0] = 8;
  assert.equal(sim.mustYield(ns, index), true, 'el del eje norte-sur cede');
  sim.detach(0);
  sim.place(0, ns);
  sim.pos[0] = g.len[ns] - 10;
  assert.equal(sim.mustYield(ew, index), false, 'el del eje este-oeste no cede');

  // Sin nadie más, un coche igualmente llega despacio a la línea.
  sim.detach(0);
  sim.activeCount = 1;
  sim.place(0, ew);
  sim.pos[0] = g.len[ew] - 8;
  sim.speed[0] = 12;
  sim.next[0] = sim.next[1] = sim.next[2] = -1;
  const gap = sim.freeGap(0);
  const vmax = Math.sqrt(2 * CONFIG.cars.decel * Math.max(0, gap - CONFIG.cars.minGap));
  assert.ok(vmax < 9, `velocidad permitida cerca de la línea: ${vmax.toFixed(1)} m/s`);
});

test('at a zebra crossing without signal cars stop while people cross, more often the more people there are', () => {
  // Paso a mitad de la calle norte-sur x = 1000, entre z = -200 y z = 0 (lejos de los semáforos del centro).
  const data = { ...city(), crossings: [1000, -100, 1, 0, 2, 0, 10, 1, 0, 2] };
  const engine = new SimEngine({ data, maxCars: 0, startSeconds: NOON });
  const { graph: g, sim, signals, crosswalks: zc } = engine;
  assert.equal(zc.edge[0] >= 0, true, 'el paso se asocia a su calle');
  assert.equal(zc.edge[1], -1, 'el paso junto al semáforo lo regula el semáforo');
  const e = zc.edge[0];
  assert.equal(Math.abs(g.ux[e]) < 0.1, true, 'la calle que cruza va perpendicular al paso');
  for (const d of [e, g.rev[e]]) assert.equal(zc.start[d + 1] - zc.start[d], 1, 'en los dos sentidos');

  const busyShare = (load) => {
    signals.setPedestrianLoad(load);
    let busy = 0;
    for (let t = 0; t < 4000; t++) busy += zc.window(0, NOON + t).current ? 1 : 0;
    return busy / 4000;
  };
  assert.equal(busyShare(0), 0);
  const full = busyShare(1);
  assert.ok(Math.abs(full - Math.min(CONFIG.signals.crosswalks.maxShare, CONFIG.signals.crosswalks.share * zc.weight[0])) < 0.03, `ocupado ${full}`);
  assert.ok(busyShare(0.3) < full);

  // Un coche que va hacia el paso: se para antes si cruza gente y pasa si no.
  const at = zc.at[zc.start[e]];
  sim.activeCount = 1;
  sim.place(0, e);
  sim.pos[0] = at - 30;
  sim.speed[0] = 5;
  sim.next[0] = sim.next[1] = sim.next[2] = -1;
  const w = zc.window(0, NOON);
  signals.now = w.start + 1;
  assert.equal(zc.busy(0), true);
  const stopGap = CONFIG.signals.crosswalks.stopGap;
  assert.ok(Math.abs(sim.freeGap(0) - (30 - stopGap)) < 1e-3, 'para antes del paso');
  signals.now = w.start + w.length + 1;
  assert.equal(zc.busy(0), false);
  assert.ok(sim.freeGap(0) > 30, 'sin peatones pasa');
  // Sin gente en la calle, nunca para.
  signals.now = w.start + 1;
  signals.setPedestrianLoad(0);
  assert.ok(sim.freeGap(0) > 30);

  // Los peatones solo pisan la calzada del paso dentro de sus ventanas (los demás esperan en el bordillo).
  signals.setPedestrianLoad(1);
  const p = engine.pedestrians;
  const road = CONFIG.roads.halfWidth[2];
  let onRoad = 0;
  for (let t = NOON; t < NOON + 2000; t += 3) {
    p.updateAt(t, 'auto', 365 / 7);
    for (let i = 0; i < p.activeCount; i++) {
      if (Math.abs(p.z[i] + 100) > 2 || Math.abs(p.x[i] - 1000) > road - 0.5) continue;
      onRoad++;
      assert.equal(zc.window(0, t).current, true, `peatón en la calzada a las ${t} con el paso libre`);
    }
  }
  assert.ok(onRoad > 0, 'alguien cruza');
});
