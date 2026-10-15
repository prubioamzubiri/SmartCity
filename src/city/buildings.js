import * as THREE from 'three';

// Cada edificio es un cubo orientado: [cx, cz, w, d, ángulo, h].
export function createBuildings(data) {
  const src = data.buildings;
  const count = src.length / 6;
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.translate(0, 0.5, 0);
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const mesh = new THREE.InstancedMesh(geometry, material, count);

  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const axisY = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const o = i * 6;
    pos.set(src[o], 0, src[o + 1]);
    quat.setFromAxisAngle(axisY, -src[o + 4]);
    scale.set(src[o + 2], src[o + 5], src[o + 3]);
    matrix.compose(pos, quat, scale);
    mesh.setMatrixAt(i, matrix);
    const shade = 0.62 + ((i * 2654435761) % 1000) / 1000 * 0.25;
    color.setRGB(shade, shade * 0.97, shade * 0.93);
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}
