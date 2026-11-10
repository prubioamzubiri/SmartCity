import { CONFIG } from '../config.js';
import { el } from './dom.js';
import { createShell } from './shell.js';
import { toast } from './widgets.js';
import { simDate } from '../traffic/demand.js';
import { createOverviewTab } from './tabs/overview.js';
import { createSignalsTab } from './tabs/signals.js';
import { createRestrictionsTab } from './tabs/restrictions.js';
import { createBusesTab } from './tabs/buses.js';
import { createBikesTab } from './tabs/bikes.js';
import { createParkingsTab } from './tabs/parkings.js';
import { createSensorsTab } from './tabs/sensors.js';
import { createDataTab } from './tabs/data.js';
import { createConnectionTab } from './tabs/connection.js';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Mensaje de error comprensible para un fallo de la API.
function explain(err) {
  if (err.status === 401) return 'El servidor pide un token válido para cambiar la ciudad: ponlo en Conexión.';
  if (err.status === 403) return err.message;
  if (err.name === 'TimeoutError' || err instanceof TypeError) return 'Sin conexión con el servidor.';
  return err.message;
}

// Panel de control del visor: barra de secciones a la izquierda. Muestra el estado del servidor y le envía los cambios;
// no guarda estado propio.
export function createHud(deps) {
  const { sync, signals, setMode: setMapMode, getMode, focusSignal, focusPoint, parking, server, pedestrianSensors, transit, bikes, graph, restrictionView } = deps;
  const shell = createShell();
  let state = null;

  const ctx = {
    sync, signals, parking, server, pedestrianSensors, transit, bikes, graph, restrictionView, focusSignal, focusPoint,
    state: () => state,
    simNow: () => sync.simTime() ?? CONFIG.sim.startSeconds,
    getMode,
    setMode(mode) {
      setMapMode(mode);
      restrictions?.refresh();
    },
    toast,
    canWrite: () => Boolean(state) && (!state.writeProtected || Boolean(sync.client?.token)),
    // Envía un cambio al servidor, avisa del resultado y devuelve si ha ido bien.
    async run(fn, ok = '') {
      try {
        await sync.act(fn);
        if (ok) toast(ok, 'ok');
        return true;
      } catch (err) {
        toast(explain(err), 'error', 5000);
        return false;
      }
    },
    openDocs() {
      try {
        const client = sync.client ?? sync.createClient({ baseUrl: connection.url(), token: '' });
        if (!client.baseUrl) throw new Error('Pon la dirección del servidor en Conexión');
        window.open(client.docsUrl(), '_blank', 'noopener');
      } catch (err) {
        toast(err.message, 'error');
      }
    },
  };

  // Cabecera: hora simulada y estado de la conexión y de los permisos.
  const clock = el('div', { class: 'ui-clock' });
  const clockSub = el('div', { class: 'ui-clock-sub' });
  const pills = el('div', { class: 'ui-pills' });
  shell.header.append(el('div', { class: 'ui-brand', textContent: 'SmartCity Donostia' }), clock, clockSub, pills);

  const overview = createOverviewTab(ctx);
  const signalsTab = createSignalsTab(ctx);
  const restrictions = createRestrictionsTab(ctx);
  const buses = createBusesTab(ctx);
  const bikesTab = createBikesTab(ctx);
  const parkings = createParkingsTab(ctx);
  const sensors = createSensorsTab(ctx);
  const data = createDataTab(ctx);
  const connection = createConnectionTab(ctx);
  const tabs = [overview, signalsTab, restrictions, buses, bikesTab, parkings, sensors, data];

  shell.addTab('overview', { icon: '🏙️', label: 'Resumen', node: overview.node });
  shell.addTab('signals', { icon: '🚦', label: 'Semáforos', node: signalsTab.node });
  shell.addTab('restrictions', { icon: '🚧', label: 'Restricciones', short: 'Cortes', node: restrictions.node, onShow: () => restrictions.refresh() });
  shell.addTab('buses', { icon: '🚌', label: 'Autobuses', node: buses.node });
  shell.addTab('bikes', { icon: '🚲', label: 'Bicis', node: bikesTab.node });
  shell.addTab('parkings', { icon: '🅿️', label: 'Parkings', node: parkings.node });
  shell.addTab('sensors', { icon: '📍', label: 'Sensores', node: sensors.node });
  shell.addTab('data', { icon: '📥', label: 'Datos', node: data.node });
  shell.addTab('connection', { icon: '🔌', label: 'Conexión', node: connection.node });

  function renderPills() {
    const items = [];
    if (!state) items.push(['Sin conexión', 'danger']);
    else {
      items.push(state.caughtUp ? ['Conectado', 'ok'] : [`Recuperando ${Math.round(state.behindSimSeconds / 3600)} h`, 'warn']);
      if (!ctx.canWrite()) items.push(['Solo lectura', 'warn']);
    }
    pills.replaceChildren(...items.map(([text, kind]) => el('span', { class: `ui-pill ${kind}`, textContent: text })));
    shell.flag('connection', !state || !ctx.canWrite(), state ? 'warn' : 'danger');
  }

  sync.on('state', (s) => {
    const first = !state;
    state = s;
    // La semilla de la ciudad decide la variación de la demanda: el visor usa la del servidor (peatones incluidos).
    if (Number.isInteger(s.seed)) CONFIG.sim.seed = s.seed;
    signals.setPlan(s.signalPlan);
    if (s.graphKey !== deps.localGraphKey) connection.setStatus('El servidor simula otra ciudad distinta a la del visor: los coches no se dibujan.', 'error');
    else connection.setStatus(s.caughtUp ? 'Conectado y al día.' : `Conectado · recuperando ${Math.round(s.behindSimSeconds / 3600)} h simuladas tras una parada.`, 'ok');
    for (const tab of tabs) tab.onState?.(s);
    renderPills();
    if (first && !ctx.canWrite()) toast('Modo solo lectura: para cambiar la ciudad pon el token en Conexión.', 'info', 6000);
  });
  sync.on('error', (err) => {
    connection.setStatus(`Sin conexión: ${err.message}`, 'error');
  });
  sync.on('disconnect', () => {
    state = null;
    sensors.clear();
    data.onDisconnect();
    restrictionView.update([]);
    if (['sensor', 'pedsensor', 'restriction'].includes(getMode())) ctx.setMode('navigate');
    connection.setStatus('Desconectado.');
    renderPills();
  });

  shell.restore('overview');
  if (!connection.autoconnect()) shell.show('connection');
  renderPills();

  let last = 0;
  return {
    revealSignal(id) {
      shell.show('signals');
      signalsTab.select(id);
    },
    revealBikeStation(id) {
      shell.show('bikes');
      bikesTab.reveal(id);
    },
    selectSensor: (id) => sensors.selectTraffic(id ?? null),
    selectPedestrianSensor: (id) => sensors.selectPedestrian(id ?? null),
    removeSelectedSensor: () => sensors.removeSelected(),
    toggleParking: (id) => parkings.toggle(id),
    addServerSensor: (x, z) => sensors.place('sensor', x, z),
    addPedestrianSensor: (x, z) => sensors.place('pedsensor', x, z),
    // Modo «restriction»: clic y cursor sobre el mapa mientras se elige zona o calles.
    pickRestriction: (target) => restrictions.pick(target),
    restrictionHover: (target) => restrictions.hoverTarget(target),
    modeChanged: () => restrictions.refresh(),
    update(now) {
      if (now - last < 250) return;
      last = now;
      sensors.update();
      buses.update();
      const t = sync.simTime();
      if (t === null || !state) {
        clock.textContent = '--:--';
        clockSub.textContent = 'Sin conexión con el servidor';
        return;
      }
      const d = simDate(t);
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      clock.textContent = `${hh}:${mm}`;
      clockSub.textContent = `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]} de ${d.getUTCFullYear()} · ×${Math.round(state.scale)}`;
      if (shell.current() === 'overview') overview.update(state, t);
    },
  };
}
