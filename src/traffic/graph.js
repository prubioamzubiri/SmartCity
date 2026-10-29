import { CONFIG } from '../config.js';

const CELL = 100;
const cellKey = (cx, cz) => cx * 100003 + cz;

// Rotondas: ciclos dirigidos de aristas de sentido único que giran siempre al mismo lado y completan ~360°.
// Una manzana de calles de un sentido también es un ciclo, pero gira 90° cuatro veces y no cumple el perímetro.
function findRings({ edgeCount, A, B, len, ux, uz, rev, nx, nz, outStart, outList }) {
  const { maxLength, maxEdges } = CONFIG.roundabouts;
  const NEUTRAL = 0.3; // rad: pequeñas irregularidades del trazado no rompen el sentido del giro
  const MAX_TURN = 2; // rad: ningún giro dentro del anillo es más cerrado que esto
  const ringId = new Int32Array(edgeCount).fill(-1);
  const path = [];
  const turn = (a, b) => Math.atan2(ux[a] * uz[b] - uz[a] * ux[b], ux[a] * ux[b] + uz[a] * uz[b]);

  const walk = (start, e, sign, length, angle) => {
    for (let k = outStart[B[e]]; k < outStart[B[e] + 1]; k++) {
      const c = outList[k];
      if (rev[c] >= 0) continue;
      const t = turn(e, c);
      if (t * sign < -NEUTRAL || Math.abs(t) > MAX_TURN) continue;
      const total = angle + t;
      if (c === start) {
        if (total * sign > 5.2 && total * sign < 7.4) return true;
        continue;
      }
      const next = length + len[c];
      if (next > maxLength || path.length >= maxEdges || Math.abs(total) > 7.4 || path.includes(c)) continue;
      if (Math.hypot(nx[B[c]] - nx[A[start]], nz[B[c]] - nz[A[start]]) > maxLength / 2) continue;
      path.push(c);
      if (walk(start, c, sign, next, total)) return true;
      path.pop();
    }
    return false;
  };

  // Los ciclos que comparten tramos (el anillo y un atajo por el centro) forman una misma rotonda.
  let groups = 0;
  for (let e0 = 0; e0 < edgeCount; e0++) {
    if (rev[e0] >= 0 || ringId[e0] >= 0) continue;
    for (const sign of [1, -1]) {
      path.length = 0;
      path.push(e0);
      if (!walk(e0, e0, sign, len[e0], 0)) continue;
      const touched = new Set(path.map((m) => ringId[m]).filter((r) => r >= 0));
      const id = touched.size ? Math.min(...touched) : groups++;
      if (touched.size > 1) for (let e = 0; e < edgeCount; e++) if (touched.has(ringId[e])) ringId[e] = id;
      for (const m of path) ringId[m] = id;
      break;
    }
  }

  // Numeración compacta de las rotondas.
  const renumber = new Map();
  for (let e = 0; e < edgeCount; e++) {
    if (ringId[e] < 0) continue;
    if (!renumber.has(ringId[e])) renumber.set(ringId[e], renumber.size);
    ringId[e] = renumber.get(ringId[e]);
  }

  // Aristas del anillo que desembocan en el nodo donde empieza cada arista del anillo.
  const ringIn = new Array(edgeCount);
  for (let f = 0; f < edgeCount; f++) {
    if (ringId[f] < 0) continue;
    for (let k = outStart[B[f]]; k < outStart[B[f] + 1]; k++) {
      const c = outList[k];
      if (ringId[c] === ringId[f]) (ringIn[c] ??= []).push(f);
    }
  }
  return { ringId, ringIn };
}

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

  const rings = findRings({ edgeCount, A, B, len, ux, uz, rev, nx, nz, outStart, outList });

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
  const ringNode = new Uint8Array(nodeCount);
  for (let e = 0; e < edgeCount; e++) if (rings.ringId[e] >= 0) ringNode[A[e]] = ringNode[B[e]] = 1;
  const sig = new Int32Array(edgeCount).fill(-1);
  const grp = new Uint8Array(edgeCount);
  for (let e = 0; e < edgeCount; e++) {
    // En una rotonda solo regulan las entradas: un rojo en el anillo o en una salida corta bloquea el anillo entero.
    if (rings.ringId[e] >= 0 || ringNode[A[e]]) continue;
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
    ringId: rings.ringId,
    ringIn: rings.ringIn,
    signals,
    nearestSegment,
  };
}
