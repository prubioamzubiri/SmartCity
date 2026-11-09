// Ciudad de referencia de un escenario: la misma simulación que el servidor, sin gestor y a máxima velocidad.
// Uso (lo lanza evaluar.mjs): SCENARIO_SEED=.. SCENARIO_START=.. node referencia.mjs <horas> <escala>
// Escribe en la salida estándar las filas de /api/city.csv del periodo, en JSON.
import { scenario } from '../../server/scenario.js'; // primero: fija las semillas antes de cargar el motor
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimEngine } from '../../src/core/engine.js';
import { withBikeStations } from '../../src/bikes/sharing.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hours = Number(process.argv[2]);
const scale = Number(process.argv[3]);
if (!(hours > 0) || !(scale > 0)) {
  console.error('Uso: node referencia.mjs <horas> <escala>');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(path.join(root, 'public/data/city.json'), 'utf8'));
const municipalFile = path.join(root, 'public/data/municipal.json');
withBikeStations(data, fs.existsSync(municipalFile) ? JSON.parse(fs.readFileSync(municipalFile, 'utf8')) : null);
// Igual que server/index.js y server/runtime.js: motor con el inicio del escenario y la escala del reloj.
const engine = new SimEngine({ data });
engine.scale = scale;
const end = engine.simTime + hours * 3600;
const rows = [];
while (engine.simTime + 1 < end) {
  engine.advanceTo(Math.min(end, engine.simTime + 3600));
  rows.push(...engine.drainRecords().city);
}
process.stdout.write(JSON.stringify({ scenario, rows }));
