import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { SimEngine } from '../src/core/engine.js';
import { Store } from './store.js';
import { DEFAULT_SCALE, Runtime } from './runtime.js';
import { createApp } from './app.js';

const env = process.env;
const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

const cityFile = env.CITY_FILE ?? 'public/data/city.json';
const dbFile = env.DB_FILE ?? 'data/smartcity.db';
const port = Number(env.PORT ?? 8080);

if (!fs.existsSync(cityFile)) {
  console.error(`No existe ${cityFile}. Ejecuta "npm run fetch-osm" o define CITY_FILE.`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const data = JSON.parse(fs.readFileSync(cityFile, 'utf8'));
const store = new Store(dbFile);
const runtime = new Runtime({
  engine: new SimEngine({ data }),
  store,
  scale: Number(env.SIM_SCALE ?? DEFAULT_SCALE),
  checkpointMs: Number(env.CHECKPOINT_SECONDS ?? 30) * 1000,
  log,
});
if (!env.SMARTCITY_TOKEN) log('SMARTCITY_TOKEN no definido: cualquiera puede modificar la ciudad');

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
