import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFeatures, projectCoordinate, validateMunicipalSnapshot } from '../src/data/municipal.js';
import { matchSpeedLimits } from '../src/data/speedLimits.js';
import { TrafficSim } from '../src/traffic/sim.js';
import { Experiment } from '../src/simulation/experiment.js';

const origin = { lat: 43.3183, lon: -1.9812 };
test('official WGS84 features share the OSM metre projection and distinguish limits from observations', () => {
  assert.deepEqual(projectCoordinate([origin.lon, origin.lat], origin), [0, -0]);
  const projected = projectCoordinate([origin.lon + 0.001, origin.lat + 0.001], origin);
  assert(projected[0] > 80 && projected[0] < 82);
  assert.equal(projected[1], -110.6);
  const feature = { type: 'Feature', id: 0, properties: { Kalea: 'Test', Abiadura: '30' },
    geometry: { type: 'MultiLineString', coordinates: [[[origin.lon, origin.lat], [origin.lon + 0.001, origin.lat]]] } };
  const result = normalizeFeatures('speedLimits', { type: 'FeatureCollection', features: [feature] }, origin);
  assert.equal(result[0].id, 0);
  assert.equal(result[0].limitKmh, 30);
  feature.properties.Abiadura = 'sin dato';
  assert.equal(normalizeFeatures('speedLimits', { type: 'FeatureCollection', features: [feature] }, origin)[0].limitKmh, null);
  assert.throws(() => projectCoordinate([580000, 4790000], origin));
  feature.geometry = null;
  assert.throws(() => normalizeFeatures('speedLimits', { type: 'FeatureCollection', features: [feature] }, origin));
});
function graph() {
  return { edgeCount: 2, A: [0, 1], B: [1, 0], nx: [0, 100], nz: [0, 0], ux: [1, -1], uz: [0, 0],
    len: [100, 100], cls: [4, 4], speed: [8, 8], rev: [1, 0], outStart: [0, 1, 2], outList: [0, 1] };
}
const feature = (paths, limitKmh = 20) => ({ id: 1, name: 'Road', paths, limitKmh });
test('limits match both directions only when all three samples are near aligned geometry', () => {
  const g = graph();
  assert.equal(matchSpeedLimits(g, [feature([[0, 2, 100, 2]])]).matched, 2);
  assert.equal(matchSpeedLimits(g, [feature([[0, 9, 100, 9]])]).matched, 0);
  assert.equal(matchSpeedLimits(g, [feature([[50, -50, 50, 50]])]).matched, 0);
  assert.equal(matchSpeedLimits(g, [feature([[40, 0, 60, 0]])]).matched, 0);
  assert.equal(matchSpeedLimits(g, [feature([[0, 0, 100, 0]], null)]).matched, 0);
  assert.equal(matchSpeedLimits(g, [feature([[0, 0, 100, 0]], 20), feature([[0, 0, 100, 0]], 30)]).matched, 0);
});
test('official legal cap is respected even by drivers with a speed factor above one', () => {
  const g = graph(); g.speedCaps = new Float32Array(2).fill(10 / 3.6);
  const sim = new TrafficSim(g, { stateForEdge: () => 0 }, () => {}, () => 0.99);
  sim.setTarget(1);
  for (let i = 0; i < 100; i++) sim.step(0.25);
  assert(sim.speed[0] <= g.speedCaps[sim.edge[0]]);
  assert(sim.factor[0] > 1);
  sim.mesh.geometry.dispose(); sim.mesh.material.dispose();
});
test('snapshot rejects a different map origin and invalid coordinates or caps', () => {
  const data = { version: 1, datasetId: 'a'.repeat(64), fetchedAt: '2026-10-16T12:00:00Z', origin,
    layers: { roads: [feature([[0, 0, 100, 0]])], speedLimits: [feature([[0, 0, 100, 0]])], stations: [{ id: 0, name: 'Station', x: 0, z: 0 }] } };
  assert.equal(validateMunicipalSnapshot(data, origin), data);
  assert.throws(() => validateMunicipalSnapshot(data, { ...origin, lat: 44 }));
  data.layers.speedLimits[0].limitKmh = Infinity;
  assert.throws(() => validateMunicipalSnapshot(data, origin));
});
test('experiment captures active municipal provenance while keeping outputs simulated', () => {
  const context = { datasetId: 'a'.repeat(64), matchedEdges: 2 };
  const clock = { simTime: 0, scale: 1 };
  const signals = { plan: {}, setGlobalGreen() {}, update() {} };
  const experiment = new Experiment({ clock, params: {}, signals, datasetId: 'osm-map',
    sim: { g: { municipalContext: context }, reset() {} },
    sensors: { bucketSeconds: 300, sensors: [], records: [], resetMeasurements() {} } });
  experiment.start({ seed: 42, scenario: 'weekday', maxCars: 10, durationMinutes: 1, green: 20 });
  assert.equal(experiment.snapshot.municipalSpeedLimits.datasetId, context.datasetId);
  assert.equal(experiment.snapshot.dataOrigin, 'simulated');
  context.matchedEdges = 0;
  assert.equal(experiment.snapshot.municipalSpeedLimits.matchedEdges, 2);
});
