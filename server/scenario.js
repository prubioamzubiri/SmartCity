import { CONFIG } from '../src/config.js';

// Escenario de la ciudad desde el entorno. Este módulo se importa antes que el motor: el tiempo y el calendario de
// eventos se crean al importarse y leen aquí sus semillas.
//   SCENARIO_SEED   semilla de los coches, del tiempo y de los eventos (por defecto, la de siempre)
//   SCENARIO_START  fecha y hora simulada de inicio, p. ej. 2026-03-16T00:00 (por defecto, lunes 5 de enero a las 7:00)
// Solo cuentan al crear la base de datos: una ciudad ya creada sigue con su historia.
export function applyScenario(env = process.env, config = CONFIG) {
  const applied = {};
  if (env.SCENARIO_SEED) {
    const seed = Number(env.SCENARIO_SEED);
    if (!Number.isInteger(seed)) throw new Error(`SCENARIO_SEED debe ser un número entero: ${env.SCENARIO_SEED}`);
    config.sim.seed = seed;
    config.weather.seed = seed;
    config.events.seed = seed;
    applied.seed = seed;
  }
  if (env.SCENARIO_START) {
    const ms = Date.parse(`${env.SCENARIO_START.replace(/Z$/, '')}Z`);
    if (!Number.isFinite(ms) || ms < config.sim.baseDate) {
      throw new Error(`SCENARIO_START debe ser una fecha desde 2026-01-05, p. ej. 2026-03-16T00:00: ${env.SCENARIO_START}`);
    }
    config.sim.startSeconds = (ms - config.sim.baseDate) / 1000;
    applied.start = new Date(ms).toISOString().slice(0, 16);
  }
  return applied;
}

export const scenario = applyScenario();
