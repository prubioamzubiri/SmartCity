// Descarga edificios y calles de Donostia desde OpenStreetMap (Overpass) y genera public/data/city.json.
import { mkdir, writeFile } from 'node:fs/promises';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const AREA = 'area["boundary"="administrative"]["admin_level"="8"]["name"~"Donostia"]->.city;';
const ORIGIN = { lat: 43.3183, lon: -1.9812 };
const K_LAT = 110574;
const K_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

const ROAD_CLASS = {
  motorway: 0, motorway_link: 0, trunk: 0, trunk_link: 0,
  primary: 1, primary_link: 1,
  secondary: 2, secondary_link: 2,
  tertiary: 3, tertiary_link: 3,
  unclassified: 4, residential: 4, living_street: 4,
};

const project = (lat, lon) => [(lon - ORIGIN.lon) * K_LON, -(lat - ORIGIN.lat) * K_LAT];
const round1 = (v) => Math.round(v * 10) / 10;

async function overpass(query) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        console.log(`Consultando ${url} (intento ${attempt + 1})...`);
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
            'User-Agent': 'SmartCityDonostia-educational/0.1',
          },
          body: 'data=' + encodeURIComponent(query),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        lastError = err;
        console.warn(`  fallo: ${err.message}`);
      }
    }
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
  throw lastError;
}

// Caja orientada según la arista más larga de la huella.
function orientedBox(points) {
  let best = 0;
  let angle = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1][0] - points[i][0];
    const dz = points[i + 1][1] - points[i][1];
    const l = dx * dx + dz * dz;
    if (l > best) {
      best = l;
      angle = Math.atan2(dz, dx);
    }
  }
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const [x, z] of points) {
    const u = x * c + z * s;
    const v = -x * s + z * c;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  const cu = (minU + maxU) / 2;
  const cv = (minV + maxV) / 2;
  return {
    cx: cu * c - cv * s,
    cz: cu * s + cv * c,
    w: maxU - minU,
    d: maxV - minV,
    angle,
  };
}

function buildingHeight(tags, id) {
  const h = parseFloat(tags.height);
  if (h > 0) return h;
  const levels = parseFloat(tags['building:levels']);
  if (levels > 0) return levels * 3.1;
  return 9 + (id % 4) * 3;
}

function oneway(tags) {
  const v = tags.oneway;
  if (v === 'yes' || v === 'true' || v === '1') return 1;
  if (v === '-1') return -1;
  if (tags.junction === 'roundabout' || tags.highway === 'motorway') return 1;
  return 0;
}

async function fetchBuildings() {
  const json = await overpass(`[out:json][timeout:300];${AREA}way["building"](area.city);out geom;`);
  const out = [];
  for (const el of json.elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 4) continue;
    const pts = el.geometry.map((g) => project(g.lat, g.lon));
    const box = orientedBox(pts);
    if (box.w * box.d < 12) continue;
    const h = buildingHeight(el.tags || {}, el.id);
    out.push(round1(box.cx), round1(box.cz), round1(box.w), round1(box.d), Math.round(box.angle * 1000) / 1000, round1(h));
  }
  console.log(`Edificios: ${out.length / 6}`);
  return out;
}

async function fetchRoads() {
  const filter = '^(' + Object.keys(ROAD_CLASS).join('|') + ')$';
  const json = await overpass(
    `[out:json][timeout:300];${AREA}way["highway"~"${filter}"](area.city)->.w;(.w;>;);out body qt;`,
  );
  const nodesById = new Map();
  const ways = [];
  for (const el of json.elements) {
    if (el.type === 'node') nodesById.set(el.id, el);
    else if (el.type === 'way') ways.push(el);
  }

  const index = new Map();
  const nodes = [];
  const signals = [];
  const useNode = (id) => {
    let i = index.get(id);
    if (i !== undefined) return i;
    const n = nodesById.get(id);
    if (!n) return -1;
    i = nodes.length / 2;
    index.set(id, i);
    const [x, z] = project(n.lat, n.lon);
    nodes.push(round1(x), round1(z));
    if (n.tags && n.tags.highway === 'traffic_signals') signals.push(i, id);
    return i;
  };

  const outWays = [];
  for (const w of ways) {
    const tags = w.tags || {};
    if (tags.area === 'yes' || tags.access === 'private' || tags.motor_vehicle === 'no') continue;
    const idx = w.nodes.map(useNode);
    if (idx.includes(-1) || idx.length < 2) continue;
    outWays.push([ROAD_CLASS[tags.highway], oneway(tags), ...idx]);
  }
  console.log(`Calles: ${outWays.length} tramos, ${nodes.length / 2} nodos, ${signals.length / 2} semáforos`);
  return { nodes, ways: outWays, signals };
}

const buildings = await fetchBuildings();
const roads = await fetchRoads();

let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
for (let i = 0; i < roads.nodes.length; i += 2) {
  minX = Math.min(minX, roads.nodes[i]);
  maxX = Math.max(maxX, roads.nodes[i]);
  minZ = Math.min(minZ, roads.nodes[i + 1]);
  maxZ = Math.max(maxZ, roads.nodes[i + 1]);
}

const city = {
  origin: ORIGIN,
  bounds: { minX, maxX, minZ, maxZ },
  buildings,
  nodes: roads.nodes,
  ways: roads.ways,
  signals: roads.signals,
};

await mkdir('public/data', { recursive: true });
await writeFile('public/data/city.json', JSON.stringify(city));
console.log('Generado public/data/city.json');
