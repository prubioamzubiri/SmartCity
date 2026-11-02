import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { Pedestrians, pedestrianDensity } from '../src/pedestrians/pedestrians.js';
import { extractCrossings } from '../scripts/crossings.mjs';
import { createWaterMask } from '../src/city/waterMask.js';
import { pedestrianWeights } from '../src/pedestrians/weights.js';
import { classifyPoi, extractPois, POI_CATEGORIES } from '../scripts/pois.mjs';
import { SimEngine } from '../src/core/engine.js';
import { SignalController } from '../src/traffic/signals.js';

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

test('a rented bicycle makes its pedestrian walk four times faster', () => {
  const walking = new Pedestrians([], { max: 1, graph: ring(), walkFraction: 1 });
  const cycling = new Pedestrians([], { max: 1, graph: ring(), walkFraction: 1 });
  cycling.setBikeRiders(1);
  const positionsAfter = (pedestrian) => {
    pedestrian.update(50_000, 1);
    const before = [pedestrian.x[0], pedestrian.z[0]];
    pedestrian.update(50_100, 1);
    return Math.hypot(pedestrian.x[0] - before[0], pedestrian.z[0] - before[1]);
  };
  assert.ok(positionsAfter(cycling) > positionsAfter(walking) * 3.5);
  assert.throws(() => cycling.setBikeRiders(Infinity), /finite number/);
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
  for (let t = 5; t < 2 * W; t += 20) {
    p.update(t * 1000, 1);
    assert.equal(p.activeCount, 200, `se perdió algún peatón en t=${t}`);
    const now = Array.from(p.x.subarray(0, 200), (x, i) => [x, p.z[i]]);
    if (previous) {
      // 20 s a ≤1,68 m/s ≈ 34 m, más el salto lateral al girar en una esquina. Solo reaparecen (saltan) los que
      // acaban su paseo en ese intervalo, que tienen fases repartidas: ~20/W del total.
      const jumps = now.filter(([x, z], i) => Math.hypot(x - previous[i][0], z - previous[i][1]) > 34 + 2 * 4.5 * 1.5).length;
      assert.ok(jumps <= 200 * (20 / W) * 3 + 3, `demasiados saltos (${jumps}) en t=${t}`);
    }
    previous = now;
  }
});

test('walks are staggered: not all pedestrians respawn at the same time', () => {
  const p = new Pedestrians([], { max: 300, graph: ring(), walkFraction: 1 });
  const W = CONFIG.pedestrians.walkSeconds;
  let respawns = [];
  let previous;
  for (let t = 0; t < W; t += 5) {
    p.update(t * 1000, 1);
    const now = Array.from(p.x.subarray(0, 300), (x, i) => [x, p.z[i]]);
    if (previous) respawns.push(now.filter(([x, z], i) => Math.hypot(x - previous[i][0], z - previous[i][1]) > 20).length);
    previous = now;
  }
  assert.ok(Math.max(...respawns) < 300 * 0.1, `reaparecen juntos: ${Math.max(...respawns)}`);
  assert.ok(respawns.reduce((a, b) => a + b, 0) >= 200, 'cada peatón reaparece una vez por paseo');
});

test('a walk is a long, continuous route and cached results equal those computed from scratch', () => {
  const g = ring();
  const cached = new Pedestrians([], { max: 100, graph: g, walkFraction: 1 });
  const W = CONFIG.pedestrians.walkSeconds;
  for (let t = 100; t < 3 * W; t += 7) {
    cached.update(t * 1000, 1);
    const fresh = new Pedestrians([], { max: 100, graph: g, walkFraction: 1 });
    fresh.update(t * 1000, 1);
    assert.deepEqual([...cached.x.subarray(0, cached.activeCount)], [...fresh.x.subarray(0, fresh.activeCount)]);
    assert.deepEqual([...cached.z.subarray(0, cached.activeCount)], [...fresh.z.subarray(0, fresh.activeCount)]);
  }
  // Un caminante recorre ~1,4 m/s: en 10 min avanza cientos de metros por las calles.
  const one = new Pedestrians([], { max: 1, graph: g, walkFraction: 1 });
  let travelled = 0;
  let last;
  for (let t = 0; t < 600; t++) {
    one.update(t * 1000, 1);
    if (one.activeCount === 0) continue;
    const pos = [one.x[0], one.z[0]];
    if (last) {
      const d = Math.hypot(pos[0] - last[0], pos[1] - last[1]);
      if (d < 20) travelled += d;
    }
    last = pos;
  }
  assert.ok(travelled > 400, `solo recorrió ${travelled.toFixed(0)} m en 10 min`);
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

// ---- Pesos de atracción de las calles ----

// Los tramos del anillo miden 500 m (los de OSM, decenas): el radio de atracción se escala para que alcance a todo el tramo.
const WCFG = { ...CONFIG.pedestrians, streetWeights: [0, 2, 1.5, 1.2, 1], poiWeights: [1, 2, 4, 3, 1, 1.5], poiRadius: 400, maxWeight: 8 };

test('street weights follow the road class and the nearby points of interest', () => {
  const g = ring();
  const none = pedestrianWeights(g, { crossings: [] }, WCFG);
  assert.ok([...none.edge].every((w) => w === 1), 'sin POI, el peso es el de la clase');

  // Parada de bus (categoría 2, peso 4) en el centro de la calle superior (z = -250); comercio (peso 1) lejos de todo.
  const near = pedestrianWeights(g, { crossings: [0, -250, 0, 1, 4, 100, 250, 0, 1, 4], pois: [0, -250, 2, 1000, 1000, 0] }, WCFG);
  const top = g.A.findIndex((a, e) => g.nz[a] === -250 && g.nz[g.B[e]] === -250);
  const bottom = g.A.findIndex((a, e) => g.nz[a] === 250 && g.nz[g.B[e]] === 250);
  assert.ok(near.edge[top] > 1.5 * near.edge[bottom], `${near.edge[top]} frente a ${near.edge[bottom]}`);
  assert.equal(near.edge[bottom], 1, 'un POI lejos no cambia nada');
  assert.equal(near.edge[top], near.edge[g.rev[top]], 'los dos sentidos pesan igual');
  assert.ok(near.crossing[0] > near.crossing[1], 'el paso junto a la parada atrae más');
  assert.equal(near.crossing[1], 1);

  // Más cerca, más atracción; y hay un tope.
  const far = pedestrianWeights(g, { crossings: [], pois: [0, -250 + 150, 2] }, WCFG);
  assert.ok(near.edge[top] > far.edge[top]);
  const crowded = pedestrianWeights(g, { crossings: [], pois: Array.from({ length: 300 }, () => [0, -250, 2]).flat() }, WCFG);
  assert.ok(crowded.edge[top] <= WCFG.maxWeight * WCFG.streetWeights[4] + 1e-6);

  const motorway = ring();
  motorway.cls.fill(0);
  assert.ok([...pedestrianWeights(motorway, { crossings: [], pois: [0, -250, 2] }, WCFG).edge].every((w) => w === 0), 'las autovías no tienen acera');
});

// Dos calles de 500 m sin conexión (arriba, z = -250, y abajo, z = 250), en las que los peatones se dan la vuelta al llegar
// al final: nadie puede pasar de una a otra, así que el reparto depende solo de los pesos de salida.
function twoStreets() {
  const n = [[-250, -250], [250, -250], [-250, 250], [250, 250]];
  const edges = [[0, 1], [1, 0], [2, 3], [3, 2]];
  const g = {
    edgeCount: 4, A: [], B: [], cls: [4, 4, 4, 4], len: [500, 500, 500, 500], ux: [], uz: [],
    nx: n.map((p) => p[0]), nz: n.map((p) => p[1]), rev: [1, 0, 3, 2], outStart: [0, 1, 2, 3, 4], outList: [],
  };
  for (const v of [0, 1, 2, 3]) g.outList.push(edges.findIndex(([a]) => a === v));
  for (const [a, b] of edges) {
    g.A.push(a); g.B.push(b);
    g.ux.push(Math.sign(n[b][0] - n[a][0])); g.uz.push(0);
  }
  return g;
}

test('pedestrians start their walks and cross in proportion to the weights', () => {
  const g = twoStreets();
  // Tres paradas de bus en la calle de arriba y un paso de peatones en cada calle.
  const data = { crossings: [0, -250, 0, 1, 4, 0, 250, 0, 1, 4], pois: [0, -250, 2, 0, -250, 2, 0, -250, 2] };
  const weights = pedestrianWeights(g, data, WCFG);
  const ratio = weights.edge[0] / weights.edge[2];
  assert.ok(ratio > 1.5, `peso arriba/abajo ${ratio.toFixed(2)}`);

  const share = (options) => {
    const p = new Pedestrians(data.crossings, { max: 3000, graph: g, walkFraction: 1, ...options });
    let top = 0;
    let all = 0;
    for (let t = 0; t < 12000; t += 211) {
      p.update(t * 1000, 1);
      for (let i = 0; i < p.activeCount; i++) {
        all++;
        if (p.z[i] < 0) top++;
      }
    }
    return top / all;
  };
  const flat = share({});
  const weighted = share({ weights });
  assert.ok(Math.abs(flat - 0.5) < 0.03, `sin pesos ${flat.toFixed(2)}`);
  // La mitad de los peatones tiene que ir a cada calle en proporción a su peso (longitud × peso).
  const expected = ratio / (1 + ratio);
  assert.ok(Math.abs(weighted - expected) < 0.03, `con pesos ${weighted.toFixed(3)} frente a ${expected.toFixed(3)} esperado`);

  // Cruces: el paso de la calle con paradas se usa en proporción a su peso.
  const crossers = new Pedestrians(data.crossings, { max: 3000, weights, walkFraction: 0 });
  const expectedCross = weights.crossing[0] / (weights.crossing[0] + weights.crossing[1]);
  assert.ok(expectedCross > 0.6);
  let topUsed = 0;
  let total = 0;
  for (let t = 0; t < 4000; t += 20) {
    crossers.update(t * 1000, 1);
    for (let i = 0; i < crossers.activeCount; i++) {
      total++;
      if (crossers.z[i] < 0) topUsed++;
    }
  }
  assert.ok(Math.abs(topUsed / total - expectedCross) < 0.04, `paso con peso ${(topUsed / total).toFixed(3)} frente a ${expectedCross.toFixed(3)}`);
});

test('the flow model with weights matches the agents and the sensors reflect the attraction', () => {
  const g = twoStreets();
  const data = { crossings: [], pois: [0, -250, 2, 0, -250, 2] };
  const weights = pedestrianWeights(g, data, WCFG);
  const walkers = new Pedestrians([], { max: 3000, graph: g, weights, walkFraction: 1 });
  const flow = walkers.flowAt(3 * 86400 + 8 * 3600, 'weekday');
  // Personas por metro de acera en cada calle según los agentes y según el modelo (walkPerWeight × peso × 2 sentidos).
  const count = (top) => {
    let sum = 0;
    let n = 0;
    for (let t = 0; t < 12000; t += 97) {
      walkers.update(t * 1000, 1);
      for (let i = 0; i < walkers.activeCount; i++) if ((walkers.z[i] < 0) === top) sum++;
      n++;
    }
    return sum / n;
  };
  const model = (e) => flow.walkPerWeight * weights.edge[e] * 500 * 2;
  const full = flow.total * 1; // límite = max: todos caminan
  for (const [top, e] of [[true, 0], [false, 2]]) {
    const observed = count(top);
    assert.ok(Math.abs(observed - model(e)) / model(e) < 0.05, `${top ? 'arriba' : 'abajo'}: agentes ${observed.toFixed(0)} frente a modelo ${model(e).toFixed(0)}`);
  }
  assert.ok(Math.abs(model(0) + model(2) - full) < 1e-6 * full);
});

test('sensors count more where the street attracts more pedestrians', () => {
  const data = { ...engineCity(), pois: [0, -250, 2, 5, -250, 2, -5, -250, 1] };
  const engine = new SimEngine({ data });
  const attracted = engine.pedSensors.add(0, -250);
  const plain = engine.pedSensors.add(0, 250);
  assert.ok(attracted.weight > plain.weight * 1.3, `${attracted.weight} frente a ${plain.weight}`);
  const t = 3 * 86400 + 8 * 3600;
  const a = engine.pedSensors.expected(attracted, t, 'weekday', 12000);
  const b = engine.pedSensors.expected(plain, t, 'weekday', 12000);
  assert.ok(a.walk > b.walk * 1.3 && a.present > b.present * 1.3);
  // La atracción reparte, no crea gente: la suma ponderada de todas las calles sigue siendo el total.
  const f = engine.pedestrians.flowAt(t, 'weekday', 12000);
  const g = engine.graph;
  let weightedLength = 0;
  for (let e = 0; e < g.edgeCount; e++) weightedLength += g.len[e] * engine.pedestrians.weightOf(e);
  assert.ok(Math.abs(f.walkPerWeight * weightedLength - f.total * engine.pedestrians.walkFraction) < 1e-6 * f.total || engine.pedestrians.count === 0);
});

function engineCity() {
  return { nodes: [-250, -250, 250, -250, 250, 250, -250, 250], ways: [[4, 0, 0, 1, 2, 3, 0]], signals: [], parking: { underground: [] }, crossings: [] };
}

test('points of interest are classified and bus stops are merged', () => {
  assert.equal(classifyPoi({ shop: 'bakery' }), 0);
  assert.equal(classifyPoi({ amenity: 'cafe' }), 1);
  assert.equal(classifyPoi({ highway: 'bus_stop' }), 2);
  assert.equal(classifyPoi({ amenity: 'school' }), 3);
  assert.equal(classifyPoi({ amenity: 'pharmacy' }), 4);
  assert.equal(classifyPoi({ tourism: 'museum' }), 5);
  assert.equal(classifyPoi({ shop: 'vacant' }), -1);
  assert.equal(classifyPoi({ amenity: 'bench' }), -1);
  assert.equal(classifyPoi(undefined), -1);
  assert.equal(POI_CATEGORIES.length, 6);

  const project = (lat, lon) => [lon, lat];
  const elements = [
    { type: 'node', lat: 0, lon: 0, tags: { highway: 'bus_stop' } },
    { type: 'node', lat: 2, lon: 3, tags: { public_transport: 'platform' } }, // misma parada (a 3,6 m)
    { type: 'node', lat: 0, lon: 100, tags: { highway: 'bus_stop' } },
    { type: 'way', center: { lat: 5, lon: 5 }, tags: { shop: 'supermarket' } },
    { type: 'node', lat: 6, lon: 5, tags: { shop: 'bakery' } }, // dos comercios juntos: ambos cuentan
    { type: 'way', tags: { shop: 'clothes' } }, // sin posición: se ignora
    { type: 'node', lat: 1, lon: 1, tags: { amenity: 'bench' } },
  ];
  assert.deepEqual(extractPois(elements, project), [0, 0, 2, 100, 0, 2, 5, 5, 0, 5, 6, 0]);
});

test('pedestrians cross at a signalled crosswalk only while the cars on that street are red', () => {
  const controller = new SignalController({ signals: [{ id: 1, active: true, x: 100, z: 50 }], sig: [], grp: [] });
  controller.states = new Uint8Array(2);
  const p = new Pedestrians(CROSSINGS, { max: 300, signals: controller });
  assert.equal(p.crossSignal[0], 0);
  assert.equal(p.crossGroup[0], 0); // calle por X = grupo 0 (E-O)
  const scale = 52.14;
  let crossing = 0;
  let waiting = 0;
  for (let sim = 100000; sim < 103000; sim += 1) {
    controller.update(sim);
    p.updateAt(sim, 'auto', scale);
    for (let i = 0; i < p.activeCount; i++) {
      if (Math.abs(Math.abs(p.z[i] - 50) - HALF) < 1e-3) {
        waiting++; // esperando en el bordillo, puede ser con verde para los coches
        continue;
      }
      crossing++;
      assert.equal(controller.states[0], 2, `cars must be red at ${sim}`);
    }
  }
  assert.ok(crossing > 0);
  assert.ok(waiting > 0);
});
