export const CONFIG = {
  dataUrl: `${import.meta.env?.BASE_URL ?? '/'}data/city.json`,

  sim: {
    seed: 20260105, // semilla del PRNG de la simulación
    step: 0.25, // segundos simulados por paso de física
    maxStepsPerFrame: 200,
    startSeconds: 7 * 3600, // lunes 07:00
    baseDate: Date.UTC(2026, 0, 5), // lunes
  },

  traffic: {
    scenario: 'auto', // auto, weekday o weekend
    dailyVariation: 0.1, // variación determinista ±10%; 0 para desactivarla
    scenarios: {
      weekday: {
        multiplier: 1,
        hourly: [
          0.06, 0.04, 0.03, 0.03, 0.05, 0.15, 0.4, 0.85, 1.0, 0.75, 0.6, 0.6,
          0.7, 0.7, 0.65, 0.65, 0.8, 0.95, 1.0, 0.8, 0.5, 0.3, 0.18, 0.1,
        ],
      },
      weekend: {
        multiplier: 0.65,
        hourly: [
          0.15, 0.1, 0.07, 0.05, 0.04, 0.05, 0.1, 0.2, 0.35, 0.55, 0.75, 0.9,
          1.0, 0.95, 0.85, 0.8, 0.85, 0.95, 1.0, 0.9, 0.75, 0.55, 0.35, 0.22,
        ],
      },
    },
  },

  cars: {
    max: 3000,
    initialMax: 1500,
    radius: 2.2,
    length: 5,
    minGap: 2,
    accel: 2.2,
    decel: 4.5,
    laneOffset: 2.2,
    lookAhead: 60,
    stopGap: 3,
    stuckSeconds: 300, // un coche parado tanto tiempo reaparece en otro punto (rompe bloqueos sin salida)
    // m/s por clase de vía: autovía, primaria, secundaria, terciaria, residencial
    speedByClass: [22, 16, 13, 11, 8],
  },

  // Peatones: triángulos que caminan por las aceras y cruzan por los pasos de peatones de OSM (solo visual).
  pedestrians: {
    max: 12000, // con la demanda máxima
    walkFraction: 0.75, // fracción que camina por las aceras; el resto cruza por los pasos de peatones
    minDensity: 0.15, // fracción de peatones activos aunque la demanda sea nula
    speed: 1.4, // m/s de paseo real (en pantalla: speed × clockScale m/s)
    clockScale: 10, // ritmo del reloj de los peatones respecto al tiempo real (×1 = real, ×52,1 = igual que los coches); nunca supera la escala del servidor
    size: 2.4, // largo del triángulo, en metros
    margin: 2, // metros más allá de la calzada que ocupan: cruzan hasta ahí y caminan a la mitad
    laneWidth: 3, // ancho del paso por el que se reparten, en metros
    slotSeconds: 40, // segundos reales: cada peatón que cruza elige un paso nuevo en cada ventana de este tamaño
    walkSeconds: 1200, // segundos reales de un paseo por las aceras (≈ 1,7 km a 1,4 m/s de reloj de peatón) antes de reaparecer en otro sitio
    // Atracción de las calles: los peatones empiezan sus paseos, cruzan y cuentan en proporción a un peso por tramo.
    // peso = pesoDeLaClase × (1 + Σ pesoDelPOI × (1 − distancia / poiRadius)²), con tope en maxWeight veces la clase.
    streetWeights: [0, 1.3, 1.5, 1.2, 0.8], // por clase de vía: autovía (sin acera), primaria, secundaria, terciaria, residencial
    poiWeights: [1, 1.2, 2.5, 2, 1, 1.5], // por categoría de POI: comercio, hostelería, transporte, educación, servicios, turismo
    poiRadius: 60, // metros a los que un POI atrae peatones hacia la calle
    maxWeight: 8,
    attraction: 0, // sesgo al elegir calle en un cruce hacia las de más peso (0 = solo siguen recto); con >0 los agentes se desvían del modelo de los sensores (≈15 % con 0, ≈17 % con 0,6, ≈22 % con 3)
    height: 0.5,
    color: 0xffd54a,
    // Pasos de peatones con semáforo: los peatones solo cruzan con el rojo de los coches de esa calle.
    signalRadius: 40, // metros: un paso a menos de esta distancia de un semáforo activo queda regulado por él
    redMargin: 1.5, // segundos simulados de seguridad tras ponerse en rojo y antes de volver el verde
    minRedWindow: 6, // segundos simulados mínimos de rojo útil; con menos, nadie cruza
    zebra: { stripe: 0.5, gap: 0.5, length: 3.2, color: 0xf2f2f2 }, // franjas del paso de cebra, en metros
  },

  // Transporte público: líneas de autobús circulares (ida y vuelta) que cruzan la ciudad entre paradas de OSM (solo visual).
  // Los autobuses son una función del tiempo, como los peatones: no hace falta estado en el servidor.
  transit: {
    lines: 10, // líneas que se generan
    terminals: 12, // extremos candidatos repartidos por la ciudad
    minTerminalRadius: 1500, // metros al centro: ni demasiado cerca...
    maxTerminalRadius: 6000, // ...ni demasiado lejos
    minTerminalDensity: 6, // paradas de OSM en un cuadrado de 400 m para que un extremo esté en una zona urbana
    roadPenalty: [Infinity, 1, 1.1, 1.4, 2.2], // coste por metro según clase de vía: autovía (prohibida), primaria, ... residencial
    speedFactor: 0.7, // fracción de la velocidad de la vía a la que circulan
    maxSpeed: 11, // m/s
    stopSnap: 40, // metros: una parada de OSM sirve a una línea si está a menos de esto de su recorrido
    minStopSpacing: 300, // metros mínimos entre paradas
    maxStopSpacing: 700, // si hay más, se añade una parada intermedia
    terminalMargin: 150, // metros alrededor de una terminal sin otras paradas
    kerbOffset: 1.5, // metros más allá de la calzada a los que se dibuja la parada
    laneOffset: 3, // metros a la derecha del eje por los que circula el autobús
    dwell: 20, // segundos de reloj de autobús parado en una parada
    terminalDwell: 90, // y en las terminales
    headway: 300, // segundos entre autobuses que se buscan (sale el nº de autobuses por línea)
    minBuses: 4,
    maxBuses: 16,
    clockScale: 12, // ritmo del reloj de los autobuses respecto al tiempo real; nunca supera la escala del servidor
    minService: 0.35, // fracción de la flota en servicio con la demanda mínima (con la máxima, toda)
    capacity: 80, // pasajeros por autobús
    fullAt: 0.9, // ocupación a partir de la cual el autobús se considera lleno
    boardings: 8, // pasajeros que suben de media en una parada de peso 1 con la demanda máxima
    alightMin: 0.1, // fracción de los pasajeros que baja en cada parada: entre alightMin y alightMin + alightSpread
    alightSpread: 0.25,
    minStopWeight: 0.4, // peso de atracción de la parada (el de la calle según los POI entre referencia)
    maxStopWeight: 3,
    referenceWeight: 1.5,
    maxWaiting: 14, // peatones que se dibujan esperando en una parada
    waitingSeconds: 600, // segundos de espera a partir de los cuales la parada tiene su máximo de gente
    length: 12, // metros del autobús
    width: 3,
    height: 3.2,
    colors: [0xe6194b, 0x3cb44b, 0x4363d8, 0xf58231, 0x911eb4, 0x42d4f4, 0xf032e6, 0xbfef45, 0x9a6324, 0x00a88f, 0xfabed4, 0xdcbeff],
  },

  // Sensores de peatones del servidor: cuentan a los que pasan por la acera de una calle o cruzan cerca.
  pedestrianSensors: {
    bucketSeconds: 300, // segundos simulados por registro
    radius: 20, // metros alrededor del sensor: pasos de peatones que cuenta y tramo en el que mide los presentes
  },

  signals: {
    green: 20,
    yellow: 3,
    clusterDistance: 45, // metros para agrupar semáforos de un mismo cruce
  },

  // Rotondas: los coches del anillo tienen prioridad y solo entran si hay hueco y el anillo no está lleno.
  roundabouts: {
    maxLength: 400, // perímetro máximo del anillo, en metros
    maxEdges: 64, // tramos máximos del anillo
    yieldDistance: 20, // un coche del anillo que vaya a pasar por la entrada y esté más cerca que esto tiene prioridad
  },

  roads: {
    halfWidth: [9, 7, 5.5, 4.5, 3.5],
    colors: [0x59606e, 0x4f5663, 0x464c58, 0x3f4450, 0x383c47],
  },

  sensors: {
    bucketSeconds: 300,
    snapDistance: 30,
    storageKey: 'smartcity.sensors',
  },

  // URL de la API del servidor de simulación (VITE_API_URL en la compilación o la que se escriba en el panel).
  server: {
    url: import.meta.env?.VITE_API_URL ?? '',
    urlKey: 'smartcity.server.url',
    pollSeconds: 5,
    carsSeconds: 1,
  },

  // Registro de autobuses del servidor: una muestra por línea elegida cada `intervalSeconds` simulados.
  busTracking: {
    intervalSeconds: 300,
  },

  parkingTracking: {
    intervalSeconds: 300,
    storageKey: 'smartcity.parkings',
  },
};
