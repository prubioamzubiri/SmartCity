import { validateMunicipalSnapshot } from '../data/municipal.js';
import { matchSpeedLimits } from '../data/speedLimits.js';
import { createMunicipalLayers } from '../city/municipalLayers.js';

export function createMunicipalPanel({ scene, graph, city, experiment, clock, sensors }) {
  const panel = document.createElement('section');
  panel.innerHTML = `<h3>Datos municipales</h3>
    <p>Capas oficiales de Datos Abiertos / GeoDonostia. Los coches y aforos siguen siendo simulados.</p>
    <button type="button" data-load>Cargar datos oficiales</button>
    <p role="status" aria-live="polite">Sin cargar.</p>
    <fieldset disabled>
      <label><input type="checkbox" name="roads" checked> Ejes viales oficiales · azul</label>
      <label><input type="checkbox" name="speedLimits"> Límites: ≤30 verde · ≤50 naranja · >50 rosa · sin dato gris</label>
      <label><input type="checkbox" name="stations" checked> Estaciones Dbizi · violeta</label>
      <label><input type="checkbox" name="applyLimits"> Usar límites oficiales en tramos coincidentes</label>
      <p>Activar o desactivar límites pausa y borra las mediciones actuales. Coincidencia geométrica aproximada; no sustituye la red OSM.</p>
    </fieldset>
    <p data-selection>Haz clic sobre una capa para consultar su nombre.</p>
    <p data-source></p>
    <p><a href="https://www.donostia.eus/datosabiertos/catalogo/ejes-viales" target="_blank" rel="noopener">Datos Abiertos</a> ·
    <a href="https://www.donostia.eus/es/geodonostia" target="_blank" rel="noopener">GeoDonostia</a></p>`;
  const button = panel.querySelector('[data-load]');
  const status = panel.querySelector('[role=status]');
  const fieldset = panel.querySelector('fieldset');
  const apply = panel.querySelector('[name=applyLimits]');
  let view = null, snapshot = null, mapping = null, loading = false;
  const baseSpeed = graph.speed.slice();
  const checkboxes = [...fieldset.querySelectorAll('input')];
  const showStatus = () => {
    status.textContent = `Descargado: ${new Date(snapshot.fetchedAt).toLocaleString('es-ES')} · ${snapshot.layers.roads.length} ejes · ${snapshot.layers.speedLimits.length} límites · ${snapshot.layers.stations.length} estaciones. Coinciden ${mapping.matched} de ${graph.edgeCount} tramos dirigidos OSM. ${apply.checked ? 'Límites aplicados.' : 'Modelo de velocidades original.'}`;
  };
  button.onclick = async () => {
    if (loading || snapshot || experiment.status === 'running') return;
    loading = true;
    button.disabled = true;
    status.textContent = 'Cargando instantánea municipal…';
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}data/municipal.json`);
      if (!response.ok) throw new Error(`HTTP ${response.status}. Ejecuta npm run fetch-municipal antes de construir.`);
      const data = validateMunicipalSnapshot(await response.json(), city.origin);
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ origin: data.origin, layers: data.layers })));
      const digest = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
      if (digest !== data.datasetId) throw new Error('La huella de los datos municipales no coincide.');
      mapping = matchSpeedLimits(graph, data.layers.speedLimits);
      view = createMunicipalLayers(scene, data);
      snapshot = data;
      showStatus();
      const source = panel.querySelector('[data-source]');
      source.textContent = 'Donostiako Udala - Ayuntamiento de Donostia / San Sebastián. GeoDonostia. ';
      const licence = document.createElement('a');
      licence.href = 'https://creativecommons.org/licenses/by/4.0/';
      licence.textContent = 'CC BY 4.0';
      licence.target = '_blank'; licence.rel = 'noopener'; source.append(licence);
      button.hidden = true;
    } catch (error) {
      status.textContent = `No se pudieron cargar los datos municipales: ${error.message} Puedes reintentar; el simulador sigue disponible.`;
    } finally { loading = false; button.disabled = false; }
  };
  for (const checkbox of checkboxes) checkbox.onchange = () => {
    if (!snapshot) return;
    if (checkbox === apply) {
      if (experiment.status === 'running') { apply.checked = !apply.checked; return; }
      graph.speed.set(baseSpeed);
      graph.speedCaps = apply.checked ? mapping.limits : null;
      if (apply.checked) for (let e = 0; e < graph.edgeCount; e++) graph.speed[e] = Math.min(baseSpeed[e], mapping.limits[e]);
      graph.municipalContext = apply.checked ? {
        datasetId: snapshot.datasetId, fetchedAt: snapshot.fetchedAt,
        sources: snapshot.sources, attribution: snapshot.attribution, licenceUrl: snapshot.licenceUrl,
        matchedEdges: mapping.matched, algorithm: mapping.algorithm, maxDistanceMetres: mapping.distance,
        minAlignment: mapping.alignment,
        edgeLimitsKmh: [...mapping.limits].flatMap((limit, edge) => Number.isFinite(limit) ? [[edge, Math.round(limit * 36) / 10]] : []),
      } : null;
      clock.scale = 0;
      sensors.resetMeasurements(clock.simTime);
      showStatus();
    } else view.layers[checkbox.name].visible = checkbox.checked;
  };
  return {
    panel,
    update() {
      fieldset.disabled = !snapshot;
      apply.disabled = !snapshot || experiment.status === 'running';
      button.disabled = loading || experiment.status === 'running';
    },
    pick(raycaster) {
      const selected = view?.pick(raycaster);
      if (selected) panel.querySelector('[data-selection]').textContent = selected;
      return selected;
    },
  };
}
