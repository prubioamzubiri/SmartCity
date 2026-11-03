import { el } from './dom.js';
import { eventCalendar } from '../events/calendar.js';
import { simDate } from '../traffic/demand.js';
import { CONFIG } from '../config.js';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const DAY_MS = 86400000;
const MAX_DOTS = 4;

const pad = (n) => String(n).padStart(2, '0');
const clock = (seconds) => {
  const d = simDate(seconds);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const dayOf = (seconds) => Math.floor(seconds / 86400);
const people = (n) => n.toLocaleString('es-ES');

// Las 42 casillas (semanas de lunes a domingo) del mes: `day` es el índice de día simulado, como en el calendario de eventos.
export function monthGrid(year, month, baseDate = CONFIG.sim.baseDate) {
  const first = Date.UTC(year, month, 1);
  const offset = (new Date(first).getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => {
    const ms = first + (i - offset) * DAY_MS;
    const date = new Date(ms);
    return { day: Math.round((ms - baseDate) / DAY_MS), date: date.getUTCDate(), inMonth: date.getUTCMonth() === month };
  });
}

// Botón arriba a la derecha que abre el calendario de eventos: un mes con los eventos de cada día y el detalle del día elegido.
export function createEventCalendarPanel({ focus, csvUrl, calendar = eventCalendar, startSeconds = CONFIG.sim.startSeconds } = {}) {
  const root = el('div', { id: 'event-calendar' });
  document.body.append(root);

  let open = false;
  let view = null; // { year, month }
  let selectedDay = null;
  let nowSeconds = startSeconds;
  let renderKey = '';

  const panel = el('div', { class: 'event-panel' });
  panel.hidden = true;
  const toggle = el('button', { class: 'event-toggle', textContent: '📅 Calendario de eventos' });
  toggle.setAttribute('aria-expanded', 'false');
  toggle.addEventListener('click', () => {
    open = !open;
    panel.hidden = !open;
    toggle.classList.toggle('active', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      view = null;
      selectedDay = null;
      render(true);
    }
  });
  root.append(toggle, panel);

  // Descarga del servidor los eventos del mes que se ve (la asistencia solo viene de los ya terminados).
  const exportMonth = () => {
    const first = (year, month) => new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
    const next = new Date(Date.UTC(view.year, view.month + 1, 1));
    const url = csvUrl?.({ from: first(view.year, view.month), to: first(next.getUTCFullYear(), next.getUTCMonth()) });
    if (url) el('a', { href: url, download: '' }).click();
  };
  const exportButton = el('button', { class: 'event-export', textContent: '⬇ CSV de este mes', onclick: exportMonth });

  const ensureView = () => {
    if (view) return;
    const d = simDate(nowSeconds);
    view = { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    selectedDay = dayOf(nowSeconds);
  };
  const shift = (delta) => {
    const d = new Date(Date.UTC(view.year, view.month + delta, 1));
    view = { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    selectedDay = null;
    render(true);
  };

  function eventItem(event) {
    const type = calendar.types[event.type];
    const venue = calendar.venues[event.venue];
    return el('div', { class: 'event-item' },
      el('div', { class: 'event-title' },
        el('span', { class: 'event-icon', textContent: type.icon, title: type.label }),
        el('strong', { textContent: event.name })),
      el('div', { class: 'status', textContent: `${clock(event.start)}–${clock(event.end)} · ${venue.name}` }),
      el('div', {
        class: 'status',
        textContent: event.end <= nowSeconds
          ? `${people(event.attendance)} asistentes · +${(event.boost * 100).toFixed(0)} % de demanda`
          : 'Asistentes: se conocen cuando termina el evento',
      }),
      el('button', { textContent: 'Ver en el mapa', onclick: () => focus?.(venue.x, venue.z) }));
  }

  function render(force = false) {
    if (!open) return;
    ensureView();
    const today = dayOf(nowSeconds);
    const active = CONFIG.events.enabled ? calendar.activeAt(nowSeconds) : [];
    const dayEvents = selectedDay === null ? [] : calendar.eventsBetween(selectedDay * 86400, (selectedDay + 1) * 86400).filter((e) => dayOf(e.start) === selectedDay);
    const finished = dayEvents.filter((e) => e.end <= nowSeconds).length; // al terminar un evento se revela su asistencia
    const key = `${view.year}-${view.month}-${selectedDay}-${today}-${finished}-${active.map((a) => `${a.event.id}:${Math.round(a.intensity * 20)}`).join(',')}`;
    if (!force && key === renderKey) return;
    renderKey = key;

    const cells = monthGrid(view.year, view.month);
    const from = cells[0].day * 86400;
    const to = (cells[41].day + 1) * 86400;
    const byDay = new Map();
    for (const event of calendar.eventsBetween(from, to)) {
      const d = dayOf(event.start);
      if (d < cells[0].day || d > cells[41].day) continue;
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(event);
    }

    const grid = el('div', { class: 'event-grid' }, ...WEEKDAYS.map((w) => el('div', { class: 'event-weekday', textContent: w })));
    for (const cell of cells) {
      const events = byDay.get(cell.day) ?? [];
      const types = [...new Set(events.map((e) => e.type))].slice(0, MAX_DOTS);
      const button = el('button', {
        class: `event-day${cell.inMonth ? '' : ' outside'}${cell.day === today ? ' today' : ''}${cell.day === selectedDay ? ' selected' : ''}`,
        title: events.length ? events.map((e) => e.name).join('\n') : '',
        onclick: () => {
          selectedDay = cell.day;
          render(true);
        },
      }, el('span', { textContent: String(cell.date) }),
      el('span', { class: 'event-dots' }, ...types.map((t) => el('i', { style: `background:${calendar.types[t].color}` }))));
      grid.append(button);
    }

    const sections = [];
    if (active.length) {
      sections.push(el('h4', { textContent: 'En curso ahora' }),
        ...active.map(({ event, intensity }) => el('div', { class: 'status', textContent: `${calendar.types[event.type].icon} ${event.name} · ${calendar.venues[event.venue].name} · efecto ${(intensity * 100).toFixed(0)} %` })));
    }
    if (selectedDay !== null) {
      const d = new Date(CONFIG.sim.baseDate + selectedDay * DAY_MS);
      sections.push(el('h4', { textContent: `${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}` }));
      sections.push(...(dayEvents.length ? dayEvents.map(eventItem) : [el('div', { class: 'status', textContent: 'Sin eventos este día.' })]));
    }

    const legend = el('div', { class: 'legend' }, ...Object.values(calendar.types).map((t) =>
      el('span', {}, el('i', { style: `background:${t.color}` }), `${t.icon} ${t.label}`)));

    panel.replaceChildren(
      el('div', { class: 'event-head' },
        el('button', { textContent: '◀', title: 'Mes anterior', onclick: () => shift(-1) }),
        el('strong', { textContent: `${MONTHS[view.month]} ${view.year}` }),
        el('button', { textContent: '▶', title: 'Mes siguiente', onclick: () => shift(1) }),
        el('button', {
          textContent: 'Hoy',
          onclick: () => {
            view = null;
            ensureView();
            render(true);
          },
        })),
      grid, legend, el('div', { class: 'event-detail' }, ...sections),
      el('div', { class: 'status', textContent: 'Exporta los eventos del mes; la asistencia queda vacía hasta que el evento termina.' }),
      exportButton,
      el('a', {
        class: 'event-docs', textContent: '📖 Documentación de la API (eventos y datos)',
        href: CONFIG.events.docsUrl, target: '_blank', rel: 'noopener noreferrer',
      }));
  }

  return {
    // Hora simulada del servidor (o null sin conexión): marca el día de hoy y los eventos en curso.
    update(simSeconds) {
      nowSeconds = simSeconds ?? startSeconds;
      exportButton.disabled = simSeconds === null; // sin servidor no hay de dónde descargar
      render();
    },
  };
}
