import { demandFactor } from '../traffic/demand.js';

export const DEFAULT_UNDERGROUND_CAPACITY = 150;

// Ocupación simulada (no es un dato real de OSM): sigue la curva de demanda de la ciudad.
export const occupancyAt = (demand, bias) => Math.min(1, Math.max(0.05, (0.15 + 0.8 * demand) * bias));

export const undergroundOccupancy = (lot, simTime) => occupancyAt(demandFactor(simTime), lot.bias);

// Datos de los parkings subterráneos públicos (con id estable por posición), sin dependencias gráficas.
export function undergroundLots(list = []) {
  return list.map(([x, z, capacity, fee, name], i) => ({
    id: `U${Math.round(x)}_${Math.round(z)}`,
    x,
    z,
    capacity: capacity || DEFAULT_UNDERGROUND_CAPACITY,
    estimatedCapacity: !capacity,
    fee: !!fee,
    name,
    bias: 0.85 + 0.3 * ((i * 0.618034) % 1),
  }));
}

// Lotes seguibles: sin duplicados y con nombre por defecto.
export function trackableUndergroundLots(list) {
  const seen = new Set();
  const lots = [];
  for (const lot of undergroundLots(list)) {
    if (seen.has(lot.id)) continue;
    seen.add(lot.id);
    lots.push({
      id: lot.id,
      name: lot.name || `Parking subterráneo (${lot.id.slice(1).replace('_', ', ')})`,
      capacity: lot.capacity,
      estimatedCapacity: lot.estimatedCapacity,
      bias: lot.bias,
    });
  }
  return lots;
}
