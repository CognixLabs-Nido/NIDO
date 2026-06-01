---
feature: F7a — Calendario escolar + Agenda (separación de dos dominios)
status: draft
checkpoint: A (spec, sin implementar)
fase: 7 (re-encuadre)
autores: responsable + claude-code
fecha: 2026-06-02
related_specs:
  [scope-ola-1, f7-calendario, school-calendar, messaging, push-notifications, reminders-c]
related_adrs: [ADR-0038, ADR-0019, ADR-0029, ADR-0037]
supersedes_partial: f7-calendario.md (reparte su alcance en dos dominios)
---

# F7a — Calendario escolar + Agenda

> **Checkpoint A. Documento de diseño, NO implementación.** Define el reparto en
> dos dominios y deja las decisiones de modelo de datos **abiertas** para
> cerrarlas antes del Checkpoint B. PARA aquí.

## 0. Por qué este re-encuadre

F7 (PR #49, "Calendario y eventos") metió en **una sola tabla `eventos`** dos
productos con semántica distinta:

- **Difusión** (un centro/aula anuncia algo a su audiencia; opcionalmente pide
  confirmación de asistencia): excursión, fiesta, vacaciones…
- **Invitación** (un organizador convoca a personas concretas y espera un RSVP
  individual; tipo Outlook/Google Calendar): reunión con padres, reunión de
  claustro, visita comercial, cita de nueva matrícula…

Mezclarlas obliga a un modelo de "audiencia" que no encaja en el caso invitación
(no hay "invitados" como entidad, ni RSVP por persona, ni "lo que yo organizo vs
lo que me invitan", ni vistas día/semana). Esta spec **separa**:

- **Dominio A — Calendario escolar** (difusión). Reusa el backend de `eventos` de
  F7 como base.
- **Dominio B — Agenda** (invitación). Modelo nuevo de invitaciones + RSVP.
- **Dominio C — Inicio** (resumen "hoy" del usuario: su Agenda de hoy + el
  Calendario escolar de su ámbito hoy).

> **Premisa:** se asume que **F7 (#49) se mergeará** como base del Calendario
> escolar. Esta spec parte de ese estado.

---

## 1. Auditoría del estado actual (qué hay HOY, qué se reutiliza)

### 1.1 `/calendario` hoy: **dos calendarios apilados**

En `src/app/[locale]/{admin,teacher,family}/calendario/page.tsx` conviven **dos
capas distintas** sobre el mismo grid mensual:

1. **Calendario laboral del centro (F4.5a)** — tabla `dias_centro`, ENUM
   `tipo_dia_centro` (7 valores: `lectivo`, `festivo`, `vacaciones`,
   `escuela_verano`, `escuela_navidad`, `jornada_reducida`, `cerrado`).
   - **Qué es:** la estructura laboral del centro — qué días abre/cierra y de qué
     tipo es cada día. **Tiene efectos de negocio**: cierra la agenda y la
     asistencia (vía helpers `tipo_de_dia`/`centro_abierto`), no es solo visual.
   - Admin lo **edita** con `CalendarioCentroEditor`; profe/familia lo ven en
     **solo lectura** (la `LeyendaTiposDia` + coloreado de celdas). Sin ventana de
     edición (admin edita cualquier fecha; ADR-0019).
   - Coloreado client-side: `tipoResuelto(fecha, overrides)` = override de
     `dias_centro` o default ISODOW. Query `getCalendarioMes`.

2. **Overlay de eventos (F7, #49)** — tabla `eventos` + `confirmaciones_evento`,
   ENUMs `ambito_evento`/`tipo_evento`/`evento_estado`/`confirmacion_estado`
   (ADR-0038). Chips de eventos sobre las celdas; click → detalle + confirmación.
   `CalendarioConEventos`, query `getEventosMes`.

**Resumen:** "los dos calendarios" = (1) **calendario laboral** `dias_centro`
(qué días abre el centro) y (2) **eventos** `eventos` (qué pasa esos días). El
primero es estructura; el segundo, contenido sobre esa estructura.

### 1.2 `CalendarioMensual` (componente compartido) — **reutilizable y agnóstico**

`src/shared/components/calendario/CalendarioMensual.tsx` es un **grid mensual
genérico** que no sabe de dominios. API (`shared/components/calendario/types.ts`):

| Prop                             | Para qué                                 |
| -------------------------------- | ---------------------------------------- |
| `mes`, `anio`                    | Mes mostrado                             |
| `renderDia(fecha, dentroDelMes)` | El padre decide qué pinta cada celda     |
| `onClickDia(fecha)`              | Click simple en un día                   |
| `onSeleccionRango(desde, hasta)` | Shift+click → rango                      |
| `onCambioMes(mes, anio)`         | Navegación ← →                           |
| `diaActivo`, `rangoSeleccionado` | Resaltados                               |
| `locale`, `ariaLabel`, `labels`  | i18n + a11y (grid accesible por teclado) |

Hoy lo reúsan **F4.5a** (`CalendarioCentroEditor`/`…ReadOnly`), **F4.5b**
(`EditorMenuMensual`) y **F7** (`CalendarioConEventos`). **Es la pieza a reutilizar
para la vista MES** tanto del Calendario escolar como de la Agenda. **No sirve**
para las vistas día/semana de la Agenda (no es una rejilla horaria) → ver D-B6.

### 1.3 Dónde se muestran los menús (F4.5b) — **para no duplicar**

- **Admin** los edita en `/admin/menus` (lista de plantillas) y
  `/admin/menus/[id]` (`EditorMenuMensual` sobre `CalendarioMensual`).
- **Familia** ve el menú del día con `MenuDelDiaWidget` **dentro de**
  `/family/nino/[id]` (ficha del niño) — **no** hay ruta de menú propia.
- **Profe** ve el menú del día integrado en el pase de lista de comida
  (`/teacher/aula/[id]/comida`).
- Tablas `plantillas_menu_mensual` + `menu_dia` (F4.5b). **No se tocan aquí**; se
  citan para no reinventar un "calendario de menús".

### 1.4 Inicio / dashboards hoy (qué muestra cada rol)

- `/admin` (`admin/page.tsx`): saludo + stats del centro + asistencia de hoy por
  aula.
- `/teacher` (`teacher/page.tsx`): "Mis aulas" + `ProximosDiasCerradosWidget`.
- `/family` (`family/page.tsx`): "Mis niños" + `ProximosDiasCerradosWidget`.

**Ninguno muestra "tu agenda de hoy"** (reuniones/visitas/eventos del día). Ese es
el hueco que cubre el **Dominio C**.

### 1.5 Qué se reutiliza vs qué es nuevo (vista de pájaro)

| Pieza                                                     | Calendario escolar (A)            | Agenda (B)           | Inicio (C) |
| --------------------------------------------------------- | --------------------------------- | -------------------- | ---------- |
| `CalendarioMensual` (grid mes)                            | ✅ reusa                          | ✅ reusa (vista Mes) | —          |
| `dias_centro` + `tipo_de_dia` (F4.5a)                     | ✅ base (festivos/vacaciones)     | —                    | ✅ lee     |
| `eventos`/`confirmaciones_evento` (F7)                    | ✅ base (excursión/fiesta/evento) | ❌ no aplica         | ✅ lee     |
| Audiencia push F6-C (`expandirDestinatariosRecordatorio`) | ✅ reusa                          | ⚠️ parcial (D-B2)    | —          |
| `enviarPushANotificarUsuarios` (F5.5)                     | ✅ reusa                          | ✅ reusa             | —          |
| Modelo de **invitaciones + RSVP**                         | ❌ no existe                      | 🆕 **nuevo**         | ✅ lee     |
| Vista **día/semana** (rejilla horaria)                    | ❌                                | 🆕 **nuevo**         | —          |
| Preferencia de vista por usuario                          | —                                 | 🆕 **nuevo**         | —          |

---

## 2. Dominio A — Calendario escolar (difusión)

**Naturaleza:** un centro/aula/niño publica algo que su audiencia debe conocer;
**no** hay invitados ni RSVP individual. Donde aplica, pide **confirmación de
asistencia** (la de F7, "asistencia ligera", NO autorización legal — eso es F8).

### 2.1 Contenido

Excursiones, fiestas, vacaciones, festivos y "eventos" varios, **por ámbito**
centro / aula / niño (reusa `ambito_evento` de F7).

**Cambios respecto a F7:**

- **Quitar `reunion`** del ENUM `tipo_evento`: las reuniones son **invitación** →
  se van a la **Agenda (B)**. (Ver D-A1: cómo retirar el valor del ENUM.)
- **Festivos/vacaciones:** ya existen como `dias_centro` (F4.5a) y **cierran el
  centro**. Hay solape con "añade festivos" → **decisión abierta D-A2** (no
  duplicar). Recomendación: el festivo/vacación **sigue siendo `dias_centro`**, y
  el Calendario escolar **fusiona ambas capas** en la vista (coloreado
  `dias_centro` + chips de `eventos`), en vez de crear un `tipo_evento='festivo'`
  redundante.
- **Confirmación según tipo:** excursión → **sí** puede pedir confirmación; fiesta
  → opcional; festivo/vacación → **no** (no se "confirma asistencia" a un cierre).
  Se mantiene el flag `requiere_confirmacion` por evento (ya existe en F7).

### 2.2 Reuso

Backend de `eventos` de F7 **tal cual** (tablas, RLS row-aware, audiencia push
F6-C, cancelación por estado, confirmación por niño D2). El Calendario escolar es,
en esencia, **F7 menos `reunion`, más la fusión visual con `dias_centro`**.

### 2.3 Vistas y rutas (A)

- Sigue siendo **overlay sobre `/calendario`** (D10 de F7), vista **mes**, con
  `CalendarioMensual`. Admin edita `dias_centro` + crea eventos; profe/familia
  ven según RLS. **Sin** vista día/semana (eso es Agenda).

---

## 3. Dominio B — Agenda (invitación, tipo Outlook)

**Naturaleza:** un **organizador** crea una cita y **invita** a personas o grupos;
cada invitado responde con **RSVP** (aceptar/rechazar). Cada usuario ve **lo que
organiza + aquello a lo que le invitan**. **No** es difusión: el destinatario es
una lista nominal de invitados, no "toda la audiencia de un ámbito".

### 3.1 Tipos de cita

- **Reuniones:** con padres (tutor↔staff), de claustro (profes/admin).
- **Visitas:** comerciales, citas de nueva matrícula (posible invitado **externo
  sin cuenta** → D-B3), etc.

### 3.2 Matriz de invitación (quién invita a quién)

| Organizador | Puede invitar a…                                                                          |
| ----------- | ----------------------------------------------------------------------------------------- |
| **admin**   | un profe · todos los profes · un padre (tutor/autorizado) · todos los padres de una clase |
| **profe**   | un padre · toda una clase (todos los padres de su aula)                                   |

(Tutor/autorizado **no** organizan citas en Ola 1 — solo reciben invitaciones y
responden RSVP. Ver D-B5.)

### 3.3 RSVP

Cada invitado individual responde **aceptar / rechazar** (¿"quizá"? → D-B4). El
organizador ve el recuento por estado. **Sin firma ni valor legal** (igual límite
que F7/F8).

### 3.4 Vistas y preferencia

- Vistas **día / semana / mes**. **Por defecto: día.**
- La preferencia de vista se **persiste por usuario** (D-B7).
- Vista **mes** reusa `CalendarioMensual`; **día/semana** necesitan una **rejilla
  horaria nueva** (no existe; D-B6).

### 3.5 Ruta (B)

Ruta nueva **`/agenda`** (el ítem de nav `agenda` ya existe en i18n `nav.agenda`).
Separada de `/calendario` (que es el Calendario escolar). **Decisión abierta D-B8**
sobre el nombre/estructura exacta de la ruta.

---

## 4. Dominio C — Inicio (resumen de hoy)

Añadir a la home de cada rol (`/admin`, `/teacher`, `/family`) un bloque
**"Hoy"** que combine, **solo lectura**:

1. **Mi Agenda de hoy:** mis reuniones/visitas de hoy (como organizador o
   invitado), con hora y estado RSVP.
2. **Calendario escolar de hoy en mi ámbito:** tipo de día (`dias_centro`:
   festivo/lectivo/…) + eventos del día que me afectan (centro/aula/niño según
   rol).

No introduce modelo nuevo: **lee** de A y B. Ver D-C1 sobre si es un widget en la
home actual o una sección propia.

---

## 5. Decisiones ABIERTAS (cerrar antes del Checkpoint B)

Cada una con **recomendación**. Nada de esto se implementa hasta cerrarlas.

### Dominio A

- **D-A1 — Retirar `reunion` del ENUM `tipo_evento`.** Un valor de ENUM Postgres no
  se borra en caliente si hay filas que lo usan. Opciones: (a) migración que
  recrea el ENUM sin `reunion` (el piloto no ha arrancado → sin datos reales, como
  en F6-C); (b) dejar el valor "muerto" y ocultarlo en UI. **Recomendación: (a)**
  recrear el ENUM limpio (coherente con F6-C; cero deuda), aprovechando que no hay
  datos productivos.
- **D-A2 — Festivos/vacaciones: `dias_centro` vs `tipo_evento`.** Hay solape con
  F4.5a. **Recomendación: NO duplicar.** Festivo/vacación = `dias_centro` (única
  fuente de verdad, ya cierra agenda/asistencia); el Calendario escolar **fusiona
  visualmente** las dos capas y **no** añade `tipo_evento='festivo'`. _(Esto matiza
  el "añade festivos" del encargo: el festivo se muestra en el calendario, pero su
  origen sigue siendo `dias_centro`, no `eventos`. Confírmame si prefieres
  materializarlo como tipo de evento.)_
- **D-A3 — Confirmación por tipo.** ¿Qué tipos permiten `requiere_confirmacion`?
  **Recomendación:** excursión (sí, típico), fiesta (opcional), evento genérico
  (opcional); festivo/vacación nunca. Se mantiene el flag por evento (no se
  hardcodea por tipo) con un default sensato en UI.

### Dominio B — Agenda

- **D-B1 — Modelo de datos.** **Recomendación:** dos tablas nuevas —
  `citas` (la cita: organizador, tipo reunión/visita, título, fecha, `hora_inicio`,
  `hora_fin`, lugar, `centro_id`, estado programada/cancelada) y `cita_invitados`
  (una fila por invitado: `cita_id`, `usuario_id` **o** invitado externo, estado
  RSVP, `respondido_at`). Patrón espejo de `eventos`/`confirmaciones_evento` pero
  con **invitados nominales** en vez de audiencia por ámbito. Nombres a confirmar.
- **D-B2 — Invitar a grupos: ¿expandir a personas o guardar el grupo?**
  **Recomendación: expandir en el momento de crear** (snapshot): "todos los padres
  de la clase X" se materializa como N filas `cita_invitados` (una por tutor con
  `puede_recibir_mensajes`). Ventaja: RSVP individual, recuento simple, audiencia
  estable aunque cambie la matrícula después. Coste: si entra un niño nuevo tras
  crear la cita, no queda invitado (aceptable; o se re-sincroniza al editar).
  Alternativa (guardar `grupo='aula:X'` y resolver al vuelo) complica el RSVP por
  persona. Reusa `getAulasParaRecordatorios`/`expandir…` de F6-C para resolver la
  lista.
- **D-B3 — Invitados externos sin cuenta (visitas comerciales / nueva matrícula).**
  **Recomendación Ola 1:** permitir un invitado externo **solo como texto**
  (nombre + email/teléfono opcional, sin RSVP digital — su asistencia la marca el
  organizador). Modelo: en `cita_invitados`, `usuario_id` NULL + `nombre_externo`.
  Evita gestionar magic-links/tokens para no-usuarios en Ola 1 (eso sería F8-like).
- **D-B4 — Estados RSVP.** **Recomendación:** `pendiente` / `aceptado` /
  `rechazado` (3 estados, como `confirmacion_estado` de F7). "Quizá/tentative"
  fuera de Ola 1 salvo que lo pidas.
- **D-B5 — Permisos de creación por rol.** **Recomendación:** admin y profe
  organizan (según matriz §3.2); tutor/autorizado **solo** reciben + RSVP (coherente
  con el rol "solo reciben" de F6-C). Enforzado en RLS de `citas` (INSERT) y de
  `cita_invitados`.
- **D-B6 — Vista día/semana (rejilla horaria).** No existe componente. **Recomendación:**
  componente nuevo `AgendaSemana`/`AgendaDia` (lista/rejilla por horas), **sin**
  forzar `CalendarioMensual` (que es rejilla de días, no de horas). La vista **mes**
  sí reusa `CalendarioMensual`. Mantener el componente de rejilla horaria simple
  (lista agrupada por hora) en Ola 1; rejilla pixel-perfect tipo Outlook → Ola 3.
- **D-B7 — Persistir preferencia de vista.** Opciones: (a) columna en `usuarios`
  (p.ej. `pref_vista_agenda`), (b) tabla `preferencias_usuario` clave-valor, (c)
  `localStorage` (no cross-device). **Recomendación: (b)** una tabla
  `preferencias_usuario (usuario_id, clave, valor)` genérica — sirve para esta y
  futuras preferencias (idioma de vista, densidad…), sin ensanchar `usuarios` cada
  vez. Si se quiere mínimo esfuerzo: (a). **(b) recomendada** por extensibilidad.
- **D-B8 — Ruta y nombre.** **Recomendación:** `/agenda` (ya hay `nav.agenda`).
  Mantener `/calendario` para el Calendario escolar. Confirmar etiquetas i18n
  ("Agenda" vs "Calendario") para no confundir a familias.
- **D-B9 — Recurrencia.** ¿Citas recurrentes (claustro semanal, etc.)? **Recomendación:
  NO en Ola 1** (complejidad alta: series, excepciones, edición de una instancia).
  Se crean citas sueltas. Recurrencia → Ola 3. _(Marcado abierto por si lo
  consideras imprescindible ya.)_
- **D-B10 — Notificaciones de la Agenda.** ¿Push al invitar / al cambiar fecha / al
  cancelar? **Recomendación:** reusar `enviarPushANotificarUsuarios` (F5.5):
  notificar al invitar y en cambio material/cancelación (mismo criterio que el
  refinamiento de F7, ADR-0038). El canal push sigue aparcado (bloqueante temprano
  de Ola 1) — se cablea, no se garantiza entrega aún.
- **D-B11 — Ventana de respuesta / edición.** ¿Hasta cuándo se puede responder o
  editar una cita? **Recomendación:** RSVP hasta la fecha/hora de inicio
  (análogo a D12 de F7); editar/cancelar solo el organizador (análogo a D8). Sin
  ventana de 5 min (eso es para anulación de mensajes).

### Dominio C — Inicio

- **D-C1 — Widget vs sección.** **Recomendación:** un **widget "Hoy"** en la home
  existente de cada rol (no una ruta nueva), alimentado por dos queries (Agenda de
  hoy + Calendario escolar de hoy). Reusa `ProximosDiasCerradosWidget` como
  vecino. Mínimo cambio de navegación.
- **D-C2 — Alcance del resumen.** ¿Solo hoy, o "hoy + próximos N días"?
  **Recomendación:** **hoy** (título "Hoy"), con enlace "ver agenda" → `/agenda`.
  Próximos días ya los cubre `ProximosDiasCerradosWidget` para el calendario
  laboral.

### Transversales

- **D-T1 — ¿Sub-fases?** Esto es grande para un solo Checkpoint B. **Recomendación:**
  partir en **F7a-1 (Calendario escolar: F7 + quitar reunión + fusión `dias_centro`)**,
  **F7a-2 (Agenda: modelo invitaciones + RSVP + vistas)** y **F7a-3 (Inicio "Hoy")**,
  secuenciales, cada una con su Checkpoint B. _(No invento las fases sin tu OK.)_
- **D-T2 — Auditoría / RGPD.** `citas`/`cita_invitados`: ¿se auditan? **Recomendación:**
  `citas` sí (contenido), `cita_invitados` no si se considera telemetría de
  respuesta — o sí, por trazabilidad de quién fue convocado (probablemente **sí**,
  por su valor administrativo). A cerrar con el modelo (D-B1).

---

## 6. Fuera de alcance (de esta spec / Ola 1)

- Recurrencia de citas (D-B9 → Ola 3).
- Rejilla horaria pixel-perfect tipo Outlook con drag (Ola 3).
- Invitados externos con RSVP digital propio (magic-link) — Ola 1 solo texto (D-B3).
- Reserva de franjas para tutorías (ya estaba en Ola 3 por `scope-ola-1.md`).
- Firma / valor legal de la asistencia o del RSVP (eso es F8).

---

## 7. Entregable de este Checkpoint A

Esta spec (borrador). **No** se implementa nada hasta que el responsable cierre las
decisiones D-A*/D-B*/D-C*/D-T*. Tras el cierre, se planifican los Checkpoint B
(probablemente en las sub-fases de D-T1).

> **PARA aquí.** Pendiente: revisión del responsable y cierre de decisiones abiertas.
