import * as THREE from 'three';
import { CONFIG } from '../config.js';

const C = CONFIG.cars;

// Representación 3D de los coches de un TrafficSim (el núcleo no depende de THREE).
export class CarView {
  constructor(sim) {
    this.sim = sim;
    const n = C.max;
    const geometry = new THREE.SphereGeometry(C.radius, 8, 6);
    this.mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    const color = new THREE.Color(1, 1, 1);
    for (let i = 0; i < n; i++) {
      this.mesh.setMatrixAt(i, new THREE.Matrix4().identity());
      this.mesh.setColorAt(i, color);
    }
  }

  render() {
    const sim = this.sim;
    const g = sim.g;
    const m = this.mesh.instanceMatrix.array;
    const c = this.mesh.instanceColor.array;
    const n = sim.activeCount;
    for (let i = 0; i < n; i++) {
      const e = sim.edge[i];
      const a = g.A[e];
      const p = sim.pos[i];
      const ux = g.ux[e];
      const uz = g.uz[e];
      const o = i * 16;
      m[o] = 1; m[o + 5] = 1; m[o + 10] = 1; m[o + 15] = 1;
      m[o + 12] = sim.rx ? sim.rx[i] : g.nx[a] + ux * p - uz * C.laneOffset;
      m[o + 13] = C.radius;
      m[o + 14] = sim.rz ? sim.rz[i] : g.nz[a] + uz * p + ux * C.laneOffset;
      const ratio = Math.min(1, sim.speed[i] / (g.speed[e] * 0.8));
      c[i * 3] = 0.95 - 0.75 * ratio;
      c[i * 3 + 1] = 0.15 + 0.7 * ratio;
      c[i * 3 + 2] = 0.12 + 0.25 * ratio;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}
