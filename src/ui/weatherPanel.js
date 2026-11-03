import { el } from './dom.js';
import { CONDITIONS } from '../weather/weather.js';

const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const REFRESH_MS = 15000;
const STEP_HOURS = 3; // una fila de la tabla cada tantas horas de previsión

const pad = (n) => String(n).padStart(2, '0');
const parse = (iso) => new Date(`${iso}Z`);
const label = (iso) => {
  const d = parse(iso);
  return `${WEEKDAYS[d.getUTCDay()]} ${pad(d.getUTCHours())}:00`;
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
  const toggle = el('button', { class: 'weather-toggle', textContent: '🌡️ Tiempo' });
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
      panel.replaceChildren(el('div', { class: 'status', textContent: `No se pudo cargar la previsión: ${err.message}` }));
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
        el('td', { textContent: `${f.temperature_c.toFixed(0)} °C` }),
        el('td', { class: f.rain_probability >= 0.5 ? 'rain' : '', textContent: `💧 ${Math.round(f.rain_probability * 100)} %` }));
      lastDay = day;
      return row;
    }));
    panel.replaceChildren(
      el('div', { class: 'weather-now', textContent: `Ahora: ${summary(current)} · ${CONDITIONS[current.condition].label}` }),
      el('div', { class: 'status', textContent: `Lluvia ${current.rain_mm_h.toFixed(1)} mm/h · nubes ${current.cloud_pct} %` }),
      el('div', { class: 'status', textContent: 'Previsión a 48 h (hora simulada). Cuanto más lejos, menos fiable.' }),
      table,
      el('div', { class: 'status', textContent: 'El tiempo observado hasta ahora se descarga con «CSV del tiempo» (panel del servidor).' }));
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
    panel.replaceChildren(el('div', { class: 'status', textContent: 'Cargando previsión…' }));
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
