import { CONFIG } from '../config.js';

// Curva horaria de demanda (0..1) para un día laborable.
const HOURLY = [
  0.06, 0.04, 0.03, 0.03, 0.05, 0.15, 0.4, 0.85, 1.0, 0.75, 0.6, 0.6,
  0.7, 0.7, 0.65, 0.65, 0.8, 0.95, 1.0, 0.8, 0.5, 0.3, 0.18, 0.1,
];

export function dayIndex(simSeconds) {
  return Math.floor(simSeconds / 86400);
}

export function simDate(simSeconds) {
  return new Date(CONFIG.sim.baseDate + simSeconds * 1000);
}

export function demandFactor(simSeconds) {
  const hour = (simSeconds / 3600) % 24;
  const i = Math.floor(hour);
  const f = hour - i;
  const base = HOURLY[i] * (1 - f) + HOURLY[(i + 1) % 24] * f;
  const day = dayIndex(simSeconds);
  const weekend = day % 7 >= 5 ? 0.65 : 1;
  const noise = 0.9 + 0.2 * (Math.abs(Math.sin(day * 12.9898) * 43758.5453) % 1);
  return base * weekend * noise;
}
