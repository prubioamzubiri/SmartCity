import { CONFIG } from '../config.js';
import { demandFactor, scenarioForTime, simDate } from '../traffic/demand.js';

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

export function createHud({ clock, params, sim, signals, sensors, setMode, getMode, experiment }) {
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
  const scenarioNames = { auto: 'Automático (calendario)', weekday: 'Laborable', weekend: 'Fin de semana' };
  const scenarioSelect = el('select', {
    onchange: () => (params.scenario = scenarioSelect.value),
  }, ...Object.entries(scenarioNames).map(([value, textContent]) =>
    el('option', { value, textContent, selected: value === params.scenario }),
  ));
  const scenarioLabel = el('div', { class: 'status' });
  const trafficSection = section('Tráfico',
    el('label', {}, 'Escenario: ', scenarioSelect), scenarioLabel,
    el('label', {}, 'Coches en hora punta: ', carsLabel), carsInput, statsLabel);

  // Semáforos
  const greenInput = el('input', { type: 'number', min: 5, max: 180, value: CONFIG.signals.green });
  const planStatus = el('div', { class: 'status' });
  const planUrl = el('input', { type: 'text', placeholder: 'URL del plan de semáforos (JSON)' });
  const applyPlan = (plan, label) => {
    if (experiment.status === 'running') return;
    try {
      signals.setPlan(plan);
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
        planStatus.textContent = `Verde global: ${greenInput.value} s`;
      },
    }),
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
          if (text === null || experiment.status === 'running') return;
          try {
            applyPlan(JSON.parse(text), 'archivo');
          } catch (err) {
            planStatus.textContent = `Archivo no válido: ${err.message}`;
          }
        },
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
          if (text === null || experiment.status === 'running') return;
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

  const controls = el('fieldset', { class: 'simulation-controls' }, trafficSection, signalSection, sensorSection);
  root.append(
    el('h2', {}, 'SmartCity Donostia'),
    clockSection, controls,
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
    if (experiment.status === 'running' || !autoSend.checked || !endpointInput.value || !sensors.pending.length) return;
    const recordsAtSend = sensors.records;
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
      if (sensors.records === recordsAtSend) sensors.pending.unshift(...batch);
      sendStatus.textContent = `Error de envío: ${err.message} (${sensors.pending.length} pendientes)`;
    }
  }
  setInterval(flush, 2000);

  let lastUpdate = 0;
  return {
    syncExperiment() {
      carsInput.value = params.maxCars;
      scenarioSelect.value = params.scenario;
      greenInput.value = signals.plan.default.green;
      planStatus.textContent = `Verde global: ${greenInput.value} s`;
      autoSend.checked = false;
    },
    update(now, force = false) {
      controls.disabled = experiment.status === 'running';
      if (!force && now - lastUpdate < 250) return;
      lastUpdate = now;
      const d = simDate(clock.simTime);
      const day = Math.floor(clock.simTime / 86400) + 1;
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      clockLabel.textContent = `${WEEKDAYS[d.getUTCDay()]} ${hh}:${mm} (día ${day}) · ×${clock.scale}`;
      speedButtons.forEach((b, i) => b.classList.toggle('active', SPEEDS[i][1] === clock.scale));
      carsLabel.textContent = params.maxCars;
      scenarioLabel.textContent = `Escenario activo: ${scenarioNames[scenarioForTime(clock.simTime, params.scenario)]}`;
      const st = sim.stats();
      statsLabel.textContent = `Activos: ${st.active} · Parados: ${st.stopped} · Vel. media: ${st.avgKmh.toFixed(1)} km/h · Demanda: ${(demandFactor(clock.simTime, params.scenario) * 100).toFixed(0)}%`;
      modeButton.textContent = getMode() === 'sensor' ? 'Colocando sensores… (clic en una calle)' : 'Colocar sensores';
      modeButton.classList.toggle('active', getMode() === 'sensor');
      for (const s of sensors.sensors) {
        const c = document.getElementById(`count-${s.id}`);
        if (c) c.textContent = `${sensors.currentCount(s)} (${s.total})`;
        rows.get(s.id)?.classList.toggle('selected', s.id === sensors.selectedId);
      }
      recordsLabel.textContent = `Registros: ${sensors.records.length} · intervalo en curso`;
    },
  };
}
