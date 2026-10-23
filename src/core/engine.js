import { CONFIG } from '../config.js';
import { buildGraph } from '../traffic/graph.js';
import { SignalController } from '../traffic/signals.js';
import { TrafficSim } from '../traffic/sim.js';
import { demandFactor } from '../traffic/demand.js';
import { SensorManager } from '../sensors/sensorManager.js';
import { ParkingTracker } from '../sensors/parkingTracker.js';
import { trackableUndergroundLots, undergroundOccupancy } from '../city/undergroundLots.js';
import { createRng } from './random.js';

const SNAPSHOT_VERSION = 1;

// Simulación completa sin renderizado: se puede ejecutar en Node y reanudar desde un snapshot.
export class SimEngine {
  constructor({
    data,
    seed = CONFIG.sim.seed,
    startSeconds = CONFIG.sim.startSeconds,
    maxCars = CONFIG.cars.initialMax,
    scenario = CONFIG.traffic.scenario,
  }) {
    this.simTime = startSeconds;
    this.params = { maxCars, scenario };
    this.graph = buildGraph(data);
    this.signals = new SignalController(this.graph);
    this.sim = new TrafficSim(this.graph, this.signals, (sensor, dir, speed) => this.sensors.recordCrossing(sensor, dir, speed), {
      rng: createRng(seed),
    });
    this.sensors = new SensorManager({ graph: this.graph, sim: this.sim, getSimTime: () => this.simTime, storage: null });
    this.parking = new ParkingTracker({
      lots: trackableUndergroundLots(data.parking?.underground),
      occupancyOf: undergroundOccupancy,
      getSimTime: () => this.simTime,
      storage: null,
    });
    this.graphKey = `${this.graph.edgeCount}:${data.nodes.length}`;
    this.signals.update(this.simTime);
  }

  setParams({ maxCars, scenario }) {
    if (maxCars !== undefined) this.params.maxCars = Math.max(0, Math.min(CONFIG.cars.max, Math.round(maxCars)));
    if (scenario !== undefined) {
      demandFactor(0, scenario); // valida el escenario
      this.params.scenario = scenario;
    }
  }

  // Avanza la simulación paso a paso hasta `target` (o hasta agotar `maxSteps`); devuelve true si lo alcanza.
  advanceTo(target, maxSteps = Infinity) {
    const STEP = CONFIG.sim.step;
    let steps = 0;
    while (this.simTime + STEP <= target) {
      if (steps >= maxSteps) return false;
      this.simTime += STEP;
      this.signals.update(this.simTime);
      this.sim.setTarget(this.params.maxCars * demandFactor(this.simTime, this.params.scenario));
      this.sim.step(STEP);
      this.sensors.tick(this.simTime);
      this.parking.tick(this.simTime);
      steps++;
    }
    return true;
  }

  // Extrae los registros cerrados desde la última llamada (para persistirlos).
  drainRecords() {
    const traffic = this.sensors.pending.splice(0);
    const parking = this.parking.pending.splice(0);
    this.sensors.records.length = 0;
    this.parking.records.length = 0;
    return { traffic, parking };
  }

  snapshot() {
    return {
      version: SNAPSHOT_VERSION,
      simTime: this.simTime,
      params: { ...this.params },
      graphKey: this.graphKey,
      plan: this.signals.plan,
      sim: this.sim.serialize(),
      sensors: this.sensors.serialize(),
      parking: this.parking.serialize(),
    };
  }

  // Devuelve false si el snapshot no es compatible con los datos actuales de la ciudad.
  restore(state) {
    if (state?.version !== SNAPSHOT_VERSION) return false;
    this.simTime = state.simTime;
    this.params = { ...state.params };
    this.signals.setPlan(state.plan);
    this.sensors.restore(state.sensors);
    this.parking.restore(state.parking);
    const compatible = state.graphKey === this.graphKey;
    if (compatible) this.sim.restore(state.sim);
    this.signals.update(this.simTime);
    return compatible;
  }
}
