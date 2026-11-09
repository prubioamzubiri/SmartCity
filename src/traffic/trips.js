import { CONFIG } from '../config.js';

const T = CONFIG.trips;

// Montículo binario mínimo de (prioridad, nodo) para Dijkstra.
class Heap {
  constructor(capacity) {
    this.key = new Float64Array(capacity);
    this.val = new Int32Array(capacity);
    this.size = 0;
  }

  push(k, v) {
    if (this.size === this.key.length) {
      const key = new Float64Array(this.size * 2);
      const val = new Int32Array(this.size * 2);
      key.set(this.key);
      val.set(this.val);
      this.key = key;
      this.val = val;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.key[p] <= k) break;
      this.key[i] = this.key[p];
      this.val[i] = this.val[p];
      i = p;
    }
    this.key[i] = k;
    this.val[i] = v;
  }

  // Devuelve el nodo con menor prioridad (la prioridad queda en `this.top`).
  pop() {
    const v = this.val[0];
    this.top = this.key[0];
    const k = this.key[--this.size];
    const last = this.val[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.key[c + 1] < this.key[c]) c++;
      if (this.key[c] >= k) break;
      this.key[i] = this.key[c];
      this.val[i] = this.val[c];
      i = c;
    }
    this.key[i] = k;
    this.val[i] = last;
    return v;
  }
}

/**
 * Destinos de los viajes en coche. La ciudad se divide en una cuadrícula; cada celda con calles es una zona de destino
 * cuyo centro es el cruce más próximo a su centro de gravedad. Para cada zona se guarda un «campo de tiempos»: los
 * segundos mínimos, sin tráfico, para llegar desde cada cruce a su centro. Hay dos juegos de campos: el de la red libre
 * (para medir el retraso) y el de la red con los cortes actuales (con el que eligen ruta los coches).
 */
export class TripPlanner {
  constructor(graph, { cells = T.gridCells } = {}) {
    this.g = graph;
    const { nodeCount, edgeCount, B, len, speed } = graph;
    this.time = new Float32Array(edgeCount);
    for (let e = 0; e < edgeCount; e++) this.time[e] = len[e] / speed[e];
    // Aristas entrantes por nodo (para Dijkstra hacia atrás desde el destino).
    this.inStart = new Int32Array(nodeCount + 1);
    for (let e = 0; e < edgeCount; e++) this.inStart[B[e] + 1]++;
    for (let i = 0; i < nodeCount; i++) this.inStart[i + 1] += this.inStart[i];
    this.inList = new Int32Array(edgeCount);
    const fill = this.inStart.slice(0, nodeCount);
    for (let e = 0; e < edgeCount; e++) this.inList[fill[B[e]]++] = e;

    this.inMain = this.mainComponent();
    this.zones = this.buildZones(cells);
    this.free = this.zones.map((z) => this.field(z.node, null));
    this.live = this.free;
    this.closed = null;
    // Peso de cada zona como destino: longitud de calle de la celda (más calle, más actividad).
    this.cumulative = new Float64Array(this.zones.length);
    let total = 0;
    this.zones.forEach((z, i) => {
      total += z.weight;
      this.cumulative[i] = total;
    });
    this.totalWeight = total;
  }

  // Núcleo de la red: cruces desde los que se puede ir a cualquier otro del núcleo y volver (la mayor componente
  // fuertemente conexa). Fuera quedan trozos aislados de OSM: viales sueltos, sentidos únicos sin salida...
  mainComponent() {
    const g = this.g;
    const reach = (start, forward) => {
      const seen = new Uint8Array(g.nodeCount);
      const stack = [start];
      seen[start] = 1;
      while (stack.length) {
        const n = stack.pop();
        const [from, to, list] = forward ? [g.outStart[n], g.outStart[n + 1], g.outList] : [this.inStart[n], this.inStart[n + 1], this.inList];
        for (let k = from; k < to; k++) {
          const m = forward ? g.B[list[k]] : g.A[list[k]];
          if (!seen[m]) {
            seen[m] = 1;
            stack.push(m);
          }
        }
      }
      return seen;
    };
    // Se prueba desde unos pocos cruces de las vías principales y se queda la componente más grande.
    const candidates = [];
    for (let e = 0; e < g.edgeCount && candidates.length < 6; e += Math.max(1, Math.floor(g.edgeCount / 60))) {
      if (g.cls[e] <= 2 || candidates.length === 0) candidates.push(g.A[e]);
    }
    let best = null;
    let bestSize = -1;
    for (const start of candidates) {
      const fwd = reach(start, true);
      const bwd = reach(start, false);
      const main = new Uint8Array(g.nodeCount);
      let size = 0;
      for (let n = 0; n < g.nodeCount; n++) if (fwd[n] && bwd[n]) {
        main[n] = 1;
        size++;
      }
      if (size > bestSize) {
        best = main;
        bestSize = size;
      }
    }
    return best;
  }

  buildZones(cells) {
    const g = this.g;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let n = 0; n < g.nodeCount; n++) {
      if (g.outStart[n + 1] === g.outStart[n]) continue;
      minX = Math.min(minX, g.nx[n]);
      maxX = Math.max(maxX, g.nx[n]);
      minZ = Math.min(minZ, g.nz[n]);
      maxZ = Math.max(maxZ, g.nz[n]);
    }
    const sx = (maxX - minX) / cells || 1;
    const sz = (maxZ - minZ) / cells || 1;
    const cellOf = (x, z) => Math.min(cells - 1, Math.floor((x - minX) / sx)) * cells + Math.min(cells - 1, Math.floor((z - minZ) / sz));
    const acc = new Map();
    for (let e = 0; e < g.edgeCount; e++) {
      const a = g.A[e];
      const c = cellOf(g.nx[a], g.nz[a]);
      const s = acc.get(c) ?? { length: 0, x: 0, z: 0 };
      s.length += g.len[e];
      s.x += g.nx[a] * g.len[e];
      s.z += g.nz[a] * g.len[e];
      acc.set(c, s);
    }
    const zones = [];
    // En una ciudad muy pequeña ninguna celda llega al mínimo: entonces vale cualquiera con calles.
    const minLength = [...acc.values()].some((s) => s.length >= T.minZoneLength) ? T.minZoneLength : 0;
    for (const [cell, s] of [...acc].sort((p, q) => p[0] - q[0])) {
      if (s.length < minLength) continue;
      const cx = s.x / s.length;
      const cz = s.z / s.length;
      // Centro: el cruce con salida y entrada más próximo al centro de gravedad de la celda.
      let best = -1;
      let bestD = Infinity;
      for (let n = 0; n < g.nodeCount; n++) {
        if (!this.inMain[n]) continue;
        const d = (g.nx[n] - cx) ** 2 + (g.nz[n] - cz) ** 2;
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      if (best >= 0) zones.push({ cell, node: best, x: g.nx[best], z: g.nz[best], weight: s.length });
    }
    return zones;
  }

  // Segundos sin tráfico desde cada nodo hasta `target` (Infinity si no se puede llegar). `closed`: tramos prohibidos.
  field(target, closed) {
    const g = this.g;
    const dist = new Float32Array(g.nodeCount).fill(Infinity);
    const heap = new Heap(1024);
    dist[target] = 0;
    heap.push(0, target);
    while (heap.size) {
      const n = heap.pop();
      const d = heap.top;
      // `dist` es de 32 bits: se compara con el valor redondeado igual o se descartarían casi todos los nodos.
      if (Math.fround(d) > dist[n]) continue;
      for (let k = this.inStart[n]; k < this.inStart[n + 1]; k++) {
        const e = this.inList[k];
        if (closed && closed[e] === 1) continue;
        const nd = d + this.time[e];
        const a = g.A[e];
        if (nd < dist[a]) {
          dist[a] = nd;
          heap.push(nd, a);
        }
      }
    }
    return dist;
  }

  // Recalcula los campos con los tramos cortados (solo si el conjunto de cortes ha cambiado).
  setClosed(closed) {
    let any = false;
    for (let e = 0; e < closed.length && !any; e++) any = closed[e] === 1;
    if (!any) {
      this.live = this.free;
      this.closed = null;
      return;
    }
    if (this.closed && this.closed.length === closed.length && this.closed.every((v, e) => v === closed[e])) return;
    this.closed = Uint8Array.from(closed);
    this.live = this.zones.map((z) => this.field(z.node, this.closed));
  }

  // Zona de destino al azar, proporcional a su peso (r en [0, 1)).
  pick(r) {
    const x = r * this.totalWeight;
    let lo = 0;
    let hi = this.cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cumulative[mid] > x) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  // Zona más próxima a un punto (para los eventos: los coches van a la zona de la sede).
  nearest(x, z) {
    let best = 0;
    let bestD = Infinity;
    this.zones.forEach((zone, i) => {
      const d = (zone.x - x) ** 2 + (zone.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }
}
