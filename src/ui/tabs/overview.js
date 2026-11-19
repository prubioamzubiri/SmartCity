import { CONFIG } from '../../config.js';
import { el } from '../dom.js';
import { card, cardTitle, hint, stat, toggle } from '../widgets.js';
import { demandFactor, demandNoise, scenarioForTime } from '../../traffic/demand.js';
import { CONDITIONS } from '../../weather/weather.js';
import { holidayCalendar } from '../../calendar/holidays.js';
import { t, locale } from '../../i18n/index.js';

export const SCENARIOS = {
  auto: t('Automático (calendario y festivos)'), weekday: 'Laborable', preholiday: t('Víspera de festivo'),
  weekend: t('Fin de semana'), sunday: t('Domingo o festivo'),
};

// Resumen: cómo está la ciudad ahora, la demanda (solo lectura) y las capas del mapa.
export function createOverviewTab(ctx) {
  const stats = {
    cars: stat(t('Coches circulando')),
    stopped: stat(t('Coches parados')),
    speed: stat(t('Velocidad media')),
    demand: stat(t('Demanda de tráfico')),
    buses: stat(t('Autobuses en servicio')),
    walkers: stat(t('Peatones en la calle')),
  };
  const day = el('div', { class: 'ui-lines' });

  // Demanda: la fija el servidor (no se puede cambiar) y varía un poco cada día y cada hora.
  const demand = el('div', { class: 'ui-lines' });

  const layers = el('div', { class: 'ui-toggles' },
    toggle(t('Autobuses, líneas y paradas'), true, (on) => ctx.transit.view.setVisible(on)).node,
    toggle(t('Puestos de bicicletas'), true, (on) => ctx.bikes.view.setVisible(on)).node,
    toggle(t('Aparcamientos'), true, (on) => (ctx.parking.layer.visible = on)).node,
    toggle(t('Restricciones de tráfico'), true, (on) => ctx.restrictionView.setVisible(on)).node,
    toggle(t('Sensores'), true, (on) => {
      ctx.server.view.group.visible = on;
      ctx.pedestrianSensors.view.group.visible = on;
    }).node,
  );

  const node = el('div', {},
    card(cardTitle(t('Ahora en la ciudad')), el('div', { class: 'ui-stats' }, ...Object.values(stats).map((s) => s.node))),
    card(cardTitle(t('El día')), day),
    card(cardTitle(t('Demanda')), demand,
      hint(t('La fija el servidor y cambia un poco cada día y cada hora, como en una ciudad real: no se puede controlar, hay que predecirla.'))),
    card(cardTitle(t('Qué se ve en el mapa')), layers,
      hint(t('Ratón: arrastrar = girar · botón derecho = mover · rueda = zoom. Pasa por encima de un autobús, parking o puesto para ver sus datos.'))),
  );

  return {
    node,
    update(s, time) {
      const fmt = (n) => Math.round(n).toLocaleString(locale());
      stats.cars.set(fmt(s.cars), t('de {v} en hora punta', { v: fmt(s.params.maxCars) }));
      stats.stopped.set(fmt(s.traffic.stopped), s.cars ? t('{v} % del total', { v: Math.round((100 * s.traffic.stopped) / s.cars) }) : '');
      stats.speed.set(`${s.traffic.avgKmh.toFixed(0)} km/h`);
      stats.demand.set(`${Math.round(demandFactor(time, s.params.scenario) * 100)} %`, t('de la hora punta'));
      const b = ctx.transit.buses;
      const active = b.stats.reduce((a, st) => a + st.active, 0);
      const riders = b.stats.reduce((a, st) => a + st.passengers, 0);
      stats.buses.set(fmt(active), t('{n} pasajeros', { n: fmt(riders) }));
      const today = demandNoise(Math.floor(time / 86400) * 86400 + 43200, CONFIG.traffic.dailyVariation, 0);
      demand.replaceChildren(
        el('div', {}, el('b', { textContent: t('Coches en hora punta: ') }), fmt(s.params.maxCars)),
        el('div', {}, el('b', { textContent: t('Peatones en hora punta: ') }), fmt(s.params.maxPedestrians)),
        el('div', {}, el('b', { textContent: t('Hoy: ') }), t('{v}{v2} % sobre un día normal', { v: today >= 1 ? '+' : '−', v2: Math.abs(Math.round((today - 1) * 100)) })));
      stats.walkers.set(fmt(s.pedestrians.expected), s.bikes ? t('{v} en bici', { v: fmt(s.bikes.inUse) }) : '');
      const holiday = CONFIG.holidays.enabled ? holidayCalendar.holidayAt(time) : null;
      const w = s.weather;
      const ev = s.events?.active ?? [];
      day.replaceChildren(
        el('div', {}, el('b', { textContent: t('Escenario: ') }), SCENARIOS[scenarioForTime(time, s.params.scenario)], holiday ? t(' · festivo: {holiday}', { holiday }) : ''),
        el('div', {}, el('b', { textContent: t('Tiempo: ') }), w ? `${CONDITIONS[w.condition].icon} ${CONDITIONS[w.condition].label}, ${w.temperature_c.toFixed(0)} °C` : '—'),
        el('div', {}, el('b', { textContent: t('Eventos: ') }), ev.length ? t('{v} (+{v2} % de demanda)', { v: ev.map((e) => e.name).join(', '), v2: Math.round(s.events.boost * 100) }) : t('ninguno ahora')),
        hint(t('La previsión del tiempo y el calendario de eventos están arriba a la derecha.')),
      );
    },
  };
}
