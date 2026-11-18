# SmartCity Donostia

Three.js traffic simulation with a Vite frontend.

See the [development roadmap](DEVELOPMENT_ROADMAP.md) for current progress,
planned milestones, and prototype completion criteria.

To manage the city from an external program (read the state, download the history,
close streets, change signals, add buses, limit the access of cars…) see the
[API guide](docs/API.md) (in Spanish) and the example manager in
[examples/gestor.py](examples/gestor.py).

The viewer is a side bar with these tabs: **Resumen** (the city now, the day, the demand and the map layers),
**Semáforos**, **Cortes** (street closures and restricted zones), **Autobuses**, **Bicis**, **Parkings**,
**Sensores** (traffic and pedestrian sensors), **Datos** (CSV downloads) and **Conexión** (server URL and token).
**Tiempo** and **Calendario de eventos** are at the top right. Changes made in the viewer are sent to the server
and need the token if one is set; everything a manager can do from the viewer can also be done with the API.

```sh
npm ci
npm run fetch-osm
npm run dev
```

`fetch-osm` downloads the city data required by the viewer into
`public/data/city.json` (not tracked in Git). It includes the OSM pedestrian
crossings (`highway=crossing` nodes on roads); `npm run fetch-crossings`
refreshes only those in an existing file. It also downloads the points of interest that
attract pedestrians (shops, hospitality, bus and tram stops, schools, services and
tourism, about 3,700 in Donostia); `npm run fetch-pois` refreshes only those.

OSM bicycle-rental stations are included as well. Run `npm run fetch-bikes` to
refresh just those stations in an existing city dataset. If OSM stations are
missing, the viewer uses the bundled municipal Dbizi station catalogue in
`public/data/municipal.json` (the server applies the same fallback, so both agree).
The **Bicis** tab shows the stations on the map with the bikes
left at each one; capacities missing from the source are estimated.

Pedestrians take the bikes on their own: the server (`BikeNetwork`, `CONFIG.bicycles`)
simulates the stations. In every step, pedestrians take bikes at each station
(more in the popular stations and in the busy hours), ride them for about 15
simulated minutes and leave them at another station with free docks, so the bikes
are conserved. On working days there is a **commute tide** (`CONFIG.bicycles.commute`):
in the morning (7–10 h) bikes are taken in the neighbourhoods and left in the centre, and in the
evening (17–20 h) the other way round, so some stations empty and others fill up every day at
similar times. The bikes that are out are shown as blue pedestrians moving four
times faster (`speedFactor`). The state is saved in the snapshot and the counts are
reproducible after a restart. They are simulation estimates, not readings from physical
sensors; real availability requires an operator API (for example, GBFS) or deployed
station sensors. `GET /api/bikes` returns the live counts, and the stations ticked with
**Registrar** in the **Bicis** tab are recorded every 15 simulated minutes (`GET /api/bikes.csv`).

Three **vans** of 20 bikes (`CONFIG.bicycles.vans`) redistribute bikes between stations
(**Furgonetas** in the **Bicis** tab, or `POST /api/bikes/moves`): the nearest free van goes to the origin, loads,
drives to the destination (straight line at 4 m/s, about 14 km/h; it ignores the streets and the traffic)
and unloads. Loading and unloading take 15 simulated minutes each, so a
move takes half an hour or more: to have bikes where the tide will need them, they have to be
moved before. In the tab, pick the origin and the destination (or **Desde aquí** / **Hasta aquí** on a
station) and the number of bikes; the list shows what each van is doing and when it loads and unloads,
and the vans (orange, F1–F3) move on the map.

You can change the docks (`capacity`) of each station, either per station in the **Bicis** tab
(**Anclajes** and **Programar**) or by pasting a JSON such as `{ "municipal/0": 20, "municipal/5": 8 }`
(**Avanzado: varios puestos a la vez (JSON)**), or with `PUT /api/bikes/capacity`. The change is queued
and only takes effect after 30 simulated days (`CONFIG.bicycles.capacityDelaySeconds`, about 14 hours at
the default clock scale); the tab shows what is pending and it can be cancelled. Capacity is
1-60 and larger stations get proportionally more traffic. If a station shrinks, the
bikes that no longer fit go back into circulation and are left at other stations.

Pedestrians are small yellow triangles. Most walk along the sidewalks of the streets
(not motorways); the rest cross the street at those crossings
(`CONFIG.pedestrians.walkFraction`). They never step on
water: where a sidewalk falls into the sea or a river they use the opposite one or are
hidden, and on bridges they stay on the roadway. The server
exposes them (`GET /api/pedestrians`) as a pure function of the simulated time, so
they need no stored state. The viewer evaluates the same function every frame with the
server clock, so it sees the same pedestrians and they move smoothly. Pedestrians
have their own clock (simulated time ÷ the server scale × `pedestrians.clockScale`, capped at the server scale; ×1 = real time, ×52.1 = same as cars), so they walk at
`speed × clockScale` m/s on screen (1.4 × 10 = 14 m/s by default); a walk lasts `walkSeconds` (20 min, pedestrian-clock time) and each
pedestrian has its own phase, so they do not all respawn together.
Crosswalks are drawn as zebra stripes (`pedestrians.zebra`). A crosswalk within
`pedestrians.signalRadius` (40 m) of an active traffic signal is regulated by it: pedestrians
wait at the curb and cross only while the cars on that street are red, shortening the crossing
if the red is short.
Up to `max` (12,000) pedestrians follow the traffic demand of the simulated hour;
tune `CONFIG.pedestrians` in `src/config.js`. The maximum is set by the server
(`MAX_PEDESTRIANS`) and cannot be changed from the viewer or the API.

The server also measures how the pedestrians fare (columns of `city.csv`): `ped_wait_s` and
`ped_waiting`, the mean wait and the people waiting at the crossings with traffic signals (a
street closed to cars has no wait), and `ped_space`, the space won by pedestrians: km of street
closed to cars × how busy it is × the people on the street.

### Where the pedestrians are

Streets do not attract the same number of people. Each street segment has a weight:
the weight of its road class (`CONFIG.pedestrians.streetWeights`; motorways have none)
times `1 + Σ weight(POI) × (1 − distance / poiRadius)²` for the points of interest
within `poiRadius` (60 m, per-category `poiWeights`: bus stops 2.5, schools 2,
tourism 1.5, hospitality 1.2, shops and services 1), capped at `maxWeight` times the
class. Pedestrians start their walks on a segment, and cross at a crossing, in
proportion to its weight (and length), so busy shopping streets and bus stops gather
about 3 to 5 times as many people as a quiet residential street; the same weights are
used by the pedestrian sensors, so what they record follows what the viewer shows. The
weights are computed from `city.json` (85 ms), identically in the server and the viewer.
A walker that reaches a junction keeps going straight unless the street ends
(`attraction` can bias the choice towards heavier streets, but it makes the agents
drift away from the sensors' model, so it is 0 by default). Walks last 20 minutes and
move through several streets, so the concentration is a tendency, not an exact
copy of the weights (on the real city, sensors on the 20 heaviest segments see 4.3 times
the people of those on average segments according to the agents, and 4.8 times
according to the model).

### Cars and trips

Every car makes a trip from an origin to a destination zone and disappears when it arrives
(`CONFIG.trips`). The city is split into 14 × 14 cells; each cell with enough streets is a zone,
weighted by its activity (the shops and services around, the same weights as the pedestrians).
Some places attract more trips at certain hours (`CONFIG.pois`): the Parte Vieja, the Centro and
Gros for leisure (above all on weekends and holidays, in the evening), the beaches (on free days in
summer and with good weather) and the business areas (Miramón, Zuatzu, Igara, Martutene, Amara) in
the morning of working days, from which people leave in the afternoon.

Cars choose their route with the **current traffic**: every minute the server measures the speed
of each street (moving average) and the routes to each destination are recomputed every 15
simulated minutes, so cars avoid the jams. A car stopped for 120 s gives up and reappears elsewhere
(this keeps gridlocks from making the traffic chaotic) and a trip longer than an hour counts as lost.
`city.csv` records the trips of each interval: `trips_done`, `trip_min`, `delay_min` (compared with
the same trip without traffic or closures) and `trips_lost`.

The traffic demand (how many cars are out) is set by the server (`MAX_CARS`) and varies a little at
random each day and hour: it cannot be changed, it has to be predicted. What the city manager does
changes it only indirectly: closed streets and expensive parkings make some people leave the car,
and a bad bus service puts them in it.

### Traffic signals

The **Semáforos** tab changes the timing of every signal (**Todos los semáforos**: mode, green and
yellow) or of the selected one (green for each axis, east-west and north-south, and yellow, 3–6 s).
Modes: `normal`, `off` and `flashing` (the junction is not regulated: cars give way and pedestrians
cross) and `all_red`. **Avanzado: plan completo en JSON** loads a whole plan with rules by time
and day (`schedule`). Each signal has **detectors** (`approaching` and `queue` cars per axis in the
last 100 m, in `GET /api/signals`) for adaptive control. A longer cycle lets more cars through at the
peak, but pedestrians wait longer.

### Street closures and restricted zones

The **Cortes** tab closes streets (clicking them on the map) or a circular zone: `pedestrians_only`
(buses too: their lines are suspended), `buses_and_pedestrians`, or `entry_limit`, a maximum number of
cars inside a zone. Closures take effect at once. With closed streets there are somewhat fewer cars
and more people on the bus; next to an event, closing makes fewer people come by car (they walk or
take the bus) and wins a lot of space for pedestrians. Closures have a cost for the citizens, which
grows with the km and the time.

### Buses (public transport)

The viewer draws a bus network (`CONFIG.transit`, **Autobuses** tab). The lines are generated
from `city.json` when the viewer loads (about 150 ms): up to `lines` (10) round-trip lines that
cross the city along the main roads (primary and secondary roads are cheaper, motorways are
never used) between terminals picked among the real OSM bus stops. Stops are the OSM bus
stops within `stopSnap` (40 m) of the route, at least `minStopSpacing` (300 m) apart, plus an
intermediate stop wherever the gap would exceed `maxStopSpacing` (700 m). Each line has its own color
and its ribbon, stops and buses are drawn in it; the checkboxes in the tab hide a line.

Buses are rectangles. The bar on the roof shows how full they are (green below 50 %,
amber above, red when at least `fullAt` (90 %) of the `capacity` (80) is taken) and hovering one shows its
line and passengers. At each stop part of the passengers get off and the people waiting (yellow squares
by the stop) get on until the bus is full. How many want to ride depends on the hour and the day, the
**rain** (many more), the **events** (before they start, the lines passing near the venue fill up; when
they end, everybody leaves from the stops around it at once), the closed streets and the expensive
parkings. The fleet in service grows with the demand. Buses do not block the cars on the street (they
have their own clock, `clockScale`), but their service does change the traffic: whoever does not fit
is left behind, and whoever waits more than `patienceSeconds` (15 min) gives up (`unserved`) and **takes
the car**.

The **fleet is fixed** (`fleetTotal`): the initial buses of all lines plus a 10 % reserve
(`CONFIG.transit.reserve`). In the **Autobuses** tab (− and +) or with `PATCH /api/buses/<line>` the buses
are shared out between lines. Removing buses is immediate, but **added buses leave the depot and enter
service after `deployMinutes` (40 simulated minutes)**: they show up as "de camino" with their arrival
time. Bus hours above those of the initial fleet are **overtime**, increasingly costly the more of them
pile up in a day (the tab shows today's hours).

The server also keeps a record of what happens on the lines you choose (**Registrar** in the **Autobuses**
tab, none by default). Every 5 simulated minutes (`CONFIG.busTracking.intervalSeconds`) it stores,
per tracked line, the buses in service, passengers on board, capacity, occupancy %, full buses, people waiting
at the stops, people left behind, the assigned fleet and the people left without a bus (`unserved`).
Download it from the **Datos** tab or with `GET /api/buses.csv?id=L1`; `GET /api/buses` shows the
current state and `GET /api/buses/<line>` the stops of a line. As with the other records, it is persisted in
SQLite, survives restarts and a recovery after a stop regenerates identical data (the server builds the same
lines as the viewer, and the bus clock uses the scale stored in the database).

### Pedestrian sensors

In the **Sensores** tab, **Sensores de peatones** places a sensor on a
street (Esc cancels, Supr deletes the selected one); **Sensores de tráfico** does the same for cars. Every 5 simulated minutes
(`CONFIG.pedestrianSensors.bucketSeconds`) the server records, per sensor, how many
pedestrians walked past on the sidewalks of that street (both directions) and crossed at
the crossings within `radius` (20 m), and how many were present in that area. They are
computed from the same flow model that generates the pedestrians in the viewer
(`Pedestrians.flowAt`), not from the individual agents, so the cost does not depend on
how many there are, the numbers follow the demand curve and the `maxPedestrians`
setting, and the records are identical after a restart or a catch-up (Poisson noise
seeded by sensor and interval). Download them from the **Datos** tab or with
`GET /api/pedestrians.csv`; see [DEPLOYMENT.md](DEPLOYMENT.md#api).

## Simulation server

`npm run serve` runs the simulation headless so that sensors keep recording
while no browser is open (one real week = one simulated year), with SQLite
persistence, catch-up after restarts and CSV export by date range. See
[DEPLOYMENT.md](DEPLOYMENT.md#simulation-server-continuous-sensors) for the API
and Fly.io.

### Arranque rápido

Requisitos: Node ≥ 24 (usa `node:sqlite`) o Docker con Compose. En ambos casos
hace falta antes el mapa: `npm ci && npm run fetch-osm`.

**Opción A: Docker Compose (sim + visor web + proxy Caddy)**

```sh
cp .env.example .env     # DOMAIN=:80 para HTTP en local; HTTP_PORT/HTTPS_PORT si 80/443 están ocupados
docker compose up -d --build
```

Abre `http://localhost` (o `http://localhost:<HTTP_PORT>`). La API queda en
`/api` (comprueba `/api/health`). Los datos persisten en el volumen `sim-data`.
Comandos útiles: `docker compose logs -f sim`, `docker compose stop`
(parada limpia), `docker compose down` (conserva datos; `-v` los borra).

**Reiniciar la simulación desde cero (borrando los volúmenes)**

```sh
docker compose down -v          # para los contenedores y borra sim-data, caddy-data y caddy-config
docker compose up -d --build    # arranca con una base de datos vacía
```

Se pierden todos los sensores y el histórico. `-v` también borra los
certificados de Caddy (se regeneran solos). Para borrar solo los datos de la
simulación: `docker compose down && docker volume rm smartcity_sim-data`
(el prefijo es el nombre de la carpeta del proyecto; consúltalo con
`docker volume ls`).

**Opción B: sin Docker**

```sh
npm run serve            # API en http://localhost:8080 (datos en data/smartcity.db)
npm run dev              # visor en otra terminal
```

En el visor, abre la pestaña **Conexión**, escribe la URL de la
API (`http://localhost:8080`), conecta y añade sensores (pestaña **Sensores**). El token es opcional:
si defines `SMARTCITY_TOKEN`, hay que introducirlo para modificar datos.

**Descargar el CSV** (fechas simuladas, `to` exclusivo):

```sh
curl -o trafico.csv "http://localhost/api/traffic.csv?from=2026-01-05T00:00:00Z&to=2026-02-01T00:00:00Z"
curl -o parkings.csv "http://localhost/api/parking.csv"
```

Variables de entorno principales (`SMARTCITY_TOKEN`, `DB_FILE`, `PORT`,
`CHECKPOINT_SECONDS`, `CORS_ORIGIN`): ver [DEPLOYMENT.md](DEPLOYMENT.md).

## Traffic scenarios

The server picks the demand profile of each day from the simulated UTC date and the holiday calendar of
Donostia (`CONFIG.holidays`: national, Basque and local holidays, with Jueves Santo, Viernes Santo and Lunes
de Pascua computed for each year; a holiday on a Sunday is not moved). The **Resumen** tab shows the scenario
of today; it cannot be changed from the viewer or the API. Each day gets one scenario:

| Scenario | Days | Demand |
| --- | --- | --- |
| `weekday` | Monday–Friday, normal | the commuting peaks |
| `preholiday` | a working day before a holiday | same morning, more trips in the afternoon and more people out at night (×1.15) |
| `weekend` | Saturdays; Sundays and holidays when the next day is not a working day | more leisure and shopping, with a busy evening (×0.85) |
| `sunday` | Sundays and holidays (Monday–Friday) when the next day is a working day | a morning outing, then a very quiet afternoon: everybody stays at home (×0.65) |

Examples: Monday 5 January 2026 is `preholiday` (6 January is a holiday), the holiday itself is `sunday`,
the Sunday before 12 October is `weekend`, and in Semana Santa Wednesday is `preholiday`, Thursday to Sunday
are `weekend` and Easter Monday is `sunday`. The event calendar marks the holidays in red and describes the
kind of day selected.

`GET /api/holidays?from=&to=` lists the holidays of a range (by default the next 365 days, up to 3 years) and
`GET /api/state` has `holiday` (the name, or `null`). Set `CONFIG.holidays.enabled = false` to go back to
Monday–Friday / Saturday–Sunday.

Edit `CONFIG.traffic` in `src/config.js` to configure:

- `scenario`: `auto` (from the calendar) or a fixed `weekday`, `preholiday`, `weekend` or `sunday`.
- `dailyVariation` and `hourlyVariation`: random variation of each day (default ±10 %) and a smaller one that
  changes smoothly from hour to hour (±5 %), from the city's seed; set them to 0 for exact, repeatable profile
  comparisons.
- `scenarios.weekday`, `scenarios.weekend` and, optionally, `scenarios.preholiday` and `scenarios.sunday`
  (without them the eve of a holiday is a weekday and the Sunday a weekend): each has `hourly`, exactly 24
  finite numbers between 0 and 1 for UTC hours 00:00–23:00, and `multiplier`,
  a finite non-negative intensity factor. A multiplier of 0 disables demand.

The weekday curve retains the original commute peaks. The weekend curve has
later daytime peaks, a busy evening and a default multiplier of 0.85. These are illustrative
profiles, not calibrated traffic measurements. Values interpolate linearly
between hours, including from 23:00 to that profile's 00:00. Automatic mode
switches profiles at midnight; daily variation also changes then.

The population target is the peak cars (`MAX_CARS`) × interpolated hourly value
× scenario multiplier × daily and hourly variation, plus the extra demand of the events,
the weather and the mode shift (closures, parking prices, bus service). It is rounded and capped at
`CONFIG.cars.max`, and up to 20 cars are added or removed per physics step. Configuration is validated and copied when the demand model is
created; reload after editing it. `CONFIG.sim.baseDate` defines the simulation's
UTC calendar origin and need not be a Monday.

## City events

Events make people come to the city. The **Calendario de eventos** button (top right) opens a
month view with the events of each day (colored dots by type), the ones in progress and the
details of the selected day, with a button that centers the map on the venue. While an event
is in progress its venue is marked on the map with a ring (its zone of influence) and a beam.

The calendar (`src/events/calendar.js`, configured in `CONFIG.events`) is a pure function of the
date and of `events.seed`, so each year has the same events in the server and in the viewer and
there is no state to store. A year has about 100: Real Sociedad home games at Anoeta and
Gipuzkoa Basket games at Donostia Arena 2016 (mostly on weekends), concerts (more in summer;
the big ones at Anoeta in June and July), the Festival de Cine (nine days from the first Friday
from 18 September), Semana Grande (eight days up to 15 August, with fireworks on the Concha),
Jazzaldia (five days ending the last Sunday of July), Tamborrada, Santo Tomás, the Reyes
parade and protests (8M, 1 May and about 22 more at random). Dates, attendances and venue
coordinates are illustrative (venue positions are approximate).

Each event has an `attendance` and an effect that ramps up while people arrive (`lead` hours
before it starts), stays at its maximum during it and fades as they leave (`trail` hours):

- The traffic demand is increased by `attendance × boostPerPerson` (100,000 people = +100 %),
  added on top of the daily profile (events at night matter too) with the total capped at `maxBoost`.
  Parking, buses and bike sharing follow the same demand, so they also fill up. Pedestrians
  already saturate at their maximum during the peak hours.
- Cars go to the venue: part of the trips have it as their destination and new cars appear within
  its radius (up to `spawnShare` of them). On arrival they circle around looking for a space
  (`CONFIG.trips.parkSearchSeconds`, 7 min) and look at the parkings near the venue. Around a big match the
  area fills up and slows down, which is what the students have to anticipate (cutting streets, longer
  greens, more buses on the lines that pass near the venue, parking prices, ...). Closing part of the
  streets around the venue to cars makes fewer people come by car: they walk or take the bus.

`GET /api/events?from=2026-08-01&to=2026-09-01` returns the events of a range (by default,
the next 30 simulated days, up to 366 days) with start and end, venue, attendance and extra
demand; `GET /api/state` has `events.active` and `events.boost` for the ones in progress.
The `attendance` and `extraDemand` of an event are `null` (also in the calendar) until it has ended, so
the models have to predict it; the events' effect on the demand is measurable while it happens.
To get the events of a period for analysis, use `GET /api/events.csv?from=2026-01-01&to=2027-01-01`
(optional `type=football`), **Eventos** in the **Datos** tab (it uses its
*Desde/Hasta* dates) or **⬇ CSV de este mes** in the calendar. The CSV has one row per event with its
venue, coordinates, start, end, `status` (`upcoming`, `in_progress`, `finished`) and, only once it has
finished, `attendance` and `extra_demand`; for the rest those cells are empty, so a model can be
trained on the past and has to predict the attendance of what is coming.
The event calendar links to the API documentation (`CONFIG.events.docsUrl`, [DEPLOYMENT.md](DEPLOYMENT.md#api)).
Set `CONFIG.events.enabled = false` to run without events.

## Weather

The **Tiempo** button (top right, next to the calendar) shows the weather now and the forecast for the
next 48 simulated hours (every 3 hours: condition, temperature and probability of rain). The weather
changes how many people go out and how fast cars drive:

- Rain: more cars (and more bus and parking users) and slower traffic, fewer pedestrians and almost no
  bikes. The effect grows with the rain up to `heavyRain` (2 mm/h).
- Dry, sunny and mild days (12–32 °C): more pedestrians, and more bikes than pedestrians. Below 8 °C
  there are fewer people out.

Like the events, the weather (`src/weather/weather.js`, `CONFIG.weather`) is a pure function of the date
and `weather.seed`, so the server and the viewer agree and there is no state to store. It follows a
Donostia-like climate (monthly mean temperature and share of hours with rain, about 1,450 mm a year, fronts
of one or two days with showers inside them, a daily temperature cycle). The coefficients of each effect
(`CONFIG.weather.effects`) are not published by the API: the students have to find them in the data.

The **forecast** is the real weather plus an error that grows with the lead time (`CONFIG.weather.forecast`)
and that changes every 6 hours, when a new forecast is issued; close in time it is almost exact and 2 days
ahead it is useful but wrong at times. The API only gives the weather already lived (`current`, the CSV)
and the forecast, never the real future:

- `GET /api/weather` (optional `hours=1..48`): `current` and the hourly `forecast`
  (`temperature_c`, `rain_probability`, `rain_mm_h`, `cloud_pct`, `condition`, `lead_h`).
- `GET /api/weather.csv?from=&to=` (or **Tiempo** in the **Datos** tab): the observed
  weather hour by hour (by default the last 7 simulated days; hours that have not happened yet are left out).
- `GET /api/state` has the current `weather`.

Set `CONFIG.weather.enabled = false` to run without weather.

## Parking occupancy tracking

In the **Parkings** tab, tick **Registrar** on the public
underground parkings (the "P" icons) you want to record, or click their icon on
the map (tracked icons are drawn larger). **Registrar todos**/**Ninguno** select everything
or nothing. The selection is stored in the server, not in the browser.

Each sampling interval (default 5 min of simulated time, `CONFIG.parkingTracking`)
the server stores a record per tracked parking with
`timestamp, weekday, parking_id, parking_name, capacity, occupied, free,
occupancy_pct`. Download them from **Parkings** in the **Datos** tab. Occupancy is simulated
(`ParkingLots`): cars arrive with the demand of the city and the events nearby, stay for a while and
leave. Capacity is a default estimate when OSM does not provide it; these are not real measurements.
When a parking is full, part of the drivers circle around looking for a space (`parking_search` in
`city.csv`): more cars on the street.

### Parking tariffs

Each parking in the **Parkings** tab shows its current price and today's tariff.
**Cambiar la tarifa de mañana** sets tomorrow's base price (€/h) and up to
`CONFIG.parking.maxBands` time bands with another price. **Guardar para mañana**
sends it to the server (`PATCH /api/parking/<id>`), and **Por defecto** returns
the parking to the default price. Tariffs only change at 0:00 and stay until
changed again. On the map, the current price is drawn above each "P": red if it
is above the default price, green if below.

Drivers choose among the parkings of their area (1 km) by price: one dearer than its neighbours sends
them cars, a cheaper one takes them. Raising all of them does not change where people park, but it
does change how many come by car: with expensive parkings (on average) part of the people leave the car
and take the bus, the bike or walk (all at twice the price: 7.5 % fewer cars, at most 15 %); people going
to an event look at the parkings around the venue (30 % of them leave the car at twice the price, at
most half). High prices count as a cost for the citizens (`parking_premium` in `city.csv`).

## Checks

```sh
npm test
npm run build
```

Tests use Node's built-in test runner and synthetic road data; no browser,
network, or downloaded city dataset is needed for the tests.
