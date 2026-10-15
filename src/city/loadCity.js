import { CONFIG } from '../config.js';

export async function loadCity() {
  const res = await fetch(CONFIG.dataUrl);
  if (!res.ok) {
    throw new Error(`No se pudo cargar ${CONFIG.dataUrl} (HTTP ${res.status}). Ejecuta "npm run fetch-osm".`);
  }
  return res.json();
}
