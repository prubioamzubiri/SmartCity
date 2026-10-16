# SmartCity Donostia — Development roadmap

Last updated: 2026-10-15

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
| 2026-10-16 | Added seeded experiments with clean resets, weekday/weekend demand, configurable duration and global green time, automatic stop, and JSON settings/results export. | Automated repeatability and scenario checks plus local browser completion/export verification. Live publication pending. |
| 2026-10-16 | Connected official road, speed-limit and Dbizi layers; added optional approximate speed caps and experiment provenance. | Complete API download, 19 automated checks, and local browser verification. Observed-count calibration remains open; municipal layers are snapshots. |

For each future update, record the completed work, relevant tests or manual checks, and any remaining limitation. Keep unfinished tasks unchecked and revise this roadmap when requirements change.
