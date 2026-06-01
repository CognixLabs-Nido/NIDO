# Comparativa funcional: Tyra, Schooltivity, Mia Plus y NIDO

> Documento de referencia con la propuesta de NIDO y la ola de implementación de cada función.
> **Modelo de olas (scope-driven, sin deadline externo — el responsable controla las fechas):**
> 1️⃣ **Ola 1 — producto web completo y desplegable** · 2️⃣ **Ola 2 — app nativa (iOS+Android)** · 3️⃣ **Ola 3 — mejoras y diferenciación**
> ⛔ = no entra en plan · ⭐ = diferencial propio (ninguna competencia lo tiene)

---

## Resumen del alcance

### Ola 1 — Producto web completo y desplegable

La app web cubre todo el ciclo de un centro y opera en producción con datos reales. Incluye:

- Núcleo: agenda diaria, comunicación (mensajería + anuncios), asistencia/ausencias, ficha del niño, calendario + eventos, autorizaciones, informes de evolución, fotos.
- Diferenciales 0-3: **B** (tracking lactancia/biberón), **D** (check-in/check-out bidireccional), **E** (recordatorios bidireccionales).
- **Promovidos a Ola 1** (antes en olas posteriores): **F** medicación con doble confirmación, **7** onboarding guiado para no-tech, **PIN de acceso para tablets compartidas**.
- **Bloqueantes transversales**:
  - **Push-a-device** — riesgo #1, item temprano y bloqueante (antes/junto a F7).
  - **Paquete RGPD** — bloqueante antes de cargar el primer dato real: olvido funcional + consentimiento de imagen de menores + registro de tratamiento (+ DPA).
- **Offline**: solo **tolerancia básica PWA** (F11). El offline-first real es Ola 2.

### Ola 2 — App nativa (iOS + Android)

Reusa `packages/core` y el backend Supabase. Aporta lo que solo tiene sentido en nativo:

- Empaquetado nativo iOS + Android.
- **Offline-first real** para profes (sincronización, no solo tolerancia).
- Push nativo (APNs/FCM) además del web push.

### Ola 3 — Mejoras y diferenciación

Sobre una base ya consolidada con datos reales:

- Diferenciales: **A** (hitos de desarrollo), **4** (libro del año), **2** (rutinas visuales de aula), **C** (período de adaptación reforzado), **5** (acceso granular abuelos/cuidadores), **6** (IA aplicada).
- Mejoras de productividad: mensajes predefinidos, mensajería interna entre staff, rellenado en grupo, actividades predefinidas, cambio de horario por familia, **reserva de franjas para tutorías**, plantillas/comentarios reutilizables en informes, etiquetas, modo "no molestar", histórico de cursos pasados.

### Fuera del plan

Pictogramas NEE, facturación/Veri\*factu/modelo 233, fichaje digital del personal, gestión de cocina, cuños virtuales, **menú en PDF/imagen** (descartado: redundante con los menús estructurados de F4.5b).

---

## Tabla comparativa por categoría

Leyenda: ✅ tiene | ⚪ no se menciona | 💡 destacado | 1️⃣2️⃣3️⃣ ola | ⛔ no entra | ⭐ diferencial NIDO

### Comunicación familias-centro

| Función                              | Tyra | Schooltivity | Mia Plus | NIDO |
| ------------------------------------ | ---- | ------------ | -------- | ---- |
| Mensajería instantánea profe-familia | ✅   | ✅           | ✅       | 1️⃣   |
| Circulares / Noticias                | ✅   | ✅           | ✅       | 1️⃣   |
| Push notifications                   | ✅   | ✅           | ✅       | 1️⃣   |
| Recepción de archivos desde familias | ⚪   | ⚪           | ✅       | 1️⃣   |
| Audios y enlaces en mensajes         | ⚪   | ⚪           | ✅       | 1️⃣   |
| Calendario separado familias/staff   | ✅   | ⚪           | ⚪       | 1️⃣   |
| Mensajes predefinidos / frecuentes   | ⚪   | ⚪           | 💡       | 3️⃣   |
| Mensajería interna entre staff       | ⚪   | ⚪           | ✅       | 3️⃣   |
| Programación de envíos a futuro      | ⚪   | ⚪           | 💡       | 3️⃣   |
| Encuestas a familias                 | ⚪   | ⚪           | ✅       | 3️⃣   |

### Agenda diaria del niño (bienestar)

| Función                                                                                | Tyra | Schooltivity | Mia Plus | NIDO                 |
| -------------------------------------------------------------------------------------- | ---- | ------------ | -------- | -------------------- |
| Comidas / biberón (general)                                                            | ✅   | ✅           | ✅       | 1️⃣                   |
| Sueño / siestas                                                                        | ✅   | ✅           | ✅       | 1️⃣                   |
| Deposiciones / control esfínteres                                                      | ✅   | ✅           | ✅       | 1️⃣                   |
| Estado de ánimo                                                                        | ⚪   | ✅           | ⚪       | 1️⃣ (en check-in/out) |
| Estadísticas de hábitos                                                                | ✅   | ✅           | ✅       | 1️⃣                   |
| **B. Tracking detallado lactancia/biberón** (cantidad ml, tipo LM/fórmula, gráfica)    | ⚪   | ⚪           | ⚪       | 1️⃣ ⭐                |
| **D. Check-in/check-out bidireccional** (familia y profe registran cómo llega y se va) | ⚪   | ⚪           | ⚪       | 1️⃣ ⭐                |
| Rellenado individual o en grupo                                                        | ⚪   | ⚪           | 💡       | 3️⃣                   |
| Actividades realizadas predefinidas                                                    | ⚪   | ⚪           | 💡       | 3️⃣                   |
| **A. Hitos de desarrollo (milestones)** (primera sonrisa, primer diente, primer paso…) | ⚪   | ⚪           | ⚪       | 3️⃣ ⭐                |

### Contenido pedagógico

| Función                                      | Tyra | Schooltivity | Mia Plus | NIDO                           |
| -------------------------------------------- | ---- | ------------ | -------- | ------------------------------ |
| Blog del aula (publicar al aula)             | ✅   | ⚪           | ⚪       | 1️⃣                             |
| Fotos y vídeos ilimitados                    | ✅   | ✅           | ✅       | 1️⃣                             |
| Álbum / portafolio individual del niño       | ✅   | ⚪           | ⚪       | 3️⃣ (lo cubre el libro del año) |
| Repositorio recursos/actividades para profes | ⚪   | ✅           | ✅       | ⛔                             |
| Cuños virtuales / logros                     | ⚪   | ✅           | ⚪       | ⛔                             |

### Asistencia y fichaje

| Función                                | Tyra | Schooltivity | Mia Plus | NIDO         |
| -------------------------------------- | ---- | ------------ | -------- | ------------ |
| Registro entrada/salida alumno         | ✅   | ✅           | ✅       | 1️⃣           |
| Notificación a familias entrada/salida | ⚪   | ✅           | ⚪       | 1️⃣           |
| Reporte de ausencias por familia       | ✅   | ✅           | ✅       | 1️⃣           |
| Cambio de horario por familia          | ✅   | ⚪           | ⚪       | 3️⃣           |
| Fichaje digital del personal (legal)   | ✅   | 💡           | 💡       | ⛔ (delegar) |
| Informes de jornada laboral            | ✅   | ✅           | ✅       | ⛔           |

### Calendario, eventos y tutorías

| Función                                 | Tyra | Schooltivity | Mia Plus | NIDO |
| --------------------------------------- | ---- | ------------ | -------- | ---- |
| Calendario escolar (festivos, eventos)  | ✅   | ✅           | ✅       | 1️⃣   |
| Eventos con confirmación de asistencia  | ✅   | ✅           | ✅       | 1️⃣   |
| Reserva de franjas para tutorías        | ✅   | ⚪           | 💡       | 3️⃣   |
| Calendario reutilizable curso siguiente | ⚪   | ⚪           | 💡       | 3️⃣   |

### Documentación y autorizaciones

| Función                                        | Tyra | Schooltivity | Mia Plus | NIDO |
| ---------------------------------------------- | ---- | ------------ | -------- | ---- |
| Gestión de documentos categorizados            | 💡   | ✅           | ✅       | 1️⃣   |
| Autorizaciones (excursiones, fotos, médicas)   | ✅   | ✅           | ✅       | 1️⃣   |
| Firma digital de documentos (familia con dedo) | 💡   | ⚪           | 💡       | 1️⃣   |

### Ficha del niño

| Función                                                    | Tyra | Schooltivity | Mia Plus | NIDO  |
| ---------------------------------------------------------- | ---- | ------------ | -------- | ----- |
| Datos de contacto de familias                              | ✅   | ✅           | ✅       | 1️⃣    |
| Alergias e información médica                              | ✅   | ✅           | ✅       | 1️⃣    |
| Horarios y ausencias                                       | ✅   | ✅           | ✅       | 1️⃣    |
| Auto-actualización de contactos por familia                | 💡   | ⚪           | ⚪       | 1️⃣    |
| Auto-registro de familias por invitación email             | ⚪   | ⚪           | 💡       | 1️⃣    |
| Histórico de cursos pasados (alumnos antiguos)             | ⚪   | 💡           | ⚪       | 3️⃣    |
| **5. Acceso granular abuelos/cuidadores** (permisos finos) | ⚪   | ⚪           | ⚪       | 3️⃣ ⭐ |

### Comedor

| Función                                     | Tyra | Schooltivity | Mia Plus | NIDO                                  |
| ------------------------------------------- | ---- | ------------ | -------- | ------------------------------------- |
| Gestión menús diarios estructurados (F4.5b) | ⚪   | ✅           | ✅       | 1️⃣                                    |
| Subir menú mensual (PDF/imagen)             | ⚪   | ✅           | ✅       | ⛔ (descartado, redundante con F4.5b) |
| Informe diario para cocina                  | ⚪   | 💡           | ⚪       | ⛔                                    |
| Estadísticas de comensales                  | ⚪   | ✅           | ⚪       | ⛔                                    |

### Informes de evolución / evaluaciones

| Función                               | Tyra | Schooltivity | Mia Plus | NIDO |
| ------------------------------------- | ---- | ------------ | -------- | ---- |
| Plantillas de informe personalizables | ⚪   | ✅           | ✅       | 1️⃣   |
| Por áreas/objetivos                   | ⚪   | ✅           | ✅       | 1️⃣   |
| Plantillas reutilizables entre cursos | ⚪   | ⚪           | 💡       | 3️⃣   |
| Evaluar individual o varios a la vez  | ⚪   | ⚪           | 💡       | 3️⃣   |
| Comentarios frecuentes guardados      | ⚪   | ⚪           | 💡       | 3️⃣   |

### Administración / facturación

| Función                         | Tyra | Schooltivity | Mia Plus | NIDO |
| ------------------------------- | ---- | ------------ | -------- | ---- |
| Recibos y facturas              | ⚪   | ✅           | ✅       | ⛔   |
| Veri\*factu (cumplimiento 2026) | ⚪   | 💡           | 💡       | ⛔   |
| Modelo 233 Hacienda             | ⚪   | ✅           | ✅       | ⛔   |
| Remesas SEPA (XML)              | ⚪   | ✅           | 💡       | ⛔   |
| Cobros y control                | ⚪   | ✅           | 💡       | ⛔   |
| Gestión extraescolares (cobro)  | ⚪   | ✅           | ⚪       | ⛔   |

### Funciones de IA

| Función                               | Tyra | Schooltivity | Mia Plus | NIDO |
| ------------------------------------- | ---- | ------------ | -------- | ---- |
| Redacción inteligente de mensajes     | ⚪   | ⚪           | 💡       | 3️⃣   |
| Traducción multilingüe (100+ idiomas) | ⚪   | ⚪           | 💡       | 3️⃣   |
| Rellenado IA de agendas               | ⚪   | ⚪           | 💡       | 3️⃣   |
| Resumen IA del día/semana             | ⚪   | ⚪           | 💡       | 3️⃣   |
| Sugerencias de respuesta              | ⚪   | ⚪           | 💡       | 3️⃣   |
| Búsqueda inteligente fotos/circulares | ⚪   | ⚪           | 💡       | 3️⃣   |
| Aviso ante olvidos (asistido por IA)  | ⚪   | ⚪           | 💡       | 3️⃣   |
| Dictado voz a texto                   | ⚪   | ⚪           | 💡       | 3️⃣   |
| Alerta de mensaje problemático        | ⚪   | ⚪           | 💡       | ⛔   |

### Administración del sistema

| Función                                  | Tyra | Schooltivity | Mia Plus | NIDO |
| ---------------------------------------- | ---- | ------------ | -------- | ---- |
| Panel admin (dirección)                  | ✅   | ✅           | ✅       | 1️⃣   |
| Gestión de usuarios y roles              | ✅   | ✅           | ✅       | 1️⃣   |
| Gestión de aulas/grupos                  | ✅   | ✅           | ✅       | 1️⃣   |
| PIN login para tablets compartidas       | 💡   | ⚪           | ⚪       | 1️⃣   |
| Etiquetas para clasificar                | 💡   | ⚪           | ⚪       | 3️⃣   |
| Modo "no molestar" / desconexión digital | ⚪   | ⚪           | 💡       | 3️⃣   |

### Recordatorios y avisos

| Función                                                                        | Tyra | Schooltivity | Mia Plus | NIDO            |
| ------------------------------------------------------------------------------ | ---- | ------------ | -------- | --------------- |
| Caja del perfil con avisos automáticos (pañales, ropa)                         | 💡   | ⚪           | ⚪       | 1️⃣ (parte de E) |
| **E. Recordatorios bidireccionales** (cole↔familia, recurrencia, marcar hecho) | ⚪   | ⚪           | ⚪       | 1️⃣ ⭐           |

### Plataforma / dispositivos

| Función                               | Tyra | Schooltivity | Mia Plus | NIDO     |
| ------------------------------------- | ---- | ------------ | -------- | -------- |
| App web (PWA instalable)              | 💡   | 💡           | 💡       | 1️⃣       |
| Tolerancia básica offline (PWA)       | ⚪   | ⚪           | ⚪       | 1️⃣ (F11) |
| App nativa iOS + Android              | ✅   | ✅           | ✅       | 2️⃣       |
| **3. Offline-first real para profes** | ⚪   | ⚪           | ⚪       | 2️⃣ ⭐    |
| Push nativo (APNs/FCM)                | ✅   | ✅           | ✅       | 2️⃣       |

### Medicación

| Función                                  | Tyra | Schooltivity | Mia Plus | NIDO |
| ---------------------------------------- | ---- | ------------ | -------- | ---- |
| **F. Medicación con doble confirmación** | ⚪   | ⚪           | parcial  | 1️⃣   |

### Onboarding

| Función                                   | Tyra | Schooltivity | Mia Plus | NIDO |
| ----------------------------------------- | ---- | ------------ | -------- | ---- |
| **7. Onboarding muy guiado para no-tech** | ⚪   | ⚪           | ⚪       | 1️⃣   |

### Diferenciales 0-3 (no cubiertos por ninguna competencia)

| Función                                       | Tyra | Schooltivity | Mia Plus | NIDO |
| --------------------------------------------- | ---- | ------------ | -------- | ---- |
| ⭐ B. Tracking detallado lactancia/biberón    | ⚪   | ⚪           | ⚪       | 1️⃣   |
| ⭐ D. Check-in/check-out bidireccional        | ⚪   | ⚪           | ⚪       | 1️⃣   |
| ⭐ E. Recordatorios bidireccionales completos | ⚪   | ⚪           | ⚪       | 1️⃣   |
| F. Medicación con doble confirmación          | ⚪   | ⚪           | parcial  | 1️⃣   |
| 7. Onboarding muy guiado para no-tech         | ⚪   | ⚪           | ⚪       | 1️⃣   |
| ⭐ 3. Offline-first real para profes          | ⚪   | ⚪           | ⚪       | 2️⃣   |
| ⭐ 5. Acceso granular abuelos/cuidadores      | ⚪   | ⚪           | ⚪       | 3️⃣   |
| ⭐ A. Hitos de desarrollo (milestones)        | ⚪   | ⚪           | ⚪       | 3️⃣   |
| ⭐ 4. Libro del año del niño exportable       | ⚪   | ⚪           | ⚪       | 3️⃣   |
| 2. Rutinas visuales para el aula              | ⚪   | ⚪           | ⚪       | 3️⃣   |
| ⭐ C. Período de adaptación reforzado         | ⚪   | ⚪           | ⚪       | 3️⃣   |
| 6. Integración IA aplicada                    | ⚪   | ⚪           | ✅       | 3️⃣   |

---

## Posicionamiento de NIDO frente a las otras tres

**Lo que se hace igual de bien**: comunicación, agenda diaria básica, calendario, fotos, autorizaciones, informes. Necesario para no quedar por debajo del estándar del mercado.

**Lo que se hace mejor que ellos** (diferenciales con ⭐):

- **Mucho más detalle en lactancia/biberón** que ningún otro (B): pensado de verdad para 0-12 meses.
- **Check-in/check-out bidireccional** estructurado (D): ningún otro lo trata como un primer ciudadano.
- **Recordatorios bidireccionales completos** (E): unifica lo que Tyra ofrece a medias en su "caja del perfil".
- **Offline-first real** (3): se aborda en serio en la app nativa (Ola 2), no como parche.
- **Permisos granulares para abuelos/cuidadores** (5): nadie lo hace bien hoy.
- **Hitos de desarrollo + Libro del año** (A + 4): convierte la agenda en recuerdo emocional, no solo en herramienta de gestión.
- **Período de adaptación reforzado** (C): aborda el momento más sensible del curso.

**Lo que NO se hace (y está bien que no)**: facturación, Veri\*factu, fichaje legal del personal, gestión de cocina, repositorio pedagógico, menú en PDF. Estos los cubren mejor herramientas especializadas o no son críticos para el cole.

---

> **Nota histórica.** Las "7 dudas bloqueantes" de arranque del proyecto (tipo de centro, aulas, profes por aula, modelo de familia, datos médicos, idiomas, consentimiento de imagen) ya se resolvieron al iniciar la implementación y quedaron reflejadas en `CLAUDE.md`, `docs/architecture/data-model.md` y las specs de cada fase. Se eliminan de este documento por estar obsoletas.
