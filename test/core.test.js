import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/core/random.js';
import { TrafficSim } from '../src/traffic/sim.js';
import { SensorManager } from '../src/sensors/sensorManager.js';

function graph() {
  return {
    edgeCount: 2,
    A: [0, 1], B: [1, 0], rev: [1, 0], cls: [4, 4],
    outStart: [0, 1, 2], outList: [0, 1],
    ux: [1, -1], uz: [0, 0], len: [1000, 1000], speed: [8, 8],
  };
}

function run(seed, steps) {
  const sim = new TrafficSim(graph(), { stateForEdge: () => 0 }, () => {}, { rng: createRng(seed) });
  sim.setTarget(50);
  for (let i = 0; i < steps; i++) sim.step(0.25);
  return { pos: Array.from(sim.pos.slice(0, 50)), rng: sim.rng.getState() };
}

test('rng is deterministic and its state can be restored', () => {
  const a = createRng(7);
  const first = [a(), a(), a()];
  const b = createRng(7);
  assert.deepEqual([b(), b(), b()], first);
  const state = a.getState();
  const next = a();
  a.setState(state);
  assert.equal(a(), next);
  assert.ok(first.every((v) => v >= 0 && v < 1));
});

test('same seed yields the same simulation, different seed does not', () => {
  assert.deepEqual(run(1, 200), run(1, 200));
  assert.notDeepEqual(run(1, 200), run(2, 200));
});

test('sensor manager records buckets without a renderer or storage', () => {
  let time = 0;
  const g = { ...graph(), nearestSegment: () => ({ e: 0, t: 0.5, x: 500, z: 0 }) };
  const sim = new TrafficSim(g, { stateForEdge: () => 0 }, (s, d, v) => sensors.recordCrossing(s, d, v), { rng: createRng(3) });
  const sensors = new SensorManager({ graph: g, sim, getSimTime: () => time, storage: null });
  sensors.add(500, 0);
  sim.setTarget(40);
  while (time < 900) {
    time += 0.25;
    sim.step(0.25);
    sensors.tick(time);
  }
  assert.equal(sensors.records.length, 3);
  assert.ok(sensors.records.some((r) => r.count > 0));
  assert.match(sensors.recordsCsv(), /^timestamp,weekday,sensor_id/);
});
