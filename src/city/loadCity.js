import { CONFIG } from '../config.js';
import { withBikeStations } from '../bikes/sharing.js';

export async function loadCity() {
  const res = await fetch(CONFIG.dataUrl, { cache: 'no-cache' }); // revalida: un mapa en caché de otro despliegue no coincidiría con el del servidor
  if (!res.ok) {
    throw new Error(`No se pudo cargar ${CONFIG.dataUrl} (HTTP ${res.status}). Ejecuta "npm run fetch-osm".`);
  }
  const data = await res.json();
  if (!data.bicycleStations?.length) {
    const municipalRes = await fetch(CONFIG.municipalDataUrl, { cache: 'no-cache' });
    if (!municipalRes.ok) {
      throw new Error(`No se pudo cargar ${CONFIG.municipalDataUrl} (HTTP ${municipalRes.status}) para recuperar las estaciones Dbizi.`);
    }
    const municipal = await municipalRes.json();
    withBikeStations(data, municipal);
  }
  return data;
}
