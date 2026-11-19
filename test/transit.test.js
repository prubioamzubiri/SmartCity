import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { buildGraph } from '../src/traffic/graph.js';
import { buildTransit, locate } from '../src/transit/lines.js';
import { Buses } from '../src/transit/buses.js';

const T = CONFIG.transit;
const SIDE = 41; // cuadrícula de 41 × 41 cruces cada 200 m: 8 km de lado, centrada en el origen
const STEP = 200;

// Ciudad sintética: calles secundarias en cuadrícula, todas de doble sentido, con paradas de autobús junto a cada cruce.
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
const graph = buildGraph(data);
// Peso de atracción alto en todas las calles: paradas concurridas
const weights = new Float32Array(graph.edgeCount).fill(T.referenceWeight * T.maxStopWeight);
const transit = buildTransit(data, graph, { weights });

test('lines are generated between real bus stops and are closed loops', () => {
  assert.ok(transit.lines.length >= 3);
  for (const line of transit.lines) {
    const r = line.route;
    assert.equal(r.x[0], r.x[r.x.length - 1]);
    assert.equal(r.z[0], r.z[r.z.length - 1]);
    assert.ok(line.length > 1000);
    assert.ok(line.buses >= T.minBuses && line.buses <= T.maxBuses);
    assert.ok(line.stops[0].terminal && line.stops.filter((s) => s.turnaround).length === 1);
  }
  assert.deepEqual(buildTransit(data, graph, { weights }).lines.map((l) => l.length), transit.lines.map((l) => l.length));
});

test('stops are ordered along the route, spaced out and never too far apart', () => {
  for (const line of transit.lines) {
    for (let i = 1; i < line.stops.length; i++) {
      const gap = line.stops[i].s - line.stops[i - 1].s;
      assert.ok(gap > 0);
      assert.ok(gap <= T.maxStopSpacing + 1e-6, `${line.id}: parada ${i} a ${gap} m de la anterior`);
    }
    assert.ok(line.stops.length >= 4);
  }
});

test('lines are colored differently', () => {
  const colors = new Set(transit.lines.map((l) => l.color));
  assert.equal(colors.size, transit.lines.length);
});

test('a bus moves continuously, stops at every stop and returns to its start after a cycle', () => {
  const line = transit.lines[0];
  const speedLimit = T.maxSpeed * 1.05;
  let prev = locate(graph, line, 0);
  let dwellTime = 0;
  const visited = new Set();
  for (let u = 1; u < line.cycle; u += 1) {
    const p = locate(graph, line, u);
    // El carril cambia de lado en las curvas, de ahí el margen
    assert.ok(Math.hypot(p.x - prev.x, p.z - prev.z) <= speedLimit + 2 * T.laneOffset + 1e-6);
    if (p.dwelling) {
      dwellTime++;
      visited.add(p.stop);
      assert.ok(Math.abs(p.s - line.stops[p.stop].s) < 1e-6);
    }
    prev = { x: p.x, z: p.z };
  }
  assert.equal(visited.size, line.stops.length);
  assert.ok(Math.abs(dwellTime - line.dwellBefore[line.stops.length]) <= line.stops.length + 1);
  const start = locate(graph, line, 0);
  const end = locate(graph, line, line.cycle - 1e-6);
  assert.ok(Math.hypot(start.x - end.x, start.z - end.z) <= 2 * T.laneOffset + 1);
});

test('buses are deterministic and spread along the line', () => {
  const a = new Buses(transit, graph);
  const b = new Buses(transit, graph);
  a.update(5000, 0.8);
  b.update(5000, 0.8);
  assert.equal(a.activeCount, b.activeCount);
  assert.deepEqual(a.x.slice(0, a.activeCount), b.x.slice(0, b.activeCount));
  assert.deepEqual(a.load.slice(0, a.activeCount), b.load.slice(0, b.activeCount));
  const line = transit.lines[0];
  const distinct = new Set();
  for (let i = 0; i < a.activeCount; i++) if (a.line[i] === 0) distinct.add(`${a.x[i]}:${a.z[i]}`);
  assert.equal(distinct.size, a.stats[0].active);
  assert.ok(a.stats[0].active <= line.buses);
});

test('service and occupancy follow the demand; no bus exceeds its capacity', () => {
  const buses = new Buses(transit, graph);
  const sample = (demand) => {
    let active = 0;
    let passengers = 0;
    let full = 0;
    for (let t = 0; t < 7200; t += 60) {
      buses.update(t, demand);
      for (let i = 0; i < buses.activeCount; i++) {
        assert.ok(buses.load[i] >= 0 && buses.load[i] <= T.capacity);
        passengers += buses.load[i];
        if (buses.isFull(i)) full++;
      }
      active += buses.activeCount;
    }
    return { active, passengers: passengers / active, full };
  };
  const peak = sample(1);
  const night = sample(0);
  assert.ok(night.active < peak.active);
  assert.ok(night.active >= buses.lines.length * Math.floor(T.minBuses * T.minService));
  assert.ok(peak.passengers > 2 * night.passengers);
  assert.ok(peak.full > 0, 'en hora punta alguno va lleno');
  assert.equal(night.full, 0);
});

test('passengers board at stops and everyone gets off at the end of the outbound trip', () => {
  const buses = new Buses(transit, graph);
  const line = transit.lines[0];
  const turn = line.stops.findIndex((s) => s.turnaround);
  const trip = 3;
  const before = buses.loadAt(line, 0, 0, trip, turn - 1, 1);
  assert.ok(before > 0);
  const during = buses.loadAt(line, 0, 0, trip, turn, 0.5);
  const after = buses.loadAt(line, 0, 0, trip, turn, 1);
  assert.ok(during < before && during > after - 1);
  buses.demand = buses.rawDemand = 1;
  assert.ok(buses.loadAt(line, 0, 0, trip, turn, 1) <= buses.arrivalRate(0, turn) * line.headway * 1.5 + 1);
});

test('people wait at stops and queue up again after a bus leaves', () => {
  const buses = new Buses(transit, graph);
  buses.demand = buses.rawDemand = 1;
  const line = transit.lines[0];
  const stop = 3;
  const first = line.arrive[stop];
  const at = (u) => {
    buses.updateWaiting(line, 0, [u]);
    return buses.waiting[buses.stopOffset[0] + stop];
  };
  assert.equal(at(first + 1e-3 + line.stops[stop].dwell * 0.999), 0);
  assert.ok(at(line.depart[stop] + 1) < at(line.depart[stop] + T.patienceSeconds / 2));
  assert.ok(at(line.depart[stop] + T.patienceSeconds / 2) > 0);
  assert.ok(at(line.depart[stop] + T.patienceSeconds) <= T.maxWaiting);
  // Pasada la paciencia, la gente que llega se va: la cola deja de crecer.
  buses.updateWaiting(line, 0, [line.depart[stop] + T.patienceSeconds]);
  const tired = buses.stats[0].waiting;
  buses.updateWaiting(line, 0, [line.depart[stop] + T.patienceSeconds * 1.5]);
  assert.ok(Math.abs(buses.stats[0].waiting - tired) <= tired * 0.05, `${buses.stats[0].waiting} ≈ ${tired}`);
});

test('without bus stops there are no lines and no buses', () => {
  const none = buildTransit({ ...data, pois: [] }, graph);
  assert.equal(none.lines.length, 0);
  const buses = new Buses(none, graph);
  buses.update(100, 1);
  assert.equal(buses.activeCount, 0);
});

test('the bus clock runs slower than the server clock but never faster', () => {
  const buses = new Buses(transit, graph);
  const seen = [];
  buses.update = (seconds) => seen.push(seconds);
  buses.updateAt(1200, 'weekday', 52);
  buses.updateAt(1200, 'weekday', 5);
  assert.equal(seen[0], (1200 * T.clockScale) / 52);
  assert.equal(seen[1], 1200);
});
