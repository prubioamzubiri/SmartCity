import { CONFIG } from '../src/config.js';
import { eventCalendar } from '../src/events/calendar.js';
import { weather, CONDITIONS } from '../src/weather/weather.js';
import { holidayCalendar } from '../src/calendar/holidays.js';
import { simDate } from '../src/traffic/demand.js';
import { latLonToXZ } from '../src/city/projection.js';
import { renderDocsPage } from '../src/docs/markdown.js';
import { SIGNAL_MODES } from '../src/traffic/signals.js';
import { RESTRICTION_MODES, RestrictionError, MAX_RADIUS, describeWay, roadsNear } from '../src/traffic/restrictions.js';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BIKE_COLUMNS, BUS_COLUMNS, CITY_COLUMNS, PARKING_COLUMNS, PEDESTRIAN_COLUMNS, TRAFFIC_COLUMNS } from './store.js';

const MAX_BODY = 64 * 1024;
const TIME_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;
const ID_RE = /^[\w-]{1,40}$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const csvSafe = (v) => {
  if (typeof v === 'number') return String(v);
  let s = String(v ?? '');
  // Los textos que empiezan por =, +, - o @ se neutralizan para evitar inyección de fórmulas en hojas de cálculo.
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Líneas CSV agrupadas en bloques de ~64 KB: menos trozos que mandar y menos pausas que esperar.
function* csvLines(columns, rows, chunkSize = 65536) {
  let chunk = `${columns.join(',')}\n`;
  for (const row of rows) {
    chunk += `${columns.map((c) => csvSafe(row[c])).join(',')}\n`;
    if (chunk.length >= chunkSize) {
      yield chunk;
      chunk = '';
    }
  }
  if (chunk) yield chunk;
}

const CSV_EXPORTS = {
  '/api/traffic.csv': { kind: 'traffic', columns: TRAFFIC_COLUMNS, filename: 'trafico' },
  '/api/parking.csv': { kind: 'parking', columns: PARKING_COLUMNS, filename: 'ocupacion-parkings' },
  '/api/pedestrians.csv': { kind: 'pedestrians', columns: PEDESTRIAN_COLUMNS, filename: 'peatones' },
  '/api/buses.csv': { kind: 'buses', columns: BUS_COLUMNS, filename: 'autobuses' },
  '/api/bikes.csv': { kind: 'bikes', columns: BIKE_COLUMNS, filename: 'bicicletas' },
  '/api/city.csv': { kind: 'city', columns: CITY_COLUMNS, filename: 'ciudad' },
};

const digest = (s) => createHash('sha256').update(s).digest();

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Cuerpo demasiado grande');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON no válido');
  }
}

const finite = (v, name) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new HttpError(400, `${name} debe ser un número`);
  return v;
};

// Punto del mapa pedido como x/z (metros desde el origen) o como lat/lon; `get(nombre)` lee la consulta o el cuerpo.
function pointOf(get) {
  const num = (name) => {
    const raw = get(name);
    if (raw === null || raw === undefined || raw === '') return undefined;
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(value)) throw new HttpError(400, `${name} debe ser un número`);
    return value;
  };
  const [x, z, lat, lon] = ['x', 'z', 'lat', 'lon'].map(num);
  if (x !== undefined && z !== undefined) return { x, z };
  if (lat !== undefined && lon !== undefined) return latLonToXZ(lat, lon);
  throw new HttpError(400, 'Indica el punto con x y z (metros) o con lat y lon');
}

const radiusOf = (raw, fallback, max) => {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1 || value > max) throw new HttpError(400, `radius debe estar entre 1 y ${max} metros`);
  return value;
};

const round1 = (v) => Math.round(v * 10) / 10;
const LIGHT = ['green', 'yellow', 'red', 'uncontrolled']; // uncontrolled: apagado o ámbar intermitente (cruce sin regular)
const SIGNAL_KEYS = ['mode', 'green', 'greenA', 'greenB', 'yellow', 'schedule'];

// Estado de un semáforo: ciclo actual por eje (ew = este-oeste, ns = norte-sur), tiempos efectivos y ajustes propios.
function signalJson(engine, s, index) {
  const { gA, gB, y } = engine.signals.timing(s, engine.simTime);
  return {
    id: s.id, x: round1(s.x), z: round1(s.z), active: s.active, mode: engine.signals.modeOf(s),
    state: { ew: LIGHT[engine.signals.states[index * 2]], ns: LIGHT[engine.signals.states[index * 2 + 1]] },
    timing: { greenEw: gA, greenNs: gB, yellow: y, cycle: gA + gB + 2 * y },
    override: engine.signals.plan.signals[s.id] ?? null,
    ...(s.active ? detectorJson(engine.sim.detectorCounts(index)) : {}),
  };
}

// Detector del semáforo por eje: coches que llegan (a menos de CONFIG.signals.detectorRange m) y cuántos esperan parados.
function detectorJson([[ewCars, ewStopped], [nsCars, nsStopped]]) {
  return { approaching: { ew: ewCars, ns: nsCars }, queue: { ew: ewStopped, ns: nsStopped } };
}

// Valida los campos de un semáforo (o del plan por defecto).
function checkSignalSettings(settings, where) {
  // null quita el campo (solo en PATCH), así que no se valida.
  const range = (key, lo, hi) => {
    if (settings[key] === undefined || settings[key] === null) return;
    if (typeof settings[key] !== 'number' || !(settings[key] >= lo && settings[key] <= hi)) throw new HttpError(400, `${where}${key} debe ser un número entre ${lo} y ${hi}`);
  };
  if (settings.mode !== undefined && settings.mode !== null && !SIGNAL_MODES.includes(settings.mode)) throw new HttpError(400, `${where}mode debe ser uno de: ${SIGNAL_MODES.join(', ')}`);
  range('green', 5, 180);
  range('greenA', 5, 180);
  range('greenB', 5, 180);
  range('yellow', ...CONFIG.signals.yellowRange);
  const { schedule } = settings;
  if (schedule !== undefined && schedule !== null && (!Array.isArray(schedule) || schedule.length > 20 || !schedule.every((r) => r && typeof r === 'object' && !Array.isArray(r)))) {
    throw new HttpError(400, `${where}schedule debe ser una lista de hasta 20 reglas`);
  }
}

function exportFilters(url) {
  const filters = {};
  for (const key of ['from', 'to']) {
    const value = url.searchParams.get(key);
    if (value === null) continue;
    if (!TIME_RE.test(value)) throw new HttpError(400, `${key} debe ser una fecha ISO (AAAA-MM-DD[THH:MM[:SS]])`);
    filters[key] = value;
  }
  const id = url.searchParams.get('id');
  if (id !== null) {
    if (!ID_RE.test(id)) throw new HttpError(400, 'id no válido');
    filters.id = id;
  }
  return filters;
}

const MAX_EVENT_RANGE = 366 * 86400;
const iso = (seconds) => simDate(seconds).toISOString().slice(0, 19);

// La asistencia y la demanda extra solo se publican cuando el evento ha terminado: antes hay que predecirlas.
// Autobuses que van de camino desde la cochera a una línea.
function pendingJson(engine, li) {
  return engine.buses.pendingOf(li).map((p) => ({ count: p.count, readyAt: iso(p.at) }));
}

// Una línea en GET /api/buses y PATCH /api/buses/<línea>.
function busLineJson(engine, i) {
  const l = engine.transit.lines[i];
  const { active, passengers, full, waiting, leftBehind } = engine.buses.stats[i];
  return {
    id: l.id, stops: l.stops.length, fleet: l.buses, target: engine.buses.committed(i), pending: pendingJson(engine, i),
    minFleet: CONFIG.transit.minFleet, maxFleet: CONFIG.transit.maxFleet, capacity: CONFIG.transit.capacity,
    suspended: engine.buses.suspended[i], tracked: engine.busTracker.isTracked(l.id),
    active, passengers, full, waiting, leftBehind,
  };
}

// Horas de autobús en servicio hoy frente a las incluidas (las que haría la flota inicial): las de más son sobrecoste.
function busDayJson(engine) {
  const { used, included } = engine.busDay;
  const r = (x) => Math.round(x * 10) / 10;
  return { busHours: r(used), includedHours: r(included), overtimeHours: r(Math.max(0, used - included)) };
}

function eventJson(event, simSeconds) {
  const venue = eventCalendar.venues[event.venue];
  const over = event.end <= simSeconds;
  return {
    id: event.id, type: event.type, name: event.name, series: event.series,
    venue: event.venue, venueName: venue.name, x: Math.round(event.x), z: Math.round(event.z),
    start: iso(event.start), end: iso(event.end),
    attendance: over ? event.attendance : null,
    extraDemand: over ? Math.round(event.boost * 1000) / 1000 : null,
  };
}

export const EVENT_COLUMNS = ['id', 'type', 'name', 'series', 'venue', 'venue_name', 'x', 'z', 'start', 'end', 'duration_h', 'status', 'attendance', 'extra_demand'];

// Fila del CSV de eventos: `attendance` y `extra_demand` van vacíos hasta que el evento termina.
function eventRow(event, simSeconds) {
  const json = eventJson(event, simSeconds);
  return {
    id: json.id, type: json.type, name: json.name, series: json.series ?? '', venue: json.venue, venue_name: json.venueName,
    x: json.x, z: json.z, start: json.start, end: json.end,
    duration_h: Math.round(((event.end - event.start) / 3600) * 100) / 100,
    status: event.end <= simSeconds ? 'finished' : event.start <= simSeconds ? 'in_progress' : 'upcoming',
    attendance: json.attendance ?? '', extra_demand: json.extraDemand ?? '',
  };
}

// Eventos que pide la URL (`from`, `to`, `type`): por defecto, los próximos 30 días simulados.
function requestedEvents(url, simSeconds) {
  const params = {};
  for (const key of ['from', 'to']) {
    const value = url.searchParams.get(key);
    if (value === null) continue;
    if (!TIME_RE.test(value) || !Number.isFinite(simSecondsOf(value))) throw new HttpError(400, `${key} debe ser una fecha ISO (AAAA-MM-DD[THH:MM[:SS]])`);
    params[key] = simSecondsOf(value);
  }
  const from = params.from ?? simSeconds;
  const to = params.to ?? from + 30 * 86400;
  if (to - from > MAX_EVENT_RANGE) throw new HttpError(400, 'El intervalo no puede superar 366 días');
  const type = url.searchParams.get('type');
  if (type !== null && !Object.hasOwn(eventCalendar.types, type)) throw new HttpError(400, `type debe ser uno de: ${Object.keys(eventCalendar.types).join(', ')}`);
  return eventCalendar.eventsBetween(from, to).filter((e) => type === null || e.type === type);
}

const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;

// Tiempo observado en `seconds` (nunca el del futuro: de eso solo hay previsión).
function observation(seconds) {
  const w = weather.at(seconds);
  return { time: iso(seconds), temperature_c: round(w.temperature, 1), rain_mm_h: round(w.rain, 2), cloud_pct: Math.round(w.cloud * 100), condition: w.condition };
}

function forecastEntry(f) {
  return {
    time: iso(f.time), lead_h: Math.round(f.lead), temperature_c: round(f.temperature, 1),
    rain_probability: round(f.rainProbability, 2), rain_mm_h: round(f.rain, 2), cloud_pct: Math.round(f.cloud * 100), condition: f.condition,
  };
}

export const WEATHER_COLUMNS = ['time', 'temperature_c', 'rain_mm_h', 'cloud_pct', 'condition'];
const HOUR = 3600;

// Filas horarias del tiempo observado entre `from` y `to` (por defecto, los últimos 7 días simulados); las horas
// que aún no han llegado no se incluyen.
function* observedRows(url, simSeconds) {
  const bound = (key) => {
    const value = url.searchParams.get(key);
    if (value === null) return null;
    if (!TIME_RE.test(value) || !Number.isFinite(simSecondsOf(value))) throw new HttpError(400, `${key} debe ser una fecha ISO (AAAA-MM-DD[THH:MM[:SS]])`);
    return simSecondsOf(value);
  };
  const to = Math.min(bound('to') ?? Infinity, simSeconds + 1);
  const from = bound('from') ?? Math.max(0, to - 7 * 86400);
  if (to - from > MAX_EVENT_RANGE) throw new HttpError(400, 'El intervalo no puede superar 366 días');
  for (let t = Math.ceil(from / HOUR) * HOUR; t < to; t += HOUR) yield observation(t);
}

// Segundos simulados de un parámetro `from` / `to` ya validado con TIME_RE.
function simSecondsOf(value) {
  const full = value.length === 10 ? `${value}T00:00:00Z` : value.length === 16 ? `${value}:00Z` : `${value}Z`;
  return (Date.parse(full) - CONFIG.sim.baseDate) / 1000;
}

const DOCS_FILE = new URL('../docs/API.md', import.meta.url);

// Listener HTTP de la API. Las lecturas son públicas; las escrituras exigen `Authorization: Bearer <token>`.
export function createApp({ runtime, store, token = '', corsOrigin = '*', docsFile = DOCS_FILE }) {
  const tokenHash = token ? digest(token) : null;

  const authorize = (req) => {
    if (!tokenHash) return;
    const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    if (!match || !timingSafeEqual(digest(match[1]), tokenHash)) throw new HttpError(401, 'Token no válido');
  };

  const state = () => {
    const { engine } = runtime;
    const traffic = engine.sim.stats();
    return {
      ...runtime.status(),
      graphKey: engine.graphKey,
      params: engine.params,
      seed: CONFIG.sim.seed, // semilla de esta ciudad (SCENARIO_SEED): tráfico, tiempo, eventos y variación de la demanda
      startSeconds: runtime.anchor.simSeconds, // segundo simulado en que empezó esta ciudad
      writeProtected: Boolean(tokenHash), // los cambios necesitan token
      restrictions: engine.restrictions.items.map((r) => engine.restrictions.describe(r)),
      traffic: { stopped: traffic.stopped, avgKmh: Math.round(traffic.avgKmh * 10) / 10 },
      signalPlan: engine.signals.plan,
      sensors: engine.sensors.sensors.map((s) => ({
        id: s.id, name: s.name, x: Math.round(s.x * 10) / 10, z: Math.round(s.z * 10) / 10,
        total: s.total, current: engine.sensors.currentCount(s),
      })),
      parkings: [...engine.parking.lots.values()].map((l) => ({
        id: l.id, name: l.name, capacity: l.capacity, tracked: engine.parking.isTracked(l.id),
        occupancy: Math.round(engine.parking.occupancyOf(l, engine.simTime) * 1000) / 1000,
      })),
      weather: CONFIG.weather.enabled ? observation(engine.simTime) : null,
      holiday: CONFIG.holidays.enabled ? holidayCalendar.holidayAt(engine.simTime) : null,
      events: {
        boost: CONFIG.events.enabled ? Math.round(eventCalendar.boostAt(engine.simTime) * 1000) / 1000 : 0,
        active: (CONFIG.events.enabled ? eventCalendar.activeAt(engine.simTime) : []).map(({ event, intensity }) => ({
          ...eventJson(event, engine.simTime), intensity: Math.round(intensity * 100) / 100,
        })),
      },
      pedestrians: { expected: Math.round(engine.pedestrians.flowAt(engine.simTime, engine.params.scenario, engine.params.maxPedestrians).onStreet) },
      pedestrianSensors: engine.pedSensors.sensors.map((s) => ({
        id: s.id, name: s.name, x: Math.round(s.x * 10) / 10, z: Math.round(s.z * 10) / 10,
        total: s.total, current: Math.round(engine.pedSensors.presentNow(s, engine.simTime)),
      })),
      buses: {
        fleetTotal: engine.buses.fleetTotal,
        reserve: engine.buses.reserve(),
        extraDemand: Math.round(engine.buses.extraDemand * 1000) / 1000,
        today: busDayJson(engine),
        lines: engine.transit.lines.map((l, i) => ({
          id: l.id, color: l.color, stops: l.stops.length, fleet: l.buses, minFleet: CONFIG.transit.minFleet, maxFleet: CONFIG.transit.maxFleet,
          pending: pendingJson(engine, i), suspended: engine.buses.suspended[i], tracked: engine.busTracker.isTracked(l.id),
        })),
      },
      bikes: engine.bikes.state(),
      records: { traffic: store.count('traffic'), parking: store.count('parking'), pedestrians: store.count('pedestrians'), buses: store.count('buses'), bikes: store.count('bikes'), city: store.count('city') },
    };
  };

  async function route(req, res, url) {
    const { pathname } = url;
    const method = req.method;
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (method === 'GET' && pathname === '/api/health') return send(200, { ok: true });

    // Guía de la API (docs/API.md): como página web y como Markdown.
    if (method === 'GET' && (pathname === '/api/docs' || pathname === '/api/docs.md')) {
      let markdown;
      try {
        markdown = readFileSync(docsFile, 'utf8');
      } catch {
        throw new HttpError(404, 'La documentación no está disponible en este servidor');
      }
      const page = pathname === '/api/docs';
      res.writeHead(200, {
        'Content-Type': page ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(page ? renderDocsPage(markdown) : markdown);
      return undefined;
    }
    if (method === 'GET' && pathname === '/api/state') return send(200, state());
    if (method === 'GET' && pathname === '/api/cars') {
      const { engine } = runtime;
      return send(200, { graphKey: engine.graphKey, simSeconds: engine.simTime, ...engine.sim.positions() });
    }

    if (method === 'GET' && pathname === '/api/pedestrians') {
      const { engine } = runtime;
      return send(200, { graphKey: engine.graphKey, simSeconds: engine.simTime, ...engine.pedestrianPositions(runtime.scale) });
    }

    // Estado actual de las líneas de autobús (autobuses en servicio, pasajeros, llenos, gente esperando).
    if (method === 'GET' && pathname === '/api/buses') {
      const { engine } = runtime;
      engine.buses.updateAt(engine.simTime, engine.params.scenario, runtime.scale);
      return send(200, {
        graphKey: engine.graphKey,
        simSeconds: engine.simTime,
        fleetTotal: engine.buses.fleetTotal,
        reserve: engine.buses.reserve(),
        deployMinutes: CONFIG.transit.deployMinutes,
        today: busDayJson(engine),
        lines: engine.transit.lines.map((l, i) => busLineJson(engine, i)),
      });
    }

    // Recorrido de una línea: sus paradas en orden (ida y vuelta), con coordenadas.
    const routeMatch = /^\/api\/buses\/(L\d{1,3})$/.exec(pathname);
    if (routeMatch && method === 'GET') {
      const { engine } = runtime;
      const index = engine.transit.lines.findIndex((l) => l.id === routeMatch[1]);
      if (index < 0) throw new HttpError(404, 'Línea no encontrada');
      engine.buses.updateAt(engine.simTime, engine.params.scenario, runtime.scale);
      const line = engine.transit.lines[index];
      return send(200, {
        ...busLineJson(engine, index),
        stops: line.stops.map((s, j) => ({ index: j, x: Math.round(s.x), z: Math.round(s.z), turnaround: !!s.turnaround })),
      });
    }

    // Calendario de eventos entre dos fechas (por defecto, los próximos 30 días simulados).
    if (method === 'GET' && pathname === '/api/events') {
      const { simTime } = runtime.engine;
      return send(200, { simSeconds: simTime, events: requestedEvents(url, simTime).map((e) => eventJson(e, simTime)) });
    }

    if (method === 'GET' && pathname === '/api/events.csv') {
      const { simTime } = runtime.engine;
      const rows = requestedEvents(url, simTime).map((e) => eventRow(e, simTime));
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="eventos.csv"',
      });
      await pipeline(Readable.from(csvLines(EVENT_COLUMNS, rows)), res);
      return undefined;
    }

    // Festivos entre dos fechas (por defecto, del día simulado actual a un año después).
    if (method === 'GET' && pathname === '/api/holidays') {
      const { simTime } = runtime.engine;
      const bound = (key) => {
        const value = url.searchParams.get(key);
        if (value === null) return null;
        if (!TIME_RE.test(value) || !Number.isFinite(simSecondsOf(value))) throw new HttpError(400, `${key} debe ser una fecha ISO (AAAA-MM-DD[THH:MM[:SS]])`);
        return simSecondsOf(value);
      };
      const from = bound('from') ?? simTime;
      const to = bound('to') ?? from + 365 * 86400;
      if (to - from > 3 * MAX_EVENT_RANGE) throw new HttpError(400, 'El intervalo no puede superar 3 años');
      const list = CONFIG.holidays.enabled && to > from ? holidayCalendar.holidaysBetween(from, to) : [];
      return send(200, { simSeconds: simTime, holidays: list.map(({ date, name }) => ({ date, name })) });
    }

    // Tiempo ahora y previsión horaria a 48 h (el tiempo futuro real no se publica).
    if (method === 'GET' && pathname === '/api/weather') {
      if (!CONFIG.weather.enabled) throw new HttpError(404, 'El tiempo está desactivado');
      const { simTime } = runtime.engine;
      const hours = url.searchParams.get('hours');
      const limit = hours === null ? CONFIG.weather.forecast.hours : Number(hours);
      if (!Number.isInteger(limit) || limit < 1 || limit > CONFIG.weather.forecast.hours) throw new HttpError(400, `hours debe ser un entero de 1 a ${CONFIG.weather.forecast.hours}`);
      return send(200, {
        simSeconds: simTime, current: observation(simTime),
        conditions: Object.fromEntries(Object.entries(CONDITIONS).map(([id, c]) => [id, c.label])),
        forecast: weather.forecast(simTime, limit).map(forecastEntry),
      });
    }

    // Tiempo observado hora a hora (para entrenar modelos).
    if (method === 'GET' && pathname === '/api/weather.csv') {
      if (!CONFIG.weather.enabled) throw new HttpError(404, 'El tiempo está desactivado');
      const rows = [...observedRows(url, runtime.engine.simTime)];
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="tiempo.csv"',
      });
      await pipeline(Readable.from(csvLines(WEATHER_COLUMNS, rows)), res);
      return undefined;
    }

    if (method === 'GET' && CSV_EXPORTS[pathname]) {
      const { kind, columns, filename } = CSV_EXPORTS[pathname];
      const rows = store.iterate(kind, exportFilters(url));
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}.csv"`,
      });
      await pipeline(Readable.from(csvLines(columns, rows)), res);
      return undefined;
    }

    if (method === 'POST' && pathname === '/api/sensors') {
      authorize(req);
      const body = await readJson(req);
      const { x, z } = pointOf((key) => body[key]);
      const name = typeof body.name === 'string' ? body.name.slice(0, 60) : '';
      const sensor = runtime.mutate((e) => e.sensors.add(x, z, name));
      if (!sensor) throw new HttpError(422, 'No hay ninguna calle cerca de esa posición');
      return send(201, { id: sensor.id, name: sensor.name, x: sensor.x, z: sensor.z });
    }

    if (method === 'POST' && pathname === '/api/pedestrian-sensors') {
      authorize(req);
      const body = await readJson(req);
      const { x, z } = pointOf((key) => body[key]);
      const name = typeof body.name === 'string' ? body.name.slice(0, 60) : '';
      const sensor = runtime.mutate((e) => e.pedSensors.add(x, z, name));
      if (!sensor) throw new HttpError(422, 'No hay ninguna calle cerca de esa posición');
      return send(201, { id: sensor.id, name: sensor.name, x: sensor.x, z: sensor.z });
    }

    const pedestrianSensorMatch = /^\/api\/pedestrian-sensors\/([\w-]{1,40})$/.exec(pathname);
    if (pedestrianSensorMatch && (method === 'DELETE' || method === 'PATCH')) {
      authorize(req);
      const id = pedestrianSensorMatch[1];
      if (!runtime.engine.pedSensors.sensors.some((s) => s.id === id)) throw new HttpError(404, 'Sensor no encontrado');
      if (method === 'DELETE') {
        runtime.mutate((e) => e.pedSensors.remove(id));
        return send(200, { ok: true });
      }
      const body = await readJson(req);
      if (typeof body.name !== 'string') throw new HttpError(400, 'name debe ser texto');
      runtime.mutate((e) => e.pedSensors.rename(id, body.name));
      return send(200, { ok: true });
    }

    const sensorMatch = /^\/api\/sensors\/([\w-]{1,40})$/.exec(pathname);
    if (sensorMatch && (method === 'DELETE' || method === 'PATCH')) {
      authorize(req);
      const id = sensorMatch[1];
      if (!runtime.engine.sensors.sensors.some((s) => s.id === id)) throw new HttpError(404, 'Sensor no encontrado');
      if (method === 'DELETE') {
        runtime.mutate((e) => e.sensors.remove(id));
        return send(200, { ok: true });
      }
      const body = await readJson(req);
      if (typeof body.name !== 'string') throw new HttpError(400, 'name debe ser texto');
      runtime.mutate((e) => e.sensors.rename(id, body.name));
      return send(200, { ok: true });
    }

    if (method === 'PUT' && pathname === '/api/parking/tracked') {
      authorize(req);
      const { ids } = await readJson(req);
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) throw new HttpError(400, 'ids debe ser una lista de textos');
      runtime.mutate((e) => {
        e.parking.setAll(false);
        for (const id of ids) e.parking.setTracked(id, true);
      });
      return send(200, { tracked: [...runtime.engine.parking.tracked] });
    }

    // Estado actual de las estaciones de bicicletas compartidas (bicicletas disponibles y en circulación).
    if (method === 'GET' && pathname === '/api/bikes') return send(200, runtime.engine.bikes.state());

    // Cambia los anclajes de varios puestos: { changes: { "<id>": 20, "<id>": null } } (null cancela el cambio pendiente).
    // El cambio tarda `capacityDelaySeconds` (30 días simulados) en hacer efecto.
    if (method === 'PUT' && pathname === '/api/bikes/capacity') {
      authorize(req);
      const { changes } = await readJson(req);
      if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length) {
        throw new HttpError(400, 'changes debe ser un objeto { id: anclajes }');
      }
      const bikes = runtime.engine.bikes;
      const known = new Set(bikes.state().stations.map((s) => s.id));
      const unknown = Object.keys(changes).find((id) => !known.has(id));
      if (unknown) throw new HttpError(400, `Estación desconocida: ${unknown}`);
      try {
        runtime.mutate((e) => {
          // Se valida todo antes de aplicar nada: o entran todos los cambios o ninguno.
          const probe = Object.entries(changes);
          for (const [, capacity] of probe) {
            if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > CONFIG.bicycles.maxCapacity)) {
              throw new Error(`La capacidad debe ser un entero entre 1 y ${CONFIG.bicycles.maxCapacity}`);
            }
          }
          for (const [id, capacity] of probe) e.bikes.scheduleCapacity(id, capacity, e.simTime);
        });
      } catch (err) {
        throw new HttpError(400, err.message);
      }
      return send(200, runtime.engine.bikes.state());
    }

    if (method === 'PUT' && pathname === '/api/bikes/tracked') {
      authorize(req);
      const { ids } = await readJson(req);
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) throw new HttpError(400, 'ids debe ser una lista de textos');
      runtime.mutate((e) => {
        e.bikes.setAll(false);
        for (const id of ids) e.bikes.setTracked(id, true);
      });
      return send(200, { tracked: [...runtime.engine.bikes.tracked] });
    }

    if (method === 'PUT' && pathname === '/api/buses/tracked') {
      authorize(req);
      const { ids } = await readJson(req);
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) throw new HttpError(400, 'ids debe ser una lista de textos');
      runtime.mutate((e) => {
        e.busTracker.setAll(false);
        for (const id of ids) e.busTracker.setTracked(id, true);
      });
      return send(200, { tracked: [...runtime.engine.busTracker.tracked] });
    }

    if (method === 'PUT' && pathname === '/api/params') {
      // La demanda forma parte del escenario, no de la gestión: la fija el servidor (MAX_CARS, MAX_PEDESTRIANS) y varía
      // un poco cada día y cada hora.
      throw new HttpError(403, 'La demanda la fija el servidor y varía un poco cada día: no se puede cambiar');
    }

    if (method === 'PUT' && pathname === '/api/signals/plan') {
      authorize(req);
      const { plan } = await readJson(req);
      if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new HttpError(400, 'plan debe ser un objeto');
      if (plan.default && typeof plan.default === 'object') checkSignalSettings(plan.default, 'plan.default.');
      for (const [id, settings] of Object.entries(plan.signals ?? {})) {
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new HttpError(400, `plan.signals.${id} debe ser un objeto`);
        checkSignalSettings(settings, `plan.signals.${id}.`);
      }
      runtime.mutate((e) => e.signals.setPlan(plan));
      return send(200, runtime.engine.signals.plan);
    }

    // Semáforos con ciclo (por defecto solo los que regulan el tráfico; `all=1` incluye los pasos de peatones).
    // Filtro opcional por zona: x, z (o lat, lon) y radius.
    if (method === 'GET' && pathname === '/api/signals') {
      const { engine } = runtime;
      const all = url.searchParams.get('all') === '1';
      const near = url.searchParams.has('radius') ? { ...pointOf((k) => url.searchParams.get(k)), radius: radiusOf(url.searchParams.get('radius'), 100, 5000) } : null;
      const signals = [];
      engine.signals.signals.forEach((s, i) => {
        if (!all && !s.active) return;
        if (near && Math.hypot(s.x - near.x, s.z - near.z) > near.radius) return;
        signals.push(signalJson(engine, s, i));
      });
      return send(200, { simSeconds: engine.simTime, modes: SIGNAL_MODES, signals });
    }

    const signalMatch = /^\/api\/signals\/(\d{1,15})$/.exec(pathname);
    if (signalMatch && (method === 'GET' || method === 'PATCH')) {
      const { engine } = runtime;
      const id = Number(signalMatch[1]);
      const s = engine.signals.byId.get(id);
      if (!s) throw new HttpError(404, 'Semáforo no encontrado');
      if (method === 'PATCH') {
        authorize(req);
        const body = await readJson(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'El cuerpo debe ser un objeto');
        const unknown = Object.keys(body).find((k) => k !== 'reset' && !SIGNAL_KEYS.includes(k));
        if (unknown) throw new HttpError(400, `Campo desconocido: ${unknown}`);
        checkSignalSettings(body, '');
        // `reset: true` borra los ajustes; un campo a null los quita uno a uno; el resto se suma a los ajustes actuales.
        const settings = body.reset === true ? {} : { ...(engine.signals.plan.signals[id] ?? {}) };
        for (const key of SIGNAL_KEYS) {
          if (body[key] === null) delete settings[key];
          else if (body[key] !== undefined) settings[key] = body[key];
        }
        runtime.mutate((e) => e.signals.setSignalOverride(id, settings));
        engine.signals.update(engine.simTime);
      }
      return send(200, signalJson(engine, s, engine.signals.signals.indexOf(s)));
    }

    // Qué hay ahora mismo cerca de un punto: coches, peatones, autobuses y semáforos.
    if (method === 'GET' && pathname === '/api/point') {
      const { engine } = runtime;
      const { x, z } = pointOf((k) => url.searchParams.get(k));
      const radius = radiusOf(url.searchParams.get('radius'), 50, 2000);
      const signals = [];
      engine.signals.signals.forEach((s, i) => {
        if (s.active && Math.hypot(s.x - x, s.z - z) <= radius && signals.length < 20) signals.push(signalJson(engine, s, i));
      });
      return send(200, {
        simSeconds: engine.simTime, time: iso(engine.simTime), point: { x: round1(x), z: round1(z) }, radius,
        ...engine.pointStats(x, z, radius, runtime.scale), signals,
      });
    }

    // Calles cercanas a un punto (para elegir cuál cortar): su identificador, clase, longitud, extremos y coches.
    if (method === 'GET' && pathname === '/api/roads') {
      const { engine } = runtime;
      const { x, z } = pointOf((k) => url.searchParams.get(k));
      const radius = radiusOf(url.searchParams.get('radius'), 100, MAX_RADIUS);
      const limit = Number(url.searchParams.get('limit') ?? 20);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, 'limit debe ser un entero de 1 a 100');
      const roads = roadsNear(engine.graph, x, z, radius).slice(0, limit).map(({ way, distance }) => ({ ...describeWay(engine.graph, way, engine.sim), distance }));
      return send(200, { point: { x: round1(x), z: round1(z) }, radius, roads });
    }

    const roadMatch = /^\/api\/roads\/(\d{1,7})$/.exec(pathname);
    if (method === 'GET' && roadMatch) {
      const { engine } = runtime;
      const road = describeWay(engine.graph, Number(roadMatch[1]), engine.sim);
      if (!road) throw new HttpError(404, 'Calle no encontrada');
      return send(200, road);
    }

    // Cortes de calle y zonas de acceso restringido.
    if (method === 'GET' && pathname === '/api/restrictions') {
      const { engine } = runtime;
      return send(200, { simSeconds: engine.simTime, modes: RESTRICTION_MODES, restrictions: engine.restrictions.items.map((r) => engine.restrictions.describe(r)) });
    }

    if (method === 'POST' && pathname === '/api/restrictions') {
      authorize(req);
      const { engine } = runtime;
      const body = await readJson(req);
      const definition = { mode: body.mode, name: body.name, limit: body.limit };
      if (body.ways !== undefined) {
        definition.ways = body.ways;
      } else {
        definition.area = { ...pointOf((k) => body[k]), radius: body.radius };
      }
      try {
        const item = runtime.mutate((e) => e.restrictions.add(definition));
        return send(201, engine.restrictions.describe(item));
      } catch (err) {
        if (err instanceof RestrictionError) throw new HttpError(400, err.message);
        throw err;
      }
    }

    const restrictionMatch = /^\/api\/restrictions\/(R\d{1,6})$/.exec(pathname);
    if (restrictionMatch && ['GET', 'PATCH', 'DELETE'].includes(method)) {
      const { engine } = runtime;
      const id = restrictionMatch[1];
      const item = engine.restrictions.get(id);
      if (!item) throw new HttpError(404, 'Restricción no encontrada');
      if (method === 'DELETE') {
        authorize(req);
        runtime.mutate((e) => e.restrictions.remove(id));
        return send(200, { ok: true });
      }
      if (method === 'PATCH') {
        authorize(req);
        const body = await readJson(req);
        try {
          runtime.mutate((e) => e.restrictions.update(id, { mode: body.mode, limit: body.limit, name: body.name }));
        } catch (err) {
          if (err instanceof RestrictionError) throw new HttpError(400, err.message);
          throw err;
        }
      }
      return send(200, engine.restrictions.describe(item));
    }

    // Número de autobuses de una línea: { fleet: 12 }. Quitar es inmediato; los que se añaden salen de la cochera y
    // entran en servicio `deployMinutes` después (en `pending`). Se conserva tras un reinicio.
    const busMatch = /^\/api\/buses\/(L\d{1,3})$/.exec(pathname);
    if (busMatch && method === 'PATCH') {
      authorize(req);
      const { engine } = runtime;
      const id = busMatch[1];
      const index = engine.transit.lines.findIndex((l) => l.id === id);
      if (index < 0) throw new HttpError(404, 'Línea no encontrada');
      const { fleet } = await readJson(req);
      if (!Number.isInteger(fleet) || fleet < CONFIG.transit.minFleet || fleet > CONFIG.transit.maxFleet) {
        throw new HttpError(400, `fleet debe ser un entero entre ${CONFIG.transit.minFleet} y ${CONFIG.transit.maxFleet}`);
      }
      if (fleet - engine.buses.committed(index) > engine.buses.reserve()) {
        throw new HttpError(409, `No hay autobuses suficientes: quedan ${engine.buses.reserve()} en reserva (flota total ${engine.buses.fleetTotal}). Quita autobuses de otra línea primero`);
      }
      runtime.mutate((e) => e.setBusFleet(id, fleet));
      engine.buses.updateAt(engine.simTime, engine.params.scenario, runtime.scale);
      return send(200, { ...busLineJson(engine, index), reserve: engine.buses.reserve(), fleetTotal: engine.buses.fleetTotal });
    }

    throw new HttpError(404, 'No encontrado');
  }

  return async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    try {
      await route(req, res, new URL(req.url, 'http://localhost'));
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: status === 500 ? 'Error interno' : err.message }));
    }
  };
}
