import * as THREE from 'three';
import { bikeAvailabilityColor } from './sharing.js';

const UNKNOWN_COLOR = 0x8899aa;
const MARKER_SIZE = 42;

function stationTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.arc(64, 64, 60, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#102030';
  context.font = 'bold 76px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('B', 64, 68);
  return new THREE.CanvasTexture(canvas);
}

export class BikeStationView {
  constructor(scene, stations) {
    this.stations = stations;
    this.state = null;
    this.group = new THREE.Group();
    this.group.visible = true;
    this.markers = new Map();
    const texture = stationTexture();
    for (const station of stations) {
      const marker = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture,
        color: 0x2ecc71,
        depthWrite: false,
      }));
      marker.scale.set(MARKER_SIZE, MARKER_SIZE, 1);
      marker.position.set(station.x, MARKER_SIZE / 2, station.z);
      marker.userData.stationId = station.id;
      this.group.add(marker);
      this.markers.set(station.id, marker);
    }
    scene.add(this.group);
    this.updateColors();
  }

  setVisible(visible) {
    this.group.visible = visible;
  }

  // Aplica las bicicletas disponibles que calcula el servidor (cada estado nuevo es un objeto distinto).
  update(bikesState) {
    if (bikesState === this.state) return;
    this.state = bikesState;
    const byId = new Map((bikesState?.stations ?? []).map((s) => [s.id, s]));
    for (const station of this.stations) {
      const live = byId.get(station.id);
      station.available = live?.available;
      station.tracked = live?.tracked ?? false;
    }
    this.updateColors();
  }

  updateColors() {
    for (const station of this.stations) {
      this.markers.get(station.id).material.color.setHex(
        station.available === undefined ? UNKNOWN_COLOR : bikeAvailabilityColor(station.available, station.capacity),
      );
    }
  }

  pick(raycaster) {
    if (!this.group.visible) return null;
    const hit = raycaster.intersectObjects(this.group.children, false)[0];
    return hit?.object.userData.stationId ?? null;
  }
}
