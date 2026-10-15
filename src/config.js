export const CONFIG = {
  dataUrl: `${import.meta.env.BASE_URL}data/city.json`,

  sim: {
    step: 0.25, // segundos simulados por paso de física
    maxStepsPerFrame: 200,
    startSeconds: 7 * 3600, // lunes 07:00
    baseDate: Date.UTC(2026, 0, 5), // lunes
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
};
