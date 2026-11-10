import { el } from './dom.js';

const TAB_KEY = 'smartcity.ui.tab';
const read = () => {
  try {
    return localStorage.getItem(TAB_KEY);
  } catch {
    return null;
  }
};
const write = (value) => {
  try {
    if (value) localStorage.setItem(TAB_KEY, value);
    else localStorage.removeItem(TAB_KEY);
  } catch {
    /* almacenamiento no disponible */
  }
};

/**
 * Armazón del panel lateral: barra de iconos a la izquierda y un panel con una sola sección visible.
 * Pulsar el icono de la sección abierta cierra el panel (más mapa). La sección abierta se recuerda.
 */
export function createShell() {
  const rail = el('nav', { class: 'ui-rail', 'aria-label': 'Secciones' });
  const header = el('div', { class: 'ui-header' });
  const body = el('div', { class: 'ui-body' });
  const title = el('h2', { class: 'ui-section-title' });
  const panel = el('section', { class: 'ui-panel' }, header, title, body);
  const root = el('div', { id: 'hud' }, rail, panel);
  document.body.append(root);

  const tabs = new Map();
  let current = null;

  function addTab(id, { icon, label, short = label, node, onShow }) {
    const button = el('button', { type: 'button', class: 'ui-rail-button', title: label, 'aria-pressed': 'false', onclick: () => show(current === id ? null : id) },
      el('span', { class: 'ui-rail-icon', textContent: icon, 'aria-hidden': 'true' }),
      el('span', { class: 'ui-rail-label', textContent: short }));
    const dot = el('span', { class: 'ui-rail-dot' });
    dot.hidden = true;
    button.append(dot);
    rail.append(button);
    node.hidden = true;
    body.append(node);
    tabs.set(id, { button, node, label, onShow, dot });
  }

  function show(id) {
    current = id && tabs.has(id) ? id : null;
    for (const [key, tab] of tabs) {
      const open = key === current;
      tab.node.hidden = !open;
      tab.button.setAttribute('aria-pressed', String(open));
    }
    panel.hidden = current === null;
    root.classList.toggle('collapsed', current === null);
    if (current) {
      title.textContent = tabs.get(current).label;
      body.scrollTop = 0;
      tabs.get(current).onShow?.();
    }
    write(current ?? 'none');
  }

  // Punto de aviso en el icono de una sección (p. ej. «sin conexión»).
  const flag = (id, on, kind = 'warn') => {
    const tab = tabs.get(id);
    if (!tab) return;
    tab.dot.hidden = !on;
    tab.dot.className = `ui-rail-dot ${kind}`;
  };

  return {
    root,
    header,
    addTab,
    show,
    flag,
    current: () => current,
    // Abre la última sección usada (o la indicada si no hay ninguna guardada).
    restore(fallback) {
      const saved = read();
      show(saved === 'none' ? null : saved && tabs.has(saved) ? saved : fallback);
    },
  };
}
