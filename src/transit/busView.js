import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { loadColor } from './buses.js';

const T = CONFIG.transit;
const RIBBON_WIDTH = 3;
const TRACK = 0.88; // fracción del largo del autobús que ocupa la barra de ocupación del techo
const TRACK_COLOR = 0x161a22;

// Representación 3D del transporte público: el recorrido y las paradas de cada línea (cada una con su color),
// los autobuses (rectángulos del color de su línea con una barra en el techo que indica cuánto llevan lleno)
// y los peatones que esperan en las paradas.
export class BusView {
  constructor(buses) {
    this.buses = buses;
    this.group = new THREE.Group();
    this.lineVisible = buses.lines.map(() => true);
    this.lineGroups = buses.lines.map((line) => this.createLine(line));
    this.lineGroups.forEach((g) => this.group.add(g));

    const n = Math.max(1, buses.max);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const instanced = (count) => {
      const mesh = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ color: 0xffffff }), count);
      mesh.count = 0;
      mesh.frustumCulled = false;
      const white = new THREE.Color(1, 1, 1);
      for (let i = 0; i < count; i++) mesh.setColorAt(i, white);
      return mesh;
    };
    this.body = instanced(n);
    this.track = instanced(n);
    this.fill = instanced(n);
    const dark = new THREE.Color(TRACK_COLOR);
    for (let i = 0; i < n; i++) this.track.setColorAt(i, dark);
    this.instanceBus = new Int32Array(n); // autobús (índice de `buses`) que dibuja cada instancia
    this.group.add(this.body, this.track, this.fill);

    const dots = buses.waiting.length * T.maxWaiting;
    this.dots = instanced(Math.max(1, dots));
    this.dots.material.color.set(CONFIG.pedestrians.color);
    this.group.add(this.dots);
  }

  // Recorrido (cinta sobre el carril del autobús) y marcadores de parada de una línea.
  createLine(line) {
    const group = new THREE.Group();
    const r = line.route;
    const y = 0.5 + line.index * 0.04;
    const positions = [];
    const indices = [];
    for (let k = 0; k < r.edge.length; k++) {
      const dx = (r.x[k + 1] - r.x[k]) / (r.cum[k + 1] - r.cum[k]);
      const dz = (r.z[k + 1] - r.z[k]) / (r.cum[k + 1] - r.cum[k]);
      const ox = -dz * T.laneOffset;
      const oz = dx * T.laneOffset;
      const hx = -dz * (RIBBON_WIDTH / 2);
      const hz = dx * (RIBBON_WIDTH / 2);
      const base = positions.length / 3;
      positions.push(
        r.x[k] + ox + hx, y, r.z[k] + oz + hz, r.x[k] + ox - hx, y, r.z[k] + oz - hz,
        r.x[k + 1] + ox + hx, y, r.z[k + 1] + oz + hz, r.x[k + 1] + ox - hx, y, r.z[k + 1] + oz - hz,
      );
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    const material = new THREE.MeshBasicMaterial({
      color: line.color, side: THREE.DoubleSide, transparent: true, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const ribbon = new THREE.Mesh(geometry, material);
    ribbon.frustumCulled = false;
    group.add(ribbon);

    // Paradas: disco blanco con otro del color de la línea encima; las terminales son más grandes.
    const disc = new THREE.CylinderGeometry(1, 1, 1, 16);
    const white = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ color: 0xffffff }), line.stops.length);
    const colored = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ color: line.color }), line.stops.length);
    const m = new THREE.Matrix4();
    line.stops.forEach((stop, i) => {
      const size = stop.terminal ? 11 : 6;
      m.makeScale(size, 1, size).setPosition(stop.x, 0.9 + line.index * 0.04, stop.z);
      white.setMatrixAt(i, m);
      m.makeScale(size * 0.7, 1.4, size * 0.7).setPosition(stop.x, 1.1 + line.index * 0.04, stop.z);
      colored.setMatrixAt(i, m);
    });
    white.frustumCulled = colored.frustumCulled = false;
    group.add(white, colored);
    return group;
  }

  setVisible(visible) {
    this.group.visible = visible;
  }

  setLineVisible(li, visible) {
    this.lineVisible[li] = visible;
    this.lineGroups[li].visible = visible;
  }

  render() {
    const b = this.buses;
    const color = new THREE.Color();
    let n = 0;
    const set = (mesh, i, cx, cy, cz, sx, sy, sz, cos, sin) => {
      const m = mesh.instanceMatrix.array;
      const o = i * 16;
      m[o] = cos * sx; m[o + 1] = 0; m[o + 2] = -sin * sx; m[o + 3] = 0;
      m[o + 4] = 0; m[o + 5] = sy; m[o + 6] = 0; m[o + 7] = 0;
      m[o + 8] = sin * sz; m[o + 9] = 0; m[o + 10] = cos * sz; m[o + 11] = 0;
      m[o + 12] = cx; m[o + 13] = cy; m[o + 14] = cz; m[o + 15] = 1;
    };
    const bodyColors = this.body.instanceColor.array;
    const fillColors = this.fill.instanceColor.array;
    const trackLength = T.length * TRACK;
    for (let i = 0; i < b.activeCount; i++) {
      const li = b.line[i];
      if (!this.lineVisible[li]) continue;
      const cos = Math.cos(b.heading[i]);
      const sin = Math.sin(b.heading[i]);
      const occupancy = b.load[i] / T.capacity;
      const fillLength = Math.max(0.01, trackLength * Math.min(1, occupancy));
      const shift = -(trackLength - fillLength) / 2; // la barra crece desde la parte de atrás
      set(this.body, n, b.x[i], T.height / 2 + 0.3, b.z[i], T.length, T.height, T.width, cos, sin);
      set(this.track, n, b.x[i], T.height + 0.45, b.z[i], trackLength, 0.3, T.width * 0.6, cos, sin);
      set(this.fill, n, b.x[i] + cos * shift, T.height + 0.65, b.z[i] - sin * shift, fillLength, 0.35, T.width * 0.6, cos, sin);
      color.set(this.buses.lines[li].color);
      bodyColors[n * 3] = color.r; bodyColors[n * 3 + 1] = color.g; bodyColors[n * 3 + 2] = color.b;
      color.set(loadColor(occupancy));
      fillColors[n * 3] = color.r; fillColors[n * 3 + 1] = color.g; fillColors[n * 3 + 2] = color.b;
      this.instanceBus[n] = i;
      n++;
    }
    for (const mesh of [this.body, this.track, this.fill]) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.body.instanceColor.needsUpdate = true;
    this.fill.instanceColor.needsUpdate = true;
    this.renderWaiting();
  }

  // Peatones esperando en cada parada: puntos amarillos en corro junto al marcador.
  renderWaiting() {
    const b = this.buses;
    const m = this.dots.instanceMatrix.array;
    let n = 0;
    b.lines.forEach((line, li) => {
      if (!this.lineVisible[li]) return;
      line.stops.forEach((stop, j) => {
        const waiting = b.waiting[b.stopOffset[li] + j];
        for (let k = 0; k < waiting; k++) {
          const angle = k * 2.399963; // ángulo áureo: reparto uniforme en espiral
          const radius = (stop.terminal ? 7 : 4) + 0.9 * Math.sqrt(k);
          const o = n * 16;
          m[o] = 1.6; m[o + 1] = 0; m[o + 2] = 0; m[o + 3] = 0;
          m[o + 4] = 0; m[o + 5] = 1.6; m[o + 6] = 0; m[o + 7] = 0;
          m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = 1.6; m[o + 11] = 0;
          m[o + 12] = stop.x + Math.cos(angle) * radius; m[o + 13] = 1.2; m[o + 14] = stop.z + Math.sin(angle) * radius; m[o + 15] = 1;
          n++;
        }
      });
    });
    this.dots.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
  }

  // Autobús bajo el puntero (índice de `buses`) o -1.
  pick(raycaster) {
    if (!this.group.visible || !this.body.count) return -1;
    this.body.boundingSphere = null; // los autobuses se mueven: la esfera guardada quedaría obsoleta
    const hit = raycaster.intersectObject(this.body, false)[0];
    return hit?.instanceId === undefined ? -1 : this.instanceBus[hit.instanceId];
  }
}
