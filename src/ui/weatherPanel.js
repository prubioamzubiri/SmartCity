import { el } from './dom.js';
import { CONDITIONS } from '../weather/weather.js';
import { t, dayShort } from '../i18n/index.js';

const REFRESH_MS = 15000;
const STEP_HOURS = 3; // una fila de la tabla cada tantas horas de previsión

const pad = (n) => String(n).padStart(2, '0');
const parse = (iso) => new Date(`${iso}Z`);
const label = (iso) => {
  const d = parse(iso);
  return `${dayShort(d.getUTCDay())} ${pad(d.getUTCHours())}:00`;
};
const summary = (w) => `${CONDITIONS[w.condition].icon} ${w.temperature_c.toFixed(0)} °C`;

// Botón arriba a la derecha con el tiempo de ahora y, al abrirlo, la previsión de las próximas 48 horas simuladas.
// Todo viene del servidor: el visor no calcula nada del tiempo futuro.
export function createWeatherPanel({ bar, host, sync }) {
  let open = false;
  let timer = null;
  let loading = false;

  const panel = el('div', { class: 'weather-panel' });
  panel.hidden = true;
  const toggle = el('button', { class: 'weather-toggle', textContent: t('🌡️ Tiempo') });
  toggle.setAttribute('aria-expanded', 'false');
  toggle.disabled = true;
  bar.append(toggle);
  host.append(panel);

  async function refresh() {
    if (!sync.client || loading) return;
    loading = true;
    try {
      render(await sync.client.weather());
    } catch (err) {
      panel.replaceChildren(el('div', { class: 'status', textContent: t('No se pudo cargar la previsión: {message}', { message: err.message }) }));
    } finally {
      loading = false;
    }
  }

  function render({ current, forecast }) {
    const rows = forecast.filter((f) => parse(f.time).getUTCHours() % STEP_HOURS === 0);
    let lastDay = null;
    const table = el('table', { class: 'weather-table' }, ...rows.map((f) => {
      const day = parse(f.time).getUTCDate();
      const row = el('tr', { class: day !== lastDay && lastDay !== null ? 'day' : '' },
        el('td', { textContent: label(f.time) }),
        el('td', { textContent: CONDITIONS[f.condition].icon, title: CONDITIONS[f.condition].label }),
        el('td', { textContent: t('{v} °C', { v: f.temperature_c.toFixed(0) }) }),
        el('td', { class: f.rain_probability >= 0.5 ? 'rain' : '', textContent: t('💧 {v} %', { v: Math.round(f.rain_probability * 100) }) }));
      lastDay = day;
      return row;
    }));
    panel.replaceChildren(
      el('div', { class: 'weather-now', textContent: t('Ahora: {v} · {v2}', { v: summary(current), v2: CONDITIONS[current.condition].label }) }),
      el('div', { class: 'status', textContent: t('Lluvia {v} mm/h · nubes {cloud_pct} %', { v: current.rain_mm_h.toFixed(1), cloud_pct: current.cloud_pct }) }),
      el('div', { class: 'status', textContent: t('Previsión a 48 h (hora simulada). Cuanto más lejos, menos fiable.') }),
      table,
      el('div', { class: 'status', textContent: t('El tiempo observado hasta ahora se descarga con «CSV del tiempo» (panel del servidor).') }));
  }

  const close = () => {
    open = false;
    panel.hidden = true;
    toggle.classList.remove('active');
    toggle.setAttribute('aria-expanded', 'false');
    clearInterval(timer);
  };

  toggle.addEventListener('click', () => {
    if (open) return close();
    open = true;
    panel.hidden = false;
    toggle.classList.add('active');
    toggle.setAttribute('aria-expanded', 'true');
    panel.replaceChildren(el('div', { class: 'status', textContent: t('Cargando previsión…') }));
    refresh();
    timer = setInterval(refresh, REFRESH_MS);
  });

  return {
    // Tiempo actual que publica el servidor en su estado (null sin conexión o con el tiempo desactivado).
    update(current) {
      toggle.textContent = current ? `${summary(current)} · Tiempo` : '🌡️ Tiempo';
      toggle.disabled = !current;
      if (!current && open) close();
    },
  };
}
