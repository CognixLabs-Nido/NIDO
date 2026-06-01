---
feature: f7-calendario
wave: 1
status: approved
last_updated: 2026-06-01
related_adrs: [ADR-0014, ADR-0019, ADR-0023, ADR-0024, ADR-0027, ADR-0037]
related_specs: [scope-ola-1, school-calendar, reminders-c, messaging, push-notifications]
---

# Spec — F7: Calendario y eventos (LEAN)

> **Checkpoint B.** Decisiones cerradas por el responsable (ver sección final). El schema se **refina** a partir de lo ya declarado en `data-model.md` (tablas `eventos` y `confirmaciones_evento`, hoy ⏳) y de los patrones de F4.5a/F5/F6 — no se inventa de cero.

## Resumen ejecutivo

El centro publica **eventos** (excursión, reunión, fiesta, vacaciones…) sobre un calendario, y las familias afectadas **confirman asistencia**. Es la capa de "qué pasa y cuándo" que faltaba: comunicación con fecha + acción de la familia, reutilizando el calendario de F4.5a, el patrón pase-de-lista de F4 y el canal push de F5.5.

## Contexto

F6 cerró recordatorios (mensajes accionables sin fecha fija sobre el calendario visual). F7 añade el **eje temporal**: eventos anclados a una fecha (o rango), visibles en el calendario mensual, con confirmación de asistencia para los eventos que la requieren (excursiones, reuniones). Es la **Fase 7 LEAN** según `scope-ola-1.md`: calendario + eventos + confirmaciones. La **reserva de franjas para tutorías queda explícitamente fuera (Ola 3)**.

NIDO ya tiene piezas reutilizables que F7 debe aprovechar sin duplicar:

- **`<CalendarioMensual/>`** (`src/shared/components/calendario/`) — grid mensual genérico controlado; el padre decide `renderDia`. No hace fetch ni conoce el dominio. F7 pinta los eventos del mes en cada celda.
- **Calendario del centro F4.5a** (`dias_centro` + `src/features/calendario-centro/`) — ya hay rutas `/{admin,teacher,family}/calendario` mostrando festivos/cierres. Los eventos se **superponen** a esa misma vista.
- **`<PaseDeListaTable/>`** (`src/shared/components/pase-de-lista/`, ADR-0014) — su docstring ya cita "F7 (confirmaciones)" como reuso previsto. Sirve para que admin/profe vean el roster de confirmaciones de un aula.
- **`expandirDestinatariosRecordatorio`** (`src/features/recordatorios/lib/audiencia.ts`, F6-C) — calcula destinatarios push por niño/aula/centro respetando `puede_recibir_mensajes`. La audiencia de un evento mapea 1:1 a esos tres ámbitos.
- **`enviarPushANotificarUsuarios`** (`src/features/push/lib/enviar-push.ts`, F5.5) — pipeline push best-effort.

## User stories

- US-01: Como **admin**, quiero crear un evento de centro o de aula con fecha y descripción para que las familias afectadas lo vean en su calendario.
- US-02: Como **profe**, quiero crear un evento para mi aula (excursión, reunión) para avisar a sus familias sin pasar por dirección.
- US-03: Como **tutor**, quiero ver en mi calendario los eventos que afectan a mi hijo y al centro, con su detalle (fecha, hora, lugar).
- US-04: Como **tutor**, quiero **confirmar (o rechazar) la asistencia** de mi hijo a un evento que lo requiere, para que el centro sepa con cuántos niños contar.
- US-05: Como **admin/profe**, quiero ver el **roster de confirmaciones** de un evento (quién confirmó, quién falta) para organizar la actividad.
- US-06: Como **tutor**, quiero **recibir una notificación push** cuando se publica o cambia un evento que me afecta, para no perdérmelo con la app cerrada.

## Alcance

**Dentro (F7 LEAN):**

- Tabla `eventos` con ámbito centro / aula / niño, tipo, fecha (o rango), campos opcionales (hora, lugar) y flag de "requiere confirmación".
- Tabla `confirmaciones_evento` con el estado de asistencia por evento.
- Vista calendario con eventos superpuestos (reusa `<CalendarioMensual/>` y las rutas de F4.5a).
- Detalle de evento + acción de confirmación de la familia.
- Roster de confirmaciones para staff (reusa `<PaseDeListaTable/>`).
- Push a familias afectadas al crear/editar (reusa F5.5/F6-C; cableado aunque el canal esté pendiente de fix).
- RLS de creación (admin/profe), confirmación (familia) y aislamiento por centro.
- Audit log de `eventos` (trigger automático).

**Fuera (no se hace aquí):**

- **Reserva de franjas para tutorías** → **Ola 3** (decisión cerrada en `scope-ola-1.md`).
- **Calendario reutilizable curso siguiente** → Ola 3.
- **Eventos recurrentes** (cron/recurrencia) → fuera; cada evento es una fila. (Recuerda los ADR-0017/0018 descartados: nada de motores de recurrencia.)
- **Adjuntos en eventos** (PDF de circular, etc.) → decisión abierta; por defecto fuera del LEAN (Storage llega en F10).
- **Recordatorio automático pre-evento** (push X días antes) → fuera; `recordatorios.evento_id` está previsto como `ALTER TABLE ADD COLUMN` futuro (ver data-model.md, 🔒 D8), no se cablea en F7.
- Sincronización con calendarios externos (iCal/Google) → fuera.

## Comportamientos detallados

### Comportamiento 1: crear evento

**Pre-condiciones:** usuario es admin del centro (cualquier ámbito) o profe (solo ámbito `aula` sobre su aula activa) — misma matriz que `anuncios` en F5.

**Flujo:**

1. Admin/profe abre el formulario (desde el calendario o un botón "Nuevo evento").
2. Elige **tipo** (excursión, reunión, fiesta, vacaciones, otro — _decisión abierta D1_), **ámbito** (centro/aula/niño), **fecha** (o rango _D6_), campos opcionales (hora inicio/fin, lugar _D5_), y si **requiere confirmación**.
3. Server action `crearEvento` valida con Zod, **resuelve `centro_id` explícitamente** (del niño/aula/usuario; **nunca sentinel**, ver `db-triggers.md`), e inserta.
4. RLS `WITH CHECK` autoriza según ámbito y rol.
5. Tras el INSERT, **push best-effort** a la audiencia (Comportamiento 5).

**Post-condiciones:** fila en `eventos`; evento visible en el calendario de la audiencia; push encolado.

### Comportamiento 2: ver eventos en el calendario

**Flujo:**

1. La ruta `/{rol}/calendario` carga `dias_centro` (F4.5a) **y** los eventos del mes visible para el usuario (RLS filtra por audiencia).
2. `<CalendarioMensual/>` pinta cada celda; `renderDia` muestra punto/badge por evento (color por `tipo`).
3. Click en un día con eventos → lista de ese día → detalle.

**Post-condiciones:** ninguna (solo lectura).

### Comportamiento 3: detalle de evento + confirmación de la familia

**Pre-condiciones:** el usuario es audiencia del evento. El evento tiene `requiere_confirmacion = true`.

**Flujo (tutor):**

1. Tutor abre el detalle → ve fecha, hora, lugar, descripción.
2. Si requiere confirmación, ve el control de confirmar/rechazar **por su(s) hijo(s) afectado(s)** (_granularidad D2_).
3. `confirmarEvento` hace `UPSERT` en `confirmaciones_evento` (idempotente; patrón "USING falso → 0 filas" + `.select().maybeSingle()` como F5.6-B/F6).
4. La confirmación es editable hasta la fecha del evento (_ventana D12_).

**Post-condiciones:** fila/estado en `confirmaciones_evento`; el roster del staff lo refleja (Realtime opcional, _D11_).

### Comportamiento 4: roster de confirmaciones (staff)

**Flujo:** admin/profe abre el detalle de un evento de aula/centro → `<PaseDeListaTable/>` read-only con los niños de la audiencia como filas y su estado de confirmación (confirmado / rechazado / pendiente) como columna. Sin edición por el staff (la familia confirma; el staff observa).

### Comportamiento 5: notificación push al crear/editar

**Flujo:** idéntico al de `crearRecordatorio` (F6-C):

1. Tras INSERT/UPDATE exitoso, se calcula la audiencia push.
2. Se reutiliza `expandirDestinatariosRecordatorio` mapeando `evento.ambito → destinatario`: `nino → familia_individual`, `aula → familias_aula`, `centro → familias_centro` (**cero duplicación**; si en el futuro divergen, se extrae el helper de bajo nivel a `features/push/lib`).
3. `enviarPushANotificarUsuarios(destinatarios, { titulo, cuerpo, url: '/{idioma}/calendario...', datos: { tipo: 'evento', evento_id } })`.
4. Best-effort: se `await`ea (la lambda no termina antes) pero un fallo no rompe la operación (try/catch + `console.error`).

### Comportamiento 6: editar / cancelar evento

**Flujo:** solo el autor (_¿y admin? D8_) edita. La **cancelación** sigue el patrón del proyecto: marcar con prefijo / flag en vez de DELETE (_mecanismo exacto D7_). Editar una fecha o cancelar **re-notifica** a la audiencia.

## Casos edge

- **Sin eventos en el mes**: el calendario muestra solo `dias_centro`; lista vacía con estado "sin eventos".
- **Sin permisos**: un tutor que abre el id de un evento que no le corresponde → RLS no lo devuelve → 404/forbidden (como mensajería).
- **Evento de aula y el niño cambia de aula**: la audiencia se calcula por **matrícula activa** en el momento del push y de la query (igual que F6-C). Un niño que ya no está en el aula deja de verlo.
- **Confirmar fuera de plazo**: si la confirmación cierra en la fecha del evento, intentos posteriores → mensaje de plazo cerrado (gotcha "USING falso → 0 filas").
- **Doble confirmación / carrera**: `UPSERT` idempotente; dos tutores del mismo niño → la última gana, sin 500 (patrón ADR-0036).
- **Tutor con `puede_recibir_mensajes = false`**: ve el evento in-app (visibilidad por pertenencia) pero _¿recibe push? D4_.
- **Rango de fechas que cruza meses** (vacaciones): el evento aparece en todas las celdas del rango (_si se acepta rango, D6_).
- **Idiomas**: fechas/horas formateadas con `Intl` por locale (es-ES/en-GB/ca-ES), como `<CalendarioMensual/>` ya hace.
- **Soft delete / cancelado**: un evento cancelado se muestra tachado/atenuado, no desaparece (trazabilidad).

## Validaciones (Zod)

```typescript
// Refinable en Checkpoint B. Valores de enum sujetos a D1.
export const tipoEventoEnum = z.enum(['excursion', 'reunion', 'fiesta', 'vacaciones', 'otro'])
export const ambitoEventoEnum = z.enum(['centro', 'aula', 'nino'])

export const crearEventoSchema = z
  .object({
    tipo: tipoEventoEnum,
    ambito: ambitoEventoEnum,
    aula_id: z.string().uuid().nullable(),
    nino_id: z.string().uuid().nullable(),
    titulo: z.string().min(1).max(200, 'eventos.errors.titulo_largo'),
    descripcion: z.string().max(2000, 'eventos.errors.descripcion_larga').optional(),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'eventos.errors.fecha_invalida'),
    // fecha_fin / hora_* / lugar dependen de D5/D6
    requiere_confirmacion: z.boolean().default(false),
  })
  // coherencia ámbito ↔ referencia (igual que el CHECK de anuncios)
  .refine((d) => d.ambito !== 'aula' || !!d.aula_id, { message: 'eventos.errors.aula_requerida' })
  .refine((d) => d.ambito !== 'nino' || !!d.nino_id, { message: 'eventos.errors.nino_requerido' })

export const confirmarEventoSchema = z.object({
  evento_id: z.string().uuid(),
  nino_id: z.string().uuid(), // o usuario_id según D2
  estado: z.enum(['confirmado', 'rechazado']),
  comentario: z.string().max(500).optional(),
})
```

## Modelo de datos afectado

**Tablas nuevas (migración ADITIVA — no existen, `CREATE`, nunca drop+recreate):**

### `eventos`

| Columna                    | Tipo                                   | Notas                                                                                                |
| -------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `id`                       | uuid PK                                | `gen_random_uuid()`                                                                                  |
| `centro_id`                | uuid NOT NULL FK→`centros`             | derivado **explícito** en el action (no sentinel; ver `db-triggers.md`). Redundante para RLS simple. |
| `ambito`                   | `ambito_evento` NOT NULL               | ENUM `centro`/`aula`/`nino`                                                                          |
| `aula_id`                  | uuid NULL FK→`aulas` ON DELETE CASCADE | obligatorio si `ambito='aula'`                                                                       |
| `nino_id`                  | uuid NULL FK→`ninos` ON DELETE CASCADE | obligatorio si `ambito='nino'`                                                                       |
| `tipo`                     | `tipo_evento` NOT NULL                 | ENUM (D1)                                                                                            |
| `titulo`                   | text NOT NULL                          | CHECK 1..200 (+ margen prefijo si cancelación por prefijo, D7)                                       |
| `descripcion`              | text NULL                              | CHECK ≤ 2000                                                                                         |
| `fecha`                    | date NOT NULL                          | día del evento                                                                                       |
| `fecha_fin`                | date NULL                              | solo si se acepta rango (D6); CHECK `fecha_fin >= fecha`                                             |
| `hora_inicio` / `hora_fin` | time NULL                              | opcionales (D5)                                                                                      |
| `lugar`                    | text NULL                              | opcional (D5); CHECK ≤ 200                                                                           |
| `requiere_confirmacion`    | boolean NOT NULL default false         |                                                                                                      |
| `estado` o `erroneo`       | enum/boolean                           | cancelación (D7)                                                                                     |
| `creado_por`               | uuid NOT NULL FK→`usuarios`            | `auth.uid()`                                                                                         |
| `created_at`/`updated_at`  | timestamptz                            | trigger `set_updated_at`                                                                             |

**CHECK estructural** `eventos_ambito_coherencia` (espejo de `anuncios`): `ambito='nino' ⇒ nino_id NOT NULL AND aula_id NULL`; `ambito='aula' ⇒ aula_id NOT NULL AND nino_id NULL`; `ambito='centro' ⇒ ambos NULL`.

### `confirmaciones_evento`

| Columna                   | Tipo                                         | Notas                                                        |
| ------------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| `id`                      | uuid PK                                      |                                                              |
| `evento_id`               | uuid NOT NULL FK→`eventos` ON DELETE CASCADE |                                                              |
| `nino_id`                 | uuid NULL FK→`ninos`                         | si confirmación por niño (D2)                                |
| `usuario_id`              | uuid NOT NULL FK→`usuarios`                  | tutor que confirma                                           |
| `estado`                  | `confirmacion_estado` NOT NULL               | ENUM `confirmado`/`rechazado` (pendiente = ausencia de fila) |
| `comentario`              | text NULL                                    | opcional, CHECK ≤ 500                                        |
| `created_at`/`updated_at` | timestamptz                                  |                                                              |

**UNIQUE**: `(evento_id, nino_id)` si confirmación por niño, o `(evento_id, usuario_id)` si por familia (**D2**).

**ENUMs nuevos:** `ambito_evento`, `tipo_evento`, `confirmacion_estado`.

**Tablas consultadas:** `ninos`, `aulas`, `matriculas`, `vinculos_familiares`, `roles_usuario`, `dias_centro` (overlay calendario).

**Realtime:** opcional para el badge/roster en vivo (D11). Por defecto, igual que `anuncios`/`recordatorios`, publicar `eventos` y `confirmaciones_evento` y dejar que la RLS de SELECT filtre.

## Políticas RLS

Principios del proyecto: **default DENY**, helpers `SECURITY DEFINER STABLE` en `public.*`, **helper row-aware** para evitar el gotcha MVCC en `INSERT…RETURNING` (el action hace `.insert().select('id')`).

```sql
-- SELECT: row-aware (recibe los campos del row, NO re-lee `eventos`)
CREATE FUNCTION public.usuario_es_audiencia_evento_row(
  p_centro_id uuid, p_ambito public.ambito_evento, p_aula_id uuid, p_nino_id uuid
) RETURNS boolean ...;  -- admin del centro · profe de aula/centro · tutor por ámbito

CREATE POLICY eventos_select ON public.eventos FOR SELECT
  USING (public.usuario_es_audiencia_evento_row(centro_id, ambito, aula_id, nino_id));
```

- **`eventos` INSERT**: `creado_por = auth.uid() AND (es_admin(centro_id) OR (ambito='aula' AND es_profe_de_aula(aula_id) AND centro_de_aula(aula_id)=centro_id))`. Profe solo ámbito aula sobre su aula (igual que `anuncios`).
- **`eventos` UPDATE**: solo el autor (¿y admin? **D8**), `USING + WITH CHECK` simétricos. Server action limita columnas (editar campos / cancelar).
- **`eventos` DELETE**: SIN policy → default DENY. Cancelación con `estado`/prefijo (D7).
- **`confirmaciones_evento` SELECT**: la familia ve las suyas (`usuario_id = auth.uid()` o tutor del `nino_id`); admin/profe ven las de eventos de su ámbito.
- **`confirmaciones_evento` INSERT/UPDATE**: solo tutor del niño afectado **y** que es audiencia del evento; `usuario_id = auth.uid()` (anti-suplantación). `UPSERT` idempotente.
- **`confirmaciones_evento` DELETE**: default DENY (cambiar a `rechazado` en vez de borrar).

> **Tests RLS bloqueantes** por las reglas del proyecto: aislamiento entre aulas, entre familias, y `INSERT…RETURNING` en los 3 ámbitos (confirma que el helper row-aware no rompe).

## Pantallas y rutas

- `/{admin,teacher,family}/calendario` — **se extienden** las rutas de F4.5a para superponer eventos sobre `dias_centro`. (_¿ruta `/eventos` separada o todo en `/calendario`? D10_).
- Detalle de evento — sub-vista/modal desde el calendario (no necesariamente ruta propia).
- `admin/teacher`: formulario "Nuevo evento" + roster de confirmaciones en el detalle.
- `family`: detalle + control de confirmación.

## Componentes UI

- `EventoFormDialog.tsx` (Client) — crear/editar, RHF + Zod (patrón `RecordatorioFormDialog`).
- `CalendarioConEventos.tsx` (Client) — envuelve `<CalendarioMensual/>` y pinta eventos por celda.
- `EventoDetalle.tsx` (Server/Client) — info + (familia) confirmación + (staff) roster.
- `ConfirmacionEventoControl.tsx` (Client) — confirmar/rechazar por niño.
- Roster: reuso directo de `<PaseDeListaTable/>` read-only.
- Query: `getEventosMes(centroId, mes, anio)` (Server) con índice `(centro_id, fecha)`.

## Eventos y notificaciones

- **Push**: al crear/editar/cancelar evento → familias afectadas vía `enviarPushANotificarUsuarios` (reuso F5.5/F6-C). Cableado aunque el canal esté pendiente de fix (push-a-device es bloqueante temprano de Ola 1, `scope-ola-1.md`).
- **Audit**: trigger automático en `eventos` (rama nueva en `audit_trigger_function`, `centro_id` directo). `confirmaciones_evento` **no se audita** (telemetría, como `lectura_*` y `push_subscriptions`) — _confirmar en D_.

## i18n

Namespace `eventos.*` en `messages/{es,en,va}.json`: tipos de evento, ámbitos, estados de confirmación, labels de formulario, errores de validación, textos de calendario. Trilingüe obligatorio (Regla #7).

## Accesibilidad

- `<CalendarioMensual/>` ya trae grid ARIA + navegación con teclado; los eventos por celda deben anunciarse (`aria-label` de la celda incluye nº de eventos).
- Control de confirmación con roles ARIA y foco gestionado.
- Roster reusa la a11y de `<PaseDeListaTable/>`.

## Performance

- `getEventosMes` con índice `(centro_id, fecha)`; rango del mes visible (no todo el histórico).
- Audiencia push acotada (centro pequeño tipo ANAIA; el helper de F6-C ya es suficiente).

## Telemetría

- `evento_creado`, `evento_confirmado` (sin PII).

## Tests requeridos

**Vitest (unit/integration):**

- [ ] `crearEventoSchema` / `confirmarEventoSchema` validan correctos e incorrectos (incl. coherencia ámbito↔referencia).
- [ ] `crearEvento` resuelve `centro_id` explícito y retorna `success`/`fail` tipados.
- [ ] Mapeo `ambito → destinatario` y reuso de `expandirDestinatariosRecordatorio` (audiencia correcta por ámbito; excluye autor; respeta flag según D4).
- [ ] `confirmarEvento` es idempotente (doble confirmación, carrera).
- [ ] Trigger audit registra INSERT/UPDATE de `eventos`.

**Vitest (RLS):**

- [ ] Tutor de niño X no ve eventos de ámbito niño de Y; profe de aula A no ve/crea eventos de aula B; aislamiento por centro.
- [ ] `INSERT…RETURNING` de evento en los 3 ámbitos NO falla por MVCC (helper row-aware).
- [ ] Tutor no puede confirmar por un niño que no es suyo; no puede falsear `usuario_id`.
- [ ] Profe no puede crear ámbito centro; familia no puede crear eventos.

**Playwright (E2E):**

- [ ] Admin crea evento de centro → familia lo ve en su calendario y confirma → admin ve el roster actualizado.

## Criterios de aceptación

- [ ] Tests arriba en verde en CI.
- [ ] 3 lenguas completas (es/en/va).
- [ ] Funciona en iOS Safari 16.4+ y Chrome Android.
- [ ] `data-model.md` actualizado (tablas `eventos`/`confirmaciones_evento` → ✅ con su detalle).
- [ ] ADR(s) escritos (modelo de ámbito/confirmación, reuso de audiencia).
- [ ] Migración ADITIVA aplicada al remoto vía **SQL Editor** (bug SIGILL del CLI) y registrada en `schema_migrations`.

## Decisiones técnicas relevantes (→ ADR tras aprobación)

- Reuso de `expandirDestinatariosRecordatorio` vs helper push propio.
- Modelo de ámbito (espejo de `anuncios`) y granularidad de confirmación.
- Mecanismo de cancelación (estado vs erróneo+prefijo).

## Migración

- **ADITIVA**: `CREATE TYPE` (3 enums) + `CREATE TABLE eventos`, `confirmaciones_evento` + índices + RLS + triggers (audit, `set_updated_at`, y `eventos_set_centro_id` opcional) + publicación Realtime. **No** hay drop+recreate (las tablas no existen).
- Nombre tentativo: `supabase/migrations/2026XXXXXXXXXX_phase7_eventos.sql`.
- Aplicación **manual por el responsable vía SQL Editor** (bug SIGILL del CLI en este Chromebook). Tras aplicar: `db:types`, `typecheck`, tests RLS.

---

## ✅ Decisiones cerradas (responsable, 2026-06-01)

- **D1 — Tipos de evento.** ENUM `tipo_evento` = `excursion` · `reunion` · `fiesta` · `vacaciones` · `otro`.
- **D2 — Confirmación POR NIÑO.** UNIQUE `(evento_id, nino_id)`. La fila guarda `confirmado_por` + `confirmado_at`. **Cualquier tutor del niño** puede ponerla/cambiarla, **last-write-wins** (UPSERT idempotente).
- **D3 — Sin multi-aula.** Ámbito = `nino` | `aula` | `centro` (un evento de aula apunta a 1 aula).
- **D4 — Push respeta `puede_recibir_mensajes`** (igual que F6-C, vía `expandirDestinatariosRecordatorio`).
- **D5 — Opcionales:** `lugar` y `hora` (inicio/fin) **SÍ**. Adjuntos **NO** (Storage es F10).
- **D6 — Rango:** `fecha_fin` nullable (CHECK `>= fecha`); hora opcional.
- **D7 — Cancelación:** ENUM `evento_estado` = `programado` | `cancelado` (no se borra; se muestra cancelado). **Cancelar NOTIFICA por push a quien ya había confirmado** (no es un flip silencioso).
- **D8 — Edita/cancela:** el **autor o un admin** del centro.
- **D9 — Confirmación 3 estados:** ENUM `confirmacion_estado` = `pendiente` | `confirmado` | `rechazado`. `pendiente` = ausencia de fila (la fila almacena `confirmado`/`rechazado`); el ENUM incluye los 3 para el view-model del roster.
- **D10 — Ruta:** overlay sobre `/calendario` (reusa F4.5a). Sin ruta `/eventos` separada.
- **D11 — Sin Realtime** (fuera del LEAN).
- **D12 — Ventana de confirmación:** hasta la **fecha (inicio)** del evento.
- **D13 — `confirmaciones_evento` NO se audita** (telemetría, como `lectura_*`/`push_subscriptions`).

> **Límite explícito (D13):** la confirmación de F7 es **asistencia ligera**, NO autorización legal. No lleva firma ni se trata como consentimiento — eso es **F8** (autorizaciones + firma digital). F7 no cruza esa línea.

> **Nota de implementación:** D7 introduce un ENUM `evento_estado` adicional a los 3 de la spec original (`ambito_evento`, `tipo_evento`, `confirmacion_estado`) → **4 ENUMs** en la migración. Es la forma coherente con el proyecto (ENUM para columnas de valores fijos) de materializar `estado='cancelado'`.
