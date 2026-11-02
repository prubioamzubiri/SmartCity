import { DatabaseSync } from 'node:sqlite';

export const TRAFFIC_COLUMNS = ['timestamp', 'weekday', 'sensor_id', 'sensor_name', 'x', 'z', 'count', 'count_fwd', 'count_bwd', 'avg_speed_kmh'];
export const PARKING_COLUMNS = ['timestamp', 'weekday', 'parking_id', 'parking_name', 'capacity', 'occupied', 'free', 'occupancy_pct'];

export const PEDESTRIAN_COLUMNS = ['timestamp', 'weekday', 'sensor_id', 'sensor_name', 'x', 'z', 'count', 'count_walk', 'count_cross', 'present'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, saved_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS traffic_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL, weekday TEXT NOT NULL, sensor_id TEXT NOT NULL, sensor_name TEXT,
  x INTEGER, z INTEGER, count INTEGER, count_fwd INTEGER, count_bwd INTEGER, avg_speed_kmh REAL
);
CREATE INDEX IF NOT EXISTS traffic_time ON traffic_records (timestamp);
CREATE INDEX IF NOT EXISTS traffic_sensor ON traffic_records (sensor_id, timestamp);
CREATE TABLE IF NOT EXISTS parking_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL, weekday TEXT NOT NULL, parking_id TEXT NOT NULL, parking_name TEXT,
  capacity INTEGER, occupied INTEGER, free INTEGER, occupancy_pct REAL
);
CREATE INDEX IF NOT EXISTS parking_time ON parking_records (timestamp);
CREATE INDEX IF NOT EXISTS parking_lot ON parking_records (parking_id, timestamp);
CREATE TABLE IF NOT EXISTS pedestrian_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL, weekday TEXT NOT NULL, sensor_id TEXT NOT NULL, sensor_name TEXT,
  x INTEGER, z INTEGER, count INTEGER, count_walk INTEGER, count_cross INTEGER, present INTEGER
);
CREATE INDEX IF NOT EXISTS pedestrian_time ON pedestrian_records (timestamp);
CREATE INDEX IF NOT EXISTS pedestrian_sensor ON pedestrian_records (sensor_id, timestamp);
`;

const TABLES = {
  traffic: { table: 'traffic_records', columns: TRAFFIC_COLUMNS, idColumn: 'sensor_id' },
  parking: { table: 'parking_records', columns: PARKING_COLUMNS, idColumn: 'parking_id' },
  pedestrians: { table: 'pedestrian_records', columns: PEDESTRIAN_COLUMNS, idColumn: 'sensor_id' },
};

export class Store {
  constructor(file = ':memory:') {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec(SCHEMA);
    this.inserts = {};
    for (const [kind, { table, columns }] of Object.entries(TABLES)) {
      this.inserts[kind] = this.db.prepare(
        `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
      );
    }
    this.getMetaStmt = this.db.prepare('SELECT value FROM meta WHERE key = ?');
    this.setMetaStmt = this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    this.saveSnapshotStmt = this.db.prepare(
      'INSERT INTO snapshot (id, data, saved_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, saved_at = excluded.saved_at',
    );
    this.loadSnapshotStmt = this.db.prepare('SELECT data FROM snapshot WHERE id = 1');
  }

  getMeta(key) {
    const row = this.getMetaStmt.get(key);
    return row ? JSON.parse(row.value) : null;
  }

  setMeta(key, value) {
    this.setMetaStmt.run(key, JSON.stringify(value));
  }

  loadSnapshot() {
    const row = this.loadSnapshotStmt.get();
    return row ? JSON.parse(row.data) : null;
  }

  // Registros y snapshot se guardan en una única transacción: tras un fallo el estado y los datos
  // vuelven juntos al último punto guardado y la simulación determinista regenera lo perdido.
  checkpoint(snapshot, records = {}, wallMs = Date.now()) {
    this.db.exec('BEGIN');
    try {
      for (const kind of Object.keys(TABLES)) {
        for (const r of records[kind] ?? []) this.inserts[kind].run(...TABLES[kind].columns.map((c) => r[c] ?? null));
      }
      this.saveSnapshotStmt.run(JSON.stringify(snapshot), wallMs);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // Los límites `from` y `to` son marcas de tiempo simuladas ISO (from inclusivo, to exclusivo).
  iterate(kind, { from, to, id } = {}) {
    const { table, columns, idColumn } = TABLES[kind];
    const where = [];
    const args = [];
    if (from) { where.push('timestamp >= ?'); args.push(from); }
    if (to) { where.push('timestamp < ?'); args.push(to); }
    if (id) { where.push(`${idColumn} = ?`); args.push(id); }
    const sql = `SELECT ${columns.join(',')} FROM ${table}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY timestamp, id`;
    return this.db.prepare(sql).iterate(...args);
  }

  count(kind) {
    return this.db.prepare(`SELECT COUNT(*) AS n FROM ${TABLES[kind].table}`).get().n;
  }

  close() {
    this.db.close();
  }
}
