import { CONFIG } from '../config.js';

export const RESTRICTION_MODES = {
  pedestrians_only: 'Calle cortada: solo peatones (ni coches ni autobuses)',
  buses_and_pedestrians: 'Solo autobuses y peatones (los coches no pasan)',
  entry_limit: 'Zona de acceso restringido: los coches de fuera solo entran si hay menos de `limit` dentro',
};

export const MAX_RESTRICTIONS = 100;
export const MAX_RADIUS = 1000;
const MAX_WAYS = 200;

export const ROAD_CLASSES = ['motorway', 'primary', 'secondary', 'tertiary', 'residential'];

export class RestrictionError extends Error {}

// Distancia de un punto a un tramo.
export function distanceToEdge(g, e, x, z) {
  const ax = g.nx[g.A[e]];
  const az = g.nz[g.A[e]];
  const t = Math.min(1, Math.max(0, ((x - ax) * g.ux[e] + (z - az) * g.uz[e]) / g.len[e]));
  return Math.hypot(x - (ax + g.ux[e] * g.len[e] * t), z - (az + g.uz[e] * g.len[e] * t));
}

// Calles (índices de data.ways) con algún tramo a menos de `radius` metros de un punto, de la más cercana a la más lejana.
export function roadsNear(g, x, z, radius) {
  const nearest = new Map();
  for (let e = 0; e < g.edgeCount; e++) {
    const d = distanceToEdge(g, e, x, z);
    if (d <= radius && d < (nearest.get(g.way[e]) ?? Infinity)) nearest.set(g.way[e], d);
  }
  return [...nearest].sort((p, q) => p[1] - q[1]).map(([way, distance]) => ({ way, distance: Math.round(distance) }));
}

// Estado completo de la calle `way`: longitud, extremos y coches ahora mismo.
export function describeWay(g, way, sim = null) {
  let length = 0;
  let edges = 0;
  let cars = 0;
  let oneway = true;
  let first = -1;
  let last = -1;
  for (let e = 0; e < g.edgeCount; e++) {
    if (g.way[e] !== way) continue;
    edges++;
    cars += sim?.edgeCars[e]?.length ?? 0;
    if (g.rev[e] >= 0) oneway = false;
    // En una calle de doble sentido cada tramo aparece dos veces: se mide solo el de ida (el que se creó primero).
    if (g.rev[e] >= 0 && g.rev[e] < e) continue;
    if (first < 0) first = e;
    last = e;
    length += g.len[e];
  }
  if (first < 0) return null;
  const round = (v) => Math.round(v * 10) / 10;
  return {
    way,
    class: ROAD_CLASSES[g.cls[first]],
    oneway,
    length: Math.round(length),
    edges,
    from: { x: round(g.nx[g.A[first]]), z: round(g.nz[g.A[first]]) },
    to: { x: round(g.nx[g.B[last]]), z: round(g.nz[g.B[last]]) },
    cars,
  };
}

// Cortes de calle y zonas de acceso restringido. Una restricción se define por una zona circular (`area`) o por
// calles concretas (`ways`) y se convierte en el conjunto de tramos del grafo que afecta.
export class Restrictions {
  constructor({ graph, sim, buses, lines, getSimTime }) {
    this.graph = graph;
    this.sim = sim;
    this.buses = buses;
    this.lines = lines;
    this.getSimTime = getSimTime;
    this.items = [];
    this.nextId = 1;
  }

  edgesOf({ area, ways }) {
    const g = this.graph;
    const edges = [];
    if (ways) {
      const set = new Set(ways);
      for (let e = 0; e < g.edgeCount; e++) if (set.has(g.way[e])) edges.push(e);
    } else {
      for (let e = 0; e < g.edgeCount; e++) if (distanceToEdge(g, e, area.x, area.z) <= area.radius) edges.push(e);
    }
    return Int32Array.from(edges);
  }

  // Valida la definición y la devuelve normalizada; lanza RestrictionError si no es válida.
  normalize({ mode, area, ways, limit, name }) {
    if (!Object.hasOwn(RESTRICTION_MODES, mode)) throw new RestrictionError(`mode debe ser uno de: ${Object.keys(RESTRICTION_MODES).join(', ')}`);
    if ((area === undefined) === (ways === undefined)) throw new RestrictionError('Indica la zona (x, z, radius) o las calles (ways), pero no ambas');
    const out = { mode, name: typeof name === 'string' ? name.slice(0, 60) : '' };
    if (area !== undefined) {
      const { x, z, radius } = area;
      if (![x, z, radius].every(Number.isFinite)) throw new RestrictionError('La zona necesita x, z y radius numéricos');
      if (radius < 1 || radius > MAX_RADIUS) throw new RestrictionError(`radius debe estar entre 1 y ${MAX_RADIUS} metros`);
      out.area = { x, z, radius };
    } else {
      if (!Array.isArray(ways) || !ways.length || ways.length > MAX_WAYS) throw new RestrictionError(`ways debe ser una lista de 1 a ${MAX_WAYS} calles`);
      if (!ways.every((w) => Number.isInteger(w) && w >= 0 && w < this.graph.wayCount)) throw new RestrictionError('ways contiene calles que no existen');
      out.ways = [...new Set(ways)];
    }
    if (mode === 'entry_limit') {
      const value = limit ?? 0;
      if (!Number.isInteger(value) || value < 0 || value > CONFIG.cars.max) throw new RestrictionError(`limit debe ser un entero entre 0 y ${CONFIG.cars.max}`);
      out.limit = value;
    } else if (limit !== undefined) {
      throw new RestrictionError('limit solo se usa con mode entry_limit');
    }
    return out;
  }

  add(definition) {
    if (this.items.length >= MAX_RESTRICTIONS) throw new RestrictionError(`Máximo ${MAX_RESTRICTIONS} restricciones a la vez`);
    const item = this.normalize(definition);
    item.edges = this.edgesOf(item);
    if (!item.edges.length) throw new RestrictionError('No hay calles en esa zona');
    item.n = this.nextId++;
    item.id = `R${item.n}`;
    item.since = this.getSimTime();
    this.items.push(item);
    this.rebuild();
    return item;
  }

  // Cambia el modo, el límite o el nombre de una restricción (la zona no se cambia: se borra y se crea otra).
  update(id, patch) {
    const item = this.get(id);
    if (!item) return null;
    const definition = this.normalize({
      mode: patch.mode ?? item.mode,
      area: item.area,
      ways: item.ways,
      limit: (patch.mode ?? item.mode) === 'entry_limit' ? patch.limit ?? item.limit : undefined,
      name: patch.name ?? item.name,
    });
    Object.assign(item, { mode: definition.mode, name: definition.name, limit: definition.limit });
    if (item.mode !== 'entry_limit') delete item.limit;
    this.rebuild();
    return item;
  }

  remove(id) {
    const k = this.items.findIndex((r) => r.id === id);
    if (k < 0) return false;
    this.items.splice(k, 1);
    this.rebuild();
    return true;
  }

  get(id) {
    return this.items.find((r) => r.id === id) ?? null;
  }

  // Líneas de autobús cuyo recorrido pasa por un tramo que no pueden usar.
  suspendedLines() {
    const blocked = new Uint8Array(this.graph.edgeCount);
    for (const r of this.items) if (r.mode === 'pedestrians_only') for (const e of r.edges) blocked[e] = 1;
    return this.lines.map((line) => line.route.edge.some((e) => blocked[e] === 1));
  }

  rebuild({ evict = true } = {}) {
    const g = this.graph;
    const closed = new Uint8Array(g.edgeCount);
    const zone = new Int32Array(g.edgeCount);
    const limits = new Map();
    for (const r of this.items) {
      if (r.mode === 'entry_limit') {
        for (const e of r.edges) zone[e] = r.n;
        limits.set(r.n, r.limit);
      } else {
        for (const e of r.edges) closed[e] = 1;
      }
    }
    this.sim.setRestrictions({ closed, zone, limits }, { evict });
    this.suspendedLines().forEach((suspended, li) => this.buses.setSuspended(li, suspended));
  }

  // Coches dentro de la restricción ahora mismo.
  carsInside(item) {
    let cars = 0;
    for (const e of item.edges) cars += this.sim.edgeCars[e]?.length ?? 0;
    return cars;
  }

  describe(item) {
    const suspended = item.mode === 'pedestrians_only' ? this.lines.filter((line) => line.route.edge.some((e) => item.edges.includes(e))).map((l) => l.id) : [];
    return {
      id: item.id,
      mode: item.mode,
      name: item.name,
      area: item.area ?? null,
      ways: item.ways ?? null,
      limit: item.limit ?? null,
      since: item.since,
      edges: item.edges.length,
      length: Math.round(this.lengthOf(item.edges)),
      cars: this.carsInside(item),
      suspendedLines: suspended,
    };
  }

  // Metros de calle afectados (una calle de doble sentido cuenta una vez, como en describeWay).
  lengthOf(edges) {
    const g = this.graph;
    const set = new Set(edges);
    let length = 0;
    for (const e of edges) if (!(g.rev[e] >= 0 && g.rev[e] < e && set.has(g.rev[e]))) length += g.len[e];
    return length;
  }

  serialize() {
    return {
      nextId: this.nextId,
      items: this.items.map(({ id, n, mode, name, area, ways, limit, since }) => ({ id, n, mode, name, area, ways, limit, since })),
    };
  }

  // Los coches del snapshot ya cumplen las restricciones, así que no se expulsa a ninguno.
  restore(state) {
    this.nextId = state.nextId;
    this.items = state.items.map((r) => ({ ...r, edges: this.edgesOf(r) }));
    this.rebuild({ evict: false });
  }
}
