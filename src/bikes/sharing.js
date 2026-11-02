const DEFAULT_CAPACITY = 12;

export function municipalBikeStations(stations = []) {
  return stations
    .filter((station) => Number.isFinite(station.x) && Number.isFinite(station.z))
    .map((station) => ({
      id: `municipal/${station.id}`,
      source: 'municipal',
      name: station.name || `Estación Dbizi ${station.id}`,
      x: station.x,
      z: station.z,
      capacity: DEFAULT_CAPACITY,
      estimatedCapacity: true,
      operator: 'Dbizi',
      network: 'Dbizi',
    }));
}

export function bikeAvailabilityColor(available, capacity) {
  const ratio = capacity > 0 ? available / capacity : 0;
  if (ratio <= 0.2) return 0xe74c3c;
  if (ratio <= 0.5) return 0xf1c40f;
  return 0x2ecc71;
}

// Si el mapa no trae puestos de OSM, usa el catálogo municipal (GeoDonostia).
export function withBikeStations(data, municipal) {
  if (!data.bicycleStations?.length) data.bicycleStations = municipalBikeStations(municipal?.layers?.stations);
  return data;
}
