// Métrica del profesor: compara la ciudad de un grupo con la ciudad de referencia (sin gestor) a la misma hora simulada.
// Los alumnos solo deben conocer los criterios generales (tráfico, transporte público, bicis, parkings y coste de las
// intervenciones), no los pesos ni la fórmula.

export const BUCKET_SECONDS = 900; // los indicadores se agrupan en tramos de 15 min simulados
export const ROWS_PER_BUCKET = 3; // /api/city.csv graba una fila cada 5 min: un tramo completo tiene 3
const BUCKET_HOURS = BUCKET_SECONDS / 3600;

// Todo lo ajustable está aquí. Los pesos suman 1.
export const METRIC = {
  weights: { traffic: 0.3, transit: 0.25, fleet: 0.05, bikes: 0.1, parkings: 0.1, cost: 0.2 },
  clamp: 0.5, // cada componente aporta entre −50 % y +50 % de mejora
  // Peso de cada km de calle restringida: cortada (pedestrians_only o entry_limit 0), solo bus, acceso limitado.
  restrictionWeight: { closed: 1, bus_only: 0.6, limited: 0.4 },
  allRedKm: 0.1, // un semáforo en all_red cuenta como 100 m de calle cortada
  reversalKm: 2, // cada «marcha atrás» por hora simulada cuenta como 2 km cortados
  reversalSeconds: 3600, // deshacer un cambio antes de 1 h simulada es una marcha atrás
  costFullPenaltyKm: 5, // con 5 km equivalentes de media el componente de coste llega a −50 %
  // Valores mínimos del denominador cuando la referencia es (casi) cero, como fracción de las horas de la ventana.
  floors: { suspendedLineHours: 0.25, badStationHours: 1, saturatedLotHours: 0.5 },
  capIfComponentBelow: -0.2, // si algún componente empeora más de un 20 %...
  cap: 60, // ...el índice no pasa de 60
  suspensionSeconds: 2 * 3600, // una línea suspendida más de 2 h seguidas...
  suspensionPenalty: 5, // ...resta 5 puntos por episodio
  maxSuspensionPenalty: 15,
};

// Nombres de los indicadores instantáneos que se guardan (sumas por tramo).
export const INDICATORS = [
  'cars', 'stopped', 'speedXcars', 'busWaiting', 'busActive', 'busFull', 'busPassengers', 'suspendedLines',
  'badStations', 'saturatedLots', 'restrictedKm', 'allRed',
];

// Indicadores de una fila de GET /api/city.csv (el simulador la graba cada 5 min simulados, a horas exactas).
export function indicatorsOf(row) {
  const n = (key) => Number(row[key]) || 0;
  const w = METRIC.restrictionWeight;
  return {
    cars: n('cars'),
    stopped: n('stopped'),
    speedXcars: n('avg_speed_kmh') * n('cars'),
    busWaiting: n('bus_waiting'),
    busActive: n('buses'),
    busFull: n('full_buses'),
    busPassengers: n('bus_passengers'),
    suspendedLines: n('suspended_lines'),
    badStations: n('stations_empty') + n('stations_full'),
    saturatedLots: n('parkings_full'),
    restrictedKm: (n('closed_m') * w.closed + n('bus_only_m') * w.bus_only + n('limited_m') * w.limited) / 1000,
    allRed: n('signals_all_red'),
  };
}

export const bucketOf = (simSeconds) => Math.floor(simSeconds / BUCKET_SECONDS);

const clamp = (v) => Math.max(-METRIC.clamp, Math.min(METRIC.clamp, v));
// Mejora de un indicador en el que menos es mejor (positivo = el grupo lo hace mejor que la referencia).
const lessIsBetter = (group, ref, floor = 1e-9) => clamp((ref - group) / Math.max(ref, floor));
const moreIsBetter = (group, ref, floor = 1e-9) => clamp((group - ref) / Math.max(ref, floor));

// Totales de una ventana: cada tramo aporta la media de sus muestras × su duración en horas.
function totals(rows) {
  const t = Object.fromEntries(INDICATORS.map((k) => [k, 0]));
  for (const row of rows) for (const k of INDICATORS) t[k] += (row.sums[k] / row.n) * BUCKET_HOURS;
  return t;
}

/**
 * Índice de un grupo en una ventana. `group` y `ref` son listas de tramos { bucket, n, sums }; solo cuentan los tramos
 * completos en ambas. `events` del grupo: { reversals, suspensions } en la ventana.
 */
export function scoreWindow(group, ref, { reversals = 0, suspensions = 0 } = {}) {
  const refByBucket = new Map(ref.map((r) => [r.bucket, r]));
  // Solo tramos completos en las dos ciudades (las últimas filas llegan con el siguiente checkpoint del simulador).
  const pairs = group.filter((g) => g.n >= ROWS_PER_BUCKET && refByBucket.get(g.bucket)?.n >= ROWS_PER_BUCKET);
  if (!pairs.length) return null;
  const g = totals(pairs);
  const r = totals(pairs.map((p) => refByBucket.get(p.bucket)));
  const hours = pairs.length * BUCKET_HOURS;
  const f = METRIC.floors;

  const speed = (t) => (t.cars > 0 ? t.speedXcars / t.cars : 0);
  const fullRatio = (t) => (t.busActive > 0 ? t.busFull / t.busActive : 0);
  const reversalsPerHour = reversals / hours;
  const costKm = g.restrictedKm / hours + METRIC.allRedKm * (g.allRed / hours) + METRIC.reversalKm * reversalsPerHour;

  const components = {
    traffic: (2 / 3) * lessIsBetter(g.stopped, r.stopped) + (1 / 3) * moreIsBetter(speed(g), speed(r)),
    transit:
      0.5 * lessIsBetter(g.busWaiting, r.busWaiting) +
      0.25 * lessIsBetter(fullRatio(g), fullRatio(r), 0.01) +
      0.25 * lessIsBetter(g.suspendedLines, r.suspendedLines, f.suspendedLineHours * hours),
    fleet: lessIsBetter(g.busActive, r.busActive),
    bikes: lessIsBetter(g.badStations, r.badStations, f.badStationHours * hours),
    parkings: lessIsBetter(g.saturatedLots, r.saturatedLots, f.saturatedLotHours * hours),
    cost: costKm > 0 ? -METRIC.clamp * Math.min(1, costKm / METRIC.costFullPenaltyKm) : 0,
  };

  let index = 50;
  for (const [k, v] of Object.entries(components)) index += 100 * METRIC.weights[k] * v;
  const notes = [];
  const worst = Object.entries(components).filter(([k]) => k !== 'cost').sort((a, b) => a[1] - b[1])[0];
  if (worst[1] < METRIC.capIfComponentBelow && index > METRIC.cap) {
    index = METRIC.cap;
    notes.push(`Tope ${METRIC.cap}: ${worst[0]} empeora un ${Math.round(-worst[1] * 100)} %`);
  }
  const suspensionPenalty = Math.min(METRIC.maxSuspensionPenalty, suspensions * METRIC.suspensionPenalty);
  if (suspensionPenalty) {
    index -= suspensionPenalty;
    notes.push(`−${suspensionPenalty}: ${suspensions} línea(s) suspendida(s) más de ${METRIC.suspensionSeconds / 3600} h`);
  }

  const per = (t) => ({
    stoppedCarHours: t.stopped,
    avgKmh: speed(t),
    busWaitingPersonHours: t.busWaiting,
    fullBusPct: 100 * fullRatio(t),
    suspendedLineHours: t.suspendedLines,
    busHours: t.busActive,
    badStationHours: t.badStations,
    saturatedLotHours: t.saturatedLots,
    restrictedKmAvg: t.restrictedKm / hours,
  });
  return {
    index: Math.max(0, Math.min(100, index)),
    components,
    hours,
    buckets: pairs.length,
    group: per(g),
    reference: per(r),
    costKm,
    reversals,
    suspensions,
    notes,
  };
}
