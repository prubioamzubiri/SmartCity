import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { CONFIG } from '../src/config.js';
import { createHolidayCalendar, holidayCalendar as calendar } from '../src/calendar/holidays.js';
import { createDemandModel, scenarioForTime } from '../src/traffic/demand.js';
import { SimEngine } from '../src/core/engine.js';
import { Store } from '../server/store.js';
import { Runtime } from '../server/runtime.js';
import { createApp } from '../server/app.js';
import { DAY_KINDS } from '../src/ui/eventCalendar.js';

const at = (y, m, d, h = 0) => (Date.UTC(y, m - 1, d, h) - CONFIG.sim.baseDate) / 1000;
const kind = (y, m, d) => calendar.kindAt(at(y, m, d, 12));
const name = (y, m, d) => calendar.holidayAt(at(y, m, d, 12));

test('the holidays of Donostia in 2026 are the official ones, with Easter calculated', () => {
  const list = calendar.holidaysBetween(at(2026, 1, 1), at(2027, 1, 1)).map((h) => `${h.date} ${h.name}`);
  assert.deepEqual(list, [
    '2026-01-01 Año Nuevo', '2026-01-06 Epifanía del Señor', '2026-01-20 San Sebastián', '2026-03-19 San José',
    '2026-04-02 Jueves Santo', '2026-04-03 Viernes Santo', '2026-04-06 Lunes de Pascua', '2026-05-01 Día del Trabajo',
    '2026-07-25 Santiago Apóstol', '2026-07-31 San Ignacio de Loyola', '2026-08-15 Asunción de la Virgen',
    '2026-10-12 Fiesta Nacional de España', '2026-11-01 Todos los Santos', '2026-12-06 Día de la Constitución',
    '2026-12-08 Inmaculada Concepción', '2026-12-25 Navidad',
  ]);
  // Domingos de Resurrección de otros años
  assert.equal(name(2027, 3, 26), 'Viernes Santo'); // Pascua el 28 de marzo de 2027
  assert.equal(name(2024, 3, 29), 'Viernes Santo'); // Pascua el 31 de marzo de 2024
  assert.equal(name(2026, 4, 5), null, 'Easter Sunday itself is just a Sunday');
  assert.equal(name(2026, 1, 7), null);
});

test('range queries are exclusive at the end and validate their input', () => {
  assert.deepEqual(calendar.holidaysBetween(at(2026, 1, 6), at(2026, 1, 7)).map((h) => h.date), ['2026-01-06']);
  assert.deepEqual(calendar.holidaysBetween(at(2026, 1, 6), at(2026, 1, 6)), []);
  assert.deepEqual(calendar.holidaysBetween(at(2026, 1, 7), at(2026, 1, 20)), []);
  assert.throws(() => calendar.kindAt(NaN), /valid number/);
  assert.throws(() => createHolidayCalendar(CONFIG.holidays, NaN), /baseDate/);
});

test('each day has a kind: weekday, eve of a holiday, weekend or sunday', () => {
  assert.equal(kind(2026, 1, 7), 'weekday'); // miércoles normal
  assert.equal(kind(2026, 1, 9), 'weekday'); // viernes: el sábado no es festivo
  assert.equal(kind(2026, 1, 5), 'preholiday'); // lunes, el martes 6 es festivo
  assert.equal(kind(2026, 1, 6), 'sunday'); // el festivo con el miércoles laborable
  assert.equal(kind(2026, 1, 10), 'weekend'); // sábado
  assert.equal(kind(2026, 1, 11), 'sunday'); // domingo, el lunes se trabaja
  assert.equal(kind(2026, 10, 11), 'weekend'); // domingo, el lunes 12 es festivo
  assert.equal(kind(2026, 10, 12), 'sunday');
  // Semana Santa: miércoles víspera, jueves a domingo sin laborable al día siguiente, lunes de Pascua
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((d) => kind(2026, 4, d)), ['preholiday', 'weekend', 'weekend', 'weekend', 'weekend', 'sunday']);
  assert.equal(kind(2026, 8, 14), 'preholiday'); // viernes, el sábado 15 es festivo
  assert.equal(kind(2026, 8, 15), 'weekend');
  assert.equal(kind(2026, 8, 16), 'sunday');
  const kinds = new Set();
  for (let t = at(2026, 1, 1); t < at(2027, 1, 1); t += 86400) kinds.add(calendar.kindAt(t));
  assert.deepEqual([...kinds].sort(), ['preholiday', 'sunday', 'weekday', 'weekend']);
  assert.deepEqual(Object.keys(DAY_KINDS).sort(), [...kinds].sort());
});

function model(holidays = calendar, tweak = () => {}) {
  const config = structuredClone(CONFIG.traffic);
  config.dailyVariation = 0;
  config.hourlyVariation = 0;
  tweak(config);
  return createDemandModel(config, CONFIG.sim.baseDate, null, null, holidays);
}

test('on Sundays and holidays before a working day the afternoon is quiet; Saturdays and eves of holidays are busier', () => {
  const m = model();
  const demand = (y, mo, d, h) => m.demandFactor(at(y, mo, d, h));
  const quietAfternoon = demand(2026, 1, 11, 17); // domingo con lunes laborable
  assert.ok(quietAfternoon < 0.2, `${quietAfternoon}`);
  assert.ok(demand(2026, 1, 7, 17) > 4 * quietAfternoon, 'a working Wednesday at 17h');
  assert.ok(demand(2026, 1, 10, 17) > 3 * quietAfternoon, 'a Saturday at 17h');
  assert.ok(demand(2026, 10, 11, 17) > 3 * quietAfternoon, 'a Sunday before a holiday is like a Saturday');
  // Víspera de festivo frente a un laborable: más gente por la tarde y por la noche, lo mismo por la mañana
  const eve = (h) => demand(2026, 1, 5, h);
  const normal = (h) => demand(2026, 1, 7, h);
  assert.ok(eve(21) > 1.5 * normal(21) && eve(15) > normal(15));
  const ratio = CONFIG.traffic.scenarios.preholiday.multiplier / CONFIG.traffic.scenarios.weekday.multiplier;
  assert.ok(Math.abs(eve(8) - normal(8) * ratio) < 1e-12);
  assert.ok(CONFIG.traffic.scenarios.weekend.multiplier > 0.65, 'Saturdays move more than before');
});

test('the modes: automatic follows the calendar, forced ones keep their curve and the default model uses the holidays', () => {
  const m = model();
  assert.equal(m.scenarioForTime(at(2026, 1, 6, 9)), 'sunday');
  assert.equal(m.scenarioForTime(at(2026, 1, 6, 9), 'weekday'), 'weekday');
  assert.ok(m.demandFactor(at(2026, 1, 11, 17), 'preholiday') > m.demandFactor(at(2026, 1, 11, 17)));
  assert.equal(scenarioForTime(at(2026, 1, 6, 9)), 'sunday');
  assert.equal(scenarioForTime(at(2026, 1, 6, 9), 'auto'), 'sunday');
  // Sin calendario de festivos: sábado y domingo son fin de semana
  assert.equal(model(null).scenarioForTime(at(2026, 1, 11, 9)), 'weekend');
  assert.equal(model(null).scenarioForTime(at(2026, 1, 6, 9)), 'weekday');
});

test('old configurations without the new profiles still work', () => {
  const m = model(calendar, (config) => {
    delete config.scenarios.preholiday;
    delete config.scenarios.sunday;
  });
  assert.equal(m.demandFactor(at(2026, 1, 5, 8)), model(null).demandFactor(at(2026, 1, 5, 8)), 'an eve falls back to the weekday profile');
  assert.equal(m.demandFactor(at(2026, 1, 11, 17)), model(null).demandFactor(at(2026, 1, 10, 17)), 'a Sunday falls back to the weekend profile');
  assert.throws(() => model(calendar, (config) => { config.scenarios.sunday.multiplier = -1; }), /sunday\.multiplier/);
  assert.throws(() => model(calendar, (config) => { config.scenarios.preholiday.hourly.pop(); }), /preholiday\.hourly/);
});

test('the engine follows the kind of day', () => {
  const city = { nodes: [-250, -250, 250, -250, 250, 250, -250, 250], ways: [[4, 0, 0, 1, 2, 3, 0]], signals: [], parking: { underground: [] } };
  const cars = (y, m, d) => {
    const engine = new SimEngine({ data: city, maxCars: 200, startSeconds: at(y, m, d, 14) });
    engine.advanceTo(at(y, m, d, 17));
    return engine.sim.targetCount;
  };
  assert.ok(cars(2026, 1, 10) > 2 * cars(2026, 1, 11), 'Saturday vs a Sunday before a working day');
});

test('the API lists the holidays and tells whether today is one', async () => {
  const city = { nodes: [-250, -250, 250, -250, 250, 250, -250, 250], ways: [[4, 0, 0, 1, 2, 3, 0]], signals: [], parking: { underground: [] } };
  const runtime = new Runtime({ engine: new SimEngine({ data: city, maxCars: 10 }), store: new Store(), now: () => 1_000_000, checkpointMs: 1e9 });
  const server = http.createServer(createApp({ runtime, store: runtime.store }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const get = async (path) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    return { status: res.status, body: await res.json() };
  };
  try {
    const { body } = await get('/api/holidays?from=2026-03-30&to=2026-04-08');
    assert.deepEqual(body.holidays, [
      { date: '2026-04-02', name: 'Jueves Santo' }, { date: '2026-04-03', name: 'Viernes Santo' }, { date: '2026-04-06', name: 'Lunes de Pascua' },
    ]);
    const year = (await get('/api/holidays')).body.holidays;
    assert.ok(year.length >= 14 && year[0].date >= '2026-01-05', 'by default, the next 365 days');
    assert.equal((await get('/api/holidays?from=ayer')).status, 400);
    assert.equal((await get('/api/holidays?from=2026-01-01&to=2031-01-01')).status, 400);
    runtime.engine.simTime = at(2026, 1, 20, 10);
    assert.equal((await get('/api/state')).body.holiday, 'San Sebastián');
    runtime.engine.simTime = at(2026, 1, 21, 10);
    assert.equal((await get('/api/state')).body.holiday, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
