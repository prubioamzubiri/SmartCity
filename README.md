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
