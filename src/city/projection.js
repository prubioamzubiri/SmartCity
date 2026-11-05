import { CONFIG } from '../config.js';

const K_LAT = 110574;

// Coordenadas del mapa (x hacia el este, z hacia el sur, en metros desde el origen) de una latitud y longitud.
// Es la misma proyección que usa scripts/fetch-osm.mjs al generar la ciudad.
export function latLonToXZ(lat, lon, origin = CONFIG.events.origin) {
  const kLon = 111320 * Math.cos((origin.lat * Math.PI) / 180);
  return { x: (lon - origin.lon) * kLon, z: -(lat - origin.lat) * K_LAT };
}

export function xzToLatLon(x, z, origin = CONFIG.events.origin) {
  const kLon = 111320 * Math.cos((origin.lat * Math.PI) / 180);
  return { lat: origin.lat - z / K_LAT, lon: origin.lon + x / kLon };
}
