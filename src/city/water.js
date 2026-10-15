import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const WATER_Y = -0.5;
const WATER_COLOR = 0x2a6fb0;
const RIVER_HALF_WIDTH = 12;

function ringToPoints(flat) {
  const pts = [];
  for (let i = 0; i < flat.length; i += 2) pts.push(new THREE.Vector2(flat[i], flat[i + 1]));
  return pts;
}

function positionsOnly(g) {
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.getAttribute('position'));
  out.setIndex(g.index);
  return out;
}

// Polígonos de agua (mar, ría, lagos) y ríos como cintas, todo plano y azul.
export function createWater(data) {
  const water = data.water;
  const group = new THREE.Group();
  if (!water) return group;

  const geometries = [];
  for (const rings of water.polygons) {
    const shape = new THREE.Shape(ringToPoints(rings[0]));
    for (const hole of rings.slice(1)) shape.holes.push(new THREE.Path(ringToPoints(hole)));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(Math.PI / 2);
    geometries.push(positionsOnly(g));
  }

  const positions = [];
  const indices = [];
  for (const line of water.lines) {
    for (let i = 0; i < line.length - 2; i += 2) {
      const ax = line[i], az = line[i + 1], bx = line[i + 2], bz = line[i + 3];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5) continue;
      const nx = (-(bz - az) / len) * RIVER_HALF_WIDTH;
      const nz = ((bx - ax) / len) * RIVER_HALF_WIDTH;
      const base = positions.length / 3;
      positions.push(ax + nx, 0, az + nz, ax - nx, 0, az - nz, bx + nx, 0, bz + nz, bx - nx, 0, bz - nz);
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
  if (indices.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    geometries.push(g);
  }
  if (!geometries.length) return group;

  const merged = mergeGeometries(geometries);
  const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ color: WATER_COLOR, side: THREE.DoubleSide }));
  mesh.position.y = WATER_Y;
  mesh.frustumCulled = false;
  group.add(mesh);
  return group;
}
