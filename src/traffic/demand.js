import { CONFIG } from '../config.js';
import { eventCalendar } from '../events/calendar.js';
import { weather as cityWeather } from '../weather/weather.js';
import { holidayCalendar } from '../calendar/holidays.js';

const MODES = ['auto', 'weekday', 'preholiday', 'weekend', 'sunday'];
// Perfiles opcionales: sin ellos, la víspera de festivo es un laborable y el domingo, un fin de semana.
const FALLBACK = { preholiday: 'weekday', sunday: 'weekend' };

function validateMode(mode) {
  if (!MODES.includes(mode)) throw new Error(`Unknown traffic scenario: ${mode}`);
}

export function dayIndex(simSeconds) {
  return Math.floor(simSeconds / 86400);
}

export function simDate(simSeconds) {
  return new Date(CONFIG.sim.baseDate + simSeconds * 1000);
}

// Validate and copy configuration once, outside the physics loop. With an event calendar, the people that
// events bring to the city are added on top of the daily profile; with a weather model, rain and good weather
// scale each kind of activity (cars and transit, pedestrians, bikes) differently; with a holiday calendar, the automatic
// mode picks the profile by kind of day (eve of a holiday, Sunday before a working day...) instead of Saturday/Sunday only.
// Número pseudoaleatorio en [0, 1) a partir de la semilla de la ciudad y un índice (día u hora).
function hash01(seed, index, salt) {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(index | 0, 0x85ebca6b) ^ Math.imul(salt, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Multiplicador aleatorio de la demanda: uno por día (±daily) y otro que cambia suavemente de hora en hora (±hourly).
// Depende de la semilla de la ciudad (se lee en cada llamada: el visor la toma del servidor), así que cada ciudad
// tiene sus días más o menos cargados, pero dos ciudades con la misma semilla son idénticas.
export function demandNoise(seconds, daily, hourly, seed = CONFIG.sim.seed) {
  const day = dayIndex(seconds);
  let factor = 1 - daily + 2 * daily * hash01(seed, day, 1);
  if (hourly > 0) {
    const h = seconds / 3600;
    const i = Math.floor(h);
    const f = h - i;
    const smooth = f * f * (3 - 2 * f);
    const a = hash01(seed, i, 2);
    const b = hash01(seed, i + 1, 2);
    factor *= 1 - hourly + 2 * hourly * (a + (b - a) * smooth);
  }
  return factor;
}

export function createDemandModel(config = CONFIG.traffic, baseDate = CONFIG.sim.baseDate, events = null, weather = null, holidays = null) {
  validateMode(config.scenario);
  if (!Number.isFinite(baseDate) || !Number.isFinite(new Date(baseDate).getTime())) {
    throw new Error('Traffic baseDate must be a valid timestamp');
  }
  const variation = config.dailyVariation;
  if (!Number.isFinite(variation) || variation < 0 || variation > 1) {
    throw new Error('Traffic dailyVariation must be between 0 and 1');
  }
  const hourlyVariation = config.hourlyVariation ?? 0;
  if (!Number.isFinite(hourlyVariation) || hourlyVariation < 0 || hourlyVariation > 1) {
    throw new Error('Traffic hourlyVariation must be between 0 and 1');
  }
  const profiles = {};
  for (const name of ['weekday', 'weekend', 'preholiday', 'sunday']) {
    const profile = config.scenarios?.[name] ?? (FALLBACK[name] ? null : undefined);
    if (profile === null) continue;
    if (!Array.isArray(profile?.hourly) || profile.hourly.length !== 24 ||
        Array.from(profile.hourly).some((v) => !Number.isFinite(v) || v < 0 || v > 1)) {
      throw new Error(`Traffic ${name}.hourly must contain 24 numbers between 0 and 1`);
    }
    if (!Number.isFinite(profile.multiplier) || profile.multiplier < 0) {
      throw new Error(`Traffic ${name}.multiplier must be a non-negative number`);
    }
    profiles[name] = { hourly: [...profile.hourly], multiplier: profile.multiplier };
  }
  for (const [name, fallback] of Object.entries(FALLBACK)) profiles[name] ??= profiles[fallback];
  const defaultMode = config.scenario;
  function dateAt(seconds) {
    const date = new Date(baseDate + seconds * 1000);
    if (!Number.isFinite(seconds) || !Number.isFinite(date.getTime())) {
      throw new Error('Simulation time must be a valid number of seconds');
    }
    return date;
  }
  function scenarioForTime(seconds, mode = defaultMode) {
    validateMode(mode);
    if (mode !== 'auto') return mode;
    const day = dateAt(seconds).getUTCDay();
    return holidays ? holidays.kindAt(seconds) : day === 0 || day === 6 ? 'weekend' : 'weekday';
  }
  // Demanda del calendario (perfil del día, escenario y eventos), sin el efecto del tiempo.
  function baseDemand(seconds, mode = defaultMode) {
    const profile = profiles[scenarioForTime(seconds, mode)];
    const date = dateAt(seconds);
    const hour = date.getUTCHours();
    const fraction = (date.getUTCMinutes() * 60 + date.getUTCSeconds() + date.getUTCMilliseconds() / 1000) / 3600;
    const base = profile.hourly[hour] * (1 - fraction) + profile.hourly[(hour + 1) % 24] * fraction;
    const noise = demandNoise(seconds, variation, hourlyVariation);
    return base * profile.multiplier * noise + (events ? events.boostAt(seconds) : 0);
  }
  // Coches, aparcamientos y autobuses: con lluvia sale más gente en coche o transporte.
  const demandFactor = (seconds, mode = defaultMode) => baseDemand(seconds, mode) * (weather ? weather.effectsAt(seconds).cars : 1);
  // Peatones y bicis: la lluvia los reduce y el buen tiempo los aumenta.
  const pedestrianDemand = (seconds, mode = defaultMode) => baseDemand(seconds, mode) * (weather ? weather.effectsAt(seconds).pedestrians : 1);
  const bikeDemand = (seconds, mode = defaultMode) => baseDemand(seconds, mode) * (weather ? weather.effectsAt(seconds).bikes : 1);
  // Multiplicador de la velocidad de los coches por el tiempo.
  const speedFactor = (seconds) => (weather ? weather.effectsAt(seconds).speed : 1);
  return { demandFactor, pedestrianDemand, bikeDemand, speedFactor, scenarioForTime };
}

export const { demandFactor, pedestrianDemand, bikeDemand, speedFactor, scenarioForTime } = createDemandModel(
  CONFIG.traffic, CONFIG.sim.baseDate, CONFIG.events.enabled ? eventCalendar : null, CONFIG.weather.enabled ? cityWeather : null, CONFIG.holidays.enabled ? holidayCalendar : null,
);
