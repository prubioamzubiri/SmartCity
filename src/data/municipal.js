export const MUNICIPAL_SERVICE = 'https://www.donostia.eus/geozerbitzuak/rest/services/ext/GARRAIOA/MapServer';
export const MUNICIPAL_LAYERS = [
  { key: 'roads', id: 19, title: 'Ejes viales oficiales', catalogue: 'ejes-viales' },
  { key: 'speedLimits', id: 26, title: 'Límites de velocidad', catalogue: 'velocidad-viales' },
  { key: 'stations', id: 3, title: 'Estaciones Dbizi', catalogue: 'bicicleta_dbizi' },
];

// Same local metre projection used by fetch-osm; the API is explicitly asked for WGS84.
export function projectCoordinate(coordinate, origin) {
  if (!Array.isArray(coordinate) || coordinate.length < 2 || !coordinate.slice(0, 2).every(Number.isFinite) ||
    Math.abs(coordinate[0]) > 180 || Math.abs(coordinate[1]) > 90) throw new Error('Coordenadas WGS84 no válidas.');
  return [Math.round((coordinate[0] - origin.lon) * 111320 * Math.cos(origin.lat * Math.PI / 180) * 10) / 10,
    Math.round(-(coordinate[1] - origin.lat) * 110574 * 10) / 10];
}

export function normalizeFeatures(key, collection, origin) {
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) throw new Error(`GeoJSON no válido: ${key}`);
  return collection.features.map(feature => {
    const p = feature.properties ?? {};
    const id = feature.id ?? p.FID;
    if (!Number.isInteger(id)) throw new Error(`Identificador municipal no válido: ${key}`);
    const geometry = feature.geometry;
    if (key === 'stations') {
      if (geometry?.type !== 'Point') throw new Error('Geometría de estación no válida.');
      const [x, z] = projectCoordinate(geometry.coordinates, origin);
      return { id, name: String(p.Izendbizi ?? p.IzenKalea ?? `Dbizi ${id}`), x, z };
    }
    const lines = geometry?.type === 'LineString' ? [geometry.coordinates] : geometry?.type === 'MultiLineString' ? geometry.coordinates : null;
    if (!Array.isArray(lines) || !lines.length || lines.some(line => !Array.isArray(line) || line.length < 2)) throw new Error(`Geometría vial no válida: ${id}`);
    const paths = lines.map(line => line.flatMap(point => projectCoordinate(point, origin)));
    const base = { id, name: String(p.Kalea ?? p.IzenKalea ?? ''), paths };
    if (key === 'roads') return { ...base, kind: String(p.IzenEbide ?? ''), width: Number(p.Zabalera) || null };
    const raw = String(p.Abiadura ?? '').trim();
    const limitKmh = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : null;
    return { ...base, limitKmh: limitKmh > 0 && limitKmh <= 130 ? limitKmh : null };
  });
}

export function validateMunicipalSnapshot(snapshot, origin) {
  if (snapshot?.version !== 1 || snapshot.origin?.lat !== origin.lat || snapshot.origin?.lon !== origin.lon ||
    !/^[a-f0-9]{64}$/.test(snapshot.datasetId ?? '') || !Number.isFinite(Date.parse(snapshot.fetchedAt))) {
    throw new Error('La instantánea municipal no es compatible con este mapa.');
  }
  for (const key of ['roads', 'speedLimits', 'stations']) {
    const features = snapshot.layers?.[key];
    if (!Array.isArray(features) || !features.length || features.length > 100000) throw new Error(`Capa municipal vacía o no válida: ${key}`);
    for (const f of features) {
      if (!Number.isInteger(f.id) || typeof f.name !== 'string') throw new Error('Elemento municipal no válido.');
      if (key === 'stations') {
        if (![f.x, f.z].every(Number.isFinite)) throw new Error('Estación municipal no válida.');
      } else {
        if (!Array.isArray(f.paths) || !f.paths.length || f.paths.some(p => !Array.isArray(p) || p.length < 4 || p.length % 2 || !p.every(Number.isFinite))) throw new Error('Trayectoria municipal no válida.');
        if (key === 'speedLimits' && f.limitKmh !== null && !(Number.isFinite(f.limitKmh) && f.limitKmh > 0 && f.limitKmh <= 130)) throw new Error('Límite municipal no válido.');
      }
    }
  }
  return snapshot;
}
