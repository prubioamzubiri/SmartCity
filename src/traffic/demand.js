import { CONFIG } from '../config.js';
import { eventCalendar } from '../events/calendar.js';
import { weather as cityWeather } from '../weather/weather.js';

const MODES = ['auto', 'weekday', 'weekend'];

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
// scale each kind of activity (cars and transit, pedestrians, bikes) differently.
export function createDemandModel(config = CONFIG.traffic, baseDate = CONFIG.sim.baseDate, events = null, weather = null) {
  validateMode(config.scenario);
  if (!Number.isFinite(baseDate) || !Number.isFinite(new Date(baseDate).getTime())) {
    throw new Error('Traffic baseDate must be a valid timestamp');
  }
  const variation = config.dailyVariation;
  if (!Number.isFinite(variation) || variation < 0 || variation > 1) {
    throw new Error('Traffic dailyVariation must be between 0 and 1');
  }
  const profiles = {};
  for (const name of ['weekday', 'weekend']) {
    const profile = config.scenarios?.[name];
    if (!Array.isArray(profile?.hourly) || profile.hourly.length !== 24 ||
        Array.from(profile.hourly).some((v) => !Number.isFinite(v) || v < 0 || v > 1)) {
      throw new Error(`Traffic ${name}.hourly must contain 24 numbers between 0 and 1`);
    }
    if (!Number.isFinite(profile.multiplier) || profile.multiplier < 0) {
      throw new Error(`Traffic ${name}.multiplier must be a non-negative number`);
    }
    profiles[name] = { hourly: [...profile.hourly], multiplier: profile.multiplier };
  }
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
    const day = dateAt(seconds).getUTCDay();
    return mode === 'auto' ? (day === 0 || day === 6 ? 'weekend' : 'weekday') : mode;
  }
  // Demanda del calendario (perfil del día, escenario y eventos), sin el efecto del tiempo.
  function baseDemand(seconds, mode = defaultMode) {
    const profile = profiles[scenarioForTime(seconds, mode)];
    const date = dateAt(seconds);
    const hour = date.getUTCHours();
    const fraction = (date.getUTCMinutes() * 60 + date.getUTCSeconds() + date.getUTCMilliseconds() / 1000) / 3600;
    const base = profile.hourly[hour] * (1 - fraction) + profile.hourly[(hour + 1) % 24] * fraction;
    const day = dayIndex(seconds);
    const noise = 1 - variation + 2 * variation * (Math.abs(Math.sin(day * 12.9898) * 43758.5453) % 1);
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
  CONFIG.traffic, CONFIG.sim.baseDate, CONFIG.events.enabled ? eventCalendar : null, CONFIG.weather.enabled ? cityWeather : null,
);
