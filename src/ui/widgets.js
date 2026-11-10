import { el } from './dom.js';

// Piezas de interfaz del panel lateral. Todas devuelven nodos DOM; el estilo está en style.css (prefijo `ui-`).

export const card = (...children) => el('div', { class: 'ui-card' }, ...children);

export const cardTitle = (text, ...extra) => el('div', { class: 'ui-card-title' }, el('span', { textContent: text }), ...extra);

export const hint = (text) => el('p', { class: 'ui-hint', textContent: text });

// Indicador grande: valor y etiqueta. Devuelve { node, set(value, sub?) }.
export function stat(label) {
  const value = el('div', { class: 'ui-stat-value', textContent: '—' });
  const sub = el('div', { class: 'ui-stat-sub' });
  const node = el('div', { class: 'ui-stat' }, value, el('div', { class: 'ui-stat-label', textContent: label }), sub);
  return {
    node,
    set(v, subText = '') {
      value.textContent = v;
      sub.textContent = subText;
    },
  };
}

// Botones de opción excluyentes. options: [{ value, label, title? }]. Devuelve { node, set(value), get() }.
export function segmented(options, onChange, { ariaLabel = '' } = {}) {
  let current = null;
  const buttons = options.map((o) => el('button', {
    type: 'button', textContent: o.label, title: o.title ?? '',
    onclick: () => {
      if (o.value === current) return;
      set(o.value);
      onChange(o.value);
    },
  }));
  const node = el('div', { class: 'ui-segmented', role: 'group' }, ...buttons);
  if (ariaLabel) node.setAttribute('aria-label', ariaLabel);
  function set(value) {
    current = value;
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i].value === value)));
  }
  return { node, set, get: () => current, buttons };
}

// Número con botones − y + (y campo editable). Devuelve { node, set(value), input }.
export function stepper({ min, max, step = 1, value = min, onChange, label = '' }) {
  const input = el('input', { type: 'number', min, max, step, value, class: 'ui-stepper-input' });
  if (label) input.setAttribute('aria-label', label);
  const clamp = (v) => Math.max(min, Math.min(max, v));
  const commit = (v) => {
    const next = clamp(Math.round(v / step) * step);
    input.value = next;
    onChange(next);
  };
  const minus = el('button', { type: 'button', textContent: '−', title: 'Menos', onclick: () => commit(Number(input.value) - step) });
  const plus = el('button', { type: 'button', textContent: '+', title: 'Más', onclick: () => commit(Number(input.value) + step) });
  input.addEventListener('change', () => commit(Number(input.value) || min));
  const node = el('div', { class: 'ui-stepper' }, minus, input, plus);
  return {
    node,
    input,
    set(v) {
      if (document.activeElement !== input) input.value = v;
    },
    setDisabled(disabled) {
      minus.disabled = plus.disabled = input.disabled = disabled;
    },
  };
}

// Interruptor con texto. Devuelve { node, input }.
export function toggle(text, checked, onChange) {
  const input = el('input', { type: 'checkbox', checked, onchange: () => onChange(input.checked) });
  const node = el('label', { class: 'ui-toggle' }, input, el('span', { class: 'ui-toggle-track' }), el('span', { textContent: text }));
  return { node, input };
}

export const badge = (text, kind = '') => el('span', { class: `ui-badge ${kind}`.trim(), textContent: text });

// Campo con etiqueta encima y ayuda opcional debajo.
export const field = (label, control, help = '') =>
  el('label', { class: 'ui-field' }, el('span', { class: 'ui-field-label', textContent: label }), control, help ? el('span', { class: 'ui-field-help', textContent: help }) : '');

export const button = (text, onclick, kind = '') => el('button', { type: 'button', class: `ui-button ${kind}`.trim(), textContent: text, onclick });

export const empty = (text) => el('div', { class: 'ui-empty', textContent: text });

// Barra de ocupación 0..1 con color. Devuelve { node, set(fraction, color) }.
export function meter() {
  const fill = el('b');
  const node = el('span', { class: 'ui-meter' }, fill);
  return {
    node,
    set(fraction, color) {
      fill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
      if (color) fill.style.background = color;
    },
  };
}

// Avisos emergentes abajo en el centro: éxito, error o información.
let toastHost = null;
export function toast(text, kind = 'info', ms = 3500) {
  if (!toastHost) {
    toastHost = el('div', { class: 'ui-toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const node = el('div', { class: `ui-toast ${kind}`, textContent: text });
  toastHost.append(node);
  setTimeout(() => node.classList.add('leaving'), ms);
  setTimeout(() => node.remove(), ms + 300);
}
