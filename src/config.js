export const CONFIG = {
  dataUrl: `${import.meta.env?.BASE_URL ?? '/'}data/city.json`,
  municipalDataUrl: `${import.meta.env?.BASE_URL ?? '/'}data/municipal.json`,

  sim: {
    seed: 20260105, // semilla del PRNG de la simulación
    step: 0.25, // segundos simulados por paso de física
    maxStepsPerFrame: 200,
    startSeconds: 7 * 3600, // lunes 07:00
    baseDate: Date.UTC(2026, 0, 5), // lunes
  },

  // Festivos de Donostia (nacionales, del País Vasco y locales): fecha fija [mes, día, nombre] y relativos a la Pascua
  // [días respecto al Domingo de Resurrección, nombre]. Un festivo en domingo no se traslada.
  holidays: {
    enabled: true,
    fixed: [
      [1, 1, 'Año Nuevo'], [1, 6, 'Epifanía del Señor'], [1, 20, 'San Sebastián'], [3, 19, 'San José'],
      [5, 1, 'Día del Trabajo'], [7, 25, 'Santiago Apóstol'], [7, 31, 'San Ignacio de Loyola'], [8, 15, 'Asunción de la Virgen'],
      [10, 12, 'Fiesta Nacional de España'], [11, 1, 'Todos los Santos'], [12, 6, 'Día de la Constitución'],
      [12, 8, 'Inmaculada Concepción'], [12, 25, 'Navidad'],
    ],
    easter: [[-3, 'Jueves Santo'], [-2, 'Viernes Santo'], [1, 'Lunes de Pascua']],
  },

  traffic: {
    scenario: 'auto', // auto, weekday, preholiday, weekend o sunday
    dailyVariation: 0.1, // demanda de cada día ±10 % al azar (según la semilla); 0 para desactivarla
    hourlyVariation: 0.05, // y ±5 % más que cambia suavemente de hora en hora; 0 para desactivarla
    scenarios: {
      weekday: {
        multiplier: 1,
        hourly: [
          0.06, 0.04, 0.03, 0.03, 0.05, 0.15, 0.4, 0.85, 1.0, 0.75, 0.6, 0.6,
          0.7, 0.7, 0.65, 0.65, 0.8, 0.95, 1.0, 0.8, 0.5, 0.3, 0.18, 0.1,
        ],
      },
      // Víspera de festivo: los viajes de la tarde salen antes y por la noche hay más gente de ocio.
      preholiday: {
        multiplier: 1.15,
        hourly: [
          0.1, 0.06, 0.04, 0.03, 0.05, 0.15, 0.4, 0.85, 1.0, 0.75, 0.6, 0.6,
          0.7, 0.85, 0.9, 0.9, 1.0, 1.0, 1.0, 0.95, 0.8, 0.65, 0.45, 0.3,
        ],
      },
      // Sábado, y domingo o festivo si el día siguiente tampoco es laborable: más movimiento de ocio y compras.
      weekend: {
        multiplier: 0.85,
        hourly: [
          0.15, 0.1, 0.07, 0.05, 0.04, 0.05, 0.1, 0.2, 0.35, 0.55, 0.75, 0.9,
          1.0, 0.95, 0.85, 0.8, 0.85, 0.95, 1.0, 0.95, 0.85, 0.7, 0.55, 0.4,
        ],
      },
      // Domingo o festivo con el día siguiente laborable: por la tarde cada uno se queda en casa.
      sunday: {
        multiplier: 0.65,
        hourly: [
          0.1, 0.07, 0.05, 0.04, 0.03, 0.03, 0.05, 0.1, 0.2, 0.4, 0.6, 0.75,
          0.8, 0.65, 0.4, 0.25, 0.2, 0.2, 0.25, 0.3, 0.25, 0.15, 0.1, 0.08,
        ],
      },
    },
  },

  // Eventos de la ciudad (calendario determinista por año). Cada evento atrae gente de fuera y de la ciudad:
  // suma `asistentes × boostPerPerson` a la demanda (con rampa de llegada antes y de salida después) y los coches
  // tienden a dirigirse hacia su sede. El calendario es una función de la fecha: servidor y visor generan los mismos.
  events: {
    enabled: true,
    docsUrl: 'https://github.com/prubioamzubiri/SmartCity/blob/main/DEPLOYMENT.md#api', // documentación de la API que enlaza el calendario
    seed: 20260105,
    origin: { lat: 43.3183, lon: -1.9812 }, // origen de la proyección (el mismo que scripts/fetch-osm.mjs)
    boostPerPerson: 1 / 100000, // 100.000 asistentes = +100 % de demanda
    maxBoost: 1, // tope de la demanda extra sumada por todos los eventos a la vez
    steering: 6, // sesgo de los coches hacia la sede de un evento en su pico (0 = ninguno)
    spawnShare: 0.6, // fracción máxima de los coches nuevos que aparecen cerca de la sede de un evento
    // Coordenadas aproximadas de las sedes.
    venues: {
      anoeta: { name: 'Reale Arena (Anoeta)', lat: 43.3014, lon: -1.9737, radius: 700 },
      illunbe: { name: 'Donostia Arena 2016', lat: 43.3021, lon: -1.9617, radius: 500 },
      kursaal: { name: 'Kursaal', lat: 43.3238, lon: -1.9764, radius: 450 },
      trinidad: { name: 'Plaza de la Trinidad', lat: 43.3243, lon: -1.9864, radius: 350 },
      constitucion: { name: 'Plaza de la Constitución', lat: 43.3232, lon: -1.9853, radius: 350 },
      concha: { name: 'Bahía de La Concha', lat: 43.3199, lon: -1.9895, radius: 700 },
      alderdi: { name: 'Alderdi Eder', lat: 43.3225, lon: -1.9866, radius: 450 },
      boulevard: { name: 'Boulevard', lat: 43.3226, lon: -1.9846, radius: 450 },
    },
    // Tipos: duración (h), horas de llegada previa y de salida posterior, y aspecto en el calendario.
    types: {
      football: { label: 'Fútbol', icon: '⚽', color: '#4fc3f7', duration: 2, lead: 3, trail: 1.5 },
      basketball: { label: 'Baloncesto', icon: '🏀', color: '#ff9800', duration: 2, lead: 2, trail: 1 },
      concert: { label: 'Concierto', icon: '🎤', color: '#ba68c8', duration: 3, lead: 2.5, trail: 1.5 },
      film: { label: 'Festival de Cine', icon: '🎬', color: '#ffd54f', duration: 8, lead: 2, trail: 1 },
      fiesta: { label: 'Fiestas', icon: '🎆', color: '#ef5350', duration: 6, lead: 2, trail: 2 },
      jazz: { label: 'Jazzaldia', icon: '🎷', color: '#26a69a', duration: 8, lead: 2, trail: 1 },
      protest: { label: 'Manifestación', icon: '📢', color: '#e0e0e0', duration: 2, lead: 1, trail: 1 },
    },
  },

  // Tiempo atmosférico (determinista por fecha, como los eventos): la lluvia y la temperatura cambian cuánta gente sale
  // y a qué velocidad circulan los coches. El servidor publica lo observado hasta ahora y una previsión a 48 h con
  // un error que crece con el plazo; el tiempo futuro real no se publica.
  weather: {
    enabled: true,
    seed: 20260105,
    // Clima típico de Donostia por mes (enero a diciembre): temperatura media (°C) y fracción de horas con lluvia.
    meanTemp: [9.5, 9.8, 11.5, 12.8, 15.8, 18.8, 21, 21.4, 19.5, 16.5, 12.5, 10.2],
    rainShare: [0.17, 0.16, 0.15, 0.17, 0.15, 0.11, 0.09, 0.1, 0.13, 0.16, 0.18, 0.18],
    dailyRange: 4, // °C de oscilación entre la noche y la tarde con el cielo despejado
    anomaly: 2.8, // °C de variación entre unos días y otros
    rainScale: 2.4, // mm/h por cada unidad que la variable de lluvia supera el umbral del mes
    heavyRain: 2, // mm/h con los que el efecto de la lluvia es máximo
    // Efecto sobre la actividad (1 = el máximo de la lluvia o del buen tiempo).
    effects: {
      carsRain: 0.2, // más coches (y más usuarios de autobús y aparcamiento) con lluvia
      speedRain: 0.18, // los coches circulan más despacio con lluvia
      pedestriansRain: 0.6, // menos peatones con lluvia
      bikesRain: 0.85, // y casi nadie en bici
      sun: 0.15, // más peatones con sol y temperatura agradable (12–32 °C)
      bikesSun: 1.5, // las bicis responden más al buen tiempo que los peatones
      cold: 0.2, // menos gente por debajo de 8 °C
    },
    // Previsión: error de la variable de lluvia (σ = base + perHour × plazo) y de la temperatura (°C).
    forecast: { hours: 48, rainBase: 0.08, rainPerHour: 0.011, tempBase: 0.5, tempPerHour: 0.025 },
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

  // Viajes en coche: cada coche va de su origen a una zona de destino y desaparece al llegar.
  trips: {
    gridCells: 8, // la ciudad se divide en 8 × 8 celdas; cada celda con calles es una zona de destino
    minZoneLength: 400, // metros de calle mínimos para que una celda sea zona de destino
    arriveSeconds: 25, // el viaje termina a menos de tantos segundos (sin tráfico) del centro de la zona
    choiceSeconds: 1, // azar al elegir ruta: una opción peor en tantos segundos pierde ~63 % de probabilidad (más, y dan vueltas)
    maxTripSeconds: 3600, // un viaje que dura más se da por perdido (coche dando vueltas)
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

  bicycles: {
    speedFactor: 4, // factor de velocidad de los peatones que van en bicicleta
    color: 0x4fc3f7,
    takesPerHour: 4, // bicicletas que coge por hora una estación de peso 1 con la demanda al máximo
    tripSeconds: 900, // duración media de un trayecto en bici (segundos simulados)
    initialFill: 0.6, // fracción de los anclajes con bicicleta al empezar
    stepSeconds: 300, // paso de la simulación de la red
    capacityDelaySeconds: 30 * 86400, // un cambio de anclajes tarda 30 días simulados en hacer efecto
    maxCapacity: 60,
    intervalSeconds: 900, // una muestra por estación registrada cada tantos segundos simulados
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
    minFleet: 1, // rango de autobuses por línea que se puede fijar desde la API
    maxFleet: 30,
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
  // Histórico global de la ciudad (servidor): una fila cada `intervalSeconds` simulados, siempre activo.
  cityTracking: {
    intervalSeconds: 300,
  },
  busTracking: {
    intervalSeconds: 300,
  },

  parkingTracking: {
    intervalSeconds: 300,
    storageKey: 'smartcity.parkings',
  },
};
