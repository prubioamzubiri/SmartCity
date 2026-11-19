import { el } from '../dom.js';
import { button, card, cardTitle, empty, hint } from '../widgets.js';
import { t, locale } from '../../i18n/index.js';

// Sensores virtuales: de tráfico (coches que pasan) y de peatones. Se colocan con un clic en una calle.
export function createSensorsTab(ctx) {
  let selected = null; // { kind: 'traffic' | 'pedestrian', id }

  function group(kind, { title, mode, view, add, rename, remove, emptyText, help }) {
    const place = button(t(''), () => ctx.setMode(ctx.getMode() === mode ? 'navigate' : mode), 'primary');
    const list = el('div', { class: 'ui-stack' });
    const records = hint(t(''));
    const rows = new Map();
    let key = null;
    const node = card(cardTitle(title), hint(help), place, list, records);

    function render(sensors, writable) {
      const ids = new Set(sensors.map((s) => s.id));
      for (const id of [...view.markers.keys()]) if (!ids.has(id)) view.remove(id);
      for (const s of sensors) if (!view.markers.has(s.id)) view.add(s);
      if (selected?.kind === kind && !ids.has(selected.id)) selected = null;
      const k = JSON.stringify([sensors.map((s) => [s.id, s.name]), writable]);
      if (k !== key) {
        key = k;
        rows.clear();
        list.replaceChildren();
        if (!sensors.length) list.append(empty(emptyText));
        for (const s of sensors) {
          const name = el('input', { type: 'text', value: s.name, maxLength: 60, disabled: !writable, 'aria-label': t('Nombre del sensor'), onchange: () => ctx.run((c) => rename(c, s.id, name.value), t('Nombre guardado')) });
          const count = el('span', { class: 'ui-count' });
          const del = el('button', { type: 'button', class: 'ui-icon-button', textContent: t('✕'), disabled: !writable, title: t('Borrar (su histórico se conserva)'), onclick: (ev) => {
            ev.stopPropagation();
            ctx.run((c) => remove(c, s.id), t('Sensor {id} borrado', { id: s.id }));
          } });
          const row = el('div', { class: 'ui-list-row sensor', onclick: () => select(kind, s.id) }, name, count, del);
          rows.set(s.id, { row, count });
          list.append(row);
        }
      }
      for (const s of sensors) rows.get(s.id).count.textContent = t('{current} ahora · {total} en total', { current: s.current, total: s.total });
      for (const [id, r] of rows) r.row.classList.toggle('selected', selected?.kind === kind && selected.id === id);
      place.disabled = !writable;
    }

    function tick() {
      const active = ctx.getMode() === mode;
      place.textContent = active ? t('Haz clic en una calle para colocarlo… (Esc para terminar)') : (kind === 'traffic' ? t('Colocar sensor de tráfico') : t('Colocar sensor de peatones'));
      place.classList.toggle('active', active);
    }

    return { node, render, tick, records, view, add, remove };
  }

  const traffic = group('traffic', {
    title: t('Sensores de tráfico'), mode: 'sensor', view: ctx.server.view,
    add: (c, x, z) => c.addSensor(x, z), rename: (c, id, n) => c.renameSensor(id, n), remove: (c, id) => c.removeSensor(id),
    emptyText: t('Sin sensores de tráfico todavía.'),
    help: t('Cuentan los coches que pasan en cada sentido y su velocidad, cada 5 min simulados (CSV de tráfico).'),
  });
  const walkers = group('pedestrian', {
    title: t('Sensores de peatones'), mode: 'pedsensor', view: ctx.pedestrianSensors.view,
    add: (c, x, z) => c.addPedestrianSensor(x, z), rename: (c, id, n) => c.renamePedestrianSensor(id, n), remove: (c, id) => c.removePedestrianSensor(id),
    emptyText: t('Sin sensores de peatones todavía.'),
    help: t('Cuentan los peatones que pasan andando o cruzando, cada 5 min simulados (CSV de peatones).'),
  });

  function select(kind, id) {
    selected = id ? { kind, id } : null;
    ctx.server.view.select(kind === 'traffic' ? id : null);
    ctx.pedestrianSensors.view.select(kind === 'pedestrian' ? id : null);
    const s = ctx.state();
    if (s) {
      traffic.render(s.sensors, ctx.canWrite());
      walkers.render(s.pedestrianSensors, ctx.canWrite());
    }
  }

  return {
    node: el('div', {}, traffic.node, walkers.node, hint(t('Esc: dejar de colocar · Supr: borrar el sensor seleccionado. El histórico de un sensor borrado se conserva.'))),
    selectTraffic: (id) => select('traffic', id),
    selectPedestrian: (id) => select('pedestrian', id),
    removeSelected() {
      if (!selected) return;
      const g = selected.kind === 'traffic' ? traffic : walkers;
      ctx.run((c) => g.remove(c, selected.id), t('Sensor {id} borrado', { id: selected.id }));
    },
    place(mode, x, z) {
      const g = mode === 'sensor' ? traffic : walkers;
      ctx.run((c) => g.add(c, x, z), t('Sensor colocado'));
    },
    clear() {
      for (const g of [traffic, walkers]) for (const id of [...g.view.markers.keys()]) g.view.remove(id);
    },
    onState(s) {
      traffic.render(s.sensors, ctx.canWrite());
      walkers.render(s.pedestrianSensors, ctx.canWrite());
      traffic.records.textContent = t('Filas guardadas en el servidor: {v}', { v: s.records.traffic.toLocaleString(locale()) });
      walkers.records.textContent = t('Filas guardadas en el servidor: {v}', { v: s.records.pedestrians.toLocaleString(locale()) });
    },
    update() {
      traffic.tick();
      walkers.tick();
    },
  };
}
