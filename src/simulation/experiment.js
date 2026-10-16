import { CONFIG } from '../config.js';
import { createSeededRandom } from './random.js';

export function validateExperiment(input) {
  const settings = { seed: Number(input.seed), scenario: input.scenario,
    maxCars: Number(input.maxCars), durationMinutes: Number(input.durationMinutes),
    green: Number(input.green) };
  const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  if (!integer(settings.seed, 0, 0xffffffff)) throw new Error('Semilla: entero entre 0 y 4294967295.');
  if (!['weekday', 'weekend'].includes(settings.scenario)) throw new Error('Selecciona laborable o fin de semana.');
  if (!integer(settings.maxCars, 0, CONFIG.cars.max)) throw new Error(`Coches: entero entre 0 y ${CONFIG.cars.max}.`);
  if (!integer(settings.durationMinutes, 1, 1440)) throw new Error('Duración: entre 1 y 1440 minutos.');
  if (!integer(settings.green, 5, 180)) throw new Error('Verde: entre 5 y 180 segundos.');
  return settings;
}

export class Experiment {
  constructor({ clock, params, sim, signals, sensors, datasetId }) {
    Object.assign(this, { clock, params, sim, signals, sensors, datasetId });
    this.status = 'idle';
    this.result = null;
  }

  start(input) {
    const settings = validateExperiment(input);
    this.settings = settings;
    this.result = null;
    this.startTime = CONFIG.sim.startSeconds;
    this.endTime = this.startTime + settings.durationMinutes * 60;
    this.clock.simTime = this.startTime;
    this.clock.scale = 60;
    Object.assign(this.params, { maxCars: settings.maxCars, scenario: settings.scenario });
    this.signals.setGlobalGreen(settings.green, CONFIG.signals.yellow);
    this.signals.update(this.startTime);
    this.sim.reset(createSeededRandom(settings.seed));
    this.sensors.resetMeasurements(this.startTime);
    this.samples = 0;
    this.activeSum = this.stoppedSum = this.speedSum = 0;
    this.snapshot = {
      version: 1, simulationVersion: 2, dataOrigin: 'simulated', datasetId: this.datasetId,
      municipalSpeedLimits: structuredClone(this.sim.g.municipalContext ?? null),
      settings: structuredClone(settings), startSeconds: this.startTime,
      baseDate: new Date(CONFIG.sim.baseDate).toISOString(), stepSeconds: CONFIG.sim.step,
      traffic: structuredClone(CONFIG.traffic), cars: structuredClone(CONFIG.cars),
      signalPlan: structuredClone(this.signals.plan), bucketSeconds: this.sensors.bucketSeconds,
      sensors: this.sensors.sensors.map(({ id, name, x, z }) => ({ id, name, x, z })),
    };
    this.status = 'running';
  }

  afterStep() {
    if (this.status !== 'running') return;
    const stats = this.sim.stats();
    this.samples++;
    this.activeSum += stats.active;
    this.stoppedSum += stats.stopped;
    this.speedSum += stats.avgKmh;
    if (this.clock.simTime >= this.endTime) this.finish('completed');
  }

  finish(status = 'cancelled') {
    if (this.status !== 'running') return;
    this.clock.scale = 0;
    this.status = status;
    this.result = {
      ...this.snapshot, status, elapsedSeconds: this.clock.simTime - this.startTime,
      summary: {
        samples: this.samples,
        meanActiveVehicles: this.samples ? this.activeSum / this.samples : 0,
        meanStoppedVehicles: this.samples ? this.stoppedSum / this.samples : 0,
        meanSpeedKmh: this.samples ? this.speedSum / this.samples : 0,
        sensorCrossings: this.sensors.sensors.reduce((n, s) => n + s.total, 0),
      },
      records: structuredClone(this.sensors.records),
      partialSensorBuckets: this.sensors.sensors.map(s => ({
        id: s.id, name: s.name, startSeconds: this.sensors.bucketStart,
        endSeconds: this.clock.simTime, ...s.bucket,
      })),
    };
  }
}
