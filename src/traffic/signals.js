import * as THREE from 'three';
import { CONFIG } from '../config.js';

const STATE_COLORS = [0x22dd55, 0xffcc00, 0xff2a2a];

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
      default: { green: d.green ?? CONFIG.signals.green, yellow: d.yellow ?? CONFIG.signals.yellow, greenA: d.greenA, greenB: d.greenB },
      signals: plan.signals ?? {},
    };
  }

  timing(s) {
    const p = { ...this.plan.default, ...(this.plan.signals[s.id] ?? {}) };
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || lo));
    const gA = clamp(p.greenA ?? p.green, 5, 180);
    const gB = clamp(p.greenB ?? p.green, 5, 180);
    const y = clamp(p.yellow, 1, 10);
    return { gA, gB, y };
  }

  update(simTime) {
    for (let i = 0; i < this.signals.length; i++) {
      const s = this.signals[i];
      if (!s.active) continue;
      const { gA, gB, y } = this.timing(s);
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

// Una esfera por aproximación regulada, junto a la línea de parada.
export function createSignalViz(controller) {
  const g = controller.graph;
  const items = [];
  controller.signals.forEach((s, i) => {
    if (!s.active) return;
    for (const e of s.approaches) items.push({ s: i, group: g.grp[e], e });
  });
  const geometry = new THREE.SphereGeometry(2, 8, 6);
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, items.length));
  mesh.count = items.length;
  const m = new THREE.Matrix4();
  const color = new THREE.Color(STATE_COLORS[2]);
  items.forEach(({ e }, k) => {
    const b = g.B[e];
    m.makeTranslation(g.nx[b] - g.uz[e] * 4, 8, g.nz[b] + g.ux[e] * 4);
    mesh.setMatrixAt(k, m);
    mesh.setColorAt(k, color);
  });
  mesh.frustumCulled = false;

  const update = () => {
    items.forEach(({ s, group }, k) => {
      color.setHex(STATE_COLORS[controller.states[s * 2 + group]]);
      mesh.setColorAt(k, color);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };
  return { mesh, update, signalIds: items.map(({ s }) => controller.signals[s].id) };
}
