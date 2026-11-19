import { el } from './dom.js';
import { eventCalendar } from '../events/calendar.js';
import { simDate } from '../traffic/demand.js';
import { CONFIG } from '../config.js';
import { holidayCalendar } from '../calendar/holidays.js';
import { t, locale, dayInitial, monthName, pct } from '../i18n/index.js';

const DAY_MS = 86400000;
const MAX_DOTS = 4;

const pad = (n) => String(n).padStart(2, '0');
const clock = (seconds) => {
  const d = simDate(seconds);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const dayOf = (seconds) => Math.floor(seconds / 86400);
const people = (n) => n.toLocaleString(locale());

export const DAY_KINDS = {
  weekday: t('Laborable'),
  preholiday: t('Víspera de festivo: más viajes por la tarde y más gente de ocio por la noche.'),
  weekend: t('Fin de semana (o festivo sin laborable al día siguiente): más movimiento de ocio y compras.'),
  sunday: t('Domingo o festivo con laborable al día siguiente: por la tarde, poco movimiento (cada uno en casa).'),
};

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

// Botón (en `bar`, arriba a la derecha) que abre en `host` el calendario de eventos: un mes con los eventos de cada día y el detalle del día elegido.
export function createEventCalendarPanel({ bar, host, focus, csvUrl, calendar = eventCalendar, holidays = holidayCalendar, startSeconds = CONFIG.sim.startSeconds } = {}) {
  let open = false;
  let view = null; // { year, month }
  let selectedDay = null;
  let nowSeconds = startSeconds;
  let renderKey = '';

  const panel = el('div', { class: 'event-panel' });
  panel.hidden = true;
  const toggle = el('button', { class: 'event-toggle', textContent: t('📅 Calendario de eventos') });
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
  bar.append(toggle);
  host.append(panel);

  // Descarga del servidor los eventos del mes que se ve (la asistencia solo viene de los ya terminados).
  const exportMonth = () => {
    const first = (year, month) => new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
    const next = new Date(Date.UTC(view.year, view.month + 1, 1));
    const url = csvUrl?.({ from: first(view.year, view.month), to: first(next.getUTCFullYear(), next.getUTCMonth()) });
    if (url) el('a', { href: url, download: '' }).click();
  };
  const exportButton = el('button', { class: 'event-export', textContent: t('⬇ CSV de este mes'), onclick: exportMonth });

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
        el('span', { class: 'event-icon', textContent: type.icon, title: t(type.label) }),
        el('strong', { textContent: event.name })),
      el('div', { class: 'status', textContent: t('{v}–{v2} · {name}', { v: clock(event.start), v2: clock(event.end), name: venue.name }) }),
      el('div', {
        class: 'status',
        textContent: event.end <= nowSeconds
          ? t('{v} asistentes · {v2} de demanda', { v: people(event.attendance), v2: pct(`+${(event.boost * 100).toFixed(0)}`) })
          : t('Asistentes: se conocen cuando termina el evento'),
      }),
      el('button', { textContent: t('Ver en el mapa'), onclick: () => focus?.(venue.x, venue.z) }));
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

    const holidayOf = (day) => (CONFIG.holidays.enabled ? holidays.holidayAt(day * 86400 + 43200) : null);
    const grid = el('div', { class: 'event-grid' }, ...[1, 2, 3, 4, 5, 6, 0].map((i) => el('div', { class: 'event-weekday', textContent: dayInitial(i) })));
    for (const cell of cells) {
      const events = byDay.get(cell.day) ?? [];
      const types = [...new Set(events.map((e) => e.type))].slice(0, MAX_DOTS);
      const holiday = holidayOf(cell.day);
      const button = el('button', {
        class: `event-day${cell.inMonth ? '' : ' outside'}${cell.day === today ? ' today' : ''}${cell.day === selectedDay ? ' selected' : ''}${holiday ? ' holiday' : ''}`,
        title: [holiday ? t('Festivo: {holiday}', { holiday }) : '', ...events.map((e) => e.name)].filter(Boolean).join('\n'),
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
      sections.push(el('h4', { textContent: t('En curso ahora') }),
        ...active.map(({ event, intensity }) => el('div', { class: 'status', textContent: t('{v} {name} · {v2} · efecto {v3}', { v: calendar.types[event.type].icon, name: event.name, v2: calendar.venues[event.venue].name, v3: pct(Math.round(intensity * 100)) }) })));
    }
    if (selectedDay !== null) {
      const d = new Date(CONFIG.sim.baseDate + selectedDay * DAY_MS);
      sections.push(el('h4', { textContent: t('{day} de {month}', { day: d.getUTCDate(), month: monthName(d.getUTCMonth()) }) }));
      if (CONFIG.holidays.enabled) {
        const holiday = holidayOf(selectedDay);
        if (holiday) sections.push(el('div', { class: 'event-holiday', textContent: t('🔴 Festivo: {holiday}', { holiday }) }));
        sections.push(el('div', { class: 'status', textContent: DAY_KINDS[holidays.kindAt(selectedDay * 86400 + 43200)] }));
      }
      sections.push(...(dayEvents.length ? dayEvents.map(eventItem) : [el('div', { class: 'status', textContent: t('Sin eventos este día.') })]));
    }

    const legend = el('div', { class: 'legend' }, ...Object.values(calendar.types).map((type) =>
      el('span', {}, el('i', { style: `background:${type.color}` }), `${type.icon} ${t(type.label)}`)),
    ...(CONFIG.holidays.enabled ? [el('span', {}, el('i', { class: 'holiday-key' }), t('🔴 Festivo'))] : []));

    panel.replaceChildren(
      el('div', { class: 'event-head' },
        el('button', { textContent: t('◀'), title: t('Mes anterior'), onclick: () => shift(-1) }),
        el('strong', { textContent: t('{month} de {year}', { month: monthName(view.month), year: view.year }) }),
        el('button', { textContent: t('▶'), title: t('Mes siguiente'), onclick: () => shift(1) }),
        el('button', {
          textContent: t('Hoy'),
          onclick: () => {
            view = null;
            ensureView();
            render(true);
          },
        })),
      grid, legend, el('div', { class: 'event-detail' }, ...sections),
      el('div', { class: 'status', textContent: t('Exporta los eventos del mes; la asistencia queda vacía hasta que el evento termina.') }),
      exportButton,
      el('a', {
        class: 'event-docs', textContent: t('📖 Documentación de la API (eventos y datos)'),
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
