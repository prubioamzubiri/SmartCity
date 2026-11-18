import { CONFIG } from '../config.js';
import { demandFactor } from '../traffic/demand.js';

// Parkings subterráneos con estado: coches que llegan, se quedan un rato y se van. Cada parking tiene un precio (€/h)
// que fija el gestor. Quien va a aparcar elige entre los parkings de su zona (a menos de `nearMeters`) según el
// precio: uno más caro que sus vecinos desvía coches hacia ellos y uno más barato los atrae. Si el elegido está
// lleno, prueba en los de alrededor; si no encuentra sitio, se queda dando vueltas buscando (más tráfico).
// La tarifa de cada parking (un precio y, si se quiere, franjas horarias con otro precio) solo cambia a las 0:00: el
// gestor programa la de mañana, así que hay que preverla (día de la semana, eventos, tiempo).
// Es un modelo determinista por minutos (como las bicis): se reproduce igual tras reiniciar.
const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

export class ParkingLots {
  constructor(lots, { getParams, attractorsAt = () => [] } = {}) {
    const P = CONFIG.parking;
    this.getParams = getParams ?? (() => ({ scenario: CONFIG.traffic.scenario }));
    this.attractorsAt = attractorsAt;
    this.lots = lots.map((l) => ({ id: l.id, name: l.name, x: l.x, z: l.z, capacity: l.capacity, bias: l.bias }));
    this.index = new Map(this.lots.map((l, i) => [l.id, i]));
    const n = this.lots.length;
    this.price = new Float64Array(n).fill(P.basePrice); // precio de ahora (según la tarifa del día y la hora)
    this.tariff = this.lots.map(() => ({ price: P.basePrice, schedule: [] })); // tarifa de hoy
    this.next = new Map(); // id -> tarifa programada para mañana
    this.day = null;
    this.regular = new Float64Array(n); // coches de siempre (se van al cabo de `staySeconds` de media)
    this.event = new Float64Array(n); // coches de un evento (se van cuando termina)
    this.searching = 0; // coches dando vueltas porque no encuentran sitio
    this.turnedAway = 0; // coches que no han encontrado sitio desde el último registro
    // Vecinos de cada parking (incluido él mismo): entre ellos se reparte quien quiere aparcar en la zona.
    this.near = this.lots.map((a) => this.lots.map((b, j) => [j, Math.hypot(a.x - b.x, a.z - b.z)]).filter(([, d]) => d <= P.nearMeters).map(([j]) => j));
    this.nextStep = null;
  }

  // Programa la tarifa de mañana (se aplica a las 0:00 y sigue hasta que se cambie): `price` (null = la de por defecto)
  // y, opcionalmente, franjas `schedule` [{ from: '17:00', to: '22:00', price }] con otro precio. Devuelve la tarifa.
  setPrice(id, price, schedule = []) {
    const P = CONFIG.parking;
    const i = this.index.get(id);
    if (i === undefined) throw new Error(`Parking desconocido: ${id}`);
    const check = (p) => {
      if (!Number.isFinite(p) || p < P.minPrice || p > P.maxPrice) throw new Error(`El precio debe estar entre ${P.minPrice} y ${P.maxPrice} €/h`);
      return Math.round(p * 100) / 100;
    };
    const hour = (text) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? ''));
      const h = m ? Number(m[1]) + Number(m[2]) / 60 : NaN;
      if (!(h >= 0 && h <= 24)) throw new Error(`Hora no válida: ${text} (formato HH:MM)`);
      return h;
    };
    if (!Array.isArray(schedule) || schedule.length > P.maxBands) throw new Error(`schedule debe ser una lista de como mucho ${P.maxBands} franjas`);
    const tariff = {
      price: check(price === null || price === undefined ? P.basePrice : price),
      schedule: schedule.map((b) => {
        const from = hour(b.from);
        const to = hour(b.to);
        if (!(to > from)) throw new Error('Cada franja debe acabar después de empezar (el mismo día)');
        return { from, to, price: check(b.price) };
      }),
    };
    this.next.set(id, tariff);
    return tariff;
  }

  // Tarifa programada para mañana (o null) y la de hoy, para el API.
  tariffOf(id) {
    const i = this.index.get(id);
    const show = (t) => t && { price: t.price, schedule: t.schedule.map((b) => ({ from: hhmm(b.from), to: hhmm(b.to), price: b.price })) };
    return { today: show(this.tariff[i]), tomorrow: show(this.next.get(id) ?? null) };
  }

  // Precio de cada parking a la hora `time` según su tarifa (y, al cambiar de día, aplica las programadas).
  applyTariffs(time) {
    const day = Math.floor(time / 86400);
    if (this.day !== null && day !== this.day) {
      for (const [id, t] of this.next) this.tariff[this.index.get(id)] = t;
      this.next.clear();
    }
    this.day = day;
    const h = (time - day * 86400) / 3600;
    this.tariff.forEach((t, i) => {
      const band = t.schedule.find((b) => h >= b.from && h < b.to);
      this.price[i] = band ? band.price : t.price;
    });
  }

  // Cuánto más caros están los parkings que el precio base, de media por plaza (0 = todos al precio base o más baratos;
  // 1 = el doble).
  pricePremium() {
    const P = CONFIG.parking;
    let sum = 0;
    let cap = 0;
    this.lots.forEach((l, i) => {
      sum += l.capacity * Math.max(0, this.price[i] / P.basePrice - 1);
      cap += l.capacity;
    });
    return cap ? sum / cap : 0;
  }

  occupied(i) {
    return this.regular[i] + this.event[i];
  }

  occupancy(id) {
    const i = this.index.get(id);
    return i === undefined ? 0 : Math.min(1, this.occupied(i) / this.lots[i].capacity);
  }

  // Al arrancar una ciudad nueva: la ocupación de equilibrio de esa hora (sin esperar horas a que se llene).
  warm(time) {
    const P = CONFIG.parking;
    const demand = demandFactor(time, this.getParams().scenario);
    this.lots.forEach((l, i) => (this.regular[i] = Math.min(l.capacity, l.capacity * P.arrivalsPerHour * (P.staySeconds / 3600) * demand * l.bias)));
  }

  tick(time) {
    const P = CONFIG.parking;
    if (this.nextStep === null) {
      this.applyTariffs(time);
      this.warm(time);
      this.nextStep = Math.ceil(time / P.stepSeconds) * P.stepSeconds;
    }
    while (time >= this.nextStep) {
      this.step(this.nextStep);
      this.nextStep += P.stepSeconds;
    }
  }

  step(time) {
    const P = CONFIG.parking;
    this.applyTariffs(time);
    const dt = P.stepSeconds;
    const n = this.lots.length;
    const demand = demandFactor(time, this.getParams().scenario);
    // Salidas: los de siempre se van poco a poco; los del evento, al terminar.
    const leave = 1 - Math.exp(-dt / P.staySeconds);
    const events = this.attractorsAt(time);
    const leaving = events.some((a) => a.phase === 'leave');
    const eventLeave = leaving ? 1 - Math.exp(-dt / P.eventLeaveSeconds) : events.length ? 0 : 1 - Math.exp(-dt / P.eventLeaveSeconds);
    for (let i = 0; i < n; i++) {
      this.regular[i] -= this.regular[i] * leave;
      this.event[i] -= this.event[i] * eventLeave;
    }
    // Quien quiere aparcar en la zona de cada parking (antes de elegir): la demanda de la ciudad y los eventos cercanos.
    const want = new Float64Array(n);
    const fromEvent = new Float64Array(n);
    this.lots.forEach((l, i) => {
      want[i] = (l.capacity * P.arrivalsPerHour * demand * l.bias * dt) / 3600;
      for (const a of events) {
        if (a.phase !== 'arrive') continue;
        const d = Math.hypot(l.x - a.x, l.z - a.z);
        if (d <= P.eventMeters) fromEvent[i] += (P.eventCarsPerBoost * a.weight * dt) / 3600 / Math.max(1, this.lotsNear(a.x, a.z));
      }
    });
    // Elección por precio entre los vecinos: cada uno pesa exp(−sensibilidad × (precio / precio base − 1)); el propio
    // parking cuenta el doble (la gente prefiere el más cercano a su destino).
    const arrive = new Float64Array(n);
    const arriveEvent = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      if (!want[j] && !fromEvent[j]) continue;
      let total = 0;
      for (const k of this.near[j]) total += this.appeal(j, k);
      for (const k of this.near[j]) {
        const share = this.appeal(j, k) / total;
        arrive[k] += want[j] * share;
        arriveEvent[k] += fromEvent[j] * share;
      }
    }
    // Entrar si hay sitio; si no, probar en los vecinos con sitio; quien no encuentra, se queda buscando.
    let overflow = 0;
    const spill = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const free = Math.max(0, this.lots[i].capacity - this.occupied(i));
      const total = arrive[i] + arriveEvent[i];
      const fit = Math.min(free, total);
      const f = total > 0 ? fit / total : 0;
      this.regular[i] += arrive[i] * f;
      this.event[i] += arriveEvent[i] * f;
      spill[i] = total - fit;
    }
    for (let i = 0; i < n; i++) {
      if (!spill[i]) continue;
      // Parte de los que no caben se pone a dar vueltas sin más; el resto prueba en los parkings de alrededor.
      overflow += spill[i] * (1 - P.spillShare);
      let left = spill[i] * P.spillShare;
      for (const k of this.near[i]) {
        if (k === i || left <= 0) continue;
        const free = Math.max(0, this.lots[k].capacity - this.occupied(k));
        const fit = Math.min(free, left);
        this.regular[k] += fit;
        left -= fit;
      }
      overflow += left;
    }
    // Los que buscan sitio dan vueltas unos minutos y acaban aparcando en la calle o yéndose.
    this.searching = this.searching * Math.exp(-dt / P.searchSeconds) + overflow;
    this.turnedAway += overflow;
  }

  appeal(from, to) {
    const P = CONFIG.parking;
    const own = from === to ? 2 : 1;
    return own * Math.exp(-P.priceSensitivity * (this.price[to] / P.basePrice - 1));
  }

  lotsNear(x, z) {
    let n = 0;
    for (const l of this.lots) if (Math.hypot(l.x - x, l.z - z) <= CONFIG.parking.eventMeters) n++;
    return n;
  }

  // Parkings llenos (≥ 95 %) ahora.
  fullCount() {
    let full = 0;
    for (let i = 0; i < this.lots.length; i++) if (this.occupied(i) >= 0.95 * this.lots[i].capacity) full++;
    return full;
  }

  state() {
    return this.lots.map((l, i) => ({ id: l.id, price: this.price[i], ...this.tariffOf(l.id), occupied: Math.round(this.occupied(i)), occupancy: Math.round(Math.min(1, this.occupied(i) / l.capacity) * 1000) / 1000 }));
  }

  serialize() {
    return {
      nextStep: this.nextStep,
      searching: this.searching,
      day: this.day,
      lots: this.lots.map((l, i) => [l.id, this.regular[i], this.event[i], this.price[i], this.tariff[i], this.next.get(l.id) ?? null]),
    };
  }

  restore(state) {
    if (!state) return;
    this.nextStep = state.nextStep ?? null;
    this.searching = state.searching ?? 0;
    this.day = state.day ?? null;
    this.next.clear();
    for (const [id, regular, event, price, tariff, next] of state.lots ?? []) {
      const i = this.index.get(id);
      if (i === undefined) continue;
      this.regular[i] = regular;
      this.event[i] = event;
      this.price[i] = price;
      if (tariff) this.tariff[i] = tariff;
      if (next) this.next.set(id, next);
    }
  }
}
