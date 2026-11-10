# API de SmartCity para gestionar la ciudad desde un programa externo

La simulación corre en un servidor (`npm run serve` o `docker compose up -d --build`) y la API REST permite a un
programa externo (el vuestro, en el lenguaje que queráis) **leer** el estado de la ciudad, **descargar históricos** y
**cambiar** cosas: cortar calles, tocar semáforos, mover autobuses, limitar el acceso de coches, etc.

Todo lo que aparece aquí existe y está probado (`test/management.test.js`, `test/server.test.js`). Un gestor de
ejemplo funcional está en [`examples/gestor.py`](https://github.com/prubioamzubiri/SmartCity/blob/main/examples/gestor.py).

## Conexión

| | |
| --- | --- |
| URL | `http://localhost:8080` (`npm run serve`) · `http://localhost` / `https://<dominio>` (Docker, el proxy reenvía `/api`) |
| Lecturas (`GET`) | Públicas |
| Escrituras (`POST`, `PUT`, `PATCH`, `DELETE`) | Cabecera `Authorization: Bearer <SMARTCITY_TOKEN>` si el servidor tiene token (en `.env`). Sin token configurado, cualquiera puede escribir |
| Formato | JSON (`Content-Type: application/json`). Errores: `{"error": "mensaje"}` con 400 (datos no válidos), 401 (token), 403 (acción bloqueada), 404, 413 o 422 |
| Esta guía | En el visor: panel **Servidor → Documentación de la API**. En el servidor: `GET /api/docs` (página web) y `GET /api/docs.md` (Markdown) |

### Tiempo simulado

La ciudad tiene su propio reloj: **1 segundo real = 52,1 segundos simulados** (una semana real = un año simulado) y
sigue corriendo aunque nadie esté conectado. `GET /api/state` da `simTime` (hora simulada ISO), `simSeconds` y `scale`.
Las fechas de los históricos (`from`, `to`) son horas simuladas (`2026-01-05T00:00`, `from` incluida y `to` excluida).
Entre decisiones de vuestro programa pasan, por ejemplo, 5 s reales ≈ 4,3 min simulados.

### Coordenadas

Los puntos se dan en **metros desde el origen del mapa** (`x` hacia el este, `z` hacia el sur) o en **`lat` y `lon`**
(equivalentes; el origen es 43.3183, −1.9812). Los endpoints que piden un punto aceptan cualquiera de las dos formas.

---

## 1. Leer el estado ahora

### `GET /api/state` — resumen de toda la ciudad

Campos principales: `simTime`, `scale`, `caughtUp`, `cars` (coches circulando), `params` (`maxCars`, `maxPedestrians`,
`scenario`), `traffic` (`stopped` coches parados, `avgKmh` velocidad media), `signalPlan`, `sensors` y
`pedestrianSensors` (con `total` acumulado y `current`), `parkings` (`id`, `name`, `capacity`, `occupancy` de 0 a 1,
`tracked`), `pedestrians.expected` (peatones en la calle), `buses.lines` (`id`, `fleet`, `suspended`, `tracked`),
`bikes` (`inUse` y `stations` con `available`, `capacity`, `pending`), `weather`, `holiday`, `events`, `restrictions`
(las activas, como en `GET /api/restrictions`), `seed` (semilla de esta ciudad), `startSeconds` (cuándo empezó),
`writeProtected` (los cambios necesitan token) y `records` (filas guardadas por tipo).

### `GET /api/point?x=&z=&radius=` — qué hay cerca de un punto, ahora mismo

`radius` en metros (1–2000, por defecto 50). Devuelve `cars` (`count`, `stopped`, `avgKmh`), `pedestrians.count`,
`buses` (`count`, `passengers`) y `signals`: los semáforos con ciclo del entorno con su estado. Es la forma rápida de
saber «cuántos coches / peatones hay en X» sin crear sensores.

```sh
curl "http://localhost:8080/api/point?lat=43.3166&lon=-1.9800&radius=200"
```

### Autobuses — `GET /api/buses`

Por línea (`id` = `L1`…): `fleet` (autobuses asignados), `minFleet`/`maxFleet`, `capacity` (plazas por autobús),
`active` (en servicio ahora), `passengers` (a bordo), `full` (autobuses llenos), `waiting` (gente esperando en las
paradas), `suspended` (recorrido cortado, ver §3) y `tracked`.
Ocupación de una línea = `passengers / (active × capacity)`.

### Bicicletas — `GET /api/bikes`

`inUse` y, por puesto: `id`, `name`, `x`, `z`, `capacity` (anclajes), `available` (bicis libres), `pending` (cambio de
capacidad en curso). Anclajes libres = `capacity − available`. Son estimaciones del simulador, no sensores reales.

### Parkings

`parkings` dentro de `GET /api/state` (ocupación actual de cada parking subterráneo).

### Semáforos — `GET /api/signals`

Lista los semáforos que regulan tráfico (`?all=1` incluye también los pasos de peatones; `?x=&z=&radius=` filtra por
zona). Cada uno: `id`, `x`, `z`, `mode`, `state` (`ew` = eje este-oeste, `ns` = norte-sur: `green`/`yellow`/`red`),
`timing` (`greenEw`, `greenNs`, `yellow`, `cycle` en segundos) y `override` (ajustes propios, o `null`).
`GET /api/signals/<id>` devuelve uno solo.

### Calles — `GET /api/roads?x=&z=&radius=&limit=`

Calles que pasan a menos de `radius` m (1–1000, por defecto 100) del punto, de la más cercana a la más lejana (`limit`
1–100, por defecto 20). Cada una: `way` (**identificador de calle**, se usa para cortarla), `class` (`motorway`,
`primary`, `secondary`, `tertiary`, `residential`), `oneway`, `length` (m), `from`/`to` (extremos), `cars` (coches
ahora mismo) y `distance` al punto. `GET /api/roads/<way>` devuelve una.

### Otros

`GET /api/weather` (tiempo y previsión 48 h), `GET /api/events` (eventos), `GET /api/holidays` (festivos),
`GET /api/cars` y `GET /api/pedestrians` (posiciones, para dibujar). Son útiles como variables de entrada de un modelo.

---

## 2. Históricos

Los históricos son CSV. Para tráfico, parkings, peatones, autobuses y bicicletas **solo se graban los puntos que
hayáis activado**, y **desde que los activáis** (no hay pasado anterior): activadlos al empezar.

| Qué | Cómo activarlo | Descargar |
| --- | --- | --- |
| Coches por punto | `POST /api/sensors` `{x, z, name}` → `id` (`S1`…). También `PATCH`/`DELETE /api/sensors/<id>` | `GET /api/traffic.csv?from=&to=&id=` (cada 5 min: `count`, `count_fwd`, `count_bwd`, `avg_speed_kmh`) |
| Peatones por punto | `POST /api/pedestrian-sensors` `{x, z, name}` → `id` (`P1`…) | `GET /api/pedestrians.csv?from=&to=&id=` (`count`, `count_walk`, `count_cross`, `present`) |
| Ocupación de parkings | `PUT /api/parking/tracked` `{"ids": ["U-125_53", …]}` | `GET /api/parking.csv?from=&to=&id=` |
| Autobuses por línea | `PUT /api/buses/tracked` `{"ids": ["L1", …]}` | `GET /api/buses.csv?from=&to=&id=` (cada 5 min: `buses`, `passengers`, `capacity`, `occupancy_pct`, `full_buses`, `waiting`) |
| Bicis por puesto | `PUT /api/bikes/tracked` `{"ids": ["municipal/0", …]}` | `GET /api/bikes.csv?from=&to=&id=` (cada 15 min: `bikes`, `free_docks`, `takes`, `returns`, `occupancy_pct`) |
| Toda la ciudad | — (siempre activo, desde que arranca el servidor) | `GET /api/city.csv?from=&to=` (cada 5 min: `cars`, `stopped`, `avg_speed_kmh`, `buses`, `bus_passengers`, `full_buses`, `bus_waiting`, `suspended_lines`, `bikes_in_use`, `stations_empty`, `stations_full`, `parkings_full`, metros de calle `closed_m` / `bus_only_m` / `limited_m`, `signals_all_red` y los viajes del intervalo: `trips_done`, `trip_min` (duración media), `delay_min` (retraso medio frente a ir sin tráfico ni cortes) y `trips_lost`) |
| Tiempo, eventos | — (siempre disponibles, también del pasado) | `GET /api/weather.csv`, `GET /api/events.csv` |

Cada `PUT …/tracked` **sustituye** la lista anterior: enviad todos los ids que queráis grabar.

```sh
curl -o trafico.csv "http://localhost:8080/api/traffic.csv?from=2026-01-05T00:00&to=2026-02-01T00:00"
```

---

## 3. Cambiar la ciudad (necesita token)

### 3.1 Cortar calles y restringir el acceso — `/api/restrictions`

Una **restricción** se define por una **zona circular** (`x`, `z` o `lat`, `lon`, y `radius` de 1 a 1000 m; afecta a
todos los tramos que pasan dentro del círculo) o por **calles concretas** (`ways`: lista de ids de `GET /api/roads`,
hasta 200). Hay tres modos:

| `mode` | Efecto |
| --- | --- |
| `pedestrians_only` | Calle cortada, **solo peatones**: no pasan coches **ni autobuses** |
| `buses_and_pedestrians` | **Solo autobuses y peatones**: los coches no pasan; los autobuses sí |
| `entry_limit` | **Acceso restringido a vehículos nuevos**: los coches de fuera solo entran en la zona si hay menos de `limit` dentro (`limit: 0` = no entra ninguno; los de dentro pueden salir) |

| Petición | Descripción |
| --- | --- |
| `POST /api/restrictions` `{mode, x, z, radius \| ways, limit?, name?}` | Crea una (hasta 100 a la vez). Devuelve `201` y la restricción con su `id` (`R1`…) |
| `GET /api/restrictions` | Lista las activas: `id`, `mode`, `area`/`ways`, `limit`, `edges`, `length` (metros de calle afectados), `cars` (coches dentro ahora) y `suspendedLines` |
| `GET /api/restrictions/<id>` | Una restricción |
| `PATCH /api/restrictions/<id>` `{mode?, limit?, name?}` | Cambia el modo, el límite o el nombre (la zona no se cambia: se borra y se crea otra) |
| `DELETE /api/restrictions/<id>` | La quita: la calle se reabre |

```sh
# 1. Buscar calles cerca de un punto
curl "http://localhost:8080/api/roads?lat=43.3166&lon=-1.9800&radius=60&limit=3"
# 2. Cortar la calle `way` 2325 a todo salvo autobuses y peatones
curl -X POST http://localhost:8080/api/restrictions -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"mode":"buses_and_pedestrians","ways":[2325],"name":"Calle peatonal con bus"}'
# 3. Zona donde solo pueden entrar coches mientras haya menos de 10 dentro
curl -X POST http://localhost:8080/api/restrictions -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"mode":"entry_limit","lat":43.3166,"lon":-1.98,"radius":300,"limit":10}'
```

Cómo se comporta el simulador:

- Al crear una restricción, los coches que estaban en un tramo cortado **reaparecen en otro punto** de la ciudad y todos
  recalculan su ruta. Los coches nuevos no aparecen en tramos cortados ni en zonas
  `entry_limit`.
- Los **autobuses siguen un recorrido fijo**: si una calle de su ruta se corta con `pedestrians_only`, esa **línea
  queda suspendida** (`suspended: true`, sin autobuses, y la gente se acumula en las paradas). Con
  `buses_and_pedestrians` la línea sigue funcionando. Los autobuses no se desvían.
- `entry_limit` con `limit` mayor que 0 es aproximado: los coches eligen su ruta con unas calles de antelación, así que
  puede haber unos pocos más del límite.
- **Los coches hacen viajes**: cada uno va de su origen a una zona de destino por el camino más rápido y, al llegar,
  empieza otro viaje. Cortar calles alarga los viajes (sube el retraso) y, si el destino queda sin camino, el viaje no
  se puede hacer (`trips_lost` en `GET /api/city.csv`). Los coches que estaban en un tramo que se corta pierden su viaje.
- **Los peatones no se ven afectados por los cortes**: caminan siempre por las aceras. La diferencia entre
  `pedestrians_only` y `buses_and_pedestrians` está en los autobuses.
- Las restricciones se guardan y **sobreviven a reinicios** del servidor.

### 3.2 Semáforos — `PATCH /api/signals/<id>`

El `id` sale de `GET /api/signals`. Campos (todos opcionales; los que no enviéis se conservan, `null` quita un ajuste
propio, `{"reset": true}` borra todos los ajustes del semáforo):

| Campo | Valores |
| --- | --- |
| `mode` | `normal` (ciclo) · `off` (apagado) o `flashing` (ámbar intermitente): cruce sin regular (ver abajo) · `all_red`: todos se detienen |
| `green` | Segundos de verde de ambos ejes (5–180) |
| `greenA` / `greenB` | Verde del eje este-oeste / norte-sur por separado (5–180) |
| `yellow` | Segundos de ámbar (1–10) |
| `schedule` | Lista (hasta 20) de reglas con horario: `[{"when": {"start": "07:00", "end": "09:00", "weekdays": [1,2,3,4,5]}, "greenA": 40}]`. `when` admite `start`/`end` (HH:MM, juntos), `weekdays` (0 = domingo), `months`, `daysOfMonth`, `years` y `dates` (AAAA-MM-DD) |

```sh
curl -X PATCH http://localhost:8080/api/signals/13965274528 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"mode":"normal","greenA":45,"greenB":15}'
```

`PUT /api/signals/plan` `{"plan": {"default": {...}, "signals": {"<id>": {...}}}}` sustituye **todo** el plan de golpe
(mismos campos; `default` se aplica a todos los semáforos sin ajustes propios). Los ajustes se guardan y sobreviven a
reinicios.

Un semáforo **apagado** (`off`) o en **ámbar intermitente** (`flashing`) deja el cruce **sin regular** (los dos modos
su estado en `GET /api/signals` es `uncontrolled`):

- Todos los coches llegan despacio (~15 km/h) y **ceden el paso** si viene un coche por la calle con prioridad (la de
  más categoría; a igual categoría, el eje este-oeste).
- Los **peatones** cruzan en grupos y los coches esperan; cuanta más gente hay en la calle, más rato está ocupado el
  paso. En **ámbar intermitente el peatón tiene prioridad** (cruza en cuanto llega: el paso está ocupado bastante
  más); **apagado**, cruza cuando hay hueco (ocupa menos el paso, los coches paran menos).

Con poco tráfico (de noche) puede ahorrar esperas; en hora punta forma colas. Apagar todos los semáforos en hora punta
colapsa la ciudad.

### 3.3 Autobuses de una línea — `PATCH /api/buses/<línea>`

`{"fleet": 12}` fija el número de autobuses de la línea (`L1`…) entre `minFleet` y `maxFleet` (1–30). El cambio es
**inmediato** y se conserva tras un reinicio. Cuántos circulan a la vez depende además de la demanda de la hora
(`active` en `GET /api/buses`): con poca demanda solo sale una parte de la flota.

```sh
curl -X PATCH http://localhost:8080/api/buses/L1 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"fleet":12}'
```

### 3.4 Bicicletas — `PUT /api/bikes/capacity`

`{"changes": {"municipal/0": 20, "municipal/5": null}}` cambia los anclajes (1–60) de varios puestos
(todo o nada); `null` cancela un cambio pendiente. **Tarda 30 días simulados** (unas 14 h reales) en aplicarse; mientras
tanto sale en `pending`.

### 3.5 La demanda no se controla

Cuántos coches y peatones hay en la ciudad **no se puede cambiar**: lo fija el servidor (`params` en `GET /api/state`:
`maxCars` y `maxPedestrians` en hora punta) y **varía un poco al azar** cada día (±10 %) y de hora en hora (±5 %), como
en una ciudad real. `PUT /api/params` responde `403`. Hay que predecirla con los históricos, no fijarla.

---

## Lo que NO se puede hacer (todavía)

El simulador no modela: precios de parking, tarificación por congestión, calidad del aire ni emisiones, ni se pueden
cambiar plazas de parking, trazado o frecuencias de las líneas (solo su número de autobuses), ni mover bicicletas entre
puestos. Tampoco hay histórico de las acciones ya aplicadas: guardadlas vosotros si queréis evaluarlas.

## Hacer un gestor autónomo

El ciclo típico es: **leer** (`/api/state`, `/api/point`, `/api/buses`, `/api/bikes`…) → **decidir** (reglas, un
modelo entrenado con los CSV, aprendizaje por refuerzo…) → **actuar** (`/api/restrictions`, `/api/signals/<id>`,
`/api/buses/<línea>`…) → esperar y medir el efecto. Empezad por `examples/gestor.py`:

```sh
SMARTCITY_URL=http://localhost SMARTCITY_TOKEN=... python3 examples/gestor.py
```

Consejos: el estado cambia solo (hay más tráfico en hora punta, llueve, hay eventos), así que comparad contra lo que
pasaría sin actuar y no solo «antes/después»; haced un cambio cada vez para saber qué lo causó; y evitad oscilaciones
(cortar y reabrir cada pocos segundos).
