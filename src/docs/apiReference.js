// Referencia de la API, endpoint por endpoint, en los tres idiomas del servicio. De aquí salen el explorador de la API
// (GET /api/explorer, como un Swagger UI) y la especificación OpenAPI (GET /api/openapi.json). La guía larga, con el
// porqué de cada cosa, sigue en docs/API*.md. Si añades un endpoint a server/app.js, añádelo aquí (lo comprueba
// test/apiReference.test.js).

const L = (es, eu, en) => ({ es, eu, en });

// Parámetros que se repiten.
const POINT = [
  { name: 'x', in: 'query', type: 'number', desc: L('Metros hacia el este desde el origen (con z)', 'Metroak ekialderantz jatorritik (z-rekin)', 'Metres east of the origin (with z)') },
  { name: 'z', in: 'query', type: 'number', desc: L('Metros hacia el sur desde el origen (con x)', 'Metroak hegoalderantz jatorritik (x-rekin)', 'Metres south of the origin (with x)') },
  { name: 'lat', in: 'query', type: 'number', example: 43.3166, desc: L('Latitud (en lugar de x y z, con lon)', 'Latitudea (x eta z-ren ordez, lon-ekin)', 'Latitude (instead of x and z, with lon)') },
  { name: 'lon', in: 'query', type: 'number', example: -1.98, desc: L('Longitud (con lat)', 'Longitudea (lat-ekin)', 'Longitude (with lat)') },
];
const bodyPoint = (fields) => [
  { name: 'x', type: 'number', desc: L('Metros hacia el este (con z), o lat y lon', 'Metroak ekialderantz (z-rekin), edo lat eta lon', 'Metres east (with z), or lat and lon') },
  { name: 'z', type: 'number', desc: L('Metros hacia el sur (con x)', 'Metroak hegoalderantz (x-rekin)', 'Metres south (with x)') },
  { name: 'lat', type: 'number', desc: L('Latitud (en lugar de x y z)', 'Latitudea (x eta z-ren ordez)', 'Latitude (instead of x and z)') },
  { name: 'lon', type: 'number', desc: L('Longitud', 'Longitudea', 'Longitude') },
  ...fields,
];
const RANGE = [
  { name: 'from', in: 'query', type: 'string', example: '2026-01-05T00:00', desc: L('Desde esta hora simulada, incluida (AAAA-MM-DD[THH:MM])', 'Ordu simulatu honetatik, barne (UUUU-HH-EE[TOO:MM])', 'From this simulated time, included (YYYY-MM-DD[THH:MM])') },
  { name: 'to', in: 'query', type: 'string', desc: L('Hasta esta hora simulada, excluida', 'Ordu simulatu honetara arte, kanpoan', 'Up to this simulated time, excluded') },
];
const HISTORY = (idDesc) => [...RANGE, { name: 'id', in: 'query', type: 'string', desc: idDesc }];
const TRACKED_BODY = (example, what) => ({
  example: { ids: example },
  fields: [{ name: 'ids', type: 'array', required: true, desc: L(`Todos los ${what.es} que se graban (sustituye la lista anterior)`, `Grabatzen diren ${what.eu} guztiak (aurreko zerrenda ordezkatzen du)`, `All the ${what.en} that are recorded (replaces the previous list)`) }],
});
const ID = (name, example, desc) => ({ name, in: 'path', type: 'string', required: true, example, desc });

const R = {
  ok: L('Correcto', 'Ondo', 'OK'),
  created: L('Creado', 'Sortuta', 'Created'),
  bad: L('Datos no válidos (el mensaje dice cuál)', 'Datu baliogabeak (mezuak dio zein)', 'Invalid data (the message says which)'),
  token: L('Falta el token o no es válido', 'Tokena falta da edo ez da baliozkoa', 'The token is missing or not valid'),
  notFound: L('No existe', 'Ez da existitzen', 'It does not exist'),
  csv: L('CSV (una fila por intervalo)', 'CSVa (errenkada bat tarte bakoitzeko)', 'CSV (one row per interval)'),
};

export const GROUPS = [
  { id: 'state', name: L('Estado de la ciudad', 'Hiriaren egoera', 'State of the city'), desc: L('Lo que pasa ahora mismo.', 'Une honetan gertatzen dena.', 'What is happening right now.') },
  { id: 'traffic', name: L('Calles y semáforos', 'Kaleak eta semaforoak', 'Streets and traffic signals'), desc: L('Buscar calles, leer y cambiar los semáforos.', 'Kaleak bilatu, semaforoak irakurri eta aldatu.', 'Find streets, read and change the traffic signals.') },
  { id: 'restrictions', name: L('Cortes y restricciones', 'Itxierak eta murrizketak', 'Closures and restrictions'), desc: L('Cortar calles o limitar la entrada de coches a una zona.', 'Kaleak itxi edo autoen sarrera mugatu eremu batean.', 'Close streets or limit cars entering an area.') },
  { id: 'buses', name: L('Autobuses', 'Autobusak', 'Buses'), desc: L('Líneas, flota y su histórico.', 'Lineak, flota eta haien historikoa.', 'Lines, fleet and their history.') },
  { id: 'bikes', name: L('Bicicletas', 'Bizikletak', 'Bikes'), desc: L('Puestos, anclajes, furgonetas y su histórico.', 'Postuak, ainguraguneak, furgonetak eta haien historikoa.', 'Stations, docks, vans and their history.') },
  { id: 'parking', name: L('Parkings', 'Aparkalekuak', 'Car parks'), desc: L('Tarifas y ocupación (la ocupación actual está en /api/state).', 'Tarifak eta okupazioa (uneko okupazioa /api/state-n dago).', 'Tariffs and occupancy (the current occupancy is in /api/state).') },
  { id: 'sensors', name: L('Sensores', 'Sentsoreak', 'Sensors'), desc: L('Contar coches y peatones en un punto y descargar lo contado.', 'Puntu batean autoak eta oinezkoak zenbatu eta zenbatutakoa deskargatu.', 'Count cars and pedestrians at a point and download the counts.') },
  { id: 'context', name: L('Tiempo, eventos y festivos', 'Eguraldia, ekitaldiak eta jaiegunak', 'Weather, events and holidays'), desc: L('Variables de entrada para predecir la demanda.', 'Eskaria aurreikusteko sarrera-aldagaiak.', 'Input variables to predict the demand.') },
  { id: 'city', name: L('Histórico de toda la ciudad', 'Hiri osoaren historikoa', 'History of the whole city'), desc: L('Siempre se graba; con él se mide lo bien que lo hacéis.', 'Beti grabatzen da; horrekin neurtzen da zein ondo egiten duzuen.', 'Always recorded; it measures how well you do.') },
  { id: 'docs', name: L('Documentación', 'Dokumentazioa', 'Documentation'), desc: L('Esta referencia y la guía.', 'Erreferentzia hau eta gida.', 'This reference and the guide.') },
];

export const ENDPOINTS = [
  // --- Estado ---
  {
    group: 'state', method: 'GET', path: '/api/state',
    summary: L('Resumen de toda la ciudad', 'Hiri osoaren laburpena', 'Summary of the whole city'),
    desc: L('Hora simulada, coches, tráfico, parkings, autobuses, bicis, tiempo, eventos, restricciones, sensores y filas grabadas. Es lo primero que conviene leer.',
      'Ordu simulatua, autoak, trafikoa, aparkalekuak, autobusak, bizikletak, eguraldia, ekitaldiak, murrizketak, sentsoreak eta grabatutako errenkadak. Lehenik irakurtzea komeni dena.',
      'Simulated time, cars, traffic, car parks, buses, bikes, weather, events, restrictions, sensors and recorded rows. The first thing worth reading.'),
  },
  {
    group: 'state', method: 'GET', path: '/api/point',
    summary: L('Qué hay cerca de un punto ahora', 'Zer dagoen orain puntu baten inguruan', 'What is near a point now'),
    desc: L('Coches (cuántos, parados, velocidad), peatones, autobuses y semáforos alrededor de un punto. La forma rápida de saber cuánta gente hay en un sitio sin crear sensores.',
      'Autoak (zenbat, geldirik, abiadura), oinezkoak, autobusak eta semaforoak puntu baten inguruan. Sentsorerik sortu gabe leku batean zenbat jende dagoen jakiteko modu azkarra.',
      'Cars (how many, stopped, speed), pedestrians, buses and signals around a point. The quick way to know how many people are somewhere without creating sensors.'),
    params: [...POINT, { name: 'radius', in: 'query', type: 'number', example: 200, desc: L('Radio en metros (1–2000, por defecto 50)', 'Erradioa metrotan (1–2000, lehenetsia 50)', 'Radius in metres (1–2000, default 50)') }],
    responses: [{ status: 400, desc: R.bad }],
  },
  {
    group: 'state', method: 'GET', path: '/api/cars',
    summary: L('Posición de cada coche', 'Auto bakoitzaren posizioa', 'Position of every car'),
    desc: L('Para dibujar el mapa: listas planas de coordenadas. Para contar, mejor /api/point o los sensores.',
      'Mapa marrazteko: koordenatu-zerrenda lauak. Zenbatzeko, hobe /api/point edo sentsoreak.',
      'To draw the map: flat lists of coordinates. To count, better /api/point or the sensors.'),
  },
  {
    group: 'state', method: 'GET', path: '/api/health',
    summary: L('¿Está en marcha el servidor?', 'Martxan dago zerbitzaria?', 'Is the server running?'),
    desc: L('Responde {"ok": true}. Sirve para comprobar la conexión.', '{"ok": true} erantzuten du. Konexioa egiaztatzeko balio du.', 'Answers {"ok": true}. Useful to check the connection.'),
  },

  // --- Calles y semáforos ---
  {
    group: 'traffic', method: 'GET', path: '/api/roads',
    summary: L('Calles cerca de un punto', 'Puntu baten inguruko kaleak', 'Streets near a point'),
    desc: L('De la más cercana a la más lejana. `way` es el identificador que se usa para cortar una calle.',
      'Hurbilenetik urrunenera. `way` kale bat ixteko erabiltzen den identifikatzailea da.',
      'From the nearest to the furthest. `way` is the identifier used to close a street.'),
    params: [...POINT,
      { name: 'radius', in: 'query', type: 'number', example: 100, desc: L('Radio en metros (1–1000, por defecto 100)', 'Erradioa metrotan (1–1000, lehenetsia 100)', 'Radius in metres (1–1000, default 100)') },
      { name: 'limit', in: 'query', type: 'integer', example: 5, desc: L('Cuántas como mucho (1–100, por defecto 20)', 'Gehienez zenbat (1–100, lehenetsia 20)', 'How many at most (1–100, default 20)') }],
    responses: [{ status: 400, desc: R.bad }],
  },
  {
    group: 'traffic', method: 'GET', path: '/api/roads/{way}',
    summary: L('Una calle', 'Kale bat', 'One street'),
    desc: L('Clase, sentido único, longitud, extremos y coches ahora mismo.', 'Mota, noranzko bakarra, luzera, muturrak eta oraingo autoak.', 'Class, one way, length, ends and cars right now.'),
    params: [ID('way', 2325, L('Identificador de la calle (de /api/roads)', 'Kalearen identifikatzailea (/api/roads-etik)', 'Street identifier (from /api/roads)'))],
    responses: [{ status: 404, desc: R.notFound }],
  },
  {
    group: 'traffic', method: 'GET', path: '/api/signals',
    summary: L('Semáforos y su estado', 'Semaforoak eta haien egoera', 'Traffic signals and their state'),
    desc: L('Por semáforo: modo, luz de cada eje (ew = este-oeste, ns = norte-sur), tiempos, ajustes propios y el detector de cada eje (coches que se acercan y cola).',
      'Semaforo bakoitzeko: modua, ardatz bakoitzaren argia (ew = ekialde-mendebalde, ns = ipar-hego), denborak, doikuntza propioak eta ardatz bakoitzaren detektagailua (hurbiltzen ari diren autoak eta ilara).',
      'Per signal: mode, light of each axis (ew = east-west, ns = north-south), timings, own settings and the detector of each axis (approaching cars and queue).'),
    params: [
      { name: 'all', in: 'query', type: 'string', desc: L('1 = incluir también los pasos de peatones', '1 = oinezkoen pasabideak ere sartu', '1 = include the pedestrian crossings too') },
      ...POINT,
      { name: 'radius', in: 'query', type: 'number', desc: L('Solo los de esta zona (metros, 1–5000; con x y z o lat y lon)', 'Eremu honetakoak bakarrik (metroak, 1–5000; x eta z edo lat eta lon-ekin)', 'Only those in this area (metres, 1–5000; with x and z or lat and lon)') }],
  },
  {
    group: 'traffic', method: 'GET', path: '/api/signals/{id}',
    summary: L('Un semáforo', 'Semaforo bat', 'One traffic signal'),
    params: [ID('id', 13965274528, L('Identificador del semáforo (de /api/signals)', 'Semaforoaren identifikatzailea (/api/signals-etik)', 'Signal identifier (from /api/signals)'))],
    responses: [{ status: 404, desc: R.notFound }],
  },
  {
    group: 'traffic', method: 'PATCH', path: '/api/signals/{id}', auth: true,
    summary: L('Cambiar un semáforo', 'Semaforo bat aldatu', 'Change a traffic signal'),
    desc: L('Solo cambian los campos que enviéis; null quita un ajuste y {"reset": true} los borra todos. Cada cambio de fase pierde 2 s: un ciclo muy corto deja pasar menos coches.',
      'Bidaltzen dituzuen eremuak bakarrik aldatzen dira; null-ek doikuntza bat kentzen du eta {"reset": true}-k guztiak ezabatzen ditu. Fase-aldaketa bakoitzak 2 s galtzen ditu: ziklo oso labur batek auto gutxiago pasatzen uzten du.',
      'Only the fields you send change; null removes a setting and {"reset": true} deletes them all. Each phase change loses 2 s: a very short cycle lets fewer cars through.'),
    params: [ID('id', 13965274528, L('Identificador del semáforo', 'Semaforoaren identifikatzailea', 'Signal identifier'))],
    body: {
      example: { mode: 'normal', greenA: 45, greenB: 15 },
      fields: [
        { name: 'mode', type: 'string', desc: L('normal (ciclo), off (apagado), flashing (ámbar intermitente) o all_red (todo en rojo)', 'normal (zikloa), off (itzalita), flashing (anbar keinukaria) edo all_red (dena gorrian)', 'normal (cycle), off, flashing (flashing amber) or all_red') },
        { name: 'green', type: 'integer', desc: L('Segundos de verde de los dos ejes (5–180)', 'Bi ardatzen berde-segundoak (5–180)', 'Seconds of green of both axes (5–180)') },
        { name: 'greenA', type: 'integer', desc: L('Verde del eje este-oeste (5–180)', 'Ekialde-mendebalde ardatzaren berdea (5–180)', 'Green of the east-west axis (5–180)') },
        { name: 'greenB', type: 'integer', desc: L('Verde del eje norte-sur (5–180)', 'Ipar-hego ardatzaren berdea (5–180)', 'Green of the north-south axis (5–180)') },
        { name: 'yellow', type: 'integer', desc: L('Segundos de ámbar (3–6)', 'Anbar-segundoak (3–6)', 'Seconds of amber (3–6)') },
        { name: 'schedule', type: 'array', desc: L('Reglas por horario (hasta 20): [{"when": {"start": "07:00", "end": "09:00", "weekdays": [1,2,3,4,5]}, "greenA": 40}]', 'Ordutegiko arauak (gehienez 20): [{"when": {"start": "07:00", "end": "09:00", "weekdays": [1,2,3,4,5]}, "greenA": 40}]', 'Schedule rules (up to 20): [{"when": {"start": "07:00", "end": "09:00", "weekdays": [1,2,3,4,5]}, "greenA": 40}]') },
        { name: 'reset', type: 'boolean', desc: L('true = borrar todos los ajustes propios', 'true = doikuntza propio guztiak ezabatu', 'true = delete all own settings') },
      ],
    },
    responses: [{ status: 400, desc: R.bad }, { status: 401, desc: R.token }, { status: 404, desc: R.notFound }],
  },
  {
    group: 'traffic', method: 'PUT', path: '/api/signals/plan', auth: true,
    summary: L('Sustituir todo el plan de semáforos', 'Semaforoen plan osoa ordezkatu', 'Replace the whole signal plan'),
    desc: L('default se aplica a los semáforos sin ajustes propios; signals, a cada uno. Mismos campos que al cambiar un semáforo.',
      'default doikuntza propiorik gabeko semaforoei aplikatzen zaie; signals, bakoitzari. Semaforo bat aldatzean bezalako eremuak.',
      'default applies to the signals without own settings; signals, to each one. Same fields as when changing one signal.'),
    body: {
      example: { plan: { default: { green: 30, yellow: 3 }, signals: {} } },
      fields: [{ name: 'plan', type: 'object', required: true, desc: L('{ default: {...}, signals: { "<id>": {...} } }', '{ default: {...}, signals: { "<id>": {...} } }', '{ default: {...}, signals: { "<id>": {...} } }') }],
    },
    responses: [{ status: 400, desc: R.bad }, { status: 401, desc: R.token }],
  },

  // --- Restricciones ---
  {
    group: 'restrictions', method: 'GET', path: '/api/restrictions',
    summary: L('Restricciones activas', 'Murrizketa aktiboak', 'Active restrictions'),
    desc: L('Cada una: modo, zona o calles, límite, metros de calle afectados, coches dentro y líneas de autobús suspendidas.',
      'Bakoitza: modua, eremua edo kaleak, muga, eragindako kale-metroak, barruko autoak eta etendako autobus-lineak.',
      'Each one: mode, area or streets, limit, metres of street affected, cars inside and suspended bus lines.'),
  },
  {
    group: 'restrictions', method: 'POST', path: '/api/restrictions', auth: true,
    summary: L('Cortar calles o limitar el acceso', 'Kaleak itxi edo sarbidea mugatu', 'Close streets or limit access'),
    desc: L('Una zona circular (punto y radius) o calles concretas (ways). pedestrians_only corta también a los autobuses (su línea queda suspendida); buses_and_pedestrians deja pasar autobuses; entry_limit deja entrar coches mientras haya menos de limit dentro.',
      'Eremu zirkular bat (puntua eta radius) edo kale jakin batzuk (ways). pedestrians_only-k autobusei ere ixten die (haien linea etenda geratzen da); buses_and_pedestrians-ek autobusak pasatzen uzten ditu; entry_limit-ek autoak sartzen uzten ditu barruan limit baino gutxiago dauden bitartean.',
      'A circular area (point and radius) or specific streets (ways). pedestrians_only also closes it to buses (their line is suspended); buses_and_pedestrians lets buses through; entry_limit lets cars in while there are fewer than limit inside.'),
    body: {
      example: { mode: 'buses_and_pedestrians', lat: 43.3166, lon: -1.98, radius: 60, name: 'Zona peatonal' },
      fields: [
        { name: 'mode', type: 'string', required: true, desc: L('pedestrians_only, buses_and_pedestrians o entry_limit', 'pedestrians_only, buses_and_pedestrians edo entry_limit', 'pedestrians_only, buses_and_pedestrians or entry_limit') },
        ...bodyPoint([]),
        { name: 'radius', type: 'number', desc: L('Radio de la zona en metros (1–1000)', 'Eremuaren erradioa metrotan (1–1000)', 'Radius of the area in metres (1–1000)') },
        { name: 'ways', type: 'array', desc: L('En lugar de una zona: ids de calle de /api/roads (hasta 200)', 'Eremu baten ordez: /api/roads-eko kale-idak (gehienez 200)', 'Instead of an area: street ids from /api/roads (up to 200)') },
        { name: 'limit', type: 'integer', desc: L('Con entry_limit: coches que puede haber dentro (0 = no entra ninguno)', 'entry_limit-ekin: barruan egon daitezkeen autoak (0 = bat ere ez da sartzen)', 'With entry_limit: cars allowed inside (0 = none enters)') },
        { name: 'name', type: 'string', desc: L('Nombre (opcional)', 'Izena (aukerakoa)', 'Name (optional)') },
      ],
    },
    responses: [{ status: 201, desc: R.created }, { status: 400, desc: R.bad }, { status: 401, desc: R.token }],
  },
  {
    group: 'restrictions', method: 'GET', path: '/api/restrictions/{id}',
    summary: L('Una restricción', 'Murrizketa bat', 'One restriction'),
    params: [ID('id', 'R1', L('Identificador (R1…)', 'Identifikatzailea (R1…)', 'Identifier (R1…)'))],
    responses: [{ status: 404, desc: R.notFound }],
  },
  {
    group: 'restrictions', method: 'PATCH', path: '/api/restrictions/{id}', auth: true,
    summary: L('Cambiar el modo, el límite o el nombre', 'Modua, muga edo izena aldatu', 'Change the mode, limit or name'),
    desc: L('La zona no se cambia: para eso, borrarla y crear otra.', 'Eremua ez da aldatzen: horretarako, ezabatu eta beste bat sortu.', 'The area does not change: for that, delete it and create another.'),
    params: [ID('id', 'R1', L('Identificador (R1…)', 'Identifikatzailea (R1…)', 'Identifier (R1…)'))],
    body: {
      example: { mode: 'entry_limit', limit: 10 },
      fields: [
        { name: 'mode', type: 'string', desc: L('Nuevo modo', 'Modu berria', 'New mode') },
        { name: 'limit', type: 'integer', desc: L('Nuevo límite (entry_limit)', 'Muga berria (entry_limit)', 'New limit (entry_limit)') },
        { name: 'name', type: 'string', desc: L('Nuevo nombre', 'Izen berria', 'New name') },
      ],
    },
    responses: [{ status: 400, desc: R.bad }, { status: 401, desc: R.token }, { status: 404, desc: R.notFound }],
  },
  {
    group: 'restrictions', method: 'DELETE', path: '/api/restrictions/{id}', auth: true,
    summary: L('Quitar una restricción', 'Murrizketa bat kendu', 'Remove a restriction'),
    desc: L('La calle se reabre.', 'Kalea berriro irekitzen da.', 'The street reopens.'),
    params: [ID('id', 'R1', L('Identificador (R1…)', 'Identifikatzailea (R1…)', 'Identifier (R1…)'))],
    responses: [{ status: 401, desc: R.token }, { status: 404, desc: R.notFound }],
  },

  // --- Autobuses ---
  {
    group: 'buses', method: 'GET', path: '/api/buses',
    summary: L('Líneas de autobús ahora', 'Autobus-lineak orain', 'Bus lines now'),
    desc: L('Por línea: autobuses asignados y de camino, en servicio, pasajeros, llenos, gente esperando y suspendida. Además: flota total, reserva y horas de servicio del día (las de más son sobrecoste).',
      'Linea bakoitzeko: esleitutako eta bidean dauden autobusak, zerbitzuan, bidaiariak, beteak, zain dagoen jendea eta etenda. Gainera: flota osoa, erreserba eta eguneko zerbitzu-orduak (gehiegizkoak gainkostua dira).',
      'Per line: assigned buses and those on their way, in service, passengers, full, people waiting and suspended. Also: total fleet, reserve and service hours of the day (the extra ones are overtime).'),
  },
  {
    group: 'buses', method: 'GET', path: '/api/buses/{line}',
    summary: L('Una línea y su recorrido', 'Linea bat eta bere ibilbidea', 'One line and its route'),
    desc: L('Lo mismo que en /api/buses y además stops: las paradas en orden con sus coordenadas.', '/api/buses-en bezala eta gainera stops: geltokiak hurrenez hurren, koordenatuekin.', 'The same as in /api/buses plus stops: the stops in order with their coordinates.'),
    params: [ID('line', 'L1', L('Línea (L1…)', 'Linea (L1…)', 'Line (L1…)'))],
    responses: [{ status: 404, desc: R.notFound }],
  },
  {
    group: 'buses', method: 'PATCH', path: '/api/buses/{line}', auth: true,
    summary: L('Cambiar los autobuses de una línea', 'Linea bateko autobusak aldatu', 'Change the buses of a line'),
    desc: L('Quitar es inmediato; los que se añaden tardan deployMinutes (40 min simulados) en entrar en servicio. La flota total es fija: se toman de la reserva o de otra línea.',
      'Kentzea berehalakoa da; gehitzen direnek deployMinutes (40 min simulatu) behar dute zerbitzuan sartzeko. Flota osoa finkoa da: erreserbatik edo beste linea batetik hartzen dira.',
      'Removing is immediate; the ones added take deployMinutes (40 simulated min) to enter service. The total fleet is fixed: they come from the reserve or from another line.'),
    params: [ID('line', 'L1', L('Línea (L1…)', 'Linea (L1…)', 'Line (L1…)'))],
    body: {
      example: { fleet: 12 },
      fields: [{ name: 'fleet', type: 'integer', required: true, desc: L('Autobuses de la línea (entre minFleet y maxFleet)', 'Lineako autobusak (minFleet eta maxFleet artean)', 'Buses of the line (between minFleet and maxFleet)') }],
    },
    responses: [{ status: 400, desc: R.bad }, { status: 401, desc: R.token }, { status: 404, desc: R.notFound }, { status: 409, desc: L('No quedan autobuses en la reserva', 'Ez dago autobusik erreserban', 'No buses left in the reserve') }],
  },
  {
    group: 'buses', method: 'PUT', path: '/api/buses/tracked', auth: true,
    summary: L('Elegir qué líneas se graban', 'Zein linea grabatzen diren aukeratu', 'Choose which lines are recorded'),
    desc: L('Solo se graba desde que se activa: activadlas al empezar.', 'Aktibatzen denetik bakarrik grabatzen da: hasieran aktibatu.', 'Only recorded from the moment it is enabled: enable them at the start.'),
    body: TRACKED_BODY(['L1', 'L2'], { es: 'ids de línea', eu: 'linea-idak', en: 'line ids' }),
    responses: [{ status: 400, desc: R.bad }, { status: 401, desc: R.token }],
  },
  {
    group: 'buses', method: 'GET', path: '/api/buses.csv', csv: true,
    summary: L('Histórico de las líneas grabadas', 'Grabatutako lineen historikoa', 'History of the recorded lines'),
    desc: L('Cada 5 min: autobuses, pasajeros, capacidad, ocupación, llenos, esperando, gente que se queda sin autobús (unserved) y flota.',
      '5 minuturo: autobusak, bidaiariak, edukiera, okupazioa, beteak, zain, autobusik gabe geratzen den jendea (unserved) eta flota.',
      'Every 5 min: buses, passengers, capacity, occupancy, full, waiting, people left without a bus (unserved) and fleet.'),
    params: HISTORY(L('Solo esta línea (L1…)', 'Linea hau bakarrik (L1…)', 'Only this line (L1…)')),
    responses: [{ status: 400, desc: R.bad }],
  },

  // --- Bicis ---
  {
    group: 'bikes', method: 'GET', path: '/api/bikes',
    summary: L('Puestos de bicicletas y furgonetas', 'Bizikleta-postuak eta furgonetak', 'Bike stations and vans'),
    desc: L('Por puesto: anclajes, bicis libres y cambio pendiente. Además, las furgonetas de redistribución y lo que están haciendo.',
      'Postu bakoitzeko: ainguraguneak, bizikleta libreak eta aldaketa zain. Gainera, banaketa-furgonetak eta zertan ari diren.',
      'Per station: docks, free bikes and pending change. Also, the redistribution vans and what they are doing.'),
  },
  {
    group: 'bikes', method: 'PUT', path: '/api/bikes/capacity', auth: true,
    summary: L('Cambiar los anclajes de varios puestos', 'Hainbat postutako ainguraguneak aldatu', 'Change the docks of several stations'),
    desc: L('Todo o nada. Tarda 30 días simulados en aplicarse (mientras, sale en pending); null cancela un cambio pendiente.',
      'Dena edo ezer ez. 30 egun simulatu behar ditu aplikatzeko (bitartean, pending-en agertzen da); null-ek zain dagoen aldaketa bat bertan behera uzten du.',
      'All or nothing. It takes 30 simulated days to apply (meanwhile it shows in pending); null cancels a pending change.'),
    body: {
      example: { changes: { 'municipal/0': 20 } },
      fields: [{ name: 'changes', type: 'object', required: true, desc: L('{ "<id del puesto>": anclajes (1–60) o null }', '{ "<postuaren ida>": ainguraguneak (1–60) edo null }', '{ "<station id>": docks (1–60) or null }') }],
    },
    responses: [{ status: 400, desc: R.bad }, { status: 401, desc: R.token }],
  },
  {
    group: 'bikes', method: 'POST', path: '/api/bikes/moves', auth: true,
    summary: L('Mover bicis con una furgoneta', 'Bizikletak furgoneta batekin mugitu', 'Move bikes with a van'),
    desc: L('La furgoneta libre más cercana va al origen, carga, viaja y descarga: tarda. Responde las horas de carga y descarga.',
      'Furgoneta libre hurbilena jatorrira doa, kargatu, bidaiatu eta deskargatzen du: denbora behar du. Karga- eta deskarga-orduak erantzuten ditu.',
      'The nearest free van goes to the origin, loads, travels and unloads: it takes time. It answers the loading and unloading times.'),
    body: {
      example: { from: 'municipal/3', to: 'municipal/17', bikes: 15 },
      fields: [
        { name: 'from', type: 'string', required: true, desc: L('Puesto de origen', 'Jatorriko postua', 'Origin station') },
        { name: 'to', type: 'string', required: true, desc: L('Puesto de destino', 'Helmugako postua', 'Destination station') },
        { name: 'bikes', type: 'integer', required: true, desc: L('Bicis como mucho (la furgoneta lleva 20)', 'Gehienez bizikletak (furgonetak 20 eramaten ditu)', 'Bikes at most (the van carries 20)') },
      ],
    },
    responses: [{ status: 201, desc: R.created }, { status: 400, desc: R.bad }, { status: 401, desc: R.token }, { status: 409, desc: L('No hay ninguna furgoneta libre', 'Ez dago furgoneta librerik', 'No free van') }],
  },
  {
    group: 'bikes', method: 'PUT', path: '/api/bikes/tracked', auth: true,
    summary: L('Elegir qué puestos se graban', 'Zein postu grabatzen diren aukeratu', 'Choose which stations are recorded'),
    body: TRACKED_BODY(['municipal/0', 'municipal/1'], { es: 'ids de puesto', eu: 'postu-idak', en: 'station ids' }),
    responses: [{ status: 400, desc: R.bad }, { status: 401, desc: R.token }],
  },
  {
    group: 'bikes', method: 'GET', path: '/api/bikes.csv', csv: true,
    summary: L('Histórico de los puestos grabados', 'Grabatutako postuen historikoa', 'History of the recorded stations'),
    desc: L('Cada 15 min: bicis, anclajes libres, bicis cogidas y devueltas, ocupación.', '15 minuturo: bizikletak, aingura libreak, hartutako eta itzulitako bizikletak, okupazioa.', 'Every 15 min: bikes, free docks, bikes taken and returned, occupancy.'),
    params: HISTORY(L('Solo este puesto', 'Postu hau bakarrik', 'Only this station')),
    responses: [{ status: 400, desc: R.bad }],
  },

  // --- Parkings ---
  {
    group: 'parking', method: 'PATCH', path: '/api/parking/{id}', auth: true,
    summary: L('Tarifa de mañana de un parking', 'Aparkaleku baten biharko tarifa', "Tomorrow's tariff of a car park"),
    desc: L('Solo cambia a las 0:00 y sigue hasta que se cambie. Precio en €/h (0,5–6; null = el de por defecto) y hasta 4 franjas con otro precio.',
      '0:00etan bakarrik aldatzen da eta aldatu arte jarraitzen du. Prezioa €/h-tan (0,5–6; null = lehenetsia) eta beste prezio bat duten gehienez 4 tarte.',
      'It only changes at 0:00 and stays until changed. Price in €/h (0.5–6; null = the default one) and up to 4 time bands with another price.'),
    params: [ID('id', 'U-125_53', L('Parking (id en parkings de /api/state)', 'Aparkalekua (/api/state-ko parkings-eko ida)', 'Car park (id in parkings of /api/state)'))],
    body: {
      example: { price: 2, schedule: [{ from: '17:00', to: '22:00', price: 4 }] },
      fields: [
        { name: 'price', type: 'number', desc: L('€/h (null = el de por defecto)', '€/h (null = lehenetsia)', '€/h (null = the default one)') },
        { name: 'schedule', type: 'array', desc: L('Franjas: [{"from": "HH:MM", "to": "HH:MM", "price": 4}]', 'Tarteak: [{"from": "OO:MM", "to": "OO:MM", "price": 4}]', 'Bands: [{"from": "HH:MM", "to": "HH:MM", "price": 4}]') },
      ],
    },
    responses: [{ status: 400, desc: R.bad }, { status: 401, desc: R.token }, { status: 404, desc: R.notFound }],
  },
  {
    group: 'parking', method: 'PUT', path: '/api/parking/tracked', auth: true,
    summary: L('Elegir qué parkings se graban', 'Zein aparkaleku grabatzen diren aukeratu', 'Choose which car parks are recorded'),
    body: TRACKED_BODY(['U-125_53'], { es: 'ids de parking', eu: 'aparkaleku-idak', en: 'car park ids' }),
    responses: [{ status: 400, desc: R.bad }, { status: 401, desc: R.token }],
  },
  {
    group: 'parking', method: 'GET', path: '/api/parking.csv', csv: true,
    summary: L('Histórico de los parkings grabados', 'Grabatutako aparkalekuen historikoa', 'History of the recorded car parks'),
    desc: L('Ocupación de cada parking grabado a lo largo del tiempo.', 'Grabatutako aparkaleku bakoitzaren okupazioa denboran zehar.', 'Occupancy of each recorded car park over time.'),
    params: HISTORY(L('Solo este parking', 'Aparkaleku hau bakarrik', 'Only this car park')),
    responses: [{ status: 400, desc: R.bad }],
  },

  // --- Sensores ---
  {
    group: 'sensors', method: 'POST', path: '/api/sensors', auth: true,
    summary: L('Poner un sensor de tráfico', 'Trafiko-sentsore bat jarri', 'Place a traffic sensor'),
    desc: L('Se coloca en la calle más cercana al punto y cuenta los coches que pasan en cada sentido y su velocidad, cada 5 min.',
      'Puntutik hurbilen dagoen kalean jartzen da eta noranzko bakoitzean pasatzen diren autoak eta haien abiadura zenbatzen ditu, 5 minuturo.',
      'It goes on the street nearest to the point and counts the cars passing in each direction and their speed, every 5 min.'),
    body: {
      example: { lat: 43.3166, lon: -1.98, name: 'Boulevard' },
      fields: bodyPoint([{ name: 'name', type: 'string', desc: L('Nombre (opcional)', 'Izena (aukerakoa)', 'Name (optional)') }]),
    },
    responses: [{ status: 201, desc: R.created }, { status: 400, desc: R.bad }, { status: 401, desc: R.token }, { status: 422, desc: L('No hay ninguna calle cerca', 'Ez dago kalerik inguruan', 'No street nearby') }],
  },
  {
    group: 'sensors', method: 'PATCH', path: '/api/sensors/{id}', auth: true,
    summary: L('Renombrar un sensor de tráfico', 'Trafiko-sentsore bati izena aldatu', 'Rename a traffic sensor'),
    params: [ID('id', 'S1', L('Sensor (S1…)', 'Sentsorea (S1…)', 'Sensor (S1…)'))],
    body: { example: { name: 'Avenida' }, fields: [{ name: 'name', type: 'string', required: true, desc: L('Nombre nuevo', 'Izen berria', 'New name') }] },
    responses: [{ status: 400, desc: R.bad }, { status: 401, desc: R.token }, { status: 404, desc: R.notFound }],
  },
  {
    group: 'sensors', method: 'DELETE', path: '/api/sensors/{id}', auth: true,
    summary: L('Quitar un sensor de tráfico', 'Trafiko-sentsore bat kendu', 'Remove a traffic sensor'),
    desc: L('Lo ya grabado se conserva.', 'Grabatutakoa gordetzen da.', 'What was recorded is kept.'),
    params: [ID('id', 'S1', L('Sensor (S1…)', 'Sentsorea (S1…)', 'Sensor (S1…)'))],
    responses: [{ status: 401, desc: R.token }, { status: 404, desc: R.notFound }],
  },
  {
    group: 'sensors', method: 'GET', path: '/api/traffic.csv', csv: true,
    summary: L('Lo que han contado los sensores de tráfico', 'Trafiko-sentsoreek zenbatutakoa', 'What the traffic sensors counted'),
    desc: L('Cada 5 min: coches (total y por sentido) y velocidad media.', '5 minuturo: autoak (guztira eta noranzkoka) eta batez besteko abiadura.', 'Every 5 min: cars (total and per direction) and average speed.'),
    params: HISTORY(L('Solo este sensor (S1…)', 'Sentsore hau bakarrik (S1…)', 'Only this sensor (S1…)')),
    responses: [{ status: 400, desc: R.bad }],
  },
  {
    group: 'sensors', method: 'POST', path: '/api/pedestrian-sensors', auth: true,
    summary: L('Poner un sensor de peatones', 'Oinezkoen sentsore bat jarri', 'Place a pedestrian sensor'),
    desc: L('Cuenta los peatones que pasan andando o cruzando, cada 5 min.', 'Oinez edo zeharkatzen pasatzen diren oinezkoak zenbatzen ditu, 5 minuturo.', 'It counts the pedestrians walking past or crossing, every 5 min.'),
    body: {
      example: { lat: 43.3166, lon: -1.98, name: 'Plaza' },
      fields: bodyPoint([{ name: 'name', type: 'string', desc: L('Nombre (opcional)', 'Izena (aukerakoa)', 'Name (optional)') }]),
    },
    responses: [{ status: 201, desc: R.created }, { status: 400, desc: R.bad }, { status: 401, desc: R.token }, { status: 422, desc: L('No hay ninguna calle cerca', 'Ez dago kalerik inguruan', 'No street nearby') }],
  },
  {
    group: 'sensors', method: 'PATCH', path: '/api/pedestrian-sensors/{id}', auth: true,
    summary: L('Renombrar un sensor de peatones', 'Oinezkoen sentsore bati izena aldatu', 'Rename a pedestrian sensor'),
    params: [ID('id', 'P1', L('Sensor (P1…)', 'Sentsorea (P1…)', 'Sensor (P1…)'))],
    body: { example: { name: 'Plaza' }, fields: [{ name: 'name', type: 'string', required: true, desc: L('Nombre nuevo', 'Izen berria', 'New name') }] },
    responses: [{ status: 400, desc: R.bad }, { status: 401, desc: R.token }, { status: 404, desc: R.notFound }],
  },
  {
    group: 'sensors', method: 'DELETE', path: '/api/pedestrian-sensors/{id}', auth: true,
    summary: L('Quitar un sensor de peatones', 'Oinezkoen sentsore bat kendu', 'Remove a pedestrian sensor'),
    desc: L('Lo ya grabado se conserva.', 'Grabatutakoa gordetzen da.', 'What was recorded is kept.'),
    params: [ID('id', 'P1', L('Sensor (P1…)', 'Sentsorea (P1…)', 'Sensor (P1…)'))],
    responses: [{ status: 401, desc: R.token }, { status: 404, desc: R.notFound }],
  },
  {
    group: 'sensors', method: 'GET', path: '/api/pedestrians.csv', csv: true,
    summary: L('Lo que han contado los sensores de peatones', 'Oinezkoen sentsoreek zenbatutakoa', 'What the pedestrian sensors counted'),
    desc: L('Cada 5 min: peatones (andando y cruzando) y presentes.', '5 minuturo: oinezkoak (oinez eta zeharkatzen) eta bertan daudenak.', 'Every 5 min: pedestrians (walking and crossing) and present.'),
    params: HISTORY(L('Solo este sensor (P1…)', 'Sentsore hau bakarrik (P1…)', 'Only this sensor (P1…)')),
    responses: [{ status: 400, desc: R.bad }],
  },
  {
    group: 'sensors', method: 'GET', path: '/api/pedestrians',
    summary: L('Posición de cada peatón', 'Oinezko bakoitzaren posizioa', 'Position of every pedestrian'),
    desc: L('Para dibujar el mapa.', 'Mapa marrazteko.', 'To draw the map.'),
  },

  // --- Tiempo, eventos y festivos ---
  {
    group: 'context', method: 'GET', path: '/api/weather',
    summary: L('Tiempo ahora y previsión', 'Eguraldia orain eta iragarpena', 'Weather now and forecast'),
    desc: L('Previsión hora a hora (hasta 48 h): cuanto más lejos, menos fiable. El tiempo real del futuro no se publica.',
      'Orduz orduko iragarpena (gehienez 48 h): zenbat eta urrunago, orduan eta fidagarritasun txikiagoa. Etorkizuneko benetako eguraldia ez da argitaratzen.',
      'Hour-by-hour forecast (up to 48 h): the further ahead, the less reliable. The real future weather is not published.'),
    params: [{ name: 'hours', in: 'query', type: 'integer', example: 24, desc: L('Horas de previsión (1–48)', 'Iragarpen-orduak (1–48)', 'Hours of forecast (1–48)') }],
    responses: [{ status: 400, desc: R.bad }],
  },
  {
    group: 'context', method: 'GET', path: '/api/weather.csv', csv: true,
    summary: L('Tiempo observado hora a hora', 'Orduz orduko eguraldi behatua', 'Observed weather hour by hour'),
    desc: L('Siempre disponible, también del pasado.', 'Beti eskuragarri, iraganekoa ere bai.', 'Always available, also for the past.'),
    params: RANGE,
    responses: [{ status: 400, desc: R.bad }],
  },
  {
    group: 'context', method: 'GET', path: '/api/events',
    summary: L('Calendario de eventos', 'Ekitaldien egutegia', 'Event calendar'),
    desc: L('Partidos, conciertos, fiestas y manifestaciones: sede, horas y asistentes previstos. Por defecto, los próximos 30 días.',
      'Partidak, kontzertuak, jaiak eta manifestazioak: lekua, orduak eta aurreikusitako bertaratuak. Lehenetsita, hurrengo 30 egunak.',
      'Matches, concerts, festivals and demonstrations: venue, times and expected attendance. By default, the next 30 days.'),
    params: [...RANGE, { name: 'type', in: 'query', type: 'string', desc: L('Solo un tipo de evento', 'Ekitaldi-mota bat bakarrik', 'Only one type of event') }],
    responses: [{ status: 400, desc: R.bad }],
  },
  {
    group: 'context', method: 'GET', path: '/api/events.csv', csv: true,
    summary: L('Eventos en CSV', 'Ekitaldiak CSVan', 'Events as CSV'),
    params: [...RANGE, { name: 'type', in: 'query', type: 'string', desc: L('Solo un tipo de evento', 'Ekitaldi-mota bat bakarrik', 'Only one type of event') }],
    responses: [{ status: 400, desc: R.bad }],
  },
  {
    group: 'context', method: 'GET', path: '/api/holidays',
    summary: L('Festivos', 'Jaiegunak', 'Holidays'),
    desc: L('Por defecto, del día simulado actual a un año después.', 'Lehenetsita, uneko egun simulatutik urtebetera.', 'By default, from the current simulated day to a year later.'),
    params: RANGE,
    responses: [{ status: 400, desc: R.bad }],
  },

  // --- Ciudad ---
  {
    group: 'city', method: 'GET', path: '/api/city.csv', csv: true,
    summary: L('Histórico de toda la ciudad', 'Hiri osoaren historikoa', 'History of the whole city'),
    desc: L('Cada 5 min, desde que arranca el servidor: coches, velocidad, autobuses, bicis, parkings, calles cortadas, viajes (duración, retraso, perdidos), gente sin autobús, esperas de los peatones y más.',
      '5 minuturo, zerbitzaria abiarazten denetik: autoak, abiadura, autobusak, bizikletak, aparkalekuak, itxitako kaleak, bidaiak (iraupena, atzerapena, galduak), autobusik gabeko jendea, oinezkoen itxaronaldiak eta gehiago.',
      'Every 5 min, since the server started: cars, speed, buses, bikes, car parks, closed streets, trips (duration, delay, lost), people without a bus, pedestrian waits and more.'),
    params: RANGE,
    responses: [{ status: 400, desc: R.bad }],
  },
  {
    group: 'city', method: 'PUT', path: '/api/params',
    summary: L('Cambiar la demanda (no se puede)', 'Eskaria aldatu (ezin da)', 'Change the demand (not allowed)'),
    desc: L('Siempre responde 403: la demanda la fija el servidor y varía un poco cada día. Hay que predecirla.',
      'Beti 403 erantzuten du: eskaria zerbitzariak finkatzen du eta apur bat aldatzen da egunero. Aurreikusi egin behar da.',
      'It always answers 403: the server sets the demand and it varies a little every day. It has to be predicted.'),
    responses: [{ status: 403, desc: L('No se puede cambiar', 'Ezin da aldatu', 'It cannot be changed') }],
  },

  // --- Documentación ---
  {
    group: 'docs', method: 'GET', path: '/api/docs',
    summary: L('Guía de la API (página web)', 'APIaren gida (web orria)', 'API guide (web page)'),
    desc: L('La explicación larga: cómo se comporta la ciudad con cada cambio.', 'Azalpen luzea: hiriak nola jokatzen duen aldaketa bakoitzarekin.', 'The long explanation: how the city behaves with each change.'),
  },
  {
    group: 'docs', method: 'GET', path: '/api/docs.md',
    summary: L('Guía de la API (Markdown)', 'APIaren gida (Markdown)', 'API guide (Markdown)'),
  },
  {
    group: 'docs', method: 'GET', path: '/api/explorer',
    summary: L('Esta referencia', 'Erreferentzia hau', 'This reference'),
  },
  {
    group: 'docs', method: 'GET', path: '/api/openapi.json',
    summary: L('Especificación OpenAPI', 'OpenAPI zehaztapena', 'OpenAPI specification'),
    desc: L('Para Swagger UI, Postman, Insomnia o generar un cliente en vuestro lenguaje.', 'Swagger UI, Postman, Insomnia edo zuen hizkuntzan bezero bat sortzeko.', 'For Swagger UI, Postman, Insomnia or to generate a client in your language.'),
  },
];

// Textos de la página del explorador.
export const UI = {
  title: L('Explorador de la API', 'APIaren arakatzailea', 'API explorer'),
  guide: L('Guía', 'Gida', 'Guide'),
  explorer: L('Explorador', 'Arakatzailea', 'Explorer'),
  intro: L('Todas las funciones de la API, con sus parámetros y un ejemplo. «Probar» hace la llamada de verdad a esta ciudad. Las lecturas (GET) son públicas; los cambios necesitan el token si la ciudad tiene uno.',
    'APIaren funtzio guztiak, haien parametroekin eta adibide batekin. «Probatu»-k benetako deia egiten dio hiri honi. Irakurketak (GET) publikoak dira; aldaketek tokena behar dute hiriak bat badu.',
    'All the functions of the API, with their parameters and an example. «Try it» makes the real call to this city. Reads (GET) are public; changes need the token if the city has one.'),
  token: L('Token (para los cambios)', 'Tokena (aldaketetarako)', 'Token (for changes)'),
  tokenHint: L('Solo se guarda en esta pestaña del navegador.', 'Nabigatzailearen fitxa honetan bakarrik gordetzen da.', 'It is only kept in this browser tab.'),
  filter: L('Buscar…', 'Bilatu…', 'Search…'),
  needsToken: L('Necesita token', 'Tokena behar du', 'Needs token'),
  params: L('Parámetros', 'Parametroak', 'Parameters'),
  body: L('Cuerpo (JSON)', 'Gorputza (JSON)', 'Body (JSON)'),
  fields: L('Campos del cuerpo', 'Gorputzaren eremuak', 'Body fields'),
  name: L('Nombre', 'Izena', 'Name'),
  where: L('Dónde', 'Non', 'Where'),
  type: L('Tipo', 'Mota', 'Type'),
  description: L('Descripción', 'Azalpena', 'Description'),
  required: L('obligatorio', 'derrigorrezkoa', 'required'),
  path: L('ruta', 'bidea', 'path'),
  query: L('consulta', 'kontsulta', 'query'),
  responses: L('Respuestas', 'Erantzunak', 'Responses'),
  example: L('Ejemplo de respuesta', 'Erantzun-adibidea', 'Example response'),
  code: L('Cómo llamarla', 'Nola deitu', 'How to call it'),
  tryIt: L('Probar', 'Probatu', 'Try it'),
  sending: L('Enviando…', 'Bidaltzen…', 'Sending…'),
  result: L('Respuesta de la ciudad', 'Hiriaren erantzuna', 'Answer of the city'),
  changes: L('Esto cambia vuestra ciudad de verdad.', 'Honek zuen hiria benetan aldatzen du.', 'This really changes your city.'),
  copy: L('Copiar', 'Kopiatu', 'Copy'),
  copied: L('Copiado', 'Kopiatuta', 'Copied'),
  csvNote: L('CSV: aquí se ven las primeras filas; para todo, descargadlo.', 'CSVa: hemen lehen errenkadak ikusten dira; guztia izateko, deskargatu.', 'CSV: the first rows are shown here; for everything, download it.'),
  download: L('Descargar', 'Deskargatu', 'Download'),
  missing: L('Falta {name}', '{name} falta da', '{name} is missing'),
  invalidJson: L('El cuerpo no es JSON válido', 'Gorputza ez da baliozko JSONa', 'The body is not valid JSON'),
  noAnswer: L('Sin respuesta: {message}', 'Erantzunik ez: {message}', 'No answer: {message}'),
  openapi: L('OpenAPI (para Swagger, Postman…)', 'OpenAPI (Swagger, Postman… -entzat)', 'OpenAPI (for Swagger, Postman…)'),
  points: L('Los puntos se dan con x y z (metros desde el origen: x al este, z al sur) o con lat y lon. Las fechas son horas simuladas: 2026-01-05T08:00.',
    'Puntuak x eta z-rekin (jatorritik metroak: x ekialdera, z hegoaldera) edo lat eta lon-ekin ematen dira. Datak ordu simulatuak dira: 2026-01-05T08:00.',
    'Points are given with x and z (metres from the origin: x east, z south) or with lat and lon. Dates are simulated times: 2026-01-05T08:00.'),
  empty: L('Ninguna función coincide.', 'Ez dago bat datorren funtziorik.', 'No function matches.'),
};

const pick = (text, lang) => (text ? text[lang] ?? text.es : '');

// Referencia ya en un idioma: lo que necesita la página (sin objetos de tres idiomas).
export function apiReference(lang = 'es') {
  return {
    groups: GROUPS.map((g) => ({ id: g.id, name: pick(g.name, lang), desc: pick(g.desc, lang) })),
    endpoints: ENDPOINTS.map((e) => ({
      id: `${e.method} ${e.path}`, group: e.group, method: e.method, path: e.path, auth: Boolean(e.auth), csv: Boolean(e.csv),
      summary: pick(e.summary, lang), desc: pick(e.desc, lang),
      params: (e.params ?? []).map((p) => ({ name: p.name, in: p.in, type: p.type, required: Boolean(p.required), example: p.example ?? '', desc: pick(p.desc, lang) })),
      body: e.body ? { example: e.body.example, fields: e.body.fields.map((f) => ({ name: f.name, type: f.type, required: Boolean(f.required), desc: pick(f.desc, lang) })) } : null,
      responses: [{ status: e.method === 'POST' && e.responses?.some((r) => r.status === 201) ? 201 : 200, desc: pick(e.csv ? R.csv : R.ok, lang) },
        ...(e.responses ?? []).filter((r) => r.status !== 201).map((r) => ({ status: r.status, desc: pick(r.desc, lang) }))],
    })),
    ui: Object.fromEntries(Object.entries(UI).map(([k, v]) => [k, pick(v, lang)])),
  };
}

const SCHEMA_TYPES = { number: 'number', integer: 'integer', string: 'string', boolean: 'boolean', object: 'object', array: 'array' };

// Especificación OpenAPI 3 (para Swagger UI, Postman, generadores de clientes…).
export function openApi(lang = 'es', { version = '1.0.0' } = {}) {
  const ref = apiReference(lang);
  const paths = {};
  for (const e of ref.endpoints) {
    const op = {
      tags: [ref.groups.find((g) => g.id === e.group).name],
      summary: e.summary,
      ...(e.desc ? { description: e.desc } : {}),
      operationId: `${e.method.toLowerCase()}_${e.path.replace(/^\/api\//, '').replace(/[^\w]+/g, '_').replace(/_+$/, '')}`,
      parameters: e.params.map((p) => ({
        name: p.name, in: p.in, required: p.in === 'path' || p.required, description: p.desc,
        schema: { type: SCHEMA_TYPES[p.type] }, ...(p.example !== '' ? { example: p.example } : {}),
      })),
      responses: Object.fromEntries(e.responses.map((r) => [String(r.status), {
        description: r.desc,
        ...(r.status < 300 ? { content: e.csv ? { 'text/csv': { schema: { type: 'string' } } } : { 'application/json': { schema: { type: 'object' } } } } : {}),
      }])),
      ...(e.auth ? { security: [{ token: [] }] } : {}),
    };
    if (e.body) {
      op.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: Object.fromEntries(e.body.fields.map((f) => [f.name, { type: SCHEMA_TYPES[f.type], description: f.desc }])),
              ...(e.body.fields.some((f) => f.required) ? { required: e.body.fields.filter((f) => f.required).map((f) => f.name) } : {}),
            },
            example: e.body.example,
          },
        },
      };
    }
    (paths[e.path] ??= {})[e.method.toLowerCase()] = op;
  }
  return {
    openapi: '3.0.3',
    info: { title: 'SmartCity API', version, description: ref.ui.intro },
    servers: [{ url: '/' }],
    tags: ref.groups.map((g) => ({ name: g.name, description: g.desc })),
    paths,
    components: { securitySchemes: { token: { type: 'http', scheme: 'bearer', description: 'SMARTCITY_TOKEN' } } },
  };
}
