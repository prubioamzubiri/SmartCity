import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGS, setLang, t, longDate, translateWeekday } from '../src/i18n/index.js';
import eu from '../src/i18n/eu.js';
import en from '../src/i18n/en.js';
import { CONFIG } from '../src/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const hasWords = (s) => /[A-Za-zÁÉÍÓÚáéíóúñ]/.test(s.replace(/\{\w+\}/g, ''));

// Todas las claves t('...') del código (castellano), recorriendo src/ y server/.
function sourceKeys() {
  const keys = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'i18n') walk(p);
      } else if (p.endsWith('.js')) {
        for (const m of fs.readFileSync(p, 'utf8').matchAll(/(?<![\w$.])t\(\s*'((?:[^'\\]|\\.)*)'/g)) {
          keys.add(m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
        }
      }
    }
  };
  walk(path.join(root, 'src'));
  walk(path.join(root, 'server'));
  return keys;
}

test('every text of the code is translated into Basque and English, with the same placeholders', () => {
  const keys = sourceKeys();
  // Textos que llegan a t() desde la configuración (tipos de evento).
  for (const type of Object.values(CONFIG.events.types)) keys.add(type.label);
  assert.ok(keys.size > 400, `${keys.size} textos`);
  for (const [name, dict] of [['eu', eu], ['en', en]]) {
    const missing = [...keys].filter((k) => hasWords(k) && !(k in dict));
    assert.deepEqual(missing, [], `${name}: faltan traducciones`);
    for (const [k, v] of Object.entries(dict)) {
      assert.deepEqual(placeholders(v), placeholders(k), `${name}: marcadores distintos en «${k}»`);
      assert.ok(v.trim() || !k.trim(), `${name}: traducción vacía de «${k}»`);
    }
  }
});

test('t() translates, fills placeholders and falls back to Spanish; dates and weekdays follow the language', () => {
  try {
    assert.deepEqual(LANGS, ['es', 'eu', 'en']);
    assert.equal(setLang('fr'), 'es', 'un idioma desconocido no cambia nada');
    const d = new Date(Date.UTC(2026, 0, 5));
    assert.equal(t('Sin conexión: {message}', { message: 'x' }), 'Sin conexión: x');
    assert.equal(longDate(d), 'lunes 5 de enero de 2026');
    setLang('eu');
    assert.equal(t('Sin conexión: {message}', { message: 'x' }), 'Konexiorik gabe: x');
    assert.equal(longDate(d), '2026ko urtarrilaren 5a, astelehena');
    assert.equal(translateWeekday('lunes'), 'astelehena');
    assert.equal(t('Un texto sin traducir'), 'Un texto sin traducir');
    setLang('en');
    assert.equal(t('Sin conexión: {message}', { message: 'x' }), 'Offline: x');
    assert.equal(longDate(d), 'Monday 5 January 2026');
    assert.equal(translateWeekday('sábado'), 'Saturday');
    assert.equal(translateWeekday('otra cosa'), 'otra cosa');
  } finally {
    setLang('es');
  }
});

test('the API answers in the language of the service: errors, weekdays in the CSV and its guide', async (t2) => {
  const http = await import('node:http');
  const { SimEngine } = await import('../src/core/engine.js');
  const { Store } = await import('../server/store.js');
  const { Runtime } = await import('../server/runtime.js');
  const { createApp } = await import('../server/app.js');
  const store = new Store();
  let wall = 1_000_000;
  const runtime = new Runtime({ engine: new SimEngine({ data: { nodes: [0, 0, 400, 0], ways: [[2, 0, 0, 1]], signals: [] }, maxCars: 5 }), store, now: () => wall, checkpointMs: 1e9 });
  wall += 2 * 60 * 1000;
  while (!runtime.tick()) { /* recuperación */ }
  runtime.checkpoint();
  const server = http.createServer(createApp({ runtime, store }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  server.keepAliveTimeout = 60_000;
  t2.after(() => {
    server.close();
    setLang('es');
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const errorOf = async () => (await (await fetch(`${base}/api/signals/1`)).json()).error;
  const weekday = async () => (await (await fetch(`${base}/api/city.csv`)).text()).split('\n')[1].split(',')[1];
  const docs = async () => {
    const res = await fetch(`${base}/api/docs.md`);
    assert.equal(res.status, 200);
    return (await res.text()).split('\n')[0];
  };

  assert.equal(await errorOf(), 'Semáforo no encontrado');
  assert.equal(await weekday(), 'lunes');
  assert.equal(await docs(), '# API de SmartCity para gestionar la ciudad desde un programa externo');
  setLang('eu');
  assert.equal(await errorOf(), 'Ez da semaforoa aurkitu');
  assert.equal(await weekday(), 'astelehena', 'lo guardado sigue en castellano y sale en euskera');
  assert.equal(await docs(), '# SmartCity APIa hiria kanpoko programa batetik kudeatzeko');
  setLang('en');
  assert.equal(await errorOf(), 'Traffic signal not found');
  assert.equal(await weekday(), 'Monday');
  assert.equal(await docs(), '# SmartCity API to manage the city from an external program');
  assert.equal((await (await fetch(`${base}/api/state`)).json()).lang, 'en');
});
