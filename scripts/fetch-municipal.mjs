import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { MUNICIPAL_LAYERS, MUNICIPAL_SERVICE, normalizeFeatures, validateMunicipalSnapshot } from '../src/data/municipal.js';

async function getJson(url) {
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(90000), headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      if (json.error || json.success === false) throw new Error(JSON.stringify(json.error ?? 'API failure'));
      return json;
    } catch (err) { error = err; }
  }
  throw new Error(`No se pudo descargar ${url}: ${error.message}`);
}

const city = JSON.parse(await readFile('public/data/city.json', 'utf8'));
const layers = {};
const sources = [];
for (const layer of MUNICIPAL_LAYERS) {
  console.log(`Descargando ${layer.title}...`);
  const url = `${MUNICIPAL_SERVICE}/${layer.id}/query`;
  const idsResponse = await getJson(`${url}?where=1%3D1&returnIdsOnly=true&f=json`);
  const ids = idsResponse.objectIds?.sort((a, b) => a - b);
  if (!Array.isArray(ids) || !ids.length || ids.length > 100000 || new Set(ids).size !== ids.length) throw new Error(`IDs incompletos: ${layer.key}`);
  const features = [];
  // This service has no offset pagination. Fetch explicit ID batches to avoid its 2000-record limit.
  for (let start = 0; start < ids.length; start += 250) {
    const batch = ids.slice(start, start + 250);
    const params = new URLSearchParams({ objectIds: batch.join(','), outFields: '*', outSR: '4326', f: 'geojson' });
    const collection = await getJson(`${url}?${params}`);
    if (collection.exceededTransferLimit) throw new Error(`Respuesta truncada: ${layer.key}`);
    features.push(...normalizeFeatures(layer.key, collection, city.origin));
  }
  const received = new Set(features.map(f => f.id));
  if (received.size !== ids.length || features.length !== ids.length || ids.some(id => !received.has(id))) throw new Error(`Faltan elementos: ${layer.key}`);
  layers[layer.key] = features.sort((a, b) => a.id - b.id);
  const catalogueUrl = `https://www.donostia.eus/datosabiertos/catalogo/${layer.catalogue}`;
  const metadata = await getJson(`https://www.donostia.eus/datosabiertos/api/3/action/package_show?id=${layer.catalogue}`);
  sources.push({ ...layer, catalogueUrl, serviceUrl: `${MUNICIPAL_SERVICE}/${layer.id}`, count: features.length,
    metadataModified: metadata.result.metadata_modified, licence: metadata.result.license_title ?? metadata.result.license_id });
  console.log(`${layer.key}: ${features.length} elementos completos.`);
}
const datasetId = createHash('sha256').update(JSON.stringify({ origin: city.origin, layers })).digest('hex');
const snapshot = { version: 1, datasetId, fetchedAt: new Date().toISOString(), origin: city.origin,
  attribution: 'Donostiako Udala - Ayuntamiento de Donostia / San Sebastián. GeoDonostia.',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/', sources, layers };
validateMunicipalSnapshot(snapshot, city.origin);
await mkdir('public/data', { recursive: true });
await writeFile('public/data/municipal.json.tmp', JSON.stringify(snapshot));
await rename('public/data/municipal.json.tmp', 'public/data/municipal.json');
console.log(`Generado public/data/municipal.json (${datasetId}).`);
