import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { eventCalendar } from './calendar.js';

const BEAM_HEIGHT = 260;

// Marca en el mapa la sede de cada evento en curso: un anillo del tamaño de su zona de influencia y un haz de luz
// que se intensifica según llega la gente y se apaga al terminar.
export class EventView {
  constructor(scene, calendar = eventCalendar) {
    this.calendar = calendar;
    this.group = new THREE.Group();
    this.markers = new Map();
    this.ring = new THREE.RingGeometry(0.94, 1, 64).rotateX(-Math.PI / 2);
    this.beam = new THREE.CylinderGeometry(6, 6, BEAM_HEIGHT, 12, 1, true).translate(0, BEAM_HEIGHT / 2, 0);
    scene.add(this.group);
  }

  marker(event) {
    let marker = this.markers.get(event.id);
    if (!marker) {
      const color = new THREE.Color(this.calendar.types[event.type].color);
      const material = () => new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(this.ring, material());
      const beam = new THREE.Mesh(this.beam, material());
      ring.scale.set(event.radius, 1, event.radius);
      ring.position.set(event.x, 2, event.z);
      beam.position.set(event.x, 0, event.z);
      this.group.add(ring, beam);
      marker = { ring, beam };
      this.markers.set(event.id, marker);
    }
    return marker;
  }

  // `simSeconds`: hora del servidor; null sin conexión (no se muestra nada).
  update(simSeconds) {
    const active = simSeconds !== null && CONFIG.events.enabled ? this.calendar.activeAt(simSeconds) : [];
    const seen = new Set();
    for (const { event, intensity } of active) {
      seen.add(event.id);
      const { ring, beam } = this.marker(event);
      ring.material.opacity = 0.2 + 0.7 * intensity;
      beam.material.opacity = 0.08 + 0.3 * intensity;
    }
    for (const [id, marker] of this.markers) {
      if (seen.has(id)) continue;
      this.group.remove(marker.ring, marker.beam);
      marker.ring.material.dispose();
      marker.beam.material.dispose();
      this.markers.delete(id);
    }
  }
}
