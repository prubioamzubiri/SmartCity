# SmartCity Donostia — Development roadmap

Last updated: 2026-10-28

## Prototype objective

Deliver a demonstrable Donostia traffic simulation in which users can explore the city, compare weekday and weekend demand, adjust traffic signals, place virtual sensors, and export measurements for analysis. Connecting those measurements to the project's Big Data platform is a separate integration milestone whose backend contract still needs to be agreed.

This is a living roadmap: update the relevant checklist and progress log whenever a feature or fix is completed. Record verification evidence before marking a milestone complete. Priorities below are a proposed development order, without committed dates.

## Current baseline

The following features are present in the source; browser acceptance checks remain open below.

- [x] Vite and Three.js application with city-data download commands.
- [x] City scene with roads, buildings, water, and camera controls.
- [x] Vehicle simulation, traffic signals, clock controls, and population controls.
- [x] Automatic calendar, weekday, and weekend traffic demand profiles.
- [x] Sensor placement, naming, deletion, and browser-local configuration storage.
- [x] Measurement aggregation, CSV export, and sensor JSON import/export.
- [x] Traffic-signal plan loading from a file or URL.
- [x] Frontend measurement POST delivery with failed batches returned to the queue.
- [x] Automated demand and population tests: 10 tests passed on 2026-10-15.
- [x] Production build passed on 2026-10-15.
- [x] Headless simulation server with SQLite persistence, restart catch-up and CSV export (`server/`, Docker Compose, Fly.io).
- [x] Viewer driven by the server: clock, traffic parameters, signal plan, sensors, tracked parkings and cars all come from the API and survive a page reload.
- [x] OSM bicycle-rental stations shown on the map with modeled availability; bundled GeoDonostia Dbizi locations are the offline fallback.

The build currently reports a JavaScript chunk above 500 kB. Existing automated tests do not establish browser usability, sensor accuracy, signal correctness, or backend delivery reliability. Traffic profiles are illustrative, not calibrated measurements.

## 1. Validate the complete local demo — next

- [ ] Verify a fresh setup using the README and downloaded city data.
- [ ] Check city rendering, camera movement, resizing, and browser console errors.
- [ ] Check pause/resume and each simulation speed.
- [ ] Check weekday/weekend switching and automatic calendar transitions.
- [ ] Place, rename, select, and delete sensors; reload and verify saved placement.
- [ ] Collect a completed measurement interval and inspect the exported CSV.
- [ ] Export/import sensor configuration and document whether import adds or replaces sensors.
- [ ] Apply global signal timing and load valid/invalid signal plans.
- [ ] Record reproducible defects and fix any that block the demo.

**Complete when:** the full workflow can be demonstrated from a fresh launch, with documented steps and no blocking errors.

## 2. Make measurements and controls dependable

- [ ] Add focused sensor tests for directional counts, average speeds, interval boundaries, and empty intervals.
- [ ] Define and test what happens to partial measurements when the interval changes.
- [ ] Document timestamp timezone, coordinate system, units, and CSV field meanings.
- [ ] Validate sensor imports and show useful errors for invalid files or unavailable browser storage.
- [ ] Define stable sensor identity across reloads and exports for downstream analysis.
- [ ] Add focused signal-plan validation and signal-transition tests.
- [ ] Document simulation limits at high speeds and verify that clock and measurement behavior remain consistent.

**Complete when:** synthetic scenarios produce known counts and speeds, configuration errors are handled clearly, and exported data has a documented interpretation.

## 3. Connect the Big Data pipeline

**Dependency:** agree on the receiving service, request schema, authentication requirements, and storage destination.

- [ ] Document the measurement API contract and provide a sample payload.
- [ ] Implement or connect the agreed receiving endpoint and storage.
- [ ] Prevent overlapping sends and define retry, duplicate handling, and queue limits.
- [ ] Decide whether unsent measurements must survive page reloads.
- [ ] Test successful delivery, rejected requests, network failures, and recovery.
- [ ] Verify that stored records match an exported local dataset.

**Complete when:** a controlled simulation run reaches the agreed data store with verified counts and documented failure/recovery behavior.

## 4. Support repeatable experiments

- [ ] Save the scenario, signal settings, sensor configuration, and simulation period used for an experiment.
- [ ] Add a clear reset/start workflow and define repeatability requirements for vehicle generation.
- [ ] Produce comparable weekday/weekend runs and signal-timing experiments.
- [ ] Summarize vehicle counts, stopped vehicles, average speeds, and sensor throughput with their limitations.
- [ ] Provide one documented example experiment and its exported results.

**Complete when:** another person can follow the example and explain the differences between runs using the recorded settings and measurements.

## 5. Prepare the prototype handoff

- [ ] Check performance at representative vehicle and sensor counts on the target computer; record the browser and hardware.
- [ ] Investigate the build-size warning and optimize where measurements justify it.
- [ ] Improve loading/error feedback and panel usability at the target screen sizes.
- [ ] Document setup, controls, data refresh, troubleshooting, and known limitations.
- [ ] Verify the production preview includes the required city dataset.
- [ ] Run the automated checks and complete the manual demo checklist after the final changes.
- [ ] Prepare a short demo script covering city exploration, scenario changes, sensing, and export.

**Complete when:** someone unfamiliar with the code can install, run, and demonstrate the prototype using the documentation. Mark backend integration separately if its dependency is still unresolved.

## Progress log

| Date | Change | Evidence / remaining work |
| --- | --- | --- |
| 2026-10-15 | Established the roadmap and reviewed the existing implementation. | `npm test`: 10 passed. `npm run build`: passed with a chunk-size warning. Browser acceptance and backend integration remain to be verified. |
| 2026-10-28 | Viewer made server-driven (`ServerSync`, `GET /api/cars`, live sensor/parking values in `GET /api/state`); cars glide between server snapshots. Compose stack tested in Codespaces. | `npm test`: 34 passed. `npm run build`: passed. Compose: `/api/health`, `/`, `/data/city.json` return 200 through the proxy; clock, params and a sensor survive `docker compose restart sim`. Codespaces needs `iptables-legacy` forwarding between containers (see DEPLOYMENT.md). Local sensors, sensor import/export and the Big Data POST from the browser were removed; browser acceptance (rendering, console errors, car motion at ×52) is still unverified. |
| 2026-11-02 | Station docks can be edited per station or with JSON (`PUT /api/bikes/capacity`); the change takes effect after 30 simulated days. | Tests for scheduling, validation, snapshot and API; build. |
| 2026-11-02 | Pedestrians now take the bikes by themselves: server-side `BikeNetwork` (snapshot, `/api/bikes`, `/api/bikes.csv`, tracked stations); manual loan buttons removed. | Tests (`bikeStations`, `bikesServer`), build and a Docker Compose run (69 stations, riders, CSV). Counts remain simulated, not physical sensors. |
| 2026-11-02 | Added OSM bicycle-rental station extraction and a map layer with modeled availability counters. | Focused extraction and inventory tests plus build; live station data must be refreshed with `npm run fetch-bikes`. Counts are not connected to physical sensors or an operator API. |
| 2026-11-02 | City events: deterministic yearly calendar (football, basketball, concerts, film festival, Semana Grande, Jazzaldia, protests...), extra demand with arrival/departure ramps, cars attracted to the venue, map markers, calendar panel (top right), `GET /api/events` and `events` in `GET /api/state`. | `test/events.test.js`, `npm test`, build and a browser run against a local server (event active: ring, HUD line and panel). Attendances and dates are illustrative, not real data; pedestrians do not yet gather around the venue. |
| 2026-11-03 | Events CSV export (`/api/events.csv`, attendance only once the event has ended) and weather: deterministic Donostia-like climate, rain and temperature change demand, pedestrians, bikes and car speed; 48 h forecast with error growing with lead time (`GET /api/weather`, `/api/weather.csv`, **Tiempo** panel). | `test/events.test.js`, `test/weather.test.js`, `npm test`, build and a browser run. Weather effects are illustrative, not calibrated; the forecast history (what was forecast at each moment) is not exported yet. |

For each future update, record the completed work, relevant tests or manual checks, and any remaining limitation. Keep unfinished tasks unchecked and revise this roadmap when requirements change.
