import { CONFIG } from '../config.js';
import { buildGraph } from '../traffic/graph.js';
import { SignalController } from '../traffic/signals.js';
import { TrafficSim } from '../traffic/sim.js';
import { demandFactor } from '../traffic/demand.js';
import { eventCalendar } from '../events/calendar.js';
import { SensorManager } from '../sensors/sensorManager.js';
import { ParkingTracker } from '../sensors/parkingTracker.js';
import { trackableUndergroundLots, undergroundOccupancy } from '../city/undergroundLots.js';
import { PedestrianSensors } from '../sensors/pedestrianSensors.js';
import { createWaterMask } from '../city/waterMask.js';
import { Pedestrians } from '../pedestrians/pedestrians.js';
import { pedestrianWeights } from '../pedestrians/weights.js';
import { buildTransit } from '../transit/lines.js';
import { Buses } from '../transit/buses.js';
import { BusTracker } from '../sensors/busTracker.js';
import { BikeNetwork } from '../bikes/bikeNetwork.js';
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
    this.attractorMinute = null;
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
    const weights = pedestrianWeights(this.graph, data);
    this.pedestrians = new Pedestrians(data.crossings, { graph: this.graph, water: createWaterMask(data), weights, signals: this.signals });
    this.pedSensors = new PedestrianSensors({
      graph: this.graph,
      pedestrians: this.pedestrians,
      getSimTime: () => this.simTime,
      getParams: () => this.params,
    });
    // Autobuses: como los peatones, son una función del tiempo simulado y de la escala del reloj (la fija quien
    // ejecuta el motor), así que no hay estado de autobuses que guardar; solo qué líneas se registran.
    this.scale = 1;
    this.transit = buildTransit(data, this.graph, { weights: weights.edge });
    this.buses = new Buses(this.transit, this.graph);
    this.busTracker = new BusTracker({
      lines: this.transit.lines,
      getSimTime: () => this.simTime,
      statsAt: (time) => {
        this.buses.updateAt(time, this.params.scenario, this.scale);
        return this.buses.stats;
      },
    });
    this.bikes = new BikeNetwork({ stations: data.bicycleStations, getSimTime: () => this.simTime, getParams: () => this.params });
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
      this.updateAttractors();
      this.sim.setTarget(this.params.maxCars * demandFactor(this.simTime, this.params.scenario));
      this.sim.step(STEP);
      this.sensors.tick(this.simTime);
      this.parking.tick(this.simTime);
      this.pedSensors.tick(this.simTime);
      this.busTracker.tick(this.simTime);
      this.bikes.tick(this.simTime);
      steps++;
    }
    return true;
  }

  // Las sedes de los eventos en curso se actualizan cada minuto simulado (también tras restaurar un snapshot).
  updateAttractors() {
    const minute = Math.floor(this.simTime / 60);
    if (minute === this.attractorMinute) return;
    this.attractorMinute = minute;
    this.sim.setAttractors(CONFIG.events.enabled ? eventCalendar.attractorsAt(minute * 60) : []);
  }

  // Peatones en este instante: son una función del tiempo simulado (sin estado que guardar), así que
  // no entran en el snapshot y tras un reinicio salen exactamente igual.
  pedestrianPositions(scale = 1) {
    const p = this.pedestrians;
    p.setBikeRiders(this.bikes.inUse);
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
    const buses = this.busTracker.pending.splice(0);
    const bikes = this.bikes.pending.splice(0);
    this.sensors.records.length = 0;
    this.parking.records.length = 0;
    this.pedSensors.records.length = 0;
    return { traffic, parking, pedestrians, buses, bikes };
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
      buses: this.busTracker.serialize(),
      bikes: this.bikes.serialize(),
    };
  }

  // Devuelve false si el snapshot no es compatible con los datos actuales de la ciudad.
  restore(state) {
    if (state?.version !== SNAPSHOT_VERSION) return false;
    this.simTime = state.simTime;
    this.attractorMinute = null;
    this.params = { maxPedestrians: CONFIG.pedestrians.max, ...state.params };
    this.signals.setPlan(state.plan);
    this.sensors.restore(state.sensors);
    this.parking.restore(state.parking);
    this.pedSensors.restore(state.pedSensors, this.simTime);
    if (state.buses) this.busTracker.restore(state.buses); // los snapshots anteriores a los autobuses no lo traen
    if (state.bikes) this.bikes.restore(state.bikes);
    const compatible = state.graphKey === this.graphKey;
    if (compatible) this.sim.restore(state.sim);
    this.signals.update(this.simTime);
    return compatible;
  }
}
