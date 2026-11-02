import { CONFIG } from '../config.js';
import { nextDay } from '../api/client.js';
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

// Conexión con el servidor de simulación y descarga de sus CSV.
export function createServerPanel({ section, sync, localGraphKey }) {
  const urlInput = el('input', { type: 'text', placeholder: 'https://mi-app.fly.dev', value: readStorage(localStorage, CONFIG.server.urlKey) || CONFIG.server.url });
  // El token solo se guarda en la sesión del navegador (se borra al cerrar la pestaña).
  const tokenInput = el('input', { type: 'password', placeholder: 'Token (necesario para modificar)', autocomplete: 'off', value: readStorage(sessionStorage, TOKEN_KEY) });
  const status = el('div', { class: 'status' });
  const info = el('div', { class: 'status' });
  const sensorFilter = el('select', {}, el('option', { value: '', textContent: 'Todos los sensores' }));
  const fromInput = el('input', { type: 'date' });
  const toInput = el('input', { type: 'date' });
  const downloads = [];
  const guarded = (button) => {
    button.disabled = true;
    downloads.push(button);
    return button;
  };

  const say = (text, isError = false) => {
    status.textContent = text;
    status.style.color = isError ? '#ff8a80' : '';
  };

  function connect() {
    try {
      sync.connect(urlInput.value, tokenInput.value);
    } catch (err) {
      say(err.message, true);
      return;
    }
    writeStorage(localStorage, CONFIG.server.urlKey, sync.client.baseUrl);
    writeStorage(sessionStorage, TOKEN_KEY, tokenInput.value);
    say('Conectando…');
  }

  function download(kind) {
    try {
      const to = toInput.value ? nextDay(toInput.value) : undefined;
      const url = sync.client.csvUrl(kind, { from: fromInput.value || undefined, to, id: kind === 'parking' ? '' : sensorFilter.value });
      el('a', { href: url, download: '' }).click();
    } catch (err) {
      say(err.message, true);
    }
  }

  sync.on('state', (s) => {
    for (const b of downloads) b.disabled = false;
    if (s.graphKey !== localGraphKey) {
      say('El servidor simula otra ciudad distinta a la del visor: los coches no se dibujan', true);
    } else {
      say(s.caughtUp ? 'Conectado · al día' : `Conectado · recuperando ${Math.round(s.behindSimSeconds / 3600)} h simuladas`);
    }
    info.textContent = `Registros en el servidor: ${s.records.traffic} tráfico, ${s.records.pedestrians} peatones, ${s.records.parking} parkings`;
    const selected = sensorFilter.value;
    sensorFilter.replaceChildren(el('option', { value: '', textContent: 'Todos los sensores' }),
      ...s.sensors.map((x) => el('option', { value: x.id, textContent: x.name })),
      ...s.pedestrianSensors.map((x) => el('option', { value: x.id, textContent: `Peatones: ${x.name}` })));
    sensorFilter.value = [...s.sensors, ...s.pedestrianSensors].some((x) => x.id === selected) ? selected : '';
  });
  sync.on('error', (err) => say(`Sin conexión: ${err.message}`, true));
  sync.on('disconnect', () => {
    for (const b of downloads) b.disabled = true;
    info.textContent = '';
    say('Desconectado');
  });

  const node = section(
    'Servidor (datos continuos)',
    el('div', { class: 'status', textContent: 'Todo lo que muestra el visor viene del servidor, que sigue simulando con la web cerrada (1 semana real = 1 año simulado).' }),
    urlInput,
    tokenInput,
    el('div', { class: 'row' },
      el('button', { textContent: 'Conectar', onclick: connect }),
      el('button', { textContent: 'Desconectar', onclick: () => sync.disconnect() }),
    ),
    status,
    info,
    el('label', {}, 'Desde (hora simulada): ', fromInput),
    el('label', {}, 'Hasta (incluido): ', toInput),
    el('label', {}, 'Sensor: ', sensorFilter),
    el('div', { class: 'row' },
      guarded(el('button', { textContent: 'CSV de tráfico', onclick: () => download('traffic') })),
      guarded(el('button', { textContent: 'CSV de peatones', onclick: () => download('pedestrians') })),
      guarded(el('button', { textContent: 'CSV de parkings', onclick: () => download('parking') })),
    ),
  );

  if (urlInput.value) connect();
  else say('Introduce la URL del servidor y pulsa Conectar');

  return { node, say };
}
