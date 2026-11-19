import { CONFIG } from '../../config.js';
import { el } from '../dom.js';
import { badge, button, card, cardTitle, empty, hint, meter, stat, stepper, toggle } from '../widgets.js';
import { loadColor } from '../../transit/buses.js';

const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

// Autobuses: ocupación por línea, flota (cuántos autobuses tiene cada línea) y registro de su histórico.
export function createBusesTab(ctx) {
  const b = ctx.transit.buses;
  const stats = { active: stat('En servicio'), riders: stat('Pasajeros'), full: stat('Autobuses llenos') };
  const tracked = () => (ctx.state()?.buses?.lines ?? []).filter((l) => l.tracked).map((l) => l.id);
  const setTracked = (ids, ok) => ctx.run((c) => c.setTrackedBuses(ids), ok);

  const rows = b.lines.map((line, li) => {
    const load = meter();
    const info = el('span', { class: 'ui-muted' });
    const flags = el('span', { class: 'ui-badges' });
    const fleet = stepper({
      min: CONFIG.transit.minFleet, max: CONFIG.transit.maxFleet, value: line.buses, label: `Flota de ${line.id}`,
      onChange: (v) => ctx.run((c) => c.setBusFleet(line.id, v), `${line.id}: ${v} autobuses`),
    });
    const show = el('input', { type: 'checkbox', checked: true, title: 'Mostrar en el mapa', onchange: () => ctx.transit.view.setLineVisible(li, show.checked) });
    const record = toggle('Registrar', false, () => {
      const ids = new Set(tracked());
      if (!ids.delete(line.id)) ids.add(line.id);
      setTracked([...ids], record.input.checked ? `${line.id}: se registra su histórico` : `${line.id}: deja de registrarse`);
    });
    const node = el('div', { class: 'ui-item', style: `--accent:${hex(line.color)}` },
      el('div', { class: 'ui-item-head' },
        el('label', { class: 'ui-line-name', title: 'Mostrar u ocultar en el mapa' }, show, el('i', { style: `background:${hex(line.color)}` }), el('b', { textContent: line.id })),
        record.node),
      flags,
      el('div', { class: 'ui-row nowrap' }, load.node, info),
      el('div', { class: 'ui-row between' }, el('span', { class: 'ui-field-label', textContent: 'Autobuses en la línea' }), fleet.node));
    return { line, li, node, load, info, flags, fleet, record };
  });

  const legend = el('div', { class: 'ui-legend' },
    el('span', {}, el('i', { style: `background:${hex(loadColor(0))}` }), 'Con sitio'),
    el('span', {}, el('i', { style: `background:${hex(loadColor(0.5))}` }), 'Bastante gente'),
    el('span', {}, el('i', { style: `background:${hex(loadColor(1))}` }), 'Lleno'),
    el('span', {}, el('i', { style: `background:${hex(CONFIG.pedestrians.color)}` }), 'Esperando en la parada'));
  const allNone = el('div', { class: 'ui-row' },
    button('Registrar todas', () => setTracked(b.lines.map((l) => l.id), 'Se registran todas las líneas'), 'ghost'),
    button('Ninguna', () => setTracked([], 'No se registra ninguna línea'), 'ghost'));

  const reserveInfo = el('div', { class: 'ui-muted' });
  const todayInfo = el('div', { class: 'ui-muted' });
  const clock = (iso) => (iso ? iso.slice(11, 16) : '');
  const node = el('div', {},
    card(el('div', { class: 'ui-stats three' }, ...Object.values(stats).map((s) => s.node))),
    b.lines.length
      ? card(cardTitle('Líneas'),
        hint(`Con − y + cambias cuántos autobuses tiene cada línea (de ${CONFIG.transit.minFleet} a ${CONFIG.transit.maxFleet}); con poca demanda solo sale una parte. La flota total es fija: para dar más autobuses a una línea, usa la reserva o quítaselos a otra. Quitar es inmediato, pero los que añades salen de la cochera y tardan ${CONFIG.transit.deployMinutes} min simulados en entrar en servicio. Las horas de autobús de más sobre las de la flota inicial son sobrecoste. «Registrar» guarda su histórico en el servidor (CSV de autobuses).`),
        reserveInfo, todayInfo,
        el('div', { class: 'ui-stack' }, ...rows.map((r) => r.node)), allNone)
      : card(empty('Sin paradas de autobús en los datos de la ciudad.')),
    card(cardTitle('Leyenda'), legend));

  return {
    node,
    onState(s) {
      const byId = new Map((s.buses?.lines ?? []).map((l) => [l.id, l]));
      const writable = ctx.canWrite();
      const reserve = s.buses?.reserve;
      reserveInfo.textContent = reserve === undefined ? '' : `En reserva: ${reserve} de ${s.buses.fleetTotal} autobuses`;
      const today = s.buses?.today;
      todayInfo.textContent = today
        ? `Hoy: ${today.busHours.toLocaleString('es-ES')} h de autobús de ${today.includedHours.toLocaleString('es-ES')} incluidas${today.overtimeHours > 0 ? ` · ${today.overtimeHours.toLocaleString('es-ES')} h de sobrecoste` : ''}`
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
          live.suspended && badge('Suspendida: calle cortada', 'danger'),
          coming > 0 && badge(`+${coming} de camino (${pending.map((p) => clock(p.readyAt)).join(', ')})`, 'warn'),
          live.tracked && badge('Registrando', 'info'),
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
        r.info.textContent = `${st.active} en servicio · ${Math.round(occupancy * 100)} %${st.full ? ` · ${st.full} llenos` : ''}${st.waiting ? ` · ${st.waiting} esperando` : ''}${st.leftBehind ? ` · ${st.leftBehind} en tierra` : ''}`;
        active += st.active;
        riders += st.passengers;
        full += st.full;
      }
      stats.active.set(active.toLocaleString('es-ES'), `${b.lines.length} líneas`);
      stats.riders.set(riders.toLocaleString('es-ES'));
      stats.full.set(full.toLocaleString('es-ES'));
    },
  };
}
