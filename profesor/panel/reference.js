import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { sameParams } from './collector.js';

export const BASE_DATE = Date.UTC(2026, 0, 5); // segundo simulado 0 de todas las ciudades
const DEFAULT_SEED = 20260105; // ciudades de versiones anteriores, que no informan de su semilla
const DEFAULT_START = 7 * 3600;
const here = path.dirname(fileURLToPath(import.meta.url));
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
export const refName = (group) => `${group}·referencia`;

/**
 * Una ciudad de referencia por grupo, simulada por el propio panel en un hilo aparte con la semilla, inicio, escala y
 * demanda de la ciudad del grupo. Sigue la hora del grupo y vuelca en el recolector las filas de su histórico global,
 * con el nombre `<grupo>·referencia`. Guarda su estado en `dir` para reanudar tras un reinicio del panel.
 */
export class References {
  constructor({ collector, dir, root = path.resolve(here, '../..'), log = () => {}, createWorker }) {
    this.collector = collector;
    this.dir = dir;
    this.root = root;
    this.log = log;
    this.createWorker = createWorker ?? ((workerData) => new Worker(path.join(here, 'referenceWorker.mjs'), { workerData }));
    this.refs = new Map();
    fs.mkdirSync(dir, { recursive: true });
  }

  // Tras cada consulta a la ciudad de un grupo: arranca, ajusta o adelanta su referencia.
  sync(group) {
    const s = this.collector.status.get(group);
    if (!s?.ok || s.simSeconds === undefined) return;
    const epoch = this.collector.epochOf(group);
    const config = { seed: s.seed ?? DEFAULT_SEED, startSeconds: s.startSeconds ?? DEFAULT_START, scale: s.scale, params: s.params };
    const key = JSON.stringify([config.seed, config.startSeconds, config.scale, epoch]);
    let ref = this.refs.get(group);
    if (!ref || ref.key !== key) {
      ref = this.start(group, config, key, epoch, ref);
    } else if (!sameParams(ref.params, config.params)) {
      // La demanda de la ciudad la cambia el profesor (MAX_CARS…): la referencia la sigue desde ese momento.
      ref.params = config.params;
      ref.worker.postMessage({ type: 'params', params: config.params });
    }
    ref.target = s.simSeconds;
    ref.worker.postMessage({ type: 'advance', to: s.simSeconds });
  }

  start(group, config, key, epoch, previous) {
    const file = path.join(this.dir, `referencia-${slug(group)}.json`);
    if (previous) {
      previous.worker.terminate();
      // Otra ciudad (reinicio, otra semilla o escala): su referencia empieza de cero.
      fs.rmSync(file, { force: true });
    }
    this.collector.setEpoch(refName(group), epoch);
    const ref = { key, epoch, params: config.params, simSeconds: null, target: null, error: null, seed: config.seed };
    ref.worker = this.createWorker({ ...config, root: this.root, snapshotFile: file });
    ref.worker.on('message', (msg) => {
      if (msg.simSeconds !== undefined) ref.simSeconds = msg.simSeconds;
      if (msg.type === 'rows' && msg.rows.length) this.collector.ingest(refName(group), ref.epoch, msg.rows, BASE_DATE);
    });
    ref.worker.on('error', (err) => {
      ref.error = err.message;
      this.log(`Referencia de ${group}: ${err.message}`);
    });
    this.refs.set(group, ref);
    this.log(`Referencia de ${group}: semilla ${config.seed}, escala ×${config.scale?.toFixed?.(2)}`);
    return ref;
  }

  // Estado para el panel: hasta dónde ha simulado y si va por detrás de la ciudad del grupo.
  status(group) {
    const ref = this.refs.get(group);
    if (!ref) return null;
    return { simSeconds: ref.simSeconds, target: ref.target, error: ref.error, seed: ref.seed };
  }

  // Al parar el panel: cada referencia guarda su estado.
  async close() {
    await Promise.all([...this.refs.values()].map((ref) => new Promise((resolve) => {
      const onMessage = (m) => m.type === 'saved' && done();
      const done = () => {
        ref.worker.off('message', onMessage);
        ref.worker.terminate();
        resolve();
      };
      ref.worker.on('message', onMessage);
      ref.worker.postMessage({ type: 'save' });
      setTimeout(done, 5000);
    })));
  }
}
