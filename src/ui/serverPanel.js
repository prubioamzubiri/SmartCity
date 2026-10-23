import { CONFIG } from '../config.js';
import { ApiClient, nextDay } from '../api/client.js';
import { el } from './dom.js';

const readStorage = (storage, key) => {
  try {
    return storage.getItem(key) ?? '';
  } catch {
    return '';
  }
};
const writeStorage = (storage, key, value) => {
  try {
    if (value) storage.setItem(key, value);
    else storage.removeItem(key);
  } catch {
    /* almacenamiento no disponible */
  }
};

const TOKEN_KEY = 'smartcity.server.token';

// Sección del HUD que conecta con el servidor de simulación continua (sensores, estado y CSV).
export function createServerPanel({ section, clock, sensors, tracker, view, setMode, getMode }) {
  let client = null;
  let timer = null;
  let lastState = null;

  const urlInput = el('input', { type: 'text', placeholder: 'https://mi-app.fly.dev', value: readStorage(localStorage, CONFIG.server.urlKey) || CONFIG.server.url });
  // El token solo se guarda en la sesión del navegador (se borra al cerrar la pestaña).
  const tokenInput = el('input', { type: 'password', placeholder: 'Token (opcional)', autocomplete: 'off', value: readStorage(sessionStorage, TOKEN_KEY) });
  const status = el('div', { class: 'status' });
  const info = el('div', { class: 'status' });
  const sensorList = el('div', { class: 'sensor-list' });
  const modeButton = el('button', { class: 'primary', disabled: true, onclick: () => setMode(getMode() === 'server-sensor' ? 'navigate' : 'server-sensor') });
  const sensorFilter = el('select', {}, el('option', { value: '', textContent: 'Todos los sensores' }));
  const fromInput = el('input', { type: 'date' });
  const toInput = el('input', { type: 'date' });
  const actions = [];
  const guarded = (button) => {
    button.disabled = true;
    actions.push(button);
    return button;
  };

  const say = (text, isError = false) => {
    status.textContent = text;
    status.style.color = isError ? '#ff8a80' : '';
  };

  async function refresh() {
    if (!client) return;
    try {
      lastState = await client.state();
      say(`Conectado · ${lastState.caughtUp ? 'al día' : `recuperando ${Math.round(lastState.behindSimSeconds / 3600)} h simuladas`}`);
      renderState();
    } catch (err) {
      say(`Sin conexión: ${err.message}`, true);
    }
  }

  function renderState() {
    const s = lastState;
    info.textContent = `Hora del servidor: ${s.simTime.replace('T', ' ')} · ×${s.scale.toFixed(1)} · coches: ${s.cars} · registros: ${s.records.traffic} tráfico, ${s.records.parking} parkings`;
    const ids = new Set(s.sensors.map((x) => x.id));
    for (const id of [...view.markers.keys()]) if (!ids.has(id)) view.remove(id);
    for (const sensor of s.sensors) if (!view.markers.has(sensor.id)) view.add(sensor);
    sensorList.replaceChildren();
    for (const sensor of s.sensors) {
      const name = el('input', { type: 'text', value: sensor.name, maxLength: 60 });
      name.addEventListener('change', () => run(() => client.renameSensor(sensor.id, name.value)));
      const del = el('button', { textContent: '✕', title: 'Borrar del servidor (el histórico se conserva)', onclick: () => run(() => client.removeSensor(sensor.id)) });
      sensorList.append(el('div', { class: 'sensor' }, name, el('span', { class: 'count', textContent: String(sensor.total) }), del));
    }
    if (!s.sensors.length) sensorList.append(el('em', {}, 'Sin sensores en el servidor.'));
    const selected = sensorFilter.value;
    sensorFilter.replaceChildren(el('option', { value: '', textContent: 'Todos los sensores' }),
      ...s.sensors.map((x) => el('option', { value: x.id, textContent: x.name })));
    sensorFilter.value = ids.has(selected) ? selected : '';
  }

  async function run(action) {
    try {
      await action();
      await refresh();
    } catch (err) {
      say(err.message, true);
    }
  }

  function connect() {
    disconnect();
    try {
      client = new ApiClient({ baseUrl: urlInput.value, token: tokenInput.value });
      if (!client.baseUrl) throw new Error('Introduce la URL del servidor');
    } catch (err) {
      client = null;
      say(err.message, true);
      return;
    }
    writeStorage(localStorage, CONFIG.server.urlKey, client.baseUrl);
    writeStorage(sessionStorage, TOKEN_KEY, tokenInput.value);
    for (const b of actions) b.disabled = false;
    modeButton.disabled = false;
    say('Conectando…');
    refresh();
    timer = setInterval(refresh, CONFIG.server.pollSeconds * 1000);
  }

  function disconnect() {
    clearInterval(timer);
    timer = null;
    client = null;
    lastState = null;
    for (const b of actions) b.disabled = true;
    modeButton.disabled = true;
    for (const id of [...view.markers.keys()]) view.remove(id);
    if (getMode() === 'server-sensor') setMode('navigate');
    sensorList.replaceChildren();
    info.textContent = '';
    say('Desconectado');
  }

  function download(kind) {
    try {
      const to = toInput.value ? nextDay(toInput.value) : undefined;
      const url = client.csvUrl(kind, { from: fromInput.value || undefined, to, id: kind === 'traffic' ? sensorFilter.value : '' });
      el('a', { href: url, download: '' }).click();
    } catch (err) {
      say(err.message, true);
    }
  }

  const node = section(
    'Servidor (datos continuos)',
    el('div', { class: 'status', textContent: 'La simulación del servidor sigue corriendo con la web cerrada (1 semana real = 1 año simulado).' }),
    urlInput,
    tokenInput,
    el('div', { class: 'row' },
      el('button', { textContent: 'Conectar', onclick: connect }),
      el('button', { textContent: 'Desconectar', onclick: disconnect }),
    ),
    status,
    info,
    modeButton,
    sensorList,
    el('div', { class: 'row' },
      guarded(el('button', {
        textContent: 'Usar hora del servidor',
        title: 'Ajusta el reloj local a la hora y velocidad del servidor',
        onclick: async () => {
          await refresh();
          if (!lastState) return;
          clock.simTime = lastState.simSeconds;
          clock.scale = lastState.scale;
          sensors.setBucketSeconds(sensors.bucketSeconds);
          tracker.setIntervalSeconds(tracker.intervalSeconds, clock.simTime);
        },
      })),
      guarded(el('button', {
        textContent: 'Enviar parkings seguidos',
        title: 'Los parkings marcados en el mapa pasan a registrarse en el servidor',
        onclick: () => run(() => client.setTrackedParkings([...tracker.tracked])),
      })),
    ),
    el('label', {}, 'Desde (hora simulada): ', fromInput),
    el('label', {}, 'Hasta (incluido): ', toInput),
    el('label', {}, 'Sensor: ', sensorFilter),
    el('div', { class: 'row' },
      guarded(el('button', { textContent: 'CSV de tráfico', onclick: () => download('traffic') })),
      guarded(el('button', { textContent: 'CSV de parkings', onclick: () => download('parking') })),
    ),
  );

  if (urlInput.value) connect();

  return {
    node,
    // Crea un sensor en el servidor en las coordenadas de escena indicadas.
    addSensor: (x, z) => run(() => client.addSensor(x, z)),
    update() {
      const active = getMode() === 'server-sensor';
      modeButton.textContent = active ? 'Colocando en el servidor… (clic en una calle)' : 'Colocar sensor en el servidor';
      modeButton.classList.toggle('active', active);
    },
  };
}
