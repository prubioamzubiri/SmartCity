import { CONFIG } from '../config.js';
import { fromBase64 } from '../core/binary.js';

const C = CONFIG.cars;
const MAX_SPEED = 25; // m/s simulados: más recorrido que esto entre dos muestras indica un coche reaparecido
const MAX_PATH = 64; // aristas por trayecto entre dos muestras
const MIN_GLIDE = 0.2;
const MAX_GLIDE = 2;

// Coches del servidor con la forma que usa CarView. Entre muestras avanzan por las calles
// desde la posición mostrada hasta la nueva, siguiendo el camino más corto del grafo.
export class RemoteCars {
  constructor(graph, graphKey, { now = () => performance.now() } = {}) {
    const n = C.max;
    const edges = graph.edgeCount;
    this.g = graph;
    this.graphKey = graphKey;
    this.now = now;
    this.edge = new Int32Array(n);
    this.pos = new Float32Array(n);
    this.speed = new Float32Array(n);
    this.rx = new Float32Array(n);
    this.rz = new Float32Array(n);
    this.shownEdge = new Int32Array(n);
    this.shownPos = new Float32Array(n);
    this.path = new Int32Array(n * MAX_PATH);
    this.pathCount = new Uint8Array(n);
    this.startPos = new Float32Array(n);
    this.total = new Float32Array(n);
    this.mark = new Int32Array(edges);
    this.parent = new Int32Array(edges);
    this.reach = new Float32Array(edges);
    this.queue = new Int32Array(edges);
    this.stamp = 0;
    this.lastTotal = 0;
    this.activeCount = 0;
    this.simSeconds = 0;
    this.startedAt = 0;
    this.glideMs = 1000;
  }

  // Devuelve false si el servidor simula otra ciudad: sus aristas no corresponden a este grafo.
  apply({ graphKey, simSeconds, activeCount, edge, pos, speed }) {
    if (graphKey !== this.graphKey) return false;
    const e = fromBase64(edge, Int32Array);
    const p = fromBase64(pos, Float32Array);
    const v = fromBase64(speed, Float32Array);
    const n = Math.min(activeCount, e.length, p.length, v.length, this.edge.length);
    const t = this.now();
    this.update(t);
    const previous = this.activeCount;
    const limit = MAX_SPEED * Math.max(0, simSeconds - this.simSeconds) + 50;
    this.edge.set(e.subarray(0, n));
    this.pos.set(p.subarray(0, n));
    this.speed.set(v.subarray(0, n));
    this.activeCount = n;
    for (let i = 0; i < n; i++) {
      if (i < previous) this.route(i, this.shownEdge[i], this.shownPos[i], this.edge[i], this.pos[i], limit);
      else this.place(i, this.edge[i], this.pos[i]);
    }
    this.glideMs = Math.min(MAX_GLIDE, Math.max(MIN_GLIDE, (t - this.startedAt) / 1000)) * 1000;
    this.startedAt = t;
    this.simSeconds = simSeconds;
    this.update(t);
    return true;
  }

  // Sin trayecto: el coche aparece directamente en su posición.
  place(i, e, p) {
    this.path[i * MAX_PATH] = e;
    this.pathCount[i] = 1;
    this.startPos[i] = p;
    this.total[i] = 0;
  }

  route(i, e0, p0, e1, p1, limit) {
    const len = this.g.len;
    const base = i * MAX_PATH;
    if (e0 === e1 && p1 >= p0) {
      this.path[base] = e0;
      this.pathCount[i] = 1;
      this.startPos[i] = p0;
      this.total[i] = p1 - p0;
      return;
    }
    const count = this.search(e0, len[e0] - p0, e1, limit, base);
    if (count === 0) {
      this.place(i, e1, p1);
      return;
    }
    this.pathCount[i] = count;
    this.startPos[i] = p0;
    this.total[i] = this.lastTotal + p1;
  }

  // Búsqueda en anchura acotada por distancia; deja el trayecto en `path` y su longitud hasta el final de la penúltima arista en `lastTotal`.
  search(e0, firstLeft, e1, limit, base) {
    const g = this.g;
    const { mark, parent, reach, queue, path } = this;
    const stamp = ++this.stamp;
    if (e0 !== e1) mark[e0] = stamp;
    parent[e0] = -1;
    reach[e0] = firstLeft;
    let head = 0;
    let tail = 0;
    queue[tail++] = e0;
    while (head < tail) {
      const e = queue[head++];
      const d = reach[e];
      for (let k = g.outStart[g.B[e]]; k < g.outStart[g.B[e] + 1]; k++) {
        const c = g.outList[k];
        if (c === e1) {
          let n = 1;
          for (let x = e; x >= 0; x = parent[x]) n++;
          if (n > MAX_PATH) return 0;
          path[base + n - 1] = e1;
          let idx = n - 1;
          for (let x = e; x >= 0; x = parent[x]) path[base + --idx] = x;
          this.lastTotal = d;
          return n;
        }
        const dc = d + g.len[c];
        if (mark[c] === stamp || dc > limit) continue;
        mark[c] = stamp;
        parent[c] = e;
        reach[c] = dc;
        queue[tail++] = c;
      }
    }
    return 0;
  }

  // Posición mostrada en `now`: recorre el trayecto de cada coche a lo largo de un intervalo de muestreo.
  update(now) {
    const g = this.g;
    const k = Math.min(1, Math.max(0, (now - this.startedAt) / this.glideMs));
    for (let i = 0; i < this.activeCount; i++) {
      const base = i * MAX_PATH;
      const count = this.pathCount[i];
      let e = this.path[base];
      let s = this.total[i] * k;
      let p;
      if (count === 1) {
        p = this.startPos[i] + s;
      } else {
        const first = g.len[e] - this.startPos[i];
        if (s < first) {
          p = this.startPos[i] + s;
        } else {
          s -= first;
          let j = 1;
          while (j < count - 1 && s >= g.len[this.path[base + j]]) s -= g.len[this.path[base + j++]];
          e = this.path[base + j];
          p = s;
        }
      }
      p = Math.min(Math.max(p, 0), g.len[e]);
      this.shownEdge[i] = e;
      this.shownPos[i] = p;
      const a = g.A[e];
      this.rx[i] = g.nx[a] + g.ux[e] * p - g.uz[e] * C.laneOffset;
      this.rz[i] = g.nz[a] + g.uz[e] * p + g.ux[e] * C.laneOffset;
    }
  }

  clear() {
    this.activeCount = 0;
  }
}
