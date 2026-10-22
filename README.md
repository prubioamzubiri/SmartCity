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
`public/data/city.json` (not tracked in Git).

## Traffic scenarios

In the **Tráfico** panel, choose **Automático (calendario)**, **Laborable**, or
**Fin de semana**. Automatic mode uses the simulated UTC date: Monday–Friday
selects the weekday scenario; Saturday–Sunday selects the weekend scenario.
Forcing a scenario keeps that demand profile across calendar changes without
changing the clock. A selection takes effect on the next physics step; while
paused, vehicle counts update when the simulation resumes.

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

## Checks

```sh
npm test
npm run build
```

Tests use Node's built-in test runner and synthetic road data; no browser,
network, or downloaded city dataset is needed for the tests.

## Reproducible experiments

The **Experimentos** panel runs an educational traffic experiment from an empty
vehicle population at 07:00 on the configured base date. Set the unsigned 32-bit
seed, weekday/weekend demand profile, peak vehicle count (0–3000), duration
(1–1440 simulated minutes), and global green time (5–180 seconds). Click
**Iniciar / repetir** to reset vehicles and measurements while retaining sensor
placements. Starting a run clears current records and the pending upload queue;
automatic upload is turned off. Existing signal plans are replaced by the
selected global timing. Traffic and sensor editing are locked during the run;
clock buttons still allow pausing or changing playback speed.

The run pauses automatically at the exact duration. **Detener** ends it early
and marks the export as cancelled. **Exportar experimento JSON** downloads a
snapshot containing the settings, model configuration, SHA-256 city-data
identifier, sensor placements and IDs, completed measurement buckets, partial
sensor buckets, and a summary. JSON is available even when no sensors are placed;
place sensors before starting to collect crossing measurements. The existing
CSV export contains only completed sensor buckets; use experiment JSON to retain
its settings and any partial bucket. Speeds in partial buckets are accumulated
in metres per second (`speedSum`); divide by the crossing count and multiply by
3.6 to obtain the crossing-weighted average in km/h.

Compare runs by keeping seed, dataset, sensor placements and bucket interval
identical, then changing only the scenario or green time. The same settings and
simulation version reproduce the same fixed-step trajectory regardless of
playback speed. The city download can change between deployments; compare the
dataset identifiers too. Re-enter the exported settings in the panel to repeat a
run; importing an experiment JSON is not currently supported.

Summary metrics are arithmetic means sampled after every 0.25-second physics
step: active vehicles, stopped vehicles (speed below 0.5 m/s), and the fleet's
average speed. Mean speed includes empty-population samples as zero and is not
weighted by distance or vehicle count. Sensor crossings sum events across all
sensors, so a vehicle may be counted more than once. Runs include initial
population growth with no warm-up period. These simulated measurements are not
calibrated real-world observations.

## Official municipal mobility data

The **Datos municipales** panel connects the simulator to the city council's
[Datos Abiertos catalogue](https://www.donostia.eus/datosabiertos/) and
[GeoDonostia](https://www.donostia.eus/es/geodonostia) transport service.
Use **Cargar datos oficiales** to load a same-origin snapshot and toggle:

- Official road centre-lines (blue).
- Legal speed limits (green ≤30, orange ≤50, pink >50 km/h; grey means unknown).
- Dbizi station locations (violet). These are locations, not live bike availability.

Click a displayed layer to inspect a road/station name and, where available,
its legal limit. These overlays do not replace the OSM routing graph.

To refresh locally, first generate `public/data/city.json`, then run:

```sh
npm run fetch-municipal
npm run build
npm run preview
```

The downloader uses the official GeoDonostia `ext/GARRAIOA/MapServer` layers
19 (road network), 26 (legal limits), and 3 (Dbizi). It retrieves all feature
IDs and downloads explicit batches because the service does not support offset
pagination and limits ordinary queries to 2000 records. It checks completeness,
requests WGS84 coordinates (`outSR=4326`), projects into the same metre system as
OSM, and writes the snapshot atomically only after all layers pass validation.
CKAN metadata supplies dataset references and metadata-modification dates;
these dates are not observation times. The snapshot includes a download time,
SHA-256 fingerprint, and source references. The browser verifies the fingerprint.

The ignored `public/data/municipal.json` is regenerated by the Pages workflow
before each build and copied to `dist/data/municipal.json`. Requests to the
municipality happen during data generation, avoiding browser CORS dependencies.
This is a deployment-time snapshot, not a live feed. A failed generation stops
deployment, preserving the previously deployed site. A missing/invalid snapshot
in a local build shows a retryable panel error without blocking the simulator.

**Usar límites oficiales en tramos coincidentes** optionally caps vehicle speed
on approximately matched OSM edges; unmatched edges retain the original model.
Matching requires near-parallel geometry (absolute alignment ≥0.97) within 8 m
at 10%, 50%, and 90% of each edge, with the same legal limit at all three samples.
Equally close conflicting limits are rejected. This heuristic cannot reliably
disambiguate every parallel road, grade-separated crossing, or directional
restriction; it is not a verified road-ID correspondence. It lowers the original
class-based speed where needed and caps driver speed variation at the legal
limit. It does not increase the original class-based cruising speed.
Changing this setting pauses the simulation and clears current measurements.
It is locked during experiments. JSON experiment exports retain the active
municipal fingerprint, attribution, matching parameters, and matched edge caps;
`dataOrigin` remains `simulated`. Layer visibility has no effect on physics.

The first verified snapshot contains 9605 roads, 7362 speed-limit features,
and 69 stations. With the current local OSM snapshot, 41216 of 46522 directed
edges match. Counts and matches may change on refresh.

Visible attribution follows the [GeoDonostia reuse terms](https://www.donostia.eus/es/geodonostia):
Donostiako Udala - Ayuntamiento de Donostia / San Sebastián. GeoDonostia.
The portal states CC BY 4.0 for GeoDonostia content; CKAN's individual licence
fields were empty when checked, so preserve source metadata when reusing exports.

### Traffic calibration status

These sources provide official geometry and legal limits; simulated speeds,
vehicle demand, counts, and sensor readings remain model outputs. A search of
the current catalogue for `aforos` and `trafico` did not identify an accessible
observed traffic-count/speed resource. Older search-index entries mention road
counts for 2020/2021, but those resources were not available in the current
catalogue during this integration. Do not use legal limits as observed speeds
or present this version as calibrated to measured traffic. Connecting an
accessible observed series with station locations, units, timestamps, and
licensing remains the next step.
