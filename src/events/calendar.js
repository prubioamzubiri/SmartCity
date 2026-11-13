import { CONFIG } from '../config.js';
import { createRng } from '../core/random.js';

const HOUR = 3600;
const DAY = 86400;
const DAY_MS = DAY * 1000;
const K_LAT = 110574;
const MONDAY = 1;
const FRIDAY = 5;
const SATURDAY = 6;
const SUNDAY = 0;

const smooth = (u) => u * u * (3 - 2 * u);

// Día de la semana UTC más cercano (±3 días) a `ms` que sea `weekday`.
function snapToWeekday(ms, weekday) {
  return ms + (((weekday - new Date(ms).getUTCDay() + 10) % 7) - 3) * DAY_MS;
}

// Primer `weekday` en `ms` o después, y último en `ms` o antes.
const onOrAfter = (ms, weekday) => ms + ((weekday - new Date(ms).getUTCDay() + 7) % 7) * DAY_MS;
const onOrBefore = (ms, weekday) => ms - ((new Date(ms).getUTCDay() - weekday + 7) % 7) * DAY_MS;

// `count` fechas repartidas por igual entre `from` y `to` (ms).
function spread(from, to, count) {
  // Siempre a medianoche: luego se suma la hora del evento.
  return Array.from({ length: count }, (_, k) => Math.round((from + ((to - from) * k) / Math.max(1, count - 1)) / DAY_MS) * DAY_MS);
}

const pick = (rng, options) => options[Math.floor(rng() * options.length)];

function pickWeighted(rng, weights) {
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

const PROTEST_TOPICS = [
  'por la vivienda', 'por las pensiones', 'por la sanidad pública', 'por el clima', 'contra la subida de precios',
  'por la educación pública', 'por la movilidad sostenible', 'por los derechos laborales',
];
const CONCERT_MONTHS = [0.3, 0.3, 0.5, 0.7, 1, 1.5, 2, 1.5, 1, 0.8, 0.6, 0.4];
// Conciertos al año: sede, cuántos, mínimo de asistentes y margen sobre el mínimo.
const CONCERTS = [['anoeta', 3, 20000, 12000], ['illunbe', 5, 6000, 3500], ['kursaal', 4, 1200, 600]];

// Calendario de eventos de la ciudad. Es una función pura de la fecha y de la semilla: cada año tiene los mismos
// eventos en el servidor y en el visor, sin estado que guardar. Los tiempos son segundos simulados (como `simTime`).
export function createEventCalendar(config = CONFIG.events, baseDate = CONFIG.sim.baseDate) {
  if (!Number.isFinite(baseDate)) throw new Error('Event calendar baseDate must be a valid timestamp');
  const kLon = 111320 * Math.cos((config.origin.lat * Math.PI) / 180);
  const venues = {};
  for (const [id, v] of Object.entries(config.venues)) {
    venues[id] = {
      id, name: v.name, radius: v.radius,
      x: (v.lon - config.origin.lon) * kLon,
      z: -(v.lat - config.origin.lat) * K_LAT,
    };
  }
  const types = config.types;
  const secondsOf = (y, m, d, h = 0, min = 0) => (Date.UTC(y, m, d, h, min) - baseDate) / 1000;
  const yearOf = (seconds) => new Date(baseDate + seconds * 1000).getUTCFullYear();

  function generate(year) {
    const events = [];
    const rngFor = (salt) => createRng((config.seed ^ Math.imul(year, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0);
    const add = (type, name, venue, start, attendance, { hours = types[type].duration, series = null } = {}) => {
      const t = types[type];
      const end = start + hours * HOUR;
      events.push({
        type, name, series, venue, x: venues[venue].x, z: venues[venue].z, radius: venues[venue].radius,
        start, end, attendance: Math.round(attendance),
        boost: attendance * config.boostPerPerson,
        windowStart: start - t.lead * HOUR,
        windowEnd: end + t.trail * HOUR,
      });
    };
    const at = (m, d, h = 0, min = 0) => secondsOf(year, m, d, h, min);
    const atMs = (ms, h) => (ms - baseDate) / 1000 + h * HOUR; // `ms` es medianoche UTC de un día

    // Fiestas fijas
    add('fiesta', 'Cabalgata de Reyes', 'boulevard', at(0, 5, 18), 30000, { hours: 2.5 });
    add('fiesta', 'Tamborrada · izado de bandera', 'constitucion', at(0, 19, 23, 30), 20000, { hours: 1.5, series: 'tamborrada' });
    add('fiesta', 'Tamborrada infantil', 'constitucion', at(0, 20, 12), 12000, { hours: 2, series: 'tamborrada' });
    add('fiesta', 'Tamborrada', 'constitucion', at(0, 20, 18), 20000, { hours: 5, series: 'tamborrada' });
    add('fiesta', 'Feria de Santo Tomás', 'constitucion', at(11, 21, 10), 30000, { hours: 10 });

    // Semana Grande: ocho días desde el sábado anterior al 15 de agosto, con fuegos artificiales casi todas las noches
    const grandWeek = onOrBefore(Date.UTC(year, 7, 14), SATURDAY);
    for (let k = 0; k < 8; k++) {
      const day = grandWeek + k * DAY_MS;
      add('fiesta', 'Semana Grande', 'alderdi', atMs(day, 12), 25000, { hours: 8, series: 'semana-grande' });
      if (k >= 1 && k <= 6) add('fiesta', 'Concurso de fuegos artificiales', 'concha', atMs(day, 23), 70000, { hours: 1, series: 'semana-grande' });
    }

    // Jazzaldia: de miércoles a domingo, terminando el último domingo de julio
    const jazzEnd = onOrBefore(Date.UTC(year, 6, 31), SUNDAY);
    const jazzRng = rngFor(1);
    for (let k = 0; k < 5; k++) {
      add('jazz', 'Jazzaldia', 'trinidad', atMs(jazzEnd - (4 - k) * DAY_MS, 18), (k >= 3 ? 14000 : 9000) + jazzRng() * 1500, { series: 'jazzaldia' });
    }

    // Festival de Cine: nueve días desde el primer viernes a partir del 18 de septiembre
    const filmStart = onOrAfter(Date.UTC(year, 8, 18), FRIDAY);
    const filmRng = rngFor(2);
    for (let k = 0; k < 9; k++) {
      const name = k === 0 ? 'Festival de Cine · gala inaugural' : k === 8 ? 'Festival de Cine · gala de clausura' : 'Festival de Cine';
      const attendance = k === 0 || k === 8 ? 9000 : 5000 + filmRng() * 2000;
      add('film', name, 'kursaal', atMs(filmStart + k * DAY_MS, 16), attendance, { series: 'festival-cine' });
    }

    // Fútbol: partidos en casa de la Real Sociedad en dos tramos de la temporada
    const footballRng = rngFor(3);
    const matchDays = [
      ...spread(Date.UTC(year, 0, 11), Date.UTC(year, 4, 17), 9),
      ...spread(Date.UTC(year, 7, 23), Date.UTC(year, 11, 20), 10),
    ];
    for (const base of matchDays) {
      const weekday = pick(footballRng, [SATURDAY, SATURDAY, SUNDAY, SUNDAY, FRIDAY, MONDAY]);
      const times = weekday === SATURDAY ? [16, 18.5, 21] : weekday === SUNDAY ? [14, 16.25, 18.5, 21] : [21];
      add('football', 'Real Sociedad · partido en casa', 'anoeta', atMs(snapToWeekday(base, weekday), pick(footballRng, times)), 30000 + footballRng() * 8000);
    }

    // Baloncesto: partidos en casa del Gipuzkoa Basket
    const basketRng = rngFor(4);
    const gameDays = [
      ...spread(Date.UTC(year, 0, 12), Date.UTC(year, 4, 10), 8),
      ...spread(Date.UTC(year, 9, 4), Date.UTC(year, 11, 20), 5),
    ];
    for (const base of gameDays) {
      const weekday = pick(basketRng, [SATURDAY, SUNDAY, SUNDAY]);
      add('basketball', 'Gipuzkoa Basket · partido en casa', 'illunbe', atMs(snapToWeekday(base, weekday), pick(basketRng, [12.5, 18, 20])), 5000 + basketRng() * 4000);
    }

    // Conciertos: más en verano; los de Anoeta, en junio y julio
    const concertRng = rngFor(5);
    for (const [venue, count, minimum, margin] of CONCERTS) {
      for (let k = 0; k < count; k++) {
        const month = venue === 'anoeta' ? 5 + Math.floor(concertRng() * 2) : pickWeighted(concertRng, CONCERT_MONTHS);
        const weekday = pick(concertRng, [FRIDAY, FRIDAY, SATURDAY, SATURDAY, SATURDAY, 4]);
        const day = snapToWeekday(Date.UTC(year, month, 1 + Math.floor(concertRng() * 27)), weekday);
        add('concert', `Concierto · ${venues[venue].name}`, venue, atMs(day, venue === 'anoeta' ? 21.5 : 21), minimum + concertRng() * margin);
      }
    }

    // Manifestaciones: dos fijas y otras repartidas por el año
    const protestRng = rngFor(6);
    add('protest', 'Manifestación 8M · Día de la Mujer', 'boulevard', at(2, 8, 19), 15000);
    add('protest', 'Manifestación 1 de Mayo', 'boulevard', at(4, 1, 12), 9000);
    for (let k = 0; k < 22; k++) {
      const saturday = protestRng() < 0.5;
      const day = snapToWeekday(Date.UTC(year, 0, 1 + Math.floor(protestRng() * 360)), saturday ? SATURDAY : pick(protestRng, [2, 3, 4]));
      add('protest', `Manifestación ${pick(protestRng, PROTEST_TOPICS)}`, pick(protestRng, ['boulevard', 'alderdi', 'constitucion']),
        atMs(day, saturday ? 12 : 19), 500 + protestRng() ** 2 * 7000);
    }

    events.sort((a, b) => a.start - b.start || a.venue.localeCompare(b.venue));
    events.forEach((e, i) => {
      e.id = `${year}-${String(i + 1).padStart(3, '0')}`;
    });
    return events;
  }

  const years = new Map();
  const byDay = new Map(); // día simulado -> eventos cuya ventana de efecto lo toca

  function ensureYear(year) {
    if (years.has(year)) return years.get(year);
    const events = generate(year);
    years.set(year, events);
    for (const e of events) {
      for (let d = Math.floor(e.windowStart / DAY); d <= Math.floor(e.windowEnd / DAY); d++) {
        const list = byDay.get(d);
        if (list) list.push(e);
        else byDay.set(d, [e]);
      }
    }
    return events;
  }

  function near(seconds) {
    if (!Number.isFinite(seconds)) throw new Error('Simulation time must be a valid number of seconds');
    ensureYear(yearOf(seconds - DAY));
    ensureYear(yearOf(seconds + DAY));
    return byDay.get(Math.floor(seconds / DAY)) ?? [];
  }

  // Nivel de efecto del evento en [0, 1]: sube mientras llega la gente, es 1 durante el evento y baja al salir.
  function intensity(event, seconds) {
    if (seconds < event.windowStart || seconds >= event.windowEnd) return 0;
    if (seconds < event.start) return smooth((seconds - event.windowStart) / (event.start - event.windowStart));
    if (seconds <= event.end) return 1;
    return smooth(1 - (seconds - event.end) / (event.windowEnd - event.end));
  }

  function activeAt(seconds) {
    const active = [];
    for (const event of near(seconds)) {
      const level = intensity(event, seconds);
      if (level > 0) active.push({ event, intensity: level });
    }
    return active;
  }

  // Demanda extra (fracción de la demanda máxima) que traen los eventos en este instante.
  function boostAt(seconds) {
    let boost = 0;
    for (const event of near(seconds)) boost += event.boost * intensity(event, seconds);
    return Math.min(config.maxBoost, boost);
  }

  // Sedes que atraen coches ahora: posición, radio y fuerza (demanda extra que aportan).
  function attractorsAt(seconds) {
    return activeAt(seconds).map(({ event, intensity: level }) => ({
      id: event.id, x: event.x, z: event.z, radius: event.radius, weight: event.boost * level,
    }));
  }

  // Demanda de autobús de los eventos en curso: posición, radio, fuerza y fase ('arrive' mientras llega la gente,
  // 'during' durante el evento y 'leave' mientras se va).
  function busDemandAt(seconds) {
    return activeAt(seconds).map(({ event, intensity: level }) => ({
      id: event.id, x: event.x, z: event.z, radius: event.radius, weight: event.boost * level, level,
      phase: seconds < event.start ? 'arrive' : seconds > event.end ? 'leave' : 'during',
    }));
  }

  // Eventos cuyo horario (sin las rampas de llegada y salida) se solapa con [from, to).
  function eventsBetween(from, to) {
    if (!(to > from)) return [];
    const result = [];
    for (let year = yearOf(from); year <= yearOf(to - 1); year++) {
      for (const event of ensureYear(year)) if (event.start < to && event.end > from) result.push(event);
    }
    return result.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  }

  // Los próximos `count` eventos que no han terminado (los que están en curso también).
  function upcoming(seconds, count = 5) {
    const year = yearOf(seconds);
    const result = [];
    for (const y of [year, year + 1]) for (const event of ensureYear(y)) if (event.end > seconds) result.push(event);
    return result.sort((a, b) => a.start - b.start).slice(0, count);
  }

  return { venues, types, secondsOf, intensity, activeAt, boostAt, attractorsAt, busDemandAt, eventsBetween, upcoming };
}

export const eventCalendar = createEventCalendar();
