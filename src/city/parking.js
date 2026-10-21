import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { demandFactor } from '../traffic/demand.js';

const COLORS = { area: 0x2f6fdd, underground: 0x7a4fd6, street: 0x4fc3f7, space: 0xffffff };
const STREET_WIDTH = 2.2;
const SPACE_SIZE = 2.5;
const MARKER_SIZE = 36;
const DEFAULT_UNDERGROUND_CAPACITY = 150;
const FREE = new THREE.Color(0x2ecc71);
const HALF = new THREE.Color(0xf1c40f);
const FULL = new THREE.Color(0xe74c3c);
const SPACE_AREA = 25; // m² por plaza para estimar la capacidad en superficie
const BUCKET_SECONDS = 300;
const tmpColor = new THREE.Color();

function ringToPoints(flat) {
  const pts = [];
  for (let i = 0; i < flat.length; i += 2) pts.push(new THREE.Vector2(flat[i], flat[i + 1]));
  return pts;
}

function areaGeometry(flat) {
  const g = new THREE.ShapeGeometry(new THREE.Shape(ringToPoints(flat)));
  g.rotateX(Math.PI / 2);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.getAttribute('position'));
  out.setIndex(g.index);
  return out;
}

function flatMesh(geometries, color, y, vertexColors = false) {
  if (!geometries.length) return null;
  const mesh = new THREE.Mesh(
    mergeGeometries(geometries),
    new THREE.MeshBasicMaterial({ color, vertexColors, side: THREE.DoubleSide }),
  );
  mesh.position.y = y;
  mesh.frustumCulled = false;
  return mesh;
}

function squares(coords, size) {
  const positions = [];
  const indices = [];
  const h = size / 2;
  for (let i = 0; i < coords.length; i += 2) {
    const x = coords[i], z = coords[i + 1];
    const base = positions.length / 3;
    positions.push(x - h, 0, z - h, x + h, 0, z - h, x - h, 0, z + h, x + h, 0, z + h);
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  return g;
}

// Franjas junto a la calle: la banda queda a un lado, fuera de la calzada.
function streetGeometry(street) {
  const positions = [];
  const indices = [];
  for (const [cls, side, ...line] of street) {
    const hw = CONFIG.roads.halfWidth[cls];
    const inner = side * hw;
    const outer = side * (hw + STREET_WIDTH);
    for (let i = 0; i < line.length - 2; i += 2) {
      const ax = line[i], az = line[i + 1], bx = line[i + 2], bz = line[i + 3];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5) continue;
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      const base = positions.length / 3;
      positions.push(
        ax + nx * inner, 0, az + nz * inner, ax + nx * outer, 0, az + nz * outer,
        bx + nx * inner, 0, bz + nz * inner, bx + nx * outer, 0, bz + nz * outer,
      );
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
  if (!indices.length) return [];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  return [g];
}

// Disco blanco con "P" negra: el color final lo da el tinte según la ocupación.
function undergroundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(64, 64, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#111111';
  ctx.font = 'bold 76px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('P', 64, 68);
  return new THREE.CanvasTexture(canvas);
}

// Un icono "P" por cada parking subterráneo de uso público, visible desde lejos.
function undergroundMarkers(list) {
  const map = undergroundTexture();
  return list.map(([x, z, capacity, fee, name], i) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthWrite: false }));
    sprite.scale.set(MARKER_SIZE, MARKER_SIZE, 1);
    sprite.position.set(x, MARKER_SIZE, z);
    sprite.userData = {
      capacity: capacity || DEFAULT_UNDERGROUND_CAPACITY,
      estimatedCapacity: !capacity,
      fee: !!fee,
      name,
      bias: 0.85 + 0.3 * ((i * 0.618034) % 1),
      occupancy: 0,
    };
    return sprite;
  });
}

// Ocupación simulada (no es un dato real de OSM): sigue la curva de demanda de la ciudad.
const occupancyAt = (demand, bias) => Math.min(1, Math.max(0.05, (0.15 + 0.8 * demand) * bias));

function setRamp(color, occupancy) {
  if (occupancy < 0.5) color.lerpColors(FREE, HALF, occupancy / 0.5);
  else color.lerpColors(HALF, FULL, (occupancy - 0.5) / 0.5);
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i += 2) {
    const j = (i + 2) % ring.length;
    a += ring[i] * ring[j + 1] - ring[j] * ring[i + 1];
  }
  return Math.abs(a) / 2;
}

const lotCache = new WeakMap();

// Áreas de parking con capacidad (estimada si OSM no la indica), sesgo de ocupación y caja envolvente.
function lotsOf(data) {
  let lots = lotCache.get(data);
  if (lots) return lots;
  lots = (data.parking?.areas ?? []).map(([capacity, type, ring], i) => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let k = 0; k < ring.length; k += 2) {
      minX = Math.min(minX, ring[k]); maxX = Math.max(maxX, ring[k]);
      minZ = Math.min(minZ, ring[k + 1]); maxZ = Math.max(maxZ, ring[k + 1]);
    }
    return {
      type, ring, minX, maxX, minZ, maxZ,
      capacity: capacity || Math.max(4, Math.round(ringArea(ring) / SPACE_AREA)),
      estimated: !capacity,
      bias: 0.7 + 0.6 * ((i * 0.618034) % 1),
    };
  });
  lotCache.set(data, lots);
  return lots;
}

export const lotOccupancy = (lot, simTime) => occupancyAt(demandFactor(simTime), lot.bias);

export function updateParkingOccupancy(group, simTime) {
  const bucket = Math.floor(simTime / BUCKET_SECONDS);
  if (group.userData.bucket === bucket) return;
  group.userData.bucket = bucket;
  const demand = demandFactor(simTime);
  for (const sprite of group.userData.markers ?? []) {
    const d = sprite.userData;
    d.occupancy = occupancyAt(demand, d.bias);
    setRamp(sprite.material.color, d.occupancy);
  }
  const surface = group.userData.surface;
  if (!surface) return;
  const colors = surface.mesh.geometry.getAttribute('color');
  for (const { bias, vertexStart, vertexCount } of surface.lots) {
    setRamp(tmpColor, occupancyAt(demand, bias));
    for (let v = 0; v < vertexCount; v++) colors.setXYZ(vertexStart + v, tmpColor.r, tmpColor.g, tmpColor.b);
  }
  colors.needsUpdate = true;
}

export function createParking(data) {
  const group = new THREE.Group();
  const parking = data.parking;
  if (!parking) return group;

  const surface = [];
  const surfaceLots = [];
  const underground = [];
  let vertexStart = 0;
  for (const lot of lotsOf(data)) {
    if (lot.ring.length < 6) continue;
    const g = areaGeometry(lot.ring);
    if (lot.type === 2) {
      underground.push(g);
      continue;
    }
    const vertexCount = g.getAttribute('position').count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(vertexCount * 3).fill(1), 3));
    surface.push(g);
    surfaceLots.push({ bias: lot.bias, vertexStart, vertexCount });
    vertexStart += vertexCount;
  }

  const surfaceMesh = flatMesh(surface, 0xffffff, 0.25, true);
  if (surfaceMesh) group.userData.surface = { mesh: surfaceMesh, lots: surfaceLots };
  const layers = [
    surfaceMesh,
    flatMesh(parking.points.length ? [squares(parking.points, 14)] : [], COLORS.area, 0.25),
    flatMesh(underground, COLORS.underground, 0.24),
    flatMesh(streetGeometry(parking.street), COLORS.street, 0.3),
    flatMesh(parking.spaces.length ? [squares(parking.spaces, SPACE_SIZE)] : [], COLORS.space, 0.35),
  ];
  for (const mesh of layers) if (mesh) group.add(mesh);
  group.userData.markers = undergroundMarkers(parking.underground ?? []);
  group.add(...group.userData.markers);
  return group;
}

export const PARKING_TYPE_LABEL = ['en superficie', 'en altura', 'subterráneo'];

// Devuelve el parking que contiene el punto (x, z), o null.
export function createParkingPicker(data) {
  const lots = lotsOf(data);
  const contains = (ring, x, z) => {
    let inside = false;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const ax = ring[i], az = ring[i + 1], bx = ring[j], bz = ring[j + 1];
      if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
    }
    return inside;
  };
  return (x, z) =>
    lots.find((l) => x >= l.minX && x <= l.maxX && z >= l.minZ && z <= l.maxZ && contains(l.ring, x, z)) ?? null;
}

export function parkingStats(data) {
  const p = data.parking;
  if (!p) return null;
  const capacity = p.areas.reduce((sum, a) => sum + a[0], 0);
  return { lots: p.areas.length + p.points.length / 2, spaces: p.spaces.length / 2, street: p.street.length, capacity, underground: p.underground?.length ?? 0 };
}
