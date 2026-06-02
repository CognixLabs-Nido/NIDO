---
feature: agenda-citas
wave: 1
status: approved
priority: high
last_updated: 2026-06-02
related_adrs: [ADR-0038, ADR-0037, ADR-0029, ADR-0031, ADR-0007]
related_specs: [scope-ola-1, f7-calendario, messaging, reminders-c, push-notifications]
supersedes: f7a-calendario-agenda.md (PR #50 — su Dominio B; ver Contexto y Referencias)
---

# Spec — Agenda (citas con invitados nominales y RSVP) — LEAN

> **Checkpoint A cerrado** (responsable, 2026-06-02). Todas las decisiones de
> diseño están **fijadas** (tabla de decisiones al final). El siguiente paso es el
> **Checkpoint B** por sub-pasos reviewables (ver "Plan de Checkpoint B").

## Resumen ejecutivo

La **Agenda** es un calendario de **citas con invitados nominales**: un
**organizador** del staff convoca a **personas concretas** (no a una audiencia por
ámbito) y cada invitado responde con **RSVP** (pendiente / acepta / rechaza). Es el
modelo "tipo Outlook/Google Calendar" del producto: reuniones con una familia, con
una clase entera, de claustro, y visitas. Vive en **`/agenda`** con vistas
**día / semana / mes** (por defecto día).

Es un **modelo nuevo y separado de `eventos`** (F7). `eventos` = **difusión** (el
centro anuncia algo a su audiencia, con confirmación opcional de asistencia
ligera); la Agenda = **invitación nominal** (lista de invitados + RSVP por persona).

## Contexto

Al cerrar F7 ([ADR-0038](../decisions/ADR-0038-modelo-eventos-y-confirmaciones.md))
se detectó que la tabla `eventos` mezclaba **dos productos**: la **difusión**
(audiencia por ámbito centro/aula/niño, confirmación opcional) y la **invitación**
(organizador → invitados concretos → RSVP individual). F7 cerró como **solo
difusión**; la **invitación** se sacó a una fase propia con modelo nuevo. Esta spec
es esa fase: la **Agenda**.

El valor que cubre y que hoy NO existe:

- Convocar a personas concretas (un padre, una clase, un profe, el claustro) y
  saber **quién acepta/rechaza**, persona a persona.
- Distinguir **lo que organizo** de **aquello a lo que me invitan**.
- Vistas **día/semana** (rejilla horaria) que `eventos` no tiene (solo mes).

NIDO ya tiene piezas reutilizables que la Agenda debe aprovechar sin duplicar:

- **`<CalendarioMensual/>`** (`src/shared/components/calendario/`) — grid mensual
  genérico y agnóstico de dominio (`renderDia` lo decide el padre). **Solo para la
  vista MES.** Las vistas día/semana son rejilla **horaria**, que no existe → se
  crean (AG-06).
- **Patrón de audiencia/grupos de F6-C** (`expandirDestinatariosRecordatorio`,
  resolución de aulas) — se reutiliza para **expandir un grupo a personas** al
  crear la cita (snapshot, AG-02).
- **Patrón row-aware anti-MVCC y RLS default-DENY** de F5/F7 (helpers
  `SECURITY DEFINER STABLE`, `centro_id` explícito en el action).
- **`enviarPushANotificarUsuarios`** (F5.5) — disponible para notificaciones, que
  en esta fase quedan **fuera del core** (§6, follow-up; el canal push sigue
  aparcado).

## User stories

- US-01: Como **admin**, quiero convocar a un padre / a toda una clase / a un profe
  / al claustro a una reunión con fecha y hora, para que cada invitado confirme si
  asiste.
- US-02: Como **profe**, quiero convocar a una familia o a toda mi clase a una
  reunión, sin pasar por dirección.
- US-03: Como **organizador**, quiero registrar una **visita** (comercial, nueva
  matrícula) con un invitado **externo** (solo su nombre) y la hora.
- US-04: Como **tutor/autorizado**, quiero ver en **mi agenda** las citas a las que
  me invitan y **aceptar o rechazar** cada una.
- US-05: Como **organizador**, quiero ver el **recuento de RSVP** de mi cita (quién
  acepta, quién rechaza, quién no ha respondido).
- US-06: Como **cualquier usuario**, quiero alternar entre vistas **día / semana /
  mes** y que mi preferencia se **recuerde** entre sesiones.

## Alcance

**Dentro (Agenda LEAN, Ola 1):**

- Tabla `citas` (la cita: organizador, tipo, título, fecha, hora, lugar, estado) y
  `cita_invitados` (un invitado por fila: usuario interno **o** externo-texto +
  estado RSVP).
- **4 tipos** de cita: reunión con una familia, reunión de clase, reunión de
  claustro, visita (AG-tipos).
- **Invitados nominales**: personas concretas. Los **grupos** ("toda la clase",
  "todos los profes") se **expanden a personas** al crear (snapshot, AG-02).
- **Editar la lista de invitados** de una cita ya creada: **añadir Y quitar**
  personas (AG-02). En Ola 1.
- **Alta de cita con patrón del Calendario**: botón **"+ Nueva cita"** y **clic
  directo en un día** (`onClickDia` prefija la fecha). Se reutiliza el **patrón de
  interacción** (alta + vista) del Calendario escolar (eventos), **no el modelo**:
  `citas` y `eventos` son tablas separadas (AG-09).
- **RSVP por invitado**, 3 estados: `pendiente` / `aceptado` / `rechazado` (AG-04).
- **Invitado externo = solo texto** (nombre), sin cuenta ni RSVP digital; su
  asistencia la marca el organizador (AG-03).
- Vistas **día (default) / semana / mes**; mes reusa `<CalendarioMensual/>`,
  día/semana son **componentes nuevos** de rejilla horaria (AG-06).
- **Preferencia de vista persistida** por usuario (AG-07).
- Ruta propia **`/agenda`** (top-level, cross-rol, patrón `/reminders`–`/messages`).
- RLS row-aware (default DENY, `centro_id` explícito, anti-MVCC patrón F7).
- Audit log de `citas` y `cita_invitados` (AG-12).
- i18n trilingüe es/en/va, namespace nuevo `citas` (evita colisión con la _agenda
  diaria_ de F3; AG-08).

**Fuera (no se hace aquí — follow-up / Ola posterior):**

- **Notificaciones push** de la Agenda (al invitar / cambio de fecha / cancelación)
  → **follow-up**. El canal push sigue aparcado (bloqueante temprano de Ola 1); se
  deja el **seam** para `enviarPushANotificarUsuarios`, no se cablea en el core.
- **Invitados externos con RSVP digital** (magic-link / email / token) → follow-up.
  En Ola 1 el externo es **solo texto**.
- **Recurrencia** de citas (claustro semanal, series, excepciones) → Ola 3.
- **Re-sync automático** de la lista de invitados por cambio de matrícula
  (auto-añadir un niño que entra al aula tras crear la cita) → follow-up. La
  edición de la lista en Ola 1 es **manual** (el organizador añade/quita; AG-02).
- **Change-log completo del RSVP** (historial de cada cambio de respuesta) →
  follow-up. En Ola 1 la fila guarda el **estado actual + quién/cuándo**; el
  `audit_log` registra los cambios por el trigger estándar, sin vista dedicada
  (AG-12).
- **Rejilla horaria pixel-perfect** con drag tipo Outlook → Ola 3. En Ola 1, lista
  agrupada por hora (AG-06).
- **Realtime** del roster en vivo → fuera del LEAN (AG-13).
- **Reserva de franjas para tutorías** (autoservicio de la familia para pedir hueco)
  → Ola 3 (ya estaba en `scope-ola-1.md`).
- **Firma / valor legal** del RSVP → eso es F8 (autorizaciones). El RSVP es
  asistencia ligera, igual límite RGPD que F7.

## Comportamientos detallados

### Comportamiento 1: crear una cita e invitar

**Pre-condiciones:** el usuario es **organizador válido** según la matriz AG-tipos:

| Tipo (`tipo_cita`) | Quién organiza         | A quién invita (nominal)                                 |
| ------------------ | ---------------------- | -------------------------------------------------------- |
| `reunion_familia`  | admin · profe del niño | tutores/autorizados del **niño** (`nino_id`)             |
| `reunion_clase`    | admin · profe del aula | **todas las familias del aula** (expandidas) (`aula_id`) |
| `reunion_claustro` | **solo admin**         | un profe · todos los profes del centro                   |
| `visita`           | **solo admin**         | staff interno seleccionado · 1 invitado externo (texto)  |

**Flujo:**

1. El organizador abre el formulario en `/agenda` por dos vías equivalentes
   (patrón Calendario, AG-09): botón **"+ Nueva cita"**, o **clic en un día** de la
   vista (`onClickDia` prefija `fecha`). El mismo formulario en modo alta.
2. Elige **tipo**, **título**, **fecha**, **hora_inicio** (obligatoria),
   **hora_fin** (opcional), **lugar** (opcional), **descripción** (opcional), y los
   **invitados** (personas individuales y/o un grupo según el tipo; y/o un invitado
   externo por nombre si es `visita`).
3. Server action `crearCita` valida con Zod, **resuelve `centro_id` explícito** (del
   niño/aula/organizador; nunca sentinel) e inserta la fila `citas`.
4. **Expansión de grupos a personas (snapshot, AG-02):** un grupo ("toda la clase",
   "todos los profes") se materializa **en el momento** como N filas
   `cita_invitados` (una por persona), reutilizando los resolutores de F6-C
   (familias del aula con `puede_recibir_mensajes`; profes del centro). El invitado
   externo se inserta con `usuario_id = NULL` + `nombre_externo`.
5. RLS `WITH CHECK` autoriza la `citas` por tipo+rol y cada `cita_invitados` por ser
   el organizador de esa cita.

**Post-condiciones:** una fila `citas` (`estado='programada'`) y N filas
`cita_invitados` (`estado='pendiente'`). La cita aparece en la agenda de cada
invitado y del organizador.

### Comportamiento 2: ver mi agenda (día / semana / mes)

**Flujo:**

1. `/agenda` carga las citas del rango visible donde el usuario es **organizador o
   invitado** (RLS filtra). Query `getCitasRango(centroId, desde, hasta)`.
2. Vista por defecto = **día** (o la preferencia persistida del usuario, AG-07).
   Toggle día/semana/mes; cambiar de vista **persiste** la preferencia.
3. **Día/semana:** rejilla/lista **horaria** (componente nuevo) — cada cita en su
   franja, con hora, título, tipo y mi estado RSVP. **Mes:** `<CalendarioMensual/>`
   con chips por día (color por tipo); click en día → lista del día → detalle.

**Post-condiciones:** ninguna (solo lectura).

### Comportamiento 3: responder a una invitación (RSVP)

**Pre-condiciones:** el usuario es invitado **interno** de la cita
(`cita_invitados.usuario_id = auth.uid()`); la cita está `programada`; aún no ha
pasado la fecha/hora de inicio (ventana, AG-11).

**Flujo:**

1. El invitado abre el detalle de la cita y ve el control **aceptar / rechazar**
   (+ comentario opcional).
2. `responderInvitacion` hace `UPDATE` de **su propia fila** `cita_invitados`
   (`estado`, `respondido_at`, `respondido_por = auth.uid()`, `comentario`) —
   idempotente, last-write-wins del propio invitado. Patrón "USING falso → 0 filas"
   - `.select().maybeSingle()` para detectar ventana cerrada (igual que F5.6-B/F6).
3. El estado es **editable** hasta la fecha/hora de inicio (AG-11).

**Post-condiciones:** la fila `cita_invitados` refleja el RSVP; el roster del
organizador lo muestra al recargar.

### Comportamiento 4: roster de RSVP (organizador)

**Flujo:** el organizador (o un admin del centro) abre el detalle de su cita y ve
la **lista de invitados** con su estado RSVP (pendiente / aceptado / rechazado) y
recuento por estado. Para invitados **externos** (texto), el organizador puede
**marcar manualmente** su asistencia (no hay RSVP digital). Componente ligero
`InvitadosRoster` (no se fuerza `<PaseDeListaTable/>`, que es por niño; aquí las
filas son personas).

### Comportamiento 5: editar / cancelar una cita y su lista de invitados

**Flujo:** solo el **organizador o un admin** del centro edita/cancela (AG-11).

- **Editar** campos (título, fecha, hora, lugar, descripción): server action
  `editarCita`, RLS `USING + WITH CHECK` simétricos; el action limita columnas.
- **Editar la lista de invitados** (AG-02, **en Ola 1**):
  - **Añadir** personas/grupos/externo → `agregarInvitados(cita_id, …)`: nuevas
    filas `cita_invitados` (`estado='pendiente'`), dedup contra los ya invitados
    (UNIQUE parcial). Reusa la expansión de grupos del alta.
  - **Quitar** una persona → `quitarInvitado(invitado_id)`: **DELETE** de la fila
    (excepción explícita al patrón "DELETE bloqueado", como `dias_centro` en
    F4.5a). La traza queda en `audit_log` (`valores_antes` poblado por el trigger).
    Solo organizador/admin.
- **Cancelar la cita:** `estado='cancelada'` (no DELETE; patrón del proyecto). La
  cita cancelada se muestra **atenuada/tachada**, no desaparece (trazabilidad). Las
  filas `cita_invitados` se conservan.

> **Notificaciones (push):** al crear/editar-material/cancelar se notificaría a los
> invitados internos. **Fuera del core** (§6, follow-up): se deja el seam, no se
> cablea (canal push aparcado).

## Casos edge

- **Agenda vacía**: el rango no tiene citas → estado vacío "Sin citas" por vista.
- **Sin permisos**: un usuario abre el id de una cita a la que no le invitan ni
  organiza → RLS no la devuelve → 404/forbidden (como mensajería/F7).
- **Profe intenta crear claustro o visita** → RLS rechaza (solo admin); la UI no
  ofrece esos tipos a un profe.
- **Tutor/autorizado intenta crear cita** → no es organizador en Ola 1; sin botón
  "Nueva cita" y RLS de `citas` INSERT lo rechaza.
- **Invitar dos veces a la misma persona** en la misma cita → UNIQUE parcial
  `(cita_id, usuario_id)` lo evita (el resolutor dedup antes de insertar).
- **Niño cambia de aula tras crear `reunion_clase`** → el snapshot ya fijó la lista
  (AG-02); no hay re-sync automático (follow-up). El organizador puede **añadir o
  quitar** invitados a mano (Comportamiento 5).
- **Responder fuera de plazo** (pasó hora_inicio) → la RLS/action lo rechaza con
  mensaje de plazo cerrado (gotcha "USING falso → 0 filas").
- **Doble RSVP del mismo invitado** (dos pestañas) → idempotente, last-write-wins.
- **`reunion_familia` con dos tutores del niño** → ambos son invitados; cada uno
  tiene **su propia fila** y su propio RSVP (no se pisan).
- **Invitado externo sin cuenta** → fila con `usuario_id NULL` + `nombre_externo`;
  no recibe nada digital; su estado lo gestiona el organizador.
- **Tutor con `puede_recibir_mensajes = false`** → no se incluye al expandir grupos
  de familias (coherente con F6-C); puede invitársele **individualmente** de forma
  explícita (decisión de organizador), pero el push (cuando exista) respetará el
  flag.
- **hora_fin <= hora_inicio** → CHECK BD + Zod lo rechazan.
- **Cita cancelada**: se muestra tachada; no admite nuevos RSVP ni edición.
- **Idiomas**: fechas/horas con `Intl` por locale (es-ES/en-GB/ca-ES), como
  `<CalendarioMensual/>`.

## Validaciones (Zod)

```typescript
export const tipoCitaEnum = z.enum([
  'reunion_familia',
  'reunion_clase',
  'reunion_claustro',
  'visita',
])
export const rsvpEstadoEnum = z.enum(['pendiente', 'aceptado', 'rechazado'])

// Un invitado puede ser persona interna (usuario_id), un grupo a expandir, o externo.
const invitadoSchema = z.union([
  z.object({ tipo: z.literal('usuario'), usuario_id: z.string().uuid() }),
  z.object({ tipo: z.literal('grupo'), grupo: z.enum(['familias_aula', 'profes_centro']) }),
  z.object({ tipo: z.literal('externo'), nombre_externo: z.string().min(1).max(200) }),
])

export const crearCitaSchema = z
  .object({
    tipo: tipoCitaEnum,
    aula_id: z.string().uuid().nullable(),
    nino_id: z.string().uuid().nullable(),
    titulo: z.string().min(1).max(200, 'citas.errors.titulo_largo'),
    descripcion: z.string().max(2000, 'citas.errors.descripcion_larga').optional(),
    lugar: z.string().max(200, 'citas.errors.lugar_largo').optional(),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'citas.errors.fecha_invalida'),
    hora_inicio: z.string().regex(/^\d{2}:\d{2}$/, 'citas.errors.hora_invalida'),
    hora_fin: z
      .string()
      .regex(/^\d{2}:\d{2}$/, 'citas.errors.hora_invalida')
      .optional(),
    invitados: z.array(invitadoSchema).min(1, 'citas.errors.sin_invitados'),
  })
  // coherencia tipo ↔ referencia (espejo del CHECK estructural)
  .refine((d) => d.tipo !== 'reunion_familia' || !!d.nino_id, {
    message: 'citas.errors.nino_requerido',
  })
  .refine((d) => d.tipo !== 'reunion_clase' || !!d.aula_id, {
    message: 'citas.errors.aula_requerida',
  })
  .refine((d) => !['reunion_claustro', 'visita'].includes(d.tipo) || (!d.nino_id && !d.aula_id), {
    message: 'citas.errors.sin_referencia',
  })
  .refine((d) => !d.hora_fin || d.hora_fin > d.hora_inicio, {
    message: 'citas.errors.hora_fin_invalida',
  })

export const responderInvitacionSchema = z.object({
  cita_id: z.string().uuid(),
  estado: z.enum(['aceptado', 'rechazado']),
  comentario: z.string().max(500).optional(),
})

export type CrearCita = z.infer<typeof crearCitaSchema>
```

## Modelo de datos afectado

**Migración ADITIVA** — `CREATE` puro, nada de drop+recreate (las tablas no
existen). Nombre tentativo: `supabase/migrations/2026XXXXXXXXXX_phase7b_agenda.sql`.

**ENUMs nuevos (3):**

- `tipo_cita`: `reunion_familia` · `reunion_clase` · `reunion_claustro` · `visita`.
- `cita_estado`: `programada` · `cancelada`.
- `rsvp_estado`: `pendiente` · `aceptado` · `rechazado`.

### Tabla `citas`

| Columna                   | Tipo                                        | Notas                                                        |
| ------------------------- | ------------------------------------------- | ------------------------------------------------------------ |
| `id`                      | uuid PK `gen_random_uuid()`                 |                                                              |
| `centro_id`               | uuid NOT NULL FK→`centros`                  | derivado **explícito** en el action; trigger BEFORE como red |
| `tipo`                    | `tipo_cita` NOT NULL                        |                                                              |
| `organizador_id`          | uuid NOT NULL FK→`usuarios`                 | `auth.uid()`                                                 |
| `titulo`                  | text NOT NULL                               | CHECK 1..200                                                 |
| `descripcion`             | text NULL                                   | CHECK ≤ 2000                                                 |
| `lugar`                   | text NULL                                   | CHECK ≤ 200                                                  |
| `fecha`                   | date NOT NULL                               | día de la cita (cita de un solo día)                         |
| `hora_inicio`             | time NOT NULL                               | la agenda es horaria                                         |
| `hora_fin`                | time NULL                                   | CHECK `hora_fin > hora_inicio`                               |
| `aula_id`                 | uuid NULL FK→`aulas` ON DELETE CASCADE      | obligatorio si `tipo='reunion_clase'`                        |
| `nino_id`                 | uuid NULL FK→`ninos` ON DELETE CASCADE      | obligatorio si `tipo='reunion_familia'`                      |
| `estado`                  | `cita_estado` NOT NULL default `programada` | cancelación = UPDATE a `cancelada` (no DELETE)               |
| `created_at`/`updated_at` | timestamptz                                 | trigger `set_updated_at`                                     |

**CHECK estructural** `citas_tipo_coherencia` (espejo de `eventos_ambito_coherencia`):
`reunion_familia ⇒ nino_id NOT NULL AND aula_id NULL`; `reunion_clase ⇒ aula_id NOT
NULL AND nino_id NULL`; `reunion_claustro` y `visita ⇒ ambos NULL`.

**Índices:** `(centro_id, fecha)` para `getCitasRango`; `(organizador_id)`.

### Tabla `cita_invitados`

| Columna                   | Tipo                                       | Notas                                                                  |
| ------------------------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| `id`                      | uuid PK                                    |                                                                        |
| `cita_id`                 | uuid NOT NULL FK→`citas` ON DELETE CASCADE |                                                                        |
| `centro_id`               | uuid NOT NULL FK→`centros`                 | redundante para RLS; derivado de la cita                               |
| `usuario_id`              | uuid NULL FK→`usuarios` ON DELETE CASCADE  | invitado interno; NULL ⇒ externo                                       |
| `nombre_externo`          | text NULL                                  | invitado externo (texto); CHECK ≤ 200                                  |
| `estado`                  | `rsvp_estado` NOT NULL default `pendiente` |                                                                        |
| `respondido_at`           | timestamptz NULL                           | quién/cuándo del RSVP (AG-12)                                          |
| `respondido_por`          | uuid NULL FK→`usuarios` ON DELETE SET NULL | quién fijó el estado: el invitado (interno) o el organizador (externo) |
| `comentario`              | text NULL                                  | opcional, CHECK ≤ 500                                                  |
| `created_at`/`updated_at` | timestamptz                                |                                                                        |

**CHECK** `cita_invitados_persona_coherencia`: **exactamente uno** de (`usuario_id`,
`nombre_externo`) NOT NULL.
**UNIQUE parcial** `(cita_id, usuario_id) WHERE usuario_id IS NOT NULL` (no
duplicar un mismo invitado interno).
**Índices:** `(cita_id)`; `(usuario_id) WHERE usuario_id IS NOT NULL` ("mis
invitaciones").

### Tabla `preferencias_usuario` (transversal — soporta AG-07)

Clave-valor genérica por usuario, para la preferencia de vista (y futuras
preferencias) sin ensanchar `usuarios` cada vez.

| Columna      | Tipo                                          | Notas                      |
| ------------ | --------------------------------------------- | -------------------------- |
| `usuario_id` | uuid NOT NULL FK→`usuarios` ON DELETE CASCADE |                            |
| `clave`      | text NOT NULL                                 | p.ej. `agenda_vista`       |
| `valor`      | text NOT NULL                                 | p.ej. `dia`/`semana`/`mes` |
| `updated_at` | timestamptz                                   | trigger `set_updated_at`   |

**PK / UNIQUE** `(usuario_id, clave)`. **No se audita** (preferencia/telemetría,
como `lectura_*`/`push_subscriptions`).

**Tablas consultadas:** `ninos`, `aulas`, `matriculas`, `vinculos_familiares`,
`roles_usuario` (expansión de grupos y RLS).

## Políticas RLS

Principios del proyecto: **default DENY**, helpers `SECURITY DEFINER STABLE` en
`public.*`, **helper row-aware** para evitar el gotcha MVCC en `INSERT…RETURNING`
(el action hace `.insert().select('id')`).

**Nota MVCC (clave de diseño):** el helper SELECT de `citas` **no re-lee `citas`**
(recibe `centro_id`/`organizador_id` por parámetro = row-aware) y consulta
`cita_invitados`, que es una **tabla distinta** → el gotcha MVCC **no aplica** a esa
lectura (regla documentada en `rls-policies.md`). Igual para `cita_invitados`, cuyo
helper lee `citas` (otra tabla). Aun así se añaden los tests `INSERT…RETURNING`
explícitos en ambas tablas como bloqueo de regresión (patrón F7).

**Helpers nuevos** (`LANGUAGE sql/plpgsql STABLE SECURITY DEFINER SET search_path = public`):

```sql
public.centro_de_cita(p_cita_id uuid)        -- → uuid (lee citas)
public.organizador_de_cita(p_cita_id uuid)   -- → uuid (lee citas)
public.usuario_es_invitado_cita(p_cita_id uuid) -- → boolean (lee cita_invitados con auth.uid())

-- row-aware: recibe los campos de `citas`, NO re-lee `citas`
public.usuario_es_audiencia_cita_row(
  p_centro_id uuid, p_organizador_id uuid, p_cita_id uuid
) -- → es_admin(p_centro_id) OR p_organizador_id = auth.uid()
  --   OR public.usuario_es_invitado_cita(p_cita_id)
```

Se reutilizan: `es_admin`, `es_profe_de_nino`, `es_profe_de_aula`, `centro_de_nino`,
`centro_de_aula` (F2), y los resolutores de grupos de F6-C en el server action.

```sql
-- citas
CREATE POLICY citas_select ON public.citas FOR SELECT
  USING (public.usuario_es_audiencia_cita_row(centro_id, organizador_id, id));
```

- **`citas` INSERT** — `organizador_id = auth.uid() AND (`
  `es_admin(centro_id)`
  ` OR (tipo='reunion_familia' AND es_profe_de_nino(nino_id) AND centro_de_nino(nino_id)=centro_id)`
  ` OR (tipo='reunion_clase' AND es_profe_de_aula(aula_id) AND centro_de_aula(aula_id)=centro_id))`.
  Claustro y visita → solo admin (no hay rama profe). Espejo de la matriz AG-tipos.
- **`citas` UPDATE** — `USING + WITH CHECK` simétricos: `organizador_id = auth.uid()
OR es_admin(centro_id)`. El server action limita columnas (editar / cancelar).
- **`citas` DELETE** — SIN policy → default DENY (cancelación con `estado`).
- **`cita_invitados` SELECT** — `usuario_id = auth.uid() OR
organizador_de_cita(cita_id) = auth.uid() OR es_admin(centro_id)`.
- **`cita_invitados` INSERT** — `(organizador_de_cita(cita_id) = auth.uid() OR
es_admin(centro_id)) AND centro_id = centro_de_cita(cita_id)`. Solo el organizador
  (o admin) puebla invitados, tanto en el **alta** como al **añadir** después
  (Comportamiento 5); el action expande grupos.
- **`cita_invitados` UPDATE** — `USING + WITH CHECK`: `usuario_id = auth.uid()` (el
  invitado responde su fila) `OR organizador_de_cita(cita_id) = auth.uid() OR
es_admin(centro_id)` (el organizador marca al externo). El server action separa
  los dos casos y limita columnas + ventana (AG-11). Idempotencia: `.select().maybeSingle()`.
- **`cita_invitados` DELETE** — `organizador_de_cita(cita_id) = auth.uid() OR
es_admin(centro_id)`. **Excepción explícita** al patrón "DELETE bloqueado"
  (análoga a `dias_centro`, F4.5a): quitar un invitado es gestión de lista, sin
  valor de contenido que preservar; la traza queda en `audit_log` (`valores_antes`).
  El invitado **no** puede auto-eliminarse (responde con `rechazado`, no se borra).
- **`preferencias_usuario`** — todas las operaciones con `usuario_id = auth.uid()`
  (aislamiento estricto, sin helpers; patrón `push_subscriptions`).

> **Tests RLS bloqueantes:** aislamiento (un invitado no ve citas que no organiza ni
> recibe; profe no crea claustro/visita; tutor no crea citas; un invitado no falsea
> `usuario_id` ni responde por otro); `INSERT…RETURNING` en `citas` (4 tipos) y en
> `cita_invitados` sin fallo MVCC.

## Pantallas y rutas

- **`/agenda`** — ruta **top-level cross-rol** con layout propio (patrón
  `/reminders`, `/messages`), no role-prefixed. Contenido según rol: admin/profe ven
  botón "Nueva cita" (tipos según matriz); tutor/autorizado solo ven sus
  invitaciones + RSVP.
- Vista **día** (default) / **semana** / **mes** dentro de `/agenda` (toggle;
  preferencia persistida). Botón **"+ Nueva cita"** y **clic en un día**
  (`onClickDia`) abren el alta con la fecha prefijada (patrón Calendario, AG-09).
- Detalle de cita — modal/sub-vista (no necesariamente ruta propia): info + (invitado)
  control RSVP + (organizador) roster con edición de la lista de invitados.

## Componentes UI

- `CitaFormDialog.tsx` (Client) — crear/editar, RHF + Zod, selector de invitados
  (persona / grupo / externo según tipo). Acepta `fechaInicial` (de `onClickDia`).
  Patrón `EventoFormDialog`/`RecordatorioFormDialog`.
- `AgendaDia.tsx` / `AgendaSemana.tsx` (Client) — **rejilla/lista horaria nueva**
  (citas por franja). Lean: lista agrupada por hora; pixel-perfect → Ola 3.
- `AgendaMes.tsx` (Client) — envuelve `<CalendarioMensual/>` y pinta chips de citas
  por día (color por tipo); `onClickDia` abre el alta con esa fecha (AG-09).
- `CitaDetalle.tsx` — info + (invitado) `RsvpControl` + (organizador) `InvitadosRoster`.
- `RsvpControl.tsx` (Client) — aceptar/rechazar + comentario.
- `InvitadosRoster.tsx` — lista de invitados con estado y recuento; el organizador
  marca asistencia del externo y **añade/quita** invitados (AG-02).
- `VistaToggle.tsx` (Client) — día/semana/mes; persiste preferencia.
- Server actions: `crearCita`, `editarCita`, `cancelarCita`, `responderInvitacion`,
  `agregarInvitados`, `quitarInvitado`, `marcarAsistenciaExterno`,
  `setPreferenciaVistaAgenda`.
- Queries (Server): `getCitasRango(centroId, desde, hasta)`,
  `getCitaDetalle(citaId)`, `getPreferenciaVistaAgenda()`.

## Eventos y notificaciones

- **Push**: **fuera del core** (follow-up). El seam es `enviarPushANotificarUsuarios`
  (F5.5) sobre los `usuario_id` internos de `cita_invitados`; criterio de
  re-notificación material igual que F7 (ADR-0038). No se cablea aquí (canal push
  aparcado).
- **Audit**: trigger automático en `citas` y `cita_invitados` (ramas nuevas en
  `audit_trigger_function`, `centro_id` directo). `cita_invitados` se audita como
  **registro administrativo** (quién fue convocado; quién/cuándo del RSVP) — **no**
  como autorización legal (eso es F8, no se mezcla). En Ola 1: **estado actual +
  quién/cuándo** en la fila, y los cambios en `audit_log` por el trigger estándar;
  **sin** vista de change-log dedicada (AG-12). `preferencias_usuario` **no** se
  audita.

## i18n

Namespace **nuevo `citas`** en `messages/{es,en,va}.json` (NO `agenda`, ya ocupado
por la _agenda diaria_ de F3, AG-08): tipos de cita, estados RSVP, etiquetas del
formulario, errores de validación, textos de vistas día/semana/mes, roster.
Trilingüe obligatorio (Regla #7).

**Renombrados de etiquetas (AG-08, es/en/va):**

- El **Calendario escolar** (ruta `/calendario`, eventos F7) cambia su etiqueta
  visible/nav de "Calendario" → **"Calendario Escolar"** (`Calendari Escolar` /
  `School Calendar`). La **ruta `/calendario` no cambia**, solo el label.
- El **nuevo módulo** (ruta `/agenda`) usa label visible **"Agenda"** (nav + título).
- La **agenda diaria del niño (F3)** **no se toca**: sus textos y la pestaña de la
  ficha del niño quedan exactamente como están.

## Accesibilidad

- `<CalendarioMensual/>` ya trae grid ARIA + teclado (vista mes); los chips de cita
  se anuncian en el `aria-label` de la celda.
- Rejilla horaria día/semana navegable por teclado, con horas y citas anunciadas.
- `RsvpControl` con roles ARIA y foco gestionado.

## Performance

- `getCitasRango` con índice `(centro_id, fecha)`; solo el rango visible.
- Expansión de grupos acotada (centro pequeño tipo ANAIA; resolutores F6-C ya
  suficientes).

## Telemetría

- `cita_creada`, `cita_rsvp` (sin PII).

## Tests requeridos

**Vitest (unit/integration):**

- [ ] `crearCitaSchema` / `responderInvitacionSchema` validan correctos e
      incorrectos (coherencia tipo↔referencia, `hora_fin>hora_inicio`, ≥1 invitado).
- [ ] `crearCita` resuelve `centro_id` explícito y retorna Result tipado.
- [ ] **Expansión de grupos** a personas (snapshot): `familias_aula` → tutores con
      `puede_recibir_mensajes`; `profes_centro` → profes; dedup; externo→fila texto.
- [ ] `responderInvitacion` idempotente (doble RSVP, carrera), respeta ventana y
      escribe `respondido_por`/`respondido_at`.
- [ ] `agregarInvitados` (dedup contra existentes) y `quitarInvitado` (DELETE) sobre
      una cita ya creada.
- [ ] Trigger audit registra INSERT/UPDATE/**DELETE** de `citas` y `cita_invitados`.

**Vitest (RLS):**

- [ ] Un invitado no ve citas que no organiza ni recibe; aislamiento por centro.
- [ ] Profe no puede crear `reunion_claustro` ni `visita`; tutor/autorizado no crea
      citas.
- [ ] Un invitado no puede responder por otro ni falsear `usuario_id`.
- [ ] Solo organizador/admin pueden **añadir/quitar** invitados; un invitado no
      puede borrar su fila ni la de otro.
- [ ] `INSERT…RETURNING` en `citas` (4 tipos) y en `cita_invitados` no falla por MVCC.
- [ ] `preferencias_usuario`: un usuario solo lee/escribe las suyas.

**Playwright (E2E):**

- [ ] Admin crea `reunion_clase` e invita a las familias del aula → un tutor la ve
      en `/agenda` (vista día) y **acepta** → el admin ve el roster actualizado.

## Criterios de aceptación

- [ ] Tests arriba en verde en CI.
- [ ] 3 lenguas completas (es/en/va), namespace `citas`.
- [ ] Renombrado del Calendario escolar a **"Calendario Escolar"** en es/en/va (ruta
      `/calendario` sin cambios); F3 agenda diaria intacta.
- [ ] Funciona en iOS Safari 16.4+ y Chrome Android.
- [ ] `data-model.md` actualizado (`citas`, `cita_invitados`, `preferencias_usuario` + 3 ENUMs → ✅).
- [ ] `rls-policies.md` actualizado (helpers + policies de la Agenda).
- [ ] ADR escrito (modelo invitación nominal + RSVP; reuso de expansión F6-C;
      separación frente a `eventos`).
- [ ] Migración ADITIVA aplicada al remoto vía **SQL Editor** (bug SIGILL del CLI) y
      registrada en `schema_migrations`.

## Decisiones CERRADAS (responsable, 2026-06-02)

> Heredan los defaults del Dominio B de f7a (PR #50) + los ajustes de cierre del
> responsable. **Todas cerradas.**

| #        | Decisión (cerrada)                                                                                                                                                                                                   | Origen f7a    |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| AG-tipos | 4 tipos: `reunion_familia` · `reunion_clase` · `reunion_claustro` · `visita`. Matriz organizador→invitado §C1.                                                                                                       | encargo       |
| AG-01    | Modelo de **2 tablas**: `citas` + `cita_invitados` (espejo de `eventos`/`confirmaciones_evento` pero nominal).                                                                                                       | D-B1          |
| AG-02    | Grupos se **expanden a personas al crear** (snapshot). **Editar lista (añadir Y quitar) en Ola 1**; re-sync auto = follow-up.                                                                                        | D-B2 + cierre |
| AG-03    | Invitado externo = **solo texto** (`usuario_id NULL` + `nombre_externo`); sin RSVP digital. Email/magic-link = follow-up.                                                                                            | D-B3          |
| AG-04    | RSVP **3 estados**: `pendiente`/`aceptado`/`rechazado`. Sin "quizá".                                                                                                                                                 | D-B4          |
| AG-05    | Organizan **admin y profe** (matriz); tutor/autorizado **solo reciben + RSVP**.                                                                                                                                      | D-B5          |
| AG-06    | Vista **mes reusa `<CalendarioMensual/>`**; **día/semana = componente horario nuevo** (lista por hora, lean).                                                                                                        | D-B6          |
| AG-07    | **Cerrado:** preferencia de vista en tabla genérica **`preferencias_usuario (usuario_id, clave, valor)`**.                                                                                                           | D-B7          |
| AG-08    | **Cerrado:** ruta **`/agenda`** label "Agenda"; renombrar Calendario (F7) → **"Calendario Escolar"** (ruta `/calendario` igual); i18n `citas`; **F3 agenda diaria intacta**.                                         | D-B8 + cierre |
| AG-09    | **Cerrado:** alta con **patrón Calendario** ("+ Nueva cita" **y** `onClickDia` → fecha prefijada). Se comparte **patrón** de alta/vista, **no el modelo** (`citas`≠`eventos`).                                       | cierre        |
| AG-11    | RSVP/edición hasta **hora de inicio**; editar/cancelar **solo organizador o admin**; cancelar = `estado`.                                                                                                            | D-B11         |
| AG-12    | **Cerrado:** auditar `citas` y `cita_invitados` como **registro administrativo** (quién/cuándo del RSVP), **no** legal (≠ F8). Estado actual + quién/cuándo; **sin change-log** dedicado. `preferencias_usuario` no. | D-T2 + cierre |
| AG-13    | **Sin Realtime** en el core (roster refresca al navegar).                                                                                                                                                            | D11 (F7)      |

## Plan de Checkpoint B (sub-pasos reviewables)

> La fase es grande; se parte en **sub-pasos secuenciales**, cada uno un commit (o
> PR pequeño) reviewable, **NO un PR gigante**. Patrón F7: migración aditiva, RLS
> row-aware, i18n es/en/va, tests. El responsable da OK a este plan antes de
> implementar; aplicar la migración al remoto (SQL Editor) es paso aparte con su OK.

| Sub-paso                              | Contenido                                                                                                                                                                                                                                                                                                                  | Entregable / verificación                                                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **B0 — Migración (SQL, sin aplicar)** | 3 ENUMs; `citas`; `cita_invitados` (con `respondido_por`); `preferencias_usuario`; CHECKs, índices, UNIQUE parcial; helpers row-aware; RLS (incl. DELETE de invitado, excepción tipo `dias_centro`); ramas de audit + triggers `set_updated_at`/`set_centro_id`. Archivo `2026XXXXXXXXXX_phase7b_agenda.sql`.              | SQL escrito + **resumen estructural + RLS clave pegados al responsable** para revisión antes de aplicar. `database.ts` a mano provisional. |
| **B1 — Tipos + schemas Zod**          | `tipoCitaEnum`, `rsvpEstadoEnum`, `crearCitaSchema`, `responderInvitacionSchema`, `agregarInvitadosSchema`. `db:types` cuando se aplique B0.                                                                                                                                                                               | `typecheck` verde; tests unit de schemas (válidos/ inválidos).                                                                             |
| **B2 — Server actions + queries**     | `crearCita` (resuelve `centro_id`, expande grupos snapshot), `editarCita`, `cancelarCita`, `responderInvitacion`, `agregarInvitados`, `quitarInvitado`, `marcarAsistenciaExterno`, `setPreferenciaVistaAgenda`; queries `getCitasRango`/`getCitaDetalle`/`getPreferenciaVistaAgenda`. Reuso de resolutores de grupos F6-C. | tests unit (expansión, idempotencia RSVP, ventana, dedup); `npm run build` (regla `'use server'`).                                         |
| **B3 — Tests RLS (gateados)**         | aislamiento; profe no crea claustro/visita; tutor no crea; no falsear `usuario_id`/responder por otro; solo organizador/admin añaden/quitan; `INSERT…RETURNING` en `citas` (4 tipos) y `cita_invitados`; `preferencias_usuario` self. Gateados por `AGENDA_MIGRATION_APPLIED=1`.                                           | `test:rls` verde **tras** aplicar B0 al remoto.                                                                                            |
| **B4 — UI vistas + alta**             | `/agenda` (layout cross-rol), `VistaToggle` (pref persistida), `AgendaDia`/`AgendaSemana` (rejilla horaria nueva), `AgendaMes` (reusa `<CalendarioMensual/>`, `onClickDia`), `CitaFormDialog` ("+ Nueva cita" / clic-día).                                                                                                 | render + i18n es/en/va sin claves crudas (smoke Playwright).                                                                               |
| **B5 — UI detalle + RSVP + roster**   | `CitaDetalle`, `RsvpControl`, `InvitadosRoster` (recuento, marcar externo, añadir/quitar).                                                                                                                                                                                                                                 | E2E: admin crea `reunion_clase` → tutor ve y acepta → roster actualizado.                                                                  |
| **B6 — Renombrado + nav + i18n**      | label Calendario → "Calendario Escolar" (es/en/va), item de nav "Agenda" → `/agenda`; **F3 intacta**.                                                                                                                                                                                                                      | `npm test` regresión; revisión de claves.                                                                                                  |
| **B7 — Docs + ADR**                   | actualizar `data-model.md`, `rls-policies.md` (helpers/policies Agenda); ADR nuevo (modelo invitación nominal + RSVP; reuso expansión F6-C; separación de `eventos`; excepción DELETE de invitado).                                                                                                                        | docs + ADR escritos.                                                                                                                       |

> **Orden de aplicación de la migración:** B0 se **revisa** primero; el responsable
> la aplica vía SQL Editor (bug SIGILL del CLI) y avisa; entonces `db:types` y se
> desbloquean B3 (RLS) y el build final. Checkpoint C = pre-merge (typecheck/lint/
> test/build/e2e) + preview Vercel verificado por el responsable.

## Referencias

- [ADR-0038](../decisions/ADR-0038-modelo-eventos-y-confirmaciones.md) — cierre F7 y
  re-encuadre difusión vs invitación (Eje 4). Esta spec materializa la **invitación**.
- Spec [f7-calendario.md](./f7-calendario.md) — capa de difusión (`eventos`),
  patrones reutilizados (RLS row-aware, cancelación por estado, audiencia F6-C).
- Spec **f7a-calendario-agenda.md** (PR #50) — **superada**: su Dominio B se limpia y
  concreta aquí; el Dominio A es F7 (ya cerrado); el Dominio C (Inicio "Hoy") queda
  como follow-up aparte. PR #50 se cierra como superado por ADR-0038 + esta spec.
- [reminders-c.md](./reminders-c.md) / ADR-0037 — resolutores de grupos/audiencia
  reutilizados para la expansión de invitados.
- `rls-policies.md` — gotcha MVCC y patrón row-aware; `data-model.md` — modelo.

---

**Workflow:** Checkpoint A **cerrado** (decisiones fijadas) → **Checkpoint B por
sub-pasos** (B0–B7, ver plan) tras OK del responsable al plan → Checkpoint C
(pre-merge + preview verificado por el responsable).
