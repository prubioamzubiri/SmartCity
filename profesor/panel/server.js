import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Collector } from './collector.js';
import { BUCKET_SECONDS, INDICATORS, METRIC, scoreWindow } from './metric.js';

const WINDOWS = { day: 96, week: 7 * 96, all: Infinity }; // en tramos de 15 min simulados
export const REFERENCE = 'referencia';

// "g1=https://a.example.com,g2=https://b.example.com" → [{ name, url }]
export function parseGroups(text = '') {
  return text.split(',').map((s) => s.trim()).filter(Boolean).map((entry) => {
    const at = entry.indexOf('=');
    if (at <= 0) throw new Error(`PANEL_GROUPS mal escrito: "${entry}" (usa nombre=url)`);
    return { name: entry.slice(0, at).trim(), url: entry.slice(at + 1).trim(), kind: 'group' };
  });
}

const mean = (row, key) => (row ? row.sums[key] / row.n : null);
const derived = {
  cars: (r) => mean(r, 'cars'),
  stopped: (r) => mean(r, 'stopped'),
  avgKmh: (r) => (r && r.sums.cars > 0 ? r.sums.speedXcars / r.sums.cars : null),
  busWaiting: (r) => mean(r, 'busWaiting'),
  fullBusPct: (r) => (r && r.sums.busActive > 0 ? (100 * r.sums.busFull) / r.sums.busActive : r ? 0 : null),
  busActive: (r) => mean(r, 'busActive'),
  badStations: (r) => mean(r, 'badStations'),
  saturatedLots: (r) => mean(r, 'saturatedLots'),
  restrictedKm: (r) => mean(r, 'restrictedKm'),
};

export function createPanel({ collector, groups, password, now = Date.now }) {
  const status = (name) => collector.status.get(name);
  const ref = () => status(REFERENCE);

  function windowOf(name, key) {
    const s = status(name);
    if (s?.simSeconds === undefined) return null;
    const end = Math.floor(s.simSeconds / BUCKET_SECONDS); // el tramo en curso aún no está completo
    const size = WINDOWS[key] ?? WINDOWS.day;
    return { from: size === Infinity ? -Infinity : end - size, to: end };
  }

  function alertsOf(group, score) {
    const s = status(group.name);
    const r = ref();
    const out = [];
    if (!s.ok) out.push({ level: 'error', text: `No responde: ${s.error}` });
    if (s.simSeconds === undefined) return out;
    if (r?.scale && s.scale !== r.scale) out.push({ level: 'error', text: `Escala del reloj distinta de la referencia (×${s.scale?.toFixed(2)} frente a ×${r.scale.toFixed(2)})` });
    if (r?.params && JSON.stringify(s.params) !== JSON.stringify(r.params)) out.push({ level: 'error', text: `Parámetros de demanda distintos de la referencia ${JSON.stringify(s.params)}: la comparación no es válida` });
    if (r?.simSeconds !== undefined && s.simSeconds > r.simSeconds + BUCKET_SECONDS) out.push({ level: 'warn', text: 'Va por delante de la referencia: sus últimos tramos no se pueden comparar (arranca la referencia antes que los grupos)' });
    if (s.caughtUp === false) out.push({ level: 'warn', text: 'El simulador va con retraso respecto al reloj (está recuperando tiempo)' });
    if (collector.epochOf(group.name) > 0) out.push({ level: 'warn', text: `La ciudad se ha reiniciado ${collector.epochOf(group.name)} vez/veces: solo cuenta desde el último reinicio` });
    const mem = collector.memory.get(group.name);
    for (const [line, since] of Object.entries(mem?.suspendedSince ?? {})) {
      const h = (s.simSeconds - since) / 3600;
      if (h >= 0.5) out.push({ level: h * 3600 >= METRIC.suspensionSeconds ? 'error' : 'warn', text: `Línea ${line} suspendida desde hace ${h.toFixed(1)} h simuladas` });
    }
    const recent = collector.events(group.name, { fromSim: s.simSeconds - 6 * 3600, toSim: Infinity }).filter((e) => e.kind === 'action' || e.kind === 'params');
    if (!recent.length && s.simSeconds > 6 * 3600 + 25200) out.push({ level: 'warn', text: 'Sin acciones en las últimas 6 h simuladas (¿gestor parado?)' });
    if (score?.reversals >= 3) out.push({ level: 'warn', text: `${score.reversals} marchas atrás en la ventana (deshace cambios en menos de 1 h)` });
    if (s.ok && s.lastOkWall && now() - s.lastOkWall > 60000) out.push({ level: 'error', text: 'Datos con más de 1 min de antigüedad' });
    return out;
  }

  function scoreOf(group, key) {
    const w = windowOf(group.name, key);
    if (!w) return null;
    const events = collector.events(group.name, { fromSim: w.from * BUCKET_SECONDS, toSim: w.to * BUCKET_SECONDS });
    const count = (kind) => events.filter((e) => e.kind === kind).length;
    return scoreWindow(collector.buckets(group.name, w.from, w.to), collector.buckets(REFERENCE, w.from, w.to), {
      reversals: count('reversal'),
      suspensions: count('suspension'),
    });
  }

  function overview(key) {
    const r = ref();
    const refEvents = collector.events(REFERENCE, { limit: 5 }).filter((e) => e.kind !== 'reset');
    return {
      window: key,
      reference: {
        ok: r.ok, error: r.error, simTime: r.simTime, simSeconds: r.simSeconds, scale: r.scale, params: r.params,
        alerts: refEvents.length ? [{ level: 'error', text: `Alguien ha modificado la ciudad de referencia: ${refEvents[0].text}` }] : [],
      },
      groups: groups.map((g) => {
        const score = scoreOf(g, key);
        const s = status(g.name);
        const last = collector.events(g.name, { limit: 50 }).find((e) => e.kind === 'action' || e.kind === 'params');
        return {
          name: g.name, url: g.url, ok: s.ok, simTime: s.simTime, simSeconds: s.simSeconds, cars: s.cars, traffic: s.traffic,
          restrictions: s.restrictions, score, alerts: alertsOf(g, score),
          lastAction: last ? { text: last.text, simSeconds: last.sim_seconds, wallMs: last.wall_ms } : null,
        };
      }),
    };
  }

  function series(name, key) {
    const w = windowOf(name, key) ?? { from: -Infinity, to: Infinity };
    const g = collector.buckets(name, w.from, w.to + 1);
    const refRows = new Map(collector.buckets(REFERENCE, w.from, w.to + 1).map((r) => [r.bucket, r]));
    const s = status(name);
    const origin = s?.simTime ? Date.parse(`${s.simTime}Z`) - s.simSeconds * 1000 : Date.UTC(2026, 0, 5);
    return {
      name,
      points: g.map((row) => ({
        t: new Date(origin + row.bucket * BUCKET_SECONDS * 1000).toISOString().slice(0, 16),
        group: Object.fromEntries(Object.entries(derived).map(([k, f]) => [k, f(row)])),
        reference: Object.fromEntries(Object.entries(derived).map(([k, f]) => [k, f(refRows.get(row.bucket))])),
      })),
    };
  }

  const expected = Buffer.from(`Basic ${Buffer.from(`profesor:${password}`).toString('base64')}`);
  const authorized = (req) => {
    const got = Buffer.from(req.headers.authorization ?? '');
    return got.length === expected.length && timingSafeEqual(got, expected);
  };
  const page = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'index.html'));
  const names = new Set(groups.map((g) => g.name));

  return (req, res) => {
    const url = new URL(req.url, 'http://panel');
    const send = (code, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
    };
    if (url.pathname === '/health') return send(200, { ok: true });
    if (!authorized(req)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Panel del profesor", charset="UTF-8"' });
      return res.end('Usuario: profesor');
    }
    if (req.method !== 'GET') return send(405, { error: 'Solo lectura' });
    const key = WINDOWS[url.searchParams.get('window')] ? url.searchParams.get('window') : 'day';
    if (url.pathname === '/' || url.pathname === '/index.html') return send(200, page, 'text/html; charset=utf-8');
    if (url.pathname === '/data/overview') return send(200, overview(key));
    const instance = url.searchParams.get('group');
    if (!names.has(instance)) return send(404, { error: 'Grupo desconocido' });
    if (url.pathname === '/data/series') return send(200, series(instance, key));
    if (url.pathname === '/data/events') return send(200, { events: collector.events(instance, { limit: 300, allEpochs: true }) });
    return send(404, { error: 'No encontrado' });
  };
}

export { INDICATORS };

// Arranque como programa (no al importarlo desde los tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const env = process.env;
  const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
  if (!env.PANEL_PASSWORD) {
    console.error('Define PANEL_PASSWORD: el panel muestra la métrica oculta y no puede quedar abierto.');
    process.exit(1);
  }
  const groups = parseGroups(env.PANEL_GROUPS);
  if (!groups.length) {
    console.error('Define PANEL_GROUPS, por ejemplo: PANEL_GROUPS=g1=https://grupo1.ejemplo.es,g2=https://grupo2.ejemplo.es');
    process.exit(1);
  }
  const dbFile = env.DB_FILE ?? 'data/panel.db';
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const instances = [{ name: REFERENCE, url: env.REFERENCE_URL ?? 'http://reference:8080', kind: 'reference' }, ...groups];
  const collector = new Collector({ file: dbFile, instances, log });
  const server = http.createServer(createPanel({ collector, groups, password: env.PANEL_PASSWORD }));
  const port = Number(env.PORT ?? 8090);
  server.listen(port, () => log(`Panel en http://localhost:${port} · ${groups.map((g) => `${g.name}=${g.url}`).join(' · ')}`));

  const periodMs = Number(env.POLL_SECONDS ?? 5) * 1000;
  let stopped = false;
  (async () => {
    while (!stopped) {
      const started = Date.now();
      await collector.pollAll();
      await new Promise((r) => setTimeout(r, Math.max(0, periodMs - (Date.now() - started))));
    }
  })();
  const shutdown = () => {
    stopped = true;
    server.close();
    collector.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
