import { CONFIG } from '../config.js';
import { simDate } from './demand.js';

const EMPTY_SCHEDULE = [];

function parseMinutes(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

function scheduleMatches(rule, date) {
  const when = rule?.when ?? {};
  const hasStart = when.start !== undefined;
  const hasEnd = when.end !== undefined;
  if (hasStart !== hasEnd) return false;

  let ruleDate = date;
  if (hasStart) {
    const start = parseMinutes(when.start);
    const end = parseMinutes(when.end);
    if (start === null || end === null || start === end) return false;
    const minute = date.getUTCHours() * 60 + date.getUTCMinutes();
    const overnight = start > end;
    const inRange = overnight ? minute >= start || minute < end : minute >= start && minute < end;
    if (!inRange) return false;
    if (overnight && minute < end) ruleDate = new Date(date.getTime() - 86400000);
  }

  const includes = (values, value) => values === undefined || (Array.isArray(values) && values.includes(value));
  const dateKey = ruleDate.toISOString().slice(0, 10);
  return includes(when.weekdays, ruleDate.getUTCDay())
    && includes(when.months, ruleDate.getUTCMonth() + 1)
    && includes(when.daysOfMonth, ruleDate.getUTCDate())
    && includes(when.years, ruleDate.getUTCFullYear())
    && includes(when.dates, dateKey);
}

export const SIGNAL_MODES = ['normal', 'off', 'flashing', 'all_red'];

// Estados por grupo: 0 verde, 1 ámbar, 2 rojo, 3 sin regular. Grupo 0 = aproche E-O, grupo 1 = aproche N-S.
// Modos: normal (ciclo); off (apagado) y flashing (ámbar intermitente) dejan el cruce sin regular: los coches frenan,
// ceden el paso a la calle con prioridad y esperan a que crucen los peatones. En ámbar el peatón tiene prioridad (cruza
// al llegar); apagado, cruza cuando hay hueco y ocupa menos el paso. all_red lo detiene todo.
export const UNCONTROLLED = 3;
const U = CONFIG.signals.unsignalized;
export class SignalController {
  constructor(graph) {
    this.graph = graph;
    this.signals = graph.signals;
    this.byId = new Map(this.signals.map((s) => [s.id, s]));
    this.states = new Uint8Array(this.signals.length * 2);
    this.plan = { default: { green: CONFIG.signals.green, yellow: CONFIG.signals.yellow }, signals: {} };
    this.offsets = this.signals.map((s) => (Math.imul(s.id, 2654435761) >>> 0) % 1000 / 1000);
    this.now = 0;
    this.pedestrianLoad = 0; // cuánta gente hay en la calle (0..1)
  }

  // Cuánta gente hay en la calle (0..1, como la densidad de peatones): decide cuánto rato ocupan los pasos sin regular.
  setPedestrianLoad(density) {
    this.pedestrianLoad = Math.max(0, Math.min(1, density));
  }

  // Fracción del tiempo con peatones cruzando en el cruce sin regular `s` (más en ámbar, donde tienen prioridad).
  pedestrianShare(s) {
    const mode = this.modeOf(this.signals[s]);
    return (U.pedestrianShare[mode] ?? U.pedestrianShare.off) * this.pedestrianLoad;
  }

  // Ventana en que cruzan los peatones en el cruce sin regular `s` que empieza en `from` o la siguiente:
  // { start, length, current }, como las ventanas de rojo de un semáforo que funciona.
  pedestrianWindow(s, from) {
    const period = U.pedestrianPeriod;
    const length = this.pedestrianShare(s) * period;
    const shift = this.offsets[s] * period;
    const phase = (((from - shift) % period) + period) % period;
    if (phase < length) return { start: from - phase, length, current: true };
    return { start: from + period - phase, length, current: false };
  }

  // Hay peatones cruzando ahora en el cruce sin regular `s`.
  crossingBusy(s) {
    return this.pedestrianLoad > 0 && this.pedestrianWindow(s, this.now).current;
  }

  // Peatones en los cruces con semáforo ahora: espera media de quien llega a cruzar (s) y gente esperando.
  pedestrianWait(simTime = this.now) {
    const W = CONFIG.signals.pedestrianWait;
    const date = simDate(simTime);
    let sum = 0;
    let n = 0;
    for (const s of this.signals) {
      if (!s.active) continue;
      const mode = this.modeOf(s);
      let wait;
      if (mode === 'all_red') wait = W.maxSeconds;
      else if (mode !== 'normal') wait = W.unsignalized[mode] ?? W.unsignalized.off;
      else {
        // Cada sentido de cruce va con el verde de los coches que circulan en paralelo: su rojo es el resto del ciclo.
        const { gA, gB, y } = this.timing(s, simTime, date);
        const cycle = gA + gB + 2 * y;
        const side = (green) => Math.min(W.maxSeconds, (cycle - green) ** 2 / (2 * cycle));
        wait = (side(gA) + side(gB)) / 2;
      }
      sum += wait;
      n++;
    }
    const meanWait = n ? sum / n : 0;
    return { meanWait, waiting: W.arrivalsPerSecond * this.pedestrianLoad * meanWait * n };
  }

  setGlobalGreen(green, yellow = this.plan.default.yellow) {
    this.plan = { default: { green, yellow }, signals: {} };
  }

  setSignalTiming(id, timing) {
    this.plan.signals[id] = { ...(this.plan.signals[id] ?? {}), ...timing };
  }

  // Sustituye los ajustes del semáforo `id` por `settings` ({} los borra y vuelve al plan por defecto).
  setSignalOverride(id, settings) {
    if (Object.keys(settings).length) this.plan.signals[id] = settings;
    else delete this.plan.signals[id];
  }

  modeOf(s) {
    return this.plan.signals[s.id]?.mode ?? this.plan.default.mode ?? 'normal';
  }

  // Formato: { default: {green, yellow}, signals: { "<osmId>": {green | greenA, greenB, yellow} } }
  setPlan(plan) {
    const d = plan.default ?? {};
    this.plan = {
      default: { ...d, green: d.green ?? CONFIG.signals.green, yellow: d.yellow ?? CONFIG.signals.yellow },
      signals: plan.signals ?? {},
    };
  }

  timing(s, simSeconds = CONFIG.sim.startSeconds, date = simDate(simSeconds)) {
    const override = this.plan.signals[s.id] ?? {};
    const signalSchedule = Array.isArray(override.schedule) ? override.schedule : EMPTY_SCHEDULE;
    const defaultSchedule = Array.isArray(this.plan.default.schedule) ? this.plan.default.schedule : EMPTY_SCHEDULE;
    let rule;
    for (const entry of signalSchedule) {
      if (scheduleMatches(entry, date)) {
        rule = entry;
        break;
      }
    }
    if (!rule) {
      for (const entry of defaultSchedule) {
        if (scheduleMatches(entry, date)) {
          rule = entry;
          break;
        }
      }
    }
    const p = { ...this.plan.default, ...override };
    if (rule?.green !== undefined) {
      p.green = rule.green;
      p.greenA = rule.greenA;
      p.greenB = rule.greenB;
    }
    Object.assign(p, rule);
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || lo));
    const gA = clamp(p.greenA ?? p.green, 5, 180);
    const gB = clamp(p.greenB ?? p.green, 5, 180);
    const y = clamp(p.yellow, ...CONFIG.signals.yellowRange);
    return { gA, gB, y };
  }

  update(simTime) {
    this.now = simTime;
    const date = simDate(simTime);
    for (let i = 0; i < this.signals.length; i++) {
      const s = this.signals[i];
      if (!s.active) continue;
      const mode = this.modeOf(s);
      if (mode !== 'normal') {
        this.states[i * 2] = this.states[i * 2 + 1] = mode === 'all_red' ? 2 : UNCONTROLLED;
        continue;
      }
      const { gA, gB, y } = this.timing(s, simTime, date);
      const cycle = gA + gB + 2 * y;
      const t = (simTime + this.offsets[i] * cycle) % cycle;
      // Al empezar cada verde, unos segundos en rojo para todos (despeje del cruce y arranque): es el tiempo que se
      // pierde en cada cambio de fase, así que un ciclo muy corto deja pasar menos coches.
      const lost = CONFIG.signals.lostSeconds ?? 0;
      const lostA = Math.min(lost, gA - 1);
      const lostB = Math.min(lost, gB - 1);
      let a = 2;
      let b = 2;
      if (t < gA) a = t < lostA ? 2 : 0;
      else if (t < gA + y) a = 1;
      else if (t < gA + y + gB) b = t - gA - y < lostB ? 2 : 0;
      else b = 1;
      this.states[i * 2] = a;
      this.states[i * 2 + 1] = b;
    }
  }

  // Estado que ve un coche al final de la arista e.
  stateForEdge(e) {
    const s = this.graph.sig[e];
    if (s < 0 || !this.signals[s].active) return 0;
    return this.states[s * 2 + this.graph.grp[e]];
  }
}
