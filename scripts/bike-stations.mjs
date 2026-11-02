export function extractBikeStations(elements, project, round1) {
  const stations = [];
  const seen = new Set();
  for (const element of elements) {
    const tags = element.tags ?? {};
    const point = element.type === 'node' ? element : element.center;
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) continue;
    const id = `${element.type}/${element.id}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const rawCapacity = tags.capacity ?? tags['capacity:bikes'];
    const parsedCapacity = Number.parseInt(rawCapacity, 10);
    const estimatedCapacity = !Number.isInteger(parsedCapacity) || parsedCapacity <= 0;
    const [x, z] = project(point.lat, point.lon);
    stations.push({
      id,
      source: 'osm',
      name: tags.name || tags.operator || tags.network || `Estación ${element.id}`,
      x: round1(x),
      z: round1(z),
      capacity: estimatedCapacity ? 12 : parsedCapacity,
      estimatedCapacity,
      operator: tags.operator ?? '',
      network: tags.network ?? '',
    });
  }
  return stations;
}
