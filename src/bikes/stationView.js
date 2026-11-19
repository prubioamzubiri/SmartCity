import * as THREE from 'three';
import { CONFIG } from '../config.js';
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

// Furgoneta de bicis: cuadrado naranja con su nombre (F1, F2…).
function vanTexture(id) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ff9800';
  context.beginPath();
  context.roundRect(6, 22, 116, 84, 18);
  context.fill();
  context.fillStyle = '#ffffff';
  context.font = 'bold 60px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(id, 64, 66);
  return new THREE.CanvasTexture(canvas);
}

const simSecondsOf = (iso) => (Date.parse(`${iso}Z`) - CONFIG.sim.baseDate) / 1000;
const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));

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
    // Las furgonetas van en otro grupo para que no tapen los puestos al elegirlos con el ratón.
    this.vanGroup = new THREE.Group();
    this.vans = new Map();
    this.byId = new Map(stations.map((s) => [s.id, s]));
    scene.add(this.vanGroup);
    this.updateColors();
  }

  setVisible(visible) {
    this.group.visible = visible;
    this.vanGroup.visible = visible;
  }

  // Coloca las furgonetas a la hora simulada `simTime`: van al origen, cargan, van al destino y descargan
  // (en línea recta, como en el servidor).
  updateVans(simTime) {
    const H = CONFIG.bicycles.vans.handlingSeconds;
    for (const v of this.state?.vans ?? []) {
      let sprite = this.vans.get(v.id);
      if (!sprite) {
        sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: vanTexture(v.id), depthWrite: false }));
        sprite.scale.set(MARKER_SIZE * 0.9, MARKER_SIZE * 0.9, 1);
        sprite.renderOrder = 3;
        this.vans.set(v.id, sprite);
        this.vanGroup.add(sprite);
      }
      let x = v.x;
      let z = v.z;
      const job = v.job;
      const a = job && this.byId.get(job.from);
      const b = job && this.byId.get(job.to);
      if (a && b) {
        const loadAt = simSecondsOf(job.loadAt);
        const unloadAt = simSecondsOf(job.unloadAt);
        if (job.loaded === null) {
          // De donde estaba al origen: llega `H` segundos antes de terminar de cargar.
          const travel = Math.hypot(a.x - v.x, a.z - v.z) / CONFIG.bicycles.vans.speed;
          const t = travel > 0 ? (simTime - (loadAt - H - travel)) / travel : 1;
          x = lerp(v.x, a.x, t);
          z = lerp(v.z, a.z, t);
        } else {
          const travel = unloadAt - H - loadAt;
          const t = travel > 0 ? (simTime - loadAt) / travel : 1;
          x = lerp(a.x, b.x, t);
          z = lerp(a.z, b.z, t);
        }
      }
      sprite.position.set(x, MARKER_SIZE * 1.4, z);
    }
  }

  // Aplica las bicicletas disponibles que calcula el servidor (cada estado nuevo es un objeto distinto).
  update(bikesState) {
    if (bikesState === this.state) return;
    this.state = bikesState;
    const byId = new Map((bikesState?.stations ?? []).map((s) => [s.id, s]));
    for (const station of this.stations) {
      const live = byId.get(station.id);
      station.available = live?.available;
      if (live) {
        station.capacity = live.capacity;
        station.estimatedCapacity = live.estimated;
      }
      station.pending = live?.pending ?? null;
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
