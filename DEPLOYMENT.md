# GitHub Pages

The production URL is https://rbarrenago.github.io/SmartCity/.
`vite.config.js` sets `/SmartCity/` as the base for assets and the existing
`CONFIG.dataUrl`, which uses Vite's `import.meta.env.BASE_URL`.

In the GitHub repository, select **Settings → Pages → Build and deployment →
Source → GitHub Actions** before deploying.

`.github/workflows/deploy.yml` runs on pushes to `main` or manual dispatch.
It installs locked dependencies with Node 24, runs `npm run fetch-osm` to
generate the ignored `public/data/city.json`, builds with Vite, uploads `dist`,
and deploys the artifact to the `github-pages` environment. Generation requires
the public Overpass service; a failed download stops the build and deployment.

To reproduce locally:

```sh
npm ci
npm run fetch-osm
npm run build
npm run preview
```

Open http://localhost:4173/SmartCity/. Confirm the city and traffic render and
that the browser loads JavaScript and CSS under `/SmartCity/assets/` and JSON
at `/SmartCity/data/city.json` successfully. Vite copies `public/data/city.json`
into `dist/data/city.json`; the JSON should contain nonempty buildings, nodes,
and ways arrays. An existing local dataset can be reused for previewing by
skipping `fetch-osm`.

# Simulation server (continuous sensors)

GitHub Pages only serves the static viewer. To keep the sensors recording while
no browser is open, run the headless simulation server (`server/`). It reuses
the same engine as the viewer (`src/core/engine.js`), ties simulated time to the
wall clock and stores everything in SQLite.

- **Time scale**: one real week is one simulated year (`365/7 ≈ ×52.14`). It is
  fixed when the database is created; `SIM_SCALE` only applies to a new
  database.
- **Catch-up**: the engine state (cars, signals, sensors, RNG) is checkpointed
  every `CHECKPOINT_SECONDS` (default 30) in one transaction together with the
  records produced since the previous checkpoint. After a restart or crash the
  server resumes from the last checkpoint and simulates up to "now"; because the
  simulation is deterministic, the CSV is identical to an uninterrupted run. On
  the real city it runs about 28× faster than the ×52 needed, so one day of
  downtime takes roughly 50 minutes to recover. The API stays responsive and
  `GET /api/state` reports `caughtUp` and `behindSimSeconds`.
- **Requirements**: Node ≥ 24 (uses the built-in `node:sqlite`) and the map in
  `public/data/city.json` (`npm run fetch-osm`).

```sh
SMARTCITY_TOKEN=change-me npm run serve   # http://localhost:8080
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port |
| `DB_FILE` | `data/smartcity.db` | SQLite file (keep it on a persistent disk) |
| `CITY_FILE` | `public/data/city.json` | Map data |
| `SMARTCITY_TOKEN` | – | Optional bearer token for writes. Without it, anyone can modify the city |
| `CORS_ORIGIN` | `*` | Allowed browser origin (e.g. the GitHub Pages URL) |
| `CHECKPOINT_SECONDS` | `30` | Checkpoint interval |

## API

Reads are public; `POST`/`PUT`/`PATCH`/`DELETE` need
`Authorization: Bearer $SMARTCITY_TOKEN`. Positions are scene coordinates in
metres (`x`, `z`), as in the viewer. Dates are simulated ISO timestamps
(`from` inclusive, `to` exclusive, e.g. `2026-03-01T00:00`).

| Endpoint | Description |
| --- | --- |
| `GET /api/state` | Simulated time, scale, sensors, parkings, params, signal plan, record counts |
| `GET /api/traffic.csv?from=&to=&id=` | Sensor records (`id` = sensor id, optional) |
| `GET /api/parking.csv?from=&to=&id=` | Parking occupancy records |
| `POST /api/sensors` `{x, z, name}` | Create a sensor |
| `PATCH /api/sensors/:id` `{name}` / `DELETE /api/sensors/:id` | Rename / remove (history is kept) |
| `PUT /api/parking/tracked` `{ids: [...]}` | Parkings to record |
| `PUT /api/params` `{maxCars, scenario}` | Traffic parameters |
| `PUT /api/signals/plan` `{plan}` | Signal timing plan |

```sh
curl -o trafico.csv "https://<app>.fly.dev/api/traffic.csv?from=2026-01-05T00:00&to=2026-02-01T00:00"
```

## Viewer panel

The **Servidor (datos continuos)** section of the HUD connects the viewer to
this API: enter the server URL (or build with `VITE_API_URL`, e.g. in the deploy
workflow) and, to modify data, the token (kept only in `sessionStorage`). It
shows the server's simulated time, lists and places sensors on the server
(green markers; the browser's own orange sensors are separate), sends the
tracked parkings, and downloads the CSV for a date range (the browser streams
the file, so year-long exports do not fill memory). Set `CORS_ORIGIN` to the
viewer's origin.

The viewer's cars are still its own local simulation: **Usar hora del servidor**
only aligns the clock and speed.

## Deploying on Fly.io

Files are already prepared: `Dockerfile` and `fly.toml` (persistent volume on
`/data`, machine never auto-stopped).

```sh
npm run fetch-osm                      # the image needs public/data/city.json
fly auth login
fly launch --no-deploy --copy-config   # pick a unique app name
fly volumes create smartcity_data --size 1 --region mad
# opcional: fly secrets set SMARTCITY_TOKEN=$(openssl rand -hex 24)
fly deploy
```

Run a single machine only: SQLite and the simulation clock live in one process.
Back up the volume with `fly volumes snapshots`.

## Docker Compose (VPS propio)

Tres servicios: `sim` (simulación + API + SQLite en el volumen `sim-data`),
`web` (nginx con el visor) y `proxy` (Caddy, único punto de entrada: `/api` → `sim`, `/` → `web`, HTTPS automático).

```sh
npm run fetch-osm              # la imagen web necesita public/data/city.json
cp .env.example .env           # editar DOMAIN (y SMARTCITY_TOKEN si quieres proteger las escrituras) (p. ej. smartcity.midominio.com)
docker compose up -d --build
```

- Con `DOMAIN=:80` solo se sirve HTTP (pruebas); con un dominio real Caddy obtiene el certificado.
- Backup: copiar el volumen `sim-data`. No escales `sim` a más de una réplica.
- Parada limpia: `docker compose stop` (deja un checkpoint final); `down -v` borra los datos.
- Nota: en algunos entornos (p. ej. Codespaces) el tráfico entre contenedores está bloqueado y el proxy devuelve 502; en un VPS normal funciona.
