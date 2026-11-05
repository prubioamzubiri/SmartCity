# Setup de API para Alumnos

## 📁 Estructura Creada

Se ha creado la siguiente estructura de carpetas para que implementes los endpoints de la API:

```
src/api/
├── controllers/              ← Lógica de cada característica
│   ├── traffic.js           ← ✅ Semáforos, calles, restricciones
│   ├── transit.js           ← ✅ Buses, líneas
│   ├── parking.js           ← ✅ Estacionamiento
│   ├── bikes.js             ← TODO: Bicicletas
│   ├── pedestrians.js       ← TODO: Peatones
│   ├── airQuality.js        ← TODO: Calidad del aire
│   └── events.js            ← TODO: Eventos y emergencias
│
├── services/                ← Lógica compartida
│   ├── trafficService.js
│   ├── transitService.js
│   ├── parkingService.js
│   └── ...
│
├── validators/              ← Validación de entrada
│   └── inputValidator.js
│
└── responses/               ← Formato de respuesta estándar
    └── apiResponse.js
```

## ✅ Archivos Completados

### 1. Traffic Controller (`src/api/controllers/traffic.js`)
Endpoints implementados con estructura lista:
- `GET /api/traffic/signals/:signalId` - Ver estado de semáforo
- `PUT /api/traffic/signals/:signalId` - Cambiar tiempos
- `PUT /api/traffic/signals` - Plan global
- `PUT /api/traffic/streets/:streetId/access` - Cerrar calles
- `PUT /api/traffic/zones/:zoneId/restrictions` - Restricciones
- `GET /api/traffic/analytics` - Análisis

### 2. Transit Controller (`src/api/controllers/transit.js`)
Endpoints para buses:
- `GET /api/buses/lines/:lineId` - Info de línea
- `PUT /api/buses/lines/:lineId` - Modificar línea
- `GET /api/buses/lines/:lineId/analytics` - Análisis
- `GET /api/buses/lines` - Listar líneas
- `POST /api/buses/lines/:lineId/priority` - Prioridad

### 3. Parking Controller (`src/api/controllers/parking.js`)
Endpoints para estacionamiento:
- `GET /api/parking/:parkingId` - Estado
- `GET /api/parking/available` - Buscar disponibles
- `PUT /api/parking/:parkingId/rates` - Cambiar tarifas
- `PUT /api/traffic/congestion-zones/:zoneId` - Tarificación por congestión
- `GET /api/parking/:parkingId/analytics` - Análisis

## 📝 Siguiente Paso: Crear los Controladores Faltantes

Necesitas crear:

### 1. Bikes Controller (`src/api/controllers/bikes.js`)
```javascript
export class BikesController {
  constructor(runtime) { ... }
  
  // Endpoints necesarios:
  // - GET /api/bikes - estado actual
  // - GET /api/bikes/:stationId - estado de estación
  // - PUT /api/bikes/capacity - cambiar capacidad
  // - POST /api/bikes/rebalance - mover bikes
  // - GET /api/bikes/analytics - análisis
}
```

### 2. Pedestrians Controller (`src/api/controllers/pedestrians.js`)
```javascript
export class PedestriansController {
  constructor(runtime) { ... }
  
  // Endpoints:
  // - PUT /api/pedestrians/crossings/:crossingId - cambiar tiempos
  // - GET /api/pedestrians/analytics - análisis
  // - GET /api/pedestrians/density - densidad por zona
}
```

### 3. Air Quality Controller (`src/api/controllers/airQuality.js`)
```javascript
export class AirQualityController {
  constructor(runtime) { ... }
  
  // Endpoints:
  // - GET /api/air-quality - estado actual
  // - GET /api/air-quality/zones/:zoneId - por zona
  // - POST /api/air-quality/alert - crear alerta
}
```

### 4. Events Controller (`src/api/controllers/events.js`)
```javascript
export class EventsController {
  constructor(runtime) { ... }
  
  // Endpoints:
  // - POST /api/city/events - crear evento
  // - GET /api/city/events - listar
  // - POST /api/emergency/create-corridor - emergencia
}
```

## 🔧 Integración con Servidor Actual

El servidor actual está en `server/app.js`. Para integrar los nuevos controllers:

### Opción 1: Agregar a app.js existente
```javascript
// server/app.js
import { TrafficController } from '../src/api/controllers/traffic.js';
import { TransitController } from '../src/api/controllers/transit.js';
import { ParkingController } from '../src/api/controllers/parking.js';

export function createApp({ runtime, store, token, corsOrigin }) {
  const app = (req, res) => {
    // ... middleware existente ...
    
    const trafficController = new TrafficController(runtime);
    const transitController = new TransitController(runtime);
    const parkingController = new ParkingController(runtime);
    
    // Rutas
    if (req.method === 'PUT' && req.url.match(/^\/api\/traffic\/signals\/\d+$/)) {
      return trafficController.updateSignal(req, res, getSignalId(req.url));
    }
    // ... más rutas ...
  };
}
```

### Opción 2: Crear router separado (recomendado)
```javascript
// src/api/index.js
export function createApiRouter(runtime, store) {
  const trafficController = new TrafficController(runtime);
  const transitController = new TransitController(runtime);
  const parkingController = new ParkingController(runtime);

  return {
    async handleRequest(req, res) {
      const { pathname, searchParams } = new URL(req.url, 'http://localhost');
      
      // Traffic routes
      if (pathname.startsWith('/api/traffic')) {
        return this.handleTraffic(pathname, req, res);
      }
      
      // Transit routes
      if (pathname.startsWith('/api/buses')) {
        return this.handleTransit(pathname, req, res);
      }
      
      // ... etc
    },
    
    async handleTraffic(pathname, req, res) {
      // Parse y dispatch a trafficController
    }
  };
}
```

## 🧪 Testing Endpoints

### Usando curl
```bash
# Ver semáforo
curl http://localhost:3000/api/traffic/signals/signal_001

# Cambiar semáforo
curl -X PUT http://localhost:3000/api/traffic/signals/signal_001 \
  -H "Content-Type: application/json" \
  -d '{"green": 50, "yellow": 3}'

# Ver línea de bus
curl http://localhost:3000/api/buses/lines/L3

# Buscar parkings
curl "http://localhost:3000/api/parking/available?lat=43.318&lon=-1.975"
```

### Usando Node.js
```javascript
import fetch from 'node-fetch';

// Get signal
const response = await fetch('http://localhost:3000/api/traffic/signals/signal_001');
const data = await response.json();
console.log(data);

// Update signal
const updateRes = await fetch('http://localhost:3000/api/traffic/signals/signal_001', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ green: 50, yellow: 3 })
});
const updateData = await updateRes.json();
console.log(updateData);
```

## 📚 Recursos

| Archivo | Contenido |
|---------|----------|
| `MANAGEMENT_OPTIONS.md` | Qué endpoints crear y qué hacen |
| `IMPLEMENTATION_PLAN.md` | Especificaciones técnicas detalladas |
| `EXAMPLES.md` | Ejemplos de IA que usa la API |
| `AI_LEARNING_ROADMAP.md` | Guía pedagógica para alumnos |
| `API_SETUP.md` | Este archivo - cómo integrar todo |

## 🎯 Próximos Pasos

1. **Elige un controller** para empezar (recomendado: `transit.js` - es más simple)
2. **Implementa sus métodos** usando la estructura ya creada
3. **Conecta con la simulación** en `engine.sim` para obtener datos reales
4. **Prueba con curl o fetch** antes de entregar
5. **Integra en server/app.js** una vez que funcione

## ❓ Preguntas Frecuentes

**P: ¿Cómo accedo a los datos de la simulación?**
R: Via `this.engine.sim`:
- Tráfico: `this.engine.sim.traffic.signals`
- Buses: `this.engine.sim.transit.lines` o `this.engine.sim.transit.buses`
- Estacionamiento: `this.engine.sim.city.parking` (si existe)

**P: ¿Qué significa TODO en los comentarios?**
R: Son tareas que necesitas completar. Busca "TODO:" en los archivos.

**P: ¿Puedo cambiar las firmas de los métodos?**
R: Sí, pero mantén consistencia con los otros controladores.

**P: ¿Cómo persisten los cambios?**
R: Por ahora se guardan en memoria. Para persistencia, usa `this.runtime.store`.

---

¡Adelante con la implementación! 🚀

