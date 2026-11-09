import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { SimEngine } from '../src/core/engine.js';
import { Store } from '../server/store.js';
import { Runtime } from '../server/runtime.js';
import { createApp } from '../server/app.js';
import { markdownToHtml, renderDocsPage } from '../src/docs/markdown.js';
import { ApiClient } from '../src/api/client.js';

test('markdown: headings, lists, code blocks and tables become HTML', () => {
  const html = markdownToHtml([
    '## Título `uno`',
    '',
    'Texto con **negrita** y [enlace](https://example.com/a?b=1&c=2).',
    '',
    '- primero',
    '  sigue',
    '- segundo',
    '',
    '| Campo | Valores |',
    '| --- | --- |',
    '| `mode` | `a \\| b` |',
    '',
    '```sh',
    'curl "x" | jq <y>',
    '```',
  ].join('\n'));
  assert.match(html, /<h2 id="titulo-uno">Título <code>uno<\/code><\/h2>/);
  assert.match(html, /<strong>negrita<\/strong>/);
  assert.match(html, /<a href="https:\/\/example.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">enlace<\/a>/);
  assert.match(html, /<li>primero sigue<\/li><li>segundo<\/li>/);
  assert.match(html, /<th>Campo<\/th><th>Valores<\/th>/);
  assert.match(html, /<td><code>mode<\/code><\/td><td><code>a \| b<\/code><\/td>/);
  assert.match(html, /<pre><code>curl &quot;x&quot; \| jq &lt;y&gt;<\/code><\/pre>/);
});

test('markdown: HTML and dangerous links are neutralised', () => {
  const html = markdownToHtml('<script>alert(1)</script> [x](javascript:alert(1)) [y](../examples/a.py) `<b>`');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="javascript'));
  assert.ok(!html.includes('href="../examples'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<code>&lt;b&gt;<\/code>/);
});

test('the real API guide renders without leftover markdown', () => {
  const markdown = fs.readFileSync(new URL('../docs/API.md', import.meta.url), 'utf8');
  const page = renderDocsPage(markdown);
  assert.ok(page.startsWith('<!doctype html>'));
  assert.equal((page.match(/<table>/g) ?? []).length, (markdown.match(/^\| --- /gm) ?? []).length);
  assert.equal((page.match(/<pre>/g) ?? []).length, (markdown.match(/^```\w*$/gm) ?? []).length / 2);
  assert.ok(!/<td>[^<]*\|\s*---/.test(page));
  assert.ok(!page.includes('```'));
  assert.ok(!page.includes('| --- |'));
  assert.match(page, /<h1 id="api-de-smartcity[^"]*">/);
});

async function serve(t, options = {}) {
  const engine = new SimEngine({ data: { nodes: [-250, -250, 250, -250, 250, 250, -250, 250], ways: [[4, 0, 0, 1, 2, 3, 0]], signals: [] }, maxCars: 5 });
  const store = new Store();
  const runtime = new Runtime({ engine, store, now: () => 1_000_000, checkpointMs: 1e9 });
  const server = http.createServer(createApp({ runtime, store, ...options }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test('API: the guide is served as a web page and as Markdown without a token', async (t) => {
  const base = await serve(t, { token: 'secreto' });
  const page = await fetch(`${base}/api/docs`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  const html = await page.text();
  assert.match(html, /\/api\/restrictions/);

  const md = await fetch(`${base}/api/docs.md`);
  assert.match(md.headers.get('content-type'), /^text\/markdown/);
  assert.equal(await md.text(), fs.readFileSync(new URL('../docs/API.md', import.meta.url), 'utf8'));
});

test('API: a server without the guide answers 404', async (t) => {
  const base = await serve(t, { docsFile: new URL('../docs/no-existe.md', import.meta.url) });
  assert.equal((await fetch(`${base}/api/docs`)).status, 404);
});

test('the viewer client builds the guide URL from the server URL', () => {
  assert.equal(new ApiClient({ baseUrl: 'https://mi-app.fly.dev/' }).docsUrl(), 'https://mi-app.fly.dev/api/docs');
});
