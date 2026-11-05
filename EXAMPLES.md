# Ejemplos de Uso - SmartCity AI

Aquí hay ejemplos prácticos de cómo los alumnos pueden desarrollar una IA para gestionar la ciudad.

## Ejemplo 1: IA Simple de Control de Semáforos

```javascript
// smart-traffic-ai.js
import fetch from 'node-fetch';

class TrafficManagementAI {
  constructor(apiUrl = 'http://localhost:3000/api') {
    this.apiUrl = apiUrl;
  }

  // Obtener densidad de tráfico en una intersección
  async getTrafficDensity(signalId) {
    const response = await fetch(`${this.apiUrl}/traffic/signals/${signalId}`);
    return await response.json();
  }

  // Cambiar tiempo de semáforo
  async updateSignal(signalId, greenTime) {
    const response = await fetch(
      `${this.apiUrl}/traffic/signals/${signalId}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          green: greenTime,
          yellow: 3
        })
      }
    );
    return await response.json();
  }

  // IA: Si hay congestión, aumentar tiempo verde
  async optimizeSignal(signalId) {
    const status = await this.getTrafficDensity(signalId);
    const congestionLevel = status.data.congestionLevel || 50;

    // Lógica simple: más congestión = más tiempo verde
    let greenTime = 40;
    if (congestionLevel > 70) {
      greenTime = 60;
    } else if (congestionLevel > 50) {
      greenTime = 50;
    }

    const result = await this.updateSignal(signalId, greenTime);
    console.log(`Signal ${signalId}: Green=${greenTime}s, Congestion=${congestionLevel}%`);
    return result;
  }
}

// Uso
const ai = new TrafficManagementAI();
await ai.optimizeSignal('signal_001');
```

## Ejemplo 2: IA de Gestión de Buses

```javascript
// smart-transit-ai.js
class TransitManagementAI {
  constructor(apiUrl = 'http://localhost:3000/api') {
    this.apiUrl = apiUrl;
  }

  async getBusLineAnalytics(lineId) {
    const response = await fetch(
      `${this.apiUrl}/buses/lines/${lineId}/analytics`
    );
    return await response.json();
  }

  async updateBusLine(lineId, busCount, frequency) {
    const response = await fetch(
      `${this.apiUrl}/buses/lines/${lineId}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          busCount,
          frequency
        })
      }
    );
    return await response.json();
  }

  // IA: Si ocupación es alta, agregar buses
  async optimizeBusLine(lineId) {
    const analytics = await this.getBusLineAnalytics(lineId);
    const { avgOccupancy, busCount } = analytics.data;

    let newBusCount = busCount;
    if (avgOccupancy > 85) {
      newBusCount = Math.min(busCount + 2, 15); // max 15 buses
    } else if (avgOccupancy < 40 && busCount > 2) {
      newBusCount = busCount - 1; // menos buses si no hay demanda
    }

    if (newBusCount !== busCount) {
      const result = await this.updateBusLine(lineId, newBusCount, 300);
      console.log(`Line ${lineId}: Occupancy=${avgOccupancy}%, Buses=${newBusCount}`);
      return result;
    }
  }
}

const transitAI = new TransitManagementAI();
await transitAI.optimizeBusLine('L3');
```

## Ejemplo 3: IA de Control de Estacionamiento

```javascript
// smart-parking-ai.js
class ParkingManagementAI {
  constructor(apiUrl = 'http://localhost:3000/api') {
    this.apiUrl = apiUrl;
  }

  async getParkingAnalytics(parkingId) {
    const response = await fetch(
      `${this.apiUrl}/parking/${parkingId}/analytics`
    );
    return await response.json();
  }

  async updateParkingRate(parkingId, pricePerHour) {
    const response = await fetch(
      `${this.apiUrl}/parking/${parkingId}/rates`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pricePerHour })
      }
    );
    return await response.json();
  }

  // IA: Ajustar precio para mantener ocupación al 75%
  async optimizeParkingPrice(parkingId, targetOccupancy = 0.75) {
    const analytics = await this.getParkingAnalytics(parkingId);
    const { currentOccupancy, currentPrice } = analytics.data;

    let newPrice = currentPrice;
    if (currentOccupancy > targetOccupancy + 0.05) {
      // Muy lleno, aumentar precio
      newPrice = currentPrice * 1.1;
    } else if (currentOccupancy < targetOccupancy - 0.05) {
      // Muy vacío, reducir precio
      newPrice = currentPrice * 0.9;
    }

    if (Math.abs(newPrice - currentPrice) > 0.01) {
      const result = await this.updateParkingRate(parkingId, newPrice);
      console.log(`Parking ${parkingId}: Occupancy=${(currentOccupancy * 100).toFixed(1)}%, Price=€${newPrice.toFixed(2)}`);
      return result;
    }
  }
}

const parkingAI = new ParkingManagementAI();
await parkingAI.optimizeParkingPrice('downtown_P1');
```

## Ejemplo 4: IA Completa - Optimización Multi-Objetivo

```javascript
// smart-city-ai.js
import { TrafficManagementAI } from './smart-traffic-ai.js';
import { TransitManagementAI } from './smart-transit-ai.js';
import { ParkingManagementAI } from './smart-parking-ai.js';

class SmartCityAI {
  constructor(apiUrl = 'http://localhost:3000/api') {
    this.traffic = new TrafficManagementAI(apiUrl);
    this.transit = new TransitManagementAI(apiUrl);
    this.parking = new ParkingManagementAI(apiUrl);
    this.apiUrl = apiUrl;
  }

  async getCityMetrics() {
    const response = await fetch(`${this.apiUrl}/metrics`);
    return await response.json();
  }

  async optimizeCity() {
    const metrics = await this.getCityMetrics();
    const { trafficCongestion, emissions, publicTransitOccupancy } = metrics.data;

    console.log('=== SmartCity Optimization Report ===');
    console.log(`Current Congestion: ${trafficCongestion}%`);
    console.log(`Current Emissions (PM2.5): ${emissions.pm25} μg/m³`);
    console.log(`Transit Occupancy: ${publicTransitOccupancy}%`);

    // Estrategia: si congestión > 70%, fomentar transporte público
    if (trafficCongestion > 70) {
      console.log('\n→ High congestion detected!');
      console.log('  Action: Increasing bus frequency...');
      
      const busLines = ['L1', 'L3', 'L5'];
      for (const lineId of busLines) {
        await this.transit.optimizeBusLine(lineId);
      }

      // Bajar precio de parking para evitar que busquen estacionamiento
      console.log('  Action: Reducing parking prices...');
      await this.parking.optimizeParkingPrice('downtown_P1', 0.70);
    }

    // Si emisiones altas, restringir vehículos contaminantes
    if (emissions.pm25 > 40) {
      console.log('\n→ High pollution detected!');
      console.log('  Action: Requesting vehicle restrictions...');
      // Aquí se llamaría a endpoint de restricción
    }

    console.log('\n✓ Optimization complete!');
  }

  // Ejecutar continuamente cada 5 minutos
  async startAutoOptimization(intervalMinutes = 5) {
    console.log(`SmartCity AI started. Optimizing every ${intervalMinutes} minutes...`);
    setInterval(() => this.optimizeCity(), intervalMinutes * 60 * 1000);
  }
}

// Uso
const cityAI = new SmartCityAI();
await cityAI.startAutoOptimization(5);
```

## Ejemplo 5: IA con Análisis Predictivo

```javascript
// smart-city-predictive-ai.js
class PredictiveAI {
  constructor(apiUrl) {
    this.apiUrl = apiUrl;
    this.history = [];
    this.maxHistory = 100; // guardar últimas 100 mediciones
  }

  // Guardar métrica histórica
  recordMetric(timestamp, metric, value) {
    this.history.push({ timestamp, metric, value });
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  // Predecir congestión basada en histórico
  predictCongestion() {
    const recent = this.history
      .filter(h => h.metric === 'congestion')
      .slice(-10);

    if (recent.length < 3) return null;

    // Calcular promedio móvil
    const values = recent.map(h => h.value);
    const avg = values.reduce((a, b) => a + b) / values.length;
    const trend = values[values.length - 1] - values[0];

    return {
      currentLevel: values[values.length - 1],
      trend: trend > 0 ? 'increasing' : 'decreasing',
      predictedIncrease: trend,
      recommendation: trend > 10 ? 'increase_bus_frequency' : 'normal'
    };
  }

  // Actuar basándose en predicción
  async reactToPrediction(prediction) {
    if (prediction.recommendation === 'increase_bus_frequency') {
      console.log('Prediction: Congestion will increase!');
      console.log('Action: Proactively increasing bus frequency...');
      // Llamar a API para aumentar buses
    }
  }
}
```

## Ejemplo 6: Desafío - IA que Balancea Múltiples Objetivos

```javascript
// challenge-multiobjective-ai.js
/**
 * Desafío para alumnos avanzados:
 * Crear una IA que optimice SIMULTÁNEAMENTE:
 * 1. Reducir congestión (< 50%)
 * 2. Mejorar calidad del aire (PM2.5 < 35)
 * 3. Reducir contaminación sonora (< 70dB)
 * 4. Maximizar viajes en transporte público (> 65%)
 * 5. Optimizar ingresos de estacionamiento
 * 
 * Restricciones:
 * - Presupuesto limitado (€5000/día)
 * - No se puede cerrar más de 3 calles
 * - Máximo 20 buses por línea
 * 
 * Estrategia sugerida:
 * - Usar método de "weighted scoring"
 * - Cada objetivo tiene peso (importancia)
 * - Calcular score total = sum(objective * weight)
 * - Elegir acción que maximiza score total
 */

class MultiObjectiveAI {
  constructor(apiUrl) {
    this.apiUrl = apiUrl;
    // Pesos (ajustar según prioridades)
    this.weights = {
      congestion: 0.30,        // 30%
      airQuality: 0.25,        // 25%
      transitUsage: 0.20,      // 20%
      soundNoise: 0.15,        // 15%
      revenue: 0.10            // 10%
    };
  }

  calculateObjectiveScore(metrics) {
    let score = 0;

    // Objetivo 1: Congestión baja
    const congestionScore = Math.max(0, 100 - metrics.congestion);
    score += congestionScore * this.weights.congestion;

    // Objetivo 2: Aire limpio
    const airScore = Math.max(0, 100 - (metrics.pm25 * 2));
    score += airScore * this.weights.airQuality;

    // Objetivo 3: Más transporte público
    const transitScore = metrics.transitUsage * 100;
    score += transitScore * this.weights.transitUsage;

    // Objetivo 4: Menos ruido
    const soundScore = Math.max(0, 100 - (metrics.soundDB - 50));
    score += soundScore * this.weights.soundNoise;

    // Objetivo 5: Ingresos de estacionamiento
    const revenueScore = Math.min(metrics.parkingRevenue / 50, 100); // max 100
    score += revenueScore * this.weights.revenue;

    return score;
  }

  // Experimentar con diferentes acciones y elegir la mejor
  async findBestAction(currentMetrics, possibleActions) {
    let bestAction = null;
    let bestScore = this.calculateObjectiveScore(currentMetrics);

    for (const action of possibleActions) {
      // Simular impacto de la acción
      const projectedMetrics = this.simulateAction(currentMetrics, action);
      const score = this.calculateObjectiveScore(projectedMetrics);

      if (score > bestScore) {
        bestScore = score;
        bestAction = action;
      }
    }

    return bestAction;
  }

  simulateAction(metrics, action) {
    // Implementar modelo que predice impacto de acciones
    // Por ejemplo: aumentar bus freq → -5% congestión, +2% transit
    const projected = { ...metrics };

    if (action.type === 'increase_buses') {
      projected.congestion -= 5;
      projected.transitUsage += 3;
      projected.parkingRevenue -= 2; // menos gente estacionándose
    }
    // ... más acciones

    return projected;
  }
}
```

## Para Ejecutar los Ejemplos

```bash
# Instalar dependencias
npm install node-fetch

# Ejecutar ejemplo simple
node smart-traffic-ai.js

# Ejecutar IA completa
node smart-city-ai.js

# Ejecutar desafío avanzado
node challenge-multiobjective-ai.js
```

## Datos de Prueba

Para pruebas sin servidor real, aquí hay datos mock:

```javascript
// mock-api.js
export const mockMetrics = {
  trafficCongestion: 65,
  avgTravelTime: 28.5,
  emissions: { pm25: 45, no2: 175 },
  publicTransitOccupancy: 62,
  parkingOccupancy: 0.78,
  bikeAvailability: 0.65,
  pedestrianFlow: 10250,
  airQualityIndex: 156
};

export const mockBusLine = {
  lineId: 'L3',
  busCount: 6,
  frequency: 300,
  avgOccupancy: 72,
  waitTimeAvg: 380,
  passengers: 945
};
```

---

## Tips para Alumnos

1. **Start Small**: Comienza optimizando una cosa (tráfico O buses O parking)
2. **Test Thoroughly**: Prueba tu IA en diferentes horas del día
3. **Monitor Results**: Compara métricas antes/después de cambios
4. **Avoid Oscillation**: Si tu IA cambia valores constantemente, agrega histéresis
5. **Balance Objectives**: No optimices solo para congestión (ignora contaminación)
6. **Document Decisions**: Explica por qué tu IA toma cada decisión
7. **Peer Review**: Compara resultados con otros alumnos

