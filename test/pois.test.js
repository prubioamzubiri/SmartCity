import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { poiStrength, projectPois } from '../src/city/pois.js';

const DAY = 86400;
// La fecha base (lunes 5 de enero de 2026) es víspera de festivo: cuenta como día de trabajo.
const wednesday = (h) => 2 * DAY + h * 3600;
const saturday = (h) => 5 * DAY + h * 3600;
const julySaturday = (h) => (Date.UTC(2026, 6, 4) - CONFIG.sim.baseDate) / 1000 + h * 3600;

test('points of interest are projected around the city centre', () => {
  const pois = projectPois();
  assert.equal(pois.length, CONFIG.pois.places.length);
  assert.ok(pois.every((p) => Math.hypot(p.x, p.z) < 6000 && p.id.startsWith('poi:')));
});

test('work areas attract in the morning of working days and send people home in the afternoon', () => {
  assert.ok(poiStrength('trabajo', wednesday(8)).to > 1);
  assert.equal(poiStrength('trabajo', wednesday(8)).from, 0);
  assert.ok(poiStrength('trabajo', wednesday(17)).from > 1);
  assert.deepEqual(poiStrength('trabajo', saturday(8)), { to: 0, from: 0 });
});

test('leisure attracts more on days off; beaches much more in summer', () => {
  assert.ok(poiStrength('ocio', saturday(12)).to > poiStrength('ocio', wednesday(12)).to);
  assert.ok(poiStrength('ocio', saturday(22)).from > 0);
  const winter = poiStrength('playa', saturday(12)).to;
  const summer = poiStrength('playa', julySaturday(12)).to;
  assert.ok(summer > winter, `${winter} -> ${summer}`);
  assert.equal(poiStrength('nada', saturday(12)).to, 0);
});
