import { DatabaseSync } from 'node:sqlite';
import { INDICATORS, METRIC, bucketOf, indicatorsOf } from './metric.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS buckets (
  instance TEXT NOT NULL, epoch INTEGER NOT NULL, bucket INTEGER NOT NULL, n INTEGER NOT NULL, sums TEXT NOT NULL,
  PRIMARY KEY (instance, epoch, bucket)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, instance TEXT NOT NULL, epoch INTEGER NOT NULL,
  sim_seconds REAL NOT NULL, wall_ms INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_instance ON events (instance, epoch, sim_seconds);
CREATE TABLE IF NOT EXISTS instance_state (instance TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS seen_rows (instance TEXT NOT NULL, epoch INTEGER NOT NULL, ts TEXT NOT NULL, PRIMARY KEY (instance, epoch, ts)) WITHOUT ROWID;
`;

// Lo que se recuerda de la última consulta para detectar cambios entre una y otra.
function snapshotOf(state, restrictions) {
  return {
    restrictions: Object.fromEntries((restrictions.restrictions ?? []).map((r) => [r.id, { mode: r.mode, limit: r.limit, length: r.length, since: r.since, name: r.name }])),
    fleet: Object.fromEntries((state.buses?.lines ?? []).map((l) => [l.id, l.fleet])),
    suspended: (state.buses?.lines ?? []).filter((l) => l.suspended).map((l) => l.id),
    plan: state.signalPlan ?? null,
    params: state.params ?? null,
    pending: Object.fromEntries((state.bikes?.stations ?? []).filter((s) => s.pending).map((s) => [s.id, s.pending])),
  };
}

const json = (v) => JSON.stringify(v ?? null);
// Mismos parámetros de demanda aunque las claves vengan en otro orden (al restaurar un checkpoint cambia el orden).
export const sameParams = (a, b) => {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  return [...keys].every((k) => a?.[k] === b?.[k]);
};

// CSV de la API (comillas dobles solo cuando hacen falta) → lista de objetos por columna.
export function parseCsv(text) {
  const lines = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); lines.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); lines.push(row); }
  const [header, ...rows] = lines;
  return rows.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}
const hours = (seconds) => `${(seconds / 3600).toFixed(1)} h`;
const describeRestriction = (r) => `${r.mode}${r.mode === 'entry_limit' ? ` (límite ${r.limit})` : ''}, ${r.length ?? '?'} m`;

/** Cambios entre dos consultas: lista de { kind, text } y marchas atrás (deshacer algo en menos de 1 h simulada). */
export function diffSnapshots(prev, next, simSeconds, memory) {
  const out = [];
  const reversal = (text) => out.push({ kind: 'reversal', text });
  for (const [id, r] of Object.entries(next.restrictions)) {
    const before = prev.restrictions[id];
    if (!before) out.push({ kind: 'action', text: `Crea ${id}${r.name ? ` «${r.name}»` : ''}: ${describeRestriction(r)}` });
    else if (before.mode !== r.mode || before.limit !== r.limit) out.push({ kind: 'action', text: `Cambia ${id}: ${describeRestriction(before)} → ${describeRestriction(r)}` });
  }
  for (const [id, r] of Object.entries(prev.restrictions)) {
    if (next.restrictions[id]) continue;
    const lasted = simSeconds - (r.since ?? simSeconds);
    out.push({ kind: 'action', text: `Quita ${id} (${describeRestriction(r)}) tras ${hours(lasted)}` });
    if (lasted < METRIC.reversalSeconds) reversal(`${id} quitada a las ${hours(lasted)} de crearla`);
  }
  for (const [line, fleet] of Object.entries(next.fleet)) {
    const before = prev.fleet[line];
    if (before === undefined || before === fleet) continue;
    out.push({ kind: 'action', text: `${line}: flota ${before} → ${fleet}` });
    const dir = Math.sign(fleet - before);
    const last = memory.fleet[line];
    if (last && last.dir === -dir && simSeconds - last.sim < METRIC.reversalSeconds) reversal(`${line}: flota sube y baja en menos de 1 h`);
    memory.fleet[line] = { dir, sim: simSeconds };
  }
  if (json(prev.plan?.default) !== json(next.plan?.default)) out.push({ kind: 'action', text: `Semáforos (todos): ${json(next.plan?.default)}` });
  const ids = new Set([...Object.keys(prev.plan?.signals ?? {}), ...Object.keys(next.plan?.signals ?? {})]);
  for (const id of ids) {
    const a = prev.plan?.signals?.[id];
    const b = next.plan?.signals?.[id];
    if (json(a) !== json(b)) out.push({ kind: 'action', text: `Semáforo ${id}: ${b ? json(b) : 'vuelve al plan general'}` });
  }
  if (!sameParams(prev.params, next.params)) out.push({ kind: 'params', text: `Cambia los parámetros de demanda: ${json(prev.params)} → ${json(next.params)}` });
  for (const [id, p] of Object.entries(next.pending)) {
    if (json(prev.pending[id]) !== json(p)) out.push({ kind: 'action', text: `Bicis ${id}: capacidad → ${p.capacity ?? json(p)}` });
  }
  return out;
}

export class Collector {
  constructor({ file, instances, fetchJson = defaultFetch, fetchText = defaultFetchText, now = Date.now, log = () => {} }) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
    this.instances = instances; // [{ name, url, kind: 'group' | 'reference' }]
    this.fetchJson = fetchJson;
    this.fetchText = fetchText;
    this.now = now;
    this.log = log;
    this.status = new Map();
    this.memory = new Map();
    const load = this.db.prepare('SELECT data FROM instance_state WHERE instance = ?');
    for (const inst of instances) {
      const row = load.get(inst.name);
      this.memory.set(inst.name, row ? JSON.parse(row.data) : { epoch: 0, lastSim: null, lastTs: null, snapshot: null, fleet: {}, suspendedSince: {}, penalized: {} });
      this.status.set(inst.name, { ok: false, error: 'Sin consultar todavía', lastOkWall: null });
    }
  }

  async pollAll() {
    await Promise.all(this.instances.map((inst) => this.poll(inst)));
  }

  async poll(inst) {
    const status = this.status.get(inst.name);
    const mem = this.memory.get(inst.name);
    try {
      const base = inst.url.replace(/\/$/, '');
      const [state, restrictions] = await Promise.all([this.fetchJson(`${base}/api/state`), this.fetchJson(`${base}/api/restrictions`)]);
      // Si la ciudad se ha reiniciado, su histórico vuelve a empezar: se pide entero.
      const restarted = mem.lastSim !== null && state.simSeconds < mem.lastSim - 60;
      const from = !restarted && mem.lastTs ? mem.lastTs : '2000-01-01T00:00:00';
      const csv = await this.fetchText(`${base}/api/city.csv?from=${encodeURIComponent(from)}`);
      this.record(inst, { state, restrictions, rows: parseCsv(csv) });
      Object.assign(status, {
        ok: true, error: null, lastOkWall: this.now(), simSeconds: state.simSeconds, simTime: state.simTime,
        scale: state.scale, caughtUp: state.caughtUp, params: state.params, cars: state.cars, traffic: state.traffic,
        restrictions: (restrictions.restrictions ?? []).length,
        suspendedLines: (state.buses?.lines ?? []).filter((l) => l.suspended).map((l) => l.id),
      });
    } catch (err) {
      Object.assign(status, { ok: false, error: err.message });
    }
  }

  event(name, epoch, sim, kind, text) {
    this.db.prepare('INSERT INTO events (instance, epoch, sim_seconds, wall_ms, kind, text) VALUES (?, ?, ?, ?, ?, ?)').run(name, epoch, sim, this.now(), kind, text);
  }

  record(inst, responses) {
    const mem = this.memory.get(inst.name);
    const sim = responses.state.simSeconds;
    // La ciudad ha vuelto atrás en el tiempo: se ha reiniciado o se ha borrado su base de datos.
    if (mem.lastSim !== null && sim < mem.lastSim - 60) {
      mem.epoch++;
      mem.snapshot = null;
      mem.fleet = {};
      mem.suspendedSince = {};
      mem.penalized = {};
      mem.lastTs = null;
      this.event(inst.name, mem.epoch, sim, 'reset', `La ciudad se ha reiniciado (volvió de ${hours(mem.lastSim)} a ${hours(sim)} simuladas)`);
    }
    const snapshot = snapshotOf(responses.state, responses.restrictions);
    if (mem.snapshot) for (const e of diffSnapshots(mem.snapshot, snapshot, sim, mem)) this.event(inst.name, mem.epoch, sim, e.kind, e.text);
    // Líneas suspendidas demasiado tiempo seguido: una penalización por episodio.
    for (const line of Object.keys(mem.suspendedSince)) if (!snapshot.suspended.includes(line)) {
      delete mem.suspendedSince[line];
      delete mem.penalized[line];
    }
    for (const line of snapshot.suspended) {
      mem.suspendedSince[line] ??= sim;
      if (!mem.penalized[line] && sim - mem.suspendedSince[line] >= METRIC.suspensionSeconds) {
        mem.penalized[line] = true;
        this.event(inst.name, mem.epoch, sim, 'suspension', `${line} lleva más de ${hours(METRIC.suspensionSeconds)} suspendida`);
      }
    }
    mem.snapshot = snapshot;
    mem.lastSim = sim;

    // Histórico global: cada fila (cada 5 min simulados) se suma una sola vez a su tramo de 15 min.
    const origin = Math.round((Date.parse(`${responses.state.simTime}Z`) - sim * 1000) / 60000) * 60000;
    const seen = this.db.prepare('INSERT OR IGNORE INTO seen_rows (instance, epoch, ts) VALUES (?, ?, ?)');
    const getBucket = this.db.prepare('SELECT n, sums FROM buckets WHERE instance = ? AND epoch = ? AND bucket = ?');
    const putBucket = this.db.prepare('INSERT OR REPLACE INTO buckets (instance, epoch, bucket, n, sums) VALUES (?, ?, ?, ?, ?)');
    this.db.exec('BEGIN');
    try {
      for (const row of responses.rows) {
        if (!row.timestamp || seen.run(inst.name, mem.epoch, row.timestamp).changes === 0) continue;
        const bucket = bucketOf((Date.parse(`${row.timestamp}Z`) - origin) / 1000);
        const values = indicatorsOf(row);
        const current = getBucket.get(inst.name, mem.epoch, bucket);
        const sums = current ? JSON.parse(current.sums) : Object.fromEntries(INDICATORS.map((k) => [k, 0]));
        for (const k of INDICATORS) sums[k] += values[k];
        putBucket.run(inst.name, mem.epoch, bucket, (current?.n ?? 0) + 1, JSON.stringify(sums));
        if (!mem.lastTs || row.timestamp > mem.lastTs) mem.lastTs = row.timestamp;
      }
      this.db.prepare('INSERT OR REPLACE INTO instance_state (instance, data) VALUES (?, ?)').run(inst.name, JSON.stringify(mem));
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  epochOf(name) {
    return this.memory.get(name)?.epoch ?? 0;
  }

  buckets(name, from = -Infinity, to = Infinity) {
    const rows = this.db.prepare('SELECT bucket, n, sums FROM buckets WHERE instance = ? AND epoch = ? ORDER BY bucket').all(name, this.epochOf(name));
    return rows.filter((r) => r.bucket >= from && r.bucket < to).map((r) => ({ bucket: r.bucket, n: r.n, sums: JSON.parse(r.sums) }));
  }

  events(name, { fromSim = -1e15, toSim = 1e15, limit = 100000, allEpochs = false } = {}) {
    const bound = (v) => Math.max(-1e15, Math.min(1e15, v));
    fromSim = bound(fromSim);
    toSim = bound(toSim);
    if (allEpochs) return this.db.prepare('SELECT * FROM events WHERE instance = ? ORDER BY id DESC LIMIT ?').all(name, limit);
    return this.db
      .prepare('SELECT * FROM events WHERE instance = ? AND epoch = ? AND sim_seconds >= ? AND sim_seconds < ? ORDER BY id DESC LIMIT ?')
      .all(name, this.epochOf(name), fromSim, toSim, limit);
  }

  close() {
    this.db.close();
  }
}

// Explicaciones de los fallos de red más habituales (Node solo dice «fetch failed»).
const NETWORK_HINTS = {
  ECONNREFUSED: 'conexión rechazada: no hay nada escuchando en ese puerto (¿la ciudad está arrancada? ¿es su HTTP_PORT?)',
  ENOTFOUND: 'no se encuentra ese nombre de equipo (en Linux, ¿falta extra_hosts? haz git pull y docker compose up -d)',
  EAI_AGAIN: 'no se pudo resolver el nombre de equipo',
  ETIMEDOUT: 'tiempo de espera agotado (¿un cortafuegos bloquea el puerto?)',
  EHOSTUNREACH: 'equipo inalcanzable (¿un cortafuegos bloquea el puerto?)',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'certificado no válido: arranca la ciudad con DOMAIN=:80 y usa http://',
  SELF_SIGNED_CERT_IN_CHAIN: 'certificado no válido: arranca la ciudad con DOMAIN=:80 y usa http://',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'certificado no válido: arranca la ciudad con DOMAIN=:80 y usa http://',
  ERR_TLS_CERT_ALTNAME_INVALID: 'el certificado es de otro dominio: usa la URL de su DOMAIN o arranca la ciudad con DOMAIN=:80',
};

export function describeFetchError(url, err) {
  if (err.name === 'TimeoutError') return `${url}: no responde a tiempo`;
  const code = err.cause?.code ?? err.code;
  if (!code) return `${url}: ${err.cause?.message ?? err.message}`;
  return `${url}: ${NETWORK_HINTS[code] ?? code}`;
}

async function request(url, timeoutMs) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
  } catch (err) {
    throw new Error(describeFetchError(url, err));
  }
  // Caddy con DOMAIN=localhost (o un dominio) redirige http:// a https:// en el puerto 443, que no es el de la ciudad.
  if (res.status >= 300 && res.status < 400) {
    throw new Error(`${url}: redirige a ${res.headers.get('location') ?? 'otra dirección'}. Arranca la ciudad con DOMAIN=:80 para usar http://, o pon en PANEL_GROUPS su https://dominio`);
  }
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  // Una página HTML en lugar de la API: la URL apunta al visor u otra web, no a la ciudad.
  if (type.includes('text/html')) throw new Error(`${url}: devuelve una página web, no la API (¿es la URL base de la ciudad?)`);
  return res;
}

async function defaultFetchText(url) {
  return (await request(url, 60000)).text();
}

async function defaultFetch(url) {
  return (await request(url, 15000)).json();
}
