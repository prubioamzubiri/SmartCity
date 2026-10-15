import { CONFIG } from '../config.js';

const CELL = 100;
const cellKey = (cx, cz) => cx * 100003 + cz;

// Grafo dirigido de aristas (un tramo entre nodos OSM consecutivos) con índice espacial para los sensores.
export function buildGraph(data) {
  const nodeCount = data.nodes.length / 2;
  const nx = new Float32Array(nodeCount);
  const nz = new Float32Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    nx[i] = data.nodes[i * 2];
    nz[i] = data.nodes[i * 2 + 1];
  }

  const ea = [];
  const eb = [];
  const ecls = [];
  const keyToEdge = new Map();

  const addEdge = (a, b, cls) => {
    const key = a * nodeCount + b;
    if (keyToEdge.has(key)) return;
    keyToEdge.set(key, ea.length);
    ea.push(a);
    eb.push(b);
    ecls.push(cls);
  };

  for (const w of data.ways) {
    const cls = w[0];
    const dir = w[1];
    for (let k = 2; k < w.length - 1; k++) {
      const a = w[k];
      const b = w[k + 1];
      if (a === b) continue;
      const dx = nx[b] - nx[a];
      const dz = nz[b] - nz[a];
      if (dx * dx + dz * dz < 0.25) continue;
      if (dir >= 0) addEdge(a, b, cls);
      if (dir <= 0) addEdge(b, a, cls);
    }
  }

  const edgeCount = ea.length;
  const A = Int32Array.from(ea);
  const B = Int32Array.from(eb);
  const cls = Uint8Array.from(ecls);
  const len = new Float32Array(edgeCount);
  const ux = new Float32Array(edgeCount);
  const uz = new Float32Array(edgeCount);
  const speed = new Float32Array(edgeCount);
  const rev = new Int32Array(edgeCount);

  for (let e = 0; e < edgeCount; e++) {
    const dx = nx[B[e]] - nx[A[e]];
    const dz = nz[B[e]] - nz[A[e]];
    const l = Math.hypot(dx, dz);
    len[e] = l;
    ux[e] = dx / l;
    uz[e] = dz / l;
    speed[e] = CONFIG.cars.speedByClass[cls[e]];
    rev[e] = keyToEdge.get(B[e] * nodeCount + A[e]) ?? -1;
  }

  // Aristas salientes por nodo (CSR).
  const outStart = new Int32Array(nodeCount + 1);
  for (let e = 0; e < edgeCount; e++) outStart[A[e] + 1]++;
  for (let i = 0; i < nodeCount; i++) outStart[i + 1] += outStart[i];
  const outList = new Int32Array(edgeCount);
  const fill = outStart.slice(0, nodeCount);
  for (let e = 0; e < edgeCount; e++) outList[fill[A[e]]++] = e;

  // Tarjan iterativo: los coches solo circulan por la mayor componente fuertemente conexa para no quedar atrapados en bucles sin salida.
  const order = new Int32Array(nodeCount).fill(-1);
  const low = new Int32Array(nodeCount);
  const onStack = new Uint8Array(nodeCount);
  const comp = new Int32Array(nodeCount).fill(-1);
  const compSize = [];
  const tarjanStack = [];
  const cursor = outStart.slice(0, nodeCount);
  let counter = 0;
  for (let root = 0; root < nodeCount; root++) {
    if (order[root] >= 0) continue;
    const calls = [root];
    order[root] = low[root] = counter++;
    tarjanStack.push(root);
    onStack[root] = 1;
    while (calls.length) {
      const v = calls[calls.length - 1];
      const k = cursor[v];
      if (k < outStart[v + 1]) {
        cursor[v] = k + 1;
        const w = B[outList[k]];
        if (order[w] < 0) {
          order[w] = low[w] = counter++;
          tarjanStack.push(w);
          onStack[w] = 1;
          calls.push(w);
        } else if (onStack[w]) {
          low[v] = Math.min(low[v], order[w]);
        }
        continue;
      }
      if (low[v] === order[v]) {
        const id = compSize.length;
        let size = 0;
        let w;
        do {
          w = tarjanStack.pop();
          onStack[w] = 0;
          comp[w] = id;
          size++;
        } while (w !== v);
        compSize.push(size);
      }
      calls.pop();
      if (calls.length) {
        const parentNode = calls[calls.length - 1];
        low[parentNode] = Math.min(low[parentNode], low[v]);
      }
    }
  }
  let mainComp = 0;
  compSize.forEach((size, id) => {
    if (size > compSize[mainComp]) mainComp = id;
  });
  const drivable = new Uint8Array(edgeCount);
  const drivableList = [];
  for (let e = 0; e < edgeCount; e++) {
    if (comp[A[e]] === mainComp && comp[B[e]] === mainComp) {
      drivable[e] = 1;
      drivableList.push(e);
    }
  }
  const drivableEdges = Int32Array.from(drivableList);

  // En OSM los semáforos se mapean en las aproximaciones al cruce: se agrupan por cercanía en un controlador.
  const raw = [];
  for (let i = 0; i < data.signals.length; i += 2) raw.push({ node: data.signals[i], id: data.signals[i + 1] });
  const parent = raw.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  for (let i = 0; i < raw.length; i++) {
    for (let j = i + 1; j < raw.length; j++) {
      const d = Math.hypot(nx[raw[i].node] - nx[raw[j].node], nz[raw[i].node] - nz[raw[j].node]);
      if (d <= CONFIG.signals.clusterDistance) parent[find(i)] = find(j);
    }
  }
  const nodeSignal = new Int32Array(nodeCount).fill(-1);
  const signals = [];
  const byRoot = new Map();
  raw.forEach((r, i) => {
    const root = find(i);
    let idx = byRoot.get(root);
    if (idx === undefined) {
      idx = signals.length;
      byRoot.set(root, idx);
      signals.push({ id: r.id, nodes: [], approaches: [], groups: [0, 0], x: 0, z: 0, active: false });
    }
    const s = signals[idx];
    s.id = Math.min(s.id, r.id);
    s.nodes.push(r.node);
    nodeSignal[r.node] = idx;
  });
  for (const s of signals) {
    s.x = s.nodes.reduce((acc, n) => acc + nx[n], 0) / s.nodes.length;
    s.z = s.nodes.reduce((acc, n) => acc + nz[n], 0) / s.nodes.length;
  }
  const sig = new Int32Array(edgeCount).fill(-1);
  const grp = new Uint8Array(edgeCount);
  for (let e = 0; e < edgeCount; e++) {
    const s = nodeSignal[B[e]];
    if (s < 0) continue;
    const g = Math.abs(ux[e]) >= Math.abs(uz[e]) ? 0 : 1;
    sig[e] = s;
    grp[e] = g;
    signals[s].approaches.push(e);
    signals[s].groups[g]++;
  }
  // Un cruce necesita aproximaciones en ambos ejes; si no, es un paso de peatones y no corta el tráfico.
  for (const s of signals) s.active = s.groups[0] > 0 && s.groups[1] > 0;

  // Índice espacial de tramos (no dirigidos).
  const grid = new Map();
  for (let e = 0; e < edgeCount; e++) {
    if (rev[e] >= 0 && rev[e] < e) continue;
    const x0 = Math.min(nx[A[e]], nx[B[e]]);
    const x1 = Math.max(nx[A[e]], nx[B[e]]);
    const z0 = Math.min(nz[A[e]], nz[B[e]]);
    const z1 = Math.max(nz[A[e]], nz[B[e]]);
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const k = cellKey(cx, cz);
        let list = grid.get(k);
        if (!list) grid.set(k, (list = []));
        list.push(e);
      }
    }
  }

  function nearestSegment(x, z, maxDist = CONFIG.sensors.snapDistance) {
    let best = null;
    const r = Math.ceil(maxDist / CELL);
    const cx0 = Math.floor(x / CELL);
    const cz0 = Math.floor(z / CELL);
    for (let cx = cx0 - r; cx <= cx0 + r; cx++) {
      for (let cz = cz0 - r; cz <= cz0 + r; cz++) {
        const list = grid.get(cellKey(cx, cz));
        if (!list) continue;
        for (const e of list) {
          const ax = nx[A[e]];
          const az = nz[A[e]];
          const t = Math.min(1, Math.max(0, ((x - ax) * ux[e] + (z - az) * uz[e]) / len[e]));
          const px = ax + ux[e] * len[e] * t;
          const pz = az + uz[e] * len[e] * t;
          const d = Math.hypot(x - px, z - pz);
          if (d <= maxDist && (!best || d < best.dist)) best = { e, t, x: px, z: pz, dist: d };
        }
      }
    }
    return best;
  }

  return {
    nodeCount,
    edgeCount,
    nx, nz,
    A, B, cls, len, ux, uz, speed, rev,
    outStart, outList,
    sig, grp,
    drivable, drivableEdges,
    signals,
    nearestSegment,
  };
}
