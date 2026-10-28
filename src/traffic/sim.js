import { CONFIG } from '../config.js';
import { createRng } from '../core/random.js';
import { fromBase64, toBase64 } from '../core/binary.js';

const C = CONFIG.cars;

export class TrafficSim {
  constructor(graph, signals, onCross, { rng = createRng(CONFIG.sim.seed) } = {}) {
    this.g = graph;
    this.signals = signals;
    this.onCross = onCross;
    this.rng = rng;
    const n = C.max;
    this.edge = new Int32Array(n);
    this.pos = new Float32Array(n);
    this.speed = new Float32Array(n);
    this.factor = new Float32Array(n);
    this.next = new Int32Array(n * 3).fill(-1);
    this.stuck = new Float32Array(n);
    this.edgeCars = new Array(graph.edgeCount);
    this.sensorsByEdge = new Map();
    this.activeCount = 0;
    this.targetCount = 0;
    for (let i = 0; i < n; i++) this.factor[i] = 0.85 + this.rng() * 0.25;
  }

  setSensorIndex(map) {
    this.sensorsByEdge = map;
  }

  // Estado completo de los coches y del PRNG para reanudar la simulación exactamente.
  serialize() {
    const n = this.activeCount;
    return {
      activeCount: n,
      targetCount: this.targetCount,
      rng: this.rng.getState(),
      edge: toBase64(this.edge.subarray(0, n)),
      pos: toBase64(this.pos.subarray(0, n)),
      speed: toBase64(this.speed.subarray(0, n)),
      next: toBase64(this.next.subarray(0, n * 3)),
      factor: toBase64(this.factor),
      stuck: toBase64(this.stuck.subarray(0, n)),
    };
  }

  // Posición actual de los coches (sin el estado interno) para que un visor los dibuje.
  positions() {
    const n = this.activeCount;
    return {
      activeCount: n,
      edge: toBase64(this.edge.subarray(0, n)),
      pos: toBase64(this.pos.subarray(0, n)),
      speed: toBase64(this.speed.subarray(0, n)),
    };
  }

  restore(state) {
    const n = state.activeCount;
    this.edge.set(fromBase64(state.edge, Int32Array));
    this.pos.set(fromBase64(state.pos, Float32Array));
    this.speed.set(fromBase64(state.speed, Float32Array));
    this.next.set(fromBase64(state.next, Int32Array));
    this.factor.set(fromBase64(state.factor, Float32Array));
    this.stuck.fill(0);
    if (state.stuck) this.stuck.set(fromBase64(state.stuck, Float32Array));
    this.edgeCars = new Array(this.g.edgeCount);
    this.activeCount = n;
    this.targetCount = state.targetCount;
    for (let i = 0; i < n; i++) this.place(i, this.edge[i]);
    this.rng.setState(state.rng);
  }

  setTarget(n) {
    this.targetCount = Math.max(0, Math.min(C.max, Math.round(n)));
  }

  randomEdge() {
    const g = this.g;
    for (let tries = 0; tries < 6; tries++) {
      const e = (this.rng() * g.edgeCount) | 0;
      if (this.rng() * 5 < 5 - g.cls[e] || tries === 5) return e;
    }
    return 0;
  }

  chooseNext(e) {
    if (e < 0) return -1;
    const g = this.g;
    const node = g.B[e];
    const rev = g.rev[e];
    let total = 0;
    let fallback = -1;
    const start = g.outStart[node];
    const end = g.outStart[node + 1];
    for (let k = start; k < end; k++) {
      const c = g.outList[k];
      if (c === rev) {
        fallback = c;
        continue;
      }
      total += this.weight(e, c);
    }
    if (total === 0) return fallback;
    let r = this.rng() * total;
    for (let k = start; k < end; k++) {
      const c = g.outList[k];
      if (c === rev) continue;
      r -= this.weight(e, c);
      if (r <= 0) return c;
    }
    return fallback;
  }

  weight(e, c) {
    const g = this.g;
    const dot = g.ux[e] * g.ux[c] + g.uz[e] * g.uz[c];
    return (1 + 3 * Math.max(0, dot)) * (5 - g.cls[c]);
  }

  place(i, e) {
    const list = (this.edgeCars[e] ??= []);
    list.push(i);
    this.edge[i] = e;
  }

  detach(i) {
    const list = this.edgeCars[this.edge[i]];
    if (!list) return;
    const k = list.indexOf(i);
    if (k >= 0) {
      list[k] = list[list.length - 1];
      list.pop();
    }
  }

  spawn(i) {
    const e = this.randomEdge();
    this.place(i, e);
    this.pos[i] = this.rng() * this.g.len[e];
    this.speed[i] = 0;
    this.stuck[i] = 0;
    const n0 = this.chooseNext(e);
    const n1 = this.chooseNext(n0);
    const n2 = this.chooseNext(n1);
    this.next[i * 3] = n0;
    this.next[i * 3 + 1] = n1;
    this.next[i * 3 + 2] = n2;
  }

  adjustPopulation() {
    for (let k = 0; k < 20 && this.activeCount !== this.targetCount; k++) {
      if (this.activeCount < this.targetCount) {
        this.spawn(this.activeCount++);
      } else {
        this.detach(--this.activeCount);
      }
    }
  }

  // Un coche de fuera solo entra en la rotonda si no llega por el anillo otro coche que vaya a pasar por la entrada.
  canEnter(entry) {
    return !this.ringTraffic(entry, entry, CONFIG.roundabouts.yieldDistance);
  }

  // Hay un coche del anillo que pasará por `target` y está a menos de `budget` metros del inicio de `e`.
  ringTraffic(target, e, budget) {
    const g = this.g;
    const feeders = g.ringIn[e];
    if (!feeders) return false;
    for (const f of feeders) {
      const list = this.edgeCars[f];
      if (list) {
        for (const j of list) {
          if (g.len[f] - this.pos[j] < budget && this.heads(j, target)) return true;
        }
      }
      if (g.len[f] < budget && this.ringTraffic(target, f, budget - g.len[f])) return true;
    }
    return false;
  }

  // La ruta conocida del coche pasa por `edge` (un coche que sale de la rotonda antes no estorba).
  heads(i, edge) {
    return this.next[i * 3] === edge || this.next[i * 3 + 1] === edge || this.next[i * 3 + 2] === edge;
  }

  // Distancia libre hasta el primer obstáculo (coche delante, semáforo no verde o entrada a rotonda sin hueco).
  freeGap(i) {
    const g = this.g;
    const sig = this.signals;
    let e = this.edge[i];
    const p = this.pos[i];
    const v = this.speed[i];
    let gap = Infinity;

    const own = this.edgeCars[e];
    for (let k = 0; k < own.length; k++) {
      const j = own[k];
      if (j !== i && this.pos[j] > p) {
        const d = this.pos[j] - p - C.length;
        if (d < gap) gap = d;
      }
    }

    let dist = g.len[e] - p;
    for (let step = 0; ; step++) {
      const state = sig.stateForEdge(e);
      if (state !== 0) {
        const stopDist = dist - C.stopGap;
        if (stopDist >= -1) {
          const mustStop = state === 2 || stopDist > (v * v) / (2 * 6);
          if (mustStop && stopDist < gap) gap = Math.max(0, stopDist);
        }
      }
      const entering = step < 3 && dist <= C.lookAhead ? this.next[i * 3 + step] : -1;
      if (entering >= 0 && g.ringId && g.ringId[entering] >= 0 && g.ringId[e] < 0 && !this.canEnter(entering)) {
        const stopDist = dist - C.stopGap;
        if (stopDist >= -1 && stopDist < gap) gap = Math.max(0, stopDist);
      }
      if (step === 3 || dist > C.lookAhead || gap < dist) break;
      const ne = this.next[i * 3 + step];
      if (ne < 0) break;
      const list = this.edgeCars[ne];
      if (list) {
        let minPos = Infinity;
        for (let k = 0; k < list.length; k++) if (this.pos[list[k]] < minPos) minPos = this.pos[list[k]];
        if (minPos !== Infinity) {
          const d = dist + minPos - C.length;
          if (d < gap) gap = d;
          break;
        }
      }
      dist += g.len[ne];
      e = ne;
    }
    return gap;
  }

  step(dt) {
    this.adjustPopulation();
    const g = this.g;
    for (let i = 0; i < this.activeCount; i++) {
      const gap = this.freeGap(i);
      const e0 = this.edge[i];
      const vmax = g.speed[e0] * this.factor[i];
      const safe = gap === Infinity ? vmax : Math.sqrt(2 * C.decel * Math.max(0, gap - C.minGap));
      const v = Math.max(0, Math.min(this.speed[i] + C.accel * dt, vmax, safe));
      this.speed[i] = v;
      if (v < 0.5) {
        this.stuck[i] += dt;
        if (this.stuck[i] > C.stuckSeconds) {
          this.detach(i);
          this.spawn(i);
          continue;
        }
      } else {
        this.stuck[i] = 0;
      }
      this.advance(i, v * dt, v);
    }
  }

  advance(i, distance, v) {
    const g = this.g;
    let e = this.edge[i];
    let p = this.pos[i];
    let remaining = distance;
    while (p + remaining >= g.len[e]) {
      this.checkSensors(e, p, g.len[e], v);
      remaining -= g.len[e] - p;
      const ne = this.next[i * 3];
      if (ne < 0) {
        this.detach(i);
        this.spawn(i);
        return;
      }
      this.detach(i);
      this.place(i, ne);
      const n1 = this.next[i * 3 + 1];
      this.next[i * 3] = n1;
      this.next[i * 3 + 1] = this.next[i * 3 + 2];
      this.next[i * 3 + 2] = this.chooseNext(n1 >= 0 ? this.next[i * 3 + 1] : -1);
      e = ne;
      p = 0;
    }
    const np = p + remaining;
    this.checkSensors(e, p, np, v);
    this.pos[i] = np;
  }

  checkSensors(e, from, to, v) {
    const list = this.sensorsByEdge.get(e);
    if (!list) return;
    for (const entry of list) {
      if (entry.s > from && entry.s <= to) this.onCross(entry.sensor, entry.dir, v);
    }
  }

  stats() {
    let sum = 0;
    let stopped = 0;
    for (let i = 0; i < this.activeCount; i++) {
      sum += this.speed[i];
      if (this.speed[i] < 0.5) stopped++;
    }
    return {
      active: this.activeCount,
      avgKmh: this.activeCount ? (sum / this.activeCount) * 3.6 : 0,
      stopped,
    };
  }
}
