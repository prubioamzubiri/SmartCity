// Chatbot de la ciudad. Empieza escondido y sin «cerebro»: hasta que los alumnos lo activan no aparece en el visor, y con
// el motor `none` responde siempre «No sé». Lo configuran con el token de su ciudad, desde la página chat-admin (otro
// contenedor, en otro puerto, donde ellos quieran) o desde su programa. La ciudad hace las llamadas al motor (Ollama, una
// API compatible con OpenAI o un servicio propio de los alumnos), así que los navegadores no necesitan llegar a él.
// La configuración se guarda en la base de datos de la ciudad. El nombre y las instrucciones por defecto siguen el idioma
// del servicio (SMARTCITY_LANG): solo se guarda lo que los alumnos cambian, así que al cambiar de idioma cambian también.
import { t } from '../src/i18n/index.js';

// «No sé» en el idioma del servicio.
export const noSe = () => t('No sé');
export const PROVIDERS = ['none', 'ollama', 'openai', 'custom'];

// Configuración por defecto, en el idioma del servicio.
export const defaultChat = () => ({
  enabled: false,
  title: t('Asistente'),
  provider: 'none',
  // Ollama del docker-compose (perfil ollama); para OpenAI, p. ej. https://api.openai.com; para un servicio propio, la URL
  // completa a la que la ciudad envía cada pregunta.
  url: 'http://ollama:11434',
  model: '',
  apiKey: '',
  systemPrompt: t('Eres el asistente de la ciudad de Donostia en el simulador SmartCity. Responde en español, breve y claro. Si no sabes algo, di que no lo sabes.'),
  includeState: false, // añadir al principio un resumen del estado actual de la ciudad
  temperature: 0.3,
  maxTokens: 512,
  timeoutSeconds: 60,
});
const FIELDS = defaultChat(); // nombres y tipos de los campos

const LIMITS = { messages: 20, chars: 2000, perMinute: 10 };

export class ChatError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Comprueba y completa una configuración (lanza ChatError 400 si algo no vale).
export function checkChatConfig(input, current = defaultChat()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ChatError(400, t('La configuración debe ser un objeto'));
  const out = { ...current };
  for (const [k, v] of Object.entries(input)) {
    if (!(k in FIELDS)) throw new ChatError(400, t('Campo desconocido: {k}', { k }));
    if (k === 'apiKey' && v === null) {
      out.apiKey = current.apiKey; // null = conservar la clave guardada (la página de configuración no la recibe)
      continue;
    }
    const type = typeof FIELDS[k];
    if (typeof v !== type) throw new ChatError(400, type === 'string' ? t('{k} debe ser texto', { k }) : type === 'boolean' ? t('{k} debe ser true o false', { k }) : t('{k} debe ser un número', { k }));
    out[k] = v;
  }
  if (!PROVIDERS.includes(out.provider)) throw new ChatError(400, t('provider debe ser uno de: {list}', { list: PROVIDERS.join(', ') }));
  if (out.provider !== 'none') {
    let url;
    try {
      url = new URL(out.url);
    } catch {
      throw new ChatError(400, t('url no es una dirección válida'));
    }
    if (!['http:', 'https:'].includes(url.protocol)) throw new ChatError(400, t('url debe empezar por http:// o https://'));
  }
  if (out.title.length > 40 || out.systemPrompt.length > 8000 || out.model.length > 200) throw new ChatError(400, t('Texto demasiado largo'));
  if (!(out.temperature >= 0 && out.temperature <= 2)) throw new ChatError(400, t('temperature debe estar entre 0 y 2'));
  if (!(Number.isInteger(out.maxTokens) && out.maxTokens >= 16 && out.maxTokens <= 8192)) throw new ChatError(400, t('maxTokens debe ser un entero de 16 a 8192'));
  if (!(out.timeoutSeconds >= 5 && out.timeoutSeconds <= 600)) throw new ChatError(400, t('timeoutSeconds debe estar entre 5 y 600'));
  return out;
}

// Conversación de un alumno: [{ role: 'user' | 'assistant', content }], la última del usuario.
export function checkMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) throw new ChatError(400, t('messages debe ser una lista con al menos un mensaje'));
  const recent = messages.slice(-LIMITS.messages);
  for (const m of recent) {
    if (!m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string') {
      throw new ChatError(400, t('Cada mensaje es {format}', { format: '{ role: "user" | "assistant", content: "…" }' }));
    }
    if (m.content.length > LIMITS.chars) throw new ChatError(400, t('Cada mensaje puede tener como mucho {n} caracteres', { n: LIMITS.chars }));
  }
  if (recent[recent.length - 1].role !== 'user') throw new ChatError(400, t('El último mensaje debe ser del usuario'));
  return recent.map((m) => ({ role: m.role, content: m.content }));
}

const trimUrl = (url) => url.replace(/\/+$/, '');

async function post(url, body, { headers = {}, timeoutSeconds, fetchImpl }) {
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
    });
  } catch (err) {
    throw new ChatError(502, err.name === 'TimeoutError' ? t('El modelo tarda demasiado en responder') : t('No se puede conectar con el modelo ({cause})', { cause: err.cause?.code ?? err.message }));
  }
  const text = await res.text();
  if (!res.ok) throw new ChatError(502, t('El modelo respondió {status}: {text}', { status: res.status, text: text.slice(0, 300) }));
  try {
    return JSON.parse(text);
  } catch {
    throw new ChatError(502, t('El modelo no devolvió JSON'));
  }
}

async function getJson(url, { headers = {}, timeoutSeconds = 15, fetchImpl }) {
  let res;
  try {
    res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutSeconds * 1000) });
  } catch (err) {
    throw new ChatError(502, t('No se puede conectar con {url} ({cause})', { url, cause: err.cause?.code ?? err.message }));
  }
  if (!res.ok) throw new ChatError(502, t('{url} respondió {status}', { url, status: res.status }));
  return res.json();
}

export class Chat {
  // `store`: donde se guarda la configuración (meta «chat»); `summary()`: resumen de la ciudad para el modelo.
  constructor({ store, summary = () => '', fetchImpl = fetch, now = Date.now } = {}) {
    this.store = store;
    this.summary = summary;
    this.fetch = fetchImpl;
    this.now = now;
    this.saved = store?.getMeta('chat') ?? {}; // solo lo que difiere de lo por defecto
    this.calls = new Map(); // cliente -> instantes de sus últimas preguntas (límite por minuto)
  }

  // Configuración en uso: la guardada sobre la por defecto (que sigue el idioma del servicio).
  get config() {
    return { ...defaultChat(), ...this.saved };
  }

  // Lo que puede ver cualquiera (el visor): si está activo y su título.
  publicState() {
    return { enabled: this.config.enabled, title: this.config.title };
  }

  // Configuración para la página de administración (sin la clave de la API).
  adminView() {
    const { apiKey, ...rest } = this.config;
    return { ...rest, hasApiKey: Boolean(apiKey) };
  }

  update(input) {
    const config = checkChatConfig(input, this.config);
    // Solo lo que difiere de lo por defecto: así el nombre y las instrucciones siguen el idioma del servicio.
    const defaults = defaultChat();
    this.saved = Object.fromEntries(Object.entries(config).filter(([k, v]) => v !== defaults[k]));
    this.store?.setMeta('chat', this.saved);
    return this.adminView();
  }

  // Límite de preguntas por minuto y cliente (lanza 429).
  throttle(client) {
    const now = this.now();
    const recent = (this.calls.get(client) ?? []).filter((x) => now - x < 60_000);
    if (recent.length >= LIMITS.perMinute) throw new ChatError(429, t('Demasiadas preguntas seguidas: espera un poco'));
    recent.push(now);
    this.calls.set(client, recent);
    if (this.calls.size > 5000) this.calls.clear();
  }

  // Respuesta del chatbot a una conversación. `test`: desde la administración, aunque esté desactivado.
  async ask(messages, { client = '', test = false, config = this.config } = {}) {
    if (!config.enabled && !test) throw new ChatError(404, t('No encontrado'));
    if (!test) this.throttle(client);
    const conversation = checkMessages(messages);
    if (config.provider === 'none') return { reply: noSe() };
    const system = [config.systemPrompt, config.includeState ? `${t('Estado actual de la ciudad:')}\n${this.summary()}` : ''].filter(Boolean).join('\n\n');
    const full = [...(system ? [{ role: 'system', content: system }] : []), ...conversation];
    const base = trimUrl(config.url);
    const opts = { timeoutSeconds: config.timeoutSeconds, fetchImpl: this.fetch };
    if (config.provider === 'ollama') {
      const out = await post(`${base}/api/chat`, {
        model: config.model, messages: full, stream: false,
        options: { temperature: config.temperature, num_predict: config.maxTokens },
      }, opts);
      const reply = out?.message?.content;
      if (typeof reply !== 'string') throw new ChatError(502, t('Respuesta de Ollama sin mensaje'));
      return { reply: reply.trim() || noSe() };
    }
    if (config.provider === 'custom') {
      // Servicio propio: recibe { messages, instructions, city } y responde { reply }.
      const out = await post(config.url, {
        messages: conversation, instructions: config.systemPrompt, city: config.includeState ? this.summary() : null,
      }, { ...opts, headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {} });
      const reply = out?.reply;
      if (typeof reply !== 'string') throw new ChatError(502, t('El servicio debe responder {format}', { format: '{ "reply": "…" }' }));
      return { reply: reply.trim() || noSe() };
    }
    const out = await post(`${base}/v1/chat/completions`, {
      model: config.model, messages: full, temperature: config.temperature, max_tokens: config.maxTokens,
    }, { ...opts, headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {} });
    const reply = out?.choices?.[0]?.message?.content;
    if (typeof reply !== 'string') throw new ChatError(502, t('Respuesta del modelo sin mensaje'));
    return { reply: reply.trim() || noSe() };
  }

  // Modelos disponibles en el motor configurado (o en el que se está probando).
  async models(input = {}) {
    const config = checkChatConfig({ ...input }, this.config);
    if (config.provider === 'none' || config.provider === 'custom') return { models: [] };
    const base = trimUrl(config.url);
    if (config.provider === 'ollama') {
      const out = await getJson(`${base}/api/tags`, { fetchImpl: this.fetch });
      return { models: (out.models ?? []).map((m) => m.name) };
    }
    const out = await getJson(`${base}/v1/models`, { fetchImpl: this.fetch, headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {} });
    return { models: (out.data ?? []).map((m) => m.id) };
  }

  // Descarga un modelo en Ollama (puede tardar minutos).
  async pull(model, input = {}) {
    const config = checkChatConfig({ ...input }, this.config);
    if (config.provider !== 'ollama') throw new ChatError(400, t('Solo se pueden descargar modelos en Ollama'));
    if (typeof model !== 'string' || !model.trim()) throw new ChatError(400, t('Indica el modelo, p. ej. llama3.2'));
    const out = await post(`${trimUrl(config.url)}/api/pull`, { model: model.trim(), stream: false }, { timeoutSeconds: 3600, fetchImpl: this.fetch });
    return { status: out.status ?? 'success' };
  }
}
