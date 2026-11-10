import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createDemandModel, demandFactor, demandNoise, simDate, dayIndex } from '../src/traffic/demand.js';

const DAY = 86400;
const HOUR = 3600;
function settings() {
  const config = structuredClone(CONFIG.traffic);
  config.dailyVariation = 0;
  config.hourlyVariation = 0;
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
  close(model.demandFactor(8 * HOUR), CONFIG.traffic.scenarios.weekend.hourly[8] * CONFIG.traffic.scenarios.weekend.multiplier);
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
  const weekend = 0.2 * CONFIG.traffic.scenarios.weekend.multiplier;
  close(model.demandFactor(5 * DAY), weekend);
  close(model.demandFactor(7 * DAY), 0.8);
  close(model.demandFactor(7 * DAY, 'weekend'), weekend);
});

test('demand varies randomly by day and smoothly by hour, but repeats with the same seed', () => {
  const plain = createDemandModel(); // sin eventos ni tiempo: solo el perfil del día (pico de laborable = 1 a las 8:00)
  const peaks = [];
  for (let day = 0; day < 5; day++) {
    const peak = plain.demandFactor(day * DAY + 8 * HOUR);
    assert.ok(peak >= 0.9 * 0.95 - 1e-9 && peak <= 1.1 * 1.05 + 1e-9, `pico del día ${day}: ${peak}`);
    peaks.push(peak);
    assert.equal(demandFactor(day * DAY), demandFactor(day * DAY));
  }
  assert.ok(new Set(peaks.map((p) => p.toFixed(4))).size > 1, 'no todos los días son iguales');
  for (let s = 0; s < 3600; s += 60) {
    const step = Math.abs(demandNoise(s + 60, 0.1, 0.05, 7) - demandNoise(s, 0.1, 0.05, 7));
    assert.ok(step < 0.01, 'la variación horaria cambia sin saltos dentro del día');
  }
  assert.equal(demandNoise(3 * DAY + 5000, 0.1, 0.05, 42), demandNoise(3 * DAY + 5000, 0.1, 0.05, 42));
  assert.notEqual(demandNoise(3 * DAY + 5000, 0.1, 0.05, 42), demandNoise(3 * DAY + 5000, 0.1, 0.05, 43));
  assert.equal(demandNoise(12345, 0, 0, 1), 1);
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
