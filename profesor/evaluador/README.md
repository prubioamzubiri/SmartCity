# Evaluación con escenarios ocultos

Ejecuta el gestor de cada grupo contra ciudades **que no han visto** (otra semilla y otras fechas: otro tráfico, otro
tiempo y otros eventos) y lo puntúa con la misma métrica que el panel (`../panel/metric.js`) frente a **la misma
ciudad sin gestor**. Todos los grupos juegan exactamente los mismos escenarios.

> Este directorio está pensado para el profesor: guarda aquí (y no en un repositorio público) los escenarios que uses.

## Qué entregan los grupos

Una carpeta con:

- `gestor.py`: su programa. Debe leer la dirección y el token del entorno, como `examples/gestor.py`:
  ```python
  URL = os.environ["SMARTCITY_URL"]
  TOKEN = os.environ["SMARTCITY_TOKEN"]
  ```
  y funcionar sin parar hasta que se le detenga.
- `requirements.txt` (opcional): sus dependencias de `pip`.
- Cualquier otro fichero que necesite (modelos entrenados, etc.).

Si usan otro lenguaje o fichero de arranque, indica el comando en la configuración (`"comando": ["python", "main.py"]`).

Durante la evaluación el gestor corre en un contenedor (Python 3.12) **sin acceso a internet**: solo puede hablar con su
ciudad. Tiene 1 CPU y 1 GB de memoria (`cpusGestor`, `memoriaGestor`).

## Uso

Necesitas **Docker** y **Node.js 24** (o 22.13 o posterior) en el equipo.

1. Copia `evaluacion.ejemplo.json` a `evaluacion.json` y pon las carpetas de los grupos y tus escenarios.
2. Desde este directorio:
   ```sh
   node evaluar.mjs evaluacion.json
   ```
3. Al terminar abre `resultados/<fecha>/informe.html`.

Los escenarios se ejecutan uno tras otro y, dentro de cada uno, **todos los grupos a la vez**. Con la escala del curso
(×52) un día simulado son unos 28 minutos reales: 3 escenarios de 1 día ≈ 1,5 horas.

## Configuración (`evaluacion.json`)

| Campo | Qué es |
| --- | --- |
| `escenarios` | Lista de `{ nombre, semilla, inicio, horas }`. `semilla`: un entero cualquiera, distinto de 20260105 (la de las ciudades de los alumnos). `inicio`: fecha y hora simulada (`2026-08-15T00:00`). `horas`: duración |
| `grupos` | Lista de `{ nombre, carpeta, comando? }`. `carpeta: null` = **grupo de control sin gestor**: debe dar 50 y sirve para comprobar que la evaluación es justa |
| `escalaReloj` | Segundos simulados por segundo real. Por defecto la del curso (365/7). Usa la misma que en el curso: el gestor de los alumnos decide a su ritmo en tiempo real |
| `imagenSimulador` | Imagen Docker del simulador ya construida. Por defecto se construye desde este repositorio |
| `imagenPython` | Imagen base de los gestores (por defecto `python:3.12-slim`) |
| `salida` | Carpeta de resultados (por defecto `resultados`) |

Elige fechas que den variedad: un laborable con lluvia, un día con un evento grande (fiestas, partido), un festivo. Las
fechas pueden ser de cualquier año: con otra semilla, el tiempo y los eventos no coinciden con lo que vieron los
alumnos.

## Resultados

En `resultados/<fecha>/`:

- `informe.html`: índice medio de cada grupo, índice por escenario, componentes y, por escenario, los indicadores frente
  a la ciudad sin gestor y todas las acciones del gestor.
- `informe.json`: lo mismo para procesarlo.
- `<escenario>/<grupo>-ciudad.csv` (el histórico de la ciudad), `<grupo>-gestor.log` (lo que escribió el gestor) y
  `referencia.json` (la ciudad sin gestor).

El informe avisa si un gestor no se pudo construir (por ejemplo, un `requirements.txt` con errores) o terminó antes de
tiempo (se cayó): en ese caso la ciudad siguió sin gestor el resto del escenario.

## Cómo funciona

- Cada ciudad es el simulador del repositorio con `SCENARIO_SEED`, `SCENARIO_START`, `LOCK_PARAMS=1` y un token nuevo.
  Ver `server/scenario.js`.
- La ciudad sin gestor se calcula aparte a máxima velocidad (`referencia.mjs`): la simulación es determinista y da
  exactamente las mismas filas que una ciudad del servidor a la que nadie toca (el grupo de control lo comprueba).
- Las acciones (restricciones, semáforos, flotas…) se registran consultando la ciudad cada 5 s, igual que el panel.
