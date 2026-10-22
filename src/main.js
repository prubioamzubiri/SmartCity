import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './style.css';
import { CONFIG } from './config.js';
import { loadCity } from './city/loadCity.js';
import { createBuildings } from './city/buildings.js';
import { createRoads } from './city/roads.js';
import { createWater } from './city/water.js';
import { buildGraph } from './traffic/graph.js';
import { SignalController, createSignalViz } from './traffic/signals.js';
import { TrafficSim } from './traffic/sim.js';
import { demandFactor } from './traffic/demand.js';
import { SensorManager } from './sensors/sensorManager.js';
import { createHud } from './ui/hud.js';
import { Experiment } from './simulation/experiment.js';
import { createExperimentPanel } from './ui/experimentPanel.js';
import { createMunicipalPanel } from './ui/municipalPanel.js';

const loading = document.getElementById('loading');

async function main() {
  const data = await loadCity();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(data)));
  const datasetId = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');

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

  const clock = { simTime: CONFIG.sim.startSeconds, scale: 60 };
  const params = { maxCars: CONFIG.cars.initialMax, scenario: CONFIG.traffic.scenario };

  let sensors;
  const sim = new TrafficSim(graph, signals, (sensor, dir, speed) => sensors.recordCrossing(sensor, dir, speed));
  scene.add(sim.mesh);
  sensors = new SensorManager({ scene, graph, sim, getSimTime: () => clock.simTime });
  sensors.load();

  const experiment = new Experiment({ clock, params, sim, signals, sensors, datasetId });

  // Modo de interacción: navegar o colocar sensores
  let mode = 'navigate';
  const setMode = (m) => {
    mode = m;
    if (m !== 'sensor') sensors.showGhost(0, 0, false);
    renderer.domElement.style.cursor = m === 'sensor' ? 'crosshair' : '';
  };
  const hud = createHud({ clock, params, sim, signals, sensors, setMode, getMode: () => mode, experiment });
  const experimentPanel = createExperimentPanel(experiment, settings => {
    experiment.start(settings);
    setMode('navigate');
    acc = 0;
    hud.syncExperiment();
    hud.update(performance.now(), true);
    experimentPanel.update();
  });
  const municipalPanel = createMunicipalPanel({ scene, graph, city: data, experiment, clock, sensors });
  document.getElementById('hud').prepend(experimentPanel.panel, municipalPanel.panel);
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
  const hud = createHud({ clock, params, sim, signals, sensors, setMode, getMode: () => mode, focusSignal });
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
      if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) return sensors.showGhost(0, 0, false);
      const hit = sensors.snap(hitPoint.x, hitPoint.z);
      sensors.showGhost(hit?.x ?? 0, hit?.z ?? 0, !!hit);
      return;
    }
    const hit = raycaster.intersectObject(signalViz.mesh, false)[0];
    const signalId = hit?.instanceId === undefined ? undefined : signalViz.signalIds[hit.instanceId];
    if (signalId === undefined) {
      signalTooltip.hidden = true;
      return;
    }
    signalTooltip.textContent = `Semáforo OSM: ${signalId}`;
    signalTooltip.style.left = `${Math.max(8, Math.min(ev.clientX + 14, window.innerWidth - 220))}px`;
    signalTooltip.style.top = `${Math.max(8, Math.min(ev.clientY + 14, window.innerHeight - 48))}px`;
    signalTooltip.hidden = false;
  });
  renderer.domElement.addEventListener('pointerleave', () => (signalTooltip.hidden = true));
  renderer.domElement.addEventListener('pointerup', (ev) => {
    if (experiment.status === 'running') return;
    if (!down || ev.button !== 0 || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 5) return;
    setPointer(ev);
    if (mode !== 'sensor') {
      const hit = raycaster.intersectObject(signalViz.mesh, false)[0];
      const id = hit?.instanceId === undefined ? undefined : signalViz.signalIds[hit.instanceId];
      const signal = id === undefined ? undefined : signals.signals.find((s) => s.id === id);
      if (signal) {
        markSignal(signal);
        hud.revealSignal(signal.id);
        return;
      }
    }
    const picked = sensors.pick(raycaster);
    if (picked) return sensors.select(picked);
    if (mode === 'navigate' && municipalPanel.pick(raycaster)) return;
    if (mode === 'sensor' && raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
      const s = sensors.add(hitPoint.x, hitPoint.z);
      if (s) sensors.select(s.id);
    } else {
      sensors.select(null);
    }
  });
  window.addEventListener('keydown', (ev) => {
    if (experiment.status === 'running' || ev.target instanceof HTMLInputElement || ev.target instanceof HTMLSelectElement) return;
    if (ev.key === 'Escape') setMode('navigate');
    if (ev.key === 'Delete' && sensors.selectedId) sensors.remove(sensors.selectedId);
  });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const STEP = CONFIG.sim.step;
  let acc = 0;
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (clock.scale > 0) {
      acc += dt * clock.scale;
      let steps = 0;
      while (clock.scale > 0 && acc >= STEP && steps < CONFIG.sim.maxStepsPerFrame) {
        clock.simTime += STEP;
        signals.update(clock.simTime);
        sim.setTarget(params.maxCars * demandFactor(clock.simTime, params.scenario));
        sim.step(STEP);
        sensors.tick(clock.simTime);
        experiment.afterStep();
        acc -= STEP;
        steps++;
      }
      if (acc >= STEP) acc = 0;
    }
    sim.render();
    signalViz.update();
    controls.update();
    renderer.render(scene, camera);
    hud.update(now);
    experimentPanel.update();
    municipalPanel.update();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  loading.remove();
}

main().catch((err) => {
  loading.textContent = `Error: ${err.message}`;
  console.error(err);
});
