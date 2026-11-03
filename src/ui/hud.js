import { CONFIG } from '../config.js';
import { el } from './dom.js';
import { createServerPanel } from './serverPanel.js';
import { loadColor } from '../transit/buses.js';
import { demandFactor, scenarioForTime, simDate } from '../traffic/demand.js';
import { CONDITIONS } from '../weather/weather.js';

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
export function createHud({ sync, signals, localGraphKey, setMode, getMode, focusSignal, parking, server, pedestrianSensors, transit, bikes }) {
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
  const eventsLabel = el('div', { class: 'status' });
  const weatherLabel = el('div', { class: 'status' });
  const trafficSection = section('Tráfico (servidor)',
    el('label', {}, 'Escenario: ', scenarioSelect), scenarioLabel, eventsLabel, weatherLabel,
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

  // Transporte público: líneas de autobús, ocupación y paradas
  const hexColor = (c) => `#${c.toString(16).padStart(6, '0')}`;
  const transitToggle = el('input', { type: 'checkbox', checked: true, onchange: () => transit.view.setVisible(transitToggle.checked) });
  const transitSummary = el('div', { class: 'status' });
  const busRows = transit.buses.lines.map((line, li) => {
    const box = el('input', { type: 'checkbox', checked: true, onchange: () => transit.view.setLineVisible(li, box.checked) });
    const label = el('span', { class: 'bus-name' }, el('i', { style: `background:${hexColor(line.color)}` }), ` ${line.id} `);
    const info = el('span', { class: 'count' });
    const bar = el('span', { class: 'bus-load' }, el('b'));
    return { node: el('label', { class: 'bus-item' }, box, label, bar, info), info, fill: bar.firstChild };
  });
  const loadLegend = el('div', { class: 'legend' },
    legendItem(hexColor(loadColor(0)), 'Con sitio (< 50%)'),
    legendItem(hexColor(loadColor(0.5)), 'Bastante gente'),
    legendItem(hexColor(loadColor(1)), `Lleno (≥ ${Math.round(CONFIG.transit.fullAt * 100)}%)`),
    legendItem(hexColor(CONFIG.pedestrians.color), 'Esperando en la parada'),
  );
  // Líneas cuyo estado registra el servidor (una muestra cada `busTracking.intervalSeconds` simulados)
  const trackedBusIds = () => (state?.buses?.lines ?? []).filter((l) => l.tracked).map((l) => l.id);
  const setTrackedBuses = (ids) => run((c) => c.setTrackedBuses(ids));
  const busTrackBoxes = transit.buses.lines.map((line) => {
    const box = el('input', {
      type: 'checkbox',
      onchange: () => {
        const ids = new Set(trackedBusIds());
        if (!ids.delete(line.id)) ids.add(line.id);
        setTrackedBuses([...ids]);
      },
    });
    return { id: line.id, box, node: el('label', { class: 'bus-track' }, box, ` ${line.id}`) };
  });
  const busTracking = el('div', { class: 'parking-tracking' },
    el('h4', {}, 'Registro en el servidor'),
    el('div', { class: 'row' },
      el('button', { textContent: 'Todas', onclick: () => setTrackedBuses(transit.buses.lines.map((l) => l.id)) }),
      el('button', { textContent: 'Ninguna', onclick: () => setTrackedBuses([]) }),
    ),
    el('div', { class: 'bus-track-list' }, ...busTrackBoxes.map((b) => b.node)),
  );
  const transitSection = section(
    'Autobuses',
    el('label', {}, transitToggle, ' Mostrar líneas, paradas y autobuses'),
    transitSummary,
    transit.buses.lines.length ? el('div', { class: 'bus-list' }, ...busRows.map((r) => r.node)) : el('em', {}, 'Sin paradas de autobús en los datos.'),
    loadLegend,
    busTracking,
  );
  function renderBusTracking() {
    const tracked = new Set(trackedBusIds());
    for (const { id, box } of busTrackBoxes) if (box !== document.activeElement) box.checked = tracked.has(id);
  }
  function updateTransit() {
    const b = transit.buses;
    let buses = 0;
    let passengers = 0;
    let full = 0;
    b.lines.forEach((line, li) => {
      const st = b.stats[li];
      const occupancy = st.active ? st.passengers / (st.active * CONFIG.transit.capacity) : 0;
      busRows[li].info.textContent = `${st.active} bus · ${Math.round(occupancy * 100)}%${st.full ? ` · ${st.full} llenos` : ''}`;
      busRows[li].fill.style.width = `${Math.round(occupancy * 100)}%`;
      busRows[li].fill.style.background = hexColor(loadColor(occupancy));
      buses += st.active;
      passengers += st.passengers;
      full += st.full;
    });
    transitSummary.textContent = `${b.lines.length} líneas · ${buses} autobuses en servicio · ${passengers} pasajeros · ${full} autobuses llenos`;
  }

  // Estaciones OSM y disponibilidad estimada por el modelo de la simulación.
  const bikeToggle = el('input', {
    type: 'checkbox', checked: true,
    onchange: () => bikes.view.setVisible(bikeToggle.checked),
  });
  const bikeSummary = el('div', { class: 'status' });
  const bikeList = el('div', { class: 'bike-list' });
  const bikeRows = new Map();
  const bikeStations = bikes.stations ?? [];
  for (const station of bikeStations) {
    const focus = el('button', {
      class: 'bike-station-name',
      textContent: station.name,
      title: 'Ir a esta estación en el mapa',
      onclick: () => {
        bikes.focus(station);
        bikeRows.get(station.id)?.node.scrollIntoView({ block: 'nearest' });
      },
    });
    const osmId = station.id.split('/');
    const sourceLink = el('a', {
      class: 'signal-osm',
      textContent: station.source === 'osm' ? 'OSM' : 'GeoDonostia',
      href: station.source === 'osm'
        ? `https://www.openstreetmap.org/${encodeURIComponent(osmId[0])}/${encodeURIComponent(osmId[1])}`
        : 'https://www.donostia.eus/datuirekiak/katalogoa/bizikleta_dbizi',
      target: '_blank',
      rel: 'noopener noreferrer',
      title: station.source === 'osm' ? 'Abrir esta estación en OpenStreetMap' : 'Abrir el catálogo municipal Dbizi',
    });
    const count = el('span', { class: 'count' });
    const capacityInput = el('input', { type: 'number', min: 1, max: CONFIG.bicycles.maxCapacity, step: 1, class: 'bike-capacity', title: 'Anclajes de este puesto' });
    const schedule = el('button', {
      textContent: 'Programar',
      title: `Cambiar los anclajes: tarda ${CONFIG.bicycles.capacityDelaySeconds / 86400} días simulados en hacer efecto`,
      onclick: () => scheduleBikeCapacities({ [station.id]: Number(capacityInput.value) }),
    });
    const pendingLabel = el('span', { class: 'status' });
    const node = el('div', { class: 'bike-item' }, focus, sourceLink, count, capacityInput, schedule, pendingLabel);
    bikeRows.set(station.id, { node, count, capacityInput, pendingLabel });
    bikeList.append(node);
  }
  if (!bikeStations.length) {
    bikeList.append(el('em', {}, 'Sin estaciones en los datos. Ejecuta "npm run fetch-bikes".'));
  }
  const bikeJson = el('textarea', {
    class: 'bike-json', rows: 4, spellcheck: false,
    placeholder: '{ "municipal/0": 20, "municipal/5": 8 }',
  });
  const bikeCapacityNotice = el('div', { class: 'status' });
  const scheduleBikeCapacities = async (changes) => {
    try {
      await sync.act((client) => client.setBikeCapacities(changes));
      bikeCapacityNotice.textContent = `Cambio programado: se aplicará en ${CONFIG.bicycles.capacityDelaySeconds / 86400} días simulados.`;
      bikeCapacityNotice.style.color = '';
    } catch (err) {
      bikeCapacityNotice.textContent = err.message;
      bikeCapacityNotice.style.color = '#ff8a80';
    }
  };
  const bikeCapacityEditor = el('div', { class: 'parking-tracking' },
    el('h4', {}, `Anclajes por puesto (efecto en ${CONFIG.bicycles.capacityDelaySeconds / 86400} días simulados)`),
    bikeJson,
    el('div', { class: 'row' },
      el('button', {
        textContent: 'Cargar actuales',
        onclick: () => { bikeJson.value = JSON.stringify(Object.fromEntries(bikeStations.map((b) => [b.id, b.capacity])), null, 1); },
      }),
      el('button', {
        textContent: 'Aplicar JSON',
        onclick: () => {
          try {
            const changes = JSON.parse(bikeJson.value);
            scheduleBikeCapacities(changes);
          } catch {
            bikeCapacityNotice.textContent = 'JSON no válido. Formato: { "id del puesto": anclajes }';
            bikeCapacityNotice.style.color = '#ff8a80';
          }
        },
      }),
      el('button', { textContent: 'Cancelar pendientes', onclick: () => scheduleBikeCapacities(Object.fromEntries((state?.bikes?.stations ?? []).filter((b) => b.pending).map((b) => [b.id, null])) ) }),
    ),
    bikeCapacityNotice,
  );
  const trackedBikeIds = () => (state?.bikes?.stations ?? []).filter((b) => b.tracked).map((b) => b.id);
  const setTrackedBikes = (ids) => run((c) => c.setTrackedBikes(ids));
  const bikeTracking = el('div', { class: 'parking-tracking' },
    el('h4', {}, 'Registro en el servidor'),
    el('div', { class: 'row' },
      el('button', { textContent: 'Todas', onclick: () => setTrackedBikes(bikeStations.map((b) => b.id)) }),
      el('button', { textContent: 'Ninguna', onclick: () => setTrackedBikes([]) }),
    ),
    el('div', { class: 'status' }, 'Una muestra cada 15 min simulados por puesto (bicicletas, anclajes libres, cogidas y devueltas).'),
  );
  const bikeSection = section(
    'Bicicletas compartidas',
    el('label', {}, bikeToggle, ' Mostrar estaciones'),
    bikeSummary,
    bikeList,
    bikeCapacityEditor,
    bikeTracking,
    el('div', { class: 'status' },
      el('span', {}, el('i', { style: 'background:#4fc3f7' }), ' Peatones en bici: ×4 de velocidad. '),
      'Los peatones cogen y dejan las bicicletas por sí solos; el servidor lleva la cuenta de cada puesto. Son estimaciones de la simulación, no sensores físicos. Ubicaciones OSM o del catálogo GeoDonostia; para lecturas reales hay que integrar al operador o instalar sensores.'),
    el('a', {
      class: 'signal-osm',
      textContent: '© OpenStreetMap contributors',
      href: 'https://www.openstreetmap.org/copyright',
      target: '_blank',
      rel: 'noopener noreferrer',
    }),
    el('a', {
      class: 'signal-osm',
      textContent: '© Ayuntamiento de Donostia / GeoDonostia (CC BY 4.0)',
      href: 'https://www.donostia.eus/datuirekiak/katalogoa/bizikleta_dbizi',
      target: '_blank',
      rel: 'noopener noreferrer',
    }),
  );
  const updateBikes = () => {
    const live = state?.bikes;
    let available = 0;
    let capacity = 0;
    for (const station of bikeStations) {
      const row = bikeRows.get(station.id);
      if (station.available === undefined) {
        row.count.textContent = 'sin datos';
        continue;
      }
      available += station.available;
      capacity += station.capacity;
      row.count.textContent = `${station.available}/${station.capacity}${station.estimatedCapacity ? ' · cap. est.' : ''}`;
      if (row.capacityInput !== document.activeElement) row.capacityInput.value = station.pending?.capacity ?? station.capacity;
      const t = sync.simTime();
      const days = station.pending && t !== null ? Math.max(0, Math.ceil((station.pending.effectiveAt - t) / 86400)) : null;
      row.pendingLabel.textContent = station.pending ? `→ ${station.pending.capacity} en ${days} d` : '';
    }
    bikeSummary.textContent = !bikeStations.length
      ? 'Sin puestos cargados.'
      : live
        ? `${bikeStations.length} puestos · ${available}/${capacity} bicicletas disponibles · ${live.inUse} en circulación (peatones)`
        : `${bikeStations.length} puestos · sin conexión con el servidor`;
  };
  const revealBikeStation = (id) => {
    bikeSection.open = true;
    bikeRows.get(id)?.node.scrollIntoView({ block: 'nearest' });
  };

  root.append(
    el('h2', {}, 'SmartCity Donostia'),
    serverPanel.node, clockSection, trafficSection, signalSection, sensorSection, pedestrianSection, transitSection, bikeSection, parkingSection,
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
    renderBusTracking();
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
    revealBikeStation,
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
      updateTransit();
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
        updateBikes();
        clockLabel.textContent = 'Sin conexión con el servidor';
        clockNote.textContent = '';
        return;
      }
      updateBikes();
      const d = simDate(t);
      const day = Math.floor(t / 86400) + 1;
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      clockLabel.textContent = `${WEEKDAYS[d.getUTCDay()]} ${d.toISOString().slice(0, 10)} ${hh}:${mm} (día ${day}) · ×${state.scale.toFixed(1)}`;
      clockNote.textContent = state.caughtUp ? 'Reloj virtual del servidor' : `Recuperando ${Math.round(state.behindSimSeconds / 3600)} h simuladas tras una parada`;
      scenarioLabel.textContent = `Escenario activo: ${scenarioNames[scenarioForTime(t, state.params.scenario)]}`;
      const w = state.weather;
      weatherLabel.textContent = w ? `Tiempo: ${CONDITIONS[w.condition].icon} ${CONDITIONS[w.condition].label}, ${w.temperature_c.toFixed(0)} °C (previsión arriba a la derecha)` : '';
      const events = state.events;
      eventsLabel.textContent = events?.active.length
        ? `Eventos en curso: ${events.active.map((e) => e.name).join(', ')} · +${(events.boost * 100).toFixed(0)} % de demanda`
        : 'Sin eventos en curso (calendario arriba a la derecha)';
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
