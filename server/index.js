// Primero el escenario: fija las semillas antes de que se carguen el motor, el tiempo y los eventos.
import { scenario } from './scenario.js';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { SimEngine } from '../src/core/engine.js';
import { Store } from './store.js';
import { DEFAULT_SCALE, Runtime } from './runtime.js';
import { createApp } from './app.js';
import { withBikeStations } from '../src/bikes/sharing.js';
import { CONFIG } from '../src/config.js';

const env = process.env;
const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

const cityFile = env.CITY_FILE ?? 'public/data/city.json';
const municipalFile = env.MUNICIPAL_FILE ?? path.join(path.dirname(cityFile), 'municipal.json');
const dbFile = env.DB_FILE ?? 'data/smartcity.db';
const port = Number(env.PORT ?? 8080);

if (!fs.existsSync(cityFile)) {
  console.error(`No existe ${cityFile}. Ejecuta "npm run fetch-osm" o define CITY_FILE.`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const data = JSON.parse(fs.readFileSync(cityFile, 'utf8'));
// Sin puestos de OSM en el mapa, usa el catálogo municipal igual que el visor.
const municipal = fs.existsSync(municipalFile) ? JSON.parse(fs.readFileSync(municipalFile, 'utf8')) : null;
withBikeStations(data, municipal);
const store = new Store(dbFile);
const runtime = new Runtime({
  engine: new SimEngine({ data }),
  store,
  scale: Number(env.SIM_SCALE ?? DEFAULT_SCALE),
  checkpointMs: Number(env.CHECKPOINT_SECONDS ?? 30) * 1000,
  log,
});
if (scenario.seed !== undefined || scenario.start) log(`Escenario: ${JSON.stringify(scenario)} (solo cuenta si la base de datos es nueva)`);
// La semilla queda ligada a la ciudad: cambiarla con la ciudad en marcha mezclaría dos historias distintas.
const savedSeed = store.getMeta('seed');
if (savedSeed === null) store.setMeta('seed', CONFIG.sim.seed);
else if (savedSeed !== CONFIG.sim.seed) {
  console.error(`Esta ciudad se creó con SCENARIO_SEED=${savedSeed} y ahora es ${CONFIG.sim.seed}. Vuelve a poner ${savedSeed} o borra su volumen para empezar una ciudad nueva.`);
  process.exit(1);
}
if (!env.SMARTCITY_TOKEN) log('SMARTCITY_TOKEN no definido: cualquiera puede modificar la ciudad');

// Demanda en hora punta (la fija el servidor; los alumnos no la pueden cambiar).
const demand = {};
for (const [key, name] of [['maxCars', 'MAX_CARS'], ['maxPedestrians', 'MAX_PEDESTRIANS']]) {
  if (!env[name]) continue;
  const value = Number(env[name]);
  if (!Number.isFinite(value) || value < 0) {
    console.error(`${name} debe ser un número positivo: ${env[name]}`);
    process.exit(1);
  }
  demand[key] = value;
}
if (Object.keys(demand).length) {
  runtime.mutate((e) => e.setParams(demand));
  log(`Demanda en hora punta: ${JSON.stringify(runtime.engine.params)}`);
}
const server = http.createServer(createApp({ runtime, store, token: env.SMARTCITY_TOKEN, corsOrigin: env.CORS_ORIGIN ?? '*' }));
server.listen(port, () => log(`API en http://localhost:${port} · escala ×${runtime.scale.toFixed(2)} · ${JSON.stringify(runtime.status())}`));

const loop = runtime.start();

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  log('Cerrando: guardando estado');
  runtime.stop();
  await loop;
  server.close();
  store.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
