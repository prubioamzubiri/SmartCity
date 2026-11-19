import { CONFIG } from '../../config.js';
import { el } from '../dom.js';
import { badge, button, card, cardTitle, empty, hint, meter, stat, stepper, toggle } from '../widgets.js';
import { loadColor } from '../../transit/buses.js';
import { t, locale } from '../../i18n/index.js';

const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

// Autobuses: ocupación por línea, flota (cuántos autobuses tiene cada línea) y registro de su histórico.
export function createBusesTab(ctx) {
  const b = ctx.transit.buses;
  const stats = { active: stat(t('En servicio')), riders: stat(t('Pasajeros')), full: stat(t('Autobuses llenos')) };
  const tracked = () => (ctx.state()?.buses?.lines ?? []).filter((l) => l.tracked).map((l) => l.id);
  const setTracked = (ids, ok) => ctx.run((c) => c.setTrackedBuses(ids), ok);

  const rows = b.lines.map((line, li) => {
    const load = meter();
    const info = el('span', { class: 'ui-muted' });
    const flags = el('span', { class: 'ui-badges' });
    const fleet = stepper({
      min: CONFIG.transit.minFleet, max: CONFIG.transit.maxFleet, value: line.buses, label: t('Flota de {id}', { id: line.id }),
      onChange: (v) => ctx.run((c) => c.setBusFleet(line.id, v), t('{id}: {n} autobuses', { id: line.id, n: v })),
    });
    const show = el('input', { type: 'checkbox', checked: true, title: t('Mostrar en el mapa'), onchange: () => ctx.transit.view.setLineVisible(li, show.checked) });
    const record = toggle(t('Registrar'), false, () => {
      const ids = new Set(tracked());
      if (!ids.delete(line.id)) ids.add(line.id);
      setTracked([...ids], record.input.checked ? t('{id}: se registra su histórico', { id: line.id }) : t('{id}: deja de registrarse', { id: line.id }));
    });
    const node = el('div', { class: 'ui-item', style: `--accent:${hex(line.color)}` },
      el('div', { class: 'ui-item-head' },
        el('label', { class: 'ui-line-name', title: t('Mostrar u ocultar en el mapa') }, show, el('i', { style: `background:${hex(line.color)}` }), el('b', { textContent: line.id })),
        record.node),
      flags,
      el('div', { class: 'ui-row nowrap' }, load.node, info),
      el('div', { class: 'ui-row between' }, el('span', { class: 'ui-field-label', textContent: t('Autobuses en la línea') }), fleet.node));
    return { line, li, node, load, info, flags, fleet, record };
  });

  const legend = el('div', { class: 'ui-legend' },
    el('span', {}, el('i', { style: `background:${hex(loadColor(0))}` }), t('Con sitio')),
    el('span', {}, el('i', { style: `background:${hex(loadColor(0.5))}` }), t('Bastante gente')),
    el('span', {}, el('i', { style: `background:${hex(loadColor(1))}` }), 'Lleno'),
    el('span', {}, el('i', { style: `background:${hex(CONFIG.pedestrians.color)}` }), t('Esperando en la parada')));
  const allNone = el('div', { class: 'ui-row' },
    button(t('Registrar todas'), () => setTracked(b.lines.map((l) => l.id), t('Se registran todas las líneas')), 'ghost'),
    button(t('Ninguna'), () => setTracked([], t('No se registra ninguna línea')), 'ghost'));

  const reserveInfo = el('div', { class: 'ui-muted' });
  const todayInfo = el('div', { class: 'ui-muted' });
  const clock = (iso) => (iso ? iso.slice(11, 16) : '');
  const node = el('div', {},
    card(el('div', { class: 'ui-stats three' }, ...Object.values(stats).map((s) => s.node))),
    b.lines.length
      ? card(cardTitle(t('Líneas')),
        hint(t('Con − y + cambias cuántos autobuses tiene cada línea (de {minFleet} a {maxFleet}); con poca demanda solo sale una parte. La flota total es fija: para dar más autobuses a una línea, usa la reserva o quítaselos a otra. Quitar es inmediato, pero los que añades salen de la cochera y tardan {deployMinutes} min simulados en entrar en servicio. Las horas de autobús de más sobre las de la flota inicial son sobrecoste. «Registrar» guarda su histórico en el servidor (CSV de autobuses).', { minFleet: CONFIG.transit.minFleet, maxFleet: CONFIG.transit.maxFleet, deployMinutes: CONFIG.transit.deployMinutes })),
        reserveInfo, todayInfo,
        el('div', { class: 'ui-stack' }, ...rows.map((r) => r.node)), allNone)
      : card(empty(t('Sin paradas de autobús en los datos de la ciudad.'))),
    card(cardTitle(t('Leyenda')), legend));

  return {
    node,
    onState(s) {
      const byId = new Map((s.buses?.lines ?? []).map((l) => [l.id, l]));
      const writable = ctx.canWrite();
      const reserve = s.buses?.reserve;
      reserveInfo.textContent = reserve === undefined ? '' : t('En reserva: {reserve} de {fleetTotal} autobuses', { reserve, fleetTotal: s.buses.fleetTotal });
      const today = s.buses?.today;
      todayInfo.textContent = today
        ? t('Hoy: {v} h de autobús de {v2} incluidas{v3}', { v: today.busHours.toLocaleString(locale()), v2: today.includedHours.toLocaleString(locale()), v3: today.overtimeHours > 0 ? t(' · {v} h de sobrecoste', { v: today.overtimeHours.toLocaleString(locale()) }) : '' })
        : '';
      for (const r of rows) {
        const live = byId.get(r.line.id);
        if (!live) continue;
        const pending = live.pending ?? [];
        const coming = pending.reduce((a, p) => a + p.count, 0);
        r.fleet.set(live.fleet + coming);
        r.fleet.setDisabled(!writable);
        r.record.input.checked = live.tracked;
        r.record.input.disabled = !writable;
        r.flags.replaceChildren(...[
          live.suspended && badge(t('Suspendida: calle cortada'), 'danger'),
          coming > 0 && badge(t('+{coming} de camino ({v})', { coming, v: pending.map((p) => clock(p.readyAt)).join(', ') }), 'warn'),
          live.tracked && badge(t('Registrando'), 'info'),
        ].filter(Boolean));
      }
      for (const btn of allNone.querySelectorAll('button')) btn.disabled = !writable;
    },
    update() {
      let active = 0;
      let riders = 0;
      let full = 0;
      for (const r of rows) {
        const st = b.stats[r.li];
        const occupancy = st.active ? st.passengers / (st.active * CONFIG.transit.capacity) : 0;
        r.load.set(occupancy, hex(loadColor(occupancy)));
        r.info.textContent = t('{active} en servicio · {v} %{v2}{v3}{v4}', { active: st.active, v: Math.round(occupancy * 100), v2: st.full ? t(' · {full} llenos', { full: st.full }) : '', v3: st.waiting ? t(' · {waiting} esperando', { waiting: st.waiting }) : '', v4: st.leftBehind ? t(' · {leftBehind} en tierra', { leftBehind: st.leftBehind }) : '' });
        active += st.active;
        riders += st.passengers;
        full += st.full;
      }
      stats.active.set(active.toLocaleString(locale()), t('{length} líneas', { length: b.lines.length }));
      stats.riders.set(riders.toLocaleString(locale()));
      stats.full.set(full.toLocaleString(locale()));
    },
  };
}
