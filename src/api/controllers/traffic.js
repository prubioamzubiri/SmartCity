/**
 * Traffic Management Controller
 * 
 * Endpoints para gestionar el tráfico de la ciudad:
 * - Control de semáforos
 * - Cierre de calles
 * - Restricciones de vehículos
 * - Análisis de tráfico
 */

export class TrafficController {
  constructor(runtime) {
    this.runtime = runtime;
    this.engine = runtime.engine;
  }

  /**
   * GET /api/traffic/signals/:signalId
   * 
   * Obtener estado actual de un semáforo
   */
  async getSignal(req, res, signalId) {
    try {
      const signal = this.engine.sim.signals.graph.signals.find(
        (s) => String(s.id) === String(signalId)
      );

      if (!signal) {
        return res.status(404).json({
          status: 'error',
          message: `Signal ${signalId} not found`
        });
      }

      const timing = this.engine.sim.signals.timing(signal);
      
      return res.status(200).json({
        status: 'success',
        data: {
          signalId: signal.id,
          green: timing.green,
          yellow: timing.yellow,
          currentState: 'green', // TODO: obtener estado real del semáforo
          congestionLevel: 50 // TODO: calcular basado en tráfico actual
        }
      });
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: error.message
      });
    }
  }

  /**
   * PUT /api/traffic/signals/:signalId
   * 
   * Modificar tiempos de un semáforo
   * 
   * Body:
   * {
   *   green: 45,      // segundos
   *   yellow: 3,      // segundos
   *   plan?: "rush_hour" | "normal" | "night" | "custom"
   * }
   */
  async updateSignal(req, res, signalId) {
    try {
      const { green, yellow } = req.body;

      // Validación
      if (typeof green !== 'number' || green < 10 || green > 120) {
        return res.status(400).json({
          status: 'error',
          message: 'Green time must be between 10 and 120 seconds'
        });
      }
      if (typeof yellow !== 'number' || yellow < 2 || yellow > 5) {
        return res.status(400).json({
          status: 'error',
          message: 'Yellow time must be between 2 and 5 seconds'
        });
      }

      const signal = this.engine.sim.signals.graph.signals.find(
        (s) => String(s.id) === String(signalId)
      );

      if (!signal) {
        return res.status(404).json({
          status: 'error',
          message: `Signal ${signalId} not found`
        });
      }

      // Actualizar timing
      this.engine.sim.signals.setSignalTiming(signal.id, { green, yellow });

      return res.status(200).json({
        status: 'success',
        data: {
          signalId: signal.id,
          green,
          yellow,
          message: 'Signal timing updated',
          estimatedImpact: {
            congestionChange: '-5%', // TODO: calcular impacto estimado
            timeAllocationNS: `${green + yellow}s`,
            timeAllocationEO: `${green + yellow}s`
          }
        }
      });
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: error.message
      });
    }
  }

  /**
   * PUT /api/traffic/signals (global plan)
   * 
   * Aplicar un plan de sincronización a todos los semáforos
   * 
   * Body:
   * {
   *   plan: "rush_hour" | "normal" | "night",
   *   default: { green: 40, yellow: 3 },
   *   signals?: { "<signalId>": { green: 50, yellow: 3 } }  // overrides
   * }
   */
  async updateGlobalPlan(req, res) {
    try {
      const { default: defaultTiming, signals: signalOverrides } = req.body;

      if (!defaultTiming || typeof defaultTiming.green !== 'number') {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid global plan format'
        });
      }

      // Aplicar plan global
      this.engine.sim.signals.setGlobalGreen(
        defaultTiming.green,
        defaultTiming.yellow || 3
      );

      // Aplicar overrides por semáforo
      if (signalOverrides && typeof signalOverrides === 'object') {
        for (const [signalId, timing] of Object.entries(signalOverrides)) {
          if (timing.green || timing.yellow) {
            this.engine.sim.signals.setSignalTiming(signalId, timing);
          }
        }
      }

      return res.status(200).json({
        status: 'success',
        data: {
          message: 'Global signal plan applied',
          affectedSignals: this.engine.sim.signals.signals.length,
          defaultTiming,
          overrideCount: Object.keys(signalOverrides || {}).length
        }
      });
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: error.message
      });
    }
  }

  /**
   * PUT /api/traffic/streets/:streetId/access
   * 
   * Cerrar calle o restringir acceso
   * 
   * Body:
   * {
   *   mode: "closed" | "buses_only" | "pedestrians_only" | "residents_only" | "open",
   *   startTime?: "2024-11-05T08:00:00Z",
   *   endTime?: "2024-11-05T18:00:00Z",
   *   reason?: "construction" | "event" | "congestion" | "air_quality"
   * }
   */
  async updateStreetAccess(req, res, streetId) {
    try {
      const { mode, startTime, endTime, reason } = req.body;

      const validModes = ['closed', 'buses_only', 'pedestrians_only', 'residents_only', 'open'];
      if (!validModes.includes(mode)) {
        return res.status(400).json({
          status: 'error',
          message: `Mode must be one of: ${validModes.join(', ')}`
        });
      }

      // TODO: Implementar lógica de cierre de calles en sim
      // Por ahora retornamos respuesta simulada para que alumnos tengan estructura

      return res.status(200).json({
        status: 'success',
        data: {
          streetId,
          mode,
          startTime: startTime || new Date().toISOString(),
          endTime: endTime || new Date(Date.now() + 3600000).toISOString(),
          reason,
          affectedVehicles: Math.floor(Math.random() * 100),
          expectedDelay: Math.floor(Math.random() * 300),
          message: `Street access changed to "${mode}"`
        }
      });
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: error.message
      });
    }
  }

  /**
   * PUT /api/traffic/zones/:zoneId/restrictions
   * 
   * Crear restricción de vehículos en zona
   * 
   * Body:
   * {
   *   type: "emissions_low" | "year_gt_5" | "odd_even" | "permit_required",
   *   severity: "level_1" | "level_2" | "level_3",
   *   startDate?: "2024-11-05",
   *   endDate?: "2024-11-15"
   * }
   */
  async updateVehicleRestriction(req, res, zoneId) {
    try {
      const { type, severity, startDate, endDate } = req.body;

      const validTypes = ['emissions_low', 'year_gt_5', 'odd_even', 'permit_required'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({
          status: 'error',
          message: `Type must be one of: ${validTypes.join(', ')}`
        });
      }

      // TODO: Implementar restricciones en sim

      return res.status(200).json({
        status: 'success',
        data: {
          zoneId,
          type,
          severity,
          startDate: startDate || new Date().toISOString().slice(0, 10),
          endDate: endDate || new Date(Date.now() + 7 * 24 * 3600000).toISOString().slice(0, 10),
          affectedVehicles: Math.floor(Math.random() * 1000),
          expectedReduction: '15-25%',
          message: `Vehicle restriction of type "${type}" applied to zone ${zoneId}`
        }
      });
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: error.message
      });
    }
  }

  /**
   * GET /api/traffic/analytics
   * 
   * Obtener análisis de tráfico (histórico)
   * 
   * Query params:
   * - startTime: ISO timestamp
   * - endTime: ISO timestamp
   * - metrics: comma-separated (congestion,emissions,avg_speed,accident_count)
   */
  async getTrafficAnalytics(req, res) {
    try {
      // TODO: Conectar con base de datos de histórico

      return res.status(200).json({
        status: 'success',
        data: {
          congestion: {
            peak_hour: '08:30',
            peak_level: 87,
            avg_level: 62,
            trend: 'increasing'
          },
          emissions: {
            pm25_avg: 42,
            no2_avg: 156,
            co_avg: 8
          },
          avg_speed: 32.5,
          accident_count: 3,
          message: 'Traffic analytics retrieved'
        }
      });
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: error.message
      });
    }
  }
}

export default TrafficController;
