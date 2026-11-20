import { el } from '../dom.js';
import { nextDay } from '../../api/client.js';
import { card, cardTitle, field, hint } from '../widgets.js';
import { t, locale } from '../../i18n/index.js';

const DOWNLOADS = [
  { kind: 'city', title: t('Ciudad'), text: t('Toda la ciudad cada 5 min: tráfico, viajes, autobuses, bicis, parkings y restricciones. Siempre activo.'), records: 'city' },
  { kind: 'traffic', title: t('Tráfico'), text: t('Sensores de tráfico.'), records: 'traffic', sensor: true },
  { kind: 'pedestrians', title: t('Peatones'), text: t('Sensores de peatones.'), records: 'pedestrians', sensor: true },
  { kind: 'buses', title: t('Autobuses'), text: t('Líneas registradas.'), records: 'buses' },
  { kind: 'bikes', title: t('Bicicletas'), text: t('Puestos registrados.'), records: 'bikes' },
  { kind: 'parking', title: t('Parkings'), text: t('Parkings registrados.'), records: 'parking' },
  { kind: 'weather', title: t('Tiempo'), text: t('Tiempo observado hora a hora.') },
  { kind: 'events', title: t('Eventos'), text: t('Calendario de eventos.') },
];

// Descarga de los históricos en CSV y enlace a la guía de la API.
export function createDataTab(ctx) {
  const from = el('input', { type: 'date' });
  const to = el('input', { type: 'date' });
  const sensor = el('select', {}, el('option', { value: '', textContent: t('Todos') }));
  const counts = new Map();
  const buttons = [];

  function download(d) {
    try {
      const range = { from: from.value || undefined, to: to.value ? nextDay(to.value) : undefined };
      const url = ctx.sync.client.csvUrl(d.kind, { ...range, id: d.sensor ? sensor.value : '' });
      el('a', { href: url, download: '' }).click();
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
  }

  const grid = el('div', { class: 'ui-downloads' }, ...DOWNLOADS.map((d) => {
    const count = el('span', { class: 'ui-muted' });
    counts.set(d.kind, count);
    const b = el('button', { type: 'button', class: 'ui-download', onclick: () => download(d) },
      el('b', { textContent: t('{title}', { title: d.title }) }), el('span', { textContent: d.text }), count);
    buttons.push(b);
    return b;
  }));

  const node = el('div', {},
    card(cardTitle(t('Periodo')),
      el('div', { class: 'ui-grid2' }, field(t('Desde'), from), field(t('Hasta (incluido)'), to)),
      field(t('Sensor (tráfico y peatones)'), sensor),
      hint(t('Vacío = todo. Las fechas son simuladas. Para muchos datos, mejor por periodos: es más rápido.'))),
    card(cardTitle(t('Descargar CSV')), grid),
    card(cardTitle(t('Desde un programa')),
      hint(t('Todo lo que se hace en este panel se puede hacer también desde un programa con la API: leer el estado, descargar los históricos y cambiar la ciudad.')),
      el('div', { class: 'ui-row' },
        el('button', { type: 'button', class: 'ui-button', textContent: t('Abrir la guía de la API'), onclick: () => ctx.openDocs() }),
        el('button', { type: 'button', class: 'ui-button', textContent: t('Explorador de la API'), onclick: () => ctx.openDocs('explorer') }))));

  return {
    node,
    onState(s) {
      for (const d of DOWNLOADS) if (d.records) counts.get(d.kind).textContent = t('{v} filas', { v: (s.records[d.records] ?? 0).toLocaleString(locale()) });
      for (const b of buttons) b.disabled = false;
      const current = sensor.value;
      sensor.replaceChildren(el('option', { value: '', textContent: t('Todos') }),
        ...s.sensors.map((x) => el('option', { value: x.id, textContent: t('Tráfico: {v}', { v: x.name || x.id }) })),
        ...s.pedestrianSensors.map((x) => el('option', { value: x.id, textContent: t('Peatones: {v}', { v: x.name || x.id }) })));
      sensor.value = [...s.sensors, ...s.pedestrianSensors].some((x) => x.id === current) ? current : '';
    },
    onDisconnect() {
      for (const b of buttons) b.disabled = true;
    },
  };
}
