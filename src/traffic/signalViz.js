import * as THREE from 'three';

const STATE_COLORS = [0x22dd55, 0xffcc00, 0xff2a2a];

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
