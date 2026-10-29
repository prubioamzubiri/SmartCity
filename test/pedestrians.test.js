import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { Pedestrians, pedestrianDensity } from '../src/pedestrians/pedestrians.js';
import { extractCrossings } from '../scripts/crossings.mjs';
import { createWaterMask } from '../src/city/waterMask.js';

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

// Anillo cuadrado de ±250 m, calles residenciales (clase 4) en ambos sentidos.
const ring = () => {
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0]].flatMap(([a, b]) => [[a, b], [b, a]]);
  const n = [[-250, -250], [250, -250], [250, 250], [-250, 250]];
  const g = {
    edgeCount: edges.length, A: [], B: [], cls: [], len: [], ux: [], uz: [], nx: n.map((p) => p[0]), nz: n.map((p) => p[1]),
    rev: edges.map(([a, b]) => edges.findIndex(([c, d]) => c === b && d === a)), outStart: [0, 2, 4, 6, 8], outList: [],
  };
  for (let v = 0; v < 4; v++) edges.forEach(([a], e) => a === v && g.outList.push(e));
  for (const [a, b] of edges) {
    const dx = n[b][0] - n[a][0];
    const dz = n[b][1] - n[a][1];
    const l = Math.hypot(dx, dz);
    g.A.push(a); g.B.push(b); g.cls.push(4); g.len.push(l); g.ux.push(dx / l); g.uz.push(dz / l);
  }
  return g;
};

test('pedestrians also walk along the sidewalks of the streets', () => {
  const p = new Pedestrians([], { max: 300, graph: ring(), walkFraction: 1 });
  const offset = CONFIG.roads.halfWidth[4] + CONFIG.pedestrians.margin / 2;
  let seen = 0;
  for (let t = 0; t < 400_000; t += 3000) {
    p.update(t, 1);
    assert.ok(p.activeCount > 100, 'caminan casi todos: solo desaparecen al llegar al final del tramo');
    for (let i = 0; i < p.activeCount; i++) {
      const onX = Math.abs(Math.abs(p.x[i]) - 250 - offset) < 1e-2 && Math.abs(p.z[i]) <= 250 + 1e-2;
      const onZ = Math.abs(Math.abs(p.z[i]) - 250 - offset) < 1e-2 && Math.abs(p.x[i]) <= 250 + 1e-2;
      const inner = Math.abs(250 - offset - Math.abs(p.x[i])) < 1e-2 || Math.abs(250 - offset - Math.abs(p.z[i])) < 1e-2;
      assert.ok(onX || onZ || inner, `peatón fuera de las aceras (${p.x[i]}, ${p.z[i]})`);
      seen++;
    }
  }
  assert.ok(seen > 0);
});

test('walkers and crossers are mixed and walkers do not walk on the motorway', () => {
  const mixed = new Pedestrians(CROSSINGS, { max: 300, graph: ring() });
  mixed.update(5000, 1);
  assert.ok(mixed.activeCount > 150);
  const motorway = ring();
  motorway.cls.fill(0);
  assert.equal(new Pedestrians([], { max: 300, graph: motorway, walkFraction: 1 }).sidewalks, null);
});

test('walkers keep walking through the junctions instead of vanishing at the end of a street', () => {
  const p = new Pedestrians([], { max: 200, graph: ring(), walkFraction: 1 });
  const W = CONFIG.pedestrians.walkSeconds;
  let previous;
  // Dos paseos completos: el anillo no tiene salida, así que ningún peatón puede desaparecer.
  for (let t = 5; t < 2 * W - 5; t += 20) {
    p.update(t * 1000, 1);
    assert.equal(p.activeCount, 200, `se perdió algún peatón en t=${t}`);
    const now = Array.from(p.x.subarray(0, 200), (x, i) => [x, p.z[i]]);
    if (previous && Math.floor(t / W) === Math.floor((t - 20) / W)) {
      now.forEach(([x, z], i) => {
        // 20 s a ≤1,68 m/s ≈ 34 m, más el salto lateral de ±2×4,5 m al girar en una esquina.
        assert.ok(Math.hypot(x - previous[i][0], z - previous[i][1]) < 34 + 2 * 4.5 * 1.5, `salto en t=${t}`);
      });
    }
    previous = now;
  }
});

test('walkers cover a long route: a walk lasts several hundred metres', () => {
  const g = ring();
  const p = new Pedestrians([], { max: 200, graph: g, walkFraction: 1 });
  const W = CONFIG.pedestrians.walkSeconds;
  p.update(W * 1000, 1);
  const start = Array.from(p.x.subarray(0, 200), (x, i) => [x, p.z[i]]);
  p.update((2 * W - 1) * 1000, 1);
  // Un anillo de 2.000 m: tras casi 10 min (~800 m) la mayoría está lejos de donde salió.
  const far = start.filter(([x, z], i) => Math.hypot(x - p.x[i], z - p.z[i]) > 100).length;
  assert.ok(far > 150, `solo ${far} se alejaron`);
});

test('walkers turn around in a dead end and vanish only when there is no way on', () => {
  const g = ring();
  g.cls.fill(0);
  g.cls[0] = 4; g.cls[g.rev[0]] = 4;
  const p = new Pedestrians([], { max: 100, graph: g, walkFraction: 1 });
  for (let t = 0; t < 2000; t += 30) {
    p.update(t * 1000, 1);
    for (let i = 0; i < p.activeCount; i++) assert.ok(Math.abs(p.z[i] + 250) < 6 && Math.abs(p.x[i]) <= 250.1);
  }
});

const BOUNDS = { minX: -300, maxX: 300, minZ: -300, maxZ: 300 };
const rect = (x0, z0, x1, z1) => [x0, z0, x1, z0, x1, z1, x0, z1, x0, z0];

test('water mask covers polygons (minus their islands) and rivers', () => {
  const water = createWaterMask({
    bounds: BOUNDS,
    water: { polygons: [[rect(-100, -100, 100, 100), rect(-20, -20, 20, 20)]], lines: [[-250, 200, 250, 200]] },
  });
  assert.equal(water.inWater(60, 0), true);
  assert.equal(water.inWater(0, 0), false, 'isla dentro del polígono');
  assert.equal(water.inWater(150, 0), false);
  assert.equal(water.inWater(0, 200 + 10), true, 'dentro de la cinta del río');
  assert.equal(water.inWater(0, 200 + 16), false);
  assert.equal(water.inWater(9999, 9999), false, 'fuera del mapa');
  assert.equal(createWaterMask({ bounds: BOUNDS }).inWater(0, 0), false);
});

test('pedestrians stay out of the water, except on bridges where they stay on the roadway', () => {
  const road = CONFIG.roads.halfWidth[4];
  // Mar al norte de la calle superior (z = -250): la acera exterior (z ≈ -254,5) cae en el agua. Un río cruza la
  // calle derecha (x = 250) entre z = -50 y z = 50: puente.
  const data = {
    bounds: BOUNDS,
    water: { polygons: [[rect(-400, -400, 400, -252)]], lines: [[250, -50, 250, 50]] },
  };
  const water = createWaterMask(data);
  const p = new Pedestrians([], { max: 400, graph: ring(), water, walkFraction: 1 });
  let onBridge = 0;
  for (let t = 0; t < 3000; t += 23) {
    p.update(t * 1000, 1);
    assert.ok(p.activeCount > 100, 'la acera interior sigue disponible');
    for (let i = 0; i < p.activeCount; i++) {
      const [x, z] = [p.x[i], p.z[i]];
      if (!water.inWater(x, z)) continue;
      // Si pisa agua, es la calzada de un puente: junto al eje de la calle y no en el mar de al lado.
      assert.ok(Math.abs(x - 250) <= road * 0.7 + 1e-3 && Math.abs(z) <= 50 + 12 + 1e-3, `peatón en el agua en (${x}, ${z})`);
      onBridge++;
    }
  }
  assert.ok(onBridge > 0, 'se puede cruzar el puente');
});

test('a crossing on the water is only used on a bridge, within the roadway', () => {
  const road = CONFIG.roads.halfWidth[4];
  const data = { bounds: BOUNDS, water: { polygons: [[rect(-400, -400, 400, -252)]], lines: [] } };
  const water = createWaterMask(data);
  const coast = new Pedestrians([0, -249, 0, 1, 4], { max: 200, water });
  const bridge = new Pedestrians([0, -270, 0, 1, 4], { max: 200, water });
  let onLand = 0;
  let overWater = 0;
  for (let t = 0; t < 3000; t += 1) {
    coast.update(t * 1000, 1);
    for (let i = 0; i < coast.activeCount; i++) assert.ok(!water.inWater(coast.x[i], coast.z[i]), 'no cruza hacia el agua');
    onLand += coast.activeCount;
    bridge.update(t * 1000, 1);
    for (let i = 0; i < bridge.activeCount; i++) {
      assert.ok(Math.abs(bridge.z[i] + 270) <= road + 1e-3, 'en el puente solo pisa la calzada');
      overWater++;
    }
  }
  assert.ok(onLand > 0 && overWater > 0);
});
