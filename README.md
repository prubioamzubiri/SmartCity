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
