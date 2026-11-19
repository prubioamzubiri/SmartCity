// Datos con fallos, como los de sensores reales: de vez en cuando falta un dato, falta una coordenada del sensor, falta
// una fila entera (el sensor no envió nada) o el dato es imposible (-47 pasajeros, 15230 personas esperando, -5 bicis).
// Los fallos solo se aplican a lo que sale del servidor (CSV y API en vivo); lo que se guarda y la simulación no cambian.
// Son deterministas: dependen de la semilla de la ciudad, del sensor, del instante y del dato, así que descargar dos
// veces lo mismo da lo mismo (también tras reiniciar el servidor).
import { CONFIG } from '../src/config.js';

// Columnas medidas de cada histórico (las que pueden fallar) y la que identifica al sensor de cada fila.
const CSV_FIELDS = {
  traffic: { id: 'sensor_id', coords: true, values: ['count', 'count_fwd', 'count_bwd', 'avg_speed_kmh'] },
  pedestrians: { id: 'sensor_id', coords: true, values: ['count', 'count_walk', 'count_cross', 'present'] },
  buses: { id: 'line_id', values: ['buses', 'passengers', 'occupancy_pct', 'full_buses', 'waiting', 'left_behind', 'unserved'] },
  bikes: { id: 'station_id', coords: true, values: ['bikes', 'free_docks', 'takes', 'returns', 'occupancy_pct'] },
  parking: { id: 'parking_id', values: ['occupied', 'free', 'occupancy_pct'] },
  city: {
    id: null,
    values: [
      'cars', 'stopped', 'avg_speed_kmh', 'buses', 'bus_passengers', 'full_buses', 'bus_waiting', 'bikes_in_use',
      'stations_empty', 'stations_full', 'parkings_full', 'trips_done', 'trip_min', 'delay_min', 'trips_lost',
      'bus_unserved', 'bus_demand', 'ped_wait_s', 'ped_waiting', 'ped_space', 'parking_search',
    ],
  },
  weather: { id: null, time: 'time', values: ['temperature_c', 'rain_mm_h', 'cloud_pct'] },
};

// Campos medidos de la API en vivo (en cualquier parte de la respuesta). No fallan los ajustes del gestor (flota,
// anclajes, precios, cortes...) ni lo que no es una medida (capacidad, identificadores, posiciones de los coches).
const LIVE_FIELDS = new Set([
  'active', 'passengers', 'full', 'waiting', 'leftBehind', 'unserved', 'available', 'inUse', 'occupancy', 'occupied',
  'current', 'total', 'expected', 'present', 'count', 'stopped', 'avgKmh', 'ew', 'ns',
]);
// Listas de sensores cuyas coordenadas pueden faltar.
const LIVE_COORDS = new Set(['sensors', 'pedestrianSensors']);

// Número en [0, 1) a partir de un texto (FNV-1a + mezcla final).
function unit(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// Valor imposible para `value`: negativo (-1 a -50, o el valor en negativo) o disparatado (×20 a ×200, al menos 1000).
export function absurd(value, u) {
  const v = Number.isFinite(Number(value)) && value !== '' && value !== null ? Number(value) : 0;
  const decimals = Number.isInteger(v) ? 0 : 1;
  const round = (x) => (decimals ? Math.round(x * 10) / 10 : Math.round(x));
  if (u < 0.5) return round(-(Math.abs(v) > 1 ? Math.abs(v) : 1 + Math.floor(u * 100)));
  return round(Math.max(1000 + u * 9000, Math.abs(v) * (20 + u * 180)));
}

// Ajustes de los fallos desde el entorno (el .env de cada ciudad). Las frecuencias son tantos por uno (0.001 = 0,1 %).
// Se pueden cambiar con la ciudad en marcha: solo cuentan para los datos que se graben desde entonces.
//   SENSOR_FAULTS        on / off
//   SENSOR_FAULT_RATE    filas de un histórico con un dato que falta o es imposible
//   SENSOR_MISSING_RATE  filas que no llegan
//   SENSOR_COORD_RATE    filas de un sensor sin una de sus coordenadas
//   SENSOR_LIVE_RATE     datos de la API en vivo que fallan
const ENV_RATES = {
  SENSOR_FAULT_RATE: 'valueRate', SENSOR_MISSING_RATE: 'missingRowRate', SENSOR_COORD_RATE: 'coordRate', SENSOR_LIVE_RATE: 'liveRate',
};
export function applyFaultEnv(env = process.env, config = CONFIG.faults) {
  const applied = {};
  if (env.SENSOR_FAULTS) {
    const value = env.SENSOR_FAULTS.trim().toLowerCase();
    if (!['on', 'off', 'true', 'false', '1', '0'].includes(value)) throw new Error(`SENSOR_FAULTS debe ser on u off: ${env.SENSOR_FAULTS}`);
    config.enabled = ['on', 'true', '1'].includes(value);
    applied.enabled = config.enabled;
  }
  for (const [name, key] of Object.entries(ENV_RATES)) {
    if (!env[name]) continue;
    const rate = Number(env[name]);
    if (!Number.isFinite(rate) || rate < 0 || rate > 0.5) throw new Error(`${name} debe ser un tanto por uno entre 0 y 0.5 (0.001 = 0,1 %): ${env[name]}`);
    config[key] = rate;
    applied[key] = rate;
  }
  return applied;
}

export function createFaults({ seed = CONFIG.sim.seed, config = CONFIG.faults } = {}) {
  const on = Boolean(config?.enabled);
  const key = (...parts) => `${seed}|${parts.join('|')}`;

  // Fila de un histórico con sus fallos (null = la fila no llegó). No cambia la fila original.
  function csvRow(kind, row) {
    const spec = CSV_FIELDS[kind];
    if (!on || !spec) return row;
    const id = spec.id ? row[spec.id] : '';
    const t = row[spec.time ?? 'timestamp'];
    if (unit(key(kind, id, t, 'missing-row')) < config.missingRowRate) return null;
    let out = row;
    const u = unit(key(kind, id, t, 'value'));
    if (u < config.valueRate) {
      out = { ...out };
      const column = spec.values[Math.floor(unit(key(kind, id, t, 'column')) * spec.values.length)];
      const how = unit(key(kind, id, t, 'how'));
      // 4 de cada 10, el dato falta; el resto, un valor imposible.
      out[column] = how < 0.4 ? '' : absurd(out[column], (how - 0.4) / 0.6);
    }
    if (spec.coords && unit(key(kind, id, t, 'coords')) < config.coordRate) {
      if (out === row) out = { ...out };
      out[unit(key(kind, id, t, 'axis')) < 0.5 ? 'x' : 'z'] = '';
    }
    return out;
  }

  // Respuesta de la API en vivo con sus fallos (cambia `body`, que ya es una copia). `minute` = minuto simulado.
  function live(path, body, minute) {
    if (!on || !body || typeof body !== 'object') return body;
    const walk = (node, where, owner) => {
      if (Array.isArray(node)) {
        node.forEach((item, i) => walk(item, where, owner));
        return;
      }
      if (!node || typeof node !== 'object') return;
      const id = node.id ?? owner;
      if (LIVE_COORDS.has(where) && node.id !== undefined && unit(key('live', path, id, minute, 'coords')) < config.liveRate) {
        node[unit(key('live', path, id, minute, 'axis')) < 0.5 ? 'x' : 'z'] = null;
      }
      for (const [k, v] of Object.entries(node)) {
        if (v && typeof v === 'object') {
          walk(v, k, `${id}/${k}`);
        } else if (typeof v === 'number' && LIVE_FIELDS.has(k)) {
          const u = unit(key('live', path, id, k, minute));
          if (u < config.liveRate) {
            const how = unit(key('live', path, id, k, minute, 'how'));
            node[k] = how < 0.4 ? null : absurd(v, (how - 0.4) / 0.6);
          }
        }
      }
    };
    walk(body, '', 'root');
    return body;
  }

  return { enabled: on, csvRow, live };
}
