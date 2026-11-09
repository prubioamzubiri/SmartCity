import { CONFIG } from '../config.js';
import { buildGraph } from '../traffic/graph.js';
import { SignalController } from '../traffic/signals.js';
import { TrafficSim } from '../traffic/sim.js';
import { demandFactor, speedFactor } from '../traffic/demand.js';
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
import { Restrictions } from '../traffic/restrictions.js';
import { BusTracker } from '../sensors/busTracker.js';
import { CityTracker } from '../sensors/cityTracker.js';
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
    this.environmentMinute = null;
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
    this.restrictions = new Restrictions({
      graph: this.graph,
      sim: this.sim,
      buses: this.buses,
      lines: this.transit.lines,
      getSimTime: () => this.simTime,
    });
    this.busTracker = new BusTracker({
      lines: this.transit.lines,
      getSimTime: () => this.simTime,
      statsAt: (time) => {
        this.buses.updateAt(time, this.params.scenario, this.scale);
        return this.buses.stats;
      },
    });
    this.bikes = new BikeNetwork({ stations: data.bicycleStations, getSimTime: () => this.simTime, getParams: () => this.params });
    this.cityStats = new CityTracker({ getSimTime: () => this.simTime, sample: (time) => this.cityRow(time) });
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

  // Cambia los autobuses de una línea (por id, p. ej. "L1"); lanza RangeError si el número no es válido.
  setBusFleet(lineId, count) {
    const li = this.transit.lines.findIndex((l) => l.id === lineId);
    if (li < 0) return false;
    this.buses.setFleet(li, count);
    return true;
  }

  // Qué hay en este instante a menos de `radius` metros de (x, z): coches, peatones y autobuses.
  pointStats(x, z, radius, scale = this.scale) {
    const g = this.graph;
    const sim = this.sim;
    const r2 = radius * radius;
    let cars = 0;
    let stopped = 0;
    let speedSum = 0;
    for (let i = 0; i < sim.activeCount; i++) {
      const e = sim.edge[i];
      const dx = g.nx[g.A[e]] + g.ux[e] * sim.pos[i] - x;
      const dz = g.nz[g.A[e]] + g.uz[e] * sim.pos[i] - z;
      if (dx * dx + dz * dz > r2) continue;
      cars++;
      speedSum += sim.speed[i];
      if (sim.speed[i] < 0.5) stopped++;
    }

    const p = this.pedestrians;
    p.setBikeRiders(this.bikes.inUse);
    p.updateAt(this.simTime, this.params.scenario, scale, this.params.maxPedestrians);
    let pedestrians = 0;
    for (let i = 0; i < p.activeCount; i++) {
      const dx = p.x[i] - x;
      const dz = p.z[i] - z;
      if (dx * dx + dz * dz <= r2) pedestrians++;
    }

    const b = this.buses;
    b.updateAt(this.simTime, this.params.scenario, scale);
    let buses = 0;
    let passengers = 0;
    for (let i = 0; i < b.activeCount; i++) {
      const dx = b.x[i] - x;
      const dz = b.z[i] - z;
      if (dx * dx + dz * dz > r2) continue;
      buses++;
      passengers += b.load[i];
    }

    return {
      cars: { count: cars, stopped, avgKmh: cars ? Math.round((speedSum / cars) * 36) / 10 : 0 },
      pedestrians: { count: pedestrians },
      buses: { count: buses, passengers },
    };
  }

  // Avanza la simulación paso a paso hasta `target` (o hasta agotar `maxSteps`); devuelve true si lo alcanza.
  advanceTo(target, maxSteps = Infinity) {
    const STEP = CONFIG.sim.step;
    let steps = 0;
    while (this.simTime + STEP <= target) {
      if (steps >= maxSteps) return false;
      this.simTime += STEP;
      this.signals.update(this.simTime);
      this.updateEnvironment();
      this.sim.setTarget(this.params.maxCars * demandFactor(this.simTime, this.params.scenario));
      this.sim.step(STEP);
      this.sensors.tick(this.simTime);
      this.parking.tick(this.simTime);
      this.pedSensors.tick(this.simTime);
      this.busTracker.tick(this.simTime);
      this.bikes.tick(this.simTime);
      this.cityStats.tick(this.simTime);
      steps++;
    }
    return true;
  }

  // Las sedes de los eventos en curso y la velocidad que permite el tiempo se actualizan cada minuto simulado
  // (también tras restaurar un snapshot): salen de la hora, así que no hay estado que guardar.
  updateEnvironment() {
    const minute = Math.floor(this.simTime / 60);
    if (minute === this.environmentMinute) return;
    this.environmentMinute = minute;
    this.sim.speedScale = speedFactor(minute * 60);
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

  // Fila del histórico global: tráfico, autobuses, bicis, parkings y cuánto se ha intervenido la ciudad.
  cityRow(time) {
    const traffic = this.sim.stats();
    this.buses.updateAt(time, this.params.scenario, this.scale);
    const lines = this.buses.stats;
    const sum = (key) => lines.reduce((acc, s) => acc + s[key], 0);
    const bikes = this.bikes.state();
    const metres = { closed: 0, busOnly: 0, limited: 0 };
    for (const item of this.restrictions.items) {
      const length = this.restrictions.lengthOf(item.edges);
      if (item.mode === 'buses_and_pedestrians') metres.busOnly += length;
      else if (item.mode === 'entry_limit' && item.limit > 0) metres.limited += length;
      else metres.closed += length;
    }
    let fullLots = 0;
    for (const lot of this.parking.lots.values()) if (this.parking.occupancyOf(lot, time) >= 0.95) fullLots++;
    return {
      cars: traffic.active,
      stopped: traffic.stopped,
      avg_speed_kmh: Math.round(traffic.avgKmh * 10) / 10,
      buses: sum('active'),
      bus_passengers: sum('passengers'),
      full_buses: sum('full'),
      bus_waiting: sum('waiting'),
      suspended_lines: this.buses.suspended.filter(Boolean).length,
      bikes_in_use: bikes.inUse,
      stations_empty: bikes.stations.filter((s) => s.available <= 0).length,
      stations_full: bikes.stations.filter((s) => s.available >= s.capacity).length,
      parkings_full: fullLots,
      closed_m: Math.round(metres.closed),
      bus_only_m: Math.round(metres.busOnly),
      limited_m: Math.round(metres.limited),
      signals_all_red: this.signals.signals.filter((sig) => sig.active && this.signals.modeOf(sig) === 'all_red').length,
    };
  }

  // Extrae los registros cerrados desde la última llamada (para persistirlos).
  drainRecords() {
    const traffic = this.sensors.pending.splice(0);
    const parking = this.parking.pending.splice(0);
    const pedestrians = this.pedSensors.pending.splice(0);
    const buses = this.busTracker.pending.splice(0);
    const bikes = this.bikes.pending.splice(0);
    const city = this.cityStats.pending.splice(0);
    this.sensors.records.length = 0;
    this.parking.records.length = 0;
    this.pedSensors.records.length = 0;
    return { traffic, parking, pedestrians, buses, bikes, city };
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
      city: this.cityStats.serialize(),
      fleet: Object.fromEntries(this.transit.lines.map((l) => [l.id, l.buses])),
      restrictions: this.restrictions.serialize(),
    };
  }

  // Devuelve false si el snapshot no es compatible con los datos actuales de la ciudad.
  restore(state) {
    if (state?.version !== SNAPSHOT_VERSION) return false;
    this.simTime = state.simTime;
    this.environmentMinute = null;
    this.params = { maxPedestrians: CONFIG.pedestrians.max, ...state.params };
    this.signals.setPlan(state.plan);
    this.sensors.restore(state.sensors);
    this.parking.restore(state.parking);
    this.pedSensors.restore(state.pedSensors, this.simTime);
    if (state.buses) this.busTracker.restore(state.buses); // los snapshots anteriores a los autobuses no lo traen
    if (state.bikes) this.bikes.restore(state.bikes);
    // Snapshots anteriores al histórico global: empieza en el siguiente intervalo.
    if (state.city) this.cityStats.restore(state.city);
    else this.cityStats.nextSample = Math.ceil(this.simTime / this.cityStats.intervalSeconds) * this.cityStats.intervalSeconds;
    for (const [id, count] of Object.entries(state.fleet ?? {})) {
      try {
        this.setBusFleet(id, count);
      } catch {
        // flota fuera del rango actual: se queda la de por defecto
      }
    }
    const compatible = state.graphKey === this.graphKey;
    if (compatible && state.restrictions) this.restrictions.restore(state.restrictions);
    if (compatible) this.sim.restore(state.sim);
    this.signals.update(this.simTime);
    return compatible;
  }
}
