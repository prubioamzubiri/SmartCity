import { CONFIG } from '../config.js';

const DAY_MS = 86400000;

// Domingo de Resurrección (algoritmo de Meeus/Jones/Butcher): devuelve [mes (1-12), día].
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  return [month, ((h + l - 7 * m + 114) % 31) + 1];
}

// Día de la semana (0 = domingo) de un número de día UTC desde 1970-01-01, que fue jueves.
const weekdayOf = (dayNumber) => (((dayNumber % 7) + 7 + 4) % 7);

// Calendario de festivos y tipo de cada día. Es una función pura de la fecha: servidor y visor coinciden.
// Los tiempos son segundos simulados (como `simTime`) y los días son días UTC.
//
// Tipo de día (el perfil de demanda que le toca en el modo automático):
//   weekday     laborable
//   preholiday  laborable cuyo día siguiente es festivo: más viajes por la tarde y gente de ocio por la noche
//   weekend     sábado; y domingo o festivo cuando el día siguiente tampoco es laborable
//   sunday      domingo o festivo (lunes a viernes) con el día siguiente laborable: por la tarde, poco movimiento
export function createHolidayCalendar(config = CONFIG.holidays, baseDate = CONFIG.sim.baseDate) {
  if (!Number.isFinite(baseDate)) throw new Error('Holiday calendar baseDate must be a valid timestamp');
  const years = new Map(); // año -> Map(número de día UTC -> nombre)

  function ofYear(year) {
    let holidays = years.get(year);
    if (holidays) return holidays;
    holidays = new Map();
    for (const [month, day, name] of config.fixed) holidays.set(Date.UTC(year, month - 1, day) / DAY_MS, name);
    const [easterMonth, easterDay] = easterSunday(year);
    const easter = Date.UTC(year, easterMonth - 1, easterDay) / DAY_MS;
    for (const [offset, name] of config.easter) holidays.set(easter + offset, name);
    years.set(year, holidays);
    return holidays;
  }

  const dayNumberAt = (seconds) => {
    if (!Number.isFinite(seconds)) throw new Error('Simulation time must be a valid number of seconds');
    return Math.floor((baseDate + seconds * 1000) / DAY_MS);
  };
  const nameOf = (dayNumber) => ofYear(new Date(dayNumber * DAY_MS).getUTCFullYear()).get(dayNumber) ?? null;
  const isWorking = (dayNumber) => {
    const weekday = weekdayOf(dayNumber);
    return weekday >= 1 && weekday <= 5 && nameOf(dayNumber) === null;
  };

  function kindOfDay(dayNumber) {
    const weekday = weekdayOf(dayNumber);
    if (weekday === 6) return 'weekend';
    if (isWorking(dayNumber)) return nameOf(dayNumber + 1) === null ? 'weekday' : 'preholiday';
    return isWorking(dayNumber + 1) ? 'sunday' : 'weekend';
  }

  // Nombre del festivo del día en que cae `seconds` (null si es un día normal; los domingos solo si coinciden con uno).
  const holidayAt = (seconds) => nameOf(dayNumberAt(seconds));
  const kindAt = (seconds) => kindOfDay(dayNumberAt(seconds));

  // Festivos de los días que se tocan entre `from` y `to` (segundos simulados, `to` exclusivo): [{ time, date, name }].
  function holidaysBetween(from, to) {
    const result = [];
    for (let day = dayNumberAt(from); day <= dayNumberAt(to - 1e-6); day++) {
      const name = nameOf(day);
      if (name !== null) result.push({ time: (day * DAY_MS - baseDate) / 1000, date: new Date(day * DAY_MS).toISOString().slice(0, 10), name });
    }
    return result;
  }

  return { holidayAt, kindAt, holidaysBetween };
}

export const holidayCalendar = createHolidayCalendar();
