import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from './collector.js';
import { rowsToBuckets } from './metric.js';

const RUN_ID = /^\d{14}$/; // carpeta de cada evaluación: AAAAMMDDhhmmss
const FILE_TYPES = { '.csv': 'text/csv; charset=utf-8', '.log': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';

/**
 * Resultados del evaluador de escenarios ocultos (profesor/evaluador/resultados), solo lectura. Cada evaluación es una
 * carpeta con informe.json, y por escenario el CSV de cada ciudad, el registro de cada gestor y la referencia.
 */
export class Evaluations {
  constructor(dir) {
    this.dir = dir ? path.resolve(dir) : null;
    this.cache = new Map(); // id -> { mtimeMs, report }
  }

  get enabled() {
    return Boolean(this.dir && fs.existsSync(this.dir));
  }

  report(id) {
    if (!this.enabled || !RUN_ID.test(id)) return null;
    const file = path.join(this.dir, id, 'informe.json');
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return null; // evaluación en curso (aún sin informe) o carpeta ajena
    }
    const cached = this.cache.get(id);
    if (cached?.mtimeMs === stat.mtimeMs) return cached.report;
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    this.cache.set(id, { mtimeMs: stat.mtimeMs, report });
    return report;
  }

  // Lista de evaluaciones terminadas, la más reciente primero, con su resumen.
  list() {
    if (!this.enabled) return [];
    return fs.readdirSync(this.dir).filter((id) => RUN_ID.test(id)).sort().reverse().flatMap((id) => {
      try {
        const r = this.report(id);
        return r ? [{ id, fecha: r.fecha, escala: r.escala, escenarios: r.escenarios.map((s) => s.escenario.nombre), resumen: r.resumen }] : [];
      } catch {
        return [{ id, error: 'informe.json ilegible' }];
      }
    });
  }

  // Ruta de un fichero de la evaluación `id`, siempre dentro de su carpeta (null si no existe o se sale).
  file(id, relative) {
    if (!this.enabled || !RUN_ID.test(id) || typeof relative !== 'string') return null;
    const base = path.join(this.dir, id);
    const full = path.resolve(base, relative);
    if (!full.startsWith(base + path.sep) || !FILE_TYPES[path.extname(full)] || !fs.existsSync(full)) return null;
    return { path: full, type: FILE_TYPES[path.extname(full)], name: `${id}-${relative.replace(/[\\/]/g, '-')}` };
  }

  // Tramos de 15 min del grupo y de la ciudad sin gestor en un escenario de una evaluación.
  buckets(id, escenario, grupo) {
    const r = this.report(id);
    const s = r?.escenarios.find((e) => e.escenario.nombre === escenario);
    const g = s?.results.find((x) => x.grupo === grupo);
    if (!g) return null;
    const city = this.file(id, g.archivos?.ciudad ?? `${slug(escenario)}/${slug(grupo)}-ciudad.csv`);
    const ref = this.file(id, s.referencia ?? `${slug(escenario)}/referencia.json`);
    if (!city || !ref) return null;
    const groupBuckets = rowsToBuckets(parseCsv(fs.readFileSync(city.path, 'utf8')));
    const last = groupBuckets.at(-1)?.bucket ?? -Infinity;
    const refBuckets = rowsToBuckets(JSON.parse(fs.readFileSync(ref.path, 'utf8'))).filter((b) => b.bucket <= last);
    return { group: groupBuckets, reference: refBuckets };
  }
}
