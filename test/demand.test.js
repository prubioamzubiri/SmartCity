import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createDemandModel, demandFactor, simDate, dayIndex } from '../src/traffic/demand.js';

const DAY = 86400;
const HOUR = 3600;
function settings() {
  const config = structuredClone(CONFIG.traffic);
  config.dailyVariation = 0;
  return config;
}
function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
}

test('automatic selection follows all seven UTC calendar days and repeats', () => {
  const model = createDemandModel();
  for (let day = 0; day < 21; day++) {
    assert.equal(model.scenarioForTime(day * DAY), day % 7 >= 5 ? 'weekend' : 'weekday');
  }
  assert.equal(model.scenarioForTime(5 * DAY - 0.25), 'weekday');
  assert.equal(model.scenarioForTime(5 * DAY), 'weekend');
  assert.equal(model.scenarioForTime(7 * DAY - 0.25), 'weekend');
  assert.equal(model.scenarioForTime(7 * DAY), 'weekday');
});

test('calendar selection supports non-Monday starts and negative offsets', () => {
  const model = createDemandModel(settings(), Date.UTC(2026, 0, 10));
  assert.equal(model.scenarioForTime(0), 'weekend');
  assert.equal(model.scenarioForTime(2 * DAY), 'weekday');
  assert.equal(model.scenarioForTime(-1), 'weekday');
  close(model.demandFactor(-HOUR), CONFIG.traffic.scenarios.weekday.hourly[23]);
});

test('explicit scenarios override the calendar and configured mode is respected', () => {
  const config = settings();
  config.scenario = 'weekend';
  const model = createDemandModel(config);
  close(model.demandFactor(8 * HOUR), 0.35 * 0.65);
  close(model.demandFactor(5 * DAY + 8 * HOUR, 'weekday'), 1);
  close(model.demandFactor(8 * HOUR, 'auto'), 1);
});

test('custom curves interpolate hourly, including 23:00 to midnight', () => {
  const config = settings();
  config.scenarios.weekday.hourly = Array(24).fill(0);
  config.scenarios.weekday.hourly[0] = 0.8;
  config.scenarios.weekday.hourly[23] = 0.4;
  config.scenarios.weekday.multiplier = 2;
  const model = createDemandModel(config);
  close(model.demandFactor(0), 1.6);
  close(model.demandFactor(HOUR / 2), 0.8);
  close(model.demandFactor(23.5 * HOUR), 1.2);
  close(model.demandFactor(DAY), 1.6);
  config.scenarios.weekday.hourly[0] = 0;
  close(model.demandFactor(0), 1.6); // configuration is copied
});

test('automatic mode switches curves at midnight; forced modes keep their curve', () => {
  const config = settings();
  config.scenarios.weekday.hourly.fill(0.8);
  config.scenarios.weekend.hourly.fill(0.2);
  const model = createDemandModel(config);
  close(model.demandFactor(5 * DAY - 0.25), 0.8);
  close(model.demandFactor(5 * DAY), 0.13);
  close(model.demandFactor(7 * DAY), 0.8);
  close(model.demandFactor(7 * DAY, 'weekend'), 0.13);
});

test('weekday defaults retain the original curve and deterministic daily variation', () => {
  for (let day = 0; day < 5; day++) {
    const noise = 0.9 + 0.2 * (Math.abs(Math.sin(day * 12.9898) * 43758.5453) % 1);
    close(demandFactor(day * DAY + 8 * HOUR), noise);
    assert.equal(demandFactor(day * DAY), demandFactor(day * DAY));
  }
  const model = createDemandModel(settings());
  assert.ok(model.demandFactor(5 * DAY + 12 * HOUR) > model.demandFactor(5 * DAY + 8 * HOUR));
  close(model.demandFactor(8 * HOUR), 1);
});

test('clock helpers and demand use the same UTC clock including base time of day', () => {
  assert.equal(simDate(5 * DAY).getUTCDay(), 6);
  assert.equal(dayIndex(-1), -1);
  const model = createDemandModel(settings(), Date.UTC(2026, 0, 9, 23, 30));
  close(model.demandFactor(0), (0.1 + 0.06) / 2);
  assert.equal(model.scenarioForTime(HOUR), 'weekend');
});

test('invalid configuration and inputs fail clearly', () => {
  const invalid = [
    (c) => { c.scenario = 'holiday'; },
    (c) => { c.dailyVariation = -1; },
    (c) => { c.dailyVariation = NaN; },
    (c) => { c.dailyVariation = 1.1; },
    (c) => { delete c.scenarios.weekend; },
    (c) => { c.scenarios.weekday.hourly.pop(); },
    (c) => { c.scenarios.weekday.hourly[0] = '0.5'; },
    (c) => { delete c.scenarios.weekday.hourly[0]; },
    (c) => { c.scenarios.weekday.hourly[0] = Infinity; },
    (c) => { c.scenarios.weekday.hourly[0] = -0.1; },
    (c) => { c.scenarios.weekday.hourly[0] = 1.1; },
    (c) => { c.scenarios.weekend.multiplier = -1; },
    (c) => { c.scenarios.weekend.multiplier = NaN; },
  ];
  for (const mutate of invalid) {
    const config = settings();
    mutate(config);
    assert.throws(() => createDemandModel(config), /Traffic|traffic/);
  }
  assert.throws(() => createDemandModel(settings(), NaN), /baseDate/);
  const model = createDemandModel();
  assert.throws(() => model.demandFactor(0, 'holiday'), /scenario/);
  for (const value of [NaN, Infinity, '0']) {
    assert.throws(() => model.demandFactor(value), /Simulation time/);
  }
});

test('zero multiplier disables demand for one scenario', () => {
  const config = settings();
  config.scenarios.weekend.multiplier = 0;
  const model = createDemandModel(config);
  assert.equal(model.demandFactor(5 * DAY + 12 * HOUR), 0);
  assert.ok(model.demandFactor(12 * HOUR) > 0);
});
