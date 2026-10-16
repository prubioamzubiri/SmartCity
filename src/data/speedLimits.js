// Conservative spatial correspondence between municipal centre-lines and OSM edges.
// Geometry alone cannot resolve bridges, parallel roads or direction-specific limits.
export function matchSpeedLimits(graph, features, { distance = 8, alignment = 0.97 } = {}) {
  const cell = 50;
  const grid = new Map();
  for (const feature of features) {
    if (!(feature.limitKmh > 0 && feature.limitKmh <= 130)) continue;
    for (const path of feature.paths) for (let i = 0; i < path.length - 2; i += 2) {
      const [x, z, bx, bz] = path.slice(i, i + 4);
      const dx = bx - x, dz = bz - z, len = Math.hypot(dx, dz);
      if (len < 0.1) continue;
      const segment = { x, z, dx: dx / len, dz: dz / len, len, limit: feature.limitKmh, id: feature.id };
      for (let cx = Math.floor((Math.min(x, bx) - distance) / cell); cx <= Math.floor((Math.max(x, bx) + distance) / cell); cx++) {
        for (let cz = Math.floor((Math.min(z, bz) - distance) / cell); cz <= Math.floor((Math.max(z, bz) + distance) / cell); cz++) {
          const key = `${cx},${cz}`;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(segment);
        }
      }
    }
  }
  const limits = new Float32Array(graph.edgeCount).fill(Infinity);
  let matched = 0;
  for (let edge = 0; edge < graph.edgeCount; edge++) {
    let candidate = null;
    let valid = true;
    for (const fraction of [0.1, 0.5, 0.9]) {
      const x = graph.nx[graph.A[edge]] + graph.ux[edge] * graph.len[edge] * fraction;
      const z = graph.nz[graph.A[edge]] + graph.uz[edge] * graph.len[edge] * fraction;
      let best = Infinity, limit = null;
      for (const s of grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) ?? []) {
        if (Math.abs(s.dx * graph.ux[edge] + s.dz * graph.uz[edge]) < alignment) continue;
        const t = Math.max(0, Math.min(s.len, (x - s.x) * s.dx + (z - s.z) * s.dz));
        const d = Math.hypot(x - s.x - t * s.dx, z - s.z - t * s.dz);
        if (d <= distance && d < best - 0.01) { best = d; limit = s.limit; }
        else if (d <= distance && Math.abs(d - best) <= 0.01 && limit !== s.limit) limit = null;
      }
      if (limit === null || (candidate !== null && candidate !== limit)) { valid = false; break; }
      candidate = limit;
    }
    if (valid && candidate !== null) { limits[edge] = candidate / 3.6; matched++; }
  }
  return { limits, matched, distance, alignment, algorithm: 'centreline-three-samples-v1' };
}
