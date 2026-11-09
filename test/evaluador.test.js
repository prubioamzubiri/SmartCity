import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyScenario } from '../server/scenario.js';
import { readConfig, summarize } from '../profesor/evaluador/evaluar.mjs';

const fakeConfig = () => ({ sim: { seed: 1, startSeconds: 0, baseDate: Date.UTC(2026, 0, 5) }, weather: { seed: 1 }, events: { seed: 1 } });

test('a scenario sets the seeds and the simulated start from the environment', () => {
  const config = fakeConfig();
  const applied = applyScenario({ SCENARIO_SEED: '777', SCENARIO_START: '2026-03-16T06:00' }, config);
  assert.equal(config.sim.seed, 777);
  assert.equal(config.weather.seed, 777);
  assert.equal(config.events.seed, 777);
  assert.equal(config.sim.startSeconds, 70 * 86400 + 6 * 3600);
  assert.deepEqual(applied, { seed: 777, start: '2026-03-16T06:00' });
  assert.deepEqual(applyScenario({}, fakeConfig()), {});
  assert.throws(() => applyScenario({ SCENARIO_SEED: 'x' }, fakeConfig()), /entero/);
  assert.throws(() => applyScenario({ SCENARIO_START: '2025-01-01T00:00' }, fakeConfig()), /2026-01-05/);
});

test('the evaluation config is validated and groups without a folder are control groups', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaluacion-'));
  fs.mkdirSync(path.join(dir, 'g1'));
  fs.writeFileSync(path.join(dir, 'g1', 'gestor.py'), 'print(1)');
  fs.mkdirSync(path.join(dir, 'vacio'));
  const write = (c) => {
    fs.writeFileSync(path.join(dir, 'e.json'), JSON.stringify(c));
    return path.join(dir, 'e.json');
  };
  const escenarios = [{ nombre: 'a', semilla: 5, inicio: '2026-03-16T00:00', horas: 24 }];
  const ok = readConfig(write({ escenarios, grupos: [{ nombre: 'g1' }, { nombre: 'control', carpeta: null }] }));
  assert.equal(ok.grupos[0].carpeta, path.join(dir, 'g1'));
  assert.deepEqual(ok.grupos[0].comando, ['python', 'gestor.py']);
  assert.equal(ok.grupos[1].carpeta, null);
  assert.ok(Math.abs(ok.scale - 365 / 7) < 1e-9);
  assert.throws(() => readConfig(write({ escenarios, grupos: [{ nombre: 'vacio' }] })), /gestor.py/);
  assert.throws(() => readConfig(write({ escenarios, grupos: [{ nombre: 'nada' }] })), /no existe/);
  assert.throws(() => readConfig(write({ escenarios: [{ semilla: 1.5, inicio: '2026-03-16T00:00', horas: 1 }], grupos: [{ nombre: 'g1' }] })), /semilla/);
  assert.throws(() => readConfig(write({ escenarios: [{ semilla: 1, inicio: 'ayer', horas: 1 }], grupos: [{ nombre: 'g1' }] })), /inicio/);
});

test('the summary averages each group over the scenarios it could be scored in', () => {
  const score = (index) => ({ index, score: { components: { traffic: 0.1, trips: 0, transit: 0, fleet: 0, bikes: 0, parkings: 0, cost: 0 } } });
  const summary = summarize(
    { grupos: [{ nombre: 'g1', carpeta: '/x' }, { nombre: 'control', carpeta: null }] },
    [
      { results: [{ grupo: 'g1', ...score(60) }, { grupo: 'control', ...score(50) }] },
      { results: [{ grupo: 'g1', ...score(40) }, { grupo: 'control', index: null }] },
    ],
  );
  assert.equal(summary[0].media, 50);
  assert.deepEqual(summary[0].porEscenario, [60, 40]);
  assert.equal(summary[1].media, 50);
  assert.equal(summary[1].sinGestor, true);
  assert.equal(summary[0].componentes.traffic, 0.1);
});
