import { CONFIG } from '../../config.js';
import { el } from '../dom.js';
import { badge, button, card, cardTitle, empty, field, hint, segmented, stepper } from '../widgets.js';
import { t } from '../../i18n/index.js';

const MODES = [
  { value: 'normal', label: t('Normal'), title: t('Ciclo de verde, ámbar y rojo') },
  { value: 'off', label: t('Apagado'), title: t('Cruce sin regular: los coches ceden el paso; los peatones cruzan cuando hay hueco') },
  { value: 'flashing', label: t('Ámbar'), title: t('Ámbar intermitente: cruce sin regular con prioridad para los peatones') },
  { value: 'all_red', label: t('Rojo'), title: t('Todo en rojo: todos se detienen') },
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
  const mode = segmented(MODES, (m) => send({ mode: m === 'normal' ? null : m }, t('Semáforo {selected}: {v}', { selected, v: MODE_LABEL[m] })), { ariaLabel: t('Modo del semáforo') });
  const timing = (key, label, min, max) => stepper({ min, max, label, onChange: (v) => send({ [key]: v }, t('Semáforo {selected}: {toLowerCase} {v} s', { selected, toLowerCase: label.toLowerCase(), v })) });
  const greenA = timing('greenA', t('Verde este-oeste'), 5, 180);
  const greenB = timing('greenB', t('Verde norte-sur'), 5, 180);
  const yellow = timing('yellow', 'Ámbar', ...CONFIG.signals.yellowRange);
  const timings = el('div', { class: 'ui-grid3' },
    field(t('Verde E-O (s)'), greenA.node), field(t('Verde N-S (s)'), greenB.node), field(t('Ámbar (s)'), yellow.node));
  const scheduleNote = hint(t(''));
  const resetButton = button(t('Volver al plan general'), () => send({ reset: true }, t('Semáforo {selected}: plan general', { selected })), 'ghost');
  const editor = el('div', {},
    field(t('Modo'), mode.node), timings, scheduleNote, el('div', { class: 'ui-row' }, resetButton));
  const selEmpty = empty(t('Haz clic en un semáforo del mapa (los puntos de colores en los cruces) o elige uno de la lista.'));
  const selCard = card(cardTitle(t('Semáforo seleccionado'), selLinks), selTitle, selBadges, selEmpty, editor);

  // --- Plan general (todos los que no tienen ajustes propios) ---
  const sendPlan = (plan, ok) => ctx.run((c) => c.setSignalPlan(plan), ok);
  const general = (patch, ok) => sendPlan({ default: { ...signals.plan.default, ...patch }, signals: signals.plan.signals }, ok);
  const defMode = segmented(MODES, (m) => general({ mode: m === 'normal' ? undefined : m }, t('Todos los semáforos: {v}', { v: MODE_LABEL[m] })), { ariaLabel: t('Modo general') });
  const defGreen = stepper({ min: 5, max: 180, label: t('Verde general'), onChange: (v) => general({ green: v }, t('Verde general: {v} s', { v })) });
  const defYellow = stepper({ min: CONFIG.signals.yellowRange[0], max: CONFIG.signals.yellowRange[1], label: t('Ámbar general'), onChange: (v) => general({ yellow: v }, t('Ámbar general: {v} s', { v })) });
  const overridesInfo = el('span', { class: 'ui-muted' });
  const clearAll = button(t('Quitar todos los ajustes propios'), () => sendPlan({ default: signals.plan.default, signals: {} }, t('Todos los semáforos siguen el plan general')), 'ghost danger');
  const generalCard = card(cardTitle(t('Todos los semáforos')),
    hint(t('Se aplica a los semáforos sin ajustes propios.')),
    field(t('Modo'), defMode.node),
    el('div', { class: 'ui-grid2' }, field(t('Verde (s)'), defGreen.node), field(t('Ámbar (s)'), defYellow.node)),
    el('div', { class: 'ui-row' }, overridesInfo, clearAll));

  // --- Lista ---
  const search = el('input', { type: 'search', placeholder: t('Buscar por número…'), oninput: () => renderList() });
  const onlyOwn = el('input', { type: 'checkbox', onchange: () => renderList() });
  const list = el('div', { class: 'ui-list' });
  const listCard = card(cardTitle(t('Lista de semáforos')),
    el('div', { class: 'ui-row' }, search, el('label', { class: 'ui-check' }, onlyOwn, t(' Solo con ajustes propios'))), list);

  function renderList() {
    const q = search.value.trim();
    const rows = active().filter((s) => (!q || String(s.id).includes(q)) && (!onlyOwn.checked || signals.plan.signals[s.id]));
    list.replaceChildren(...rows.slice(0, 200).map((s) => {
      const own = signals.plan.signals[s.id];
      const tm = signals.timing(s, ctx.simNow());
      const m = signals.modeOf(s);
      return el('button', { type: 'button', class: `ui-list-row${s.id === selected ? ' selected' : ''}`, onclick: () => select(s.id, true) },
        el('span', { textContent: t('Semáforo {id}', { id: s.id }) }),
        m !== 'normal' ? badge(MODE_LABEL[m], m === 'all_red' ? 'danger' : 'warn') : el('span', { class: 'ui-muted', textContent: t('{gA}/{gB}/{y} s', { gA: tm.gA, gB: tm.gB, y: tm.y }) }),
        own ? badge(t('propio'), 'info') : '');
    }));
    if (!rows.length) list.append(empty(t('Ningún semáforo coincide.')));
    else if (rows.length > 200) list.append(hint(t('Se muestran 200 de {length}: busca por número para encontrar otros.', { length: rows.length })));
  }

  // --- Plan en JSON ---
  const planUrl = el('input', { type: 'url', placeholder: t('https://…/plan.json') });
  const advanced = el('details', { class: 'ui-card ui-details' },
    el('summary', { textContent: t('Avanzado: plan completo en JSON') }),
    hint(t('Un plan con horarios (p. ej. más verde en hora punta) se escribe en JSON. Descarga la plantilla, edítala y cárgala.')),
    field(t('Cargar desde una URL'), el('div', { class: 'ui-row' }, planUrl, button(t('Cargar'), async () => {
      try {
        const res = await fetch(planUrl.value);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await sendPlan(await res.json(), t('Plan cargado'));
      } catch (err) {
        ctx.toast(t('No se pudo cargar: {message}', { message: err.message }), 'error');
      }
    }))),
    el('div', { class: 'ui-row' },
      button(t('Cargar archivo'), async () => {
        const text = await pickFile();
        if (text === null) return;
        try {
          await sendPlan(JSON.parse(text), t('Plan cargado desde el archivo'));
        } catch (err) {
          ctx.toast(t('Archivo no válido: {message}', { message: err.message }), 'error');
        }
      }),
      button(t('Plantilla'), () => download('plantilla-semaforos.json', JSON.stringify(TEMPLATE, null, 2)), 'ghost'),
      button(t('Plan actual'), () => download('plan-semaforos.json', JSON.stringify(signals.plan, null, 2)), 'ghost')));

  function renderSelected() {
    const s = selected === null ? null : signals.signals.find((x) => x.id === selected);
    selEmpty.hidden = Boolean(s);
    editor.hidden = selTitle.hidden = selBadges.hidden = !s;
    selLinks.replaceChildren();
    if (!s) return;
    selTitle.textContent = t('Semáforo {id}', { id: s.id });
    selTitle.className = 'ui-big';
    selLinks.append(
      el('button', { type: 'button', class: 'ui-link', textContent: t('Ver en el mapa'), onclick: () => ctx.focusSignal(s) }),
      el('a', { class: 'ui-link', textContent: t('OSM'), href: `https://www.openstreetmap.org/node/${s.id}`, target: '_blank', rel: 'noopener noreferrer' }));
    const own = signals.plan.signals[s.id];
    const m = signals.modeOf(s);
    mode.set(m);
    const tm = signals.timing(s, ctx.simNow());
    greenA.set(tm.gA);
    greenB.set(tm.gB);
    yellow.set(tm.y);
    timings.hidden = m !== 'normal';
    selBadges.replaceChildren(own ? badge(t('Con ajustes propios'), 'info') : badge(t('Sigue el plan general')), badge(t('Ciclo {v} s', { v: tm.gA + tm.gB + 2 * tm.y })));
    const rules = own?.schedule?.length ?? 0;
    scheduleNote.textContent = rules ? t('Tiene {rules} regla(s) por horario: los tiempos mostrados son los de ahora. Para editarlas usa el plan en JSON.', { rules }) : '';
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
      overridesInfo.textContent = n ? t('{n} con ajustes propios', { n }) : t('Ninguno con ajustes propios');
      clearAll.hidden = !n;
      renderSelected();
      renderList();
    },
  };
}
