const TIME_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;

export function normalizeBaseUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  // Una ruta como "/" se resuelve contra el origen de la página (visor y API tras el mismo proxy).
  const url = new URL(text, globalThis.location?.origin);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('La URL debe empezar por http:// o https://');
  return url.origin + url.pathname.replace(/\/+$/, '');
}

// El servidor trata `to` como límite exclusivo: para incluir el último día completo se usa el día siguiente.
export function nextDay(date) {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error('Fecha no válida');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class ApiClient {
  constructor({ baseUrl, token = '', fetchFn = globalThis.fetch.bind(globalThis), timeoutMs = 8000 }) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.token = token;
    this.fetchFn = fetchFn;
    this.timeoutMs = timeoutMs;
  }

  async request(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    const res = await this.fetchFn(this.baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, payload.error ?? `HTTP ${res.status}`);
    return payload;
  }

  state() {
    return this.request('/api/state');
  }

  cars() {
    return this.request('/api/cars');
  }

  setParams(params) {
    return this.request('/api/params', { method: 'PUT', body: params });
  }

  setSignalPlan(plan) {
    return this.request('/api/signals/plan', { method: 'PUT', body: { plan } });
  }

  addSensor(x, z, name = '') {
    return this.request('/api/sensors', { method: 'POST', body: { x, z, name } });
  }

  renameSensor(id, name) {
    return this.request(`/api/sensors/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name } });
  }

  removeSensor(id) {
    return this.request(`/api/sensors/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  setTrackedParkings(ids) {
    return this.request('/api/parking/tracked', { method: 'PUT', body: { ids } });
  }

  // URL de descarga directa: el navegador hace streaming del CSV sin cargarlo en memoria.
  csvUrl(kind, { from, to, id } = {}) {
    if (kind !== 'traffic' && kind !== 'parking') throw new Error('Tipo de CSV desconocido');
    const query = new URLSearchParams();
    for (const [key, value] of [['from', from], ['to', to]]) {
      if (!value) continue;
      if (!TIME_RE.test(value)) throw new Error(`${key} debe ser una fecha AAAA-MM-DD`);
      query.set(key, value);
    }
    if (id) query.set('id', id);
    const qs = query.toString();
    return `${this.baseUrl}/api/${kind}.csv${qs ? `?${qs}` : ''}`;
  }
}
