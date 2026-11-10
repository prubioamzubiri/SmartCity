import { CONFIG } from '../config.js';

const P = CONFIG.pedestrians;
const Z = CONFIG.signals.crosswalks;
const STRIDE = 5; // x, z, dirX, dirZ, clase de vía (igual que en pedestrians.js)

// Pasos de cebra sin semáforo: los peatones cruzan en grupos (uno cada `period`, cada cruce dura lo que se tarda en
// atravesar la calzada) y los coches ceden el paso mientras cruzan. Cuanta más gente hay en la calle y más concurrida
// es la calle del paso, más a menudo cruzan. El visor (peatones) y el simulador (coches) usan estas mismas ventanas.
export class Crosswalks {
  constructor(graph, crossings, signals, { weights = null } = {}) {
    this.signals = signals;
    const count = Math.floor(crossings.length / STRIDE);
    this.count = count;
    this.edge = new Int32Array(count).fill(-1); // tramo sobre el que está cada paso (-1 = con semáforo o fuera de la red)
    this.length = new Float32Array(count); // segundos simulados que el paso queda ocupado en cada cruce
    this.weight = new Float32Array(count); // concurrencia del paso respecto a la media
    this.shift = new Float32Array(count);
    const active = signals.signals.filter((s) => s.active);
    const perEdge = Array.from({ length: graph.edgeCount }, () => []);
    let total = 0;
    for (let j = 0; j < count; j++) total += weights ? weights[j] : 1;
    const mean = count ? total / count : 1;
    for (let j = 0; j < count; j++) {
      const x = crossings[j * STRIDE];
      const z = crossings[j * STRIDE + 1];
      if (active.some((s) => Math.hypot(s.x - x, s.z - z) <= P.signalRadius)) continue;
      // La calle que cruza el paso es la más cercana que va perpendicular a la dirección de cruce.
      const dx = crossings[j * STRIDE + 2];
      const dz = crossings[j * STRIDE + 3];
      let best = null;
      for (const c of graph.segmentsNear(x, z, Z.snapDistance)) {
        if (graph.cls[c.e] === 0) continue; // autovía: sin peatones
        if (Math.abs(dx * graph.ux[c.e] + dz * graph.uz[c.e]) > 0.5) continue;
        if (!best || c.dist < best.dist) best = c;
      }
      if (!best) continue;
      const e = best.e;
      this.edge[j] = e;
      const half = CONFIG.roads.halfWidth[crossings[j * STRIDE + 4]] + P.margin;
      this.length[j] = (2 * half) / P.speed + 2 * P.redMargin;
      this.weight[j] = Math.min(Z.maxWeight, Math.max(Z.minWeight, (weights ? weights[j] : 1) / mean));
      this.shift[j] = (Math.imul(j + 1, 2654435761) >>> 0) / 4294967296;
      const at = best.t * graph.len[e];
      perEdge[e].push([at, j]);
      if (graph.rev[e] >= 0) perEdge[graph.rev[e]].push([graph.len[e] - at, j]);
    }
    // Pasos de cada tramo dirigido ordenados por distancia desde su inicio (CSR).
    this.start = new Int32Array(graph.edgeCount + 1);
    let n = 0;
    for (let e = 0; e < graph.edgeCount; e++) {
      this.start[e] = n;
      n += perEdge[e].length;
    }
    this.start[graph.edgeCount] = n;
    this.at = new Float32Array(n);
    this.index = new Int32Array(n);
    for (let e = 0, k = 0; e < graph.edgeCount; e++) {
      perEdge[e].sort((a, b) => a[0] - b[0]);
      for (const [at, j] of perEdge[e]) {
        this.at[k] = at;
        this.index[k++] = j;
      }
    }
    this.mapped = this.edge.reduce((m, e) => m + (e >= 0 ? 1 : 0), 0);
  }

  // Tanto por uno del tiempo que el paso `j` está ocupado con la gente que hay ahora en la calle.
  share(j) {
    return Math.min(Z.maxShare, Z.share * this.signals.pedestrianLoad * this.weight[j]);
  }

  // Ventana en que cruzan los peatones por el paso `j` que empieza en `from` o la siguiente (tiempos simulados), o
  // null si el paso tiene semáforo o no está sobre una calle de la red.
  window(j, from) {
    if (this.edge[j] < 0) return null;
    const length = this.length[j];
    const share = this.share(j);
    if (share <= 0) return { start: Infinity, length: 0, current: false };
    const period = length / share;
    const phase = (((from - this.shift[j] * period) % period) + period) % period;
    if (phase < length) return { start: from - phase, length, current: true };
    return { start: from + period - phase, length, current: false };
  }

  // Hay gente cruzando el paso `j` ahora mismo.
  busy(j) {
    return this.signals.pedestrianLoad > 0 && this.window(j, this.signals.now).current;
  }
}
