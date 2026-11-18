import { CONFIG } from '../config.js';
import { buildGraph } from '../traffic/graph.js';
import { SignalController } from '../traffic/signals.js';
import { Crosswalks } from '../traffic/crosswalks.js';
import { TrafficSim } from '../traffic/sim.js';
import { demandFactor, speedFactor } from '../traffic/demand.js';
import { eventCalendar } from '../events/calendar.js';
import { poiStrength, projectPois } from '../city/pois.js';
import { SensorManager } from '../sensors/sensorManager.js';
import { ParkingTracker } from '../sensors/parkingTracker.js';
import { trackableUndergroundLots } from '../city/undergroundLots.js';
import { ParkingLots } from '../city/parkingLots.js';
import { PedestrianSensors } from '../sensors/pedestrianSensors.js';
import { createWaterMask } from '../city/waterMask.js';
import { Pedestrians, pedestrianLoad } from '../pedestrians/pedestrians.js';
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
    this.carFactor = 1; // demanda de coches por el cambio de modo y las calles cortadas (se recalcula cada minuto)
    this.unserved = 0; // fracción de la gente que quería ir en autobús y no ha podido
    this.busDay = { day: Math.floor(startSeconds / 86400), used: 0, included: 0 }; // horas de autobús del día
    this.params = { maxCars, maxPedestrians, scenario };
    this.graph = buildGraph(data);
    this.signals = new SignalController(this.graph);
    const weights = pedestrianWeights(this.graph, data);
    this.crosswalks = new Crosswalks(this.graph, data.crossings ?? [], this.signals, { weights: weights.crossing });
    this.sim = new TrafficSim(this.graph, this.signals, (sensor, dir, speed) => this.sensors.recordCrossing(sensor, dir, speed), {
      rng: createRng(seed),
      crosswalks: this.crosswalks,
    });
    // Cada sede de evento es un destino propio (siempre en el mismo orden: los snapshots guardan el índice del destino).
    if (this.sim.trips && CONFIG.events.enabled) for (const v of Object.values(eventCalendar.venues)) this.sim.trips.addPoint(v.id, v.x, v.z);
    this.eventCarCut = 0; // demanda de coches de los eventos que no llegan en coche porque sus calles están cortadas
    this.sensors = new SensorManager({ graph: this.graph, sim: this.sim, getSimTime: () => this.simTime, storage: null });
    // Parkings con estado y precio (los coches de los eventos con sus calles cortadas no vienen: los quita `access`).
    this.lots = new ParkingLots(trackableUndergroundLots(data.parking?.underground), {
      getParams: () => this.params,
      attractorsAt: (t) => (CONFIG.events.enabled ? eventCalendar.busDemandAt(t) : []).map((a) => ({ ...a, weight: a.weight * (this.buses?.eventAccess?.get(a.id) ?? 1) })),
    });
    this.parking = new ParkingTracker({
      lots: trackableUndergroundLots(data.parking?.underground),
      occupancyOf: (lot) => this.lots.occupancy(lot.id),
      getSimTime: () => this.simTime,
      storage: null,
    });
    this.pedestrians = new Pedestrians(data.crossings, { graph: this.graph, water: createWaterMask(data), weights, signals: this.signals, crosswalks: this.crosswalks });
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
    this.signals.isClosed = (e) => this.sim.closed[e] === 1;
    this.signals.setPedestrianWeights(weights.edge);
    this.sim.trips?.setZoneWeights(weights.edge);
    // Lugares de interés: zonas de destino y calles de cada uno (para los coches que salen de ellos).
    // Solo los lugares que están en el mapa (con calles alrededor): en ciudades de prueba pequeñas, ninguno.
    this.pois = projectPois().map((p) => ({ ...p, edges: this.sim.edgesNear(p) })).filter((p) => p.edges.length >= CONFIG.pois.minEdges);
    // Cada lugar es un destino propio (como las sedes de los eventos): los coches van al lugar, no a la zona de la
    // cuadrícula más cercana, que podía estar a 500 m.
    // Varios destinos por lugar, repartidos por su área (con uno solo, todos iban al mismo cruce y lo bloqueaban).
    for (const p of this.pois) {
      p.points = [];
      const n = Math.min(CONFIG.pois.maxPoints, Math.max(1, Math.round((Math.PI * p.radius ** 2) / CONFIG.pois.pointSpacing ** 2)));
      for (let k = 0; k < n; k++) {
        // Puntos en espiral dentro del radio (deterministas).
        const r = p.radius * Math.sqrt((k + 0.5) / n) * 0.8;
        const a = k * 2.399963;
        const key = `${p.id}#${k}`;
        if (this.sim.trips?.addPoint(key, p.x + r * Math.cos(a), p.z + r * Math.sin(a)) >= 0) p.points.push(key);
      }
    }
    this.sim.trips?.setZoneFactors();
    this.pedEdgeWeight = weights.edge;
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
  setBusFleet(lineId, count, options) {
    const li = this.transit.lines.findIndex((l) => l.id === lineId);
    if (li < 0) return false;
    this.buses.setFleet(li, count, { now: this.simTime, ...options });
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
      this.buses.tick(this.simTime);
      this.updateEnvironment();
      // Más los que dan vueltas buscando aparcamiento porque los parkings de su zona están llenos.
      this.sim.setTarget(this.params.maxCars * Math.max(0, demandFactor(this.simTime, this.params.scenario) - this.eventCarCut) * this.carFactor + this.lots.searching * CONFIG.parking.searchCars);
      this.sim.step(STEP);
      this.sensors.tick(this.simTime);
      this.lots.tick(this.simTime);
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
    // Con las calles de la sede cortadas o los parkings de alrededor caros, parte de la gente del evento no viene en
    // coche: va andando o en autobús.
    this.eventCarCut = 0;
    this.buses.eventAccess = new Map();
    for (const a of this.sim.attractors) {
      const keep = 1 - this.lots.eventShift(a.x, a.z);
      a.weight *= keep;
      a.pull *= keep;
      const access = a.access * keep;
      this.eventCarCut += a.base * (1 - access);
      this.buses.eventAccess.set(a.id, access);
    }
    // Parkings caros: parte de la gente deja el coche y va en autobús, en bici o andando.
    const P = CONFIG.parking;
    this.priceShift = Math.min(P.maxShift, P.shiftPerPremium * this.lots.pricePremium());
    this.bikes.extraDemand = 1 + this.priceShift * P.toBikes;
    this.signals.setPedestrianLoad(pedestrianLoad(minute * 60, this.params.scenario, this.params.maxPedestrians) * (1 + this.priceShift * P.toWalk));
    this.updateTransit(minute * 60);
    this.updatePois(minute * 60);
    // Rutas con el tráfico de ahora: cada minuto, los tiempos de cada tramo; cada `refreshMinutes`, los caminos.
    if (this.sim.trips) {
      this.sim.updateCongestion(minute);
      if (minute % CONFIG.trips.refreshMinutes === 0) this.sim.refreshRoutes();
    }
  }

  // Cada minuto: cuánto atrae cada lugar de interés como destino y cuánta gente sale de él (hora, tipo de día, tiempo).
  updatePois(seconds) {
    const trips = this.sim.trips;
    if (!trips || !this.pois.length) return;
    const unit = trips.meanZoneWeight() * CONFIG.pois.pointWeight;
    const weights = new Map();
    const origins = [];
    const byKind = new Map();
    for (const p of this.pois) {
      if (!byKind.has(p.kind)) byKind.set(p.kind, poiStrength(p.kind, seconds, this.params.scenario));
      const { to, from } = byKind.get(p.kind);
      for (const key of p.points) weights.set(key, (to * unit * p.size) / p.points.length);
      if (from > 0) origins.push({ edges: p.edges, weight: from * CONFIG.pois.spawnShare });
    }
    trips.setZoneFactors(null, weights);
    this.sim.origins = origins;
  }

  // Autobuses, cada minuto: las calles cortadas pasan gente del coche al autobús; quien no cabe en el autobús o se
  // cansa de esperar coge el coche; y se cuentan las horas de autobús en servicio del día frente a las de la flota
  // inicial (las que entran en el precio; las de más son sobrecoste).
  updateTransit(seconds) {
    const T = CONFIG.transit;
    const c = T.closures;
    const closedKm = Math.min(c.maxKm, this.restrictedKm());
    this.buses.extraDemand = (1 + c.transitPerKm * closedKm) * (1 + (this.priceShift ?? 0) * CONFIG.parking.toTransit);
    this.buses.updateAt(seconds, this.params.scenario, this.scale);
    this.unserved = this.buses.unservedShare();
    // Por debajo de `modeShiftFrom` (gente que se queda en tierra de vez en cuando en hora punta) no cambia nada: así un
    // servicio normal no perturba el tráfico.
    const shifted = Math.max(0, this.unserved - T.modeShiftFrom) / (1 - T.modeShiftFrom);
    this.carFactor = (1 - c.carsPerKm * closedKm) * (1 - (this.priceShift ?? 0)) * (1 + T.modeShift * shifted);

    const day = Math.floor(seconds / 86400);
    if (day !== this.busDay.day) this.busDay = { day, used: 0, included: 0 };
    const service = T.minService + (1 - T.minService) * this.buses.demand;
    let active = 0;
    for (const s of this.buses.stats) active += s.active;
    let included = 0;
    for (const f of this.buses.defaultFleet) included += Math.min(f, Math.ceil(f * service));
    this.busDay.used += active / 60;
    this.busDay.included += included / 60;
  }

  // Km de calles cortadas o restringidas (un límite de entrada cuenta la mitad).
  restrictedKm() {
    let m = 0;
    for (const item of this.restrictions.items) m += this.restrictions.lengthOf(item.edges) * (item.mode === 'entry_limit' ? 0.5 : 1);
    return m / 1000;
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
    const fullLots = this.lots.fullCount();
    return {
      cars: traffic.active,
      stopped: traffic.stopped,
      avg_speed_kmh: Math.round(traffic.avgKmh * 10) / 10,
      buses: sum('active'),
      bus_passengers: sum('passengers'),
      full_buses: sum('full'),
      bus_waiting: sum('waiting'),
      bus_demand: Math.round(this.buses.riders()),
      // Gente que quería subir y no ha podido (no cabía o se ha cansado de esperar).
      bus_unserved: Math.round(lines.reduce((acc, s, li) => acc + s.demanded * this.buses.unservedOf(li), 0)),
      suspended_lines: this.buses.suspended.filter(Boolean).length,
      bikes_in_use: bikes.inUse,
      stations_empty: bikes.stations.filter((s) => s.available <= 0).length,
      stations_full: bikes.stations.filter((s) => s.available >= s.capacity).length,
      parkings_full: fullLots,
      parking_search: Math.round(this.lots.searching), // coches dando vueltas porque no encuentran sitio
      parking_premium: Math.round(this.lots.pricePremium() * 100) / 100, // cuánto más caros que el precio base, de media
      closed_m: Math.round(metres.closed),
      bus_only_m: Math.round(metres.busOnly),
      limited_m: Math.round(metres.limited),
      signals_all_red: this.signals.signals.filter((sig) => sig.active && this.signals.modeOf(sig) === 'all_red').length,
      ...this.pedestrianWaitRow(time),
      ...this.cityStats.tripsSince(this.sim.tripTotals),
    };
  }

  // Peatones en los cruces con semáforo: espera media (s) y gente esperando ahora.
  pedestrianWaitRow(time) {
    const { meanWait, waiting } = this.signals.pedestrianWait(time);
    return { ped_wait_s: Math.round(meanWait * 10) / 10, ped_waiting: Math.round(waiting), ped_space: Math.round(this.pedestrianSpace() * 100) / 100 };
  }

  // Espacio ganado por los peatones: km de calle sin coches × lo concurrida que es × cuánta gente hay en la calle. Una
  // calle peatonal concurrida del centro con buen tiempo cuenta mucho; una calle vacía de las afueras de noche, casi nada.
  pedestrianSpace() {
    const g = this.graph;
    const share = CONFIG.pedestrians.spaceShare;
    const seen = new Uint8Array(g.edgeCount);
    // Junto a un evento en marcha, la calle sin coches vale mucho más: es donde está la gente.
    const crowd = new Map();
    for (const a of this.sim.attractors) {
      for (const e of a.edges) crowd.set(e, (crowd.get(e) ?? 0) + CONFIG.pedestrians.eventSpace * a.base);
    }
    let sum = 0;
    for (const item of this.restrictions.items) {
      const f = share[item.mode] ?? 0;
      if (!f) continue;
      for (const e of item.edges) {
        if (seen[e]) continue;
        seen[e] = 1;
        if (g.rev[e] >= 0) seen[g.rev[e]] = 1; // las calles de doble sentido cuentan una vez
        sum += g.len[e] * this.pedEdgeWeight[e] * f * (1 + (crowd.get(e) ?? 0));
      }
    }
    return (sum / 1000) * this.signals.pedestrianLoad;
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
      lots: this.lots.serialize(),
      pedSensors: this.pedSensors.serialize(),
      buses: this.busTracker.serialize(),
      bikes: this.bikes.serialize(),
      city: this.cityStats.serialize(),
      fleet: Object.fromEntries(this.transit.lines.map((l) => [l.id, l.buses])),
      pendingFleet: Object.fromEntries(this.transit.lines.map((l, li) => [l.id, this.buses.pendingOf(li)])),
      busDay: { ...this.busDay },
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
    this.lots.restore(state.lots);
    this.pedSensors.restore(state.pedSensors, this.simTime);
    if (state.buses) this.busTracker.restore(state.buses); // los snapshots anteriores a los autobuses no lo traen
    if (state.bikes) this.bikes.restore(state.bikes);
    // Snapshots anteriores al histórico global: empieza en el siguiente intervalo.
    if (state.city) this.cityStats.restore(state.city);
    else this.cityStats.nextSample = Math.ceil(this.simTime / this.cityStats.intervalSeconds) * this.cityStats.intervalSeconds;
    for (const [id, count] of Object.entries(state.fleet ?? {})) {
      try {
        this.setBusFleet(id, count, { limit: false });
      } catch {
        // flota fuera del rango actual: se queda la de por defecto
      }
    }
    this.transit.lines.forEach((l, li) => this.buses.restorePending(li, state.pendingFleet?.[l.id]));
    if (state.busDay) this.busDay = { ...state.busDay };
    // Un reparto guardado que ya no cabe en la flota total (p. ej. de antes de que la flota fuera fija): la de por defecto.
    if (this.buses.reserve() < 0) this.buses.lines.forEach((_, li) => this.buses.setFleet(li, this.buses.defaultFleet[li], { limit: false }));
    this.carFactor = 1;
    const compatible = state.graphKey === this.graphKey;
    if (compatible && state.restrictions) this.restrictions.restore(state.restrictions);
    if (compatible) this.sim.restore(state.sim);
    this.signals.update(this.simTime);
    return compatible;
  }
}
