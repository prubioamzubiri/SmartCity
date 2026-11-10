import { el } from '../dom.js';
import { button, card, cardTitle, empty, hint, meter, stat } from '../widgets.js';

const legendItem = (color, text) => el('span', {}, el('i', { style: `background:${color}` }), text);

// Parkings subterráneos públicos: ocupación simulada y cuáles registra el servidor.
export function createParkingsTab(ctx) {
  const stats = { avg: stat('Ocupación media'), full: stat('Llenos (≥ 95 %)') };
  const list = el('div', { class: 'ui-stack' });
  const tracked = () => (ctx.state()?.parkings ?? []).filter((p) => p.tracked).map((p) => p.id);
  const setTracked = (ids, ok) => ctx.run((c) => c.setTrackedParkings(ids), ok);
  const toggle = (id) => {
    const ids = new Set(tracked());
    const on = !ids.delete(id);
    if (on) ids.add(id);
    const name = (ctx.state()?.parkings ?? []).find((p) => p.id === id)?.name ?? id;
    return setTracked([...ids], on ? `${name}: se registra su ocupación` : `${name}: deja de registrarse`);
  };
  const rows = new Map();
  const allNone = el('div', { class: 'ui-row' },
    button('Registrar todos', () => setTracked((ctx.state()?.parkings ?? []).map((p) => p.id), 'Se registran todos los parkings'), 'ghost'),
    button('Ninguno', () => setTracked([], 'No se registra ningún parking'), 'ghost'));

  const node = el('div', {},
    card(el('div', { class: 'ui-stats two' }, stats.avg.node, stats.full.node)),
    card(cardTitle('Parkings subterráneos'), hint('«Registrar» guarda su ocupación cada 5 min simulados (CSV de parkings). También puedes pulsar la P de un parking en el mapa.'), list, allNone),
    card(cardTitle('Leyenda del mapa'),
      el('div', { class: 'ui-legend' },
        legendItem('#2ecc71', 'Parking con sitio'), legendItem('#e74c3c', 'Parking lleno'),
        legendItem('#7a4fd6', 'Área subterránea'), legendItem('#4fc3f7', 'Aparcamiento en calle'),
        legendItem('#ffffff', 'Plaza suelta')),
      ctx.parking.stats ? hint(`Datos de OSM: ${ctx.parking.stats.lots} aparcamientos, ${ctx.parking.stats.underground} subterráneos públicos, ${ctx.parking.stats.street} tramos con aparcamiento en la calle.`) : ''));

  let key = '';
  return {
    node,
    toggle,
    onState(s) {
      const lots = s.parkings ?? [];
      const writable = ctx.canWrite();
      const k = JSON.stringify(lots.map((p) => p.id));
      if (k !== key) {
        key = k;
        rows.clear();
        list.replaceChildren();
        if (!lots.length) list.append(empty('Sin parkings subterráneos en los datos.'));
        for (const lot of lots) {
          const load = meter();
          const pct = el('span', { class: 'ui-muted' });
          const box = el('input', { type: 'checkbox', onchange: () => toggle(lot.id) });
          const row = el('div', { class: 'ui-item' },
            el('div', { class: 'ui-item-head' }, el('b', { textContent: lot.name }), el('label', { class: 'ui-check' }, box, ' Registrar')),
            el('div', { class: 'ui-row nowrap' }, load.node, pct));
          rows.set(lot.id, { load, pct, box });
          list.append(row);
        }
      }
      let sum = 0;
      let full = 0;
      for (const lot of lots) {
        const r = rows.get(lot.id);
        r.load.set(lot.occupancy, lot.occupancy >= 0.95 ? 'var(--danger)' : lot.occupancy >= 0.8 ? 'var(--warn)' : 'var(--ok)');
        r.pct.textContent = `${Math.round(lot.occupancy * 100)} % de ${lot.capacity} plazas`;
        r.box.checked = lot.tracked;
        r.box.disabled = !writable;
        sum += lot.occupancy;
        if (lot.occupancy >= 0.95) full++;
      }
      stats.avg.set(lots.length ? `${Math.round((100 * sum) / lots.length)} %` : '—');
      stats.full.set(String(full), `de ${lots.length}`);
      for (const b of allNone.querySelectorAll('button')) b.disabled = !writable;
      ctx.parking.highlight((id) => lots.some((p) => p.id === id && p.tracked));
    },
  };
}
