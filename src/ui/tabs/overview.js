import { CONFIG } from '../../config.js';
import { el } from '../dom.js';
import { card, cardTitle, hint, stat, toggle } from '../widgets.js';
import { demandFactor, demandNoise, scenarioForTime } from '../../traffic/demand.js';
import { CONDITIONS } from '../../weather/weather.js';
import { holidayCalendar } from '../../calendar/holidays.js';

export const SCENARIOS = {
  auto: 'Automático (calendario y festivos)', weekday: 'Laborable', preholiday: 'Víspera de festivo',
  weekend: 'Fin de semana', sunday: 'Domingo o festivo',
};

// Resumen: cómo está la ciudad ahora, la demanda (solo lectura) y las capas del mapa.
export function createOverviewTab(ctx) {
  const stats = {
    cars: stat('Coches circulando'),
    stopped: stat('Coches parados'),
    speed: stat('Velocidad media'),
    demand: stat('Demanda de tráfico'),
    buses: stat('Autobuses en servicio'),
    walkers: stat('Peatones en la calle'),
  };
  const day = el('div', { class: 'ui-lines' });

  // Demanda: la fija el servidor (no se puede cambiar) y varía un poco cada día y cada hora.
  const demand = el('div', { class: 'ui-lines' });

  const layers = el('div', { class: 'ui-toggles' },
    toggle('Autobuses, líneas y paradas', true, (on) => ctx.transit.view.setVisible(on)).node,
    toggle('Puestos de bicicletas', true, (on) => ctx.bikes.view.setVisible(on)).node,
    toggle('Aparcamientos', true, (on) => (ctx.parking.layer.visible = on)).node,
    toggle('Restricciones de tráfico', true, (on) => ctx.restrictionView.setVisible(on)).node,
    toggle('Sensores', true, (on) => {
      ctx.server.view.group.visible = on;
      ctx.pedestrianSensors.view.group.visible = on;
    }).node,
  );

  const node = el('div', {},
    card(cardTitle('Ahora en la ciudad'), el('div', { class: 'ui-stats' }, ...Object.values(stats).map((s) => s.node))),
    card(cardTitle('El día'), day),
    card(cardTitle('Demanda'), demand,
      hint('La fija el servidor y cambia un poco cada día y cada hora, como en una ciudad real: no se puede controlar, hay que predecirla.')),
    card(cardTitle('Qué se ve en el mapa'), layers,
      hint('Ratón: arrastrar = girar · botón derecho = mover · rueda = zoom. Pasa por encima de un autobús, parking o puesto para ver sus datos.')),
  );

  return {
    node,
    update(s, t) {
      const fmt = (n) => Math.round(n).toLocaleString('es-ES');
      stats.cars.set(fmt(s.cars), `de ${fmt(s.params.maxCars)} en hora punta`);
      stats.stopped.set(fmt(s.traffic.stopped), s.cars ? `${Math.round((100 * s.traffic.stopped) / s.cars)} % del total` : '');
      stats.speed.set(`${s.traffic.avgKmh.toFixed(0)} km/h`);
      stats.demand.set(`${Math.round(demandFactor(t, s.params.scenario) * 100)} %`, 'de la hora punta');
      const b = ctx.transit.buses;
      const active = b.stats.reduce((a, st) => a + st.active, 0);
      const riders = b.stats.reduce((a, st) => a + st.passengers, 0);
      stats.buses.set(fmt(active), `${fmt(riders)} pasajeros`);
      const today = demandNoise(Math.floor(t / 86400) * 86400 + 43200, CONFIG.traffic.dailyVariation, 0);
      demand.replaceChildren(
        el('div', {}, el('b', { textContent: 'Coches en hora punta: ' }), fmt(s.params.maxCars)),
        el('div', {}, el('b', { textContent: 'Peatones en hora punta: ' }), fmt(s.params.maxPedestrians)),
        el('div', {}, el('b', { textContent: 'Hoy: ' }), `${today >= 1 ? '+' : '−'}${Math.abs(Math.round((today - 1) * 100))} % sobre un día normal`));
      stats.walkers.set(fmt(s.pedestrians.expected), s.bikes ? `${fmt(s.bikes.inUse)} en bici` : '');
      const holiday = CONFIG.holidays.enabled ? holidayCalendar.holidayAt(t) : null;
      const w = s.weather;
      const ev = s.events?.active ?? [];
      day.replaceChildren(
        el('div', {}, el('b', { textContent: 'Escenario: ' }), SCENARIOS[scenarioForTime(t, s.params.scenario)], holiday ? ` · festivo: ${holiday}` : ''),
        el('div', {}, el('b', { textContent: 'Tiempo: ' }), w ? `${CONDITIONS[w.condition].icon} ${CONDITIONS[w.condition].label}, ${w.temperature_c.toFixed(0)} °C` : '—'),
        el('div', {}, el('b', { textContent: 'Eventos: ' }), ev.length ? `${ev.map((e) => e.name).join(', ')} (+${Math.round(s.events.boost * 100)} % de demanda)` : 'ninguno ahora'),
        hint('La previsión del tiempo y el calendario de eventos están arriba a la derecha.'),
      );
    },
  };
}
