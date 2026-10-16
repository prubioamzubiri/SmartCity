import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Experiment, validateExperiment } from '../src/simulation/experiment.js';
import { TrafficSim } from '../src/traffic/sim.js';
import { SignalController } from '../src/traffic/signals.js';
import { SensorManager } from '../src/sensors/sensorManager.js';
import { demandFactor } from '../src/traffic/demand.js';
import { CONFIG } from '../src/config.js';

function setup() {
  const graph = {
    edgeCount: 2, signals: [], sig: [-1, -1],
    A: [0, 1], B: [1, 0], rev: [1, 0], cls: [4, 4],
    outStart: [0, 1, 2], outList: [0, 1],
    ux: [1, -1], uz: [0, 0], len: [100, 100], speed: [8, 8],
  };
  const clock = { simTime: 0, scale: 1 };
  const params = {};
  const signals = new SignalController(graph);
  let sensors;
  const sim = new TrafficSim(graph, signals, (sensor, dir, speed) => sensors.recordCrossing(sensor, dir, speed));
  sensors = new SensorManager({ scene: new THREE.Scene(), graph, sim, getSimTime: () => clock.simTime });
  const sensor = { id: 'S1', name: 'Test', x: 0, z: 0, total: 0, bucket: { fwd: 0, bwd: 0, speedSum: 0 } };
  sensors.sensors.push(sensor);
  sim.setSensorIndex(new Map([[0, [{ sensor, s: 50, dir: 'fwd' }]]]));
  const experiment = new Experiment({ clock, params, sim, signals, sensors, datasetId: 'test-map' });
  return { experiment, sim, sensors, clock, params, signals };
}
const settings = { seed: 42, scenario: 'weekday', maxCars: 8, durationMinutes: 1, green: 20 };
function run(fixture, input = settings, batch = 1) {
  const { experiment, clock, signals, sim, sensors, params } = fixture;
  experiment.start(input);
  while (experiment.status === 'running') {
    for (let i = 0; i < batch && experiment.status === 'running'; i++) {
      clock.simTime += CONFIG.sim.step;
      signals.update(clock.simTime);
      sim.setTarget(params.maxCars * demandFactor(clock.simTime, params.scenario));
      sim.step(CONFIG.sim.step);
      sensors.tick(clock.simTime);
      experiment.afterStep();
    }
  }
  return { result: structuredClone(experiment.result), positions: [...sim.pos], edges: [...sim.edge] };
}

test('repeat runs reset vehicles, sensor measurements and timing, independent of frame batching', () => {
  const fixture = setup();
  const first = run(fixture);
  const repeated = run(fixture, settings, 17);
  assert.deepEqual(repeated, first);
  assert.equal(first.result.elapsedSeconds, 60);
  assert.equal(first.result.summary.samples, 240);
  assert.equal(first.result.status, 'completed');
  assert(first.result.summary.sensorCrossings > 0);
  assert.equal(fixture.clock.scale, 0);
  assert.notDeepEqual(run(fixture, { ...settings, seed: 43 }).positions, first.positions);
  fixture.sim.mesh.geometry.dispose(); fixture.sim.mesh.material.dispose();
});

test('scenario affects demand and export retains settings and partial sensor data', () => {
  const fixture = setup();
  const weekday = run(fixture).result;
  const weekend = run(fixture, { ...settings, scenario: 'weekend' }).result;
  assert(weekday.summary.meanActiveVehicles > weekend.summary.meanActiveVehicles);
  assert.equal(weekend.settings.scenario, 'weekend');
  assert.equal(weekend.datasetId, 'test-map');
  assert.equal(weekend.partialSensorBuckets.length, 1);
  assert.equal(weekend.records.length, 0); // 1 minute is shorter than the 5-minute bucket.
  fixture.experiment.start(settings);
  fixture.experiment.finish();
  assert.equal(fixture.experiment.result.status, 'cancelled');
  assert.equal(fixture.experiment.result.summary.samples, 0);
  assert.equal(weekend.settings.scenario, 'weekend'); // Previous result remains immutable.
  fixture.sim.mesh.geometry.dispose(); fixture.sim.mesh.material.dispose();
});

test('rejects invalid settings before resetting an existing experiment', () => {
  for (const change of [{seed:-1}, {seed:4294967296}, {scenario:'label'}, {maxCars:3001}, {durationMinutes:0}, {durationMinutes:1.5}, {green:4}]) {
    assert.throws(() => validateExperiment({...settings, ...change}));
  }
  const fixture = setup();
  fixture.experiment.start(settings);
  assert.throws(() => fixture.experiment.start({ ...settings, seed: NaN }));
  assert.equal(fixture.experiment.status, 'running');
  assert.equal(fixture.experiment.settings.seed, 42);
  fixture.sim.mesh.geometry.dispose(); fixture.sim.mesh.material.dispose();
});

test('completed sensor buckets and partial counts are exported without losing crossings', () => {
  const fixture = setup();
  const result = run(fixture, { ...settings, durationMinutes: 6, green: 35 }, 80).result;
  assert.equal(result.records.length, 1);
  assert.equal(result.signalPlan.default.green, 35);
  assert.equal(result.records[0].count + result.partialSensorBuckets[0].fwd + result.partialSensorBuckets[0].bwd,
    result.summary.sensorCrossings);
  assert.equal(result.partialSensorBuckets[0].endSeconds - result.partialSensorBuckets[0].startSeconds, 60);
  fixture.sim.mesh.geometry.dispose(); fixture.sim.mesh.material.dispose();
});
