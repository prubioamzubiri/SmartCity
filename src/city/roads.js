import * as THREE from 'three';
import { CONFIG } from '../config.js';

// Cintas planas por clase de vía, una malla fusionada por clase.
export function createRoads(data) {
  const { nodes, ways } = data;
  const group = new THREE.Group();

  for (let cls = 0; cls < 5; cls++) {
    const hw = CONFIG.roads.halfWidth[cls];
    const y = 0.1 + (4 - cls) * 0.03;
    const positions = [];
    const indices = [];

    for (const w of ways) {
      if (w[0] !== cls) continue;
      for (let k = 2; k < w.length - 1; k++) {
        const ax = nodes[w[k] * 2], az = nodes[w[k] * 2 + 1];
        const bx = nodes[w[k + 1] * 2], bz = nodes[w[k + 1] * 2 + 1];
        const dx = bx - ax, dz = bz - az;
        const len = Math.hypot(dx, dz);
        if (len < 0.5) continue;
        const nx = (-dz / len) * hw, nz = (dx / len) * hw;
        const base = positions.length / 3;
        positions.push(ax + nx, y, az + nz, ax - nx, y, az - nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz);
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }
    if (!indices.length) continue;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    const material = new THREE.MeshBasicMaterial({ color: CONFIG.roads.colors[cls], side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return group;
}
