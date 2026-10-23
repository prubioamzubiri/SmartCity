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

// Estados por grupo: 0 verde, 1 ámbar, 2 rojo. Grupo 0 = aproche E-O, grupo 1 = aproche N-S.
export class SignalController {
  constructor(graph) {
    this.graph = graph;
    this.signals = graph.signals;
    this.states = new Uint8Array(this.signals.length * 2);
    this.plan = { default: { green: CONFIG.signals.green, yellow: CONFIG.signals.yellow }, signals: {} };
    this.offsets = this.signals.map((s) => (Math.imul(s.id, 2654435761) >>> 0) % 1000 / 1000);
  }

  setGlobalGreen(green, yellow = this.plan.default.yellow) {
    this.plan = { default: { green, yellow }, signals: {} };
  }

  setSignalTiming(id, timing) {
    this.plan.signals[id] = { ...(this.plan.signals[id] ?? {}), ...timing };
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
    const y = clamp(p.yellow, 1, 10);
    return { gA, gB, y };
  }

  update(simTime) {
    const date = simDate(simTime);
    for (let i = 0; i < this.signals.length; i++) {
      const s = this.signals[i];
      if (!s.active) continue;
      const { gA, gB, y } = this.timing(s, simTime, date);
      const cycle = gA + gB + 2 * y;
      const t = (simTime + this.offsets[i] * cycle) % cycle;
      let a = 2;
      let b = 2;
      if (t < gA) a = 0;
      else if (t < gA + y) a = 1;
      else if (t < gA + y + gB) b = 0;
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
