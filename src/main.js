// Arranque del visor: primero el idioma (SMARTCITY_LANG del servidor web, ?lang= en la dirección o VITE_LANG al
// compilar), después el resto, para que todos los textos (también los que se calculan al cargar) salgan en ese idioma.
import { setLang, t } from './i18n/index.js';

async function serverLang() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-cache' });
    if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) return (await res.json()).lang;
  } catch {
    // sin servidor web propio (npm run dev, GitHub Pages): idioma por defecto
  }
  return null;
}

const asked = new URLSearchParams(location.search).get('lang');
setLang(asked || (await serverLang()) || import.meta.env.VITE_LANG || 'es');
document.documentElement.lang = setLang();
const loading = document.getElementById('loading');
if (loading) loading.textContent = t('Cargando ciudad…');
document.title = t('SmartCity Donostia');

const { start } = await import('./app.js');
start();
