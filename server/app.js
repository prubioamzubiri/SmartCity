import { createHash, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PARKING_COLUMNS, PEDESTRIAN_COLUMNS, TRAFFIC_COLUMNS } from './store.js';

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

function* csvLines(columns, rows) {
  yield `${columns.join(',')}\n`;
  for (const row of rows) yield `${columns.map((c) => csvSafe(row[c])).join(',')}\n`;
}

const CSV_EXPORTS = {
  '/api/traffic.csv': { kind: 'traffic', columns: TRAFFIC_COLUMNS, filename: 'trafico' },
  '/api/parking.csv': { kind: 'parking', columns: PARKING_COLUMNS, filename: 'ocupacion-parkings' },
  '/api/pedestrians.csv': { kind: 'pedestrians', columns: PEDESTRIAN_COLUMNS, filename: 'peatones' },
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

// Listener HTTP de la API. Las lecturas son públicas; las escrituras exigen `Authorization: Bearer <token>`.
export function createApp({ runtime, store, token = '', corsOrigin = '*' }) {
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
      pedestrians: { expected: Math.round(engine.pedestrians.flowAt(engine.simTime, engine.params.scenario, engine.params.maxPedestrians).onStreet) },
      pedestrianSensors: engine.pedSensors.sensors.map((s) => ({
        id: s.id, name: s.name, x: Math.round(s.x * 10) / 10, z: Math.round(s.z * 10) / 10,
        total: s.total, current: Math.round(engine.pedSensors.presentNow(s, engine.simTime)),
      })),
      records: { traffic: store.count('traffic'), parking: store.count('parking'), pedestrians: store.count('pedestrians') },
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
    if (method === 'GET' && pathname === '/api/state') return send(200, state());
    if (method === 'GET' && pathname === '/api/cars') {
      const { engine } = runtime;
      return send(200, { graphKey: engine.graphKey, simSeconds: engine.simTime, ...engine.sim.positions() });
    }

    if (method === 'GET' && pathname === '/api/pedestrians') {
      const { engine } = runtime;
      return send(200, { graphKey: engine.graphKey, simSeconds: engine.simTime, ...engine.pedestrianPositions(runtime.scale) });
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
      const x = finite(body.x, 'x');
      const z = finite(body.z, 'z');
      const name = typeof body.name === 'string' ? body.name.slice(0, 60) : '';
      const sensor = runtime.mutate((e) => e.sensors.add(x, z, name));
      if (!sensor) throw new HttpError(422, 'No hay ninguna calle cerca de esa posición');
      return send(201, { id: sensor.id, name: sensor.name, x: sensor.x, z: sensor.z });
    }

    if (method === 'POST' && pathname === '/api/pedestrian-sensors') {
      authorize(req);
      const body = await readJson(req);
      const x = finite(body.x, 'x');
      const z = finite(body.z, 'z');
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

    if (method === 'PUT' && pathname === '/api/params') {
      authorize(req);
      const body = await readJson(req);
      const patch = {};
      if (body.maxCars !== undefined) patch.maxCars = finite(body.maxCars, 'maxCars');
      if (body.maxPedestrians !== undefined) patch.maxPedestrians = finite(body.maxPedestrians, 'maxPedestrians');
      if (body.scenario !== undefined) patch.scenario = body.scenario;
      try {
        runtime.mutate((e) => e.setParams(patch));
      } catch (err) {
        throw new HttpError(400, err.message);
      }
      return send(200, runtime.engine.params);
    }

    if (method === 'PUT' && pathname === '/api/signals/plan') {
      authorize(req);
      const { plan } = await readJson(req);
      if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new HttpError(400, 'plan debe ser un objeto');
      runtime.mutate((e) => e.signals.setPlan(plan));
      return send(200, runtime.engine.signals.plan);
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
