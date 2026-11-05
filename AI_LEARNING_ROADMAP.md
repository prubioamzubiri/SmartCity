# 🏙️ SmartCity AI - Learning Roadmap for Students

## Visión General

Este proyecto permite que los alumnos desarrollen **inteligencia artificial para gestionar una ciudad real** (Donostia/San Sebastián). Cada decisión que tomen tendrá impactos medibles en múltiples aspectos de la ciudad.

---

## 📊 Datos Disponibles (Input)

```
┌─────────────────────────────────────────────────┐
│         SENSORES DE LA CIUDAD (API)             │
├─────────────────────────────────────────────────┤
│ 🚗 Tráfico                                      │
│    • Densidad de vehículos por calle            │
│    • Velocidad promedio                         │
│    • Punto de congestión máximo                 │
│                                                 │
│ 👥 Peatones                                     │
│    • Flujo de personas por zona                 │
│    • Densidad en cruces                         │
│    • Tendencias de hora pico                    │
│                                                 │
│ 🚌 Transporte Público                           │
│    • Ocupación de buses (% llenos)              │
│    • Tiempo de espera en paradas                │
│    • Retrasos vs horario                        │
│                                                 │
│ 🅿️  Estacionamiento                             │
│    • Plazas libres por zona                     │
│    • Ocupación %                                │
│    • Tiempo promedio de búsqueda                │
│                                                 │
│ 🚴 Bicicletas Compartidas                       │
│    • Bicicletas disponibles por estación        │
│    • Espacios libres para devolver              │
│    • Patrón de flujo (A→B)                      │
│                                                 │
│ 🌍 Ambiente                                     │
│    • Calidad del aire (PM2.5, NO2)              │
│    • Contaminación sonora                       │
│    • Condiciones meteorológicas                 │
│                                                 │
│ ⏰ Contexto                                      │
│    • Hora del día (hora pico vs bajo)           │
│    • Día de semana                              │
│    • Eventos especiales próximos                │
└─────────────────────────────────────────────────┘
```

---

## 🎮 Acciones Disponibles (Output)

```
Tu IA Puede:

🚦 TRÁFICO
  ├─ Cambiar tiempos de semáforo (40s → 60s)
  ├─ Cerrar calles (solo peatones, solo buses)
  ├─ Sincronizar semáforos (onda verde)
  └─ Crear restricciones (placas impares/pares)

🚌 BUSES
  ├─ Agregar/remover buses de línea (6 → 8)
  ├─ Cambiar frecuencia de paso (5 min → 10 min)
  ├─ Crear/modificar rutas
  └─ Dar prioridad en semáforos

🅿️  PARKING
  ├─ Ajustar tarifas (€2.00 → €2.50/hora)
  ├─ Crear zonas de tarificación variable
  ├─ Cambiar duración máxima permitida
  └─ Buscar ubicación óptima para estación

🚴 BICICLETAS
  ├─ Cambiar capacidad de estaciones
  ├─ Programar rebalanceo (mover bikes)
  └─ Crear estaciones nuevas

👥 PEATONES
  ├─ Cambiar tiempo de cruces
  ├─ Crear zonas peatonales
  └─ Mejorar infraestructura

🌍 AMBIENTE
  ├─ Activar alertas de contaminación
  ├─ Restringir vehículos contaminantes
  └─ Incentivar transporte limpio
```

---

## 📈 Objetivos a Optimizar

```
┌──────────────────────────────────────────────┐
│ CONGESTIÓN                                   │
│ Objetivo: < 50% (0-100 scale)               │
│ Método: Semáforos + Buses + Parking          │
│ Beneficio: Viajes más rápidos                │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│ CONTAMINACIÓN                                │
│ Objetivo: PM2.5 < 35 μg/m³                  │
│ Método: Restricciones + Buses + Transporte   │
│ Beneficio: Aire más limpio = Salud pública   │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│ OCUPACIÓN PARKING                            │
│ Objetivo: 75-85% (ni lleno, ni vacío)        │
│ Método: Precios dinámicos                    │
│ Beneficio: Menos circulación buscando plaza  │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│ SATISFACCIÓN USUARIOS                        │
│ Objetivo: Tiempo espera bajo, buses llenos   │
│ Método: Más frecuencia + mejores horarios    │
│ Beneficio: Más gente usa transporte público  │
└──────────────────────────────────────────────┘
```

---

## 🎯 Niveles de Dificultad

### 🟢 NIVEL 1: Básico (Semana 1)

**Objetivo**: Hacer que 1 métrica mejore

**Proyecto Recomendado: Control de Semáforos**
```javascript
// Pseudocódigo
cada 5 minutos:
  congestion = leer_congestión()
  if congestion > 70:
    semáforo.green_time = 60
  else:
    semáforo.green_time = 40
```

**Salida esperada**: Congestión baja de 65% a 55%

**Archivo**: `solutions/level1-basic-traffic.js`

---

### 🟡 NIVEL 2: Intermedio (Semana 2-3)

**Objetivo**: Hacer que 2-3 métricas mejoren simultáneamente

**Proyecto Recomendado: Multi-Sistema Traffic + Transit**
```javascript
// Pseudocódigo
si congestión > 65:
  aumentar buses en 2
  cambiar semáforos para prioridad buses
  bajar precio estacionamiento
  resultado: congestión ↓, satisfacción ↑
```

**Salida esperada**: 
- Congestión: 65% → 45%
- Ocupación buses: 65% → 80%
- Precio estacionamiento optimizado

**Archivo**: `solutions/level2-intermediate-multi.js`

---

### 🔴 NIVEL 3: Avanzado (Semana 4-6)

**Objetivo**: Optimizar TODO simultáneamente

**Proyecto Recomendado: City-Wide Optimization**
```javascript
// Pseudocódigo
const weights = {
  congestion: 0.30,      // 30% importancia
  air_quality: 0.25,     // 25% importancia
  transit_usage: 0.20,
  parking_roi: 0.15,
  safety: 0.10
};

// Para cada acción posible:
score = evaluate_all_objectives(action)
best_action = argmax(score)
apply(best_action)
```

**Salida esperada**: 
- Congestión: < 45%
- Aire limpio: PM2.5 < 35
- Transporte público: > 70% ocupación
- Ingresos optimizados

**Archivo**: `solutions/level3-advanced-multiobjective.js`

---

## 📚 Curiculum por Semana

### SEMANA 1: Fundamentos
```
Día 1-2: Entender datos disponibles
  └─ Revisar /api/traffic/... endpoints
  └─ Revisar /api/buses/... endpoints
  
Día 3-4: Lógica simple
  └─ if/else rules
  └─ Hacer que congestión baje 10%
  
Día 5: Presentación
  └─ Compartir resultados con clase
```

**Entregable**: Script que baja congestión

---

### SEMANA 2-3: Algoritmos
```
Día 1-2: Loops y análisis histórico
  └─ Colectar datos 1 hora
  └─ Calcular promedio móvil
  
Día 3-4: Multi-sistema
  └─ Tráfico + Buses
  └─ Tráfico + Parking
  
Día 5: Testing
  └─ Comparar: no-IA vs tu-IA
  └─ Medir mejora en 3+ métricas
```

**Entregable**: Análisis comparativo con gráficas

---

### SEMANA 4-6: Optimización Avanzada
```
Día 1-3: Machine Learning intro
  └─ Regresión lineal para predicción
  └─ Identificar patrones (hora pica, etc)
  
Día 4-5: Multi-objetivo
  └─ Weighted scoring
  └─ Simular impacto de acciones
  
Día 6-7: Optimización
  └─ Buscar mejor combinación
  └─ Balancear trade-offs
  
Día 8: Presentación Final
  └─ Demostración en vivo
  └─ Competencia entre grupos
```

**Entregable**: IA inteligente + Report técnico

---

## 🔄 Ciclo de Desarrollo

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  1. MEDIR                                               │
│     ├─ Leer datos actuales (GET /api/metrics)           │
│     └─ Guardar histórico                                │
│                                                         │
│  2. ANALIZAR                                            │
│     ├─ ¿Hay problema? (congestión > 60?)               │
│     └─ ¿Cuál es la causa? (análisis)                    │
│                                                         │
│  3. DECIDIR                                             │
│     ├─ Qué acción tomar? (aumentar buses?)              │
│     └─ Probar múltiples opciones                        │
│                                                         │
│  4. ACTUAR                                              │
│     ├─ Ejecutar acción (PUT /api/buses/lines/:id)       │
│     └─ Esperar impacto                                  │
│                                                         │
│  5. EVALUAR                                             │
│     ├─ ¿Mejoró? (congestión 60% → 50%)                  │
│     └─ ¿Qué pasó con otros objetivos?                   │
│                                                         │
│  └─ REPETIR (volver a paso 1)                           │
│                                                         │
└─────────────────────────────────────────────────────────┘

Esto es un LOOP. Tu IA ejecuta esto cada 5-10 minutos.
```

---

## 🎓 Conceptos de Programación

Este proyecto enseña:

| Concepto | Ejemplo | Importancia |
|----------|---------|-------------|
| **APIs REST** | `fetch('/api/traffic/...') ` | ⭐⭐⭐ Fundamental |
| **Loops & Conditions** | `while (congestión > 60)` | ⭐⭐⭐ Básico |
| **Data Structures** | Arrays de métricas | ⭐⭐⭐ Esencial |
| **Análisis de datos** | Promedio, mediana, tendencia | ⭐⭐⭐ Clave |
| **Machine Learning** | Predicción, clustering | ⭐⭐ Avanzado |
| **Optimization** | Minimizar/maximizar objetivo | ⭐⭐ Avanzado |
| **Trade-offs** | Congestión vs contaminación | ⭐⭐⭐ Realismo |
| **Testing** | Comparar antes/después | ⭐⭐⭐ Calidad |

---

## 💡 Tips de Éxito

### ✅ Haz
- Comienza **pequeño** (1 métrica → 3 métricas)
- **Prueba en diferentes horas** (mañana vs noche)
- **Mide todo** (gráficas del antes/después)
- **Documenta decisiones** (¿por qué hiciste esto?)
- **Compara con otros** (mejor = competencia amistosa)
- **Itera** (v1 → v2 → v3 mejor cada vez)

### ❌ Evita
- No hagas cambios aleatorios (necesita lógica)
- No ignores efectos secundarios (si + buses, - congestión pero + ruido)
- No optimices solo 1 objetivo (ciudad real tiene múltiples)
- No cambies constantes cada 10 segundos (oscilación)
- No copies solución sin entender
- No olvides validar entrada (¿precio negativo?)

---

## 📊 Métricas para Evaluar tu IA

```
ANTES de tu IA:
  Congestión:        65%
  PM2.5:            45 μg/m³
  Buses:            60% ocupación
  Estacionamiento:  82% ocupado
  
DESPUÉS de tu IA (meta):
  Congestión:       < 50%        ✅ -15%
  PM2.5:           < 35 μg/m³    ✅ -25%
  Buses:           > 75%         ✅ +15%
  Estacionamiento: 70-80%        ✅ -2% (más equilibrado)

SCORE FINAL: (mejoras - problemas_creados) = Tu Nota
```

---

## 🏆 Desafíos Especiales

### 1️⃣ Speed Challenge
Optimiza lo máximo en solo 30 minutos de código.

### 2️⃣ Constraint Challenge
Logra tus objetivos con presupuesto limitado (€1000/día).

### 3️⃣ Fairness Challenge
Optimiza la ciudad SIN afectar negativamente a ningún grupo.

### 4️⃣ Prediction Challenge
Predice congestión 1 hora adelante y toma medidas preventivas.

### 5️⃣ Real-Time Challenge
Tu IA debe responder en < 100ms (¡eficiencia cuenta!)

---

## 📁 Estructura de Carpetas

```
SmartCity/
├── MANAGEMENT_OPTIONS.md       ← QUÉ hacer (opciones)
├── IMPLEMENTATION_PLAN.md      ← CÓMO implementar (técnico)
├── EXAMPLES.md                 ← EJEMPLOS de código
├── AI_LEARNING_ROADMAP.md      ← Este archivo (guía)
│
└── solutions/                  ← TU CÓDIGO
    ├── level1-basic-traffic.js
    ├── level2-intermediate-multi.js
    ├── level3-advanced-multiobjective.js
    └── my-solution-[nombre].js
```

---

## 🚀 Cómo Empezar

### Paso 1: Lee
```bash
1. Entender qué datos hay: MANAGEMENT_OPTIONS.md
2. Entender cómo programarlo: IMPLEMENTATION_PLAN.md
3. Ver ejemplos: EXAMPLES.md
```

### Paso 2: Elige un objetivo
```javascript
// Ejemplo: Bajar congestión
objetivo = "CONGESTIÓN < 50%"
datos_necesarios = ["congestión_actual", "flujo_coches"]
acciones_posibles = ["cambiar_semáforo", "cerrar_calle", "más_buses"]
```

### Paso 3: Código
```bash
touch solutions/my-solution-[nombre].js
# Escribe tu IA aquí
```

### Paso 4: Test
```bash
node solutions/my-solution-[nombre].js
# Ver resultados en la consola
```

### Paso 5: Mejora
```javascript
// Si congestión solo bajó 5%, necesitas mejor lógica
// Intenta combinar múltiples acciones
// Lee el histórico (últimas 10 mediciones)
// Predice y actúa preventivamente
```

---

## 🤝 Colaboración

Los alumnos pueden:
- Trabaja solo o en equipo (2-3 personas)
- Compartir ideas (no código) con otros equipos
- Competir por mejor optimización
- Presentar resultados en clase

---

## ❓ Preguntas Frecuentes

**P: ¿Qué pasa si mi IA hace algo muy mal?**
R: ¡Excelente! Eso es aprendizaje. Analiza qué salió mal y mejora. Los errores enseñan.

**P: ¿Puedo cambiar múltiples cosas simultáneamente?**
R: Sí, pero cuidado. Algunos cambios se contradicen. Mide cada uno.

**P: ¿Hay límite de cambios que puedo hacer?**
R: No, pero algunos tardan en tomar efecto (ej: capacidad bike = 30 días).

**P: ¿Cómo gano la competencia?**
R: No es solo congestión baja. Se evalúa: congestión + aire + equidad + ingresos.

**P: ¿Puedo usar Machine Learning?**
R: ¡Sí! Nivel avanzado. Empieza con regresión lineal para predicción.

---

## 📞 Recursos

| Recurso | Link | Uso |
|---------|------|-----|
| Docs API | IMPLEMENTATION_PLAN.md | Endpoints exactos |
| Ejemplos | EXAMPLES.md | Código para copiar |
| Opciones | MANAGEMENT_OPTIONS.md | Ideas de qué hacer |
| README | README.md | Contexto del proyecto |

---

¡Diviértete optimizando la ciudad! 🏙️✨

