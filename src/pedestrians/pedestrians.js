import { CONFIG } from '../config.js';
import { demandFactor } from '../traffic/demand.js';

const P = CONFIG.pedestrians;
const STRIDE = 5; // x, z, dirX, dirZ, clase de vía
const BRIDGE_LANE = 0.7; // fracción del semiancho de la calzada por la que caminan en un puente
const MAX_STEPS = 400; // tramos máximos que recorre un paseo

// Hash sin estado: número en [0, 1) para el peatón `i`, la ventana `k` y el uso `salt`.
function rand(i, k, salt) {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(k + 0x7f4a7c15, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// Peatones de la ciudad (los simula el servidor). No guardan estado: la posición de cada uno es una función
// del tiempo y, en cada ventana, elige qué hacer: caminar por la acera de una calle o cruzar por un paso de
// peatones de OSM (en ese caso solo se ve mientras cruza).
export class Pedestrians {
  constructor(crossings = [], { max = P.max, graph = null, walkFraction = P.walkFraction, water = null } = {}) {
    this.crossings = crossings;
    this.count = Math.floor(crossings.length / STRIDE);
    this.graph = graph;
    this.water = water;
    this.walkFraction = walkFraction;
    this.sidewalks = graph ? sidewalkEdges(graph) : null;
    this.max = max;
    this.x = new Float32Array(max);
    this.z = new Float32Array(max);
    this.heading = new Float32Array(max); // giro sobre Y que apunta el triángulo (+X) hacia donde camina
    this.activeCount = 0;
  }

  // Posición a una hora simulada: el servidor y el visor usan esta misma función, así que coinciden.
  updateAt(simSeconds, scenario) {
    this.update(simSeconds * 1000, pedestrianDensity(demandFactor(simSeconds, scenario)));
  }

  // `density` en [0, 1]: fracción de los peatones que pueden estar en la calle.
  update(nowMs, density = 1) {
    const t = nowMs / 1000;
    const crossSlot = Math.floor(t / P.slotSeconds);
    const crossLocal = t - crossSlot * P.slotSeconds;
    const walkSlot = Math.floor(t / P.walkSeconds);
    const walkLocal = t - walkSlot * P.walkSeconds;
    const allowed = this.count || this.sidewalks ? Math.min(this.max, Math.round(this.max * Math.max(0, Math.min(1, density)))) : 0;
    let n = 0;
    for (let i = 0; i < allowed; i++) {
      if (this.sidewalks && (this.count === 0 || rand(i, walkSlot, 6) < this.walkFraction)) n = this.walk(i, walkSlot, walkLocal, n);
      else if (this.count) n = this.cross(i, crossSlot, crossLocal, n);
    }
    this.activeCount = n;
  }

  // Cruza la calle por un paso de peatones; solo se ve mientras cruza.
  cross(i, k, local, n) {
    const c = this.crossings;
    const slot = P.slotSeconds;
    const j = Math.floor(rand(i, k, 1) * this.count) * STRIDE;
    const road = CONFIG.roads.halfWidth[c[j + 4]];
    // En un puente solo se pisa la calzada: la acera quedaría suspendida sobre el agua.
    const half = this.inWater(c[j], c[j + 1]) ? road : road + P.margin;
    const speed = P.speed * (0.8 + 0.4 * rand(i, k, 2));
    const duration = (2 * half) / speed;
    const start = rand(i, k, 3) * Math.max(0, slot - duration);
    const s = (local - start) / duration;
    if (s < 0 || s > 1) return n;
    const dir = rand(i, k, 4) < 0.5 ? 1 : -1;
    const along = (2 * s - 1) * half * dir;
    const lateral = (rand(i, k, 5) - 0.5) * P.laneWidth;
    const dx = c[j + 2];
    const dz = c[j + 3];
    const x = c[j] + dx * along - dz * lateral;
    const z = c[j + 1] + dz * along + dx * lateral;
    if (this.inWaterOffBridge(x, z, c[j], c[j + 1])) return n;
    this.x[n] = x;
    this.z[n] = z;
    this.heading[n] = Math.atan2(-dz * dir, dx * dir);
    return n + 1;
  }

  // Camina por la acera desde un punto de salida aleatorio (tramo elegido en proporción a su longitud) y en cada
  // cruce sigue por una calle conectada, con preferencia por seguir recto. Solo desaparece en un callejón sin salida
  // de autovía o al terminar el paseo.
  walk(i, k, local, n) {
    const g = this.graph;
    const { edges, cumulative } = this.sidewalks;
    const target = rand(i, k, 7) * cumulative[cumulative.length - 1];
    let lo = 0;
    let hi = edges.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] > target) hi = mid;
      else lo = mid + 1;
    }
    let e = edges[lo];
    let p = rand(i, k, 9) * g.len[e];
    let dist = P.speed * (0.8 + 0.4 * rand(i, k, 2)) * local;
    for (let step = 0; p + dist > g.len[e]; step++) {
      dist -= g.len[e] - p;
      p = 0;
      e = step < MAX_STEPS ? this.nextEdge(e, i, k, step) : -1;
      if (e < 0) return n;
    }
    p += dist;
    const dx = g.ux[e];
    const dz = g.uz[e];
    const a = g.A[e];
    const cx = g.nx[a] + dx * p;
    const cz = g.nz[a] + dz * p;
    const road = CONFIG.roads.halfWidth[g.cls[e]];
    const reach = this.inWater(cx, cz) ? road * BRIDGE_LANE : road + P.margin / 2;
    let offset = (rand(i, k, 10) < 0.5 ? 1 : -1) * reach;
    let x = cx - dz * offset;
    let z = cz + dx * offset;
    if (this.inWaterOffBridge(x, z, cx, cz)) {
      // Acera en el agua (muelle, ría): prueba la acera de enfrente y, si tampoco, no se ve.
      offset = -offset;
      x = cx - dz * offset;
      z = cz + dx * offset;
      if (this.inWaterOffBridge(x, z, cx, cz)) return n;
    }
    this.x[n] = x;
    this.z[n] = z;
    this.heading[n] = Math.atan2(-dz, dx);
    return n + 1;
  }

  inWater(x, z) {
    return !!this.water && this.water.inWater(x, z);
  }

  // Un peatón no pisa el agua, salvo en un puente: ahí el eje de la calle (cx, cz) también está sobre el agua.
  inWaterOffBridge(x, z, cx, cz) {
    return this.inWater(x, z) && !this.inWater(cx, cz);
  }

  // Siguiente tramo al llegar al final de `e`: el que más sigue recto (con algo de azar), sin autovías ni dar la vuelta.
  nextEdge(e, i, k, step) {
    const g = this.graph;
    const node = g.B[e];
    let best = -1;
    let bestScore = -Infinity;
    for (let c = g.outStart[node], j = 0; c < g.outStart[node + 1]; c++, j++) {
      const f = g.outList[c];
      if (g.cls[f] === 0 || f === g.rev[e]) continue;
      const score = g.ux[e] * g.ux[f] + g.uz[e] * g.uz[f] + 1.2 * rand(i, k, 1000 + step * 16 + (j & 15));
      if (score > bestScore) {
        bestScore = score;
        best = f;
      }
    }
    return best >= 0 ? best : g.rev[e] >= 0 && g.cls[g.rev[e]] !== 0 ? g.rev[e] : -1;
  }
}

// Tramos con acera (todas las clases menos autovía) y su longitud acumulada, para elegir uno proporcionalmente.
function sidewalkEdges(g) {
  const edges = [];
  const cumulative = [];
  let total = 0;
  for (let e = 0; e < g.edgeCount; e++) {
    if (g.cls[e] === 0) continue;
    total += g.len[e];
    edges.push(e);
    cumulative.push(total);
  }
  return edges.length ? { edges, cumulative } : null;
}

// Fracción de peatones activa según la demanda de tráfico (0 a 1 y pico) y el mínimo configurado.
export const pedestrianDensity = (demand) => P.minDensity + (1 - P.minDensity) * Math.min(1, Math.max(0, demand));
