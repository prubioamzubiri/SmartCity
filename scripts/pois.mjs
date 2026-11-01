// Categorías de puntos de interés que atraen peatones (el índice se guarda en city.json y se usa en config.pedestrians.poiWeights).
export const POI_CATEGORIES = ['comercio', 'hostelería', 'transporte', 'educación', 'servicios', 'turismo'];

const HOSPITALITY = new Set(['restaurant', 'cafe', 'bar', 'fast_food', 'pub', 'ice_cream', 'biergarten', 'food_court']);
const EDUCATION = new Set(['school', 'kindergarten', 'college', 'university', 'library']);
const SERVICES = new Set([
  'pharmacy', 'bank', 'post_office', 'townhall', 'hospital', 'clinic', 'doctors', 'dentist', 'cinema', 'theatre',
  'marketplace', 'community_centre', 'courthouse', 'police', 'arts_centre',
]);
const TOURISM = new Set(['attraction', 'museum', 'gallery', 'hotel', 'hostel', 'viewpoint', 'guest_house', 'apartment']);

// Overpass: elementos que clasifica `classifyPoi` (nodos, vías y relaciones; las dos últimas con su centro).
export const POI_QUERY =
  'nwr["shop"](area.city);' +
  `nwr["amenity"~"^(${[...HOSPITALITY, ...EDUCATION, ...SERVICES, 'bus_station'].join('|')})$"](area.city);` +
  'nwr["highway"="bus_stop"](area.city);' +
  'nwr["public_transport"~"^(platform|station)$"](area.city);' +
  'nwr["railway"~"^(station|tram_stop|halt)$"](area.city);' +
  `nwr["tourism"~"^(${[...TOURISM].join('|')})$"](area.city);`;

// Índice de categoría de un elemento de OSM según sus etiquetas, o -1 si no atrae peatones.
export function classifyPoi(tags = {}) {
  if (tags.highway === 'bus_stop' || tags.amenity === 'bus_station' || ['platform', 'station'].includes(tags.public_transport) ||
      ['station', 'tram_stop', 'halt'].includes(tags.railway)) return 2;
  if (HOSPITALITY.has(tags.amenity)) return 1;
  if (EDUCATION.has(tags.amenity)) return 3;
  if (SERVICES.has(tags.amenity)) return 4;
  if (TOURISM.has(tags.tourism)) return 5;
  if (tags.shop && tags.shop !== 'vacant' && tags.shop !== 'no') return 0;
  return -1;
}

// Lista plana [x, z, categoría, ...]. Una parada de bus se representa a menudo con varios elementos (poste, andén, parada):
// los de transporte a menos de `mergeDistance` metros cuentan como uno.
export function extractPois(elements, project, round = (v) => v, mergeDistance = 15) {
  const out = [];
  const transit = [];
  for (const el of elements) {
    const category = classifyPoi(el.tags);
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (category < 0 || lat === undefined || lon === undefined) continue;
    const [x, z] = project(lat, lon);
    if (category === 2) {
      if (transit.some((p) => Math.hypot(p[0] - x, p[1] - z) < mergeDistance)) continue;
      transit.push([x, z]);
    }
    out.push(round(x), round(z), category);
  }
  return out;
}
