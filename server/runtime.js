import { CONFIG } from '../src/config.js';
import { simDate } from '../src/traffic/demand.js';

// Una semana real equivale a un año simulado.
export const DEFAULT_SCALE = 365 / 7;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

// Enlaza el motor con el reloj real: el tiempo simulado avanza aunque no haya ningún cliente conectado,
// y tras una parada se recupera el tiempo perdido simulando hasta "ahora".
export class Runtime {
  constructor({ engine, store, now = Date.now, scale = DEFAULT_SCALE, checkpointMs = 30000, sliceSteps = 300, log = () => {} }) {
    this.engine = engine;
    this.store = store;
    this.now = now;
    this.checkpointMs = checkpointMs;
    this.sliceSteps = sliceSteps;
    this.log = log;
    this.running = false;
    this.lastCheckpoint = now();
    this.anchor = store.getMeta('anchor');
    if (!this.anchor) {
      this.anchor = { wallMs: now(), simSeconds: CONFIG.sim.startSeconds, scale };
      store.setMeta('anchor', this.anchor);
    } else if (this.anchor.scale !== scale) {
      log(`SIM_SCALE=${scale} ignorado: la base de datos se creó con escala ${this.anchor.scale}`);
    }
    const snapshot = store.loadSnapshot();
    if (snapshot) {
      if (!engine.restore(snapshot)) log('Snapshot incompatible con los datos de la ciudad: los coches se reinician');
    } else {
      this.checkpoint();
    }
  }

  get scale() {
    return this.anchor.scale;
  }

  simTimeAt(wallMs) {
    return this.anchor.simSeconds + ((wallMs - this.anchor.wallMs) / 1000) * this.anchor.scale;
  }

  // Un tramo de simulación acotado para no bloquear el servidor durante la recuperación. true = al día.
  tick() {
    const caughtUp = this.engine.advanceTo(this.simTimeAt(this.now()), this.sliceSteps);
    if (this.now() - this.lastCheckpoint >= this.checkpointMs) this.checkpoint();
    return caughtUp;
  }

  checkpoint() {
    this.store.checkpoint(this.engine.snapshot(), this.engine.drainRecords(), this.now());
    this.lastCheckpoint = this.now();
  }

  // Aplica un cambio de configuración y lo persiste de inmediato.
  mutate(fn) {
    const result = fn(this.engine);
    this.checkpoint();
    return result;
  }

  status() {
    const target = this.simTimeAt(this.now());
    const behind = Math.max(0, target - this.engine.simTime);
    return {
      scale: this.scale,
      simSeconds: this.engine.simTime,
      simTime: simDate(this.engine.simTime).toISOString().slice(0, 19),
      behindSimSeconds: Math.round(behind),
      caughtUp: behind <= this.scale, // menos de 1 s real de retraso
      cars: this.engine.sim.activeCount,
    };
  }

  async start() {
    this.running = true;
    while (this.running) {
      const caughtUp = this.tick();
      await (caughtUp ? sleep(100) : yieldToEventLoop());
    }
  }

  stop() {
    this.running = false;
    this.checkpoint();
  }
}
