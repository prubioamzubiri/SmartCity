import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { Pedestrians, pedestrianDensity } from '../src/pedestrians/pedestrians.js';
import { extractCrossings } from '../scripts/crossings.mjs';

// Un paso en (100, 50) sobre una calle residencial (clase 4) que va por X: se cruza en dirección Z.
const CROSSINGS = [100, 50, 0, 1, 4];
const HALF = CONFIG.roads.halfWidth[4] + CONFIG.pedestrians.margin;

function sample(p, seconds, density = 1) {
  const seen = [];
  for (let t = 0; t < seconds * 1000; t += 500) {
    p.update(t, density);
    for (let i = 0; i < p.activeCount; i++) seen.push({ x: p.x[i], z: p.z[i], heading: p.heading[i] });
  }
  return seen;
}

test('pedestrians only walk along the crosswalk, across the road', () => {
  const seen = sample(new Pedestrians(CROSSINGS, { max: 50 }), 200);
  assert.ok(seen.length > 0);
  for (const s of seen) {
    assert.ok(Math.abs(s.x - 100) <= CONFIG.pedestrians.laneWidth / 2 + 1e-3);
    assert.ok(Math.abs(s.z - 50) <= HALF + 1e-3);
    // Caminan en ±Z: el triángulo (+X) gira ±90° sobre Y
    assert.ok(Math.abs(Math.abs(s.heading) - Math.PI / 2) < 1e-3);
  }
});

test('pedestrians are deterministic, scale with density and need crossings', () => {
  const a = sample(new Pedestrians(CROSSINGS, { max: 200 }), 80);
  const b = sample(new Pedestrians(CROSSINGS, { max: 200 }), 80);
  assert.deepEqual(a, b);
  const few = sample(new Pedestrians(CROSSINGS, { max: 200 }), 80, 0.1);
  assert.ok(few.length < a.length / 3);
  assert.equal(sample(new Pedestrians(CROSSINGS, { max: 200 }), 80, 0).length, 0);
  assert.equal(sample(new Pedestrians([], { max: 200 }), 80).length, 0);
  assert.equal(sample(new Pedestrians(undefined, { max: 200 }), 80).length, 0);
});

test('pedestrian density keeps a minimum and caps at 1', () => {
  assert.equal(pedestrianDensity(0), CONFIG.pedestrians.minDensity);
  assert.equal(pedestrianDensity(5), 1);
});

test('extractCrossings creates one perpendicular crossing per marked crossing node', () => {
  const project = (lat, lon) => [lon, -lat];
  const node = (id, lon, lat, tags) => [id, { id, lon, lat, tags }];
  const nodes = new Map([
    node(1, 0, 0), node(2, 10, 0, { highway: 'crossing', crossing: 'zebra' }), node(3, 20, 0),
    node(4, 30, 0, { highway: 'crossing', crossing: 'unmarked' }), node(5, 40, 0, { highway: 'traffic_signals' }),
  ]);
  const ways = [{ nodes: [1, 2, 3, 4, 5], tags: { highway: 'residential' } }, { nodes: [2, 3], tags: { highway: 'primary' } }];
  const out = extractCrossings(ways, nodes, project, (tags) => (tags.highway === 'primary' ? 1 : 4));
  assert.deepEqual(out.map((v) => v + 0), [10, 0, 0, 1, 4]);
});
