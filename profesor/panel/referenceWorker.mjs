// Ciudad de referencia de un grupo (sin gestor), en un hilo aparte del panel.
// Simula con la misma semilla, inicio, escala y demanda que la ciudad del grupo y va siguiendo su hora: lo que habría
// pasado en esa ciudad si nadie la gestionara. Envía al panel las filas del histórico global (/api/city.csv).
import fs from 'node:fs';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { CONFIG } from '../../src/config.js';

const { seed, startSeconds, scale, params, root, snapshotFile } = workerData;

// La semilla tiene que estar puesta antes de cargar el motor: el tiempo y los eventos la leen al importarse.
CONFIG.sim.seed = seed;
CONFIG.weather.seed = seed;
CONFIG.events.seed = seed;
CONFIG.sim.startSeconds = startSeconds;
const { SimEngine } = await import('../../src/core/engine.js');
const { withBikeStations } = await import('../../src/bikes/sharing.js');

const data = JSON.parse(fs.readFileSync(path.join(root, 'public/data/city.json'), 'utf8'));
const municipalFile = path.join(root, 'public/data/municipal.json');
withBikeStations(data, fs.existsSync(municipalFile) ? JSON.parse(fs.readFileSync(municipalFile, 'utf8')) : null);

const engine = new SimEngine({ data, seed, startSeconds });
engine.scale = scale;
engine.setParams(params);
const key = JSON.stringify({ seed, startSeconds, scale });
try {
  const saved = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
  if (saved.key === key && engine.restore(saved.snapshot)) engine.setParams(params);
} catch {
  // sin snapshot (primera vez) o ilegible: empieza desde el inicio de la ciudad
}

// Guarda el estado (escritura atómica) para reanudar tras reiniciar el panel. Las filas ya enviadas no se repiten
// en el panel aunque se regeneren: las descarta por su marca de tiempo.
function save() {
  const tmp = `${snapshotFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ key, snapshot: engine.snapshot() }));
  fs.renameSync(tmp, snapshotFile);
}

let target = engine.simTime;
let running = false;
let lastSave = engine.simTime;

async function run() {
  if (running) return;
  running = true;
  while (engine.simTime + 1 < target) {
    // Tramos de 1 h simulada: entre tramo y tramo atiende mensajes (nuevo objetivo, cambio de demanda).
    engine.advanceTo(Math.min(target, engine.simTime + 3600));
    const rows = engine.drainRecords().city;
    parentPort.postMessage({ type: 'rows', rows, simSeconds: engine.simTime });
    if (engine.simTime - lastSave >= 24 * 3600) {
      save();
      lastSave = engine.simTime;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  parentPort.postMessage({ type: 'idle', simSeconds: engine.simTime });
  running = false;
}

parentPort.on('message', (msg) => {
  if (msg.type === 'advance') {
    target = Math.max(target, msg.to);
    run();
  } else if (msg.type === 'params') {
    engine.setParams(msg.params);
  } else if (msg.type === 'save') {
    save();
    parentPort.postMessage({ type: 'saved' });
  }
});
parentPort.postMessage({ type: 'ready', simSeconds: engine.simTime });
