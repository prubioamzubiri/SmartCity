import { CONFIG } from '../config.js';
import { ApiClient } from './client.js';

// Única fuente de verdad del visor: consulta el estado del servidor y extrapola su reloj entre consultas.
export class ServerSync {
  constructor({ now = () => performance.now(), createClient = (options) => new ApiClient(options) } = {}) {
    this.now = now;
    this.createClient = createClient;
    this.client = null;
    this.state = null;
    this.receivedAt = 0;
    this.timers = [];
    this.busy = new Set();
    this.listeners = { state: new Set(), cars: new Set(), error: new Set(), disconnect: new Set() };
  }

  on(event, fn) {
    this.listeners[event].add(fn);
  }

  emit(event, arg) {
    this.listeners[event].forEach((fn) => fn(arg));
  }

  connect(baseUrl, token = '') {
    this.disconnect();
    const client = this.createClient({ baseUrl, token });
    if (!client.baseUrl) throw new Error('Introduce la URL del servidor');
    this.client = client;
    this.poll('state', () => client.state(), (s) => this.receive(s));
    this.poll('cars', () => client.cars(), (c) => this.emit('cars', c));
    this.timers = [
      setInterval(() => this.poll('state', () => client.state(), (s) => this.receive(s)), CONFIG.server.pollSeconds * 1000),
      setInterval(() => this.poll('cars', () => client.cars(), (c) => this.emit('cars', c)), CONFIG.server.carsSeconds * 1000),
    ];
  }

  disconnect() {
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.client = null;
    this.state = null;
    this.emit('disconnect');
  }

  receive(state) {
    this.state = state;
    this.receivedAt = this.now();
    this.emit('state', state);
  }

  // Hora simulada del servidor ahora mismo; null si no hay conexión.
  simTime() {
    const s = this.state;
    if (!s) return null;
    if (!s.caughtUp) return s.simSeconds; // recuperando: el reloj real del servidor va por delante
    return s.simSeconds + ((this.now() - this.receivedAt) / 1000) * s.scale;
  }

  async poll(name, fetcher, onData) {
    if (this.busy.has(name)) return;
    const client = this.client;
    this.busy.add(name);
    try {
      const data = await fetcher();
      if (this.client === client) onData(data);
    } catch (err) {
      if (this.client === client) this.emit('error', err);
    } finally {
      this.busy.delete(name);
    }
  }

  // Ejecuta un cambio en el servidor y vuelve a leer su estado (también si falla, para no mostrar un valor falso).
  async act(fn) {
    const client = this.client;
    if (!client) throw new Error('Sin conexión con el servidor');
    try {
      return await fn(client);
    } finally {
      await this.poll('state', () => client.state(), (s) => this.receive(s));
    }
  }
}
