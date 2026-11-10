// Evaluación con escenarios ocultos: ejecuta el gestor de cada grupo contra ciudades con otra semilla y otras fechas,
// y lo puntúa con la misma métrica que el panel frente a la misma ciudad sin gestor.
//
//   node evaluar.mjs evaluacion.json
//
// Necesita Node 24 o posterior y Docker. Ver README.md.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Collector, parseCsv } from '../panel/collector.js';
import { METRIC, rowsToBuckets, scoreWindow } from '../panel/metric.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const COURSE_SCALE = 365 / 7;
const BASE_DATE = Date.UTC(2026, 0, 5);
const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';

// Ejecuta un comando y devuelve su salida; `input` se pasa por la entrada estándar.
// Con `merge`, devuelve también lo que el comando escribe en stderr (p. ej. los errores de un gestor en `docker logs`).
function run(cmd, args, { input, env, merge = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    if (input !== undefined) p.stdin.end(input);
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve(merge ? `${out}${err}`.trim() : out.trim());
      else reject(new Error(`${cmd} ${args.slice(0, 3).join(' ')}… terminó con código ${code}:\n${(err || out).trim().split('\n').slice(-15).join('\n')}`));
    });
  });
}
const docker = (args, opts) => run('docker', args, opts);

// --- Configuración -------------------------------------------------------------------------------------------------

export function readConfig(file) {
  const base = path.dirname(path.resolve(file));
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  const scale = c.escalaReloj ?? COURSE_SCALE;
  if (!(scale > 0)) throw new Error('escalaReloj debe ser un número positivo');
  if (!Array.isArray(c.escenarios) || !c.escenarios.length) throw new Error('Falta la lista "escenarios"');
  if (!Array.isArray(c.grupos) || !c.grupos.length) throw new Error('Falta la lista "grupos"');
  const escenarios = c.escenarios.map((s, i) => {
    const nombre = s.nombre ?? `escenario-${i + 1}`;
    if (!Number.isInteger(s.semilla)) throw new Error(`${nombre}: "semilla" debe ser un entero`);
    if (!Number.isFinite(Date.parse(`${s.inicio}Z`)) || Date.parse(`${s.inicio}Z`) < BASE_DATE) throw new Error(`${nombre}: "inicio" debe ser una fecha desde 2026-01-05, p. ej. 2026-03-16T00:00`);
    if (!(s.horas > 0)) throw new Error(`${nombre}: "horas" debe ser positivo`);
    return { nombre, semilla: s.semilla, inicio: s.inicio, horas: s.horas };
  });
  const grupos = c.grupos.map((g) => {
    if (!g.nombre) throw new Error('Cada grupo necesita "nombre"');
    // carpeta null = grupo de control sin gestor (debe dar 50: comprueba que la evaluación es justa).
    const carpeta = g.carpeta === null ? null : path.resolve(base, g.carpeta ?? g.nombre);
    if (carpeta && !fs.existsSync(carpeta)) throw new Error(`${g.nombre}: no existe la carpeta ${carpeta}`);
    const comando = g.comando ?? ['python', 'gestor.py'];
    if (carpeta && !g.comando && !fs.existsSync(path.join(carpeta, 'gestor.py'))) throw new Error(`${g.nombre}: falta gestor.py en ${carpeta} (o indica "comando")`);
    return { nombre: g.nombre, carpeta, comando };
  });
  return {
    scale,
    escenarios,
    grupos,
    imagenPython: c.imagenPython ?? 'python:3.12-slim',
    imagenSimulador: c.imagenSimulador ?? null,
    salida: path.resolve(base, c.salida ?? 'resultados'),
    consultaSegundos: c.consultaSegundos ?? 5,
    limites: { memoria: c.memoriaGestor ?? '1g', cpus: String(c.cpusGestor ?? 1) },
  };
}

// --- Imágenes ------------------------------------------------------------------------------------------------------

async function buildImages(config, runId) {
  let sim = config.imagenSimulador;
  if (!sim) {
    sim = `smartcity-eval-sim:${runId}`;
    log(`Construyendo el simulador (${root})…`);
    await docker(['build', '-q', '-t', sim, root]);
  }
  const images = new Map();
  for (const g of config.grupos) {
    if (!g.carpeta) continue;
    const tag = `smartcity-eval-${slug(g.nombre)}:${runId}`;
    log(`Construyendo el gestor de ${g.nombre}…`);
    // El Dockerfile va por la entrada estándar: no se escribe nada en la carpeta del grupo.
    const dockerfile = [
      `FROM ${config.imagenPython}`,
      'WORKDIR /gestor',
      'COPY . .',
      'RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; fi',
      'ENV PYTHONUNBUFFERED=1',
      `CMD ${JSON.stringify(g.comando)}`,
    ].join('\n');
    try {
      await docker(['build', '-q', '-t', tag, '-f', '-', g.carpeta], { input: dockerfile });
      images.set(g.nombre, { tag });
    } catch (err) {
      log(`  ✗ ${g.nombre}: no se pudo construir (${err.message.split('\n')[0]}). Se evalúa sin gestor.`);
      images.set(g.nombre, { error: `No se pudo construir el gestor: ${err.message}` });
    }
  }
  return { sim, images };
}

// --- Un escenario --------------------------------------------------------------------------------------------------

async function reference(s, scale) {
  const out = await run(process.execPath, [path.join(here, 'referencia.mjs'), String(s.horas), String(scale)], {
    env: { SCENARIO_SEED: String(s.semilla), SCENARIO_START: s.inicio },
  });
  return JSON.parse(out).rows;
}

async function startCity(name, s, config, simImage, token) {
  await docker(['network', 'create', '--internal', name]);
  await docker([
    'run', '-d', '--name', `${name}-sim`, '-p', '127.0.0.1::8080',
    '-e', `SMARTCITY_TOKEN=${token}`, '-e', `SCENARIO_SEED=${s.semilla}`, '-e', `SCENARIO_START=${s.inicio}`,
    '-e', `SIM_SCALE=${config.scale}`, '-e', 'DB_FILE=/data/ciudad.db',
    // Checkpoints frecuentes: las filas del histórico se graban en cada uno y el evaluador las necesita al acabar.
    '-e', 'CHECKPOINT_SECONDS=2', simImage,
  ]);
  // La ciudad está en la red interna (para el gestor) y publicada solo en este equipo (para el evaluador).
  await docker(['network', 'connect', '--alias', 'sim', name, `${name}-sim`]);
  const port = (await docker(['port', `${name}-sim`, '8080'])).split('\n')[0].split(':').pop();
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) return url;
    } catch {
      // aún arrancando
    }
    if (i > 120) throw new Error(`La ciudad ${name} no arranca`);
    await sleep(500);
  }
}

async function cleanup(name) {
  await docker(['rm', '-f', `${name}-sim`, `${name}-gestor`]).catch(() => {});
  await docker(['network', 'rm', name]).catch(() => {});
}

async function runScenario(s, config, built, runId, dir) {
  const startMs = Date.parse(`${s.inicio}Z`);
  const fromSim = (startMs - BASE_DATE) / 1000;
  const toSim = fromSim + s.horas * 3600;
  const iso = (simSeconds) => new Date(BASE_DATE + simSeconds * 1000).toISOString().slice(0, 19);
  const minutes = ((s.horas * 3600) / config.scale / 60).toFixed(0);
  log(`Escenario «${s.nombre}»: semilla ${s.semilla}, ${s.inicio}, ${s.horas} h simuladas (~${minutes} min reales)`);
  fs.mkdirSync(dir, { recursive: true });

  const refPromise = reference(s, config.scale);
  const cities = config.grupos.map((g) => ({ g, name: `sceval-${runId}-${slug(s.nombre)}-${slug(g.nombre)}`, token: randomBytes(24).toString('hex') }));
  try {
    for (const c of cities) c.url = await startCity(c.name, s, config, built.sim, c.token);
    for (const c of cities) {
      const image = built.images.get(c.g.nombre);
      c.note = image?.error ?? null;
      if (!image?.tag) continue;
      await docker([
        'run', '-d', '--name', `${c.name}-gestor`, '--network', c.name, '--memory', config.limites.memoria, '--cpus', config.limites.cpus,
        '-e', 'SMARTCITY_URL=http://sim:8080', '-e', `SMARTCITY_TOKEN=${c.token}`, image.tag,
      ]);
      c.hasManager = true;
    }
    const collector = new Collector({ file: ':memory:', instances: cities.map((c) => ({ name: c.g.nombre, url: c.url, kind: 'group' })) });
    let last = 0;
    // Margen: el doble de lo previsto más 5 minutos. Si se agota, se puntúa con lo que haya.
    const deadline = Date.now() + ((s.horas * 3600) / config.scale) * 2000 + 300000;
    for (;;) {
      await collector.pollAll();
      for (const c of cities) {
        if (!c.hasManager || c.exit) continue;
        const [status, code] = (await docker(['inspect', '-f', '{{.State.Status}} {{.State.ExitCode}}', `${c.name}-gestor`])).split(' ');
        if (status === 'exited') {
          const at = collector.status.get(c.g.nombre).simSeconds ?? fromSim;
          c.exit = { code: Number(code), simTime: iso(at) };
          log(`  ! El gestor de ${c.g.nombre} ha terminado a las ${iso(at)} con código ${code}`);
        }
      }
      const behind = cities.map((c) => collector.status.get(c.g.nombre).simSeconds ?? 0);
      const done = Math.min(...behind);
      if (done >= toSim) break;
      if (Date.now() > deadline) {
        log(`  ! Tiempo agotado: alguna ciudad no ha llegado al final del escenario (${iso(done)})`);
        for (const c of cities) if ((collector.status.get(c.g.nombre).simSeconds ?? 0) < toSim) c.note = [c.note, `La ciudad no llegó al final del escenario: ${collector.status.get(c.g.nombre).error ?? 'va con retraso'}`].filter(Boolean).join(' · ');
        break;
      }
      if (Date.now() - last > 60000) {
        last = Date.now();
        log(`  ${s.nombre}: ${iso(done).replace('T', ' ')} de ${iso(toSim).replace('T', ' ')}`);
      }
      await sleep(config.consultaSegundos * 1000);
    }
    // Espera a que cada ciudad haya grabado la última fila del escenario (llega con su siguiente checkpoint).
    const lastRow = iso(Math.ceil(toSim / 300) * 300 - 300);
    for (const c of cities) {
      for (let i = 0; i < 60; i++) {
        const csv = await fetch(`${c.url}/api/city.csv?from=${lastRow}`).then((r) => r.text()).catch(() => '');
        if (csv.trim().split('\n').length > 1) break;
        await sleep(1000);
      }
    }
    const refRows = await refPromise;
    fs.writeFileSync(path.join(dir, 'referencia.json'), JSON.stringify(refRows));
    const refBuckets = rowsToBuckets(refRows.filter((r) => r.timestamp < iso(toSim)));
    const results = [];
    for (const c of cities) {
      if (c.hasManager) {
        await docker(['stop', '-t', '5', `${c.name}-gestor`]).catch(() => {});
        const logs = await run('docker', ['logs', '--tail', '5000', `${c.name}-gestor`], { merge: true }).catch((err) => err.message);
        fs.writeFileSync(path.join(dir, `${slug(c.g.nombre)}-gestor.log`), logs);
      }
      const csv = await (await fetch(`${c.url}/api/city.csv?from=${iso(fromSim)}&to=${iso(toSim)}`)).text();
      fs.writeFileSync(path.join(dir, `${slug(c.g.nombre)}-ciudad.csv`), csv);
      const events = collector.events(c.g.nombre, { fromSim, toSim });
      const count = (kind) => events.filter((e) => e.kind === kind).length;
      const score = scoreWindow(rowsToBuckets(parseCsv(csv)), refBuckets, { reversals: count('reversal'), suspensions: count('suspension') });
      results.push({
        grupo: c.g.nombre,
        index: score?.index ?? null,
        score,
        acciones: events.filter((e) => e.kind === 'action' || e.kind === 'params').length,
        registro: events.reverse().map((e) => ({ hora: iso(e.sim_seconds), tipo: e.kind, texto: e.text })),
        sinGestor: !c.g.carpeta,
        // Rutas relativas a la carpeta de la evaluación (las usa la pestaña «Evaluaciones» del panel).
        archivos: {
          ciudad: `${path.basename(dir)}/${slug(c.g.nombre)}-ciudad.csv`,
          registro: c.hasManager ? `${path.basename(dir)}/${slug(c.g.nombre)}-gestor.log` : null,
        },
        incidencias: [c.note, c.exit && `El gestor terminó antes de tiempo (código ${c.exit.code}, ${c.exit.simTime})`].filter(Boolean),
      });
      log(`  ${c.g.nombre}: índice ${score ? score.index.toFixed(1) : '—'}`);
    }
    collector.close();
    return { results, referencia: `${path.basename(dir)}/referencia.json` };
  } finally {
    for (const c of cities) await cleanup(c.name);
  }
}

// --- Informe -------------------------------------------------------------------------------------------------------

const COMPONENTS = { traffic: 'Tráfico', trips: 'Viajes', transit: 'Transporte público', fleet: 'Flota', bikes: 'Bicis', parkings: 'Parkings', cost: 'Coste' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (v, d = 1) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }));

export function summarize(config, perScenario) {
  return config.grupos.map((g) => {
    const rows = perScenario.map((s) => s.results.find((r) => r.grupo === g.nombre));
    const valid = rows.filter((r) => r?.index !== null && r?.index !== undefined);
    const mean = (f) => (valid.length ? valid.reduce((a, r) => a + f(r), 0) / valid.length : null);
    return {
      grupo: g.nombre,
      sinGestor: !g.carpeta,
      media: mean((r) => r.index),
      componentes: Object.fromEntries(Object.keys(COMPONENTS).map((k) => [k, mean((r) => r.score.components[k])])),
      porEscenario: rows.map((r) => r?.index ?? null),
    };
  });
}

function reportHtml(config, perScenario, summary, started) {
  const head = perScenario.map((s) => `<th class="n">${esc(s.escenario.nombre)}</th>`).join('');
  const rows = [...summary].sort((a, b) => (b.media ?? -1) - (a.media ?? -1)).map((g) => `<tr><td>${esc(g.grupo)}${g.sinGestor ? ' <span class="muted">(control sin gestor)</span>' : ''}</td><td class="n"><b>${fmt(g.media)}</b></td>${g.porEscenario.map((v) => `<td class="n">${fmt(v)}</td>`).join('')}${Object.keys(COMPONENTS).map((k) => `<td class="n">${g.componentes[k] === null ? '—' : `${g.componentes[k] > 0 ? '+' : ''}${fmt(100 * g.componentes[k], 0)} %`}</td>`).join('')}</tr>`).join('');
  const details = perScenario.map((s) => `<h2>${esc(s.escenario.nombre)} <span class="muted">· semilla ${s.escenario.semilla} · ${esc(s.escenario.inicio)} · ${s.escenario.horas} h</span></h2>${s.results.map((r) => `
    <h3>${esc(r.grupo)}: ${fmt(r.index)}</h3>
    ${r.incidencias.length ? `<ul class="warn">${r.incidencias.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
    ${r.score ? `<table><tr><th>Indicador</th><th class="n">${esc(r.grupo)}</th><th class="n">Sin gestor</th></tr>${[
      ['stoppedCarHours', 'Horas de coche parado', 0], ['avgKmh', 'Velocidad media (km/h)', 1], ['tripMin', 'Duración media del viaje (min)', 1],
      ['delayPerTripMin', 'Retraso medio por viaje (min)', 1], ['lostTripsPct', 'Viajes perdidos (%)', 1], ['busWaitingPersonHours', 'Personas × h esperando bus', 0],
      ['fullBusPct', 'Autobuses llenos (%)', 1], ['suspendedLineHours', 'Líneas × h suspendidas', 1], ['busHours', 'Autobuses × h en servicio', 0],
      ['badStationHours', 'Puestos × h vacíos o llenos', 0], ['saturatedLotHours', 'Parkings × h saturados', 1], ['restrictedKmAvg', 'Km restringidos de media', 2],
    ].map(([k, label, d]) => `<tr><td>${label}</td><td class="n">${fmt(r.score.group[k], d)}</td><td class="n">${fmt(r.score.reference[k], d)}</td></tr>`).join('')}</table>
    ${r.score.notes.length ? `<p>${r.score.notes.map(esc).join(' · ')}</p>` : ''}` : '<p class="muted">Sin datos comparables.</p>'}
    <details><summary>${r.acciones} acciones registradas</summary><table>${r.registro.map((e) => `<tr><td>${esc(e.hora.replace('T', ' '))}</td><td>${esc(e.tipo)}</td><td>${esc(e.texto)}</td></tr>`).join('')}</table></details>`).join('')}`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Evaluación SmartCity</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:0;background:#f4f4f1;color:#0b0b0b}main{max-width:1100px;margin:0 auto;padding:20px 16px 48px}
table{border-collapse:collapse;width:100%;background:#fcfcfb;margin:8px 0 16px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e1e0d9;overflow-wrap:anywhere}
.n{text-align:right;font-variant-numeric:tabular-nums}.muted{color:#77766f;font-weight:400;font-size:12px}.warn{color:#b02a2a}.scroll{overflow-x:auto}
@media (prefers-color-scheme:dark){body{background:#111110;color:#f0efec}table{background:#1a1a19}th,td{border-color:#2c2c2a}}</style></head><body><main>
<h1>Evaluación con escenarios ocultos</h1>
<p class="muted">${esc(started)} · escala ×${fmt(config.scale, 2)} · 50 = igual que sin gestor · componentes: mejora media frente a la ciudad sin gestor (±50 %)</p>
<div class="scroll"><table><tr><th>Grupo</th><th class="n">Media</th>${head}${Object.values(COMPONENTS).map((c) => `<th class="n">${c}</th>`).join('')}</tr>${rows}</table></div>
${details}
<p class="muted">Pesos: ${Object.entries(METRIC.weights).map(([k, w]) => `${COMPONENTS[k]} ${Math.round(w * 100)} %`).join(' · ')}</p>
</main></body></html>`;
}

// --- Programa ------------------------------------------------------------------------------------------------------

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Uso: node evaluar.mjs evaluacion.json');
    process.exit(1);
  }
  const config = readConfig(file);
  await docker(['version', '--format', '{{.Server.Version}}']).catch(() => {
    throw new Error('No se puede usar Docker: ¿está arrancado?');
  });
  const runId = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const started = new Date().toLocaleString('es-ES');
  const out = path.join(config.salida, runId);
  fs.mkdirSync(out, { recursive: true });
  log(`Resultados en ${out}`);
  const built = await buildImages(config, runId);
  const perScenario = [];
  for (const s of config.escenarios) {
    const { results, referencia } = await runScenario(s, config, built, runId, path.join(out, slug(s.nombre)));
    perScenario.push({ escenario: s, referencia, results });
  }
  const summary = summarize(config, perScenario);
  fs.writeFileSync(path.join(out, 'informe.json'), JSON.stringify({ fecha: started, escala: config.scale, pesos: METRIC.weights, resumen: summary, escenarios: perScenario }, null, 2));
  fs.writeFileSync(path.join(out, 'informe.html'), reportHtml(config, perScenario, summary, started));
  log('Resumen:');
  for (const g of [...summary].sort((a, b) => (b.media ?? -1) - (a.media ?? -1))) log(`  ${g.grupo.padEnd(16)} ${fmt(g.media)}  (${g.porEscenario.map((v) => fmt(v)).join(' · ')})`);
  log(`Informe: ${path.join(out, 'informe.html')}`);
  // Las imágenes de esta evaluación ya no hacen falta.
  const tags = [...built.images.values()].map((i) => i.tag).filter(Boolean);
  if (!config.imagenSimulador) tags.push(built.sim);
  await docker(['rmi', ...tags]).catch(() => {});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
