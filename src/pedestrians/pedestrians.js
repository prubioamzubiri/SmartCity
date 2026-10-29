import { CONFIG } from '../config.js';
import { demandFactor } from '../traffic/demand.js';

const P = CONFIG.pedestrians;
const STRIDE = 5; // x, z, dirX, dirZ, clase de vía

// Hash sin estado: número en [0, 1) para el peatón `i`, la ventana `k` y el uso `salt`.
function rand(i, k, salt) {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(k + 0x7f4a7c15, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// Peatones que cruzan los pasos de cebra de OSM. No guardan estado: la posición de cada uno es una función
// del tiempo, así que en cada ventana elige un paso, un sentido y un instante de salida. Solo se ven mientras cruzan.
export class Pedestrians {
  constructor(crossings = [], { max = P.max } = {}) {
    this.crossings = crossings;
    this.count = Math.floor(crossings.length / STRIDE);
    this.max = max;
    this.x = new Float32Array(max);
    this.z = new Float32Array(max);
    this.heading = new Float32Array(max); // giro sobre Y que apunta el triángulo (+X) hacia donde camina
    this.activeCount = 0;
  }

  // Posición a una hora simulada: el servidor y el visor usan esta misma función, así que coinciden.
  updateAt(simSeconds, scenario) {
    this.update(simSeconds * 1000, pedestrianDensity(demandFactor(simSeconds, scenario)));
  }

  // `density` en [0, 1]: fracción de los peatones que pueden estar en la calle.
  update(nowMs, density = 1) {
    const slot = P.slotSeconds;
    const t = nowMs / 1000;
    const k = Math.floor(t / slot);
    const local = t - k * slot;
    const allowed = this.count ? Math.min(this.max, Math.round(this.max * Math.max(0, Math.min(1, density)))) : 0;
    const c = this.crossings;
    let n = 0;
    for (let i = 0; i < allowed; i++) {
      const j = Math.floor(rand(i, k, 1) * this.count) * STRIDE;
      const half = CONFIG.roads.halfWidth[c[j + 4]] + P.margin;
      const speed = P.speed * (0.8 + 0.4 * rand(i, k, 2));
      const duration = (2 * half) / speed;
      const start = rand(i, k, 3) * Math.max(0, slot - duration);
      const s = (local - start) / duration;
      if (s < 0 || s > 1) continue;
      const dir = rand(i, k, 4) < 0.5 ? 1 : -1;
      const along = (2 * s - 1) * half * dir;
      const lateral = (rand(i, k, 5) - 0.5) * P.laneWidth;
      const dx = c[j + 2];
      const dz = c[j + 3];
      this.x[n] = c[j] + dx * along - dz * lateral;
      this.z[n] = c[j + 1] + dz * along + dx * lateral;
      this.heading[n] = Math.atan2(-dz * dir, dx * dir);
      n++;
    }
    this.activeCount = n;
  }
}

// Fracción de peatones activa según la demanda de tráfico (0 a 1 y pico) y el mínimo configurado.
export const pedestrianDensity = (demand) => P.minDensity + (1 - P.minDensity) * Math.min(1, Math.max(0, demand));
