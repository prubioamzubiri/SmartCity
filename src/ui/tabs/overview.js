import { CONFIG } from '../../config.js';
import { el } from '../dom.js';
import { card, cardTitle, field, hint, stat, toggle } from '../widgets.js';
import { demandFactor, scenarioForTime } from '../../traffic/demand.js';
import { CONDITIONS } from '../../weather/weather.js';
import { holidayCalendar } from '../../calendar/holidays.js';

export const SCENARIOS = {
  auto: 'Automático (calendario y festivos)', weekday: 'Laborable', preholiday: 'Víspera de festivo',
  weekend: 'Fin de semana', sunday: 'Domingo o festivo',
};

// Resumen: cómo está la ciudad ahora, la demanda y las capas del mapa.
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

  // Demanda (parámetros globales). El profesor puede bloquearla en el servidor (LOCK_PARAMS).
  const scenario = el('select', { onchange: () => ctx.run((c) => c.setParams({ scenario: scenario.value }), 'Escenario cambiado') },
    ...Object.entries(SCENARIOS).map(([value, textContent]) => el('option', { value, textContent })));
  const carsValue = el('output');
  const cars = el('input', {
    type: 'range', min: 0, max: CONFIG.cars.max, step: 100,
    oninput: () => (carsValue.textContent = cars.value),
    onchange: () => ctx.run((c) => c.setParams({ maxCars: Number(cars.value) }), `Coches en hora punta: ${cars.value}`),
  });
  const walkersValue = el('output');
  const walkers = el('input', {
    type: 'range', min: 0, max: CONFIG.pedestrians.max, step: 500,
    oninput: () => (walkersValue.textContent = walkers.value),
    onchange: () => ctx.run((c) => c.setParams({ maxPedestrians: Number(walkers.value) }), `Peatones en hora punta: ${walkers.value}`),
  });
  const lockedNote = hint('El profesor ha fijado la demanda en este servidor: forma parte del escenario y no se puede cambiar.');
  lockedNote.classList.add('warn');
  const demandControls = el('div', {},
    field('Escenario', scenario, 'Automático sigue el calendario: laborables, fines de semana, vísperas y festivos.'),
    field('Coches en hora punta', el('div', { class: 'ui-range' }, cars, carsValue)),
    field('Peatones en hora punta', el('div', { class: 'ui-range' }, walkers, walkersValue)),
  );

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
    card(cardTitle('Demanda'), lockedNote, demandControls),
    card(cardTitle('Qué se ve en el mapa'), layers,
      hint('Ratón: arrastrar = girar · botón derecho = mover · rueda = zoom. Pasa por encima de un autobús, parking o puesto para ver sus datos.')),
  );

  return {
    node,
    onState(s) {
      lockedNote.hidden = !s.paramsLocked;
      for (const input of [scenario, cars, walkers]) input.disabled = s.paramsLocked || !ctx.canWrite();
      if (document.activeElement !== scenario) scenario.value = s.params.scenario;
      if (document.activeElement !== cars) cars.value = carsValue.textContent = s.params.maxCars;
      if (document.activeElement !== walkers) walkers.value = walkersValue.textContent = s.params.maxPedestrians;
    },
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
