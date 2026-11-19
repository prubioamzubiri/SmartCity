// Idiomas del servicio: castellano (es), euskera (eu) e inglés (en). Lo elige SMARTCITY_LANG en el .env.
// Los textos se escriben en castellano en el código y `t()` los traduce con los diccionarios de eu.js y en.js; lo que no
// está en un diccionario sale en castellano (test/i18n.test.js comprueba que no falte nada). Las variables van entre
// llaves: t('{n} coches', { n: 3 }). Lo que leen los programas (campos JSON, columnas CSV, códigos) no se traduce.
import eu from './eu.js';
import en from './en.js';

export const LANGS = ['es', 'eu', 'en'];
const DICTS = { eu, en };
const LOCALES = { es: 'es-ES', eu: 'es-ES', en: 'en-GB' }; // el euskera escribe los números como el castellano
let current = 'es';

// Cambia el idioma (devuelve el que queda; uno desconocido no cambia nada).
export function setLang(lang) {
  if (LANGS.includes(lang)) current = lang;
  return current;
}

export const getLang = () => current;
// Locale para fechas y números (toLocaleString...).
export const locale = () => LOCALES[current];

export function t(text, vars) {
  let out = current === 'es' ? text : (DICTS[current][text] ?? text);
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}

// Nombres de días y meses (índices como Date.getUTCDay / getUTCMonth).
const NAMES = {
  es: {
    days: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
    short: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
    initials: ['D', 'L', 'M', 'X', 'J', 'V', 'S'],
    months: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  },
  eu: {
    days: ['igandea', 'astelehena', 'asteartea', 'asteazkena', 'osteguna', 'ostirala', 'larunbata'],
    short: ['ig', 'al', 'ar', 'az', 'og', 'or', 'lr'],
    initials: ['I', 'A', 'A', 'A', 'O', 'O', 'L'],
    months: ['urtarrila', 'otsaila', 'martxoa', 'apirila', 'maiatza', 'ekaina', 'uztaila', 'abuztua', 'iraila', 'urria', 'azaroa', 'abendua'],
  },
  en: {
    days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    short: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    initials: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  },
};
export const dayName = (i) => NAMES[current].days[i];
export const dayShort = (i) => NAMES[current].short[i];
export const dayInitial = (i) => NAMES[current].initials[i];
export const monthName = (i) => NAMES[current].months[i];

// Día de la semana guardado en castellano (columna weekday de los históricos) en el idioma del servicio.
const SPANISH_DAYS = new Map(NAMES.es.days.map((d, i) => [d, i]));
export const translateWeekday = (value) => (SPANISH_DAYS.has(value) ? dayName(SPANISH_DAYS.get(value)) : value);

// Fecha larga: «lunes 5 de enero de 2026», «2026ko urtarrilaren 5a, astelehena», «Monday 5 January 2026».
export function longDate(d) {
  const day = dayName(d.getUTCDay());
  const month = monthName(d.getUTCMonth());
  if (current === 'eu') return `${d.getUTCFullYear()}ko ${month}ren ${d.getUTCDate()}a, ${day}`;
  if (current === 'en') return `${day} ${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`;
  return `${day} ${d.getUTCDate()} de ${month} de ${d.getUTCFullYear()}`;
}
