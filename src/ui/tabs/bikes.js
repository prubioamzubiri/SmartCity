import { CONFIG } from '../../config.js';
import { el } from '../dom.js';
import { badge, button, card, cardTitle, empty, field, hint, meter, stat, stepper } from '../widgets.js';

const DAYS = CONFIG.bicycles.capacityDelaySeconds / 86400;
const VANS = CONFIG.bicycles.vans;
const clock = (iso) => (iso ? iso.slice(11, 16) : '');

// Bicicletas compartidas: disponibilidad por puesto, cambio de anclajes y registro del histórico.
export function createBikesTab(ctx) {
  const stations = ctx.bikes.stations ?? [];
  const stats = { bikes: stat('Bicis disponibles'), inUse: stat('En circulación'), empty: stat('Puestos vacíos o llenos') };
  const tracked = () => (ctx.state()?.bikes?.stations ?? []).filter((s) => s.tracked).map((s) => s.id);
  const setTracked = (ids, ok) => ctx.run((c) => c.setTrackedBikes(ids), ok);
  const schedule = (changes, ok) => ctx.run((c) => c.setBikeCapacities(changes), ok);

  // Furgonetas: mover bicis de un puesto a otro.
  const byName = [...stations].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const nameOf = (id) => stations.find((s) => s.id === id)?.name ?? id;
  const stationSelect = (label) => {
    const select = el('select', { 'aria-label': label }, el('option', { value: '', textContent: '— Elige un puesto —' }),
      ...byName.map((st) => el('option', { value: st.id, textContent: st.name })));
    return select;
  };
  const from = stationSelect('Puesto de origen');
  const to = stationSelect('Puesto de destino');
  const howMany = el('input', { type: 'number', min: 1, max: VANS.capacity, step: 1, value: 10, 'aria-label': 'Bicis' });
  const send = button('Enviar furgoneta', () => {
    const bikes = Math.round(Number(howMany.value));
    if (!from.value || !to.value) return ctx.toast('Elige el puesto de origen y el de destino', 'error');
    if (from.value === to.value) return ctx.toast('El origen y el destino deben ser distintos', 'error');
    if (!(bikes >= 1 && bikes <= VANS.capacity)) return ctx.toast(`Entre 1 y ${VANS.capacity} bicis`, 'error');
    ctx.run((c) => c.moveBikes(from.value, to.value, bikes), `Furgoneta enviada: ${bikes} bicis de ${nameOf(from.value)} a ${nameOf(to.value)}`);
  });
  const vanList = el('div', { class: 'ui-stack' });
  const vansCard = card(cardTitle('Furgonetas'),
    hint(`Hay ${VANS.count} furgonetas de ${VANS.capacity} bicis. La libre más cercana va al origen, carga las que haya (como mucho las pedidas), va al destino y descarga las que quepan. Circulan en línea recta a unos ${Math.round(VANS.speed * 3.6)} km/h y tardan ${VANS.handlingSeconds / 60} min en cargar y otros ${VANS.handlingSeconds / 60} en descargar: cada viaje lleva media hora o más. Para que haya bicis en la hora punta, movedlas antes de que el puesto se vacíe.`),
    field('Desde', from), field('Hasta', to),
    el('div', { class: 'ui-row' }, field('Bicis', howMany), send),
    vanList);
  const pick = (select, id) => {
    select.value = id;
    vansCard.scrollIntoView({ block: 'nearest' });
  };

  const search = el('input', { type: 'search', placeholder: 'Buscar puesto…', oninput: () => filter() });
  const rows = new Map();
  const list = el('div', { class: 'ui-stack' });
  for (const station of stations) {
    const load = meter();
    const count = el('span', { class: 'ui-muted' });
    const pending = el('span', { class: 'ui-badges' });
    let target = station.capacity;
    const capacity = stepper({ min: 1, max: CONFIG.bicycles.maxCapacity, value: station.capacity, label: `Anclajes de ${station.name}`, onChange: (v) => (target = v) });
    const apply = button('Programar', () => schedule({ [station.id]: target }, `${station.name}: ${target} anclajes dentro de ${DAYS} días simulados`), 'ghost');
    const record = el('input', {
      type: 'checkbox', title: 'Registrar su histórico',
      onchange: () => {
        const ids = new Set(tracked());
        if (!ids.delete(station.id)) ids.add(station.id);
        setTracked([...ids], record.checked ? `${station.name}: se registra` : `${station.name}: deja de registrarse`);
      },
    });
    const node = el('div', { class: 'ui-item' },
      el('div', { class: 'ui-item-head' },
        el('button', { type: 'button', class: 'ui-link strong', textContent: station.name, title: 'Ver en el mapa', onclick: () => ctx.bikes.focus(station) }),
        el('label', { class: 'ui-check' }, record, ' Registrar')),
      el('div', { class: 'ui-row nowrap' }, load.node, count),
      el('div', { class: 'ui-row between' }, el('span', { class: 'ui-field-label', textContent: 'Anclajes' }), el('span', { class: 'ui-row nowrap' }, capacity.node, apply)),
      el('div', { class: 'ui-row between' }, el('span', { class: 'ui-field-label', textContent: 'Furgoneta' }),
        el('span', { class: 'ui-row nowrap' }, button('Desde aquí', () => pick(from, station.id), 'ghost'), button('Hasta aquí', () => pick(to, station.id), 'ghost'))),
      pending);
    rows.set(station.id, { station, node, load, count, pending, capacity, apply, record, search: station.name.toLowerCase() });
    list.append(node);
  }

  function filter() {
    const q = search.value.trim().toLowerCase();
    for (const r of rows.values()) r.node.hidden = Boolean(q) && !r.search.includes(q);
  }

  // Edición de muchos puestos a la vez (JSON), para quien lo prefiera.
  const json = el('textarea', { rows: 4, spellcheck: false, placeholder: '{ "municipal/0": 20, "municipal/5": 8 }' });
  const advanced = el('details', { class: 'ui-card ui-details' },
    el('summary', { textContent: 'Avanzado: varios puestos a la vez (JSON)' }),
    json,
    el('div', { class: 'ui-row' },
      button('Cargar actuales', () => (json.value = JSON.stringify(Object.fromEntries(stations.map((s) => [s.id, s.capacity])), null, 1)), 'ghost'),
      button('Aplicar', () => {
        try {
          schedule(JSON.parse(json.value), `Cambios programados: se aplican en ${DAYS} días simulados`);
        } catch {
          ctx.toast('JSON no válido. Formato: { "id del puesto": anclajes }', 'error');
        }
      }),
      button('Cancelar pendientes', () => schedule(Object.fromEntries((ctx.state()?.bikes?.stations ?? []).filter((s) => s.pending).map((s) => [s.id, null])), 'Cambios pendientes cancelados'), 'ghost danger')));

  const allNone = el('div', { class: 'ui-row' },
    button('Registrar todos', () => setTracked(stations.map((s) => s.id), 'Se registran todos los puestos'), 'ghost'),
    button('Ninguno', () => setTracked([], 'No se registra ningún puesto'), 'ghost'));

  const node = el('div', {},
    card(el('div', { class: 'ui-stats three' }, ...Object.values(stats).map((s) => s.node))),
    stations.length ? vansCard : '',
    stations.length
      ? card(cardTitle('Puestos'), hint(`Un cambio de anclajes tarda ${DAYS} días simulados en hacerse efectivo. «Registrar» guarda una muestra cada 15 min simulados (CSV de bicicletas).`),
        search, list, allNone)
      : card(empty('Sin puestos de bicicletas en los datos. Ejecuta «npm run fetch-bikes».')),
    advanced,
    hint('Son estimaciones de la simulación, no sensores reales. Ubicaciones: © OpenStreetMap y Ayuntamiento de Donostia / GeoDonostia (CC BY 4.0).'));

  return {
    node,
    reveal(id) {
      const r = rows.get(id);
      if (!r) return;
      search.value = '';
      filter();
      r.node.scrollIntoView({ block: 'nearest' });
      r.node.classList.add('flash');
      setTimeout(() => r.node.classList.remove('flash'), 1200);
    },
    onState(s) {
      const live = new Map((s.bikes?.stations ?? []).map((x) => [x.id, x]));
      const writable = ctx.canWrite();
      let available = 0;
      let bad = 0;
      for (const r of rows.values()) {
        const st = live.get(r.station.id);
        r.record.disabled = !writable;
        r.apply.disabled = !writable;
        r.capacity.setDisabled(!writable);
        if (!st) continue;
        r.record.checked = st.tracked;
        available += st.available;
        if (st.available <= 0 || st.available >= st.capacity) bad++;
        r.load.set(st.available / st.capacity, st.available <= 0 ? 'var(--danger)' : st.available >= st.capacity ? 'var(--warn)' : 'var(--ok)');
        r.count.textContent = `${st.available} de ${st.capacity} bicis`;
        if (!st.pending) r.capacity.set(st.capacity);
        const days = st.pending ? Math.max(0, Math.ceil((st.pending.effectiveAt - ctx.simNow()) / 86400)) : 0;
        r.pending.replaceChildren(...(st.pending ? [badge(`Pasará a ${st.pending.capacity} anclajes en ${days} días`, 'info')] : []));
      }
      stats.bikes.set(available.toLocaleString('es-ES'), `en ${stations.length} puestos`);
      stats.inUse.set((s.bikes?.inUse ?? 0).toLocaleString('es-ES'));
      stats.empty.set(bad.toLocaleString('es-ES'));
      for (const btn of allNone.querySelectorAll('button')) btn.disabled = !writable;
      send.disabled = !writable;
      const vans = s.bikes?.vans ?? [];
      const free = vans.filter((v) => !v.busy).length;
      vanList.replaceChildren(
        ...vans.map((v) => {
          const j = v.job;
          const text = !j ? 'libre'
            : j.loaded === null ? `va a ${nameOf(j.from)} a por ${j.bikes} bicis (termina de cargar a las ${clock(j.loadAt)}) y las lleva a ${nameOf(j.to)} (descarga a las ${clock(j.unloadAt)})`
              : `lleva ${j.loaded} bicis de ${nameOf(j.from)} a ${nameOf(j.to)} (descarga a las ${clock(j.unloadAt)})`;
          return el('div', { class: 'ui-row' }, badge(v.id, j ? 'warn' : 'ok'), el('span', { class: 'ui-muted', textContent: text }));
        }),
        el('div', { class: 'ui-muted', textContent: `${free} de ${vans.length} libres · ${(s.bikes?.moved ?? 0).toLocaleString('es-ES')} bicis movidas en total` }));
      if (!free) send.disabled = true;
    },
  };
}
