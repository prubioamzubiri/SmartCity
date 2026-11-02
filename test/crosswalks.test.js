import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { Pedestrians } from '../src/pedestrians/pedestrians.js';
import { SignalController } from '../src/traffic/signals.js';
import { SimEngine } from '../src/core/engine.js';
import { createCrosswalks } from '../src/city/crosswalks.js';

// Los pasos de peatones, el reloj de los peatones y los semáforos se prueban por su contrato (estados de los
// semáforos, posiciones de los peatones), no por su implementación: así valen igual para nuevos agentes
// (transporte público, bicis) que compartan semáforos o pasos.
const P = CONFIG.pedestrians;
const SERVER_SCALE = 365 / 7;
const SCENARIO = 'auto';
const T0 = 100000;
const RED = 2;
const HALF = CONFIG.roads.halfWidth[4] + P.margin;

// Paso en (100, 50) sobre una calle residencial que va por X (se cruza en Z → grupo 0) o por Z (se cruza en X → grupo 1).
const EW_STREET = [100, 50, 0, 1, 4];
const NS_STREET = [100, 50, 1, 0, 4];

function world({ crossing = EW_STREET, signalAt = { x: 100, z: 50 }, active = true, plan, max = 300 } = {}) {
  const controller = new SignalController({ signals: [{ id: 7, active, ...signalAt }], sig: [], grp: [] });
  controller.states = new Uint8Array(2);
  if (plan) controller.setPlan(plan);
  const pedestrians = new Pedestrians(crossing, { max, signals: controller });
  return { controller, pedestrians, group: Math.abs(crossing[3]) >= Math.abs(crossing[2]) ? 0 : 1 };
}

// Posición del peatón `i` relativa al paso: `along` en la dirección de cruce, `lateral` a lo largo de la calle.
const relative = (p, i, c) => ({
  along: (p.x[i] - c[0]) * c[2] + (p.z[i] - c[1]) * c[3],
  lateral: -(p.x[i] - c[0]) * c[3] + (p.z[i] - c[1]) * c[2],
});

function run({ controller, pedestrians }, crossing, { from = T0, seconds = 3000, scale = SERVER_SCALE, onTick }) {
  for (let sim = from; sim < from + seconds; sim++) {
    controller.update(sim);
    pedestrians.updateAt(sim, SCENARIO, scale);
    onTick(sim);
  }
}

test('pedestrian clock: on-screen speed is speed × clockScale and never exceeds the server scale', () => {
  assert.ok(P.clockScale >= 1 && P.clockScale <= SERVER_SCALE, 'clockScale por defecto entre ×1 y la escala del servidor');
  const p = new Pedestrians(EW_STREET, { max: 1 });
  // Con una escala menor que clockScale se queda en ×scale (tiempo real igual que los coches); con una mayor, en ×clockScale.
  for (const [scale, expected] of [[1, 1], [P.clockScale / 2, P.clockScale / 2], [SERVER_SCALE, P.clockScale], [1000, P.clockScale]]) {
    p.updateAt(T0, SCENARIO, scale);
    assert.equal(p.simPerSecond, scale / expected);
  }
});

test('pedestrian positions depend only on the simulated time, not on how often they are sampled', () => {
  const a = world();
  const b = world();
  const at = (w, sim) => {
    w.controller.update(sim);
    w.pedestrians.updateAt(sim, SCENARIO, SERVER_SCALE);
    return Array.from(w.pedestrians.x.subarray(0, w.pedestrians.activeCount)).concat(Array.from(w.pedestrians.z.subarray(0, w.pedestrians.activeCount)));
  };
  let expected;
  for (let sim = T0; sim <= T0 + 120; sim++) {
    const full = at(a, sim);
    if (sim === T0 + 120) expected = full;
  }
  assert.deepEqual(at(b, T0 + 120), expected); // salto directo = recorrido segundo a segundo
});

for (const [name, crossing] of [['E-W street', EW_STREET], ['N-S street', NS_STREET]]) {
  test(`signalled crosswalk (${name}): pedestrians only cross while the cars on that street are red`, () => {
    const w = world({ crossing });
    assert.equal(w.pedestrians.crossSignal[0], 0);
    assert.equal(w.pedestrians.crossGroup[0], w.group);
    let crossing_ = 0;
    let waiting = 0;
    run(w, crossing, {
      onTick(sim) {
        const p = w.pedestrians;
        for (let i = 0; i < p.activeCount; i++) {
          const { along, lateral } = relative(p, i, crossing);
          assert.ok(Math.abs(lateral) <= P.laneWidth / 2 + 1e-3);
          assert.ok(Math.abs(along) <= HALF + 1e-3);
          if (Math.abs(Math.abs(along) - HALF) < 1e-3) {
            waiting++; // en el bordillo, con cualquier color
            continue;
          }
          crossing_++;
          assert.equal(w.controller.states[w.group], RED, `cars must be red at ${sim}`);
        }
      },
    });
    assert.ok(crossing_ > 0, 'alguien cruza');
    assert.ok(waiting > 0, 'alguien espera en el bordillo');
  });
}

test('the red window matches the signal states for both groups and asymmetric greens', () => {
  const plan = { default: { green: 20, yellow: 3 }, signals: { 7: { greenA: 12, greenB: 31, yellow: 4 } } };
  const w = world({ plan });
  const { controller, pedestrians } = w;
  for (const g of [0, 1]) {
    for (let sim = T0; sim < T0 + 400; sim += 0.5) {
      controller.update(sim);
      pedestrians.simNow = sim;
      pedestrians.timings.length = 0;
      const win = pedestrians.redWindow(0, g, sim);
      const red = controller.states[g] === RED;
      assert.equal(win.current, red, `grupo ${g} en ${sim}`);
      if (win.current) assert.ok(win.start <= sim + 1e-9 && sim < win.start + win.length);
      else assert.ok(win.start >= sim - 1e-9, 'la próxima ventana empieza en el futuro');
      // Dentro de la ventana el color es rojo; justo fuera, no.
      controller.update(win.start + win.length / 2);
      assert.equal(controller.states[g], RED);
      controller.update(win.start + win.length + 0.01);
      assert.notEqual(controller.states[g], RED);
    }
  }
});

test('crosswalks that are not near an active signal are unregulated', () => {
  for (const options of [{ signalAt: { x: 100 + P.signalRadius + 5, z: 50 } }, { active: false }]) {
    const w = world(options);
    assert.equal(w.pedestrians.crossSignal[0], -1);
    const seen = new Set();
    run(w, EW_STREET, {
      seconds: 600,
      onTick() {
        const p = w.pedestrians;
        for (let i = 0; i < p.activeCount; i++) seen.add(Math.round(relative(p, i, EW_STREET).along));
      },
    });
    assert.ok(seen.size > HALF, 'cruzan a cualquier hora, en todas las posiciones del paso');
  }
});

test('the closest active signal regulates the crosswalk', () => {
  const controller = new SignalController({
    signals: [
      { id: 1, active: true, x: 100, z: 50 + P.signalRadius - 5 },
      { id: 2, active: true, x: 100, z: 50 + 10 },
      { id: 3, active: false, x: 100, z: 50 + 1 },
    ],
    sig: [],
    grp: [],
  });
  assert.equal(new Pedestrians(EW_STREET, { signals: controller }).crossSignal[0], 1);
});

test('nobody crosses when the red is shorter than the minimum useful window', () => {
  // Rojo del eje E-O = ciclo − verde − ámbar = (5 + 1 + 5 + 1) − 5 − 1 = 6 s; con la reserva de seguridad no queda ventana útil.
  const plan = { default: { green: 5, yellow: 1 }, signals: {} };
  const w = world({ plan });
  const room = 6 - 2 * P.redMargin;
  assert.ok(room < P.minRedWindow, 'el escenario del test debe quedar por debajo del mínimo');
  let crossing = 0;
  run(w, EW_STREET, { seconds: 1500, onTick: () => (crossing += w.pedestrians.activeCount) });
  assert.equal(crossing, 0);
});

test('the signal plan changes the crossing windows', () => {
  const long = world({ plan: { default: { green: 40, yellow: 3 }, signals: {} } });
  const w = long.pedestrians;
  long.controller.update(T0);
  w.simNow = T0;
  const window40 = w.redWindow(0, 0, T0).length;
  long.controller.setPlan({ default: { green: 10, yellow: 3 }, signals: {} });
  w.timings.length = 0;
  assert.ok(w.redWindow(0, 0, T0).length < window40);
});

test('the engine regulates its crosswalks with its own signal controller', () => {
  const data = {
    nodes: [-250, -250, 250, -250, 250, 250, -250, 250],
    ways: [[4, 0, 0, 1, 2, 3, 0]],
    signals: [],
    parking: { underground: [] },
    crossings: EW_STREET,
  };
  const engine = new SimEngine({ data });
  assert.equal(engine.pedestrians.signals, engine.signals);
  const out = engine.pedestrianPositions(SERVER_SCALE);
  assert.equal(typeof out.activeCount, 'number');
});

test('zebra stripes: one set per crossing, laid across the road and centred on it', () => {
  assert.equal(createCrosswalks({}).count, 0);
  assert.equal(createCrosswalks({ crossings: [] }).count, 0);
  const Z = CONFIG.pedestrians.zebra;
  const road = CONFIG.roads.halfWidth[4];
  const stripes = Math.max(1, Math.floor((2 * road) / (Z.stripe + Z.gap)));
  const one = createCrosswalks({ crossings: EW_STREET });
  assert.equal(one.count, stripes);
  const two = createCrosswalks({ crossings: [...EW_STREET, 500, 500, 1, 0, 1] });
  assert.equal(two.count, stripes + Math.max(1, Math.floor((2 * CONFIG.roads.halfWidth[1]) / (Z.stripe + Z.gap))));
  const m = one.instanceMatrix.array;
  let cz = 0;
  for (let k = 0; k < one.count; k++) {
    assert.ok(Math.abs(m[k * 16 + 12] - 100) < 1e-4, 'sobre la línea del paso');
    cz += m[k * 16 + 14];
  }
  assert.ok(Math.abs(cz / one.count - 50) < 1e-3, 'centradas en el paso');
});
