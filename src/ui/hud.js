import { CONFIG } from '../config.js';
import { demandFactor, simDate } from '../traffic/demand.js';

const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const SPEEDS = [
  ['⏸', 0],
  ['1x', 1],
  ['10x', 10],
  ['60x', 60],
  ['300x', 300],
  ['1000x', 1000],
];

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node[k] = v;
  }
  for (const c of children) node.append(c);
  return node;
}

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

export function createHud({ clock, params, sim, signals, sensors, setMode, getMode, focusSignal }) {
  const root = el('div', { id: 'hud' });
  document.body.append(root);

  const section = (title, ...children) => el('section', {}, el('h3', {}, title), ...children);

  // Reloj
  const clockLabel = el('div', { class: 'clock' });
  const speedButtons = SPEEDS.map(([label, value]) =>
    el('button', { textContent: label, onclick: () => (clock.scale = value) }),
  );
  const clockSection = section('Reloj', clockLabel, el('div', { class: 'row' }, ...speedButtons));

  // Tráfico
  const carsLabel = el('span');
  const carsInput = el('input', {
    type: 'range', min: 100, max: CONFIG.cars.max, step: 100, value: params.maxCars,
    oninput: () => (params.maxCars = Number(carsInput.value)),
  });
  const statsLabel = el('div', { class: 'stats' });
  const trafficSection = section('Tráfico', el('label', {}, 'Coches en hora punta: ', carsLabel), carsInput, statsLabel);

  // Semáforos
  const greenInput = el('input', { type: 'number', min: 5, max: 180, value: CONFIG.signals.green });
  const planStatus = el('div', { class: 'status' });
  const planUrl = el('input', { type: 'text', placeholder: 'URL del plan de semáforos (JSON)' });
  const signalCount = el('div', { class: 'status' });
  const signalList = el('div', { class: 'signal-list', id: 'signal-list' });
  const signalInputs = new Map();
  const signalEntries = new Map();
  let selectedSignalId = null;
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
    setListOpen(true);
    signalEntries.get(id)?.scrollIntoView({ block: 'nearest' });
  };
  signalToggle.setAttribute('aria-controls', 'signal-list');
  signalToggle.setAttribute('aria-expanded', 'false');
  const renderSignalList = () => {
    const activeSignals = signals.signals.filter((signal) => signal.active);
    signalCount.textContent = `Cruces configurables: ${activeSignals.length}`;
    signalInputs.clear();
    signalEntries.clear();
    signalList.replaceChildren(...activeSignals.map((signal) => {
      const timing = signals.timing(signal, clock.simTime);
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
            signals.setSignalTiming(signal.id, { [key]: Number(event.currentTarget.value) });
            signals.update(clock.simTime);
            renderSignalList();
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
  const applyPlan = (plan, label) => {
    try {
      signals.setPlan(plan);
      signals.update(clock.simTime);
      greenInput.value = signals.plan.default.green;
      renderSignalList();
      planStatus.textContent = `Plan cargado: ${label}`;
    } catch (err) {
      planStatus.textContent = `Plan no válido: ${err.message}`;
    }
  };
  const signalSection = section(
    'Semáforos',
    el('label', {}, 'Verde (s) para todos: ', greenInput),
    el('button', {
      textContent: 'Aplicar',
      onclick: () => {
        signals.setGlobalGreen(Number(greenInput.value) || CONFIG.signals.green);
        signals.update(clock.simTime);
        renderSignalList();
        planStatus.textContent = `Verde global: ${greenInput.value} s`;
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
            applyPlan(await res.json(), planUrl.value);
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
            applyPlan(JSON.parse(text), 'archivo');
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
  const modeButton = el('button', { class: 'primary', onclick: () => setMode(getMode() === 'sensor' ? 'navigate' : 'sensor') });
  const sensorList = el('div', { class: 'sensor-list' });
  const bucketSelect = el('select', {
    onchange: () => sensors.setBucketSeconds(Number(bucketSelect.value) * 60),
  }, ...[1, 5, 15, 30, 60].map((m) => el('option', { value: m, textContent: `${m} min`, selected: m * 60 === CONFIG.sensors.bucketSeconds })));
  const endpointInput = el('input', { type: 'text', placeholder: 'URL de la BigData (POST JSON)' });
  const autoSend = el('input', { type: 'checkbox' });
  const sendStatus = el('div', { class: 'status' });
  const recordsLabel = el('div', { class: 'status' });

  const sensorSection = section(
    'Sensores',
    modeButton,
    sensorList,
    el('label', {}, 'Intervalo de medida: ', bucketSelect),
    el('div', { class: 'row' },
      el('button', { textContent: 'Exportar CSV', onclick: () => download('trafico.csv', sensors.recordsCsv(), 'text/csv') }),
      el('button', { textContent: 'Exportar sensores', onclick: () => download('sensores.json', sensors.sensorsJson(), 'application/json') }),
      el('button', {
        textContent: 'Importar sensores',
        onclick: async () => {
          const text = await pickFile('.json,application/json');
          if (text === null) return;
          try {
            sensors.importJson(JSON.parse(text));
          } catch {
            sendStatus.textContent = 'Archivo de sensores no válido';
          }
        },
      }),
    ),
    recordsLabel,
    endpointInput,
    el('label', {}, autoSend, ' Enviar datos automáticamente'),
    sendStatus,
  );

  root.append(
    el('h2', {}, 'SmartCity Donostia'),
    clockSection, trafficSection, signalSection, sensorSection,
    el('p', { class: 'help' }, 'Ratón: arrastrar = girar, derecho = mover, rueda = zoom. Esc: salir del modo sensor. Supr: borrar sensor seleccionado.'),
  );

  const rows = new Map();
  function renderSensorList() {
    sensorList.replaceChildren();
    rows.clear();
    for (const s of sensors.sensors) {
      const name = el('input', {
        type: 'text', value: s.name, maxLength: 60,
        onchange: () => sensors.rename(s.id, name.value),
      });
      const count = el('span', { class: 'count', id: `count-${s.id}` });
      const del = el('button', { textContent: '✕', title: 'Borrar', onclick: () => sensors.remove(s.id) });
      const row = el('div', { class: 'sensor', onclick: () => sensors.select(s.id) }, name, count, del);
      rows.set(s.id, row);
      sensorList.append(row);
    }
    if (!sensors.sensors.length) sensorList.append(el('em', {}, 'Sin sensores. Activa el modo y haz clic sobre una calle.'));
  }
  sensors.onChange(renderSensorList);
  renderSensorList();

  async function flush() {
    if (!autoSend.checked || !endpointInput.value || !sensors.pending.length) return;
    const batch = sensors.pending.splice(0, sensors.pending.length);
    try {
      const res = await fetch(endpointInput.value, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      sendStatus.textContent = `Enviados ${batch.length} registros`;
    } catch (err) {
      sensors.pending.unshift(...batch);
      sendStatus.textContent = `Error de envío: ${err.message} (${sensors.pending.length} pendientes)`;
    }
  }
  setInterval(flush, 2000);

  let lastUpdate = 0;
  return {
    revealSignal,
    update(now) {
      if (now - lastUpdate < 250) return;
      lastUpdate = now;
      const d = simDate(clock.simTime);
      const day = Math.floor(clock.simTime / 86400) + 1;
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      clockLabel.textContent = `${WEEKDAYS[d.getUTCDay()]} ${hh}:${mm} (día ${day}) · ×${clock.scale}`;
      speedButtons.forEach((b, i) => b.classList.toggle('active', SPEEDS[i][1] === clock.scale));
      carsLabel.textContent = params.maxCars;
      const st = sim.stats();
      statsLabel.textContent = `Activos: ${st.active} · Parados: ${st.stopped} · Vel. media: ${st.avgKmh.toFixed(1)} km/h · Demanda: ${(demandFactor(clock.simTime) * 100).toFixed(0)}%`;
      modeButton.textContent = getMode() === 'sensor' ? 'Colocando sensores… (clic en una calle)' : 'Colocar sensores';
      modeButton.classList.toggle('active', getMode() === 'sensor');
      for (const s of sensors.sensors) {
        const c = document.getElementById(`count-${s.id}`);
        if (c) c.textContent = `${sensors.currentCount(s)} (${s.total})`;
        rows.get(s.id)?.classList.toggle('selected', s.id === sensors.selectedId);
      }
      recordsLabel.textContent = `Registros: ${sensors.records.length} · intervalo en curso`;
      const signalDate = simDate(clock.simTime);
      for (const signal of signals.signals) {
        const inputs = signalInputs.get(signal.id);
        if (!inputs) continue;
        const timing = signals.timing(signal, clock.simTime, signalDate);
        for (const [key, value] of Object.entries({ greenA: timing.gA, greenB: timing.gB, yellow: timing.y })) {
          if (inputs[key] !== document.activeElement) inputs[key].value = value;
        }
      }
    },
  };
}
