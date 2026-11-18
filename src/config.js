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
      carsRain: 0.35, // más coches (y aparcamientos llenos) con lluvia
      transitRain: 0.6, // y aún más gente en autobús
      speedRain: 0.18, // los coches circulan más despacio con lluvia
      pedestriansRain: 0.6, // menos peatones con lluvia
      bikesRain: 0.85, // y casi nadie en bici
      sun: 0.4, // más peatones con sol y temperatura agradable (12–32 °C)
      bikesSun: 1.5, // las bicis responden más al buen tiempo que los peatones
      cold: 0.2, // menos gente por debajo de 8 °C
    },
    // Previsión: error de la variable de lluvia (σ = base + perHour × plazo) y de la temperatura (°C).
    forecast: { hours: 48, rainBase: 0.08, rainPerHour: 0.011, tempBase: 0.5, tempPerHour: 0.025 },
  },

  cars: {
    max: 3000,
    initialMax: 2500,
    radius: 2.2,
    length: 5,
    minGap: 2,
    accel: 2.2,
    decel: 4.5,
    laneOffset: 2.2,
    lookAhead: 60,
    stopGap: 3,
    stuckSeconds: 120, // un coche parado tanto tiempo abandona y reaparece en otro punto: deshace los bloqueos (con más, un
    // atasco que no se deshace hacía el tráfico caótico: un cambio mínimo movía el índice del día ±8 puntos)
    // m/s por clase de vía: autovía, primaria, secundaria, terciaria, residencial
    speedByClass: [22, 16, 13, 11, 8],
  },

  // Viajes en coche: cada coche va de su origen a una zona de destino y desaparece al llegar.
  trips: {
    // La ciudad se divide en 14 × 14 celdas; cada celda con calles es una zona de destino. Con pocas zonas, los barrios
    // de calles pequeñas (como el Centro, todo de sentido único) se quedaban sin destinos y los coches los rodeaban.
    gridCells: 14,
    activityBase: 0.5, // peso de una calle sin comercios ni servicios frente a la actividad que le dan (pesos de los peatones)
    minZoneLength: 400, // metros de calle mínimos para que una celda sea zona de destino
    arriveSeconds: 25, // el viaje termina a menos de tantos segundos (sin tráfico) del centro de la zona
    // Rutas con el tráfico de ahora: cada minuto se mide la velocidad de cada tramo (media móvil) y los caminos a cada
    // destino se recalculan cada `refreshMinutes` minutos simulados. Así los coches evitan los atascos.
    congestionSmoothing: 0.3,
    congestionMinSpeed: 1, // m/s: un tramo parado cuenta como si se fuera a esta velocidad
    refreshMinutes: 15,
    choiceSeconds: 30, // azar al elegir ruta entre los tramos que acercan al destino: una opción peor en tantos segundos pierde ~63 % de probabilidad
    maxTripSeconds: 3600, // un viaje que dura más se da por perdido (coche dando vueltas)
    parkSearchSeconds: 420, // quien llega a un evento da vueltas por la zona buscando aparcamiento tanto tiempo
  },

  // Lugares de interés: atraen viajes (y de ellos sale gente) según la hora y el tipo de día. Ocio y playas, sobre todo
  // en días libres (fines de semana y festivos); las playas, en verano y con buen tiempo; zonas de empresas, por la
  // mañana de los días de trabajo (y de ellas sale la gente por la tarde). Coordenadas aproximadas.
  pois: {
    places: [
      { id: 'parte-vieja', name: 'Parte Vieja', kind: 'ocio', lat: 43.3236, lon: -1.9852, radius: 350 },
      { id: 'centro', name: 'Centro (comercio)', kind: 'ocio', lat: 43.3195, lon: -1.9815, radius: 450 },
      { id: 'kursaal', name: 'Kursaal y Gros', kind: 'ocio', lat: 43.3243, lon: -1.9752, radius: 400 },
      { id: 'concha', name: 'Playa de La Concha', kind: 'playa', lat: 43.3175, lon: -1.9880, radius: 600 },
      { id: 'zurriola', name: 'Playa de la Zurriola', kind: 'playa', lat: 43.3262, lon: -1.9730, radius: 350 },
      { id: 'ondarreta', name: 'Playa de Ondarreta', kind: 'playa', lat: 43.3168, lon: -2.0010, radius: 400 },
      { id: 'miramon', name: 'Miramón (parque tecnológico y hospitales)', kind: 'trabajo', lat: 43.2925, lon: -1.9745, radius: 700, size: 2 },
      { id: 'zuatzu', name: 'Zuatzu', kind: 'trabajo', lat: 43.2985, lon: -2.0195, radius: 500 },
      { id: 'igara', name: 'Igara', kind: 'trabajo', lat: 43.3045, lon: -2.0110, radius: 400 },
      { id: 'martutene', name: 'Martutene', kind: 'trabajo', lat: 43.2995, lon: -1.9520, radius: 500 },
      { id: 'amara', name: 'Oficinas de Amara', kind: 'trabajo', lat: 43.3110, lon: -1.9790, radius: 400 },
    ],
    // [desde, hasta, intensidad] por hora: `to` = cuánto atraen como destino; `from` = cuánta gente sale de ellos.
    profiles: {
      trabajo: { workday: { to: [[7, 10, 1.5], [10, 15, 0.5]], from: [[13, 15, 0.5], [16, 19, 1.5]] } },
      ocio: {
        workday: { to: [[11, 14, 0.25], [17, 21, 0.75]], from: [[20, 23, 0.75]] },
        free: { to: [[11, 14, 1], [17, 21, 1.25]], from: [[14, 16, 0.5], [20, 24, 1.25]] },
      },
      playa: { summer: [0.3, 1], workday: { to: [[11, 19, 0.5]], from: [[17, 21, 0.5]] }, free: { to: [[10, 18, 1.5]], from: [[17, 21, 1.5]] } },
    },
    minEdges: 20, // un lugar sin tantos tramos de calle alrededor no está en el mapa (ciudades de prueba)
    maxPoints: 6, // destinos por lugar, repartidos por su área
    pointSpacing: 200, // metros entre destinos de un mismo lugar
    pointWeight: 6, // un lugar con intensidad 1 atrae como 6 zonas medias de la cuadrícula
    spawnShare: 0.03, // fracción de los coches nuevos que salen de un lugar por unidad de intensidad `from` (tope 0,5 en total)
  },

  // Parkings subterráneos: llegan coches según la demanda de la ciudad y los eventos cercanos, se quedan un rato y se van.
  // El gestor fija el precio de cada uno: los conductores eligen entre los de su zona según el precio.
  parking: {
    basePrice: 2, // €/h por defecto
    minPrice: 0.5,
    maxPrice: 6,
    maxBands: 4, // franjas horarias por tarifa diaria
    priceSensitivity: 1, // con el doble de precio que el de base, un parking atrae e^-1 ≈ 37 % de los coches que atraería
    nearMeters: 1000, // entre los parkings a menos de esto se reparte quien quiere aparcar en la zona
    stepSeconds: 60,
    staySeconds: 7200, // estancia media
    arrivalsPerHour: 0.45, // coches que llegan por hora y plaza con la demanda al máximo (ocupación de equilibrio ≈ 90 %)
    eventMeters: 800, // parkings a los que van los coches de un evento
    eventCarsPerBoost: 600, // coches por hora que buscan parking por unidad de `boost` de un evento mientras llega la gente
    eventLeaveSeconds: 2700, // los del evento se van en unos 45 min al terminar
    searchSeconds: 600, // quien no encuentra sitio da vueltas unos 10 min (y acaba en la calle o se va)
    spillShare: 0.5, // de los que encuentran lleno su parking, los que prueban en otro de la zona (el resto da vueltas)
    searchCars: 1, // cada coche buscando sitio es un coche más en la calle
    // Con los parkings caros, parte de la gente deja el coche: por cada vez el precio base de más (media por plaza),
    // un `shiftPerPremium` menos de coches, como mucho `maxShift`. Esa gente va en autobús, en bici o andando
    // (demanda × 1 + fracción × toTransit, toBikes, toWalk).
    shiftPerPremium: 0.075,
    maxShift: 0.15,
    toTransit: 1.5,
    toBikes: 2,
    toWalk: 1,
  },

  // Peatones: triángulos que caminan por las aceras y cruzan por los pasos de peatones de OSM (solo visual).
  pedestrians: {
    max: 12000, // con la demanda máxima
    // Espacio peatonal (ped_space): cuánto cuenta cada km de calle cortada según el modo (solo bus: pasan autobuses).
    spaceShare: { pedestrians_only: 1, buses_and_pedestrians: 0.7 },
    eventSpace: 10, // junto a un evento en marcha, cada km cuenta 1 + eventSpace × (asistentes / 100.000)
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
    // Ida y vuelta al trabajo (laborables): por la mañana se cogen bicis en los barrios y se dejan en el centro; por la
    // tarde, al revés. Así hay puestos que se vacían y otros que se llenan cada día, y se puede prever cuáles.
    commute: {
      centerRadius: 1000, // metros al centro: puesto del centro
      suburbRadius: 1500, // a partir de aquí, puesto de barrio (entre medias, sin sesgo)
      morning: [7, 10], // horas de ida
      evening: [17, 20], // horas de vuelta
      strength: 0.8, // coger y dejar se multiplican o dividen por 1 + strength en el sentido de la marea
    },
    // Furgonetas para redistribuir bicis entre puestos: van al origen, cargan, viajan y descargan.
    vans: { count: 3, capacity: 20, speed: 4, handlingSeconds: 900 }, // speed en m/s (con tráfico); handling: cargar o descargar
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
    reserve: 0.1, // flota total = la inicial de todas las líneas + este tanto por uno de reserva (fija: solo se reparte)
    deployMinutes: 40, // minutos simulados que tarda un autobús de la reserva en llegar desde la cochera y entrar en servicio
    patienceSeconds: 900, // (reloj de autobús) quien espera más que esto se cansa y se va (y coge el coche)
    eventRiders: 2.5, // demanda de más en las líneas que pasan cerca de un evento, por unidad de `boost` (100.000 asistentes)
    eventArrivalPeak: 2.5, // la llegada se concentra al final: demanda × eventArrivalPeak × nivel² (mismo total)
    eventReach: 1.5, // una parada sirve a un evento si está a menos de radio × eventReach de la sede
    // Cambio de modo: si toda la gente que quería ir en autobús se queda sin servicio, la demanda de coches sube esto.
    modeShift: 0.5,
    modeShiftFrom: 0.05, // fracción sin servicio a partir de la cual hay cambio de modo
    // Calles cortadas o solo para autobuses y peatones: menos coches y más gente en autobús, por km (con un tope).
    closures: { carsPerKm: 0.03, transitPerKm: 0.025, maxKm: 8 },
    clockScale: 12, // ritmo del reloj de los autobuses respecto al tiempo real; nunca supera la escala del servidor
    minService: 0.35, // fracción de la flota en servicio con la demanda mínima (con la máxima, toda)
    capacity: 80, // pasajeros por autobús
    fullAt: 0.9, // ocupación a partir de la cual el autobús se considera lleno
    boardings: 6, // pasajeros que suben de media en una parada de peso 1 con la demanda máxima y un autobús cada `headway`
    alightMin: 0.1, // fracción de los pasajeros que baja en cada parada: entre alightMin y alightMin + alightSpread
    alightSpread: 0.25,
    minStopWeight: 0.4, // peso de atracción de la parada (el de la calle según los POI entre referencia)
    maxStopWeight: 3,
    referenceWeight: 1.5,
    maxWaiting: 14, // peatones que se dibujan esperando en una parada
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
    yellowRange: [3, 6], // segundos de ámbar permitidos (por seguridad, no menos de 3)
    detectorRange: 100, // metros antes de la línea de parada que cubre el detector de cada semáforo (GET /api/signals)
    lostSeconds: 2, // segundos de rojo para todos al empezar cada verde (despeje y arranque)
    clusterDistance: 45, // metros para agrupar semáforos de un mismo cruce
    // Semáforo apagado o en ámbar intermitente: cruce sin regular.
    // Pasos de cebra sin semáforo (ver crosswalks.js): con la calle llena de peatones, un paso de concurrencia media está
    // ocupado este tanto por uno del tiempo (los más concurridos hasta `maxWeight` veces más, con tope en `maxShare`).
    crosswalks: { share: 0.2, maxShare: 0.5, minWeight: 0.25, maxWeight: 2, snapDistance: 3, stopGap: 3 },
    unsignalized: {
      approachSpeed: 4, // m/s (~15 km/h) a los que se llega a la línea de parada
      yieldDistance: 30, // metros: un coche de la calle con prioridad a menos de esto obliga a ceder el paso
      pedestrianPeriod: 40, // segundos simulados: los peatones cruzan en grupo una vez cada tanto
      // Con la calle llena de peatones, tanto por uno del tiempo con el paso ocupado. En ámbar intermitente el peatón tiene
      // prioridad (cruza al llegar y los coches paran); apagado, cruza cuando hay hueco (los coches paran menos).
      pedestrianShare: { flashing: 0.45, off: 0.15 },
    },
    // Espera de los peatones en los cruces con semáforo. Quien llega con su semáforo en rojo espera hasta su verde: de
    // media rojo² / (2 × ciclo) por sentido de cruce (con un ciclo de 24 s, unos 6 s; con uno de 60 s, unos 15 s).
    pedestrianWait: {
      arrivalsPerSecond: 0.3, // peatones que llegan a cruzar por segundo a cada cruce con la calle llena (se escala con la gente)
      maxSeconds: 90, // más de esto no espera nadie (cruza en rojo o da la vuelta): es lo que cuenta en rojo para todos
      unsignalized: { flashing: 2, off: 8 }, // en ámbar cruza casi al llegar; apagado, espera un hueco entre coches
    },
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
