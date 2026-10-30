import { CONFIG } from '../config.js';
import { buildGraph } from '../traffic/graph.js';
import { SignalController } from '../traffic/signals.js';
import { TrafficSim } from '../traffic/sim.js';
import { demandFactor } from '../traffic/demand.js';
import { SensorManager } from '../sensors/sensorManager.js';
import { ParkingTracker } from '../sensors/parkingTracker.js';
import { trackableUndergroundLots, undergroundOccupancy } from '../city/undergroundLots.js';
import { PedestrianSensors } from '../sensors/pedestrianSensors.js';
import { createWaterMask } from '../city/waterMask.js';
import { Pedestrians } from '../pedestrians/pedestrians.js';
import { toBase64 } from './binary.js';
import { createRng } from './random.js';

const SNAPSHOT_VERSION = 1;

// Simulación completa sin renderizado: se puede ejecutar en Node y reanudar desde un snapshot.
export class SimEngine {
  constructor({
    data,
    seed = CONFIG.sim.seed,
    startSeconds = CONFIG.sim.startSeconds,
    maxCars = CONFIG.cars.initialMax,
    maxPedestrians = CONFIG.pedestrians.max,
    scenario = CONFIG.traffic.scenario,
  }) {
    this.simTime = startSeconds;
    this.params = { maxCars, maxPedestrians, scenario };
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
    this.pedestrians = new Pedestrians(data.crossings, { graph: this.graph, water: createWaterMask(data) });
    this.pedSensors = new PedestrianSensors({
      graph: this.graph,
      pedestrians: this.pedestrians,
      getSimTime: () => this.simTime,
      getParams: () => this.params,
    });
    this.graphKey = `${this.graph.edgeCount}:${data.nodes.length}`;
    this.signals.update(this.simTime);
  }

  setParams({ maxCars, maxPedestrians, scenario }) {
    if (maxCars !== undefined) this.params.maxCars = Math.max(0, Math.min(CONFIG.cars.max, Math.round(maxCars)));
    if (maxPedestrians !== undefined) this.params.maxPedestrians = Math.max(0, Math.min(CONFIG.pedestrians.max, Math.round(maxPedestrians)));
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
      this.pedSensors.tick(this.simTime);
      steps++;
    }
    return true;
  }

  // Peatones en este instante: son una función del tiempo simulado (sin estado que guardar), así que
  // no entran en el snapshot y tras un reinicio salen exactamente igual.
  pedestrianPositions(scale = 1) {
    const p = this.pedestrians;
    p.updateAt(this.simTime, this.params.scenario, scale, this.params.maxPedestrians);
    const n = p.activeCount;
    return {
      activeCount: n,
      x: toBase64(p.x.subarray(0, n)),
      z: toBase64(p.z.subarray(0, n)),
      heading: toBase64(p.heading.subarray(0, n)),
    };
  }

  // Extrae los registros cerrados desde la última llamada (para persistirlos).
  drainRecords() {
    const traffic = this.sensors.pending.splice(0);
    const parking = this.parking.pending.splice(0);
    const pedestrians = this.pedSensors.pending.splice(0);
    this.sensors.records.length = 0;
    this.parking.records.length = 0;
    this.pedSensors.records.length = 0;
    return { traffic, parking, pedestrians };
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
      pedSensors: this.pedSensors.serialize(),
    };
  }

  // Devuelve false si el snapshot no es compatible con los datos actuales de la ciudad.
  restore(state) {
    if (state?.version !== SNAPSHOT_VERSION) return false;
    this.simTime = state.simTime;
    this.params = { maxPedestrians: CONFIG.pedestrians.max, ...state.params };
    this.signals.setPlan(state.plan);
    this.sensors.restore(state.sensors);
    this.parking.restore(state.parking);
    this.pedSensors.restore(state.pedSensors, this.simTime);
    const compatible = state.graphKey === this.graphKey;
    if (compatible) this.sim.restore(state.sim);
    this.signals.update(this.simTime);
    return compatible;
  }
}
