# Panel del profesor

Seguimiento en directo de las ciudades de los grupos. Cada ciudad se compara, **a la misma hora simulada**, con **su
misma ciudad sin gestor** (misma semilla, inicio y demanda), y el panel calcula un índice de 0 a 100: **50 = igual que sin gestor**, por encima
el gestor mejora la ciudad y por debajo la empeora.

> Este directorio contiene la métrica de evaluación (`panel/metric.js`). Si el repositorio es público, los alumnos
> pueden leerla: hazlo privado o mueve `profesor/` a un repositorio privado antes de repartir el proyecto.

## Cómo funciona

- **Cada grupo puede tener su semilla** (`SCENARIO_SEED`): su tráfico, su tiempo, sus eventos y la variación diaria de
  la demanda son distintos de los de otro grupo. La simulación es determinista: con la misma semilla, inicio y demanda,
  y sin intervenciones, una ciudad evoluciona siempre igual.
- **El panel simula por dentro la ciudad sin gestor de cada grupo** («referencia»): lee de la ciudad del grupo su
  semilla, su inicio, su escala y su demanda (`GET /api/state`) y la reproduce en un hilo aparte, siguiendo su hora.
  Es exactamente «lo que habría pasado sin gestor». Guarda su estado cada día simulado para reanudar si se reinicia.
- **El simulador graba** cada 5 min simulados, siempre y a horas exactas, los indicadores globales de la ciudad
  (`GET /api/city.csv`). Como es determinista, una ciudad sin gestor graba exactamente las mismas filas que la
  referencia: su índice es 50 exacto, sin ruido de muestreo.
- **El panel** descarga ese histórico de cada grupo y de la referencia (solo lecturas públicas: no necesita los tokens
  de los grupos), lo agrupa en tramos de 15 min simulados y lo guarda en SQLite. Cada `POLL_SECONDS` consulta también
  el estado actual para registrar las acciones (restricciones, semáforos, flotas…), los reinicios y las líneas
  suspendidas.
- **Compara por hora simulada**, no por hora real: los grupos pueden arrancar en días distintos. La referencia de un
  grupo simula unas 1000 veces más rápido que el tiempo real, así que alcanza enseguida a una ciudad recién arrancada;
  si el panel se arranca semanas después que los grupos, tarda en ponerse al día (unas 9 h por cada año simulado), y
  mientras tanto el grupo muestra «Calculando su ciudad sin gestor». Lo mejor es arrancar el panel a la vez que los
  grupos. Si el panel se para, al volver recupera el histórico que falte; solo se pierde el registro de acciones de ese
  rato.

## Indicadores y pesos (no los compartas con los alumnos)

| Componente | Peso | Qué mide (acumulado en la ventana) |
| --- | --- | --- |
| Tráfico | 20 % | Horas de coche parado (2/3) y velocidad media ponderada por coche (1/3) |
| Viajes en coche | 20 % | Retraso medio por viaje frente a ir sin tráfico ni cortes (1/2) y % de viajes que no se pueden hacer (1/2) |
| Transporte público | 25 % | Personas × hora esperando (1/2), % de autobuses llenos (1/4), líneas × hora suspendidas (1/4) |
| Eficiencia de flota | 5 % | Autobuses × hora en servicio |
| Bicis | 10 % | Puestos × hora vacíos (sin bicis) o llenos (sin anclajes) |
| Parkings | 10 % | Parkings × hora por encima del 95 % |
| Coste de las intervenciones | 10 % | Km de calle restringida de media (ponderados por modo), semáforos en `all_red` y «marchas atrás» |

- Cada componente es la mejora relativa frente a la referencia, recortada a ±50 %. Índice = 50 + suma ponderada.
- **Viajes**: cada coche va de su origen a una zona de destino. Cortar calles alarga los viajes y, si el destino se
  queda sin camino, el viaje no se hace. Así un corte tiene un coste real en los indicadores.
- **Coste**: además se penaliza intervenir por sí mismo (calle restringida, `all_red`, marchas atrás), porque los
  peatones no se ven afectados por los cortes y peatonalizar no tiene beneficio modelado. 5 km equivalentes de media
  restan el máximo (5 puntos). Una *marcha atrás* es deshacer un cambio
  en menos de 1 h simulada (quitar una restricción recién puesta, subir y bajar la flota de una línea).
- **Topes**: si algún componente empeora más de un 20 %, el índice no pasa de 60. Cada línea suspendida más de 2 h
  seguidas resta 5 puntos (máximo 15).
- Todos los valores están al principio de `panel/metric.js` (`METRIC`) para ajustarlos.

## Pestaña «Evaluaciones»

Muestra los resultados del [evaluador de escenarios ocultos](evaluador/README.md) (la nota final): el panel lee
`profesor/evaluador/resultados/` en solo lectura. Las instrucciones están en el README del evaluador.

## Alertas

El panel avisa cuando un grupo no responde, va con retraso, **se ha reiniciado** (la comparación sigue desde el
reinicio y su referencia empieza de cero), su ciudad sin gestor aún se está calculando, lleva una línea suspendida
mucho tiempo, no ha hecho ninguna acción en 6 h simuladas o deshace cambios a menudo.

## Despliegue

### 1. Servidor del profesor

```sh
cd profesor
cp .env.example .env    # rellena PANEL_GROUPS, PANEL_PASSWORD y DOMAIN
npm run fetch-osm --prefix ..   # solo si ../public/data/city.json no existe
docker compose up -d --build
```

Abre `https://<DOMAIN>` con el usuario `profesor` y `PANEL_PASSWORD`. Arráncalo a la vez que los grupos (o antes).

### 2. Servidor de cada grupo

En la raíz del repositorio, con su propio `.env`:

```sh
SMARTCITY_TOKEN=<distinto para cada grupo: openssl rand -hex 24>
DOMAIN=grupo1.ejemplo.es
SCENARIO_SEED=1234      # una distinta para cada grupo: cada ciudad es un poco diferente
SIM_SCALE=              # vacío = la del curso (365/7)
MAX_CARS=               # demanda en hora punta (vacío = 1500 coches y 12000 peatones); los alumnos no la cambian
MAX_PEDESTRIANS=
```

```sh
docker compose up -d --build
```

Da a cada grupo su URL y su token. Pon su URL en `PANEL_GROUPS` del servidor del profesor
(`g1=https://grupo1.ejemplo.es,…`) y reinicia el panel: `docker compose up -d panel`.

### Panel y una ciudad en el mismo equipo

Desde el panel, `localhost` es su propio contenedor. Usa `host.docker.internal` y el puerto HTTP de la ciudad, y
arranca esa ciudad en HTTP (`DOMAIN=:80` en su `.env`), porque su certificado interno de `localhost` no lo acepta el
panel. Cada compose necesita sus propios puertos:

```sh
# .env de la ciudad (raíz del repositorio)
DOMAIN=:80
HTTP_PORT=8081
HTTPS_PORT=8444

# profesor/.env
PANEL_GROUPS=g1=http://host.docker.internal:8081
HTTP_PORT=80
HTTPS_PORT=443
```

### Comprobaciones

- La semilla de una ciudad no se puede cambiar con la ciudad en marcha: el servidor se niega a arrancar. Para cambiarla,
  borra su volumen (`docker compose down -v`) y empieza una ciudad nueva.
- La demanda (`MAX_CARS`, `MAX_PEDESTRIANS`) sí se puede cambiar reiniciando el servidor: la referencia la sigue desde
  ese momento.
- No reinicies ni borres el volumen de un grupo salvo que quieras empezar de cero: el panel lo detecta y vuelve a
  contar desde ese momento.
- El panel solo lee. Si se cae, las ciudades siguen funcionando; al volver, recupera el histórico (no las acciones de
  ese rato).

## Limitaciones

- El índice en directo compara la ciudad del grupo con la referencia durante el curso. Para la **nota final** es más
  justo evaluar todos los gestores sobre los mismos escenarios ocultos (otra semilla y otras fechas): ver
  [`evaluador/README.md`](evaluador/README.md).
- Las reglas de semáforo con horario (`schedule`) que ponen `all_red` no se cuentan en el coste; solo los ajustes
  directos.
- El simulador no modela el beneficio de peatonalizar (los peatones no se ven afectados por los cortes): por eso existe
  el componente de coste.
