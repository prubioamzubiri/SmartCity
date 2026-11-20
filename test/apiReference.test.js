import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { ENDPOINTS, GROUPS, UI, apiReference, openApi } from '../src/docs/apiReference.js';
import { renderExplorerPage } from '../src/docs/explorer.js';
import { setLang } from '../src/i18n/index.js';
import { SimEngine } from '../src/core/engine.js';
import { Store } from '../server/store.js';
import { Runtime } from '../server/runtime.js';
import { createApp } from '../server/app.js';

const appSource = fs.readFileSync(new URL('../server/app.js', import.meta.url), 'utf8');
// Lo que los alumnos no deben ver: los fallos de los sensores y la clave de los datos limpios.
const HIDDEN = ['/api/faults.csv'];
const SECRETS = /\bfaults?\b|x-raw-key|raw_data|fallos?\b|akats/i;

test('the reference documents every route of the API (and nothing that does not exist), except the hidden ones', () => {
  const documented = new Set(ENDPOINTS.map((e) => e.path));
  const exact = new Set([
    ...[...appSource.matchAll(/pathname === '(\/api\/[^']+)'/g)].map((m) => m[1]),
    ...[...appSource.matchAll(/^ {2}'(\/api\/[\w.]+\.csv)':/gm)].map((m) => m[1]),
  ]);
  for (const path of exact) {
    if (!HIDDEN.includes(path)) assert.ok(documented.has(path), `${path} sin documentar en src/docs/apiReference.js`);
  }
  // Rutas con identificador: /^\/api\/buses\/(…)$/ ↔ /api/buses/{line}
  for (const m of appSource.matchAll(/\/\^\\\/api\\\/([\w-]+)\\\/\(/g)) {
    assert.ok([...documented].some((p) => p.startsWith(`/api/${m[1]}/{`)), `/api/${m[1]}/<id> sin documentar`);
  }
  for (const e of ENDPOINTS) {
    const fixed = e.path.replace(/\/\{\w+\}$/, '');
    assert.ok(exact.has(e.path) || appSource.includes(`\\/api\\/${fixed.slice(5).replace(/\//g, '\\/')}\\/(`), `${e.method} ${e.path} no existe en el servidor`);
    assert.ok(GROUPS.some((g) => g.id === e.group), `${e.path}: grupo ${e.group}`);
    for (const p of e.params ?? []) if (p.in === 'path') assert.ok(e.path.includes(`{${p.name}}`), `${e.path}: ${p.name}`);
  }
  const ids = ENDPOINTS.map((e) => `${e.method} ${e.path}`);
  assert.equal(new Set(ids).size, ids.length, 'sin repetidos');
});

test('every text of the reference is in Spanish, Basque and English', () => {
  const texts = [];
  const collect = (v, where) => {
    if (v && typeof v === 'object' && 'es' in v && 'eu' in v && 'en' in v) {
      texts.push([v, where]);
      return;
    }
    if (Array.isArray(v)) v.forEach((x, i) => collect(x, `${where}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'example') collect(x, `${where}.${k}`);
  };
  collect({ ENDPOINTS, GROUPS, UI }, 'ref');
  assert.ok(texts.length > 300, `${texts.length} textos`);
  const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [v, where] of texts) {
    for (const lang of ['es', 'eu', 'en']) assert.ok(typeof v[lang] === 'string' && v[lang].trim(), `${where}: falta ${lang}`);
    if (where.startsWith('ref.UI')) assert.deepEqual(placeholders(v.eu), placeholders(v.es), where);
    if (where.startsWith('ref.UI')) assert.deepEqual(placeholders(v.en), placeholders(v.es), where);
  }
  for (const lang of ['es', 'eu', 'en']) {
    const ref = apiReference(lang);
    assert.ok(ref.endpoints.every((e) => e.summary), lang);
    const examples = JSON.parse(fs.readFileSync(new URL(`../src/docs/examples/${lang}.json`, import.meta.url), 'utf8'));
    for (const id of Object.keys(examples)) assert.ok(ref.endpoints.some((e) => e.id === id), `ejemplo de ${id}, que no existe`);
    assert.ok(Object.keys(examples).length > 25);
    const page = renderExplorerPage(lang, examples);
    assert.doesNotMatch(page, SECRETS, `${lang}: el explorador no menciona los fallos de los sensores`);
    assert.doesNotMatch(JSON.stringify(openApi(lang)), SECRETS);
    assert.doesNotMatch(page, /<\/script>[\s\S]*<\/script>/, 'los datos no cierran la etiqueta <script>');
  }
});

test('the explorer and the OpenAPI specification are served in the language of the service', async (t2) => {
  const store = new Store();
  const runtime = new Runtime({ engine: new SimEngine({ data: { nodes: [0, 0, 400, 0], ways: [[2, 0, 0, 1]], signals: [] }, maxCars: 5 }), store, now: () => 1_000_000, checkpointMs: 1e9 });
  const server = http.createServer(createApp({ runtime, store, token: 'clave' }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  server.keepAliveTimeout = 60_000;
  t2.after(() => {
    server.close();
    setLang('es');
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const page = await fetch(`${base}/api/explorer`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
  const html = await page.text();
  assert.match(html, /<html lang="es">/);
  assert.match(html, /Explorador de la API/);
  assert.match(html, /"GET \/api\/state"/, 'con su ejemplo de respuesta');
  const spec = await (await fetch(`${base}/api/openapi.json`)).json();
  assert.equal(spec.openapi, '3.0.3');
  assert.equal(Object.values(spec.paths).reduce((n, ops) => n + Object.keys(ops).length, 0), ENDPOINTS.length);
  assert.deepEqual(spec.paths['/api/restrictions'].post.security, [{ token: [] }]);
  assert.equal(spec.paths['/api/restrictions'].get.security, undefined, 'las lecturas son públicas');
  // La guía y el explorador se enlazan entre sí.
  assert.match(await (await fetch(`${base}/api/docs`)).text(), /href="\/api\/explorer"/);

  setLang('eu');
  assert.match(await (await fetch(`${base}/api/explorer`)).text(), /APIaren arakatzailea/);
  assert.equal((await (await fetch(`${base}/api/openapi.json`)).json()).paths['/api/state'].get.summary, 'Hiri osoaren laburpena');
  setLang('en');
  assert.match(await (await fetch(`${base}/api/explorer`)).text(), /<html lang="en">[\s\S]*API explorer/);

  // Cada función documentada existe: con los valores de ejemplo no responde «ruta desconocida».
  setLang('es');
  for (const e of ENDPOINTS) {
    let path = e.path;
    const query = new URLSearchParams();
    for (const p of e.params ?? []) {
      if (p.in === 'path') path = path.replace(`{${p.name}}`, encodeURIComponent(p.example));
      else if (p.example !== undefined && p.example !== '') query.set(p.name, p.example);
    }
    const r = await fetch(`${base}${path}${query.size ? `?${query}` : ''}`, {
      method: e.method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer clave' },
      body: e.body ? JSON.stringify(e.body.example) : undefined,
    });
    const text = await r.text();
    const error = r.ok ? null : JSON.parse(text).error;
    assert.notEqual(error, 'No encontrado', `${e.method} ${e.path} no existe`);
  }
});
