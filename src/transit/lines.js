import { CONFIG } from '../config.js';

const T = CONFIG.transit;
const CELL = 100;
const cellKey = (cx, cz) => cx * 100003 + cz;

// Montículo binario mínimo de pares (coste, nodo) para Dijkstra.
class Heap {
  constructor() {
    this.cost = [];
    this.node = [];
  }

  get size() {
    return this.cost.length;
  }

  push(c, n) {
    const { cost, node } = this;
    let i = cost.length;
    cost.push(c);
    node.push(n);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (cost[p] <= c) break;
      cost[i] = cost[p];
      node[i] = node[p];
      i = p;
    }
    cost[i] = c;
    node[i] = n;
  }

  pop() {
    const { cost, node } = this;
    const top = [cost[0], node[0]];
    const c = cost.pop();
    const n = node.pop();
    const size = cost.length;
    if (size) {
      let i = 0;
      for (;;) {
        let k = 2 * i + 1;
        if (k >= size) break;
        if (k + 1 < size && cost[k + 1] < cost[k]) k++;
        if (cost[k] >= c) break;
        cost[i] = cost[k];
        node[i] = node[k];
        i = k;
      }
      cost[i] = c;
      node[i] = n;
    }
    return top;
  }
}

// Coste de recorrer un tramo en autobús: las vías principales salen más baratas y las autovías no se usan (Infinity).
const edgeCost = (g, e) => g.len[e] * (T.roadPenalty[g.cls[e]] ?? Infinity);

// Dijkstra desde `from`. Con `reverse` recorre los tramos al revés (nodos desde los que se llega a `from`).
// Devuelve { dist, prev }: prev = tramo por el que se llegó a cada nodo (-1 si no se alcanzó).
function dijkstra(g, from, { reverse = false, to = -1 } = {}) {
  const dist = new Float64Array(g.nodeCount).fill(Infinity);
  const prev = new Int32Array(g.nodeCount).fill(-1);
  const heap = new Heap();
  dist[from] = 0;
  heap.push(0, from);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (d > dist[u]) continue;
    if (u === to) break;
    const start = reverse ? g.inStart[u] : g.outStart[u];
    const end = reverse ? g.inStart[u + 1] : g.outStart[u + 1];
    for (let k = start; k < end; k++) {
      const e = reverse ? g.inList[k] : g.outList[k];
      const c = edgeCost(g, e);
      if (c === Infinity) continue;
      const v = reverse ? g.A[e] : g.B[e];
      const nd = d + c;
      if (nd < dist[v]) {
        dist[v] = nd;
        prev[v] = e;
        heap.push(nd, v);
      }
    }
  }
  return { dist, prev };
}

function pathEdges(g, prev, to) {
  const edges = [];
  for (let e = prev[to]; e >= 0; e = prev[g.A[e]]) edges.push(e);
  return edges.reverse();
}

// Añade al grafo las aristas entrantes por nodo (CSR) para poder recorrerlo al revés.
function withIncoming(g) {
  const inStart = new Int32Array(g.nodeCount + 1);
  for (let e = 0; e < g.edgeCount; e++) inStart[g.B[e] + 1]++;
  for (let i = 0; i < g.nodeCount; i++) inStart[i + 1] += inStart[i];
  const inList = new Int32Array(g.edgeCount);
  const fill = inStart.slice(0, g.nodeCount);
  for (let e = 0; e < g.edgeCount; e++) inList[fill[g.B[e]]++] = e;
  return { ...g, inStart, inList };
}

// Paradas de autobús de OSM (categoría 2 de los POI) como lista plana [x, z, ...].
function busStopPoints(pois = []) {
  const out = [];
  for (let i = 0; i < pois.length; i += 3) if (pois[i + 2] === 2) out.push(pois[i], pois[i + 1]);
  return out;
}

// Elige los extremos de las líneas: paradas en zonas con densidad suficiente, lo más repartidas posible
// alrededor del centro, ordenadas por ángulo.
function pickTerminals(g, points, inComponent, centre) {
  const density = new Map();
  const cellOf = (x, z) => cellKey(Math.floor(x / 400), Math.floor(z / 400));
  for (let i = 0; i < points.length; i += 2) {
    const k = cellOf(points[i], points[i + 1]);
    density.set(k, (density.get(k) ?? 0) + 1);
  }
  const candidates = [];
  for (let i = 0; i < points.length; i += 2) {
    const d = Math.hypot(points[i] - g.nx[centre], points[i + 1] - g.nz[centre]);
    if (d < T.minTerminalRadius || d > T.maxTerminalRadius) continue;
    if (density.get(cellOf(points[i], points[i + 1])) < T.minTerminalDensity) continue;
    const hit = g.nearestSegment(points[i], points[i + 1], 60);
    if (!hit) continue;
    const node = hit.t < 0.5 ? g.A[hit.e] : g.B[hit.e];
    if (inComponent(node)) candidates.push({ node, x: g.nx[node], z: g.nz[node] });
  }
  // Muestreo del punto más lejano: cada terminal nuevo es el que más se aleja de los ya elegidos.
  const chosen = [];
  const minDist = new Float64Array(candidates.length).fill(Infinity);
  for (let pick = 0; pick < T.terminals && candidates.length; pick++) {
    let best = 0;
    for (let c = 1; c < candidates.length; c++) if (minDist[c] > minDist[best]) best = c;
    if (minDist[best] === 0) break;
    const t = candidates[best];
    chosen.push(t);
    for (let c = 0; c < candidates.length; c++) {
      minDist[c] = Math.min(minDist[c], Math.hypot(candidates[c].x - t.x, candidates[c].z - t.z));
    }
  }
  const angle = (t) => Math.atan2(t.z - g.nz[centre], t.x - g.nx[centre]);
  return chosen.sort((a, b) => angle(a) - angle(b));
}

// Último índice `i` de un array ordenado con arr[i] <= v (0 si v es menor que todos), dentro de [lo, hi].
function lastAtMost(arr, v, lo = 0, hi = arr.length - 1) {
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid] <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Una línea circular: ida (A → B) y vuelta (B → A) por el viario, con sus paradas y su horario de marcha.
// Todo es función de los datos de la ciudad, así que cualquier visor calcula las mismas líneas.
function buildLine(g, index, edgesOut, edgesBack, stopPoints, weights) {
  const edges = [...edgesOut, ...edgesBack];
  const x = [g.nx[g.A[edges[0]]]];
  const z = [g.nz[g.A[edges[0]]]];
  const cum = [0];
  const travel = [0]; // segundos de viaje acumulados (sin paradas) en cada punto
  for (const e of edges) {
    x.push(g.nx[g.B[e]]);
    z.push(g.nz[g.B[e]]);
    cum.push(cum[cum.length - 1] + g.len[e]);
    travel.push(travel[travel.length - 1] + g.len[e] / Math.min(T.maxSpeed, g.speed[e] * T.speedFactor));
  }
  const route = { x, z, cum, travel, edge: edges };
  const length = cum[cum.length - 1];
  const turn = cum[edgesOut.length]; // distancia a la que termina la ida
  const segmentAt = (s) => Math.min(lastAtMost(cum, s, 0, edges.length - 1), edges.length - 1);

  // Candidatas: paradas de OSM a menos de `stopSnap` metros del recorrido, con su distancia a lo largo de él.
  const grid = new Map();
  for (let i = 0; i < stopPoints.length; i += 2) {
    const k = cellKey(Math.floor(stopPoints[i] / CELL), Math.floor(stopPoints[i + 1] / CELL));
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(i);
  }
  const candidates = [];
  const seen = new Set();
  const near = Math.ceil(T.stopSnap / CELL);
  for (let k = 0; k < edges.length; k++) {
    const l = cum[k + 1] - cum[k];
    const ux = (x[k + 1] - x[k]) / l;
    const uz = (z[k + 1] - z[k]) / l;
    const cxa = Math.floor(Math.min(x[k], x[k + 1]) / CELL) - near;
    const cxb = Math.floor(Math.max(x[k], x[k + 1]) / CELL) + near;
    const cza = Math.floor(Math.min(z[k], z[k + 1]) / CELL) - near;
    const czb = Math.floor(Math.max(z[k], z[k + 1]) / CELL) + near;
    for (let cx = cxa; cx <= cxb; cx++) {
      for (let cz = cza; cz <= czb; cz++) {
        for (const p of grid.get(cellKey(cx, cz)) ?? []) {
          const t = Math.min(l, Math.max(0, (stopPoints[p] - x[k]) * ux + (stopPoints[p + 1] - z[k]) * uz));
          if (Math.hypot(stopPoints[p] - x[k] - ux * t, stopPoints[p + 1] - z[k] - uz * t) > T.stopSnap) continue;
          const s = cum[k] + t;
          const key = `${p}:${s < turn ? 0 : 1}`; // una parada de OSM sirve a la ida y a la vuelta por separado
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push(s);
        }
      }
    }
  }
  candidates.sort((a, b) => a - b);

  // Paradas: las terminales, las de OSM separadas al menos `minStopSpacing` y otras en los tramos largos sin ninguna.
  const marks = [0];
  const fillGap = (from, to) => {
    const n = Math.ceil((to - from) / T.maxStopSpacing);
    for (let i = 1; i < n; i++) marks.push(from + ((to - from) * i) / n);
  };
  const addSection = (lo, hi) => {
    let last = lo;
    for (const s of candidates) {
      if (s <= lo + T.terminalMargin || s >= hi - T.terminalMargin || s < last + T.minStopSpacing) continue;
      fillGap(last, s);
      marks.push(s);
      last = s;
    }
    fillGap(last, hi);
  };
  addSection(0, turn);
  marks.push(turn);
  addSection(turn, length);

  const stops = marks.map((s, i) => {
    const k = segmentAt(s);
    const e = edges[k];
    const t = (s - cum[k]) / (cum[k + 1] - cum[k]);
    const half = CONFIG.roads.halfWidth[g.cls[e]] + T.kerbOffset;
    const sx = x[k] + (x[k + 1] - x[k]) * t;
    const sz = z[k] + (z[k + 1] - z[k]) * t;
    const turnaround = s === turn;
    return {
      s,
      edge: e,
      turnaround,
      terminal: i === 0 || turnaround,
      weight: weights ? Math.min(T.maxStopWeight, Math.max(T.minStopWeight, weights[e] / T.referenceWeight)) : 1,
      // Marcador en la acera del lado por el que circula el autobús
      x: sx - g.uz[e] * half,
      z: sz + g.ux[e] * half,
      travel: travel[k] + ((travel[k + 1] - travel[k]) * (s - cum[k])) / (cum[k + 1] - cum[k]),
    };
  });

  // Horario del recorrido completo (segundos de reloj de autobús): llegada y salida de cada parada.
  const arrive = new Float64Array(stops.length);
  const depart = new Float64Array(stops.length);
  const dwellBefore = new Float64Array(stops.length + 1); // tiempo parado en las paradas anteriores a la i
  stops.forEach((st, i) => {
    st.dwell = st.terminal ? T.terminalDwell : T.dwell;
    arrive[i] = st.travel + dwellBefore[i];
    depart[i] = arrive[i] + st.dwell;
    dwellBefore[i + 1] = dwellBefore[i] + st.dwell;
  });
  const cycle = travel[travel.length - 1] + dwellBefore[stops.length];
  const buses = Math.max(T.minBuses, Math.min(T.maxBuses, Math.round(cycle / T.headway)));

  return {
    id: `L${index + 1}`,
    index,
    color: T.colors[index % T.colors.length],
    route, stops, arrive, depart, dwellBefore, length, cycle, buses,
    headway: cycle / buses,
    segmentAt,
  };
}

// Posición del autobús de la línea en el instante `u` del ciclo (0 ≤ u < cycle).
// `stop` es la última parada alcanzada; `progress` (0..1) avanza mientras está parado en ella.
export function locate(g, line, u, out = {}) {
  const { stops, arrive, depart, dwellBefore, route } = line;
  const j = lastAtMost(arrive, u);
  let s;
  out.stop = j;
  if (u < depart[j]) {
    s = stops[j].s;
    out.dwelling = true;
    out.progress = (u - arrive[j]) / stops[j].dwell;
  } else {
    const tau = u - dwellBefore[j + 1];
    const k = Math.min(lastAtMost(route.travel, tau, 0, route.edge.length - 1), route.edge.length - 1);
    const span = route.travel[k + 1] - route.travel[k];
    s = route.cum[k] + (Math.min(1, (tau - route.travel[k]) / span) * (route.cum[k + 1] - route.cum[k]));
    out.dwelling = false;
    out.progress = 1;
  }
  const k = line.segmentAt(s);
  const e = route.edge[k];
  const t = Math.min(1, (s - route.cum[k]) / (route.cum[k + 1] - route.cum[k]));
  out.s = s;
  out.dx = g.ux[e];
  out.dz = g.uz[e];
  out.x = route.x[k] + (route.x[k + 1] - route.x[k]) * t - g.uz[e] * T.laneOffset;
  out.z = route.z[k] + (route.z[k + 1] - route.z[k]) * t + g.ux[e] * T.laneOffset;
  return out;
}

// Líneas de autobús de la ciudad, generadas cruzando la ciudad por el viario principal entre paradas de autobús
// reales de OSM (POI de transporte): son una función de los datos, así que todos los visores calculan las mismas.
export function buildTransit(data, graph, { weights = null } = {}) {
  const g = withIncoming(graph);
  const points = busStopPoints(data.pois);
  const none = { lines: [], terminals: [] };
  if (points.length < 4 || !g.edgeCount) return none;

  // Nodo central (el más cercano al origen): los extremos de las líneas se conectan con él en ambos sentidos.
  const centreHit = g.nearestSegment(0, 0, 1500);
  if (!centreHit) return none;
  const centre = centreHit.t < 0.5 ? g.A[centreHit.e] : g.B[centreHit.e];
  const forward = dijkstra(g, centre);
  const backward = dijkstra(g, centre, { reverse: true });
  const inComponent = (node) => forward.dist[node] < Infinity && backward.dist[node] < Infinity;
  if (!inComponent(centre)) return none;

  const terminals = pickTerminals(g, points, inComponent, centre);
  const m = terminals.length;
  if (m < 2) return none;

  // Pares de extremos: líneas que cruzan la ciudad (extremos opuestos) y otras más cortas entre extremos cercanos.
  const pairs = [];
  const half = Math.floor(m / 2);
  for (let i = 0; i < half; i++) pairs.push([i, i + half]);
  const skip = Math.max(2, Math.floor(m / 4));
  for (let i = 0; i < m && pairs.length < T.lines; i += 2) pairs.push([i, (i + skip) % m]);

  const lines = [];
  for (const [a, b] of pairs.slice(0, T.lines)) {
    const from = terminals[a].node;
    const to = terminals[b].node;
    if (from === to) continue;
    const out = dijkstra(g, from, { to });
    const back = dijkstra(g, to, { to: from });
    if (out.dist[to] === Infinity || back.dist[from] === Infinity) continue;
    lines.push(buildLine(g, lines.length, pathEdges(g, out.prev, to), pathEdges(g, back.prev, from), points, weights));
  }
  return { lines, terminals };
}
