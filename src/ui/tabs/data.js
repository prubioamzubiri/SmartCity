import { el } from '../dom.js';
import { nextDay } from '../../api/client.js';
import { card, cardTitle, field, hint } from '../widgets.js';

const DOWNLOADS = [
  { kind: 'city', title: 'Ciudad', text: 'Toda la ciudad cada 5 min: tráfico, viajes, autobuses, bicis, parkings y restricciones. Siempre activo.', records: 'city' },
  { kind: 'traffic', title: 'Tráfico', text: 'Sensores de tráfico.', records: 'traffic', sensor: true },
  { kind: 'pedestrians', title: 'Peatones', text: 'Sensores de peatones.', records: 'pedestrians', sensor: true },
  { kind: 'buses', title: 'Autobuses', text: 'Líneas registradas.', records: 'buses' },
  { kind: 'bikes', title: 'Bicicletas', text: 'Puestos registrados.', records: 'bikes' },
  { kind: 'parking', title: 'Parkings', text: 'Parkings registrados.', records: 'parking' },
  { kind: 'weather', title: 'Tiempo', text: 'Tiempo observado hora a hora.' },
  { kind: 'events', title: 'Eventos', text: 'Calendario de eventos.' },
];

// Descarga de los históricos en CSV y enlace a la guía de la API.
export function createDataTab(ctx) {
  const from = el('input', { type: 'date' });
  const to = el('input', { type: 'date' });
  const sensor = el('select', {}, el('option', { value: '', textContent: 'Todos' }));
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
      el('b', { textContent: `${d.title}` }), el('span', { textContent: d.text }), count);
    buttons.push(b);
    return b;
  }));

  const node = el('div', {},
    card(cardTitle('Periodo'),
      el('div', { class: 'ui-grid2' }, field('Desde', from), field('Hasta (incluido)', to)),
      field('Sensor (tráfico y peatones)', sensor),
      hint('Vacío = todo. Las fechas son simuladas. Para muchos datos, mejor por periodos: es más rápido.')),
    card(cardTitle('Descargar CSV'), grid),
    card(cardTitle('Desde un programa'),
      hint('Todo lo que se hace en este panel se puede hacer también desde un programa con la API: leer el estado, descargar los históricos y cambiar la ciudad.'),
      el('button', { type: 'button', class: 'ui-button', textContent: 'Abrir la guía de la API', onclick: () => ctx.openDocs() })));

  return {
    node,
    onState(s) {
      for (const d of DOWNLOADS) if (d.records) counts.get(d.kind).textContent = `${(s.records[d.records] ?? 0).toLocaleString('es-ES')} filas`;
      for (const b of buttons) b.disabled = false;
      const current = sensor.value;
      sensor.replaceChildren(el('option', { value: '', textContent: 'Todos' }),
        ...s.sensors.map((x) => el('option', { value: x.id, textContent: `Tráfico: ${x.name || x.id}` })),
        ...s.pedestrianSensors.map((x) => el('option', { value: x.id, textContent: `Peatones: ${x.name || x.id}` })));
      sensor.value = [...s.sensors, ...s.pedestrianSensors].some((x) => x.id === current) ? current : '';
    },
    onDisconnect() {
      for (const b of buttons) b.disabled = true;
    },
  };
}
