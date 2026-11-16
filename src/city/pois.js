import { CONFIG } from '../config.js';
import { scenarioForTime, simDate } from '../traffic/demand.js';
import { weather } from '../weather/weather.js';

const K_LAT = 110574; // metros por grado de latitud (como el calendario de eventos)

// Lugares de interés (Parte Vieja, playas, zonas de empresas...) en coordenadas de la simulación.
export function projectPois(config = CONFIG.pois, origin = CONFIG.events.origin) {
  const kLon = 111320 * Math.cos((origin.lat * Math.PI) / 180);
  return config.places.map((p) => ({
    id: `poi:${p.id}`,
    name: p.name,
    kind: p.kind,
    radius: p.radius,
    size: p.size ?? 1, // cuánta gente atrae frente a uno normal (Miramón, con los hospitales y el parque tecnológico: 2)
    x: (p.lon - origin.lon) * kLon,
    z: -(p.lat - origin.lat) * K_LAT,
  }));
}

// Días de trabajo (laborables y vísperas) frente a días libres (fines de semana y festivos).
const FREE = new Set(['weekend', 'sunday', 'holiday']);

// Cuánto atrae un tipo de lugar ahora como destino (`to`) y cuánta gente sale de él (`from`): 0 = nada especial.
export function poiStrength(kind, seconds, scenario = CONFIG.traffic.scenario, config = CONFIG.pois) {
  const profile = config.profiles[kind];
  if (!profile) return { to: 0, from: 0 };
  const day = FREE.has(scenarioForTime(seconds, scenario)) ? 'free' : 'workday';
  const p = profile[day] ?? {};
  const date = simDate(seconds);
  const h = date.getUTCHours() + date.getUTCMinutes() / 60;
  const at = (list) => (list ?? []).reduce((acc, [from, to, value]) => (h >= from && h < to ? acc + value : acc), 0);
  let factor = 1;
  if (profile.summer) {
    // Playas: mucho más en verano y con buen tiempo (la misma respuesta al tiempo que los peatones).
    const month = date.getUTCMonth();
    factor *= month >= 5 && month <= 8 ? profile.summer[1] : profile.summer[0]; // [resto del año, junio-septiembre]
    factor *= Math.max(0.2, Math.min(1.6, weather.effectsAt(seconds).pedestrians));
  }
  return { to: at(p.to) * factor, from: at(p.from) * factor };
}
