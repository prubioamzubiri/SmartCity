# SmartCity Donostia

Three.js traffic simulation with a Vite frontend.

See the [development roadmap](DEVELOPMENT_ROADMAP.md) for current progress,
planned milestones, and prototype completion criteria.

```sh
npm ci
npm run fetch-osm
npm run dev
```

`fetch-osm` downloads the city data required by the viewer into
`public/data/city.json` (not tracked in Git). It includes the OSM pedestrian
crossings (`highway=crossing` nodes on roads); `npm run fetch-crossings`
refreshes only those in an existing file.

Pedestrians are small yellow triangles. Most walk along the sidewalks of the streets
(not motorways); the rest cross the street at those crossings
(`CONFIG.pedestrians.walkFraction`). They never step on
water: where a sidewalk falls into the sea or a river they use the opposite one or are
hidden, and on bridges they stay on the roadway. The server
exposes them (`GET /api/pedestrians`) as a pure function of the simulated time, so
they need no stored state. The viewer evaluates the same function every frame with the
server clock, so it sees the same pedestrians and they move smoothly. Pedestrians
have their own real-time clock (simulated time ÷ the server scale), so they walk at
1.4 m/s on screen; a walk lasts `walkSeconds` (20 min, about 1.7 km) and each
pedestrian has its own phase, so they do not all respawn together.
Up to `max` (12,000) pedestrians follow the traffic demand of the simulated hour;
tune `CONFIG.pedestrians` in `src/config.js`. The maximum is also a server parameter
(`maxPedestrians`, slider in the **Peatones (servidor)** panel; it needs the token).

### Pedestrian sensors

In the **Peatones (servidor)** panel, *Colocar sensor de peatones* places a sensor on a
street (Esc cancels, Supr deletes the selected one). Every 5 simulated minutes
(`CONFIG.pedestrianSensors.bucketSeconds`) the server records, per sensor, how many
pedestrians walked past on the sidewalks of that street (both directions) and crossed at
the crossings within `radius` (20 m), and how many were present in that area. They are
computed from the same flow model that generates the pedestrians in the viewer
(`Pedestrians.flowAt`), not from the individual agents, so the cost does not depend on
how many there are, the numbers follow the demand curve and the `maxPedestrians`
setting, and the records are identical after a restart or a catch-up (Poisson noise
seeded by sensor and interval). Download them with **CSV de peatones** or
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

**Opción B: sin Docker**

```sh
npm run serve            # API en http://localhost:8080 (datos en data/smartcity.db)
npm run dev              # visor en otra terminal
```

En el visor, abre el panel **Servidor (datos continuos)**, escribe la URL de la
API (`http://localhost:8080`), conecta y añade sensores. El token es opcional:
si defines `SMARTCITY_TOKEN`, hay que introducirlo para modificar datos.

**Descargar el CSV** (fechas simuladas, `to` exclusivo):

```sh
curl -o trafico.csv "http://localhost/api/traffic.csv?from=2026-01-05T00:00:00Z&to=2026-02-01T00:00:00Z"
curl -o parkings.csv "http://localhost/api/parking.csv"
```

Variables de entorno principales (`SMARTCITY_TOKEN`, `DB_FILE`, `PORT`,
`CHECKPOINT_SECONDS`, `CORS_ORIGIN`): ver [DEPLOYMENT.md](DEPLOYMENT.md).

## Traffic scenarios

In the **Tráfico** panel, choose **Automático (calendario)**, **Laborable**, or
**Fin de semana**. Automatic mode uses the simulated UTC date: Monday–Friday
selects the weekday scenario; Saturday–Sunday selects the weekend scenario.
Forcing a scenario keeps that demand profile across calendar changes without
changing the clock. The selection is sent to the server (it needs the token if one
is set) and takes effect on its next physics step.

Edit `CONFIG.traffic` in `src/config.js` to configure:

- `scenario`: initial selection (`auto`, `weekday`, or `weekend`).
- `dailyVariation`: deterministic daily variation from 0 to 1 (default 0.1,
  or ±10%); set to 0 for exact, repeatable profile comparisons.
- `scenarios.weekday` and `scenarios.weekend`: each has `hourly`, exactly 24
  finite numbers between 0 and 1 for UTC hours 00:00–23:00, and `multiplier`,
  a finite non-negative intensity factor. A multiplier of 0 disables demand.

The weekday curve retains the original commute peaks. The weekend curve has
later daytime peaks and a default multiplier of 0.65. These are illustrative
profiles, not calibrated traffic measurements. Values interpolate linearly
between hours, including from 23:00 to that profile's 00:00. Automatic mode
switches profiles at midnight; daily variation also changes then.

The population target is the peak-car slider value × interpolated hourly value
× scenario multiplier × daily variation factor. Existing vehicle logic rounds
and caps the target at `CONFIG.cars.max` and adds/removes up to 20 cars per
physics step. Demand may exceed 100% with increased multipliers or variation;
the vehicle cap still applies. Routing, signals, and sensor collection are
unchanged. Configuration is validated and copied when the demand model is
created; reload after editing it. `CONFIG.sim.baseDate` defines the simulation's
UTC calendar origin and need not be a Monday.

## Parking occupancy tracking

In **Aparcamiento (OSM) → Ocupación registrada por el servidor**, tick the public
underground parkings (the "P" icons) you want to record, or click their icon on
the map (tracked icons are drawn larger). **Todos**/**Ninguno** select everything
or nothing. The selection is stored in the server, not in the browser.

Each sampling interval (default 5 min of simulated time, `CONFIG.parkingTracking`)
the server stores a record per tracked parking with
`timestamp, weekday, parking_id, parking_name, capacity, occupied, free,
occupancy_pct`. Download them from **Servidor (datos continuos) → CSV de
parkings**. Occupancy is simulated from the demand curve, and capacity is
a default estimate when OSM does not provide it; these are not real measurements.

## Checks

```sh
npm test
npm run build
```

Tests use Node's built-in test runner and synthetic road data; no browser,
network, or downloaded city dataset is needed for the tests.
