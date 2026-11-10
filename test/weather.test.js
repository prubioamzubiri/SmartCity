import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { CONFIG } from '../src/config.js';
import { createWeather, weather } from '../src/weather/weather.js';
import { createDemandModel } from '../src/traffic/demand.js';
import { eventCalendar } from '../src/events/calendar.js';
import { TrafficSim } from '../src/traffic/sim.js';
import { SimEngine } from '../src/core/engine.js';
import { Store } from '../server/store.js';
import { Runtime } from '../server/runtime.js';
import { createApp, WEATHER_COLUMNS } from '../server/app.js';
import { ApiClient } from '../src/api/client.js';

const HOUR = 3600;
const DAY = 86400;
const at = (y, m, d, h = 0) => (Date.UTC(y, m, d, h) - CONFIG.sim.baseDate) / 1000;

// Primer instante (de hora en hora desde `from`) que cumple `predicate`.
function find(predicate, from = at(2026, 0, 5)) {
  for (let t = from; t < from + 400 * DAY; t += HOUR) if (predicate(weather.at(t))) return t;
  throw new Error('no such moment');
}

test('the weather is deterministic, bounded and changes with the seed', () => {
  const other = createWeather({ ...CONFIG.weather, seed: 7 });
  let differs = 0;
  for (let t = at(2026, 0, 5); t < at(2026, 1, 5); t += 1800) {
    const w = weather.at(t);
    assert.deepEqual(w, createWeather().at(t));
    assert.ok(w.temperature > -10 && w.temperature < 42);
    assert.ok(w.rain >= 0 && w.rain < 15);
    assert.ok(w.cloud >= 0 && w.cloud <= 1);
    assert.ok(w.condition in weather.conditions);
    if (Math.abs(other.at(t).temperature - w.temperature) > 0.5) differs++;
  }
  assert.ok(differs > 100);
  assert.throws(() => weather.at(NaN), /valid number/);
});

test('the climate follows the seasons of Donostia', () => {
  const stats = (from, to) => {
    let n = 0; let temp = 0; let wet = 0; let mm = 0;
    for (let t = from; t < to; t += HOUR) {
      const w = weather.at(t);
      n++; temp += w.temperature; mm += w.rain; if (w.rain > 0.02) wet++;
    }
    return { temp: temp / n, wet: wet / n, mm };
  };
  const january = stats(at(2026, 0, 1), at(2026, 1, 1));
  const july = stats(at(2026, 6, 1), at(2026, 7, 1));
  assert.ok(july.temp - january.temp > 8, `${july.temp} vs ${january.temp}`);
  assert.ok(january.temp > 6 && january.temp < 13 && july.temp > 18 && july.temp < 25);
  assert.ok(january.wet > july.wet, 'it rains more often in winter');
  const years = [2026, 2027, 2028].map((y) => stats(at(y, 0, 1), at(y + 1, 0, 1)).mm);
  for (const mm of years) assert.ok(mm > 900 && mm < 2200, `${mm} mm`);
  const days = new Set();
  for (let t = at(2026, 0, 1); t < at(2027, 0, 1); t += HOUR) if (weather.at(t).rain > 0.02) days.add(Math.floor(t / DAY));
  assert.ok(days.size > 80 && days.size < 220, `${days.size} days with rain`);
});

test('the temperature has a daily cycle and the rain keeps going for hours', () => {
  const sunny = find((w) => w.cloud < 0.2, at(2026, 4, 1));
  const day = Math.floor(sunny / DAY) * DAY;
  assert.ok(weather.at(day + 15 * HOUR).temperature > weather.at(day + 4 * HOUR).temperature, 'warmer in the afternoon than at dawn');
  const rain = find((w) => w.rain > 0.5);
  let wet = 0;
  for (let k = 0; k < 4; k++) if (weather.at(rain + k * 1800).rain > 0.02) wet++;
  assert.ok(wet >= 3, 'rain is not a one-minute flash');
});

test('the forecast covers the next 48 hours and keeps the future observation to itself', () => {
  const now = at(2026, 2, 10, 7) + 1234;
  const forecast = weather.forecast(now);
  assert.deepEqual(forecast, weather.forecast(now));
  assert.equal(forecast[0].time, at(2026, 2, 10, 8));
  assert.ok(forecast.length >= 47 && forecast.length <= 49);
  assert.ok(forecast.at(-1).time - now <= 48 * HOUR);
  forecast.forEach((f, i) => {
    if (i) assert.equal(f.time - forecast[i - 1].time, HOUR);
    assert.ok(f.rainProbability >= 0 && f.rainProbability <= 1);
    assert.ok(f.lead > 0 && f.lead <= 48);
  });
  assert.equal(weather.forecast(now, 6).length, 6);
  assert.notDeepEqual(weather.forecast(now).map((f) => f.temperature), weather.forecast(now + 7 * HOUR).slice(0, 40).map((f) => f.temperature));
});

test('forecast errors grow with lead time and probabilities are informative', () => {
  let near = 0; let far = 0; let nearN = 0; let farN = 0;
  let probWet = 0; let wetN = 0; let probDry = 0; let dryN = 0;
  for (let now = at(2026, 0, 5); now < at(2026, 6, 1); now += 5 * HOUR + 1000) {
    for (const f of weather.forecast(now)) {
      const real = weather.at(f.time);
      const error = Math.abs(f.temperature - real.temperature);
      if (f.lead <= 6) {
        near += error; nearN++;
        if (real.rain > 0.02) { probWet += f.rainProbability; wetN++; } else { probDry += f.rainProbability; dryN++; }
      } else if (f.lead >= 36) {
        far += error; farN++;
      }
    }
  }
  assert.ok(near / nearN < 0.7 * (far / farN), `${near / nearN} vs ${far / farN}`);
  assert.ok(far / farN > 0.5 && far / farN < 4, 'a 2-day forecast is imperfect but useful');
  assert.ok(probWet / wetN > 0.6, `P(rain | rain) = ${probWet / wetN}`);
  assert.ok(probDry / dryN < 0.2, `P(rain | dry) = ${probDry / dryN}`);
});

test('rain brings more cars, slower traffic, fewer pedestrians and almost no bikes; good weather the opposite', () => {
  const rainy = weather.effectsAt(find((w) => w.rain > 1));
  assert.ok(rainy.cars > 1.05 && rainy.speed < 0.95);
  assert.ok(rainy.pedestrians < 0.8 && rainy.bikes < rainy.pedestrians);
  const nice = weather.effectsAt(find((w) => w.cloud < 0.1 && w.temperature > 20 && w.temperature < 28, at(2026, 5, 1)));
  assert.ok(nice.pedestrians > 1.05 && nice.bikes > nice.pedestrians);
  assert.equal(nice.cars, 1);
  const cold = createWeather({ ...CONFIG.weather, meanTemp: Array(12).fill(-5), anomaly: 0 });
  assert.ok(cold.effectsAt(at(2026, 0, 12, 12)).pedestrians < 0.9);
});

test('the demand model applies the weather to each kind of activity', () => {
  const config = structuredClone(CONFIG.traffic);
  config.dailyVariation = 0;
  config.hourlyVariation = 0;
  const plain = createDemandModel(config);
  const model = createDemandModel(config, CONFIG.sim.baseDate, null, weather);
  const wet = find((w) => w.rain > 1, at(2026, 0, 5)); // la hora exacta da igual: se compara con el modelo sin tiempo
  const e = weather.effectsAt(wet);
  assert.ok(Math.abs(model.demandFactor(wet) - plain.demandFactor(wet) * e.cars) < 1e-12);
  assert.ok(Math.abs(model.pedestrianDemand(wet) - plain.demandFactor(wet) * e.pedestrians) < 1e-12);
  assert.ok(Math.abs(model.bikeDemand(wet) - plain.demandFactor(wet) * e.bikes) < 1e-12);
  assert.equal(model.speedFactor(wet), e.speed);
  assert.equal(plain.speedFactor(wet), 1);
  assert.equal(plain.pedestrianDemand(wet), plain.demandFactor(wet));
  // Con eventos y tiempo a la vez: el evento suma y el tiempo multiplica el total.
  const both = createDemandModel(config, CONFIG.sim.baseDate, eventCalendar, weather);
  assert.ok(Math.abs(both.demandFactor(wet) - (plain.demandFactor(wet) + eventCalendar.boostAt(wet)) * e.cars) < 1e-12);
});

test('cars slow down by the speed scale and the engine takes it from the weather', () => {
  const loop = () => new TrafficSim({
    edgeCount: 2, A: [0, 1], B: [1, 0], rev: [1, 0], cls: [4, 4],
    outStart: [0, 1, 2], outList: [0, 1], ux: [1, -1], uz: [0, 0], len: [5000, 5000], speed: [10, 10],
    nx: [0, 5000], nz: [0, 0],
  }, { stateForEdge: () => 0 }, () => {});
  const cruise = (scale) => {
    const sim = loop();
    sim.speedScale = scale;
    sim.setTarget(1);
    for (let i = 0; i < 200; i++) sim.step(CONFIG.sim.step);
    return sim.speed[0];
  };
  assert.ok(Math.abs(cruise(0.5) - cruise(1) / 2) < 1e-6);

  const city = { nodes: [-250, -250, 250, -250, 250, 250, -250, 250], ways: [[4, 0, 0, 1, 2, 3, 0]], signals: [], parking: { underground: [] } };
  const rain = find((w) => w.rain > 1);
  const dry = find((w) => w.rain === 0 && w.cloud < 0.3);
  const engine = new SimEngine({ data: city, maxCars: 10, startSeconds: rain - 120 });
  engine.advanceTo(rain + 60);
  assert.ok(engine.sim.speedScale < 0.95);
  const sunny = new SimEngine({ data: city, maxCars: 10, startSeconds: dry - 120 });
  sunny.advanceTo(dry + 60);
  assert.equal(sunny.sim.speedScale, 1);
});

test('the weather can be switched off', () => {
  const off = createDemandModel(structuredClone(CONFIG.traffic), CONFIG.sim.baseDate, null, null);
  const t = find((w) => w.rain > 1);
  assert.equal(off.speedFactor(t), 1);
  assert.equal(off.pedestrianDemand(t), off.demandFactor(t));
});

async function withServer(fn) {
  const city = { nodes: [-250, -250, 250, -250, 250, 250, -250, 250], ways: [[4, 0, 0, 1, 2, 3, 0]], signals: [], parking: { underground: [] } };
  const runtime = new Runtime({ engine: new SimEngine({ data: city, maxCars: 20 }), store: new Store(), now: () => 1_000_000, checkpointMs: 1e9 });
  const server = http.createServer(createApp({ runtime, store: runtime.store }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const get = async (path) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    const csv = (res.headers.get('content-type') ?? '').startsWith('text/csv');
    return { status: res.status, body: csv ? await res.text() : await res.json(), headers: res.headers };
  };
  try {
    await fn(get, runtime);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('the API serves the weather now and a 48 hour forecast without the real future', async () => {
  await withServer(async (get, runtime) => {
    runtime.engine.simTime = at(2026, 2, 10, 7);
    const { status, body } = await get('/api/weather');
    assert.equal(status, 200);
    assert.deepEqual(Object.keys(body.current).sort(), ['cloud_pct', 'condition', 'rain_mm_h', 'temperature_c', 'time']);
    assert.equal(body.current.time, '2026-03-10T07:00:00');
    assert.ok(body.forecast.length >= 47);
    assert.equal(body.forecast[0].time, '2026-03-10T08:00:00');
    assert.deepEqual(Object.keys(body.forecast[0]).sort(), ['cloud_pct', 'condition', 'lead_h', 'rain_mm_h', 'rain_probability', 'temperature_c', 'time']);
    assert.ok(body.forecast.every((f) => f.rain_probability >= 0 && f.rain_probability <= 1 && f.condition in body.conditions));
    assert.equal((await get('/api/weather?hours=6')).body.forecast.length, 6);
    for (const bad of ['0', '49', 'x', '2.5']) assert.equal((await get(`/api/weather?hours=${bad}`)).status, 400);

    const state = (await get('/api/state')).body;
    assert.deepEqual(state.weather, body.current);
    assert.equal(new ApiClient({ baseUrl: 'https://x.test' }).csvUrl('weather', { from: '2026-03-01' }), 'https://x.test/api/weather.csv?from=2026-03-01');
  });
});

test('the weather CSV has the observed hours of a period and nothing from the future', async () => {
  await withServer(async (get, runtime) => {
    runtime.engine.simTime = at(2026, 2, 10, 7) + 1800;
    const res = await get('/api/weather.csv?from=2026-03-09&to=2026-03-12');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /tiempo\.csv/);
    const [header, ...rows] = res.body.trim().split('\n');
    assert.equal(header, WEATHER_COLUMNS.join(','));
    assert.equal(rows[0].split(',')[0], '2026-03-09T00:00:00');
    assert.equal(rows.at(-1).split(',')[0], '2026-03-10T07:00:00', 'the last row is the last hour already lived');
    assert.equal(rows.length, 24 + 8);
    const first = rows[0].split(',');
    assert.equal(Number(first[1]), Math.round(weather.at(at(2026, 2, 9)).temperature * 10) / 10);

    const week = (await get('/api/weather.csv')).body.trim().split('\n');
    assert.equal(week.length - 1, 7 * 24, 'by default, the last 7 simulated days');
    assert.equal((await get('/api/weather.csv?from=hoy')).status, 400);
    assert.equal((await get('/api/weather.csv?from=2026-01-01&to=2028-01-01')).status, 200, 'it is clamped to the present');
    runtime.engine.simTime = at(2028, 5, 1);
    assert.equal((await get('/api/weather.csv?from=2026-01-01&to=2028-01-01')).status, 400);
  });
});
