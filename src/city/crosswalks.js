import * as THREE from 'three';
import { CONFIG } from '../config.js';

const STRIDE = 5; // x, z, dirX, dirZ, clase de vía (igual que data.crossings)
const Z = CONFIG.pedestrians.zebra;

// Pasos de cebra: franjas blancas a lo largo de la calle, repartidas por el ancho de la calzada en cada paso de OSM.
export function createCrosswalks(data) {
  const c = data.crossings ?? [];
  const matrices = [];
  const pitch = Z.stripe + Z.gap;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3(Z.stripe, 1, Z.length);
  for (let j = 0; j + STRIDE <= c.length; j += STRIDE) {
    const half = CONFIG.roads.halfWidth[c[j + 4]];
    const dx = c[j + 2];
    const dz = c[j + 3];
    q.setFromAxisAngle(up, Math.atan2(-dz, dx));
    const stripes = Math.max(1, Math.floor((2 * half) / pitch));
    for (let k = 0; k < stripes; k++) {
      const along = (k - (stripes - 1) / 2) * pitch;
      pos.set(c[j] + dx * along, 0.3, c[j + 1] + dz * along);
      matrices.push(m.compose(pos, q, scale).clone());
    }
  }
  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: Z.color, side: THREE.DoubleSide }),
    Math.max(1, matrices.length),
  );
  matrices.forEach((mat, k) => mesh.setMatrixAt(k, mat));
  mesh.count = matrices.length;
  mesh.frustumCulled = false;
  return mesh;
}
