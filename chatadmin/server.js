// Configuración del chatbot de una ciudad: un servicio aparte, en su propio puerto, que los alumnos arrancan donde
// quieran (junto a su sistema, en su equipo...). Habla con su ciudad con su token, como cualquier cambio; la ciudad
// guarda la configuración y es la que llama al motor. Sin dependencias: solo Node.
//   SMARTCITY_URL        dirección de la ciudad (por defecto http://sim:8080, la del docker-compose de la ciudad)
//   SMARTCITY_TOKEN      token de la ciudad (si la ciudad tiene token)
//   CHAT_ADMIN_PASSWORD  contraseña de esta página (opcional; usuario «admin»)
//   PORT                 puerto (por defecto 8095)
// La página sale en el idioma de la ciudad (SMARTCITY_LANG de la ciudad): traducciones en i18n.json.
import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const I18N = readFileSync(path.join(here, 'i18n.json'), 'utf8');
const PAGE = readFileSync(path.join(here, 'index.html'), 'utf8').replace('/*I18N*/{}', () => I18N);
const digest = (s) => createHash('sha256').update(s).digest();

// Rutas de esta página -> rutas de la ciudad.
const ROUTES = {
  'GET /config': ['GET', '/api/chat/config'],
  'PUT /config': ['PUT', '/api/chat/config'],
  'POST /test': ['POST', '/api/chat/test'],
  'POST /models': ['POST', '/api/chat/models'],
  'POST /pull': ['POST', '/api/chat/pull'],
};

export function createAdmin({ password = '', token = '', simUrl = 'http://sim:8080', fetchImpl = fetch }) {
  const passwordHash = password ? digest(password) : null;
  const authorized = (req) => {
    if (!passwordHash) return true;
    const match = /^Basic (.+)$/.exec(req.headers.authorization ?? '');
    if (!match) return false;
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const given = decoded.slice(decoded.indexOf(':') + 1);
    return timingSafeEqual(digest(given), passwordHash);
  };
  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  // Error con su texto en castellano y la clave para que la página lo traduzca al idioma de la ciudad.
  const fail = (res, status, key, vars = {}) => json(res, status, {
    error: key.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)), i18n: { key, vars },
  });

  return async (req, res) => {
    if (!authorized(req)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Chatbot SmartCity", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Hace falta la contraseña · Pasahitza behar da · Password required (admin)');
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" });
      res.end(PAGE);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });
    const route = ROUTES[`${req.method} ${url.pathname}`];
    if (!route) return fail(res, 404, 'No encontrado');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const [method, target] = route;
    try {
      // Descargar un modelo puede tardar mucho; lo demás, poco.
      const timeout = url.pathname === '/pull' ? 3_600_000 : 620_000;
      const r = await fetchImpl(simUrl.replace(/\/$/, '') + target, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: method === 'GET' ? undefined : Buffer.concat(chunks),
        signal: AbortSignal.timeout(timeout),
      });
      const text = await r.text();
      if (r.status === 401) return fail(res, 502, 'La ciudad no acepta el token: revisa SMARTCITY_TOKEN');
      if (r.status === 404 && url.pathname === '/config') {
        return fail(res, 502, '{url} no tiene chatbot: ¿es la dirección de la ciudad (sin /api) y está actualizada?', { url: simUrl });
      }
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(text);
    } catch (err) {
      fail(res, 502, 'No se puede conectar con la ciudad ({url}): {cause}', { url: simUrl, cause: err.cause?.code ?? err.message });
    }
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const env = process.env;
  const port = Number(env.PORT ?? 8095);
  const simUrl = env.SMARTCITY_URL || 'http://sim:8080';
  if (!env.CHAT_ADMIN_PASSWORD) console.log('CHAT_ADMIN_PASSWORD no definido: cualquiera que llegue a este puerto puede configurar el chatbot');
  http.createServer(createAdmin({ password: env.CHAT_ADMIN_PASSWORD ?? '', token: env.SMARTCITY_TOKEN ?? '', simUrl }))
    .listen(port, () => console.log(`Configuración del chatbot en http://localhost:${port} (ciudad: ${simUrl})`));
}
