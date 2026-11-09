# Panel del profesor

Seguimiento en directo de las ciudades de los grupos. Cada ciudad se compara, **a la misma hora simulada**, con una
**ciudad de referencia sin gestor**, y el panel calcula un índice de 0 a 100: **50 = igual que sin gestor**, por encima
el gestor mejora la ciudad y por debajo la empeora.

> Este directorio contiene la métrica de evaluación (`panel/metric.js`). Si el repositorio es público, los alumnos
> pueden leerla: hazlo privado o mueve `profesor/` a un repositorio privado antes de repartir el proyecto.

## Cómo funciona

- **Una ciudad de referencia** (`reference`) corre en el servidor del profesor con el mismo simulador y sin que nadie
  la toque. La simulación es determinista: todas las ciudades empiezan en la misma fecha simulada y, sin
  intervenciones, evolucionan igual. Por eso la referencia es exactamente «lo que habría pasado sin gestor».
- **El simulador graba** cada 5 min simulados, siempre y a horas exactas, los indicadores globales de la ciudad
  (`GET /api/city.csv`). Como es determinista, una ciudad sin gestor graba exactamente las mismas filas que la
  referencia: su índice es 50 exacto, sin ruido de muestreo.
- **El panel** descarga ese histórico de cada grupo y de la referencia (solo lecturas públicas: no necesita los tokens
  de los grupos), lo agrupa en tramos de 15 min simulados y lo guarda en SQLite. Cada `POLL_SECONDS` consulta también
  el estado actual para registrar las acciones (restricciones, semáforos, flotas…), los reinicios y las líneas
  suspendidas.
- **Compara por hora simulada**, no por hora real: los grupos pueden arrancar en días distintos. Basta con que la
  referencia arranque **antes** que cualquier grupo. Si el panel se para, al volver recupera el histórico que falte;
  solo se pierde el registro de acciones de ese rato.

## Indicadores y pesos (no los compartas con los alumnos)

| Componente | Peso | Qué mide (acumulado en la ventana) |
| --- | --- | --- |
| Tráfico | 30 % | Horas de coche parado (2/3) y velocidad media ponderada por coche (1/3) |
| Transporte público | 25 % | Personas × hora esperando (1/2), % de autobuses llenos (1/4), líneas × hora suspendidas (1/4) |
| Eficiencia de flota | 5 % | Autobuses × hora en servicio |
| Bicis | 10 % | Puestos × hora vacíos (sin bicis) o llenos (sin anclajes) |
| Parkings | 10 % | Parkings × hora por encima del 95 % |
| Coste de las intervenciones | 20 % | Km de calle restringida de media (ponderados por modo), semáforos en `all_red` y «marchas atrás» |

- Cada componente es la mejora relativa frente a la referencia, recortada a ±50 %. Índice = 50 + suma ponderada.
- **Coste**: cortar calles no empeora los indicadores del simulador (los coches reaparecen en otro punto), así que se
  penaliza aparte. 5 km equivalentes de media restan el máximo (10 puntos). Una *marcha atrás* es deshacer un cambio
  en menos de 1 h simulada (quitar una restricción recién puesta, subir y bajar la flota de una línea).
- **Topes**: si algún componente empeora más de un 20 %, el índice no pasa de 60. Cada línea suspendida más de 2 h
  seguidas resta 5 puntos (máximo 15).
- Todos los valores están al principio de `panel/metric.js` (`METRIC`) para ajustarlos.

## Alertas

El panel avisa cuando un grupo no responde, va con retraso, **se ha reiniciado** (la comparación sigue desde el
reinicio), tiene **otra escala de reloj o parámetros de demanda distintos** (la comparación no es válida), lleva una
línea suspendida mucho tiempo, no ha hecho ninguna acción en 6 h simuladas o deshace cambios a menudo. También avisa si
alguien modifica la ciudad de referencia.

## Despliegue

### 1. Servidor del profesor (primero)

```sh
cd profesor
cp .env.example .env    # rellena PANEL_GROUPS, PANEL_PASSWORD y DOMAIN
npm run fetch-osm --prefix ..   # solo si ../public/data/city.json no existe
docker compose up -d --build
```

Abre `https://<DOMAIN>` con el usuario `profesor` y `PANEL_PASSWORD`. La ciudad de referencia no se publica: solo la
ve el panel.

### 2. Servidor de cada grupo

En la raíz del repositorio, con su propio `.env`:

```sh
SMARTCITY_TOKEN=<distinto para cada grupo: openssl rand -hex 24>
DOMAIN=grupo1.ejemplo.es
LOCK_PARAMS=1           # los alumnos no pueden cambiar la demanda (maxCars, scenario…)
SIM_SCALE=              # vacío = igual que la referencia
```

```sh
docker compose up -d --build
```

Da a cada grupo su URL y su token. Pon su URL en `PANEL_GROUPS` del servidor del profesor
(`g1=https://grupo1.ejemplo.es,…`) y reinicia el panel: `docker compose up -d panel`.

### Comprobaciones

- Todas las ciudades con la misma `SIM_SCALE` (el panel avisa si no).
- `LOCK_PARAMS=1` en los grupos: si cambian la demanda, la ciudad deja de ser comparable con la referencia.
- No reinicies ni borres el volumen de un grupo salvo que quieras empezar de cero: el panel lo detecta y vuelve a
  contar desde ese momento.
- El panel solo lee. Si se cae, las ciudades siguen funcionando; al volver, recupera el histórico (no las acciones de
  ese rato).

## Limitaciones

- El índice en directo compara la ciudad del grupo con la referencia durante el curso. Para la **nota final** es más
  justo evaluar todos los gestores sobre los mismos escenarios (otra semilla y otras fechas), que es otra herramienta.
- Las reglas de semáforo con horario (`schedule`) que ponen `all_red` no se cuentan en el coste; solo los ajustes
  directos.
- El simulador no modela el tiempo de viaje ni los viajes que no se hacen: por eso existe el componente de coste.
