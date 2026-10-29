import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './style.css';
import { CONFIG } from './config.js';
import { loadCity } from './city/loadCity.js';
import { createBuildings } from './city/buildings.js';
import { createRoads } from './city/roads.js';
import {
  createParking, createParkingPicker, highlightTracked, lotOccupancy, parkingStats,
  updateParkingOccupancy, PARKING_TYPE_LABEL,
} from './city/parking.js';
import { createWater } from './city/water.js';
import { buildGraph } from './traffic/graph.js';
import { SignalController } from './traffic/signals.js';
import { createSignalViz } from './traffic/signalViz.js';
import { CarView } from './traffic/carView.js';
import { RemoteCars } from './traffic/remoteCars.js';
import { Pedestrians } from './pedestrians/pedestrians.js';
import { createWaterMask } from './city/waterMask.js';
import { PedestrianView } from './pedestrians/pedestrianView.js';
import { SensorView } from './sensors/sensorView.js';
import { ServerSync } from './api/serverSync.js';
import { createHud } from './ui/hud.js';

const loading = document.getElementById('loading');

async function main() {
  const data = await loadCity();

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('app').append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1620);
  scene.fog = new THREE.Fog(0x0e1620, 4000, 16000);
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x2a2f36, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.3);
  sun.position.set(800, 1500, 500);
  scene.add(sun);

  const { minX, maxX, minZ, maxZ } = data.bounds;
  const size = Math.max(maxX - minX, maxZ - minZ) * 2;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x25352b }),
  );
  ground.position.set((minX + maxX) / 2, -1, (minZ + maxZ) / 2);
  scene.add(ground);
  scene.add(createWater(data));
  scene.add(createBuildings(data));
  scene.add(createRoads(data));
  const parkingLayer = createParking(data);
  scene.add(parkingLayer);
  const pickParking = createParkingPicker(data);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 5, 40000);
  const center = new THREE.Vector3(0, 0, 0); // centro de Donostia (origen de la proyección)
  camera.position.set(0, 1100, 1500);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(center);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.03;
  controls.minDistance = 30;
  controls.maxDistance = 15000;
  controls.update();

  const graph = buildGraph(data);
  const signals = new SignalController(graph);
  const signalViz = createSignalViz(signals);
  scene.add(signalViz.mesh);

  const graphKey = `${graph.edgeCount}:${data.nodes.length}`;
  const sync = new ServerSync();
  const cars = new RemoteCars(graph, graphKey);
  const carView = new CarView(cars);
  scene.add(carView.mesh);
  const pedestrians = new Pedestrians(data.crossings, { graph, water: createWaterMask(data) });
  const pedestrianView = new PedestrianView(pedestrians);
  scene.add(pedestrianView.mesh);
  sync.on('cars', (payload) => cars.apply(payload));
  sync.on('disconnect', () => cars.clear());
  const serverView = new SensorView(scene, { color: 0x4caf50 });
  const simNow = () => sync.simTime() ?? CONFIG.sim.startSeconds;

  // Modo de interacción: navegar o colocar sensores en el servidor
  let mode = 'navigate';
  const setMode = (m) => {
    mode = m;
    if (m !== 'sensor') serverView.showGhost(0, 0, false);
    renderer.domElement.style.cursor = m === 'sensor' ? 'crosshair' : '';
  };
  const signalMarker = new THREE.Mesh(
    new THREE.RingGeometry(10, 13, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x00e5ff, side: THREE.DoubleSide }),
  );
  signalMarker.visible = false;
  scene.add(signalMarker);
  const markSignal = (signal) => {
    signalMarker.position.set(signal.x, 1, signal.z);
    signalMarker.visible = true;
  };
  const focusSignal = (signal) => {
    markSignal(signal);
    const offset = camera.position.clone().sub(controls.target);
    offset.setLength(Math.max(controls.minDistance, Math.min(offset.length(), 250)));
    controls.target.set(signal.x, 0, signal.z);
    camera.position.copy(controls.target).add(offset);
    controls.update();
  };
  const hud = createHud({
    sync, signals, localGraphKey: graphKey, setMode, getMode: () => mode, focusSignal,
    parking: { layer: parkingLayer, stats: parkingStats(data), highlight: (isTracked) => highlightTracked(parkingLayer, isTracked) },
    server: { view: serverView },
  });
  const signalTooltip = document.createElement('div');
  signalTooltip.id = 'signal-tooltip';
  signalTooltip.hidden = true;
  document.body.append(signalTooltip);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();
  const setPointer = (ev) => {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  };

  let down = null;
  renderer.domElement.addEventListener('pointerdown', (ev) => (down = { x: ev.clientX, y: ev.clientY }));
  renderer.domElement.addEventListener('pointermove', (ev) => {
    setPointer(ev);
    if (mode === 'sensor') {
      signalTooltip.hidden = true;
      if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) return serverView.showGhost(0, 0, false);
      const hit = graph.nearestSegment(hitPoint.x, hitPoint.z);
      serverView.showGhost(hit?.x ?? 0, hit?.z ?? 0, !!hit);
      return;
    }
    const hit = raycaster.intersectObject(signalViz.mesh, false)[0];
    const signalId = hit?.instanceId === undefined ? undefined : signalViz.signalIds[hit.instanceId];
    let label;
    const marker = parkingLayer.visible ? raycaster.intersectObjects(parkingLayer.userData.markers, false)[0] : undefined;
    if (signalId !== undefined) {
      label = `Semáforo OSM: ${signalId}`;
    } else if (marker) {
      const { name, capacity, estimatedCapacity, fee, occupancy } = marker.object.userData;
      const taken = Math.round(occupancy * capacity);
      label = [
        `Parking subterráneo público${name ? `: ${name}` : ''}`,
        fee ? 'de pago' : 'tarifa no indicada',
        `ocupación simulada ${Math.round(occupancy * 100)}% (${taken}/${capacity}${estimatedCapacity ? ' est.' : ''} plazas)`,
      ].join(' · ');
    } else if (parkingLayer.visible && raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
      const lot = pickParking(hitPoint.x, hitPoint.z);
      if (lot) {
        label = `Parking ${PARKING_TYPE_LABEL[lot.type]}`;
        if (lot.type === 2) {
          label += lot.estimated ? ' · capacidad desconocida' : ` · ${lot.capacity} plazas`;
        } else {
          const occupancy = lotOccupancy(lot, simNow());
          const places = `${Math.round(occupancy * lot.capacity)}/${lot.capacity}${lot.estimated ? ' est.' : ''}`;
          label += ` · ocupación simulada ${Math.round(occupancy * 100)}% (${places} plazas)`;
        }
      }
    }
    if (!label) {
      signalTooltip.hidden = true;
      return;
    }
    signalTooltip.textContent = label;
    signalTooltip.style.left = `${Math.max(8, Math.min(ev.clientX + 14, window.innerWidth - 220))}px`;
    signalTooltip.style.top = `${Math.max(8, Math.min(ev.clientY + 14, window.innerHeight - 48))}px`;
    signalTooltip.hidden = false;
  });
  renderer.domElement.addEventListener('pointerleave', () => (signalTooltip.hidden = true));
  renderer.domElement.addEventListener('pointerup', (ev) => {
    if (!down || ev.button !== 0 || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 5) return;
    setPointer(ev);
    if (mode === 'navigate') {
      const parkingHit = parkingLayer.visible ? raycaster.intersectObjects(parkingLayer.userData.markers, false)[0] : undefined;
      if (parkingHit) return hud.toggleParking(parkingHit.object.userData.id);
      const hit = raycaster.intersectObject(signalViz.mesh, false)[0];
      const id = hit?.instanceId === undefined ? undefined : signalViz.signalIds[hit.instanceId];
      const signal = id === undefined ? undefined : signals.signals.find((s) => s.id === id);
      if (signal) {
        markSignal(signal);
        hud.revealSignal(signal.id);
        return;
      }
    }
    if (mode === 'sensor') {
      if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) hud.addServerSensor(hitPoint.x, hitPoint.z);
      return;
    }
    const picked = serverView.pick(raycaster);
    hud.selectSensor(picked);
  });
  window.addEventListener('keydown', (ev) => {
    if (ev.target instanceof HTMLInputElement) return;
    if (ev.key === 'Escape') setMode('navigate');
    if (ev.key === 'Delete') hud.removeSelectedSensor();
  });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  function frame(now) {
    const simTime = sync.simTime();
    if (simTime !== null) {
      signals.update(simTime);
      updateParkingOccupancy(parkingLayer, simTime);
      pedestrians.updateAt(simTime, sync.state.params.scenario);
    } else {
      pedestrians.activeCount = 0;
    }
    cars.update(now);
    carView.render();
    pedestrianView.render();
    signalViz.update();
    controls.update();
    renderer.render(scene, camera);
    hud.update(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  loading.remove();
}

main().catch((err) => {
  loading.textContent = `Error: ${err.message}`;
  console.error(err);
});
