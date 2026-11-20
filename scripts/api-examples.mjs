// Ejemplos de respuesta del explorador de la API (src/docs/examples/<idioma>.json), sacados de una ciudad de verdad.
// ¡Hace cambios! Úsalo contra una ciudad recién creada, una por idioma:
//   SMARTCITY_LANG=eu PORT=8282 DB_FILE=/tmp/ejemplos.db npm run serve
//   node scripts/api-examples.mjs http://localhost:8282 src/docs/examples/eu.json
import fs from 'node:fs';
import { ENDPOINTS } from '../src/docs/apiReference.js';
const base = process.argv[2];
const out = {};
const shrink = (v, depth = 0) => {
  if (Array.isArray(v)) {
    if (v.length && v.every((x) => typeof x === 'number')) return v.slice(0, 6);
    return v.slice(0, depth === 0 ? 2 : 2).map((x) => shrink(x, depth + 1));
  }
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shrink(x, depth + 1)]));
  if (typeof v === 'string' && v.length > 80) return v.slice(0, 40) + '…';
  return v;
};
const order = ['POST /api/sensors', 'POST /api/pedestrian-sensors', 'POST /api/restrictions'];
const eps = [...ENDPOINTS].sort((a, b) => (order.includes(`${b.method} ${b.path}`) ? 1 : 0) - (order.includes(`${a.method} ${a.path}`) ? 1 : 0));
for (const e of eps) {
  if (e.csv || e.path.startsWith('/api/docs') || e.path === '/api/explorer' || e.path === '/api/openapi.json') continue;
  let path = e.path;
  const query = new URLSearchParams();
  for (const p of e.params ?? []) {
    if (p.in === 'path') path = path.replace(`{${p.name}}`, encodeURIComponent(p.example));
    else if (p.example !== undefined && p.example !== '' && !(p.name === 'x' || p.name === 'z')) query.set(p.name, p.example);
  }
  if (['/api/point', '/api/roads'].includes(e.path)) { query.set('lat', '43.3166'); query.set('lon', '-1.98'); }
  const url = base + path + (query.size ? `?${query}` : '');
  const r = await fetch(url, { method: e.method, headers: { 'Content-Type': 'application/json' }, body: e.body ? JSON.stringify(e.body.example) : undefined });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  console.log(r.status, e.method, path);
  if (r.status < 300) out[`${e.method} ${e.path}`] = shrink(body);
}
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1) + '\n');
