import { CONFIG } from '../../config.js';
import { el } from '../dom.js';
import { badge, button, card, cardTitle, empty, field, hint, segmented, stepper } from '../widgets.js';
import { RESTRICTION_COLORS } from '../../traffic/restrictionView.js';
import { describeWay, MAX_RADIUS } from '../../traffic/restrictions.js';
import { t } from '../../i18n/index.js';

export const MODES = {
  pedestrians_only: { label: t('Cortada'), long: t('Calle cortada: solo peatones'), help: t('No pasan coches ni autobuses. Las líneas de autobús que pasen por aquí quedan suspendidas.') },
  buses_and_pedestrians: { label: t('Solo bus'), long: t('Solo autobuses y peatones'), help: t('Los coches no pasan; los autobuses siguen su recorrido.') },
  entry_limit: { label: t('Acceso limitado'), long: t('Acceso limitado a coches'), help: t('Los coches de fuera solo entran si dentro hay menos del límite (0 = no entra ninguno; los de dentro pueden salir).') },
};
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
const metres = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`);
const CLASS_NAMES = { motorway: 'autovía', primary: 'principal', secondary: 'secundaria', tertiary: 'terciaria', residential: 'residencial' };

// Restricciones de tráfico: crear (eligiendo zona o calles en el mapa), ver, cambiar y quitar.
export function createRestrictionsTab(ctx) {
  const { graph, restrictionView } = ctx;
  const draft = { kind: 'area', mode: 'pedestrians_only', radius: 150, center: null, ways: [], limit: 10 };
  const definition = () => (draft.kind === 'area'
    ? draft.center && { mode: draft.mode, area: { ...draft.center, radius: draft.radius } }
    : draft.ways.length && { mode: draft.mode, ways: [...draft.ways] });

  // --- Paso 1: tipo ---
  const modeHelp = hint(MODES[draft.mode].help);
  const modePick = segmented(Object.entries(MODES).map(([value, m]) => ({ value, label: m.label, title: m.long })), (m) => {
    draft.mode = m;
    refresh();
  }, { ariaLabel: t('Tipo de restricción') });
  modePick.set(draft.mode);
  modePick.buttons.forEach((b, i) => b.style.setProperty('--dot', hex(Object.values(RESTRICTION_COLORS)[i])));
  const limit = stepper({ min: 0, max: CONFIG.cars.max, value: draft.limit, label: t('Límite de coches'), onChange: (v) => (draft.limit = v) });
  const limitField = field(t('Coches que pueden estar dentro'), limit.node, t('0 = no entra ningún coche de fuera.'));

  // --- Paso 2: dónde ---
  const kindPick = segmented([{ value: 'area', label: t('Una zona') }, { value: 'ways', label: t('Calles concretas') }], (k) => {
    draft.kind = k;
    ctx.setMode('navigate');
    refresh();
  }, { ariaLabel: 'Dónde' });
  kindPick.set(draft.kind);
  const radiusValue = el('output');
  const radius = el('input', {
    type: 'range', min: 20, max: MAX_RADIUS, step: 10, value: draft.radius,
    oninput: () => {
      draft.radius = Number(radius.value);
      refresh();
    },
  });
  const pickButton = button(t(''), () => ctx.setMode(ctx.getMode() === 'restriction' ? 'navigate' : 'restriction'), 'primary');
  const where = el('div', { class: 'ui-lines' });
  const wayList = el('div', { class: 'ui-list compact' });
  const areaControls = field(t('Radio de la zona'), el('div', { class: 'ui-range' }, radius, radiusValue));

  // --- Paso 3: crear ---
  const name = el('input', { type: 'text', maxLength: 60, placeholder: t('Nombre (opcional), p. ej. «Parte Vieja peatonal»') });
  const summary = el('div', { class: 'ui-muted' });
  const create = button(t('Crear restricción'), async () => {
    const preview = definition();
    if (!preview) return;
    // La API recibe la zona como x, z y radius sueltos (o la lista de calles en ways).
    const def = preview.area ? { mode: preview.mode, ...preview.area } : preview;
    if (draft.mode === 'entry_limit') def.limit = draft.limit;
    if (name.value.trim()) def.name = name.value.trim();
    const ok = await ctx.run((c) => c.addRestriction(def), t('Restricción creada'));
    if (ok) clearDraft();
  }, 'primary');
  const clear = button(t('Empezar de nuevo'), () => clearDraft(), 'ghost');

  const newCard = card(cardTitle(t('Nueva restricción')),
    el('div', { class: 'ui-step' }, el('span', { class: 'ui-step-n', textContent: t('1') }), el('b', { textContent: t('Qué') })),
    modePick.node, modeHelp, limitField,
    el('div', { class: 'ui-step' }, el('span', { class: 'ui-step-n', textContent: t('2') }), el('b', { textContent: t('Dónde') })),
    kindPick.node, areaControls, pickButton, where, wayList,
    el('div', { class: 'ui-step' }, el('span', { class: 'ui-step-n', textContent: t('3') }), el('b', { textContent: t('Crear') })),
    name, summary, el('div', { class: 'ui-row' }, create, clear));

  // --- Activas ---
  const activeList = el('div', { class: 'ui-stack' });
  const activeTitle = el('span');
  const legend = el('div', { class: 'ui-legend' }, ...Object.entries(MODES).map(([k, m]) =>
    el('span', {}, el('i', { style: `background:${hex(RESTRICTION_COLORS[k])}` }), m.long)));
  const activeCard = card(cardTitle(t('Activas'), activeTitle), legend, activeList);

  function clearDraft() {
    draft.center = null;
    draft.ways = [];
    name.value = '';
    ctx.setMode('navigate');
    refresh();
  }

  function refresh() {
    modeHelp.textContent = MODES[draft.mode].help;
    limitField.hidden = draft.mode !== 'entry_limit';
    areaControls.hidden = draft.kind !== 'area';
    radiusValue.textContent = `${draft.radius} m`;
    const picking = ctx.getMode() === 'restriction';
    pickButton.textContent = picking
      ? (draft.kind === 'area' ? t('Haz clic en el mapa para colocar el centro… (Esc para terminar)') : t('Haz clic en las calles para añadirlas o quitarlas… (Esc para terminar)'))
      : (draft.kind === 'area' ? (draft.center ? t('Mover el centro en el mapa') : t('Elegir el centro en el mapa')) : t('Elegir calles en el mapa'));
    pickButton.classList.toggle('active', picking);
    where.replaceChildren();
    wayList.replaceChildren();
    wayList.hidden = draft.kind !== 'ways';
    if (draft.kind === 'area') {
      where.append(draft.center ? hint(t('Centro elegido · radio {radius} m. Puedes ajustar el radio con la barra.', { radius: draft.radius })) : hint(t('Aún no has elegido el centro.')));
    } else if (!draft.ways.length) {
      where.append(hint(t('Aún no has elegido calles. Cada clic sobre una calle la añade (otro clic la quita).')));
    } else {
      for (const way of draft.ways) {
        const info = describeWay(graph, way);
        wayList.append(el('div', { class: 'ui-list-row' },
          el('span', { textContent: t('Calle {way}', { way }) }),
          el('span', { class: 'ui-muted', textContent: info ? `${CLASS_NAMES[info.class] ?? info.class} · ${metres(info.length)}` : '' }),
          el('button', { type: 'button', class: 'ui-icon-button', textContent: t('✕'), title: t('Quitar'), onclick: () => toggleWay(way) })));
      }
    }
    const def = definition();
    const edges = restrictionView.preview(def ? { ...def } : null);
    summary.textContent = def ? t('Afectará a {edges} tramos de calle.', { edges }) : '';
    create.disabled = !def || !ctx.canWrite();
  }

  function toggleWay(way) {
    const i = draft.ways.indexOf(way);
    if (i >= 0) draft.ways.splice(i, 1);
    else if (draft.ways.length < 200) draft.ways.push(way);
    refresh();
  }

  // Clic en el mapa en modo «restriction»: centro de la zona o calle bajo el cursor.
  function pick({ x, z, way }) {
    if (draft.kind === 'area') {
      draft.center = { x: Math.round(x), z: Math.round(z) };
      ctx.setMode('navigate');
    } else if (way !== undefined) {
      toggleWay(way);
      return;
    }
    refresh();
  }

  // Qué dibujar bajo el cursor mientras se elige.
  const hoverTarget = ({ x, z, way }) => (draft.kind === 'area' ? { area: { x, z, radius: draft.radius } } : way === undefined ? null : { way });

  let listKey = '';
  function renderActive(list) {
    activeTitle.textContent = list.length ? `${list.length}` : '';
    const key = JSON.stringify(list.map((r) => [r.id, r.mode, r.limit, r.name, r.cars, r.suspendedLines, ctx.canWrite()]));
    if (key === listKey) return;
    listKey = key;
    activeList.replaceChildren();
    if (!list.length) {
      activeList.append(empty(t('No hay restricciones. Las que crees aparecerán aquí y en el mapa.')));
      return;
    }
    for (const r of list) {
      const writable = ctx.canWrite();
      const modeSel = el('select', { disabled: !writable, onchange: () => ctx.run((c) => c.updateRestriction(r.id, { mode: modeSel.value, ...(modeSel.value === 'entry_limit' ? { limit: r.limit ?? 0 } : {}) }), `${r.id}: ${MODES[modeSel.value].long}`) },
        ...Object.entries(MODES).map(([value, m]) => el('option', { value, textContent: m.long, selected: value === r.mode })));
      const limitStep = stepper({ min: 0, max: CONFIG.cars.max, value: r.limit ?? 0, label: t('Límite'), onChange: (v) => ctx.run((c) => c.updateRestriction(r.id, { limit: v }), t('{id}: límite {v}', { id: r.id, v })) });
      limitStep.setDisabled(!writable);
      let confirming = false;
      const remove = button(t('Quitar'), () => {
        if (!confirming) {
          confirming = true;
          remove.textContent = t('¿Seguro? Pulsa otra vez');
          setTimeout(() => {
            confirming = false;
            remove.textContent = 'Quitar';
          }, 3000);
          return;
        }
        ctx.run((c) => c.removeRestriction(r.id), t('{id} quitada: la calle se reabre', { id: r.id }));
      }, 'ghost danger');
      remove.disabled = !writable;
      const where = r.area ? t('Zona de {v} de radio', { v: metres(r.area.radius) }) : t('{length} calle(s)', { length: r.ways.length });
      activeList.append(el('div', { class: 'ui-item', style: `--accent:${hex(RESTRICTION_COLORS[r.mode] ?? 0xffffff)}` },
        el('div', { class: 'ui-item-head' },
          el('b', { textContent: r.name || r.id }),
          el('button', { type: 'button', class: 'ui-link', textContent: t('Ver'), onclick: () => focus(r) })),
        el('div', { class: 'ui-muted', textContent: t('{id} · {where} · {v} de calle · {cars} coches dentro', { id: r.id, where, v: metres(r.length ?? 0), cars: r.cars }) }),
        r.suspendedLines?.length ? el('div', { class: 'ui-badges' }, badge(t('Suspende {v}', { v: r.suspendedLines.join(', ') }), 'danger')) : '',
        field(t('Tipo'), modeSel),
        r.mode === 'entry_limit' ? field(t('Coches que pueden estar dentro'), limitStep.node) : '',
        el('div', { class: 'ui-row' }, remove)));
    }
  }

  function focus(r) {
    if (r.area) return ctx.focusPoint(r.area.x, r.area.z, Math.max(400, r.area.radius * 3));
    const edges = [];
    for (let e = 0; e < graph.edgeCount; e++) if (r.ways.includes(graph.way[e])) edges.push(e);
    if (!edges.length) return;
    const x = edges.reduce((a, e) => a + graph.nx[graph.A[e]], 0) / edges.length;
    const z = edges.reduce((a, e) => a + graph.nz[graph.A[e]], 0) / edges.length;
    ctx.focusPoint(x, z, 600);
  }

  refresh();
  return {
    node: el('div', {}, newCard, activeCard),
    pick,
    hoverTarget,
    refresh,
    onHide: () => {
      if (ctx.getMode() === 'restriction') ctx.setMode('navigate');
    },
    onState(s) {
      const list = s.restrictions ?? [];
      restrictionView.update(list);
      renderActive(list);
      create.disabled = !definition() || !ctx.canWrite();
    },
  };
}
