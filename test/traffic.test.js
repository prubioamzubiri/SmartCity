import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createDemandModel } from '../src/traffic/demand.js';
import { TrafficSim } from '../src/traffic/sim.js';

// Two directed edges forming a loop; no renderer or downloaded map required.
function simulation() {
  return new TrafficSim({
    edgeCount: 2,
    A: [0, 1], B: [1, 0], rev: [1, 0], cls: [4, 4],
    outStart: [0, 1, 2], outList: [0, 1],
    ux: [1, -1], uz: [0, 0], len: [1000, 1000], speed: [8, 8],
  }, { stateForEdge: () => 0 }, () => {});
}

test('scenario changes drive existing population growth, reduction and capacity limits', () => {
  const config = structuredClone(CONFIG.traffic);
  config.dailyVariation = 0;
  const demand = createDemandModel(config);
  const sim = simulation();
  try {
    const time = 8 * 3600;
    sim.setTarget(100 * demand.demandFactor(time, 'weekday'));
    assert.equal(sim.targetCount, 100);
    sim.step(CONFIG.sim.step);
    assert.equal(sim.activeCount, 20);
    for (let i = 0; i < 4; i++) sim.step(CONFIG.sim.step);
    assert.equal(sim.activeCount, 100);

    sim.setTarget(100 * demand.demandFactor(time, 'weekend'));
    assert.equal(sim.targetCount, 23);
    sim.step(CONFIG.sim.step);
    assert.equal(sim.activeCount, 80);
    for (let i = 0; i < 3; i++) sim.step(CONFIG.sim.step);
    assert.equal(sim.activeCount, 23);
    assert.equal(sim.edgeCars.reduce((sum, cars) => sum + (cars?.length ?? 0), 0), 23);

    config.scenarios.weekday.multiplier = 10;
    const highDemand = createDemandModel(config);
    sim.setTarget(CONFIG.cars.max * highDemand.demandFactor(time, 'weekday'));
    assert.equal(sim.targetCount, CONFIG.cars.max);
    sim.setTarget(0);
    sim.step(CONFIG.sim.step);
    sim.step(CONFIG.sim.step);
    assert.equal(sim.activeCount, 0);
  } finally {
    sim.setTarget(0);
  }
});
