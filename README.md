# SmartCity Donostia: guía de uso

SmartCity Donostia es un mapa 3D interactivo construido con datos cartográficos de OpenStreetMap (OSM). Permite explorar una simulación de tráfico, modificar los tiempos de semáforos, colocar sensores virtuales y exportar las mediciones.

> **Importante:** los conteos y velocidades son generados por el simulador; no son aforos reales de Donostia. Los vehículos recorren rutas probabilísticas y la demanda cambia según una curva horaria definida por el proyecto. Los resultados sirven para experimentar con el modelo, no para describir el tráfico real sin calibración adicional.

## Requisitos

- Node.js y npm.
- Conexión a Internet para descargar los datos cartográficos de OSM.

## Instalar y ejecutar

Desde la carpeta del proyecto:

```bash
npm ci
npm run fetch-osm
npm run dev
```

Abre en el navegador la dirección local que indique Vite, normalmente `http://localhost:5173/`. Para detener el servidor, pulsa `Ctrl+C` en la terminal.

`npm run fetch-osm` genera `public/data/city.json` con calles, edificios, semáforos y elementos de agua. Ese archivo no está incluido en el repositorio, así que hay que generarlo en cada instalación. La descarga depende de los servidores de Overpass y puede tardar o no estar disponible temporalmente.

Comandos adicionales:

```bash
npm run fetch-water # Actualiza solo los datos de agua; requiere city.json
npm run build       # Genera la versión de producción en dist/
npm run preview     # Sirve localmente la versión de producción
```

## Moverse por el mapa

- Arrastrar con el botón izquierdo: girar la cámara.
- Arrastrar con el botón derecho: desplazar la vista.
- Rueda del ratón: acercar o alejar.
- Pasar el puntero por un marcador de semáforo: mostrar su identificador OSM.

El panel de la izquierda contiene los controles del reloj, el tráfico, los semáforos y los sensores.

## Reloj y tráfico

En **Reloj**, usa los botones de velocidad para pausar (`⏸`) o ejecutar la simulación a distintas velocidades, desde `1x` hasta `1000x`. El reloj de simulación empieza el lunes a las 07:00 y muestra el día y la hora simulados.

En **Tráfico**, el deslizador ajusta el número de coches objetivo en hora punta, de 100 a 3000. El número activo varía con la demanda horaria. El panel muestra coches activos, coches parados, velocidad media y demanda estimada.

La simulación introduce variación aleatoria en las rutas, posiciones y velocidades de los vehículos. Por ello, repetir un escenario puede producir conteos de sensores distintos.

## Semáforos

La lista empieza plegada. Pulsa **Mostrar semáforos** para abrirla; el contador indica cuántos cruces configurables hay. Cada entrada muestra el ID OSM del cruce. El enlace abre el nodo correspondiente en OpenStreetMap.

Los semáforos OSM cercanos se agrupan como un único controlador (distancia máxima de agrupación: 45 m). El grupo se identifica con el ID OSM más bajo de sus nodos. Usa exactamente ese ID, tal como aparece en el panel o en el tooltip, como clave dentro de `signals`.

Los tiempos se editan en segundos:

- **Verde A:** grupo de aproximaciones aproximadamente este-oeste.
- **Verde B:** grupo de aproximaciones aproximadamente norte-sur.
- **Ámbar:** tiempo entre fases.

Al editar un valor, el plan activo se actualiza inmediatamente. Los verdes aceptan de 5 a 180 segundos; el ámbar, de 1 a 10 segundos. Estos ejes se calculan según la orientación de los tramos de calle y no necesariamente coinciden exactamente con los puntos cardinales.

El campo **Verde (s) para todos** y el botón **Aplicar** establecen el mismo verde para ambos grupos de todos los cruces y eliminan las diferencias individuales del plan activo.

### Crear, cargar y guardar planes

Pulsa **Descargar plantilla** para obtener un JSON inicial. También puedes crear uno manualmente con este formato:

```json
{
  "default": {
    "green": 20,
    "yellow": 3
  },
  "signals": {
    "123456789": {
      "greenA": 30,
      "greenB": 15,
      "yellow": 3
    }
  }
}
```

En el ejemplo, sustituye `123456789` por un ID real mostrado en el mapa. `default` define los tiempos para todos los cruces; cada entrada de `signals` sobrescribe esos valores para un cruce concreto. También puedes usar `green` dentro de una entrada individual para dar la misma duración a A y B.

- **Cargar archivo:** importa un plan JSON desde tu ordenador.
- **Cargar URL:** obtiene el plan desde una dirección que sirva JSON. El servidor remoto debe permitir la petición del navegador (CORS).
- **Descargar plan actual:** guarda los cambios activos para reutilizarlos o compartirlos.

Los cambios individuales no se conservan al recargar la página a menos que descargues el plan actual.

## Sensores y mediciones

1. Pulsa **Colocar sensores**.
2. Mueve el puntero sobre una calle. El marcador fantasma indica dónde se colocará el sensor.
3. Haz clic en la calle para añadirlo. El sensor se ajusta al tramo más cercano, hasta 30 m.
4. Pulsa de nuevo el botón o `Esc` para salir del modo de colocación.

En la lista puedes cambiar el nombre de cada sensor, seleccionar uno o borrarlo con `✕`. También puedes seleccionar un sensor haciendo clic en su marcador. Con un sensor seleccionado, `Supr` lo elimina.

El contador de cada sensor muestra los cruces del intervalo en curso y, entre paréntesis, el total acumulado desde que se creó en esa sesión. En **Intervalo de medida**, elige 1, 5, 15, 30 o 60 minutos. Al cambiar el intervalo se descarta el conteo parcial que estuviera en curso.

Al cerrarse cada intervalo se genera un registro por sensor con estos campos:

| Campo | Significado |
| --- | --- |
| `timestamp` | Inicio del intervalo, en formato ISO y UTC. |
| `weekday` | Día de la semana. |
| `sensor_id`, `sensor_name` | Identificador y nombre del sensor. |
| `x`, `z` | Posición local del sensor en metros; no son latitud y longitud. |
| `count` | Total de cruces en ambas direcciones. |
| `count_fwd`, `count_bwd` | Cruces por sentido del tramo. |
| `avg_speed_kmh` | Velocidad media de los vehículos que cruzaron, en km/h; queda vacío si no hubo cruces. |

### Exportar, importar y enviar

- **Exportar CSV:** descarga los registros de la sesión en `trafico.csv`. Conviene exportarlo antes de recargar o cerrar la página, porque las mediciones no se guardan en el navegador.
- **Exportar sensores:** descarga sus nombres y posiciones en `sensores.json`.
- **Importar sensores:** carga un JSON de sensores en el mapa actual. La importación añade los sensores al listado existente; no los sustituye.
- **Enviar datos automáticamente:** si se activa y se introduce la URL de un servicio, el navegador envía lotes de registros mediante `POST` con contenido JSON cada dos segundos. El servicio debe aceptar peticiones del navegador (CORS). Si falla un envío, los registros quedan pendientes para reintentarse.

Las posiciones de los sensores se guardan automáticamente en `localStorage` del navegador y reaparecen al volver a abrir la aplicación en ese mismo navegador. Esa persistencia no incluye las mediciones CSV.

## Propuesta para una actividad

1. Formula una pregunta comprobable, por ejemplo: «¿Aumenta el número de vehículos que cruzan este punto al cambiar el tiempo de verde?».
2. Coloca sensores en puntos comparables y anota sus nombres y ubicaciones.
3. Mantén iguales la duración simulada, el intervalo y la demanda; cambia solo una variable cada vez.
4. Exporta los registros CSV y compara conteos y velocidades. Como las rutas tienen componentes aleatorios, repite cada escenario varias veces y compara también los promedios.
5. Explica las conclusiones junto con las limitaciones del modelo: son resultados de una simulación, no observaciones del tráfico real.

## Datos cartográficos

El mapa se basa en OpenStreetMap. Si reutilizas o distribuyes los datos cartográficos, incluye la atribución a OpenStreetMap y revisa las condiciones de la licencia ODbL. Los sensores y los datos de tráfico simulados son independientes del mapa base.