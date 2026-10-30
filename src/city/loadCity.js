import { CONFIG } from '../config.js';

export async function loadCity() {
  const res = await fetch(CONFIG.dataUrl, { cache: 'no-cache' }); // revalida: un mapa en caché de otro despliegue no coincidiría con el del servidor
  if (!res.ok) {
    throw new Error(`No se pudo cargar ${CONFIG.dataUrl} (HTTP ${res.status}). Ejecuta "npm run fetch-osm".`);
  }
  return res.json();
}
