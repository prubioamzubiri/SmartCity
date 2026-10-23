export const CONFIG = {
  dataUrl: `${import.meta.env?.BASE_URL ?? '/'}data/city.json`,

  sim: {
    step: 0.25, // segundos simulados por paso de física
    maxStepsPerFrame: 200,
    startSeconds: 7 * 3600, // lunes 07:00
    baseDate: Date.UTC(2026, 0, 5), // lunes
  },

  traffic: {
    scenario: 'auto', // auto, weekday o weekend
    dailyVariation: 0.1, // variación determinista ±10%; 0 para desactivarla
    scenarios: {
      weekday: {
        multiplier: 1,
        hourly: [
          0.06, 0.04, 0.03, 0.03, 0.05, 0.15, 0.4, 0.85, 1.0, 0.75, 0.6, 0.6,
          0.7, 0.7, 0.65, 0.65, 0.8, 0.95, 1.0, 0.8, 0.5, 0.3, 0.18, 0.1,
        ],
      },
      weekend: {
        multiplier: 0.65,
        hourly: [
          0.15, 0.1, 0.07, 0.05, 0.04, 0.05, 0.1, 0.2, 0.35, 0.55, 0.75, 0.9,
          1.0, 0.95, 0.85, 0.8, 0.85, 0.95, 1.0, 0.9, 0.75, 0.55, 0.35, 0.22,
        ],
      },
    },
  },

  cars: {
    max: 3000,
    initialMax: 1500,
    radius: 2.2,
    length: 5,
    minGap: 2,
    accel: 2.2,
    decel: 4.5,
    laneOffset: 2.2,
    lookAhead: 60,
    stopGap: 3,
    // m/s por clase de vía: autovía, primaria, secundaria, terciaria, residencial
    speedByClass: [22, 16, 13, 11, 8],
  },

  signals: {
    green: 20,
    yellow: 3,
    clusterDistance: 45, // metros para agrupar semáforos de un mismo cruce
  },

  roads: {
    halfWidth: [9, 7, 5.5, 4.5, 3.5],
    colors: [0x59606e, 0x4f5663, 0x464c58, 0x3f4450, 0x383c47],
  },

  sensors: {
    bucketSeconds: 300,
    snapDistance: 30,
    storageKey: 'smartcity.sensors',
  },

  parkingTracking: {
    intervalSeconds: 300,
    storageKey: 'smartcity.parkings',
  },
};
