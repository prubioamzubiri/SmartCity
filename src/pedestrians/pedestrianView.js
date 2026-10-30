import * as THREE from 'three';
import { CONFIG } from '../config.js';

const P = CONFIG.pedestrians;

// Triángulos planos sobre el suelo, uno por peatón activo.
export class PedestrianView {
  constructor(pedestrians) {
    this.pedestrians = pedestrians;
    const l = P.size;
    const w = P.size * 0.6;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([l / 2, 0, 0, -l / 2, 0, -w / 2, -l / 2, 0, w / 2], 3));
    this.mesh = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: P.color, side: THREE.DoubleSide }),
      pedestrians.max,
    );
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  render() {
    const p = this.pedestrians;
    const m = this.mesh.instanceMatrix.array;
    const n = p.activeCount;
    for (let i = 0; i < n; i++) {
      const o = i * 16;
      const cos = Math.cos(p.heading[i]);
      const sin = Math.sin(p.heading[i]);
      m[o] = cos; m[o + 1] = 0; m[o + 2] = -sin; m[o + 3] = 0;
      m[o + 4] = 0; m[o + 5] = 1; m[o + 6] = 0; m[o + 7] = 0;
      m[o + 8] = sin; m[o + 9] = 0; m[o + 10] = cos; m[o + 11] = 0;
      m[o + 12] = p.x[i]; m[o + 13] = P.height; m[o + 14] = p.z[i]; m[o + 15] = 1;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
