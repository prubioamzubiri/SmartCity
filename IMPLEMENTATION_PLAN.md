# Plan Técnico de Implementación - SmartCity Management API

## 1. ARQUITECTURA GENERAL

### 1.1 Flujo de Datos
```
IA (Alumno)
    ↓
REST API Endpoints
    ↓
Controllers (Validación)
    ↓
Business Logic (Simulación)
    ↓
State Management (Guardar cambios)
    ↓
Visualization (Three.js)
```

### 1.2 Componentes Existentes
- **Backend**: Node.js (server/index.js)
- **Simulación**: src/traffic/sim.js, src/transit/buses.js, src/pedestrians/
- **Visualización**: Three.js (UI)
- **Sensores**: src/sensors/ (ya proporciona datos)

---

## 2. API ENDPOINTS A IMPLEMENTAR

### 2.1 GESTIÓN DE TRÁFICO

#### Street Closure/Restriction
```javascript
PUT /api/traffic/streets/:streetId/access
{
  "mode": "closed" | "buses_only" | "pedestrians_only" | "residents_only" | "open",
  "startTime": "2024-11-05T08:00:00Z",
  "endTime": "2024-11-05T18:00:00Z",
  "reason": "construction | event | congestion | air_quality"
}

Response:
{
  "streetId": "123",
  "mode": "buses_only",
  "affectedVehicles": 45,
  "expectedDelay": 120,
  "alternativeRoutes": ["street_456", "street_789"]
}
```

#### Signal Timing Modification
```javascript
PUT /api/traffic/signals/:signalId
{
  "green": 45,        // segundos
  "yellow": 3,        // segundos
  "plan": "rush_hour" | "normal" | "night" | "custom"
}

PUT /api/traffic/signals (global plan)
{
  "default": {
    "green": 40,
    "yellow": 3,
    "schedule": [
      {
        "when": { "start": "07:00", "end": "09:00" },
        "green": 50
      }
    ]
  }
}
```

#### Vehicle Restriction
```javascript
PUT /api/traffic/zones/:zoneId/restrictions
{
  "type": "emissions_low" | "year_gt_5" | "odd_even" | "permit_required",
  "severity": "level_1" | "level_2" | "level_3",
  "startDate": "2024-11-05",
  "endDate": "2024-11-15"
}

Response:
{
  "zoneId": "downtown",
  "affectedVehicles": 1250,
  "expectedReduction": "23%",
  "expectedAirQualityGain": "+15% air quality index"
}
```

#### Traffic Query
```javascript
GET /api/traffic/analytics
{
  "startTime": "2024-11-05T00:00:00Z",
  "endTime": "2024-11-05T23:59:59Z",
  "metrics": ["congestion", "emissions", "avg_speed", "accident_count"]
}

Response:
{
  "congestion": {
    "peak_hour": "08:30",
    "peak_level": 87,
    "avg_level": 62
  },
  "emissions": {
    "pm25_avg": 42,
    "no2_avg": 156,
    "co_avg": 8
  },
  "avg_speed": 32.5,  // km/h
  "accident_count": 3
}
```

---

### 2.2 GESTIÓN DE BUSES

#### Modify Bus Line
```javascript
PUT /api/buses/lines/:lineId
{
  "frequency": 300,      // segundos entre buses
  "busCount": 8,         // número de buses en línea
  "schedule": [
    {
      "startTime": "06:00",
      "endTime": "23:00",
      "frequency": 300,
      "busCount": 10
    }
  ]
}

Response:
{
  "lineId": "L3",
  "busCount": 8,
  "capacity": 480,       // 8 buses × 60 capacity
  "expectedWaitTime": 320,  // segundos
  "occupancy": 65
}
```

#### Get Bus Line Analytics
```javascript
GET /api/buses/lines/:lineId/analytics
{
  "startTime": "2024-11-05T00:00:00Z",
  "endTime": "2024-11-05T23:59:59Z"
}

Response:
{
  "lineId": "L3",
  "passengers": 1245,
  "avgOccupancy": 65,
  "peakOccupancy": 92,
  "waitTimeAvg": 380,
  "onTimePercentage": 87,
  "revenue": 1245
}
```

#### Bus Priority
```javascript
PUT /api/traffic/signals/:signalId/bus-priority
{
  "enabled": true,
  "preemptTime": 5  // segundos de anticipación
}
```

---

### 2.3 GESTIÓN DE ESTACIONAMIENTO

#### Modify Parking Rates
```javascript
PUT /api/parking/:parkingId/rates
{
  "pricePerHour": 2.50,
  "maxDuration": 120,        // minutos
  "zoneType": "blue" | "red" | "free",
  "discounts": {
    "residents": 0.5,         // 50% descuento
    "ev_only": 0.0,           // gratis para EV
    "longStay": { "hoursAfter": 4, "discountPercent": 20 }
  }
}

Response:
{
  "parkingId": "downtown_P1",
  "newOccupancy": 78,
  "expectedOccupancy": 75,
  "revenueChange": "+12%"
}
```

#### Congestion Pricing Zone
```javascript
PUT /api/traffic/congestion-zones/:zoneId
{
  "enabled": true,
  "basePrice": 5.00,         // € para entrar
  "dynamicPricing": true,
  "pricingFormula": "base * (congestion_level / 50)",
  "exemptions": ["residents", "medical", "deliveries"],
  "peakHours": {
    "weekday": { "start": "07:00", "end": "10:00" },
    "evening": { "start": "16:00", "end": "19:00" }
  }
}

Response:
{
  "zoneId": "downtown",
  "enabled": true,
  "currentPrice": 6.50,
  "expectedTrafficReduction": "18%",
  "expectedRevenue": "€3200/day"
}
```

#### Parking Availability
```javascript
GET /api/parking/available
{
  "lat": 43.318,
  "lon": -1.975,
  "radius": 500,  // metros
  "maxPrice": 3.00
}

Response:
{
  "parkings": [
    {
      "id": "downtown_P1",
      "available": 23,
      "capacity": 150,
      "distance": 120,
      "price": 2.50,
      "occupancy": 85
    }
  ]
}
```

---

### 2.4 GESTIÓN DE BICICLETAS

#### Modify Bike Station Capacity
```javascript
PUT /api/bikes/capacity
{
  "changes": {
    "municipal/0": 40,
    "municipal/5": 25,
    "municipal/12": 30
  },
  "scheduleDate": "2024-12-05"  // Cambio tarda 30 días
}

Response:
{
  "changes": {
    "municipal/0": { "current": 30, "pending": 40, "effectDate": "2024-12-05" },
    "municipal/5": { "current": 20, "pending": 25, "effectDate": "2024-12-05" }
  },
  "totalCapacityGain": 20
}
```

#### Bike Rebalancing Request
```javascript
POST /api/bikes/rebalance
{
  "sourceStations": [
    { "stationId": "municipal/0", "bikesToMove": 10 }
  ],
  "destStations": [
    { "stationId": "municipal/5", "bikesToReceive": 10 }
  ],
  "priority": "immediate" | "tomorrow" | "scheduled",
  "cost": 50  // euros (envía camión)
}

Response:
{
  "rebalanceId": "RB_001",
  "estimatedCompletion": "2024-11-05T14:00:00Z",
  "cost": 50,
  "expectedOccupancy": [0.75, 0.82, ...]
}
```

#### Bike Analytics
```javascript
GET /api/bikes/analytics
{
  "startTime": "2024-11-05T00:00:00Z",
  "endTime": "2024-11-05T23:59:59Z",
  "metrics": ["usage", "availability", "balancing_need"]
}

Response:
{
  "totalTrips": 1456,
  "totalUsers": 842,
  "avgTripDuration": 1240,  // segundos
  "availability": 0.68,      // % estaciones con bikes
  "dockAvailability": 0.62,  // % estaciones con espacios
  "unbalancedStations": ["municipal/0", "municipal/8"],
  "recommendedRebalance": { "source": "municipal/0", "dest": "municipal/8", "bikes": 15 }
}
```

---

### 2.5 GESTIÓN DE PEATONES

#### Modify Crossing Timing
```javascript
PUT /api/pedestrians/crossings/:crossingId
{
  "greenTime": 25,       // segundos para cruzar
  "detectionMode": "button" | "always" | "demand_responsive"
}

Response:
{
  "crossingId": "crossing_001",
  "waitTimeReduction": "15%",
  "safetyImprovement": "better"
}
```

#### Pedestrian Analytics
```javascript
GET /api/pedestrians/analytics
{
  "zone": "downtown" | "beach" | "station",
  "startTime": "2024-11-05T00:00:00Z",
  "endTime": "2024-11-05T23:59:59Z"
}

Response:
{
  "totalPedestrians": 45230,
  "avgDensity": 2.1,     // personas por m²
  "peakDensity": 5.3,
  "peakTime": "12:30",
  "accidents": 1,
  "crowdedAreas": [
    { "location": "main_square", "density": 6.2, "recommendation": "add crossings" }
  ]
}
```

---

### 2.6 CALIDAD DEL AIRE

#### Get Air Quality
```javascript
GET /api/air-quality
{
  "zone": "downtown" | "beach" | "industrial" | "residential",
  "metrics": ["pm25", "no2", "co", "o3"]
}

Response:
{
  "zone": "downtown",
  "pm25": { "value": 42, "status": "moderate", "threshold": 35 },
  "no2": { "value": 156, "status": "high", "threshold": 200 },
  "co": { "value": 8.2, "status": "good" },
  "o3": { "value": 125, "status": "moderate" },
  "overallAQI": 142,
  "recommendation": "restrict_heavy_vehicles"
}
```

#### Air Quality Alert & Response
```javascript
POST /api/air-quality/alert
{
  "triggerType": "pm25_high" | "no2_high" | "ozone_high",
  "severity": "level_1" | "level_2" | "level_3",
  "actions": [
    "restrict_diesel_vehicles",
    "increase_bus_frequency",
    "activate_congestion_pricing",
    "notify_population"
  ]
}

Response:
{
  "alertId": "ALR_001",
  "activated": true,
  "expectedImpact": {
    "pm25_reduction": "18%",
    "vehicle_reduction": "22%"
  }
}
```

---

### 2.7 EVENTS & EMERGENCIES

#### Create Event
```javascript
POST /api/city/events
{
  "name": "Christmas Market",
  "location": "main_square",
  "startTime": "2024-11-15T10:00:00Z",
  "endTime": "2024-11-15T20:00:00Z",
  "expectedAttendees": 5000,
  "impacts": {
    "closedStreets": ["street_123", "street_456"],
    "modifiedBusRoutes": ["L3", "L5"],
    "additionalBuses": 5,
    "reservedParking": "downtown_P2"
  }
}

Response:
{
  "eventId": "EVT_001",
  "mobilityPlan": {
    "publicTransitIncrease": "40%",
    "parkingCost": "€8",
    "estimatedWaitTimes": "30 min"
  }
}
```

#### Emergency Response
```javascript
POST /api/emergency/create-corridor
{
  "emergencyType": "ambulance" | "fire_truck" | "police",
  "source": { "lat": 43.318, "lon": -1.975 },
  "destination": { "lat": 43.325, "lon": -1.965 },
  "priority": "high"
}

Response:
{
  "corridorId": "EMERG_001",
  "route": ["signal_1", "signal_2", "street_123"],
  "estimatedClearingTime": 180,  // segundos
  "affectedVehicles": 45
}
```

---

## 3. IMPLEMENTACIÓN POR FASES

### Fase 1: Core API (Semana 1-2)
- [ ] Traffic signal endpoints
- [ ] Street closure endpoints
- [ ] Basic traffic analytics
- [ ] Documentation

### Fase 2: Public Transit (Semana 3)
- [ ] Bus line modification
- [ ] Bus analytics
- [ ] Bus priority signals

### Fase 3: Parking & Congestion (Semana 4)
- [ ] Parking rates
- [ ] Congestion pricing zones
- [ ] Parking analytics

### Fase 4: Bikes & Pedestrians (Semana 5)
- [ ] Bike capacity management
- [ ] Bike analytics
- [ ] Pedestrian crossing control

### Fase 5: Advanced Features (Semana 6+)
- [ ] Air quality monitoring
- [ ] Event management
- [ ] Emergency response
- [ ] Predictive analytics

---

## 4. ESTRUCTURA DE CARPETAS SUGERIDA

```
src/
├── api/                          # ← NUEVA CARPETA
│   ├── index.js                  # Router principal
│   ├── controllers/
│   │   ├── traffic.js
│   │   ├── transit.js
│   │   ├── parking.js
│   │   ├── bikes.js
│   │   ├── pedestrians.js
│   │   ├── airQuality.js
│   │   └── events.js
│   ├── services/
│   │   ├── trafficService.js
│   │   ├── transitService.js
│   │   ├── parkingService.js
│   │   └── ...
│   ├── validators/
│   │   └── inputValidator.js
│   └── responses/
│       └── apiResponse.js
├── traffic/
│   ├── sim.js
│   ├── graph.js
│   ├── signals.js                # ← MODIFICAR
│   └── ...
├── transit/
│   ├── buses.js                  # ← MODIFICAR
│   └── ...
└── sensors/
    ├── sensorManager.js          # ← MODIFICAR
    └── ...
```

---

## 5. PATRONES DE CÓDIGO

### 5.1 Controlador Template
```javascript
// api/controllers/traffic.js
import { validatSignalUpdate } from '../validators/inputValidator.js';
import { updateSignalTiming } from '../services/trafficService.js';
import { ApiResponse } from '../responses/apiResponse.js';

export async function updateSignal(req, res) {
  try {
    const { signalId } = req.params;
    const { green, yellow, plan } = req.body;

    // Validar entrada
    const validation = validateSignalUpdate({ green, yellow, plan });
    if (!validation.valid) {
      return res.status(400).json(ApiResponse.error(validation.errors));
    }

    // Ejecutar lógica de negocio
    const result = await updateSignalTiming(signalId, { green, yellow, plan });

    // Retornar respuesta
    return res.status(200).json(ApiResponse.success(result));
  } catch (error) {
    console.error('Error updating signal:', error);
    return res.status(500).json(ApiResponse.error(error.message));
  }
}
```

### 5.2 Service Template
```javascript
// api/services/trafficService.js
import { SignalController } from '../../traffic/signals.js';

export function updateSignalTiming(signalId, { green, yellow, plan }) {
  const controller = getSignalController(); // obtener instancia global
  
  // Validar que señal existe
  const signal = controller.signals.find(s => s.id === signalId);
  if (!signal) throw new Error(`Signal ${signalId} not found`);

  // Aplicar cambio
  controller.setSignalTiming(signalId, { green, yellow });
  
  // Retornar estado actualizado
  return {
    signalId,
    green,
    yellow,
    plan,
    estimatedImpact: calculateImpact(signalId, { green, yellow })
  };
}
```

### 5.3 Response Template
```javascript
// api/responses/apiResponse.js
export class ApiResponse {
  static success(data, message = 'Success') {
    return {
      status: 'success',
      message,
      data,
      timestamp: new Date().toISOString()
    };
  }

  static error(errors, message = 'Error') {
    return {
      status: 'error',
      message,
      errors: Array.isArray(errors) ? errors : [errors],
      timestamp: new Date().toISOString()
    };
  }
}
```

---

## 6. TESTING

### Test Unit
```javascript
// test/api/trafficService.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { updateSignalTiming } from '../../src/api/services/trafficService.js';

test('updateSignalTiming should change green time', () => {
  const result = updateSignalTiming('signal_001', { green: 50 });
  assert.strictEqual(result.green, 50);
});

test('updateSignalTiming should throw if signal not found', () => {
  assert.throws(
    () => updateSignalTiming('invalid_id', { green: 50 }),
    /not found/
  );
});
```

### Test Integration
```javascript
// test/api/traffic.integration.test.js
test('PUT /api/traffic/signals/:id should update timing', async () => {
  const response = await fetch(
    'http://localhost:3000/api/traffic/signals/signal_001',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ green: 50, yellow: 3 })
    }
  );

  assert.strictEqual(response.status, 200);
  const data = await response.json();
  assert.strictEqual(data.status, 'success');
  assert.strictEqual(data.data.green, 50);
});
```

---

## 7. DOCUMENTACIÓN OPENAPI/SWAGGER

```yaml
# api/openapi.yaml
openapi: 3.0.0
info:
  title: SmartCity Management API
  version: 1.0.0
servers:
  - url: http://localhost:3000/api

paths:
  /traffic/signals/{signalId}:
    put:
      summary: Update signal timing
      parameters:
        - name: signalId
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                green:
                  type: integer
                  description: Green light duration in seconds
                yellow:
                  type: integer
                  description: Yellow light duration in seconds
      responses:
        '200':
          description: Signal updated successfully
```

---

## 8. CONSIDERACIONES DE ESTADO

### Persistencia
- Cambios se guardan en memoria durante sesión
- Implementar `.snapshot()` para guardar estado
- Implementar `.restore(snapshot)` para cargar estado

### Validación
- Valores deben estar dentro de rangos razonables
- Green: 10-120 segundos
- Yellow: 2-5 segundos
- Buses: 1-20 por línea
- Capacidad de bikes: 1-60 docks

### Límites de Recursos
- Máximo 20 eventos simultáneos
- Máximo 5 zonas de restricción activas
- Máximo 3 rebalances simultáneos de bikes

---

## 9. MONITOREO Y LOGGING

```javascript
// api/middleware/logging.js
export function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  next();
}
```

---

## 10. MÉTRICAS A EXPONER

```javascript
// Usar endpoints existentes o crear nuevos
GET /api/metrics
{
  "trafficCongestion": 62,
  "avgTravelTime": 25.5,
  "emissions": {
    "pm25": 42,
    "no2": 156
  },
  "publicTransitOccupancy": 68,
  "parkingOccupancy": 82,
  "bikeAvailability": 0.71,
  "pedestrianFlow": 12450,
  "airQualityIndex": 142
}
```

