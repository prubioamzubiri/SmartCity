const NOT_MARKED = new Set(['no', 'unmarked']);

const isCrossing = (tags) =>
  tags?.highway === 'crossing' && !NOT_MARKED.has(tags.crossing) && tags['crossing:markings'] !== 'no';

// Pasos de peatones: nodos highway=crossing de las calles, con la dirección de cruce (perpendicular a la calle).
// Devuelve una lista plana [x, z, dirX, dirZ, clase de vía, ...] con un paso por nodo.
export function extractCrossings(ways, nodesById, project, classOf, round = (v) => v) {
  const out = [];
  const seen = new Set();
  for (const w of ways) {
    const ids = w.nodes;
    for (let k = 0; k < ids.length; k++) {
      const node = nodesById.get(ids[k]);
      if (!node || seen.has(node.id) || !isCrossing(node.tags)) continue;
      const prev = nodesById.get(ids[Math.max(k - 1, 0)]);
      const next = nodesById.get(ids[Math.min(k + 1, ids.length - 1)]);
      if (!prev || !next) continue;
      const [px, pz] = project(prev.lat, prev.lon);
      const [nx, nz] = project(next.lat, next.lon);
      const len = Math.hypot(nx - px, nz - pz);
      if (len < 0.1) continue;
      seen.add(node.id);
      const [x, z] = project(node.lat, node.lon);
      out.push(round(x), round(z), Math.round((-(nz - pz) / len) * 1000) / 1000, Math.round(((nx - px) / len) * 1000) / 1000, classOf(w.tags));
    }
  }
  return out;
}
