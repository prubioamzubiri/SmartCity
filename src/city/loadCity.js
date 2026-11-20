import { CONFIG } from '../config.js';
import { withBikeStations } from '../bikes/sharing.js';
import { t } from '../i18n/index.js';

export async function loadCity() {
  const res = await fetch(CONFIG.dataUrl, { cache: 'no-cache' }); // revalida: un mapa en caché de otro despliegue no coincidiría con el del servidor
  if (!res.ok) {
    throw new Error(t('No se pudo cargar {dataUrl} (HTTP {status}). Ejecuta "npm run fetch-osm".', { dataUrl: CONFIG.dataUrl, status: res.status }));
  }
  const data = await res.json();
  if (!data.bicycleStations?.length) {
    const municipalRes = await fetch(CONFIG.municipalDataUrl, { cache: 'no-cache' });
    if (!municipalRes.ok) {
      throw new Error(t('No se pudo cargar {municipalDataUrl} (HTTP {status}) para recuperar las estaciones Dbizi.', { municipalDataUrl: CONFIG.municipalDataUrl, status: municipalRes.status }));
    }
    const municipal = await municipalRes.json();
    withBikeStations(data, municipal);
  }
  return data;
}
