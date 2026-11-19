// Configuración del chatbot de una ciudad: un servicio aparte, en su propio puerto y con contraseña (usuario «profesor»).
// Habla con la ciudad por la red interna de Docker con la clave CHAT_ADMIN_KEY; la ciudad guarda la configuración y es
// la que llama al modelo. Sin dependencias: solo Node.
//   CHAT_ADMIN_PASSWORD  contraseña de esta página (obligatoria)
//   CHAT_ADMIN_KEY       la misma clave que en la ciudad (obligatoria)
//   SIM_URL              dirección de la ciudad (por defecto http://sim:8080)
//   PORT                 puerto (por defecto 8095)
import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(here, 'index.html'), 'utf8');
const digest = (s) => createHash('sha256').update(s).digest();

// Rutas de esta página -> rutas de la ciudad.
const ROUTES = {
  'GET /config': ['GET', '/api/chat/config'],
  'PUT /config': ['PUT', '/api/chat/config'],
  'POST /test': ['POST', '/api/chat/test'],
  'POST /models': ['POST', '/api/chat/models'],
  'POST /pull': ['POST', '/api/chat/pull'],
};

export function createAdmin({ password, adminKey, simUrl = 'http://sim:8080', fetchImpl = fetch }) {
  const passwordHash = digest(password);
  const authorized = (req) => {
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

  return async (req, res) => {
    if (!authorized(req)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Chatbot SmartCity", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Hace falta la contraseña (usuario: profesor)');
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
    if (!route) return json(res, 404, { error: 'No encontrado' });
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const [method, target] = route;
    try {
      // Descargar un modelo puede tardar mucho; lo demás, poco.
      const timeout = url.pathname === '/pull' ? 3_600_000 : 620_000;
      const r = await fetchImpl(simUrl.replace(/\/$/, '') + target, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Chat-Admin-Key': adminKey },
        body: method === 'GET' ? undefined : Buffer.concat(chunks),
        signal: AbortSignal.timeout(timeout),
      });
      const text = await r.text();
      if (r.status === 404 && url.pathname === '/config') {
        return json(res, 502, { error: 'La ciudad no acepta la clave: pon la misma CHAT_ADMIN_KEY en la ciudad y en este servicio' });
      }
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(text);
    } catch (err) {
      json(res, 502, { error: `No se puede conectar con la ciudad (${simUrl}): ${err.cause?.code ?? err.message}` });
    }
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const env = process.env;
  for (const name of ['CHAT_ADMIN_PASSWORD', 'CHAT_ADMIN_KEY']) {
    if (!env[name]) {
      console.error(`Define ${name}: sin ella no se puede configurar el chatbot.`);
      process.exit(1);
    }
  }
  const port = Number(env.PORT ?? 8095);
  const simUrl = env.SIM_URL ?? 'http://sim:8080';
  http.createServer(createAdmin({ password: env.CHAT_ADMIN_PASSWORD, adminKey: env.CHAT_ADMIN_KEY, simUrl }))
    .listen(port, () => console.log(`Configuración del chatbot en http://localhost:${port} (ciudad: ${simUrl})`));
}
