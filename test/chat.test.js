import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { Chat, noSe, checkChatConfig, defaultChat } from '../server/chat.js';
import { setLang } from '../src/i18n/index.js';
import { createAdmin } from '../chatadmin/server.js';
import { SimEngine } from '../src/core/engine.js';
import { Store } from '../server/store.js';
import { Runtime } from '../server/runtime.js';
import { createApp } from '../server/app.js';

const ask = [{ role: 'user', content: '¿Cuántos coches hay?' }];

// Respuesta falsa de un modelo: guarda lo que se le pidió.
function fakeModel(body) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(typeof body === 'function' ? body(url) : body), { status: 200 });
  };
  return { calls, fetchImpl };
}

test('the chatbot starts hidden, answers "No sé" without a model and keeps its settings', async () => {
  const store = new Store();
  const chat = new Chat({ store });
  assert.deepEqual(chat.publicState(), { enabled: false, title: defaultChat().title });
  await assert.rejects(chat.ask(ask), { status: 404 });
  chat.update({ enabled: true });
  assert.deepEqual(await chat.ask(ask), { reply: noSe() });
  assert.deepEqual(new Chat({ store }).publicState().enabled, true, 'la configuración se guarda');
  // Validación.
  assert.throws(() => checkChatConfig({ provider: 'gpt' }), /provider/);
  assert.throws(() => checkChatConfig({ provider: 'ollama', url: 'ftp://x' }), /http/);
  assert.throws(() => checkChatConfig({ enabled: 'sí' }), /true o false/);
  assert.throws(() => checkChatConfig({ otro: 1 }), /desconocido/);
  await assert.rejects(chat.ask([{ role: 'assistant', content: 'hola' }]), /último mensaje/);
  await assert.rejects(chat.ask([{ role: 'user', content: 'x'.repeat(3000) }]), /caracteres/);
});

test('the chatbot speaks the language of the service, also with a saved configuration', async () => {
  const store = new Store();
  try {
    new Chat({ store }).update({ enabled: true, temperature: 0.5 });
    assert.deepEqual(store.getMeta('chat'), { enabled: true, temperature: 0.5 }, 'solo se guarda lo cambiado');
    setLang('eu');
    const eu = new Chat({ store });
    assert.deepEqual(eu.publicState(), { enabled: true, title: 'Laguntzailea' });
    assert.deepEqual(await eu.ask(ask), { reply: 'Ez dakit' });
    assert.match(eu.config.systemPrompt, /Erantzun euskaraz/);
    assert.throws(() => checkChatConfig({ enabled: 'bai' }), /true edo false/);
    setLang('en');
    const en = new Chat({ store });
    assert.deepEqual(await en.ask(ask), { reply: "I don't know" });
    assert.match(en.config.systemPrompt, /Answer in English/);
    en.update({ title: 'Txiki' });
    setLang('es');
    assert.equal(new Chat({ store }).publicState().title, 'Txiki', 'un nombre propio no cambia con el idioma');
  } finally {
    setLang('es');
  }
});

test('questions are limited per minute and client', async () => {
  let t = 0;
  const chat = new Chat({ now: () => t });
  chat.update({ enabled: true });
  for (let i = 0; i < 10; i++) await chat.ask(ask, { client: 'a' });
  await assert.rejects(chat.ask(ask, { client: 'a' }), { status: 429 });
  assert.deepEqual(await chat.ask(ask, { client: 'b' }), { reply: noSe() });
  t += 61_000;
  assert.deepEqual(await chat.ask(ask, { client: 'a' }), { reply: noSe() });
});

test('the chatbot talks to Ollama and to OpenAI-compatible APIs (with the city summary if asked)', async () => {
  const ollama = fakeModel((url) => (url.endsWith('/api/tags') ? { models: [{ name: 'llama3.2' }] } : { message: { role: 'assistant', content: ' Hay 1200 coches. ' } }));
  const chat = new Chat({ fetchImpl: ollama.fetchImpl, summary: () => 'Coches circulando: 1200' });
  chat.update({ enabled: true, provider: 'ollama', url: 'http://ollama:11434/', model: 'llama3.2', includeState: true });
  assert.deepEqual(await chat.ask(ask), { reply: 'Hay 1200 coches.' });
  const sent = ollama.calls[0];
  assert.equal(sent.url, 'http://ollama:11434/api/chat');
  assert.equal(sent.body.model, 'llama3.2');
  assert.equal(sent.body.stream, false);
  assert.equal(sent.body.messages[0].role, 'system');
  assert.match(sent.body.messages[0].content, /Coches circulando: 1200/);
  assert.deepEqual(sent.body.messages.slice(1), ask);
  assert.deepEqual(await chat.models(), { models: ['llama3.2'] });

  const openai = fakeModel((url) => (url.endsWith('/v1/models') ? { data: [{ id: 'gpt-x' }] } : { choices: [{ message: { content: 'Muchos.' } }] }));
  const chat2 = new Chat({ fetchImpl: openai.fetchImpl });
  chat2.update({ enabled: true, provider: 'openai', url: 'https://api.example.com', model: 'gpt-x', apiKey: 'secreta' });
  assert.deepEqual(await chat2.ask(ask), { reply: 'Muchos.' });
  assert.equal(openai.calls[0].url, 'https://api.example.com/v1/chat/completions');
  assert.equal(openai.calls[0].init.headers.Authorization, 'Bearer secreta');
  assert.equal(chat2.adminView().apiKey, undefined, 'la clave no sale de la ciudad');
  assert.equal(chat2.adminView().hasApiKey, true);
  chat2.update({ apiKey: null, model: 'otro' });
  assert.equal(chat2.config.apiKey, 'secreta', 'null conserva la clave guardada');

  // Servicio propio de los alumnos: recibe la conversación, las instrucciones y (si se pide) el estado de la ciudad.
  const own = fakeModel({ reply: 'Respuesta de nuestro sistema' });
  const chat3 = new Chat({ fetchImpl: own.fetchImpl, summary: () => 'Coches circulando: 5' });
  chat3.update({ enabled: true, provider: 'custom', url: 'http://grupo1:5000/chat', includeState: true, apiKey: 'k' });
  assert.deepEqual(await chat3.ask(ask), { reply: 'Respuesta de nuestro sistema' });
  assert.equal(own.calls[0].url, 'http://grupo1:5000/chat');
  assert.deepEqual(own.calls[0].body.messages, ask);
  assert.equal(own.calls[0].body.city, 'Coches circulando: 5');
  assert.equal(own.calls[0].init.headers.Authorization, 'Bearer k');
  const bad = new Chat({ fetchImpl: fakeModel({ text: 'x' }).fetchImpl });
  bad.update({ enabled: true, provider: 'custom', url: 'http://grupo1:5000/chat' });
  await assert.rejects(bad.ask(ask), /reply/);

  const down = new Chat({ fetchImpl: async () => { throw Object.assign(new Error('x'), { cause: { code: 'ECONNREFUSED' } }); } });
  down.update({ enabled: true, provider: 'ollama', model: 'm' });
  await assert.rejects(down.ask(ask), (err) => err.status === 502 && /ECONNREFUSED/.test(err.message));
});

test('API: hidden until the students enable it with their token; then the viewer sees it', async (t) => {
  const store = new Store();
  const runtime = new Runtime({ engine: new SimEngine({ data: { nodes: [0, 0, 400, 0], ways: [[2, 0, 0, 1]], signals: [] }, maxCars: 5 }), store, now: () => 1_000_000, checkpointMs: 1e9 });
  const server = http.createServer(createApp({ runtime, store, token: 'clave' }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  server.keepAliveTimeout = 60_000;
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, { method = 'GET', body, key } = {}) => {
    const r = await fetch(base + path, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    });
    return { status: r.status, body: await r.json() };
  };
  assert.deepEqual((await call('/api/state')).body.chat, { enabled: false, title: 'Asistente' });
  assert.equal((await call('/api/chat', { method: 'POST', body: { messages: ask } })).status, 404, 'escondido');
  assert.equal((await call('/api/chat/config')).status, 401, 'sin el token de la ciudad no se configura');
  assert.equal((await call('/api/chat/config', { key: 'otra' })).status, 401);
  // Probar sin activarlo.
  assert.deepEqual((await call('/api/chat/test', { method: 'POST', key: 'clave', body: { messages: ask } })).body, { reply: noSe() });
  const put = await call('/api/chat/config', { method: 'PUT', key: 'clave', body: { enabled: true, title: 'Txiki' } });
  assert.equal(put.status, 200);
  assert.deepEqual((await call('/api/state')).body.chat, { enabled: true, title: 'Txiki' });
  assert.deepEqual((await call('/api/chat', { method: 'POST', body: { messages: ask } })).body, { reply: noSe() });
  assert.equal((await call('/api/chat/config', { method: 'PUT', key: 'clave', body: { provider: 'x' } })).status, 400);
});

test('chat-admin asks for its password (if any) and passes the configuration to the city with its token', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, method: init.method, key: init.headers.Authorization, body: init.body ? String(init.body) : null });
    return new Response(JSON.stringify({ enabled: true }), { status: 200 });
  };
  const server = http.createServer(createAdmin({ password: 'profe', token: 'clave', simUrl: 'http://sim:8080', fetchImpl }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { Authorization: `Basic ${Buffer.from('admin:profe').toString('base64')}` };
  try {
    assert.equal((await fetch(base + '/')).status, 401);
    assert.equal((await fetch(base + '/', { headers: { Authorization: `Basic ${Buffer.from('admin:mal').toString('base64')}` } })).status, 401);
    const page = await fetch(base + '/', { headers: auth });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Chatbot de la ciudad/);
    const put = await fetch(base + '/config', { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
    assert.deepEqual(await put.json(), { enabled: true });
    assert.deepEqual(seen[0], { url: 'http://sim:8080/api/chat/config', method: 'PUT', key: 'Bearer clave', body: '{"enabled":true}' });
    assert.equal((await fetch(base + '/otra', { headers: auth })).status, 404);
    // Sin contraseña, abierta (la arrancan los alumnos en su equipo).
    const open = http.createServer(createAdmin({ token: 'clave', fetchImpl }));
    await new Promise((resolve) => open.listen(0, '127.0.0.1', resolve));
    assert.equal((await fetch(`http://127.0.0.1:${open.address().port}/`)).status, 200);
    open.close();
  } finally {
    server.close();
  }
});

test('the chat-admin page has every text in Basque and English, and follows the language of the city', async () => {
  const dict = JSON.parse(fs.readFileSync(new URL('../chatadmin/i18n.json', import.meta.url), 'utf8'));
  const page = fs.readFileSync(new URL('../chatadmin/index.html', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../chatadmin/server.js', import.meta.url), 'utf8');
  const keys = new Set([
    ...[...page.matchAll(/\btr\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]),
    ...[...server.matchAll(/fail\(res, \d+, '((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]),
  ]);
  // Textos fijos de la página: lo que hay entre etiquetas dentro de <main>, y los placeholder.
  const main = page.slice(page.indexOf('<main>'), page.indexOf('</main>'));
  for (const m of main.matchAll(/>([^<>]*[A-Za-zÁÉÍÓÚáéíóú][^<>]*)</g)) keys.add(m[1].trim());
  for (const m of main.matchAll(/placeholder="([^"]*[a-z][^"]*)"/g)) if (!m[1].startsWith('http') && !/^[a-z0-9.]+$/.test(m[1])) keys.add(m[1]);
  const names = new Set(['Ollama', '—']);
  for (const lang of ['eu', 'en']) {
    const missing = [...keys].filter((k) => !names.has(k) && !(k in dict[lang]));
    assert.deepEqual(missing, [], `${lang}: faltan traducciones en chat-admin`);
  }
  // La configuración que lee la página trae el idioma de la ciudad.
  const store = new Store();
  const runtime = new Runtime({ engine: new SimEngine({ data: { nodes: [0, 0, 400, 0], ways: [[2, 0, 0, 1]], signals: [] }, maxCars: 5 }), store, now: () => 1_000_000, checkpointMs: 1e9 });
  const city = http.createServer(createApp({ runtime, store }));
  await new Promise((resolve) => city.listen(0, '127.0.0.1', resolve));
  try {
    setLang('eu');
    const config = await (await fetch(`http://127.0.0.1:${city.address().port}/api/chat/config`)).json();
    assert.equal(config.lang, 'eu');
    assert.equal(config.title, 'Laguntzailea');
  } finally {
    setLang('es');
    city.close();
  }
});
