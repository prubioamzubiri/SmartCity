import { CONFIG } from '../../config.js';
import { el } from '../dom.js';
import { badge, button, card, cardTitle, empty, hint, meter, stat } from '../widgets.js';
import { t, locale } from '../../i18n/index.js';

const legendItem = (color, text) => el('span', {}, el('i', { style: `background:${color}` }), text);
const P = CONFIG.parking;
const euros = (v) => `${Number(v).toLocaleString(locale(), { maximumFractionDigits: 2 })} €`;
const describe = (tariff) => (tariff ? [`${euros(tariff.price)}/h`, ...tariff.schedule.map((b) => `${b.from}–${b.to}: ${euros(b.price)}`)].join(' · ') : t('{v}/h (por defecto)', { v: euros(P.basePrice) }));
const priceInput = (value) => el('input', { type: 'number', min: P.minPrice, max: P.maxPrice, step: 0.5, value, class: 'ui-stepper-input' });

// Editor de la tarifa de mañana de un parking: precio base y hasta maxBands franjas horarias.
function tariffEditor(ctx, lot) {
  const base = priceInput(P.basePrice);
  const bands = el('div', { class: 'ui-stack' });
  const addBand = (b = { from: '17:00', to: '20:00', price: P.basePrice }) => {
    if (bands.children.length >= P.maxBands) return;
    const row = el('div', { class: 'ui-row ui-band' },
      el('input', { type: 'time', value: b.from, 'aria-label': t('Desde') }), '–',
      el('input', { type: 'time', value: b.to, 'aria-label': t('Hasta') }),
      priceInput(b.price), '€',
      button(t('✕'), () => { row.remove(); sync(); }, 'ghost'));
    bands.append(row);
    sync();
  };
  const add = button(t('+ Franja'), () => addBand(), 'ghost');
  const sync = () => { add.disabled = bands.children.length >= P.maxBands; };
  const read = () => ({
    price: Number(base.value),
    schedule: [...bands.children].map((row) => {
      const [from, to, price] = row.querySelectorAll('input');
      return { from: from.value, to: to.value, price: Number(price.value) };
    }),
  });
  const fill = (tariff) => {
    base.value = tariff?.price ?? P.basePrice;
    bands.replaceChildren();
    for (const b of tariff?.schedule ?? []) addBand(b);
    sync();
  };
  const save = button(t('Guardar para mañana'), () => {
    const { price, schedule } = read();
    ctx.run((c) => c.setParkingTariff(lot.id, price, schedule), t('{name}: tarifa de mañana guardada (se aplica a las 0:00)', { name: lot.name }));
  });
  const reset = button(t('Por defecto'), () => ctx.run((c) => c.setParkingTariff(lot.id, null, []), t('{name}: mañana vuelve a la tarifa por defecto', { name: lot.name })), 'ghost');
  const node = el('details', { class: 'ui-details ui-tariff' },
    el('summary', { textContent: t('Cambiar la tarifa de mañana') }),
    el('div', { class: 'ui-row nowrap' }, el('span', { class: 'ui-field-label', textContent: t('Precio (€/h)') }), base),
    el('span', { class: 'ui-field-label', textContent: t('Franjas horarias (otro precio a esas horas)') }),
    bands,
    el('div', { class: 'ui-row' }, add, save, reset));
  node.addEventListener('toggle', () => { if (node.open) fill(lot.live?.tomorrow ?? lot.live?.today); });
  return { node, buttons: [save, reset, add], inputs: () => node.querySelectorAll('input') };
}

// Parkings subterráneos públicos: ocupación simulada y cuáles registra el servidor.
export function createParkingsTab(ctx) {
  const stats = { avg: stat(t('Ocupación media')), full: stat(t('Llenos (≥ 95 %)')) };
  const list = el('div', { class: 'ui-stack' });
  const tracked = () => (ctx.state()?.parkings ?? []).filter((p) => p.tracked).map((p) => p.id);
  const setTracked = (ids, ok) => ctx.run((c) => c.setTrackedParkings(ids), ok);
  const toggle = (id) => {
    const ids = new Set(tracked());
    const on = !ids.delete(id);
    if (on) ids.add(id);
    const name = (ctx.state()?.parkings ?? []).find((p) => p.id === id)?.name ?? id;
    return setTracked([...ids], on ? t('{name}: se registra su ocupación', { name }) : t('{name}: deja de registrarse', { name }));
  };
  const rows = new Map();
  const allNone = el('div', { class: 'ui-row' },
    button(t('Registrar todos'), () => setTracked((ctx.state()?.parkings ?? []).map((p) => p.id), t('Se registran todos los parkings')), 'ghost'),
    button(t('Ninguno'), () => setTracked([], t('No se registra ningún parking')), 'ghost'));

  const node = el('div', {},
    card(el('div', { class: 'ui-stats two' }, stats.avg.node, stats.full.node)),
    card(cardTitle(t('Parkings subterráneos')),
      hint(t('«Registrar» guarda su ocupación cada 5 min simulados (CSV de parkings). También puedes pulsar la P de un parking en el mapa.')),
      hint(t('La tarifa solo cambia a las 0:00: lo que guardes hoy se aplica mañana y se mantiene hasta que la cambies. Precio entre {v} y {v2} por hora (por defecto {v3}). Un parking más caro que sus vecinos les manda coches; con los parkings caros, parte de la gente deja el coche. Los precios altos tienen un coste para los ciudadanos.', { v: euros(P.minPrice), v2: euros(P.maxPrice), v3: euros(P.basePrice) })),
      list, allNone),
    card(cardTitle(t('Leyenda del mapa')),
      el('div', { class: 'ui-legend' },
        legendItem('#2ecc71', t('Parking con sitio')), legendItem('#e74c3c', t('Parking lleno')),
        legendItem('#7a4fd6', t('Área subterránea')), legendItem('#4fc3f7', t('Aparcamiento en calle')),
        legendItem('#ffffff', t('Plaza suelta'))),
      hint(t('Sobre cada P, el precio de ahora: en rojo si es más caro que el de por defecto y en verde si es más barato.')),
      ctx.parking.stats ? hint(t('Datos de OSM: {lots} aparcamientos, {underground} subterráneos públicos, {street} tramos con aparcamiento en la calle.', { lots: ctx.parking.stats.lots, underground: ctx.parking.stats.underground, street: ctx.parking.stats.street })) : ''));

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
        if (!lots.length) list.append(empty(t('Sin parkings subterráneos en los datos.')));
        for (const lot of lots) {
          const load = meter();
          const pct = el('span', { class: 'ui-muted' });
          const box = el('input', { type: 'checkbox', onchange: () => toggle(lot.id) });
          const now = el('div', { class: 'ui-muted' });
          const flags = el('span', { class: 'ui-badges' });
          const entry = { id: lot.id, name: lot.name, live: lot };
          const editor = tariffEditor(ctx, entry);
          const row = el('div', { class: 'ui-item' },
            el('div', { class: 'ui-item-head' }, el('b', { textContent: lot.name }), el('label', { class: 'ui-check' }, box, t(' Registrar'))),
            el('div', { class: 'ui-row nowrap' }, load.node, pct),
            now, flags, editor.node);
          rows.set(lot.id, { load, pct, box, now, flags, editor, entry });
          list.append(row);
        }
      }
      let sum = 0;
      let full = 0;
      for (const lot of lots) {
        const r = rows.get(lot.id);
        r.load.set(lot.occupancy, lot.occupancy >= 0.95 ? 'var(--danger)' : lot.occupancy >= 0.8 ? 'var(--warn)' : 'var(--ok)');
        r.pct.textContent = t('{v} % de {capacity} plazas', { v: Math.round(lot.occupancy * 100), capacity: lot.capacity });
        r.box.checked = lot.tracked;
        r.box.disabled = !writable;
        r.entry.live = lot;
        r.now.textContent = lot.price === undefined ? '' : t('Ahora: {price}/h · Hoy: {today}', { price: euros(lot.price), today: describe(lot.today) });
        r.flags.replaceChildren(...(lot.tomorrow ? [badge(t('Mañana: {v}', { v: describe(lot.tomorrow) }), 'warn')] : []));
        for (const b of r.editor.buttons) b.disabled = !writable;
        for (const i of r.editor.inputs()) i.disabled = !writable;
        sum += lot.occupancy;
        if (lot.occupancy >= 0.95) full++;
      }
      stats.avg.set(lots.length ? `${Math.round((100 * sum) / lots.length)} %` : '—');
      stats.full.set(String(full), t('de {length}', { length: lots.length }));
      for (const b of allNone.querySelectorAll('button')) b.disabled = !writable;
      ctx.parking.highlight((id) => lots.some((p) => p.id === id && p.tracked));
      const prices = new Map(lots.map((p) => [p.id, p.price]));
      ctx.parking.prices?.((id) => prices.get(id));
    },
  };
}
