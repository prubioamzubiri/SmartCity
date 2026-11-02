import { CONFIG } from '../config.js';

const SAMPLE = 30; // metros entre muestras a lo largo de un tramo

// Índice espacial de los puntos de interés: lista plana [x, z, categoría, ...] en celdas del tamaño del radio de atracción.
function indexPois(pois, radius) {
  const cells = new Map();
  for (let i = 0; i < pois.length; i += 3) {
    const key = `${Math.floor(pois[i] / radius)},${Math.floor(pois[i + 1] / radius)}`;
    let list = cells.get(key);
    if (!list) cells.set(key, (list = []));
    list.push(i);
  }
  return cells;
}

// Peso de atracción de los POI cercanos a un punto: Σ pesoDelPOI × (1 − distancia / radio)² para los de menos de `radius`.
function poiAttraction(cells, pois, x, z, radius, poiWeights) {
  const cx = Math.floor(x / radius);
  const cz = Math.floor(z / radius);
  let sum = 0;
  for (let i = cx - 1; i <= cx + 1; i++) {
    for (let j = cz - 1; j <= cz + 1; j++) {
      for (const k of cells.get(`${i},${j}`) ?? []) {
        const d = Math.hypot(pois[k] - x, pois[k + 1] - z);
        if (d < radius) sum += (poiWeights[pois[k + 2]] ?? 0) * (1 - d / radius) ** 2;
      }
    }
  }
  return sum;
}

// Pesos de atracción de peatones por tramo dirigido del grafo y por paso de peatones. Sin POI solo cuenta la clase de vía.
// Es una función de los datos de la ciudad: el servidor y el visor calculan exactamente los mismos pesos.
export function pedestrianWeights(graph, data, config = CONFIG.pedestrians) {
  const { streetWeights, poiWeights, poiRadius, maxWeight } = config;
  const pois = data.pois ?? [];
  const cells = indexPois(pois, poiRadius);
  const factor = (x, z) => Math.min(maxWeight, 1 + (pois.length ? poiAttraction(cells, pois, x, z, poiRadius, poiWeights) : 0));

  const edge = new Float32Array(graph.edgeCount);
  const byEdgeKey = new Map(); // un tramo y su inverso comparten posición: el factor se calcula una sola vez
  for (let e = 0; e < graph.edgeCount; e++) {
    const base = streetWeights[graph.cls[e]] ?? 0;
    if (base <= 0) continue;
    const r = graph.rev[e];
    const cached = r >= 0 && r < e ? byEdgeKey.get(r) : undefined;
    let f = cached;
    if (f === undefined) {
      const a = graph.A[e];
      const n = Math.max(1, Math.ceil(graph.len[e] / SAMPLE));
      f = 0;
      for (let k = 0; k <= n; k++) {
        const t = (k / n) * graph.len[e];
        f += factor(graph.nx[a] + graph.ux[e] * t, graph.nz[a] + graph.uz[e] * t);
      }
      f /= n + 1;
      byEdgeKey.set(e, f);
    }
    edge[e] = base * f;
  }

  const c = data.crossings ?? [];
  const crossing = new Float32Array(Math.floor(c.length / 5));
  for (let j = 0; j < crossing.length; j++) {
    crossing[j] = (streetWeights[c[j * 5 + 4]] || 1) * factor(c[j * 5], c[j * 5 + 1]);
  }
  return { edge, crossing };
}
