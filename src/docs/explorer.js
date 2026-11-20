// Explorador de la API (GET /api/explorer): una página autocontenida, como un Swagger UI, con todas las funciones de la
// API, sus parámetros, un ejemplo de respuesta, el código para llamarlas (curl, Python, JavaScript) y un botón para
// probarlas contra esta misma ciudad. Los datos salen de apiReference.js; los ejemplos, de src/docs/examples/<idioma>.json.
import { apiReference } from './apiReference.js';

// JSON dentro de <script>: que no pueda cerrar la etiqueta.
const scriptJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Pestañas comunes a la guía y al explorador.
export function docsNav(lang, current, labels) {
  const tab = (href, id, text) => `<a href="${href}"${id === current ? ' class="on" aria-current="page"' : ''}>${escapeHtml(text)}</a>`;
  return `<nav class="docs-tabs" lang="${lang}">${tab('/api/docs', 'guide', labels.guide)}${tab('/api/explorer', 'explorer', labels.explorer)}</nav>`;
}

export const NAV_STYLE = `
  .docs-tabs { position: sticky; top: 0; z-index: 5; display: flex; gap: 4px; padding: 8px 20px 0; background: #11151c; border-bottom: 1px solid #2c3442; }
  .docs-tabs a { padding: 8px 16px; color: #9aa5b8; text-decoration: none; border: 1px solid transparent; border-bottom: 0; border-radius: 6px 6px 0 0; font-weight: 600; }
  .docs-tabs a.on { color: #fff; background: #1a202a; border-color: #2c3442; margin-bottom: -1px; }
  .docs-tabs a:hover { color: #fff; }
`;

const STYLE = `
  :root { color-scheme: dark; --bg: #11151c; --panel: #1a202a; --line: #2c3442; --text: #d8dee9; --muted: #9aa5b8; --accent: #6cb6ff;
    --get: #2f9e6e; --post: #3b82d6; --put: #c58b1f; --patch: #9b59d0; --delete: #d0553f; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, sans-serif; }
  a { color: var(--accent); }
  code, pre, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  code { background: #1d2430; padding: .1em .35em; border-radius: 4px; font-size: .9em; }
  .layout { display: grid; grid-template-columns: 270px 1fr; max-width: 1280px; margin: 0 auto; }
  aside { position: sticky; top: 45px; align-self: start; height: calc(100vh - 45px); overflow-y: auto; padding: 16px 12px 40px; border-right: 1px solid var(--line); }
  aside input { width: 100%; padding: 7px 10px; border-radius: 6px; border: 1px solid var(--line); background: #0b0e13; color: var(--text); font: inherit; }
  aside h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin: 18px 4px 6px; }
  aside a { display: flex; gap: 8px; align-items: baseline; padding: 3px 4px; border-radius: 4px; color: var(--text); text-decoration: none; font-size: 13px; }
  aside a:hover { background: var(--panel); }
  aside a .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  main { padding: 20px 24px 80px; min-width: 0; }
  h1 { margin: 0 0 6px; color: #fff; font-size: 26px; }
  .intro { color: var(--muted); max-width: 80ch; }
  .setup { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: end; margin: 16px 0 8px; padding: 12px 14px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; }
  .setup label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px; }
  .setup input { width: 320px; max-width: 100%; }
  .setup .hint { font-size: 12px; color: var(--muted); margin-top: 3px; }
  input, textarea, select { padding: 6px 9px; border-radius: 6px; border: 1px solid var(--line); background: #0b0e13; color: var(--text); font: inherit; }
  textarea { width: 100%; min-height: 90px; font: 13px/1.45 ui-monospace, Menlo, Consolas, monospace; resize: vertical; }
  section.group > h2 { margin: 34px 0 4px; color: #fff; font-size: 20px; }
  section.group > p { margin: 0 0 12px; color: var(--muted); }
  details.op { border: 1px solid var(--line); border-left: 4px solid var(--m); border-radius: 8px; margin: 8px 0; background: var(--panel); }
  details.op > summary { display: flex; gap: 12px; align-items: center; padding: 9px 12px; cursor: pointer; list-style: none; }
  details.op > summary::-webkit-details-marker { display: none; }
  details.op[open] > summary { border-bottom: 1px solid var(--line); }
  .method { flex: none; min-width: 64px; text-align: center; padding: 2px 8px; border-radius: 4px; background: var(--m); color: #fff; font: 700 12px/1.6 ui-monospace, Menlo, monospace; }
  .path { font: 600 14px ui-monospace, Menlo, Consolas, monospace; color: #fff; word-break: break-all; }
  .summary { color: var(--muted); flex: 1; min-width: 0; }
  .lock { flex: none; font-size: 12px; color: #e3b341; border: 1px solid #6b5a23; border-radius: 999px; padding: 1px 8px; white-space: nowrap; }
  .m-GET { --m: var(--get); } .m-POST { --m: var(--post); } .m-PUT { --m: var(--put); } .m-PATCH { --m: var(--patch); } .m-DELETE { --m: var(--delete); }
  .body { padding: 12px 16px 16px; }
  .body h4 { margin: 16px 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { border-bottom: 1px solid var(--line); padding: 6px 8px; text-align: left; vertical-align: top; }
  th { color: var(--muted); font-weight: 600; font-size: 12px; }
  td input { width: 100%; min-width: 120px; }
  .req { color: #ef6b5b; font-size: 12px; }
  .where { color: var(--muted); font-size: 12px; }
  pre { margin: 0; background: #0b0e13; border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; overflow: auto; max-height: 360px; font-size: 13px; line-height: 1.45; }
  .tabs { display: flex; gap: 4px; margin-bottom: -1px; }
  .tabs button { background: none; color: var(--muted); border: 1px solid transparent; border-bottom: 0; border-radius: 6px 6px 0 0; padding: 4px 12px; cursor: pointer; font: inherit; font-size: 13px; }
  .tabs button.on { color: #fff; background: #0b0e13; border-color: var(--line); }
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 14px; }
  button.run { background: var(--m); color: #fff; border: 0; border-radius: 6px; padding: 7px 18px; font: 600 14px system-ui, sans-serif; cursor: pointer; }
  button.run:disabled { opacity: .6; cursor: default; }
  button.ghost { background: none; border: 1px solid var(--line); color: var(--text); border-radius: 6px; padding: 4px 10px; cursor: pointer; font: inherit; font-size: 13px; }
  .warn { color: #e3b341; font-size: 13px; }
  .status { font: 600 13px ui-monospace, Menlo, monospace; padding: 2px 8px; border-radius: 4px; }
  .status.ok { background: #173d2b; color: #6fdc9f; } .status.err { background: #4a1f1a; color: #ff9b8a; }
  .muted { color: var(--muted); font-size: 13px; }
  .codes td:first-child { width: 70px; font: 600 13px ui-monospace, Menlo, monospace; }
  [hidden] { display: none !important; }
  @media (max-width: 860px) {
    .layout { display: block; }
    aside { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); max-height: 40vh; }
    main { padding: 16px; }
    details.op > summary { flex-wrap: wrap; gap: 6px 10px; }
    .summary { flex-basis: 100%; }
  }
`;

// Lo que corre en el navegador. Recibe REF (la referencia en un idioma) y EXAMPLES.
function client() {
  const $ = (sel, root = document) => root.querySelector(sel);
  const h = (tag, attrs = {}, ...children) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v !== null && v !== undefined) el.setAttribute(k, v === true ? '' : v);
    }
    el.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
    return el;
  };
  const ui = REF.ui;
  const fmt = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  const TOKEN_KEY = 'smartcity.server.token';
  const store = {
    get: () => { try { return sessionStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; } },
    set: (v) => { try { sessionStorage.setItem(TOKEN_KEY, v); } catch { /* sin almacenamiento */ } },
  };
  const origin = location.origin;
  const slug = (e) => `${e.method}-${e.path}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
  const token = $('#token');
  token.value = store.get();

  // --- Llamada a partir de lo que hay en el formulario ---
  function request(e, form) {
    let path = e.path;
    const query = new URLSearchParams();
    for (const p of e.params) {
      const value = form.values[p.name]?.value.trim() ?? '';
      if (p.in === 'path') {
        if (!value) throw new Error(fmt(ui.missing, { name: p.name }));
        path = path.replace(`{${p.name}}`, encodeURIComponent(value));
      } else if (value) query.set(p.name, value);
    }
    let body = null;
    if (e.body) {
      try { body = JSON.parse(form.body.value); } catch { throw new Error(ui.invalidJson); }
    }
    return { url: `${origin}${path}${query.size ? `?${query}` : ''}`, body };
  }

  const py = (v, indent = 0) => {
    const pad = '    '.repeat(indent + 1);
    if (v === null) return 'None';
    if (v === true) return 'True';
    if (v === false) return 'False';
    if (Array.isArray(v)) return v.length ? `[${v.map((x) => py(x, indent)).join(', ')}]` : '[]';
    if (typeof v === 'object') {
      const entries = Object.entries(v);
      if (!entries.length) return '{}';
      return `{\n${entries.map(([k, x]) => `${pad}${JSON.stringify(k)}: ${py(x, indent + 1)}`).join(',\n')}\n${'    '.repeat(indent)}}`;
    }
    return JSON.stringify(v);
  };

  function snippets(e, form) {
    let req;
    try { req = request(e, form); } catch (err) { return { curl: err.message, python: err.message, javascript: err.message }; }
    const auth = e.auth;
    const json = req.body ? JSON.stringify(req.body) : '';
    const file = e.path.split('/').pop();
    const curl = [
      `curl${e.method === 'GET' ? '' : ` -X ${e.method}`} "${req.url}"`,
      auth ? '  -H "Authorization: Bearer $TOKEN"' : null,
      req.body ? '  -H "Content-Type: application/json"' : null,
      req.body ? `  -d '${json.replace(/'/g, "'\\''")}'` : null,
      e.csv ? `  -o ${file}` : null,
    ].filter(Boolean).join(' \\\n');
    const python = [
      'import requests',
      auth ? '\nTOKEN = "..."  # SMARTCITY_TOKEN' : '',
      `\nr = requests.${e.method.toLowerCase()}(`,
      `    "${req.url}",`,
      auth ? '    headers={"Authorization": f"Bearer {TOKEN}"},' : null,
      req.body ? `    json=${py(req.body, 1)},` : null,
      ')',
      'r.raise_for_status()',
      e.csv ? `open("${file}", "w", encoding="utf-8").write(r.text)\n# import pandas as pd; df = pd.read_csv("${file}")` : 'print(r.json())',
    ].filter((l) => l !== null).join('\n');
    const opts = [
      e.method !== 'GET' ? `method: "${e.method}"` : null,
      auth || req.body ? `headers: { ${[auth ? '"Authorization": `Bearer ${TOKEN}`' : null, req.body ? '"Content-Type": "application/json"' : null].filter(Boolean).join(', ')} }` : null,
      req.body ? `body: JSON.stringify(${JSON.stringify(req.body)})` : null,
    ].filter(Boolean);
    const javascript = [
      auth ? 'const TOKEN = "..."; // SMARTCITY_TOKEN' : null,
      `const r = await fetch("${req.url}"${opts.length ? `, {\n  ${opts.join(',\n  ')},\n}` : ''});`,
      e.csv ? 'const csv = await r.text();' : 'console.log(await r.json());',
    ].filter(Boolean).join('\n');
    return { curl, python, javascript };
  }

  // --- Una función de la API ---
  function operation(e) {
    const form = { values: {}, body: null };
    const codeBox = h('pre', { class: 'mono' });
    let lang = (() => { try { return localStorage.getItem('smartcity.explorer.code') || 'curl'; } catch { return 'curl'; } })();
    const tabs = h('div', { class: 'tabs' });
    const refresh = () => {
      const code = snippets(e, form);
      codeBox.textContent = code[lang];
      for (const b of tabs.children) b.classList.toggle('on', b.dataset.lang === lang);
    };
    for (const [id, label] of [['curl', 'curl'], ['python', 'Python'], ['javascript', 'JavaScript']]) {
      tabs.append(h('button', { type: 'button', 'data-lang': id, onclick: () => {
        lang = id;
        try { localStorage.setItem('smartcity.explorer.code', id); } catch { /* sin almacenamiento */ }
        for (const r of refreshers) r();
      } }, label));
    }
    refreshers.push(refresh);

    const parts = [];
    if (e.desc) parts.push(h('p', {}, e.desc));
    if (e.params.length) {
      parts.push(h('h4', {}, ui.params), h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, ui.name), h('th', {}, ui.description), h('th', {}, ''))),
        h('tbody', {}, e.params.map((p) => {
          const input = h('input', { type: 'text', value: p.example === '' ? '' : String(p.example), placeholder: p.type, oninput: refresh, 'aria-label': p.name });
          form.values[p.name] = input;
          return h('tr', {},
            h('td', {}, h('code', {}, p.name), ' ', p.in === 'path' || p.required ? h('span', { class: 'req' }, '*', ui.required) : null,
              h('div', { class: 'where' }, `${p.type} · ${p.in === 'path' ? ui.path : ui.query}`)),
            h('td', {}, p.desc),
            h('td', {}, input));
        }))));
    }
    if (e.body) {
      form.body = h('textarea', { spellcheck: 'false', oninput: refresh, 'aria-label': ui.body });
      form.body.value = JSON.stringify(e.body.example, null, 2);
      parts.push(h('h4', {}, ui.body), form.body);
      parts.push(h('h4', {}, ui.fields), h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, ui.name), h('th', {}, ui.type), h('th', {}, ui.description))),
        h('tbody', {}, e.body.fields.map((f) => h('tr', {},
          h('td', {}, h('code', {}, f.name), f.required ? h('span', { class: 'req' }, ' *') : null),
          h('td', { class: 'where' }, f.type),
          h('td', {}, f.desc))))));
    }
    parts.push(h('h4', {}, ui.responses), h('table', { class: 'codes' }, h('tbody', {},
      e.responses.map((r) => h('tr', {}, h('td', {}, String(r.status)), h('td', {}, r.desc))))));
    const example = EXAMPLES[e.id];
    if (example !== undefined) {
      parts.push(h('h4', {}, ui.example), h('pre', { class: 'mono' }, typeof example === 'string' ? example : JSON.stringify(example, null, 2)));
    }
    parts.push(h('h4', {}, ui.code), tabs, codeBox);

    const result = h('div', { hidden: true },
      h('h4', {}, ui.result), h('div', { class: 'row', style: 'margin:0 0 6px' }), h('pre', { class: 'mono' }));
    const run = h('button', { type: 'button', class: 'run', onclick: async () => {
      const [, meta, out] = result.children;
      result.hidden = false;
      meta.replaceChildren(h('span', { class: 'muted' }, ui.sending));
      out.textContent = '';
      run.disabled = true;
      const started = performance.now();
      try {
        const req = request(e, form);
        const headers = {};
        if (req.body) headers['Content-Type'] = 'application/json';
        if (e.auth && token.value.trim()) headers.Authorization = `Bearer ${token.value.trim()}`;
        const r = await fetch(req.url, { method: e.method, headers, body: req.body ? JSON.stringify(req.body) : undefined });
        const text = await r.text();
        const ms = Math.round(performance.now() - started);
        meta.replaceChildren(h('span', { class: `status ${r.ok ? 'ok' : 'err'}` }, `${r.status} ${r.statusText}`), h('span', { class: 'muted' }, `${ms} ms`));
        if (e.csv && r.ok) {
          const lines = text.split('\n');
          out.textContent = lines.slice(0, 25).join('\n') + (lines.length > 26 ? '\n…' : '');
          meta.append(h('span', { class: 'muted' }, ui.csvNote), h('a', { href: req.url, download: '' }, ui.download));
        } else {
          try { out.textContent = JSON.stringify(JSON.parse(text), null, 2); } catch { out.textContent = text.slice(0, 20000); }
        }
      } catch (err) {
        meta.replaceChildren(h('span', { class: 'status err' }, 'Error'));
        out.textContent = err instanceof TypeError ? fmt(ui.noAnswer, { message: err.message }) : err.message;
      } finally {
        run.disabled = false;
      }
    } }, ui.tryIt);
    parts.push(h('div', { class: 'row' }, run, e.method !== 'GET' ? h('span', { class: 'warn' }, ui.changes) : null), result);

    const details = h('details', { class: `op m-${e.method}`, id: slug(e) },
      h('summary', {}, h('span', { class: 'method' }, e.method), h('span', { class: 'path' }, e.path),
        h('span', { class: 'summary' }, e.summary), e.auth ? h('span', { class: 'lock', title: ui.needsToken }, `🔒 ${ui.needsToken}`) : null),
      h('div', { class: 'body' }, parts));
    details.addEventListener('toggle', () => {
      if (details.open) {
        refresh();
        history.replaceState(null, '', `#${details.id}`);
      }
    });
    return details;
  }

  const refreshers = [];
  const main = $('#ops');
  const nav = $('#index');
  const items = [];
  for (const g of REF.groups) {
    const list = REF.endpoints.filter((e) => e.group === g.id);
    const section = h('section', { class: 'group', id: `g-${g.id}` }, h('h2', {}, g.name), h('p', {}, g.desc), list.map(operation));
    main.append(section);
    const heading = h('h3', {}, g.name);
    nav.append(heading);
    for (const e of list) {
      const link = h('a', { href: `#${slug(e)}`, class: `m-${e.method}`, onclick: () => { document.getElementById(slug(e)).open = true; } },
        h('span', { class: 'method', style: 'min-width:52px;font-size:10px' }, e.method), h('span', { class: 'path' }, e.path.replace('/api', '')));
      nav.append(link);
      items.push({ e, link, heading, section });
    }
  }
  token.addEventListener('input', () => store.set(token.value.trim()));

  // Buscar por ruta, método o descripción.
  $('#filter').addEventListener('input', (ev) => {
    const q = ev.target.value.trim().toLowerCase();
    let any = false;
    for (const it of items) {
      const hit = !q || `${it.e.method} ${it.e.path} ${it.e.summary} ${it.e.desc}`.toLowerCase().includes(q);
      it.link.hidden = !hit;
      document.getElementById(slug(it.e)).hidden = !hit;
      any ||= hit;
    }
    for (const it of items) {
      it.heading.hidden = !items.some((x) => x.heading === it.heading && !x.link.hidden);
      it.section.hidden = it.heading.hidden;
    }
    $('#empty').hidden = any;
  });

  // Abrir la función del enlace (#get-api-state).
  const target = location.hash && document.getElementById(location.hash.slice(1));
  if (target?.tagName === 'DETAILS') {
    target.open = true;
    target.scrollIntoView();
  }
}

export function renderExplorerPage(lang = 'es', examples = {}) {
  const ref = apiReference(lang);
  const { ui } = ref;
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(ui.title)} · SmartCity</title><style>${NAV_STYLE}${STYLE}</style></head>
<body>
${docsNav(lang, 'explorer', ui)}
<div class="layout">
<aside><input id="filter" type="search" placeholder="${escapeHtml(ui.filter)}" aria-label="${escapeHtml(ui.filter)}"><div id="index"></div></aside>
<main>
  <h1>${escapeHtml(ui.title)}</h1>
  <p class="intro">${escapeHtml(ui.intro)}</p>
  <p class="intro">${escapeHtml(ui.points)}</p>
  <div class="setup">
    <div><label for="token">${escapeHtml(ui.token)}</label><input id="token" type="password" autocomplete="off" spellcheck="false">
      <div class="hint">${escapeHtml(ui.tokenHint)}</div></div>
    <div><a href="/api/openapi.json">${escapeHtml(ui.openapi)}</a></div>
  </div>
  <div id="ops"></div>
  <p id="empty" class="muted" hidden>${escapeHtml(ui.empty)}</p>
</main>
</div>
<script>
const REF = ${scriptJson(ref)};
const EXAMPLES = ${scriptJson(examples)};
(${client.toString()})();
</script>
</body></html>
`;
}
