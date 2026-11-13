import { CONFIG } from '../config.js';

const HOUR = 3600;
const MINUTE = 60;
const DAY_HOURS = 24;

export const CONDITIONS = {
  sunny: { label: 'Soleado', icon: '☀️' },
  partly_cloudy: { label: 'Parcialmente nublado', icon: '⛅' },
  cloudy: { label: 'Nublado', icon: '☁️' },
  rain: { label: 'Lluvia', icon: '🌧️' },
  heavy_rain: { label: 'Lluvia fuerte', icon: '⛈️' },
};

// Desviación típica de la suma de ruidos de `latent` (medida sobre varios años): la normaliza a 1.
const LATENT_NORM = 0.67;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (u) => {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
};

// Aleatorio sin estado en [-1, 1) para el nodo `i` de la rejilla y la semilla `salt`.
function hash(i, salt) {
  let h = Math.imul(i | 0, 0x9e3779b1) ^ Math.imul((salt | 0) + 0x7f4a7c15, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

// Ruido de valor suave: interpola entre los aleatorios de dos nodos vecinos.
function noise(x, salt) {
  const i = Math.floor(x);
  const u = smoothstep(x - i);
  return hash(i, salt) * (1 - u) + hash(i + 1, salt) * u;
}

// Función de distribución de la normal estándar (aproximación de Abramowitz y Stegun).
function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

function inverseNormalCdf(p) {
  let lo = -6;
  let hi = 6;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (normalCdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function condition(rain, cloud, heavyRain) {
  if (rain >= heavyRain) return 'heavy_rain';
  if (rain >= 0.2) return 'rain';
  if (cloud > 0.7) return 'cloudy';
  if (cloud > 0.35) return 'partly_cloudy';
  return 'sunny';
}

// Tiempo de la ciudad. Es una función pura de la fecha y de la semilla (como el calendario de eventos): servidor
// y visor calculan lo mismo, sin estado. La lluvia sale de una variable latente que cambia despacio (frentes de
// uno o dos días con chubascos dentro) y es mayor cuanto más llueve en esa época del año.
// Los tiempos son segundos simulados (como `simTime`).
export function createWeather(config = CONFIG.weather, baseDate = CONFIG.sim.baseDate) {
  if (!Number.isFinite(baseDate)) throw new Error('Weather baseDate must be a valid timestamp');
  if (config.meanTemp.length !== 12 || config.rainShare.length !== 12) throw new Error('Weather needs 12 monthly values');
  const seed = config.seed | 0;
  const salts = { front: seed ^ 0x1001, shower: seed ^ 0x2002, drizzle: seed ^ 0x3003, temp: seed ^ 0x4004 };
  const threshold = config.rainShare.map((share) => inverseNormalCdf(1 - share));
  const E = config.effects;
  const F = config.forecast;

  // Valor de un dato mensual en el instante dado, interpolado entre los centros de los meses.
  function monthly(table, date) {
    const month = date.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(date.getUTCFullYear(), month + 1, 0)).getUTCDate();
    const position = month + (date.getUTCDate() - 1 + date.getUTCHours() / 24) / daysInMonth - 0.5;
    const a = Math.floor(position);
    const u = position - a;
    return table[(a + 12) % 12] * (1 - u) + table[(a + 13) % 12] * u;
  }

  function latent(hours) {
    return (noise(hours / 30, salts.front) + 0.8 * noise(hours / 8, salts.shower) + 0.35 * noise(hours / 2.5, salts.drizzle)) / LATENT_NORM;
  }

  // Tiempo en el instante `seconds`, redondeado al minuto. `lat` y `tempError` permiten generar una previsión
  // con las mismas fórmulas que el tiempo real.
  function compute(seconds, lat = null, tempError = 0) {
    if (!Number.isFinite(seconds)) throw new Error('Simulation time must be a valid number of seconds');
    const t = Math.floor(seconds / MINUTE) * MINUTE;
    const date = new Date(baseDate + t * 1000);
    const hours = t / HOUR;
    const latentValue = lat ?? latent(hours);
    const limit = monthly(threshold, date);
    const rain = latentValue > limit ? config.rainScale * (latentValue - limit) : 0;
    const cloud = smoothstep((latentValue - (limit - 1.5)) / 1.2);
    const level = rain > 0.02 ? Math.min(1, Math.sqrt(rain / config.heavyRain)) : 0;
    const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
    const diurnal = -Math.cos((2 * Math.PI * (hour - 3)) / DAY_HOURS) * config.dailyRange * (1 - 0.5 * cloud);
    const temperature = monthly(config.meanTemp, date) + config.anomaly * noise(hours / 60, salts.temp)
      + diurnal + 1.5 * (0.5 - cloud) - 1.5 * level + tempError;
    return { latent: latentValue, threshold: limit, temperature, rain, cloud, condition: condition(rain, cloud, config.heavyRain) };
  }

  let cached = null;
  let cachedMinute = NaN;
  // Tiempo observado: temperatura (°C), lluvia (mm/h) y nubosidad (0 a 1).
  function at(seconds) {
    const minute = Math.floor(seconds / MINUTE);
    if (minute !== cachedMinute) {
      cached = compute(seconds);
      cachedMinute = minute;
    }
    return cached;
  }

  // Cuánto cambia el tiempo la actividad en ese instante: multiplicadores sobre coches, velocidad, peatones y bicis.
  function effectsAt(seconds) {
    const w = at(seconds);
    const level = w.rain > 0.02 ? Math.min(1, Math.sqrt(w.rain / config.heavyRain)) : 0;
    const bell = clamp((w.temperature - 12) / 6, 0, 1) * clamp((32 - w.temperature) / 6, 0, 1);
    const sun = E.sun * (1 - w.cloud) * bell;
    const cold = E.cold * clamp((8 - w.temperature) / 8, 0, 1);
    return {
      cars: 1 + E.carsRain * level,
      transit: 1 + E.transitRain * level,
      speed: 1 - E.speedRain * level,
      pedestrians: (1 - E.pedestriansRain * level) * (1 + sun - cold),
      bikes: (1 - E.bikesRain * level) * (1 + sun * E.bikesSun - cold),
    };
  }

  // Previsión horaria desde `nowSeconds` (a partir de la próxima hora en punto, hasta `hours` horas): el error crece
  // con el plazo y cambia cada 6 horas, cuando se emite una previsión nueva. A plazo corto es casi la realidad.
  function forecast(nowSeconds, hours = F.hours) {
    if (!Number.isFinite(nowSeconds)) throw new Error('Simulation time must be a valid number of seconds');
    const issue = Math.floor(nowSeconds / (6 * HOUR));
    const rainSalt = seed ^ Math.imul(issue, 0x5851f42d) ^ 0x5005;
    const tempSalt = seed ^ Math.imul(issue, 0x5851f42d) ^ 0x6006;
    const first = (Math.floor(nowSeconds / HOUR) + 1) * HOUR;
    const result = [];
    for (let t = first; t - nowSeconds <= hours * HOUR; t += HOUR) {
      const lead = (t - nowSeconds) / HOUR;
      const sigma = F.rainBase + F.rainPerHour * lead;
      const guess = latent(t / HOUR) + sigma * 1.6 * noise(t / (3 * HOUR), rainSalt);
      const w = compute(t, guess, (F.tempBase + F.tempPerHour * lead) * 1.6 * noise(t / (6 * HOUR), tempSalt));
      result.push({ time: t, lead, ...w, rainProbability: normalCdf((guess - w.threshold) / sigma) });
    }
    return result;
  }

  return { at, effectsAt, forecast, conditions: CONDITIONS };
}

export const weather = createWeather();
