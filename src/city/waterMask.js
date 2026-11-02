const CELL = 4; // metros por celda de la máscara
const PAD = 50;
const RIVER_HALF_WIDTH = 12; // igual que las cintas de los ríos que dibuja createWater

// Máscara raster del agua (mar, ría, lagos y ríos) para consultar en O(1) si un punto está en el agua.
// No depende de THREE: la usan el servidor y el visor.
export function createWaterMask(data, { cell = CELL, riverHalfWidth = RIVER_HALF_WIDTH } = {}) {
  const water = data.water;
  const bounds = data.bounds;
  if (!water || !bounds || (!water.polygons?.length && !water.lines?.length)) return { inWater: () => false, cells: 0 };

  const minX = bounds.minX - PAD;
  const minZ = bounds.minZ - PAD;
  const cols = Math.ceil((bounds.maxX + PAD - minX) / cell);
  const rows = Math.ceil((bounds.maxZ + PAD - minZ) / cell);
  const mask = new Uint8Array(cols * rows);

  // Relleno par-impar por filas: el anillo exterior y los huecos (islas) de un polígono.
  const xs = [];
  for (const rings of water.polygons ?? []) {
    for (let r = 0; r < rows; r++) {
      const zc = minZ + (r + 0.5) * cell;
      xs.length = 0;
      for (const ring of rings) {
        for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
          const z1 = ring[j + 1];
          const z2 = ring[i + 1];
          if (z1 <= zc === z2 <= zc) continue;
          xs.push(ring[j] + ((zc - z1) / (z2 - z1)) * (ring[i] - ring[j]));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const from = Math.max(0, Math.ceil((xs[k] - minX) / cell - 0.5));
        const to = Math.min(cols - 1, Math.ceil((xs[k + 1] - minX) / cell - 0.5) - 1);
        for (let c = from; c <= to; c++) mask[r * cols + c] = 1;
      }
    }
  }

  // Ríos: celdas a menos de `riverHalfWidth` del eje.
  for (const line of water.lines ?? []) {
    for (let i = 0; i + 3 < line.length; i += 2) {
      const ax = line[i], az = line[i + 1], dx = line[i + 2] - ax, dz = line[i + 3] - az;
      const len2 = dx * dx + dz * dz;
      const c0 = Math.max(0, Math.floor((Math.min(ax, ax + dx) - riverHalfWidth - minX) / cell));
      const c1 = Math.min(cols - 1, Math.floor((Math.max(ax, ax + dx) + riverHalfWidth - minX) / cell));
      const r0 = Math.max(0, Math.floor((Math.min(az, az + dz) - riverHalfWidth - minZ) / cell));
      const r1 = Math.min(rows - 1, Math.floor((Math.max(az, az + dz) + riverHalfWidth - minZ) / cell));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const px = minX + (c + 0.5) * cell - ax;
          const pz = minZ + (r + 0.5) * cell - az;
          const t = len2 > 0 ? Math.min(1, Math.max(0, (px * dx + pz * dz) / len2)) : 0;
          if (Math.hypot(px - t * dx, pz - t * dz) <= riverHalfWidth) mask[r * cols + c] = 1;
        }
      }
    }
  }

  return {
    cells: mask.length,
    inWater(x, z) {
      const c = Math.floor((x - minX) / cell);
      const r = Math.floor((z - minZ) / cell);
      return c >= 0 && c < cols && r >= 0 && r < rows && mask[r * cols + c] === 1;
    },
  };
}
