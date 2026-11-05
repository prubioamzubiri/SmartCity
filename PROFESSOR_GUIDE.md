# 🏙️ SmartCity AI - Guía de Inicio para Profesores

## Resumen Ejecutivo

Has creado un **entorno de aprendizaje basado en IA** donde los alumnos:
1. Leen datos **reales** de una ciudad simulada (Donostia)
2. Desarrollan **algoritmos de IA** para optimizar el tráfico, transporte, etc.
3. **Toman decisiones** que tienen impacto medible en múltiples métricas

Es como un **"simulador de política pública"** pero para programación.

---

## 📊 ¿Qué Datos Hay Disponibles?

```
SENSORES DE CIUDAD
├─ 🚗 Tráfico: densidad, velocidad, congestión
├─ 👥 Peatones: flujo, densidad, cruces
├─ 🚌 Buses: ocupación, retrasos, líneas
├─ 🅿️  Parking: plazas libres, ocupación, precios
├─ 🚴 Bicis: disponibilidad, balance
├─ 🌍 Aire: PM2.5, NO2, contaminación
└─ ⏰ Contexto: hora, día, eventos
```

**Acceso**: Vía API REST (`GET /api/traffic/...`, etc.)

---

## 🎮 ¿Qué Pueden Hacer Los Alumnos?

```
ACCIONES DE GESTIÓN
├─ Cambiar tiempos de semáforo (40s → 60s)
├─ Cerrar calles (solo buses, solo peatones)
├─ Agregar/remover buses (6 → 8)
├─ Ajustar precios de parking (€2 → €2.50)
├─ Cambiar capacidad de estaciones de bikes
├─ Restricciones (placas pares/impares)
└─ Mucho más...
```

**Acceso**: Vía API REST (`PUT /api/traffic/...`, etc.)

---

## 🎯 Objetivo Pedagógico

Los alumnos practican:

| Concepto | Skill | Ejemplo |
|----------|-------|---------|
| **APIs REST** | Integración | Llamar `fetch('/api/buses/...')` |
| **Análisis de datos** | Programación | Calcular promedio de ocupación |
| **Toma de decisiones** | IA | Si ocupación > 80%, agregar buses |
| **Optimización** | Algoritmos | Minimizar congestión + contaminación |
| **Trade-offs** | Pensamiento crítico | Más buses = menos congestión pero + gasto |
| **Testing** | QA | Medir antes/después de cambios |

---

## 📁 Archivos Documentación

Hemos creado 5 documentos para diferentes audiencias:

### 1. **MANAGEMENT_OPTIONS.md** ← Para definir objetivos
**Audiencia**: Profesores + Alumnos
**Contenido**: 
- 25+ opciones de gestión disponibles
- Qué datos necesita cada una
- Qué impacto tiene
- Ejemplo: "Cambiar tiempos semáforo" → datos necesarios, acciones, métricas

**Uso en clase**: "Hoy vamos a trabajar en la sección 2.1 - Control de acceso a calles"

---

### 2. **IMPLEMENTATION_PLAN.md** ← Para desarrolladores
**Audiencia**: Profesores técnicos + Alumnos avanzados
**Contenido**:
- Especificación exacta de cada endpoint
- Parámetros, formatos de respuesta
- Validaciones requeridas
- Fases de implementación (6 semanas)

**Uso en clase**: "Este es el contrato de la API que vamos a implementar"

---

### 3. **EXAMPLES.md** ← Para aprender por ejemplo
**Audiencia**: Alumnos
**Contenido**:
- 6 ejemplos de código (simple → avanzado)
- Desde "cambiar 1 semáforo" hasta "multi-objetivo IA"
- Copy-paste ready

**Uso en clase**: "Aquí están los templates, adaptad el código a vuestra IA"

---

### 4. **AI_LEARNING_ROADMAP.md** ← Plan completo
**Audiencia**: Alumnos + Profesores
**Contenido**:
- Currículo de 6 semanas
- 3 niveles de dificultad (básico, intermedio, avanzado)
- Qué aprenderán cada semana
- Desafíos especiales (speed, fairness, prediction)

**Uso en clase**: "Semana 1: Control básico de semáforos"

---

### 5. **API_SETUP.md** ← Cómo implementar
**Audiencia**: Profesores técnicos
**Contenido**:
- Estructura de carpetas
- Controllers listos para completar
- Cómo integrar con servidor
- Ejemplos de testing

**Uso en clase**: "Aquí están los stubs, vosotros completad la lógica"

---

## 🚀 Flujo de Uso en Aula

### Sesión 1: Presentación (1 hora)
```
1. Mostrar simulación en tiempo real
   └─ "Esto es Donostia, veréis datos en vivo"

2. Explicar objetivo
   └─ MANAGEMENT_OPTIONS.md (lectura rápida)
   └─ "Vosotr@s vais a optimizar la ciudad"

3. Ver ejemplo simple
   └─ EXAMPLES.md (1º ejemplo)
   └─ "Mirad: con 10 líneas de código baja congestión"

4. Grupos y temas
   └─ "El grupo A: optimizar semáforos"
   └─ "El grupo B: gestionar buses"
   └─ Etc.
```

### Semana 1-2: Desarrollo Básico (4 horas)
```
1. Leer IMPLEMENTATION_PLAN.md
   └─ Entender qué endpoint necesitan

2. Ver AI_LEARNING_ROADMAP.md → Nivel 1
   └─ Saber exactamente qué espera de ellos

3. Copiar template de EXAMPLES.md
   └─ Adaptar a su caso

4. Testing
   └─ "¿Bajó congestión 10%?"
   └─ Si no, debuggear + iterar
```

### Semana 3-6: Desarrollo Avanzado (8 horas)
```
1. AI_LEARNING_ROADMAP.md → Niveles 2 y 3
   └─ Multi-objetivo, predicción, optimización

2. IMPLEMENTATION_PLAN.md → Endpoints más complejos
   └─ Restricciones, eventos, emergencias

3. Competencia
   └─ "¿Qué grupo logra mejor balance?"
   └─ Presentación + votación
```

---

## 📈 Métricas para Evaluar

### Desarrollo Técnico
```
Criterio              | Básico     | Avanzado
----------------------|------------|------------------
Endpoints usados      | 2-3        | 6+
Objetivos optimizados | 1          | 3+
Líneas de código      | < 100      | 200-500
Documentación         | Mínima     | Completa
Testing              | Manual     | Automatizado
```

### Resultados en Simulación
```
Métrica         | Inicial | Meta   | Bonus
----------------|---------|--------|--------
Congestión      | 65%     | < 50%  | < 40%
PM2.5           | 45      | < 35   | < 30
Bus ocupación   | 60%     | > 75%  | > 85%
Tiempo espera   | 25 min  | < 15min| < 10min
```

### Habilidades Adquiridas
- ✅ APIs REST
- ✅ Análisis de datos
- ✅ Toma de decisiones algorítmica
- ✅ Optimización multi-objetivo
- ✅ Testing y evaluación
- ✅ Pensamiento sistémico

---

## 🎓 Ejemplo: Lección de 45 minutos

### Tema: "Optimizar buses cuando hay congestión"

#### Parte 1: Teoria (10 min)
```
Mostrar MANAGEMENT_OPTIONS.md §2 (Transit):
"El problema: buses llenos, gente esperando"
"La solución: más buses"
"El trade-off: €$ gasto pero menos congestión"
```

#### Parte 2: Código (20 min)
```javascript
// EXAMPLES.md - Ejemplo 2

class TransitAI {
  async optimizeBusLine(lineId) {
    const analytics = await fetch(
      `/api/buses/lines/${lineId}/analytics`
    ).then(r => r.json());
    
    if (analytics.occupancy > 85) {
      await fetch(`/api/buses/lines/${lineId}`, {
        method: 'PUT',
        body: JSON.stringify({ busCount: 8 })
      });
    }
  }
}

// "¿Entendéis qué hace esto?"
// "¿Qué cambiarías?"
// "¿Qué problemas veis?"
```

#### Parte 3: Práctica (15 min)
```
1. Adaptad el código a vuestra IA
2. Probadlo (curl o fetch)
3. ¿Bajó congestión?
4. ¿Subió ocupación de buses?
5. ¿Qué falta?
```

---

## 💻 Requisitos Técnicos

### Para Profesores
- Servidor Node.js ejecutándose con simulación
- Acceso a `http://localhost:3000/api`
- Navegador con acceso a la visualización

### Para Alumnos
```
Necesitan:
✅ Node.js v20+
✅ curl o Postman (testing)
✅ Editor de texto
✅ 1-2 horas/semana dedicadas

No necesitan:
❌ Conocimiento de simulación
❌ Geografía de Donostia
❌ Ingeniería civil
```

---

## 🎯 Objetivos de Aprendizaje por Nivel

### 🟢 Nivel Básico (Semana 1)
```
"Bajo control de 1 métrica"
└─ Objetivo: Congestión < 50%
└─ Método: Si congestión > 60%, cambiar semáforo
└─ Entrega: Script funcional + gráfica
```

### 🟡 Nivel Intermedio (Semana 2-3)
```
"Controlo múltiples sistemas"
└─ Objetivo: Congestión < 45% + Aire limpio
└─ Método: Tráfico + Buses + Parking simultáneamente
└─ Entrega: IA multi-sistema + análisis de trade-offs
```

### 🔴 Nivel Avanzado (Semana 4-6)
```
"Optimizo TODO de forma inteligente"
└─ Objetivo: Balance congestión + aire + equidad + $ 
└─ Método: Weighted scoring, predicción, ML básico
└─ Entrega: IA de producción + paper técnico
```

---

## 📚 Estructura Pedagógica

```
SEMANA 1
├─ Lunes: Presentación + MANAGEMENT_OPTIONS.md
├─ Miércoles: IMPLEMENTATION_PLAN.md + coding basics
└─ Viernes: Entrega simple (nivel 1)

SEMANA 2-3
├─ EXAMPLES.md (nivel 2)
├─ Desarrollo iterativo
└─ Testing y mejora

SEMANA 4-6
├─ AI_LEARNING_ROADMAP.md (nivel 3)
├─ Optimización avanzada
├─ Comparación entre grupos
└─ Presentación final
```

---

## 🏆 Competencia

Podéis hacer una **competencia amistosa** entre grupos:

```
Criterios:
┌─────────────────────────────────────────┐
│ 30% Congestión                          │
│ 25% Calidad del aire                    │
│ 20% Satisfacción usuario (esperas)      │
│ 15% Eficiencia económica                │
│ 10% Equidad (¿todos se benefician?)    │
└─────────────────────────────────────────┘

Score = sum(métrica * peso)

Ganador: Equipo con score más alto
Bonus: Mejor documentación, mejor código, innovación
```

---

## ❓ FAQ de Profesores

**P: ¿Cuánto tiempo necesito para preparar?**
R: 2-3 horas. Lee todos los archivos MD y mira el código existente.

**P: ¿Necesito entender la simulación completa?**
R: No. Los controllers te abstraen la complejidad. Solo necesitas entender "qué datos hay" y "qué acciones se pueden hacer".

**P: ¿Qué pasa si un alumno hace cambios malos?**
R: ¡Perfecto! Eso es aprendizaje. El sim está en memoria. Todos los cambios son reversibles.

**P: ¿Puedo usar esto en un curso online?**
R: Sí. El servidor está en la nube. Solo necesitan curl o Postman.

**P: ¿Qué calificación le doy?**
R: Usa la rúbrica de "Niveles" (Básico = 5, Intermedio = 7, Avanzado = 10).

**P: ¿Puedo añadir mis propios retos?**
R: Claro. Mira "Desafíos Especiales" en AI_LEARNING_ROADMAP.md.

---

## 🔧 Verificar Setup

```bash
# 1. Verificar que simulación corre
curl http://localhost:3000/api/metrics
# Debería devolver JSON con métricas actuales

# 2. Verificar que hay señales
curl http://localhost:3000/api/traffic/signals/[id]
# Debería devolver datos de un semáforo

# 3. Verificar que hay buses
curl http://localhost:3000/api/buses/lines/L3
# Debería devolver datos de la línea L3
```

Si alguno falla, revisa:
- ¿Servidor ejecutándose? (`npm run serve`)
- ¿Puerto 3000? (`netstat -an | grep 3000`)
- ¿Controllers integrados en `server/app.js`?

---

## 📞 Soporte

Todos los archivos están en la rama `feature-api`:

```bash
git log --oneline | head -10
# Ver los commits que se crearon
```

Para dudas técnicas:
1. Revisa IMPLEMENTATION_PLAN.md
2. Busca "TODO:" en los controllers
3. Ve EXAMPLES.md para referencia

---

## 🎉 Conclusión

Tienes un **entorno pedagógico completo** para enseñar IA aplicada a problemas reales.

Los alumnos:
- Aprenden Python/JavaScript en contexto real
- Entienden trade-offs complejos
- Ven impacto de su código
- Compiten amistosamente
- Se sienten orgull@s@s de "gestionar una ciudad"

¡Que disfruten! 🏙️✨

---

## 📋 Checklist para Profesores

- [ ] Leer MANAGEMENT_OPTIONS.md completo
- [ ] Entender estructura en IMPLEMENTATION_PLAN.md
- [ ] Ver ejemplos en EXAMPLES.md
- [ ] Revisar AI_LEARNING_ROADMAP.md
- [ ] Verificar API_SETUP.md
- [ ] Probar endpoints con curl
- [ ] Preparar primeras diapositivas
- [ ] Configurar grupos de alumnos
- [ ] Explicar calificación

¡Listo para empezar! 🚀
