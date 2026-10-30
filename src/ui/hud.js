import { CONFIG } from '../config.js';
import { el } from './dom.js';
import { createServerPanel } from './serverPanel.js';
import { demandFactor, scenarioForTime, simDate } from '../traffic/demand.js';

const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept });
    input.addEventListener('change', async () => resolve(input.files[0] ? await input.files[0].text() : null));
    input.click();
  });
}

// Panel de control del visor: muestra el estado del servidor y le envía los cambios; no guarda estado propio.
export function createHud({ sync, signals, localGraphKey, setMode, getMode, focusSignal, parking, server, pedestrianSensors }) {
  const root = el('div', { id: 'hud' });
  document.body.append(root);

  // Secciones plegables; el estado se recuerda entre recargas.
  const COLLAPSED_KEY = 'smartcity.hud.collapsed';
  let collapsed = [];
  try {
    const saved = JSON.parse(localStorage.getItem(COLLAPSED_KEY));
    if (Array.isArray(saved)) collapsed = saved;
  } catch {
    /* sin estado guardado */
  }
  const section = (title, ...children) => {
    const details = el('details', { class: 'collapsible', open: !collapsed.includes(title) },
      el('summary', {}, el('h3', {}, title)), ...children);
    details.addEventListener('toggle', () => {
      collapsed = collapsed.filter((t) => t !== title);
      if (!details.open) collapsed.push(title);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
      } catch {
        /* almacenamiento no disponible */
      }
    });
    return details;
  };

  let state = null; // último estado recibido del servidor
  const simNow = () => sync.simTime() ?? CONFIG.sim.startSeconds;
  const serverPanel = createServerPanel({ section, sync, localGraphKey });
  const run = async (fn) => {
    try {
      await sync.act(fn);
    } catch (err) {
      serverPanel.say(err.message, true);
    }
  };

  // Reloj
  const clockLabel = el('div', { class: 'clock' });
  const clockNote = el('div', { class: 'status' });
  const clockSection = section('Reloj (servidor)', clockLabel, clockNote);

  // Tráfico
  const carsLabel = el('span', { textContent: CONFIG.cars.initialMax });
  const carsInput = el('input', {
    type: 'range', min: 100, max: CONFIG.cars.max, step: 100, value: CONFIG.cars.initialMax,
    oninput: () => (carsLabel.textContent = carsInput.value),
    onchange: () => run((c) => c.setParams({ maxCars: Number(carsInput.value) })),
  });
  const statsLabel = el('div', { class: 'stats' });
  const scenarioNames = { auto: 'Automático (calendario)', weekday: 'Laborable', weekend: 'Fin de semana' };
  const scenarioSelect = el('select', {
    onchange: () => run((c) => c.setParams({ scenario: scenarioSelect.value })),
  }, ...Object.entries(scenarioNames).map(([value, textContent]) => el('option', { value, textContent })));
  const scenarioLabel = el('div', { class: 'status' });
  const trafficSection = section('Tráfico (servidor)',
    el('label', {}, 'Escenario: ', scenarioSelect), scenarioLabel,
    el('label', {}, 'Coches en hora punta: ', carsLabel), carsInput, statsLabel);

  // Semáforos
  const greenInput = el('input', { type: 'number', min: 5, max: 180, value: CONFIG.signals.green });
  const planStatus = el('div', { class: 'status' });
  const planUrl = el('input', { type: 'text', placeholder: 'URL del plan de semáforos (JSON)' });
  const signalCount = el('div', { class: 'status' });
  const signalList = el('div', { class: 'signal-list', id: 'signal-list' });
  const signalInputs = new Map();
  const signalEntries = new Map();
  let selectedSignalId = null;
  let planKey = '';
  signalList.hidden = true;
  const setListOpen = (open) => {
    signalList.hidden = !open;
    signalToggle.textContent = open ? 'Ocultar semáforos' : 'Mostrar semáforos';
    signalToggle.setAttribute('aria-expanded', String(open));
  };
  const signalToggle = el('button', {
    textContent: 'Mostrar semáforos',
    onclick: () => setListOpen(signalList.hidden),
  });
  const selectSignal = (id) => {
    selectedSignalId = id;
    signalEntries.forEach((entry, key) => entry.classList.toggle('selected', key === id));
  };
  const revealSignal = (id) => {
    selectSignal(id);
    signalSection.open = true;
    setListOpen(true);
    signalEntries.get(id)?.scrollIntoView({ block: 'nearest' });
  };
  signalToggle.setAttribute('aria-controls', 'signal-list');
  signalToggle.setAttribute('aria-expanded', 'false');
  const sendPlan = (plan, label) => run(async (c) => {
    await c.setSignalPlan(plan);
    planStatus.textContent = label;
  });
  const renderSignalList = () => {
    const activeSignals = signals.signals.filter((signal) => signal.active);
    signalCount.textContent = `Cruces configurables: ${activeSignals.length}`;
    signalInputs.clear();
    signalEntries.clear();
    signalList.replaceChildren(...activeSignals.map((signal) => {
      const timing = signals.timing(signal, simNow());
      const heading = el('div', { class: 'signal-head' },
        el('button', {
          class: 'signal-id',
          textContent: `Semáforo ${signal.id}`,
          title: 'Ir a este semáforo en el mapa',
          onclick: () => {
            selectSignal(signal.id);
            focusSignal(signal);
          },
        }),
        el('a', {
          class: 'signal-osm',
          textContent: 'OSM',
          href: `https://www.openstreetmap.org/node/${signal.id}`,
          target: '_blank',
          rel: 'noopener noreferrer',
          title: 'Abrir este nodo en OpenStreetMap',
        }),
      );
      const timeInput = (label, key, value, min, max, title) => {
        const input = el('input', {
          type: 'number', min, max, step: 1, value,
          onchange: (event) => {
            const plan = structuredClone(signals.plan);
            plan.signals[signal.id] = { ...(plan.signals[signal.id] ?? {}), [key]: Number(event.currentTarget.value) };
            sendPlan(plan, `Semáforo ${signal.id} actualizado en el servidor`);
          },
        });
        return {
          input,
          element: el('label', { class: 'signal-time', title }, el('span', { textContent: label }), input),
        };
      };
      const greenA = timeInput('Verde A', 'greenA', timing.gA, 5, 180, 'Grupo de aproximaciones este-oeste, en segundos');
      const greenB = timeInput('Verde B', 'greenB', timing.gB, 5, 180, 'Grupo de aproximaciones norte-sur, en segundos');
      const yellow = timeInput('Ámbar', 'yellow', timing.y, 1, 10, 'Duración del ámbar, en segundos');
      signalInputs.set(signal.id, { greenA: greenA.input, greenB: greenB.input, yellow: yellow.input });
      const entry = el('div', { class: 'signal-entry' }, heading,
        el('div', { class: 'signal-timings' },
          greenA.element,
          greenB.element,
          yellow.element,
        ),
      );
      entry.classList.toggle('selected', signal.id === selectedSignalId);
      signalEntries.set(signal.id, entry);
      return entry;
    }));
  };
  renderSignalList();
  const signalSection = section(
    'Semáforos (servidor)',
    el('label', {}, 'Verde (s) para todos: ', greenInput),
    el('button', {
      textContent: 'Aplicar',
      onclick: () => {
        const green = Number(greenInput.value) || CONFIG.signals.green;
        sendPlan({ default: { green, yellow: signals.plan.default.yellow }, signals: {} }, `Verde global: ${green} s`);
      },
    }),
    signalCount,
    signalToggle,
    signalList,
    planUrl,
    el('div', { class: 'row' },
      el('button', {
        textContent: 'Cargar URL',
        onclick: async () => {
          try {
            const res = await fetch(planUrl.value);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            await sendPlan(await res.json(), `Plan cargado: ${planUrl.value}`);
          } catch (err) {
            planStatus.textContent = `Error: ${err.message}`;
          }
        },
      }),
      el('button', {
        textContent: 'Cargar archivo',
        onclick: async () => {
          const text = await pickFile('.json,application/json');
          if (text === null) return;
          try {
            await sendPlan(JSON.parse(text), 'Plan cargado: archivo');
          } catch (err) {
            planStatus.textContent = `Archivo no válido: ${err.message}`;
          }
        },
      }),
      el('button', {
        textContent: 'Descargar plantilla',
        onclick: () => download(
          'plantilla-semaforos.json',
          JSON.stringify({
            default: {
              green: CONFIG.signals.green,
              yellow: CONFIG.signals.yellow,
              schedule: [
                {
                  when: { months: [12], daysOfMonth: [24], years: [2026] },
                  green: 15,
                },
                {
                  when: { weekdays: [1, 2, 3, 4, 5], start: '07:00', end: '09:00' },
                  green: 30,
                },
              ],
            },
            signals: {
              '123456789': {
                schedule: [
                  {
                    when: { weekdays: [1, 2, 3, 4, 5], start: '16:00', end: '18:00' },
                    greenA: 20,
                    greenB: 35,
                  },
                ],
              },
            },
          }, null, 2),
          'application/json',
        ),
      }),
      el('button', {
        textContent: 'Descargar plan actual',
        onclick: () => download('plan-semaforos.json', JSON.stringify(signals.plan, null, 2), 'application/json'),
      }),
    ),
    planStatus,
  );

  // Sensores
  const sensorModeButton = el('button', { class: 'primary', onclick: () => setMode(getMode() === 'sensor' ? 'navigate' : 'sensor') });
  const sensorList = el('div', { class: 'sensor-list' });
  const recordsLabel = el('div', { class: 'status' });
  const sensorSection = section('Sensores (servidor)', sensorModeButton, sensorList, recordsLabel);

  // Solo hay un sensor seleccionado a la vez, de tráfico o de peatones.
  let selectedSensorId = null;
  let selectedPedestrianSensorId = null;
  let sensorKey = null;
  const sensorRows = new Map();
  const pedestrianRows = new Map();
  const applySelection = () => {
    server.view.select(selectedSensorId);
    pedestrianSensors.view.select(selectedPedestrianSensorId);
    sensorRows.forEach((r, key) => r.row.classList.toggle('selected', key === selectedSensorId));
    pedestrianRows.forEach((r, key) => r.row.classList.toggle('selected', key === selectedPedestrianSensorId));
  };
  const selectSensor = (id) => {
    selectedSensorId = id;
    selectedPedestrianSensorId = null;
    applySelection();
  };
  const selectPedestrianSensor = (id) => {
    selectedPedestrianSensorId = id;
    selectedSensorId = null;
    applySelection();
  };
  const removeSensor = (id) => run((c) => c.removeSensor(id));
  function renderSensors(list) {
    const ids = new Set(list.map((s) => s.id));
    for (const id of [...server.view.markers.keys()]) if (!ids.has(id)) server.view.remove(id);
    for (const s of list) if (!server.view.markers.has(s.id)) server.view.add(s);
    if (selectedSensorId && !ids.has(selectedSensorId)) selectedSensorId = null;
    // Solo se reconstruye la lista si cambian sensores o nombres, para no pisar lo que se esté escribiendo.
    const key = JSON.stringify(list.map((s) => [s.id, s.name]));
    if (key !== sensorKey) {
      sensorKey = key;
      sensorRows.clear();
      sensorList.replaceChildren();
      for (const s of list) {
        const name = el('input', {
          type: 'text', value: s.name, maxLength: 60,
          onchange: () => run((c) => c.renameSensor(s.id, name.value)),
        });
        const count = el('span', { class: 'count' });
        const del = el('button', {
          textContent: '✕', title: 'Borrar del servidor (el histórico se conserva)',
          onclick: (event) => {
            event.stopPropagation();
            removeSensor(s.id);
          },
        });
        const row = el('div', { class: 'sensor', onclick: () => selectSensor(s.id) }, name, count, del);
        sensorRows.set(s.id, { row, count });
        sensorList.append(row);
      }
      if (!list.length) sensorList.append(el('em', {}, 'Sin sensores en el servidor. Activa el modo y haz clic sobre una calle.'));
    }
    for (const s of list) sensorRows.get(s.id).count.textContent = `${s.current} (${s.total})`;
    applySelection();
  }

  // Sensores de peatones
  const pedestrianLabel = el('span', { textContent: CONFIG.pedestrians.max });
  const pedestrianInput = el('input', {
    type: 'range', min: 0, max: CONFIG.pedestrians.max, step: 500, value: CONFIG.pedestrians.max,
    oninput: () => (pedestrianLabel.textContent = pedestrianInput.value),
    onchange: () => run((c) => c.setParams({ maxPedestrians: Number(pedestrianInput.value) })),
  });
  const pedestrianStats = el('div', { class: 'stats' });
  const pedestrianModeButton = el('button', { class: 'primary', onclick: () => setMode(getMode() === 'pedsensor' ? 'navigate' : 'pedsensor') });
  const pedestrianList = el('div', { class: 'sensor-list' });
  const pedestrianRecords = el('div', { class: 'status' });
  const pedestrianSection = section('Peatones (servidor)',
    el('label', {}, 'Peatones en hora punta: ', pedestrianLabel), pedestrianInput, pedestrianStats,
    pedestrianModeButton, pedestrianList, pedestrianRecords);
  let pedestrianKey = null;
  const removePedestrianSensor = (id) => run((c) => c.removePedestrianSensor(id));
  function renderPedestrianSensors(list) {
    const view = pedestrianSensors.view;
    const ids = new Set(list.map((s) => s.id));
    for (const id of [...view.markers.keys()]) if (!ids.has(id)) view.remove(id);
    for (const s of list) if (!view.markers.has(s.id)) view.add(s);
    if (selectedPedestrianSensorId && !ids.has(selectedPedestrianSensorId)) selectedPedestrianSensorId = null;
    const key = JSON.stringify(list.map((s) => [s.id, s.name]));
    if (key !== pedestrianKey) {
      pedestrianKey = key;
      pedestrianRows.clear();
      pedestrianList.replaceChildren();
      for (const s of list) {
        const name = el('input', {
          type: 'text', value: s.name, maxLength: 60,
          onchange: () => run((c) => c.renamePedestrianSensor(s.id, name.value)),
        });
        const count = el('span', { class: 'count' });
        const del = el('button', {
          textContent: '✕', title: 'Borrar del servidor (el histórico se conserva)',
          onclick: (event) => {
            event.stopPropagation();
            removePedestrianSensor(s.id);
          },
        });
        const row = el('div', { class: 'sensor', onclick: () => selectPedestrianSensor(s.id) }, name, count, del);
        pedestrianRows.set(s.id, { row, count });
        pedestrianList.append(row);
      }
      if (!list.length) pedestrianList.append(el('em', {}, 'Sin sensores de peatones. Activa el modo y haz clic sobre una calle.'));
    }
    for (const s of list) pedestrianRows.get(s.id).count.textContent = `${s.current} (${s.total})`;
    applySelection();
  }

  // Aparcamiento
  const parkingToggle = el('input', {
    type: 'checkbox', checked: true,
    onchange: () => (parking.layer.visible = parkingToggle.checked),
  });
  const parkingStats = parking.stats
    ? `Parkings: ${parking.stats.lots} (capacidad indicada en OSM: ${parking.stats.capacity}) · subterráneos públicos (icono P): ${parking.stats.underground} · plazas sueltas: ${parking.stats.spaces} · tramos con aparcamiento en calle: ${parking.stats.street}`
    : 'Sin datos de aparcamiento. Ejecuta "npm run fetch-parking".';
  const parkingOccupancy = el('div', { class: 'status' });
  const legendItem = (color, text) => el('span', {}, el('i', { style: `background:${color}` }), text);
  const parkingLegend = el('div', { class: 'legend' },
    legendItem('#2ecc71', 'Parking libre (simulado)'),
    legendItem('#e74c3c', 'Parking lleno (simulado)'),
    legendItem('#7a4fd6', 'Área subterránea'),
    legendItem('#4fc3f7', 'Aparcamiento en calle'),
    legendItem('#ffffff', 'Plaza individual'),
  );
  const trackList = el('div', { class: 'parking-list' });
  const trackedIds = () => (state?.parkings ?? []).filter((p) => p.tracked).map((p) => p.id);
  let trackKey = null;
  function renderTracked() {
    const lots = state?.parkings ?? [];
    const key = JSON.stringify(lots.map((p) => [p.id, p.name, p.tracked]));
    if (key !== trackKey) {
      trackKey = key;
      trackList.replaceChildren();
      for (const lot of lots) {
        const box = el('input', { type: 'checkbox', checked: lot.tracked, onchange: () => toggleParking(lot.id) });
        trackList.append(el('label', { class: 'parking-item' }, box, ` ${lot.name} `,
          el('span', { class: 'count', id: `track-${lot.id}` })));
      }
      if (!lots.length) trackList.append(el('em', {}, 'Sin parkings subterráneos en los datos.'));
    }
    for (const lot of lots) {
      const c = document.getElementById(`track-${lot.id}`);
      if (c) c.textContent = `${Math.round(lot.occupancy * 100)}%`;
    }
  }
  const setTracked = async (ids) => {
    await run((c) => c.setTrackedParkings(ids));
    trackKey = null; // vuelve a mostrar lo que el servidor tiene realmente
    renderTracked();
  };
  const toggleParking = (id) => {
    const ids = new Set(trackedIds());
    if (!ids.delete(id)) ids.add(id);
    return setTracked([...ids]);
  };
  const trackSection = el('div', { class: 'parking-tracking' },
    el('h4', {}, 'Ocupación registrada por el servidor'),
    el('div', { class: 'row' },
      el('button', { textContent: 'Todos', onclick: () => setTracked((state?.parkings ?? []).map((p) => p.id)) }),
      el('button', { textContent: 'Ninguno', onclick: () => setTracked([]) }),
    ),
    trackList,
  );
  const parkingSection = section(
    'Aparcamiento (OSM)',
    el('label', {}, parkingToggle, ' Mostrar aparcamientos'),
    el('div', { class: 'status', textContent: parkingStats }),
    parkingOccupancy,
    parkingLegend,
    trackSection,
  );

  root.append(
    el('h2', {}, 'SmartCity Donostia'),
    serverPanel.node, clockSection, trafficSection, signalSection, sensorSection, pedestrianSection, parkingSection,
    el('p', { class: 'help' }, 'Ratón: arrastrar = girar, derecho = mover, rueda = zoom. Esc: salir del modo sensor. Supr: borrar sensor seleccionado.'),
  );

  sync.on('state', (s) => {
    state = s;
    if (document.activeElement !== carsInput) {
      carsInput.value = s.params.maxCars;
      carsLabel.textContent = s.params.maxCars;
    }
    if (document.activeElement !== pedestrianInput) {
      pedestrianInput.value = s.params.maxPedestrians;
      pedestrianLabel.textContent = s.params.maxPedestrians;
    }
    if (document.activeElement !== scenarioSelect) scenarioSelect.value = s.params.scenario;
    signals.setPlan(s.signalPlan);
    const key = JSON.stringify(s.signalPlan);
    if (key !== planKey) {
      planKey = key;
      greenInput.value = signals.plan.default.green;
      renderSignalList();
    }
    renderSensors(s.sensors);
    renderPedestrianSensors(s.pedestrianSensors);
    renderTracked();
    parking.highlight((id) => s.parkings.some((p) => p.id === id && p.tracked));
    if (s.parkings.length) {
      const avg = s.parkings.reduce((sum, p) => sum + p.occupancy, 0) / s.parkings.length;
      parkingOccupancy.textContent = `Ocupación simulada de los P subterráneos: ${(avg * 100).toFixed(0)}%`;
    }
    recordsLabel.textContent = `Registros guardados: ${s.records.traffic} · cruces en el intervalo en curso y total entre paréntesis`;
    pedestrianStats.textContent = `En la calle (esperados): ${s.pedestrians.expected}`;
    pedestrianRecords.textContent = `Registros guardados: ${s.records.pedestrians} · presentes ahora cerca del sensor y total contado entre paréntesis`;
  });
  sync.on('disconnect', () => {
    state = null;
    sensorKey = null;
    pedestrianKey = null;
    trackKey = null;
    for (const id of [...server.view.markers.keys()]) server.view.remove(id);
    for (const id of [...pedestrianSensors.view.markers.keys()]) pedestrianSensors.view.remove(id);
    sensorList.replaceChildren();
    pedestrianList.replaceChildren();
    trackList.replaceChildren();
    if (getMode() === 'sensor' || getMode() === 'pedsensor') setMode('navigate');
  });

  let lastUpdate = 0;
  return {
    revealSignal,
    selectSensor,
    selectPedestrianSensor,
    removeSelectedSensor: () => {
      if (selectedSensorId) removeSensor(selectedSensorId);
      else if (selectedPedestrianSensorId) removePedestrianSensor(selectedPedestrianSensorId);
    },
    toggleParking,
    // Crea un sensor en el servidor en las coordenadas de escena indicadas.
    addServerSensor: (x, z) => run((c) => c.addSensor(x, z)),
    addPedestrianSensor: (x, z) => run((c) => c.addPedestrianSensor(x, z)),
    update(now) {
      if (now - lastUpdate < 250) return;
      lastUpdate = now;
      const active = getMode() === 'sensor';
      sensorModeButton.textContent = active ? 'Colocando en el servidor… (clic en una calle)' : 'Colocar sensor en el servidor';
      sensorModeButton.classList.toggle('active', active);
      sensorModeButton.disabled = !state;
      const placingPedestrian = getMode() === 'pedsensor';
      pedestrianModeButton.textContent = placingPedestrian ? 'Colocando en el servidor… (clic en una calle)' : 'Colocar sensor de peatones';
      pedestrianModeButton.classList.toggle('active', placingPedestrian);
      pedestrianModeButton.disabled = !state;

      const t = sync.simTime();
      if (t === null) {
        clockLabel.textContent = 'Sin conexión con el servidor';
        clockNote.textContent = '';
        return;
      }
      const d = simDate(t);
      const day = Math.floor(t / 86400) + 1;
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      clockLabel.textContent = `${WEEKDAYS[d.getUTCDay()]} ${d.toISOString().slice(0, 10)} ${hh}:${mm} (día ${day}) · ×${state.scale.toFixed(1)}`;
      clockNote.textContent = state.caughtUp ? 'Reloj virtual del servidor' : `Recuperando ${Math.round(state.behindSimSeconds / 3600)} h simuladas tras una parada`;
      scenarioLabel.textContent = `Escenario activo: ${scenarioNames[scenarioForTime(t, state.params.scenario)]}`;
      statsLabel.textContent = `Activos: ${state.cars} · Parados: ${state.traffic.stopped} · Vel. media: ${state.traffic.avgKmh.toFixed(1)} km/h · Demanda: ${(demandFactor(t, state.params.scenario) * 100).toFixed(0)}%`;
      const signalDate = simDate(t);
      for (const signal of signals.signals) {
        const inputs = signalInputs.get(signal.id);
        if (!inputs) continue;
        const timing = signals.timing(signal, t, signalDate);
        for (const [key, value] of Object.entries({ greenA: timing.gA, greenB: timing.gB, yellow: timing.y })) {
          if (inputs[key] !== document.activeElement) inputs[key].value = value;
        }
      }
    },
  };
}
