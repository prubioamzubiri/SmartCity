// Idioma del servicio (SMARTCITY_LANG: es, eu o en). Se importa antes que nada: algunos textos se calculan al cargar
// los módulos (nombres de eventos, tipos de restricción...).
import { LANGS, setLang } from '../src/i18n/index.js';

const wanted = (process.env.SMARTCITY_LANG ?? '').trim().toLowerCase();
if (wanted && !LANGS.includes(wanted)) {
  console.error(`SMARTCITY_LANG debe ser uno de: ${LANGS.join(', ')} (es: ${process.env.SMARTCITY_LANG})`);
  process.exit(1);
}
export const lang = setLang(wanted || 'es');
