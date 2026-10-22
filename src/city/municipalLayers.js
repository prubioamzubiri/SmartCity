import * as THREE from 'three';

export function createMunicipalLayers(scene, snapshot) {
  const group = new THREE.Group();
  const layers = {};
  const buildLines = (features, speed) => {
    const positions = [], colors = [], owners = [];
    for (const feature of features) {
      const color = new THREE.Color(speed ? feature.limitKmh === null ? 0xaaaaaa : feature.limitKmh <= 30 ? 0x54e587 : feature.limitKmh <= 50 ? 0xffb454 : 0xf36a84 : 0x58b9ff);
      for (const path of feature.paths) for (let i = 0; i < path.length - 2; i += 2) {
        positions.push(path[i], speed ? 5 : 3, path[i + 1], path[i + 2], speed ? 5 : 3, path[i + 3]);
        colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
        owners.push(feature);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.85 }));
    lines.renderOrder = 2;
    lines.userData.owners = owners;
    lines.userData.kind = speed ? 'Límite legal' : 'Eje vial oficial';
    return lines;
  };
  layers.roads = buildLines(snapshot.layers.roads, false);
  layers.speedLimits = buildLines(snapshot.layers.speedLimits, true);
  layers.speedLimits.visible = false;
  const stations = snapshot.layers.stations;
  const markers = new THREE.InstancedMesh(new THREE.SphereGeometry(7, 8, 6), new THREE.MeshBasicMaterial({ color: 0xb67cff, depthTest: false }), stations.length);
  const matrix = new THREE.Matrix4();
  stations.forEach((station, i) => markers.setMatrixAt(i, matrix.makeTranslation(station.x, 14, station.z)));
  markers.userData.kind = 'Estación Dbizi';
  markers.userData.stations = stations;
  markers.renderOrder = 3;
  layers.stations = markers;
  group.add(...Object.values(layers));
  scene.add(group);
  return {
    layers,
    pick(raycaster) {
      const previous = raycaster.params.Line.threshold;
      raycaster.params.Line.threshold = 6;
      const hits = raycaster.intersectObjects(Object.values(layers).filter(layer => layer.visible), false);
      raycaster.params.Line.threshold = previous;
      for (const hit of hits) {
        const feature = hit.object.userData.stations?.[hit.instanceId] ?? hit.object.userData.owners?.[Math.floor(hit.index / 2)];
        if (feature) return `${hit.object.userData.kind}: ${feature.name || feature.id}${feature.limitKmh != null ? ` · ${feature.limitKmh} km/h` : ''}`;
      }
      return null;
    },
  };
}
