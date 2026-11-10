import { CONFIG } from '../../config.js';
import { el } from '../dom.js';
import { button, card, cardTitle, field, hint } from '../widgets.js';

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

// Conexión con el servidor de simulación: dirección y token (necesario para cambiar la ciudad).
export function createConnectionTab(ctx) {
  const url = el('input', { type: 'url', placeholder: 'https://mi-ciudad.example.com', value: readStorage(localStorage, CONFIG.server.urlKey) || CONFIG.server.url });
  // El token solo se guarda en la sesión del navegador (se borra al cerrar la pestaña).
  const token = el('input', { type: 'password', autocomplete: 'off', placeholder: 'Solo si el servidor lo pide', value: readStorage(sessionStorage, TOKEN_KEY) });
  const status = el('div', { class: 'ui-status' });

  function connect() {
    try {
      ctx.sync.connect(url.value, token.value);
    } catch (err) {
      ctx.toast(err.message, 'error');
      return;
    }
    writeStorage(localStorage, CONFIG.server.urlKey, ctx.sync.client.baseUrl);
    writeStorage(sessionStorage, TOKEN_KEY, token.value);
    status.textContent = 'Conectando…';
  }

  const node = el('div', {},
    card(cardTitle('Servidor'),
      hint('El visor muestra lo que simula el servidor, que sigue funcionando aunque cierres la web (una semana real = un año simulado).'),
      field('Dirección', url),
      field('Token', token, 'Lo da el profesor. Sin él puedes mirar, pero no cambiar nada. Se olvida al cerrar la pestaña.'),
      el('div', { class: 'ui-row' }, button('Conectar', connect, 'primary'), button('Desconectar', () => ctx.sync.disconnect(), 'ghost')),
      status),
    card(cardTitle('Ayuda'),
      hint('¿Qué puedo cambiar? Restricciones de calles, semáforos, autobuses por línea, anclajes de bicis y qué se registra. Todo también desde un programa con la API.'),
      button('Abrir la guía de la API', () => ctx.openDocs(), 'ghost')));

  return {
    node,
    url: () => url.value,
    token: () => token.value,
    autoconnect() {
      if (url.value) connect();
      return Boolean(url.value);
    },
    setStatus(text, kind = '') {
      status.textContent = text;
      status.className = `ui-status ${kind}`;
    },
  };
}
