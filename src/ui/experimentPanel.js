import { CONFIG } from '../config.js';

export function createExperimentPanel(experiment, onStart) {
  const panel = document.createElement('section');
  panel.innerHTML = `<h3>Experimentos</h3>
    <p>Compara ejecuciones con la misma semilla, mapa y sensores.</p>
    <form>
      <label>Semilla <input name="seed" type="number" min="0" max="4294967295" value="42" required></label>
      <label>Escenario <select name="scenario"><option value="weekday">Laborable</option><option value="weekend">Fin de semana</option></select></label>
      <label>Coches en hora punta <input name="maxCars" type="number" min="0" max="${CONFIG.cars.max}" value="1500" required></label>
      <label>Duración (min simulados) <input name="durationMinutes" type="number" min="1" max="1440" value="15" required></label>
      <label>Verde (s) <input name="green" type="number" min="5" max="180" value="20" required></label>
      <button type="submit">Iniciar / repetir</button>
    </form>
    <button type="button" data-stop>Detener</button>
    <button type="button" data-export>Exportar experimento JSON</button>
    <p role="status" aria-live="polite"></p>
    <p>Iniciar borra las mediciones actuales. El resultado incluye ajustes, resumen y datos de sensores.</p>`;
  const form = panel.querySelector('form');
  const status = panel.querySelector('[role=status]');
  form.addEventListener('submit', event => {
    event.preventDefault();
    try { onStart(Object.fromEntries(new FormData(form))); }
    catch (error) { status.textContent = error.message; }
  });
  panel.querySelector('[data-stop]').onclick = () => experiment.finish();
  panel.querySelector('[data-export]').onclick = () => {
    if (!experiment.result) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(experiment.result, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `experimento-${experiment.settings.scenario}-${experiment.settings.seed}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return { panel, update() {
    const running = experiment.status === 'running';
    for (const control of form.elements) control.disabled = running;
    panel.querySelector('[data-stop]').disabled = !running;
    panel.querySelector('[data-export]').disabled = !experiment.result;
    if (running) status.textContent = `En curso: ${((experiment.clock.simTime - experiment.startTime) / 60).toFixed(1)} / ${experiment.settings.durationMinutes} min`;
    else if (experiment.result) {
      const result = experiment.result;
      status.textContent = `${result.status === 'completed' ? 'Completado' : 'Detenido'} · Velocidad media: ${result.summary.meanSpeedKmh.toFixed(1)} km/h · Parados: ${result.summary.meanStoppedVehicles.toFixed(1)} · Cruces por sensores: ${result.summary.sensorCrossings}`;
    }
  } };
}
