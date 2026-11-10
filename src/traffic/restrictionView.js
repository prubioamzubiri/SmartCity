import * as THREE from 'three';
import { distanceToEdge } from './restrictions.js';

// Colores por modo (los mismos que la leyenda del panel).
export const RESTRICTION_COLORS = {
  pedestrians_only: 0xe34948, // cortada: rojo
  buses_and_pedestrians: 0xeda100, // solo bus: ámbar
  entry_limit: 0x9085e9, // acceso limitado: violeta
};
const WIDTH = 7; // metros de ancho de la franja dibujada sobre la calle
const LIFT = 1.6; // un poco por encima del asfalto

// Tramos de una restricción (o de un borrador) en el grafo del visor, con la misma regla que el servidor.
export function edgesOf(graph, { area, ways }) {
  const edges = [];
  if (ways?.length) {
    const set = new Set(ways);
    for (let e = 0; e < graph.edgeCount; e++) if (set.has(graph.way[e])) edges.push(e);
  } else if (area) {
    for (let e = 0; e < graph.edgeCount; e++) if (distanceToEdge(graph, e, area.x, area.z) <= area.radius) edges.push(e);
  }
  return edges;
}

// Franjas planas sobre una lista de tramos (una calle de doble sentido se dibuja una vez).
function ribbons(graph, edges) {
  const seen = new Set();
  const pos = [];
  for (const e of edges) {
    const rev = graph.rev[e];
    if (rev >= 0 && seen.has(rev)) continue;
    seen.add(e);
    const ax = graph.nx[graph.A[e]];
    const az = graph.nz[graph.A[e]];
    const bx = graph.nx[graph.B[e]];
    const bz = graph.nz[graph.B[e]];
    const nx = -graph.uz[e] * (WIDTH / 2);
    const nz = graph.ux[e] * (WIDTH / 2);
    pos.push(ax + nx, LIFT, az + nz, bx + nx, LIFT, bz + nz, bx - nx, LIFT, bz - nz);
    pos.push(ax + nx, LIFT, az + nz, bx - nx, LIFT, bz - nz, ax - nx, LIFT, az - nz);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return geometry;
}

function ring(radius, color, opacity) {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(Math.max(1, radius - 4), radius, 96).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }),
  );
  mesh.position.y = LIFT;
  return mesh;
}

function dispose(group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.geometry?.dispose();
    child.material?.dispose();
  }
}

// Capa del mapa con las restricciones activas, el borrador que se está creando y la ayuda bajo el cursor.
export class RestrictionView {
  constructor(scene, graph) {
    this.graph = graph;
    this.active = new THREE.Group();
    this.draft = new THREE.Group();
    this.cursor = new THREE.Group();
    scene.add(this.active, this.draft, this.cursor);
    this.key = '';
    this.selected = null;
  }

  setVisible(visible) {
    this.active.visible = visible;
  }

  // Lista de GET /api/restrictions (o del estado). Solo se redibuja si cambia algo.
  update(list = []) {
    const key = JSON.stringify(list.map((r) => [r.id, r.mode, r.area, r.ways, r.id === this.selected]));
    if (key === this.key) return;
    this.key = key;
    dispose(this.active);
    for (const r of list) this.drawInto(this.active, r, r.id === this.selected ? 0.95 : 0.7);
  }

  select(id) {
    this.selected = id;
    this.key = '';
  }

  drawInto(group, r, opacity) {
    const color = RESTRICTION_COLORS[r.mode] ?? 0xffffff;
    const geometry = ribbons(this.graph, edgesOf(this.graph, r));
    group.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false })));
    if (r.area) {
      const outline = ring(r.area.radius, color, Math.min(1, opacity + 0.2));
      outline.position.x = r.area.x;
      outline.position.z = r.area.z;
      group.add(outline);
    }
  }

  // Borrador de una restricción nueva (null lo quita). Devuelve cuántos tramos afectaría.
  preview(draft) {
    dispose(this.draft);
    if (!draft || (!draft.area && !draft.ways?.length)) return 0;
    this.drawInto(this.draft, draft, 0.45);
    return edgesOf(this.graph, draft).length;
  }

  // Ayuda bajo el cursor: círculo de la zona o calle que se añadiría (null la quita).
  hover(target) {
    dispose(this.cursor);
    if (!target) return;
    const color = 0xffffff;
    if (target.area) {
      const outline = ring(target.area.radius, color, 0.6);
      outline.position.x = target.area.x;
      outline.position.z = target.area.z;
      this.cursor.add(outline);
    } else if (target.way !== undefined) {
      const geometry = ribbons(this.graph, edgesOf(this.graph, { ways: [target.way] }));
      this.cursor.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })));
    }
  }
}
