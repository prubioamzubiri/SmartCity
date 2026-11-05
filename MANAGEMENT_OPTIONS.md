# Opciones de Gestión de SmartCity - Para Alumnos de IA

## Descripción General
Este documento define todas las opciones de gestión que los alumnos pueden implementar en su IA para optimizar la ciudad. Cada opción incluye:
- **Impacto esperado**: Cómo mejora la ciudad
- **Datos de entrada**: Qué información necesita el IA
- **Acciones**: Qué puede hacer la IA
- **Métricas de éxito**: Cómo medir si la decisión fue correcta

---

## 1. GESTIÓN DE TRÁFICO VEHICULAR

### 1.1 Control de Acceso a Calles (Street Closures)
**Objetivo**: Cerrar calles o restringir el paso de ciertos vehículos para mejorar flujo o proteger zonas.

**Acciones disponibles**:
- ✅ Cerrar calle completamente (nadie puede pasar)
- ✅ Permitir solo autobuses y peatones
- ✅ Permitir solo peatones (zona peatonal)
- ✅ Permitir solo autobuses (carril bus)
- ✅ Permitir solo residentes (con histórico de movimiento)
- ✅ Reapertura de calles

**Datos de entrada (sensores)**.
- Densidad de tráfico actual en la calle
- Número de coches que intentan pasar
- Tipo de vehículos
- Flujo de peatones en la zona
- Horario y día de la semana
- Alternativas de ruta disponibles

**Métricas de evaluación**:
- Tiempo promedio de espera de vehículos
- Fluidez de tráfico en calles adyacentes
- Congestión de la zona (antes/después)
- Contaminación potencial
- Acceso a servicios (hospitales, bomberos)

**Caso de uso pedagógico**: 
Los alumnos pueden aprender sobre optimización de redes y toma de decisiones bajo restricciones.

---

### 1.2 Control Adaptativo de Semáforos
**Objetivo**: Ajustar tiempos de semáforo en función del tráfico real.

**Acciones disponibles**:
- ✅ Cambiar duración de luz verde (segundos)
- ✅ Cambiar duración de luz ámbar (segundos)
- ✅ Aplicar planes de semáforo (morning rush, evening rush, night)
- ✅ Activar prioridad para emergencias (ambulancias, bomberos)
- ✅ Sincronizar semáforos en una avenida (onda verde)
- ✅ Crear horarios específicos (ej: lunes a viernes 7-9am)
- ✅ Cambiar el plan global de sincronización

**Datos de entrada**:
- Densidad de tráfico en cada aproximación (N-S vs E-O)
- Número de coches esperando en cada dirección
- Tiempo promedio de cruce
- Presencia de vehículos de emergencia
- Hora del día, día de la semana

**Métricas de evaluación**:
- Tiempo de espera promedio por vehículo
- Número de paradas por vehículo
- Flujo de tráfico (vehículos/minuto)
- Cumplimiento de tiempos de tránsito en rutas
- Eficiencia energética

---

### 1.3 Restricción de Acceso a Vehículos Nuevos
**Objetivo**: Limitar la entrada de vehículos nuevos en zonas congestionadas.

**Acciones disponibles**:
- ✅ Prohibir vehículos > 5 años (o restricción similar)
- ✅ Prohibir vehículos con cierto nivel de emisiones
- ✅ Aplicar restricción por matrículas impares/pares
- ✅ Requerir permisos especiales para acceder
- ✅ Crear zonas de emisiones controladas (LEZ - Low Emission Zone)
- ✅ Dar incentivos a vehículos limpios (acceso preferente)

**Datos de entrada**:
- Tipo y año del vehículo
- Nivel de emisiones estimado
- Congestión de la zona
- Calidad del aire
- Alternativas de transporte disponibles

**Métricas de evaluación**:
- Contaminación del aire en zonas controladas
- Reducción de congestión
- Impacto en tiempo de viaje
- Equidad (¿quién es afectado más?)
- Cumplimiento normativo

---

## 2. GESTIÓN DE TRANSPORTE PÚBLICO (BUSES)

### 2.1 Ajuste Dinámico de Líneas de Autobús
**Objetivo**: Agregar o remover buses de líneas específicas según demanda.

**Acciones disponibles**:
- ✅ Agregar buses a una línea (aumenta capacidad)
- ✅ Remover buses de línea (reduce costos)
- ✅ Cambiar frecuencia de paso (cada 5 min vs cada 15 min)
- ✅ Crear líneas nuevas en función de patrones de demanda
- ✅ Modificar horarios (peak vs off-peak)
- ✅ Establecer paradas adicionales en una línea
- ✅ Cambiar trazado de línea (si hay congestión)

**Datos de entrada**:
- Ocupación promedio de cada línea
- Número de personas esperando en paradas
- Demanda por hora
- Ingresos/costos de operación
- Congestión en la ruta
- Patrones de origen-destino

**Métricas de evaluación**:
- Tiempo de espera en paradas
- Ocupación promedio de buses
- Ingresos totales vs costos operacionales
- Satisfacción del usuario (personas esperando)
- Reducción de viajes en vehículos privados
- Impacto en congestión de calles

---

### 2.2 Control de Prioridad de Buses
**Objetivo**: Facilitar el flujo de autobuses mediante control de semáforos o carriles.

**Acciones disponibles**:
- ✅ Activar fase de semáforo para bus próximo
- ✅ Habilitar carril exclusivo de buses (restringiendo otros vehículos)
- ✅ Cambiar tiempo de semáforo cuando bus se aproxima
- ✅ Crear zona de prioridad frente a congestión
- ✅ Permitir a buses saltarse ciertos límites de velocidad

**Datos de entrada**:
- Ubicación y velocidad de cada bus
- Distancia a siguiente semáforo
- Tráfico actual en esa intersección
- Demanda de capacidad en el bus

**Métricas de evaluación**:
- Puntualidad de buses
- Tiempo de viaje en autobús vs vehículo privado
- Impacto en otros vehículos
- Reducción de congestión general

---

## 3. GESTIÓN DE ESTACIONAMIENTO

### 3.1 Gestión Dinámica de Precios de Parking
**Objetivo**: Ajustar precios para optimizar ocupación y rotación.

**Acciones disponibles**:
- ✅ Cambiar tarifa horaria (€/hora)
- ✅ Aplicar tarifa diferenciada por zona
- ✅ Crear zonas de parking blue (rotación rápida)
- ✅ Cambiar duración máxima permitida
- ✅ Establecer tarifas progresivas (más tiempo = más caro)
- ✅ Crear descuentos para residentes
- ✅ Restricción de estacionamiento en vías
- ✅ Habilitar parkings subterráneos

**Datos de entrada**:
- Ocupación actual de cada parking
- Duración promedio de estancia
- Número de coches buscando parking
- Ingresos actuales
- Demanda por zonas

**Métricas de evaluación**:
- Ocupación target (70-85% es óptimo)
- Rotación de plazas
- Ingresos municipales
- Tiempo gastado buscando parking
- Reducción de tráfico de circulación
- Equidad (¿afecta más a ciertos grupos?)

---

### 3.2 Información en Tiempo Real de Parkings
**Objetivo**: Guiar a conductores hacia parkings disponibles.

**Acciones disponibles**:
- ✅ Mostrar disponibilidad en paneles (número de plazas libres)
- ✅ Dirigir navegadores GPS a parquings disponibles
- ✅ Proporcionar info de precio y distancia
- ✅ Reservar plaza antes de llegar

**Datos de entrada**:
- Ubicación GPS del conductor
- Parkings cercanos y disponibilidad
- Precios actuales
- Tendencias de ocupación

**Métricas de evaluación**:
- Tiempo reducido buscando estacionamiento
- Ocupación más uniforme
- Reducción de tráfico de circulación
- Ingresos potenciados

---

## 4. GESTIÓN DE BICICLETAS COMPARTIDAS

### 4.1 Rebalanceo Dinámico de Estaciones
**Objetivo**: Asegurar que haya bicicletas disponibles y espacios libres en las paradas.

**Acciones disponibles**:
- ✅ Ajustar capacidad de estaciones (hasta 60 docks)
- ✅ Crear estaciones nuevas en zonas con alta demanda
- ✅ Distribuir incentivos para rebalanceo manual (€ o descuentos)
- ✅ Programar vehículos de rebalanceo (enviar bicicletas de A a B)
- ✅ Cambiar horarios de rebalanceo (peak vs off-peak)
- ✅ Incentivar usuarios a dejar bicicletas en zonas vacías

**Datos de entrada**:
- Disponibilidad de bicicletas en cada estación
- Demanda por ubicación y hora
- Patrones de viaje origen-destino
- Costos de rebalanceo
- Capacidad máxima de estaciones

**Métricas de evaluación**:
- Disponibilidad de bicicletas (% de tiempo con bikes)
- Espacios libres para devolver (% de time with docks)
- Tasas de uso del sistema
- Costos de operación
- Satisfacción del usuario
- Rotación de bicicletas

---

## 5. GESTIÓN DE PEATONES

### 5.1 Optimización de Cruces Peatonales
**Objetivo**: Mejorar seguridad y fluidez peatonal.

**Acciones disponibles**:
- ✅ Cambiar duración de fase verde peatonal
- ✅ Crear cruces diagonales (reducir tiempo de espera)
- ✅ Activar botones de cruce (demanda reactive)
- ✅ Crear zonas peatonales (cerrar a vehículos)
- ✅ Agregar islas de seguridad
- ✅ Cambiar velocidad de flujo permitido (segundos para cruzar)

**Datos de entrada**:
- Número de peatones esperando en cruce
- Flujo de tráfico vehicular
- Hora del día
- Eventos próximos (mercado, concierto)

**Métricas de evaluación**:
- Tiempo de espera peatonal
- Seguridad (accidentes)
- Fluidez de tráfico peatonal
- Acceso equitativo a servicios

---

### 5.2 Incentivos y Campañas Peatonales
**Objetivo**: Incentivar el desplazamiento a pie.

**Acciones disponibles**:
- ✅ Crear zonas de comercio preferente para peatones
- ✅ Establecer descuentos en tiendas (gamificación)
- ✅ Mejorar infraestructura peatonal (iluminación, bancos)
- ✅ Crear eventos peatonales (domingos sin coches)

**Datos de entrada**:
- Flujo de peatones por zona
- Acceso a comercios y servicios
- Seguridad percibida
- Condiciones climáticas

**Métricas de evaluación**:
- Aumento en peatones
- Impacto en comercios
- Reducción de vehículos
- Salud pública

---

## 6. GESTIÓN AMBIENTAL Y CONGESTIÓN

### 6.1 Control de Congestión Dinámica (Congestion Pricing)
**Objetivo**: Cobrar tarifa variable por entrar en zonas congestionadas.

**Acciones disponibles**:
- ✅ Establecer zona de tarificación (congestion charge zone)
- ✅ Ajustar tarifa según congestión en tiempo real
- ✅ Crear descuentos para emisiones bajas
- ✅ Permitir residentes/trabajadores sin tarifa
- ✅ Horarios diferenciados (más caro en peak)

**Datos de entrada**:
- Densidad de tráfico en la zona
- Nivel de congestión (puede ser 0-100)
- Emisiones estimadas
- Ingresos generados

**Métricas de evaluación**:
- Reducción de tráfico (% menos vehículos)
- Ingresos municipales
- Mejora de flujo en zona
- Equidad social
- Emisiones reducidas

---

### 6.2 Monitoreo de Calidad del Aire
**Objetivo**: Detectar y responder a episodios de contaminación.

**Acciones disponibles**:
- ✅ Monitorear niveles PM2.5, NO2, CO
- ✅ Activar alertas cuando aire está malo
- ✅ Restringir vehículos contaminantes
- ✅ Cambiar planes de tráfico
- ✅ Incentivar transporte público
- ✅ Recomendar rutas alternativas a usuarios

**Datos de entrada**:
- Niveles de contaminación por zona
- Número de vehículos por tipo (gasolina, diésel, eléctrico)
- Flujo de vehículos
- Condiciones meteorológicas (viento, inversión térmica)

**Métricas de evaluación**:
- Niveles de contaminación reducidos
- Cumplimiento de estándares EU
- Salud pública
- Índice de calidad del aire (AQI)

---

## 7. GESTIÓN ESPECIAL - EVENTOS Y EMERGENCIAS

### 7.1 Gestión de Eventos
**Objetivo**: Preparar ciudad para eventos puntuales (mercados, conciertos, etc).

**Acciones disponibles**:
- ✅ Pre-bloquear estacionamientos
- ✅ Desactivar líneas de buses regulares (redirigir)
- ✅ Crear líneas de buses especiales
- ✅ Cerrar calles específicas
- ✅ Modificar planes de semáforos
- ✅ Aumentar personal en paradas de buses
- ✅ Activar información de eventos en la ciudad

**Datos de entrada**:
- Tipo de evento
- Hora y duración
- Asistentes esperados
- Ubicación

**Métricas de evaluación**:
- Movilidad durante evento
- Satisfacción de asistentes
- Impacto en tráfico circundante
- Seguridad

---

### 7.2 Gestión de Emergencias
**Objetivo**: Facilitar el tránsito de emergencias.

**Acciones disponibles**:
- ✅ Crear corredor de emergencia (vaciar calle)
- ✅ Cambiar semáforos para paso rápido
- ✅ Desviar buses de la ruta
- ✅ Alertar conductores
- ✅ Bloquear intersecciones

**Datos de entrada**:
- Ubicación de ambulancia/bomberos
- Destino del evento de emergencia
- Rutas óptimas

**Métricas de evaluación**:
- Tiempo de respuesta
- Seguridad durante operación
- Impacto en tráfico general

---

## 8. OTRAS OPCIONES - PLANIFICACIÓN A LARGO PLAZO

### 8.1 Planificación de Infraestructura
**Acciones disponibles**:
- ✅ Construir nuevo estacionamiento (subterráneo/superficie)
- ✅ Expandir línea de transporte público
- ✅ Crear zonas peatonales permanentes
- ✅ Construir carriles bici
- ✅ Mejorar infraestructura de buses

**Datos de entrada**:
- Demanda proyectada
- Costos de construcción
- Impacto ambiental

**Métricas de evaluación**:
- ROI a largo plazo
- Impacto en calidad de vida
- Sostenibilidad

---

### 8.2 Análisis de Datos Históricos
**Acciones de análisis disponibles**:
- ✅ Generar reportes de tráfico por hora/día/mes
- ✅ Identificar puntos críticos de congestión
- ✅ Analizar patrones de origen-destino
- ✅ Evaluar eficiencia de líneas de buses
- ✅ Calcular contaminación promedio
- ✅ Medir retorno de inversiones (ROI) de mejoras

---

## DATOS DISPONIBLES - API ENDPOINTS

### Sensores de Tráfico
```
GET /api/traffic/density          # Densidad actual por calle
GET /api/traffic/cars             # Posición de vehículos
GET /api/traffic/signals          # Estado de semáforos
GET /api/traffic/emissions        # Contaminación estimada
```

### Sensores de Peatones
```
GET /api/pedestrians/density      # Densidad peatonal por zona
GET /api/pedestrians/crossings    # Actividad en cruces
```

### Transporte Público
```
GET /api/buses/locations          # Ubicación de buses
GET /api/buses/occupancy          # Ocupación por línea
GET /api/buses/schedule           # Horarios y frecuencias
GET /api/buses/delays             # Retrasadores
```

### Estacionamiento
```
GET /api/parking/availability     # Plazas libres por zona
GET /api/parking/occupancy        # % ocupado
GET /api/parking/search_time      # Tiempo promedio de búsqueda
```

### Bicicletas
```
GET /api/bikes                    # Bicicletas por estación
GET /api/bikes/capacity           # Capacidad de docks
GET /api/bikes/demand             # Demanda por estación
```

### Ambiental
```
GET /api/air-quality/pm25         # Partículas PM2.5
GET /api/air-quality/no2          # Dióxido de nitrógeno
GET /api/air-quality/co           # Monóxido de carbono
```

---

## GUÍA PARA ALUMNOS

### Paso 1: Elegir Objetivo
Selecciona una o varias opciones de gestión que te interesen.

### Paso 2: Recopilar Datos
Identifica qué datos (endpoints API) necesitas para tomar la decisión.

### Paso 3: Desarrollar Lógica
Crea reglas o modelos de IA para:
- Analizar datos
- Detectar problemas
- Proponer soluciones
- Evaluar impacto

### Paso 4: Implementar Cambios
Llama a los endpoints correspondientes para implementar las decisiones.

### Paso 5: Medir Resultados
Compara métricas antes/después.

### Paso 6: Optimizar
Refina el algoritmo basándote en resultados.

---

## DESAFÍOS RECOMENDADOS

### 🔰 Nivel Principiante
1. **Simple Traffic Signal Control**: Cambiar tiempos de semáforo basándose en flujo actual
2. **Parking Price Optimization**: Ajustar precios para mantener ocupación al 80%
3. **Bus Line Capacity**: Agregar/remover buses según ocupación

### 🔶 Nivel Intermedio
1. **Multi-Intersection Traffic Optimization**: Coordinar varios semáforos
2. **Congestion Pricing**: Tarificar zonas congestionadas
3. **Complete Transit System**: Optimizar buses + estacionamiento + tráfico
4. **Air Quality Management**: Restringir vehículos basado en contaminación

### 🔴 Nivel Avanzado
1. **City-Wide Optimization**: Balancear tráfico, transporte, estacionamiento, aire
2. **Predictive Analytics**: Predecir congestión 1 hora adelante
3. **Reinforcement Learning**: IA que aprende qué decisiones funcionan
4. **Multi-Objective Optimization**: Equilibrar congestión, contaminación, equidad social

---

## NOTAS IMPORTANTES

1. **Realismo**: Los datos son simulados pero basados en patrones reales de Donostia
2. **Limitaciones**: Algunos cambios tardan tiempo en implementarse (capacidad de estación = 30 días simul.)
3. **Efectos secundarios**: Una acción puede mejorar una métrica pero empeorar otra
4. **Equidad**: Considera impactos sociales (¿quién se beneficia? ¿quién sale perjudicado?)
5. **Sostenibilidad**: El objetivo final es una ciudad más limpia, segura y accesible

