import { CONFIG } from '../../config.js';
import { el } from '../dom.js';
import { badge, button, card, cardTitle, empty, field, hint, segmented, stepper } from '../widgets.js';

const MODES = [
  { value: 'normal', label: 'Normal', title: 'Ciclo de verde, ámbar y rojo' },
  { value: 'off', label: 'Apagado', title: 'Cruce sin regular: los coches ceden el paso; los peatones cruzan cuando hay hueco' },
  { value: 'flashing', label: 'Ámbar', title: 'Ámbar intermitente: cruce sin regular con prioridad para los peatones' },
  { value: 'all_red', label: 'Rojo', title: 'Todo en rojo: todos se detienen' },
];
const MODE_LABEL = Object.fromEntries(MODES.map((m) => [m.value, m.label]));

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  el('a', { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

function pickFile() {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept: '.json,application/json' });
    input.addEventListener('change', async () => resolve(input.files[0] ? await input.files[0].text() : null));
    input.click();
  });
}

const TEMPLATE = {
  default: {
    green: CONFIG.signals.green,
    yellow: CONFIG.signals.yellow,
    schedule: [{ when: { weekdays: [1, 2, 3, 4, 5], start: '07:00', end: '09:00' }, green: 30 }],
  },
  signals: { 123456789: { schedule: [{ when: { weekdays: [1, 2, 3, 4, 5], start: '16:00', end: '18:00' }, greenA: 20, greenB: 35 }] } },
};

// Semáforos: el seleccionado (clic en el mapa o en la lista), el plan general, la lista y el plan en JSON.
export function createSignalsTab(ctx) {
  const { signals } = ctx;
  const active = () => signals.signals.filter((s) => s.active);
  let selected = null;

  // --- Semáforo seleccionado ---
  const selTitle = el('span');
  const selLinks = el('span', { class: 'ui-links' });
  const selBadges = el('div', { class: 'ui-badges' });
  const send = (settings, ok) => ctx.run((c) => c.setSignal(selected, settings), ok);
  const mode = segmented(MODES, (m) => send({ mode: m === 'normal' ? null : m }, `Semáforo ${selected}: ${MODE_LABEL[m]}`), { ariaLabel: 'Modo del semáforo' });
  const timing = (key, label, min, max) => stepper({ min, max, label, onChange: (v) => send({ [key]: v }, `Semáforo ${selected}: ${label.toLowerCase()} ${v} s`) });
  const greenA = timing('greenA', 'Verde este-oeste', 5, 180);
  const greenB = timing('greenB', 'Verde norte-sur', 5, 180);
  const yellow = timing('yellow', 'Ámbar', 1, 10);
  const timings = el('div', { class: 'ui-grid3' },
    field('Verde E-O (s)', greenA.node), field('Verde N-S (s)', greenB.node), field('Ámbar (s)', yellow.node));
  const scheduleNote = hint('');
  const resetButton = button('Volver al plan general', () => send({ reset: true }, `Semáforo ${selected}: plan general`), 'ghost');
  const editor = el('div', {},
    field('Modo', mode.node), timings, scheduleNote, el('div', { class: 'ui-row' }, resetButton));
  const selEmpty = empty('Haz clic en un semáforo del mapa (los puntos de colores en los cruces) o elige uno de la lista.');
  const selCard = card(cardTitle('Semáforo seleccionado', selLinks), selTitle, selBadges, selEmpty, editor);

  // --- Plan general (todos los que no tienen ajustes propios) ---
  const sendPlan = (plan, ok) => ctx.run((c) => c.setSignalPlan(plan), ok);
  const general = (patch, ok) => sendPlan({ default: { ...signals.plan.default, ...patch }, signals: signals.plan.signals }, ok);
  const defMode = segmented(MODES, (m) => general({ mode: m === 'normal' ? undefined : m }, `Todos los semáforos: ${MODE_LABEL[m]}`), { ariaLabel: 'Modo general' });
  const defGreen = stepper({ min: 5, max: 180, label: 'Verde general', onChange: (v) => general({ green: v }, `Verde general: ${v} s`) });
  const defYellow = stepper({ min: 1, max: 10, label: 'Ámbar general', onChange: (v) => general({ yellow: v }, `Ámbar general: ${v} s`) });
  const overridesInfo = el('span', { class: 'ui-muted' });
  const clearAll = button('Quitar todos los ajustes propios', () => sendPlan({ default: signals.plan.default, signals: {} }, 'Todos los semáforos siguen el plan general'), 'ghost danger');
  const generalCard = card(cardTitle('Todos los semáforos'),
    hint('Se aplica a los semáforos sin ajustes propios.'),
    field('Modo', defMode.node),
    el('div', { class: 'ui-grid2' }, field('Verde (s)', defGreen.node), field('Ámbar (s)', defYellow.node)),
    el('div', { class: 'ui-row' }, overridesInfo, clearAll));

  // --- Lista ---
  const search = el('input', { type: 'search', placeholder: 'Buscar por número…', oninput: () => renderList() });
  const onlyOwn = el('input', { type: 'checkbox', onchange: () => renderList() });
  const list = el('div', { class: 'ui-list' });
  const listCard = card(cardTitle('Lista de semáforos'),
    el('div', { class: 'ui-row' }, search, el('label', { class: 'ui-check' }, onlyOwn, ' Solo con ajustes propios')), list);

  function renderList() {
    const q = search.value.trim();
    const rows = active().filter((s) => (!q || String(s.id).includes(q)) && (!onlyOwn.checked || signals.plan.signals[s.id]));
    list.replaceChildren(...rows.slice(0, 200).map((s) => {
      const own = signals.plan.signals[s.id];
      const t = signals.timing(s, ctx.simNow());
      const m = signals.modeOf(s);
      return el('button', { type: 'button', class: `ui-list-row${s.id === selected ? ' selected' : ''}`, onclick: () => select(s.id, true) },
        el('span', { textContent: `Semáforo ${s.id}` }),
        m !== 'normal' ? badge(MODE_LABEL[m], m === 'all_red' ? 'danger' : 'warn') : el('span', { class: 'ui-muted', textContent: `${t.gA}/${t.gB}/${t.y} s` }),
        own ? badge('propio', 'info') : '');
    }));
    if (!rows.length) list.append(empty('Ningún semáforo coincide.'));
    else if (rows.length > 200) list.append(hint(`Se muestran 200 de ${rows.length}: busca por número para encontrar otros.`));
  }

  // --- Plan en JSON ---
  const planUrl = el('input', { type: 'url', placeholder: 'https://…/plan.json' });
  const advanced = el('details', { class: 'ui-card ui-details' },
    el('summary', { textContent: 'Avanzado: plan completo en JSON' }),
    hint('Un plan con horarios (p. ej. más verde en hora punta) se escribe en JSON. Descarga la plantilla, edítala y cárgala.'),
    field('Cargar desde una URL', el('div', { class: 'ui-row' }, planUrl, button('Cargar', async () => {
      try {
        const res = await fetch(planUrl.value);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await sendPlan(await res.json(), 'Plan cargado');
      } catch (err) {
        ctx.toast(`No se pudo cargar: ${err.message}`, 'error');
      }
    }))),
    el('div', { class: 'ui-row' },
      button('Cargar archivo', async () => {
        const text = await pickFile();
        if (text === null) return;
        try {
          await sendPlan(JSON.parse(text), 'Plan cargado desde el archivo');
        } catch (err) {
          ctx.toast(`Archivo no válido: ${err.message}`, 'error');
        }
      }),
      button('Plantilla', () => download('plantilla-semaforos.json', JSON.stringify(TEMPLATE, null, 2)), 'ghost'),
      button('Plan actual', () => download('plan-semaforos.json', JSON.stringify(signals.plan, null, 2)), 'ghost')));

  function renderSelected() {
    const s = selected === null ? null : signals.signals.find((x) => x.id === selected);
    selEmpty.hidden = Boolean(s);
    editor.hidden = selTitle.hidden = selBadges.hidden = !s;
    selLinks.replaceChildren();
    if (!s) return;
    selTitle.textContent = `Semáforo ${s.id}`;
    selTitle.className = 'ui-big';
    selLinks.append(
      el('button', { type: 'button', class: 'ui-link', textContent: 'Ver en el mapa', onclick: () => ctx.focusSignal(s) }),
      el('a', { class: 'ui-link', textContent: 'OSM', href: `https://www.openstreetmap.org/node/${s.id}`, target: '_blank', rel: 'noopener noreferrer' }));
    const own = signals.plan.signals[s.id];
    const m = signals.modeOf(s);
    mode.set(m);
    const t = signals.timing(s, ctx.simNow());
    greenA.set(t.gA);
    greenB.set(t.gB);
    yellow.set(t.y);
    timings.hidden = m !== 'normal';
    selBadges.replaceChildren(own ? badge('Con ajustes propios', 'info') : badge('Sigue el plan general'), badge(`Ciclo ${t.gA + t.gB + 2 * t.y} s`));
    const rules = own?.schedule?.length ?? 0;
    scheduleNote.textContent = rules ? `Tiene ${rules} regla(s) por horario: los tiempos mostrados son los de ahora. Para editarlas usa el plan en JSON.` : '';
    scheduleNote.hidden = !rules;
    resetButton.hidden = !own;
  }

  function select(id, focus = false) {
    selected = id;
    renderSelected();
    renderList();
    if (focus) {
      const s = signals.signals.find((x) => x.id === id);
      if (s) ctx.focusSignal(s);
    }
  }

  let planKey = '';
  const node = el('div', {}, selCard, generalCard, listCard, advanced);
  renderSelected();
  renderList();
  return {
    node,
    select,
    onState(s) {
      const key = JSON.stringify(s.signalPlan);
      const writable = ctx.canWrite();
      for (const c of [...mode.buttons, ...defMode.buttons, resetButton, clearAll]) c.disabled = !writable;
      for (const st of [greenA, greenB, yellow, defGreen, defYellow]) st.setDisabled(!writable);
      if (key === planKey) return;
      planKey = key;
      const d = signals.plan.default;
      defMode.set(d.mode ?? 'normal');
      defGreen.set(d.green);
      defYellow.set(d.yellow);
      const n = Object.keys(signals.plan.signals).length;
      overridesInfo.textContent = n ? `${n} con ajustes propios` : 'Ninguno con ajustes propios';
      clearAll.hidden = !n;
      renderSelected();
      renderList();
    },
  };
}
