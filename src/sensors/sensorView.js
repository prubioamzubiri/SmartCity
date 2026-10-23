import * as THREE from 'three';

const COLOR_NORMAL = 0xff8800;
const COLOR_SELECTED = 0x00e5ff;
const COLOR_GHOST = 0xffffff;

function makeMarker(color, opacity = 1) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 30, 8), mat);
  pole.position.y = 15;
  const head = new THREE.Mesh(new THREE.SphereGeometry(5, 12, 10), mat);
  head.position.y = 32;
  group.add(pole, head);
  return group;
}

// Marcadores 3D de los sensores; el SensorManager del núcleo no depende de THREE.
export class SensorView {
  constructor(scene, { color = COLOR_NORMAL } = {}) {
    this.color = color;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.ghost = makeMarker(COLOR_GHOST, 0.5);
    this.ghost.visible = false;
    scene.add(this.ghost);
    this.markers = new Map();
  }

  add(sensor) {
    const marker = makeMarker(this.color);
    marker.position.set(sensor.x, 0, sensor.z);
    marker.userData.sensorId = sensor.id;
    this.group.add(marker);
    this.markers.set(sensor.id, marker);
  }

  remove(id) {
    const marker = this.markers.get(id);
    if (!marker) return;
    this.group.remove(marker);
    marker.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.markers.delete(id);
  }

  select(id) {
    for (const [sid, marker] of this.markers) {
      const color = sid === id ? COLOR_SELECTED : this.color;
      marker.traverse((o) => o.material && o.material.color.setHex(color));
    }
  }

  showGhost(x, z, visible) {
    this.ghost.visible = visible;
    if (visible) this.ghost.position.set(x, 0, z);
  }

  pick(raycaster) {
    const hits = raycaster.intersectObjects(this.group.children, true);
    for (const h of hits) {
      let o = h.object;
      while (o && o.userData.sensorId === undefined) o = o.parent;
      if (o) return o.userData.sensorId;
    }
    return null;
  }
}
