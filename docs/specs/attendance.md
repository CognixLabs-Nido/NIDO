---
feature: attendance
wave: 1
phase: 4
status: draft
priority: critical
last_updated: 2026-05-15
related_adrs: [ADR-0014, ADR-0015, ADR-0016]
related_specs: [daily-agenda, core-entities]
---

# Spec — Asistencia + ausencias (Fase 4)

> Doble objetivo: cubrir asistencia/ausencias funcionalmente Y construir el patrón reutilizable **"Pase de Lista"** que Fase 4.5 (menús), Fase 7 (confirmaciones de eventos) y futuras fases reusarán sin diseñarlo de cero.

## Resumen ejecutivo

Dos tablas operativas: **`asistencias`** (estado del niño en el día — pase de lista por la profe) y **`ausencias`** (notificación previa de la familia o registro retrospectivo por la profe/admin). La asistencia es **lazy**: no se pre-crean filas, solo aparecen al pasar lista. El query del pase de lista hace JOIN con las ausencias activas del día para pre-marcar al niño como ausente con badge "Reportado por familia". Ventana de edición = mismo día calendario hora Madrid (reusa helper de Fase 3). Admin no edita histórico desde UI. La spec introduce el componente compartido **`<PaseDeListaTable />`** y el hook `usePaseDeListaForm` en `src/shared/components/pase-de-lista/`, pensados como API genérica reusable.

## Contexto

La asistencia es información operacional crítica: ratios alumnos/profe, cumplimiento contractual, prevención de descuidos (un niño marcado como presente que no llegó al centro es una emergencia). Hasta ahora ANAIA llevaba un cuaderno en papel. La asistencia diaria también dispara, en fases posteriores, el cálculo de cuotas (Ola 2) y los informes mensuales (Fase 9).

La forma de pasar lista (tabla con todos los niños, click rápido por niño) se repetirá en F4.5 (comida), F7 (confirmación de evento), y posiblemente F10 (etiquetar niños en publicaciones). Por eso F4 hace doble trabajo: implementar asistencia Y dejar el componente listo.

## User stories

- **US-26:** Como **profe**, quiero abrir el pase de lista de mi aula del día actual, marcar a todos los niños con "presente" de un click y ajustar solo las excepciones (uno llegó tarde, otra no vino), todo en una sola pantalla.
- **US-27:** Como **profe**, quiero ver el pase de lista pre-marcado con las ausencias que la familia ha reportado con antelación, sin tener que cruzar listas.
- **US-28:** Como **profe**, quiero que la app me impida editar el pase de lista de días pasados para que el registro sea inalterable.
- **US-29:** Como **tutor legal con permiso de agenda**, quiero reportar la ausencia de mi hijo con antelación (ej. cita médica el viernes) y poder modificarla mientras la fecha sea futura.
- **US-30:** Como **tutor legal**, quiero ver el histórico de ausencias y asistencias de mi hijo (presencia, llegada tarde, motivo de ausencia).
- **US-31:** Como **admin del centro**, quiero ver en el dashboard cuántos niños han llegado / faltan / quedan pendientes de marcar, en vivo, para coordinar incidencias.
- **US-32:** Como **auditor / DPD**, quiero que cada INSERT/UPDATE en asistencias y ausencias quede en `audit_log` con `centro_id`, `usuario_id` y diff antes/después.

## Alcance

**Dentro:**

- 2 tablas nuevas (`asistencias`, `ausencias`) + 2 ENUMs (`estado_asistencia`, `motivo_ausencia`).
- Políticas RLS por tabla (SELECT/INSERT/UPDATE; DELETE bloqueado a todos).
- Audit log automático en ambas tablas (heredando `audit_trigger_function()`).
- Realtime habilitado en ambas tablas.
- Componente compartido **`<PaseDeListaTable />`** + hook `usePaseDeListaForm` en `src/shared/components/pase-de-lista/` con tests unitarios.
- Server actions: `upsert-asistencia`, `batch-upsert-asistencias`, `crear-ausencia`, `actualizar-ausencia`, `cancelar-ausencia`.
- Queries: `get-pase-de-lista-aula` (con JOIN a ausencias), `get-ausencias-nino`, `get-resumen-asistencia-centro` (dashboard admin).
- UI profe `/teacher/aula/[id]/asistencia` con el `<PaseDeListaTable />` + Realtime.
- UI familia: sección "Ausencias" en `/family/nino/[id]` (gated por `puede_ver_agenda`), con lista + form de reportar.
- UI admin: card resumen en `/admin` con counts por aula del día actual (Realtime).
- i18n trilingüe (es/en/va).
- ADRs 0014 y 0015.
- Tests RLS (≥6), audit (≥1), unit (schemas + hook), Playwright E2E (≥3).

**Fuera (no se hace aquí):**

- **Comida / pase de lista de comida** — Fase 4.5, reusará `<PaseDeListaTable />`.
- **Notificaciones push** ("tu hija ha llegado", "no se ha pasado lista a tu hijo") — Fase 5.
- **Cálculo de cuotas según asistencia** — Ola 2.
- **Informes/estadísticas de asistencia** (porcentaje mensual, comparativas) — Fase 9.
- **Asistencia con check-in vía QR de los padres al dejar al niño** — Ola 2 / 3.
- **Tabla `asistencias_personal`** (registro horario de profes) — fuera de Ola 1 (CLAUDE.md `scope-ola-1.md`).
- **Geolocalización / proximidad** — fuera.
- **Pre-creación nocturna de asistencias** (job cron) — descartada conscientemente (ver ADR-0015).

## Comportamientos detallados

### B26 — Apertura del pase de lista por la profe

**Pre-condiciones:**

- Usuario autenticado con rol `profe` y `profes_aulas` activo sobre el aula.
- Curso del aula `activo`.

**Flujo:**

1. Ruta `/teacher/aula/[id]/asistencia?fecha=YYYY-MM-DD`. Default fecha = hoy hora Madrid.
2. Server query `getPaseDeListaAula(aulaId, fecha)`:
   - Listar niños matriculados activos en el aula y curso activo.
   - `LEFT JOIN` a `asistencias` filtrada por `(nino_id, fecha)` → si existe, recuperar `estado`, `hora_llegada`, `hora_salida`, `observaciones`.
   - `LEFT JOIN` a `ausencias` activas en la fecha (`fecha_inicio <= fecha AND fecha_fin >= fecha`) → si existe, recuperar `motivo` para el badge.
3. Por cada niño, derivar `estado_inicial`:
   - Si hay fila en `asistencias` → usarla tal cual.
   - Sino, si hay ausencia activa para el día → pre-marcar `estado='ausente'`, mostrar badge "Reportado por familia · {motivo}".
   - Sino → fila "pendiente" (sin estado).
4. Render del `<PaseDeListaTable />` con `items` = lista de niños + sus datos pre-cargados.
5. Subscription Realtime al canal `asistencias-aula-${aulaId}` para refrescar si otra profe o admin guarda cambios.

**Post-condiciones:**

- Profe ve estado actual sin recargar.

### B27 — Pase de lista: marcar a todos presentes + ajustes

**Pre-condiciones:**

- `dentro_de_ventana_edicion(fecha) = TRUE`.

**Flujo:**

1. Profe pulsa quick action "Marcar todos presentes" → todas las filas se rellenan con `estado='presente'`, `hora_llegada` = hora actual (HH:MM hora Madrid) si la fila no la tenía.
2. Profe ajusta excepciones inline: cambia un niño a `llegada_tarde` con `hora_llegada=09:35`, marca otro como `ausente`, deja observaciones en un tercero.
3. Profe pulsa "Guardar pase de lista" → server action `batchUpsertAsistencias(filas_tocadas)`:
   - Itera y hace `INSERT ... ON CONFLICT (nino_id, fecha) DO UPDATE` por cada fila.
   - Setea `registrada_por = auth.uid()`.
   - Todo en una transacción server-side (Supabase no expone transacciones explícitas en supabase-js, pero el batch de UPSERTs por defecto se ejecuta en una; ver implementación).
4. Audit triggers graban INSERT/UPDATE por fila.
5. Realtime broadcast → admin dashboard, familia (si hay subscription en la ficha del niño), otras profes del aula ven cambios.
6. Toast "Pase de lista guardado · N niños".

**Errores:**

- Si la ventana se cierra entre apertura y submit (cambia el día a las 00:00), la RLS rechaza el INSERT/UPDATE → server action devuelve `{success:false, error:'asistencia.errors.fuera_de_ventana'}`. UI muestra toast y refresca a estado read-only.
- Si una fila concreta falla (UNIQUE violation porque alguien ya guardó en paralelo) → la acción reporta éxito parcial y refresca la lista con valores actualizados.

### B28 — Edición individual de una asistencia

Profe puede editar una sola fila (en vez de batch) tocando solo esa fila y pulsando Enter / blur → server action `upsertAsistencia(ninoId, fecha, patch)`. Comportamiento idéntico salvo el alcance (1 fila vs N).

### B29 — Ventana de edición (RLS-enforced)

A las 00:00 hora Madrid del día siguiente:

- RLS de INSERT/UPDATE en `asistencias` rechaza para `fecha != hoy`.
- UI muestra inputs `disabled` + badge "Día cerrado" en el DayPicker.
- Admin **tampoco edita histórico de asistencia desde UI** (coherencia con ADR-0013). Para corrección, vía SQL con `service_role` (queda en `audit_log`).

### B30 — Familia reporta ausencia con antelación

**Pre-condiciones:**

- Tutor autenticado con `vinculos_familiares` al niño y `permisos.puede_ver_agenda = true`.
- Ruta `/family/nino/[id]` con sección "Ausencias" visible.

**Flujo:**

1. Tutor pulsa "Reportar ausencia" → modal con form:
   - `fecha_inicio` (date, default hoy Madrid).
   - `fecha_fin` (date, default = `fecha_inicio`).
   - `motivo` (radio: enfermedad / cita_medica / vacaciones / familiar / otro).
   - `descripcion` (textarea opcional, ≤500 chars).
2. Validación cliente Zod (`fecha_fin >= fecha_inicio`, motivo enum válido).
3. Submit → server action `crearAusencia(input)`:
   - RLS valida: tutor del niño + flag + `fecha_inicio >= today`.
   - `reportada_por = auth.uid()`.
   - INSERT.
4. Trigger audit graba INSERT.
5. Realtime broadcast → si la profe del aula tiene `/teacher/aula/[id]/asistencia` abierto, su pase de lista se refresca y pre-marca al niño como ausente con el badge.
6. Toast "Ausencia reportada".

### B31 — Familia edita o cancela ausencia futura

- **Editar**: tutor pulsa "Editar" en una ausencia con `fecha_inicio >= hoy`. Form pre-rellenado. Submit → `actualizarAusencia(id, patch)`. RLS valida `fecha_inicio >= today` también sobre la fila pre-existente.
- **Cancelar**: tutor pulsa "Cancelar ausencia". Como DELETE está bloqueado por RLS, **cancelación = UPDATE con `descripcion = '[cancelada] ' || COALESCE(descripcion, '')`** (mismo patrón que el "marcar como erróneo" de Fase 3) y la query oculta visualmente las canceladas o las muestra con badge. **Decisión de UX:** mostrarlas atenuadas con badge "Cancelada" para preservar trazabilidad. Implementación: helper `esCancelada(descripcion)` análogo a `esAnulado()` de Fase 3.

  Las ausencias pasadas no se pueden cancelar ni editar (RLS lo bloquea). Si admin necesita corregir, SQL con `service_role`.

### B32 — Profe registra ausencia retrospectiva

Si una familia avisa por teléfono/mensaje y no usa la app, la profe puede crear la ausencia desde el pase de lista (botón "Reportar ausencia por familia ausente"). Server action `crearAusencia` con `reportada_por = profe.id`. RLS para profe: `INSERT` permitido siempre que sea profe del aula del niño.

La profe **no** puede modificar ausencias de otros (creadas por la familia u otra profe). Sí puede cancelar las que ella misma reportó (ver B35).

### B35 — Profe corrige una ausencia mal reportada (flujo "cancelar + recrear")

**Caso de uso:** la profe reportó ayer una ausencia por "enfermedad" pero al día siguiente la familia aclara que era "cita médica". O reportó las fechas mal.

**Restricción:** la profe **no puede editar** los campos `motivo`, `fecha_inicio`, `fecha_fin`, etc. directamente. Solo puede **cancelar** la ausencia incorrecta (UPDATE con prefijo `[cancelada] ` en `descripcion`) y crear una nueva con los datos correctos. Razón:

- Evita correcciones silenciosas a posteriori (vector de manipulación).
- Coherencia con el patrón "marcar como erróneo" de Fase 3 — los datos operativos no se reescriben, se anulan.
- La trazabilidad queda explícita: ambas filas existen en `audit_log`.

**Flujo:**

1. Profe entra a la ausencia que reportó (vía sección "Ausencias" del niño o vía aviso en el pase de lista).
2. Pulsa "Cancelar ausencia" (mismo Dialog que B31).
3. Server action `cancelarAusencia(id)` → UPDATE de `descripcion` con prefijo `[cancelada] ` (idempotente).
4. La server action valida con Zod que el payload entrante **solo** contiene el campo `descripcion` modificado y que el cambio respeta el prefijo. Rechaza si la profe (vía devtools/manipulación) intenta pasar otros campos.
5. RLS permite el UPDATE porque `reportada_por = auth.uid()`. Audit log captura el diff.
6. Profe pulsa "Reportar ausencia" en la sección y rellena los datos correctos → nuevo INSERT.

**RLS y server action complementarios:** la policy permite UPDATE de cualquier campo si `reportada_por = self`; la server action es quien acota el alcance a "solo cancelación". Esto está documentado explícitamente arriba en §Políticas RLS.

### B33 — Auto-link ausencia → pase de lista

Cuando la profe abre el pase de lista del día X y existe una ausencia activa para el niño Y en ese día (`fecha_inicio <= X <= fecha_fin` y no cancelada), la fila del pase de lista se pre-carga con `estado='ausente'` y se muestra:

- Badge "Ausencia reportada por familia" (o "por profe", según `reportada_por`).
- Sub-badge con el motivo (i18n).
- Tooltip con descripción si la hay.

La profe puede **sobrescribir**: si el niño aparece, marca "presente" y la asistencia gana sobre la ausencia (queda registrada la ausencia como avisada-pero-no-cumplida, lo cual es información operativa válida).

### B34 — Admin: dashboard de asistencia en vivo

Card en `/admin` titulada "Asistencia hoy":

- Por cada aula del centro con curso activo:
  - "Aula X: 12 presentes · 2 ausentes · 4 pendientes".
- Realtime: subscription a `asistencias` filtrada por `centro_id` (vía `centro_de_nino`). Cuando una profe guarda, el contador se actualiza.
- Click en una aula → navega a `/teacher/aula/[id]/asistencia` (admin con rol también puede entrar; si no es profe asignada, ve solo lectura — depende de las RLS, ver §RLS).

## Casos edge

- **Niño con matrícula que cambió de aula a media mañana**: el pase de lista del aula vieja sigue mostrando al niño hasta el día del cambio; al día siguiente aparece en la nueva. No se muestra en dos aulas el mismo día.
- **Profe sin niños matriculados**: muestra empty state "Sin niños matriculados en esta aula".
- **Ausencia que cubre un período largo (ej. 2 semanas de vacaciones)**: el JOIN del pase de lista la detecta en cada día del rango. Si el rango es largo, solo se ve al consultar cada día — el query es por día, no agregado.
- **Tutor sin permiso `puede_ver_agenda`**: no ve sección "Ausencias" ni puede reportar. Mismo gating que agenda (decisión: no proliferar permisos).
- **Doble reporte de ausencia**: si la familia reporta dos ausencias solapadas para el mismo niño, la segunda se acepta (no hay UNIQUE en ausencias). El JOIN del pase de lista muestra la primera que aparezca por orden de inserción.
- **Profe que cambia un "presente" a "ausente" tras haberlo marcado**: UPDATE permitido dentro de ventana. Audit log captura el cambio.
- **Ventana cerrada a media edición** (B27 paso 3 ya descrito): toast + refresh.
- **Sin conexión**: server actions devuelven error genérico, Realtime se reconecta solo.
- **Datos sensibles**: `descripcion` de ausencia puede contener PII ("operación de la mano"). No se cifra; audit log normal. Se elimina retroactivamente si la familia ejerce derecho al olvido (proceso futuro).
- **Cancelación de ausencia (B31)**: las ausencias cancelan via prefijo `[cancelada] ` en descripcion. Mostradas con badge "Cancelada", opacity-50.

## Validaciones (Zod)

Dos schemas en `src/features/asistencia/schemas/asistencia.ts` y `src/features/ausencias/schemas/ausencia.ts`.

```typescript
// asistencia.ts
import { z } from 'zod'

const horaSchema = z.string().regex(/^\d{2}:\d{2}$/, 'asistencia.validation.hora_invalida')
const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'asistencia.validation.fecha_invalida')
const observacionesSchema = z.string().max(500, 'asistencia.validation.observaciones_largas')

export const estadoAsistenciaEnum = z.enum([
  'presente',
  'ausente',
  'llegada_tarde',
  'salida_temprana',
])
export type EstadoAsistencia = z.infer<typeof estadoAsistenciaEnum>

export const asistenciaInputSchema = z
  .object({
    nino_id: z.string().uuid(),
    fecha: fechaSchema,
    estado: estadoAsistenciaEnum,
    hora_llegada: horaSchema.nullable(),
    hora_salida: horaSchema.nullable(),
    observaciones: observacionesSchema.nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.estado === 'presente' && !v.hora_llegada) {
      ctx.addIssue({
        code: 'custom',
        path: ['hora_llegada'],
        message: 'asistencia.validation.requiere_hora_llegada',
      })
    }
    if (v.estado === 'llegada_tarde' && !v.hora_llegada) {
      ctx.addIssue({
        code: 'custom',
        path: ['hora_llegada'],
        message: 'asistencia.validation.requiere_hora_llegada',
      })
    }
    if (v.estado === 'salida_temprana' && !v.hora_salida) {
      ctx.addIssue({
        code: 'custom',
        path: ['hora_salida'],
        message: 'asistencia.validation.requiere_hora_salida',
      })
    }
    if (v.hora_llegada && v.hora_salida && v.hora_salida <= v.hora_llegada) {
      ctx.addIssue({
        code: 'custom',
        path: ['hora_salida'],
        message: 'asistencia.validation.salida_anterior_llegada',
      })
    }
  })

export type AsistenciaInput = z.infer<typeof asistenciaInputSchema>
```

```typescript
// ausencia.ts
import { z } from 'zod'

const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ausencia.validation.fecha_invalida')
const descripcionSchema = z.string().max(500, 'ausencia.validation.descripcion_larga')

export const motivoAusenciaEnum = z.enum([
  'enfermedad',
  'cita_medica',
  'vacaciones',
  'familiar',
  'otro',
])
export type MotivoAusencia = z.infer<typeof motivoAusenciaEnum>

export const ausenciaInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    nino_id: z.string().uuid(),
    fecha_inicio: fechaSchema,
    fecha_fin: fechaSchema,
    motivo: motivoAusenciaEnum,
    descripcion: descripcionSchema.nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.fecha_fin < v.fecha_inicio) {
      ctx.addIssue({
        code: 'custom',
        path: ['fecha_fin'],
        message: 'ausencia.validation.fecha_fin_anterior',
      })
    }
  })

export type AusenciaInput = z.infer<typeof ausenciaInputSchema>

export const PREFIX_CANCELADA = '[cancelada] '
export function esCancelada(descripcion: string | null | undefined): boolean {
  return Boolean(descripcion && descripcion.startsWith(PREFIX_CANCELADA))
}
```

## Modelo de datos afectado

**Tablas nuevas:**

1. **`asistencias`**
   - `id uuid PK DEFAULT gen_random_uuid()`
   - `nino_id uuid NOT NULL REFERENCES ninos ON DELETE RESTRICT`
   - `fecha date NOT NULL`
   - `estado estado_asistencia NOT NULL`
   - `hora_llegada time NULL`
   - `hora_salida time NULL`
   - `observaciones text NULL` (CHECK ≤500)
   - `registrada_por uuid NULL REFERENCES usuarios(id) ON DELETE SET NULL`
   - `created_at timestamptz DEFAULT now()`
   - `updated_at timestamptz DEFAULT now()`
   - `UNIQUE (nino_id, fecha)`
   - CHECK `(estado IN ('presente','llegada_tarde') OR hora_llegada IS NULL) OR estado IS NULL` — sin contradicciones.
   - CHECK `hora_salida IS NULL OR hora_llegada IS NULL OR hora_salida > hora_llegada`

2. **`ausencias`**
   - `id uuid PK DEFAULT gen_random_uuid()`
   - `nino_id uuid NOT NULL REFERENCES ninos ON DELETE RESTRICT`
   - `fecha_inicio date NOT NULL`
   - `fecha_fin date NOT NULL`
   - `motivo motivo_ausencia NOT NULL`
   - `descripcion text NULL` (CHECK ≤500)
   - `reportada_por uuid NULL REFERENCES usuarios(id) ON DELETE SET NULL`
   - `created_at timestamptz DEFAULT now()`
   - `updated_at timestamptz DEFAULT now()`
   - CHECK `fecha_fin >= fecha_inicio`

**Índices:**

- `asistencias`: `UNIQUE(nino_id, fecha)`, índice secundario `(fecha DESC)` para dashboard admin, índice `(nino_id, fecha DESC)` para histórico familia.
- `ausencias`: índice `(nino_id, fecha_inicio DESC)`, índice `(fecha_inicio, fecha_fin)` para el JOIN del pase de lista (cobertura `fecha BETWEEN fecha_inicio AND fecha_fin`).

**ENUMs:** `estado_asistencia` (`presente`, `ausente`, `llegada_tarde`, `salida_temprana`), `motivo_ausencia` (`enfermedad`, `cita_medica`, `vacaciones`, `familiar`, `otro`).

**Triggers:**

- `set_updated_at` en ambas tablas.
- Audit `AFTER INSERT OR UPDATE OR DELETE` en ambas tablas (heredando `audit_trigger_function()` con 2 ramas nuevas: `asistencias` y `ausencias` derivan `centro_id` vía `centro_de_nino(nino_id)`).

**Tablas consultadas:**

- `ninos`, `matriculas`, `aulas`, `cursos_academicos` para el listado y filtros.
- `vinculos_familiares` para gate de tutor.

## Políticas RLS

**Helper auxiliar nuevo** (huso Madrid para coherencia con ventana de edición y ADR-0011):

```sql
CREATE OR REPLACE FUNCTION public.hoy_madrid()
RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (now() AT TIME ZONE 'Europe/Madrid')::date;
$$;
```

Se usa solo en la política `ausencias_tutor_insert/update` para validar `fecha_inicio >= hoy`. (No reemplaza `dentro_de_ventana_edicion`, que sigue siendo la fuente de verdad para asistencia.)

### `asistencias`

```sql
ALTER TABLE public.asistencias ENABLE ROW LEVEL SECURITY;

-- SELECT
CREATE POLICY asistencia_select ON public.asistencias
  FOR SELECT USING (
    public.es_admin(public.centro_de_nino(nino_id))
    OR public.es_profe_de_nino(nino_id)
    OR public.tiene_permiso_sobre(nino_id, 'puede_ver_agenda')
  );

-- INSERT (admin OR profe; ventana abierta)
CREATE POLICY asistencia_insert ON public.asistencias
  FOR INSERT WITH CHECK (
    public.dentro_de_ventana_edicion(fecha)
    AND (
      public.es_admin(public.centro_de_nino(nino_id))
      OR public.es_profe_de_nino(nino_id)
    )
  );

-- UPDATE (idem, ventana evaluada en USING y WITH CHECK)
CREATE POLICY asistencia_update ON public.asistencias
  FOR UPDATE USING (
    public.dentro_de_ventana_edicion(fecha)
    AND (
      public.es_admin(public.centro_de_nino(nino_id))
      OR public.es_profe_de_nino(nino_id)
    )
  ) WITH CHECK (
    public.dentro_de_ventana_edicion(fecha)
    AND (
      public.es_admin(public.centro_de_nino(nino_id))
      OR public.es_profe_de_nino(nino_id)
    )
  );

-- DELETE: ninguna policy → default DENY
```

### `ausencias`

**Permisos separados (Fase 4, ajuste tras review):** leer y reportar ausencias son operaciones semánticamente distintas. Por eso:

- **Lectura** de la sección "Ausencias" en `/family/nino/[id]` queda gated por `puede_ver_agenda` (un autorizado que pueda ver la agenda también ve las ausencias).
- **Escritura** (reportar nueva, editar futura, cancelar) requiere un permiso JSONB nuevo: **`puede_reportar_ausencias`**.
  - Default por backfill: `true` para `tipo_vinculo IN ('tutor_legal_principal','tutor_legal_secundario')`, `false` para `'autorizado'`.
  - Idempotente: `WHERE NOT (permisos ? 'puede_reportar_ausencias')`.
  - Actualiza la matriz de permisos JSONB de ADR-0006 con esta nueva clave.

```sql
ALTER TABLE public.ausencias ENABLE ROW LEVEL SECURITY;

-- SELECT (gated por puede_ver_agenda, mismo permiso que la agenda diaria)
CREATE POLICY ausencia_select ON public.ausencias
  FOR SELECT USING (
    public.es_admin(public.centro_de_nino(nino_id))
    OR public.es_profe_de_nino(nino_id)
    OR public.tiene_permiso_sobre(nino_id, 'puede_ver_agenda')
  );

-- INSERT: admin siempre; profe del aula siempre (registro retrospectivo);
--         tutor con `puede_reportar_ausencias` solo para fecha_inicio
--         futura/hoy. Atención: el permiso de reporte es DISTINTO del de
--         lectura (un autorizado puede leer y no reportar, p.ej.).
CREATE POLICY ausencia_insert ON public.ausencias
  FOR INSERT WITH CHECK (
    public.es_admin(public.centro_de_nino(nino_id))
    OR public.es_profe_de_nino(nino_id)
    OR (
      public.tiene_permiso_sobre(nino_id, 'puede_reportar_ausencias')
      AND fecha_inicio >= public.hoy_madrid()
    )
  );

-- UPDATE: admin siempre.
--   - Tutor con `puede_reportar_ausencias` y fecha_inicio >= hoy (original
--     y nuevo).
--   - Profe que reportó la ausencia originalmente (`reportada_por =
--     auth.uid()`) puede UPDATE — la política RLS no restringe el
--     contenido, pero la server action validará vía Zod que el único
--     cambio permitido sea aplicar el prefijo `[cancelada] ` a la
--     descripcion (ver B35). Para corregir motivos/fechas, la profe
--     cancela la incorrecta y crea una nueva.
CREATE POLICY ausencia_update ON public.ausencias
  FOR UPDATE USING (
    public.es_admin(public.centro_de_nino(nino_id))
    OR (
      public.tiene_permiso_sobre(nino_id, 'puede_reportar_ausencias')
      AND fecha_inicio >= public.hoy_madrid()
    )
    OR (
      public.es_profe_de_nino(nino_id)
      AND reportada_por = auth.uid()
    )
  ) WITH CHECK (
    public.es_admin(public.centro_de_nino(nino_id))
    OR (
      public.tiene_permiso_sobre(nino_id, 'puede_reportar_ausencias')
      AND fecha_inicio >= public.hoy_madrid()
    )
    OR (
      public.es_profe_de_nino(nino_id)
      AND reportada_por = auth.uid()
    )
  );

-- DELETE: ninguna policy → default DENY (cancelaciones via UPDATE con prefijo)
```

> **Por qué la validación "solo cancelar" se hace en la server action y no en la RLS:** una policy RLS no puede inspeccionar qué columnas cambiaron entre `OLD` y `NEW` con elegancia (sí se podría con un trigger BEFORE UPDATE que comparase tuplas, pero añade complejidad y no mejora seguridad real — un admin con `service_role` lo puentea igual). La server action `actualizarAusencia` valida con Zod que el patch entrante respeta la restricción y rechaza si la profe intenta cambiar `motivo`, `fecha_inicio`, `fecha_fin`, etc.

### Realtime

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.asistencias, public.ausencias;
```

Las RLS de SELECT se aplican también a las notificaciones (mismo principio que Fase 3). Filtrado client-side por aula es cosmético.

## Audit log

Ampliar `audit_trigger_function()` con 2 ramas:

```sql
ELSIF TG_TABLE_NAME IN ('asistencias', 'ausencias') THEN
  v_centro_id := public.centro_de_nino(COALESCE((NEW).nino_id, (OLD).nino_id));
```

Triggers en ambas tablas `AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW`.

## Patrón "Pase de Lista" — Componente reutilizable

### API genérica del componente

`src/shared/components/pase-de-lista/PaseDeListaTable.tsx` (Client Component).

```tsx
interface PaseDeListaColumn<TItem, TValue> {
  id: string // clave única
  label: string // i18n ya traducido
  type: 'radio' | 'time' | 'text-short' | 'select' | 'enum-badges'
  options?: Array<{ value: string; label: string }> // para radio/select/enum-badges
  zod?: z.ZodTypeAny // validación por celda (opcional)
  visibleWhen?: (row: TValue) => boolean // muestra/oculta condicional
  width?: string // tailwind: "w-24", "w-32"
}

interface PaseDeListaQuickAction<TValue> {
  id: string
  label: string // i18n ya traducido
  apply: (currentRow: TValue) => Partial<TValue> // patch a aplicar a cada fila
  /** Si true, solo aplica a filas no tocadas todavía. */
  onlyClean?: boolean
}

interface PaseDeListaTableProps<TItem, TValue> {
  /** Filas a renderizar (con datos pre-cargados si existen). */
  items: Array<{
    item: TItem // niño, en este caso
    initial: TValue | null // valor pre-cargado o null
    badges?: Array<{ label: string; variant?: 'warm' | 'info' | 'destructive' }>
  }>
  /** Renderer para la primera columna (foto/avatar + nombre). */
  renderItem: (item: TItem) => React.ReactNode
  /** Columnas de inputs. */
  columns: Array<PaseDeListaColumn<TItem, TValue>>
  /** Quick actions arriba de la tabla. */
  quickActions?: Array<PaseDeListaQuickAction<TValue>>
  /** Submit batch: recibe solo filas tocadas (dirty). */
  onBatchSubmit: (rows: Array<{ item: TItem; value: TValue }>) => Promise<{
    success: boolean
    error?: string // i18n key
  }>
  /** Si está presente y la fecha != hoy → todos los inputs disabled, sin botones. */
  readOnly?: boolean
  /** Texto del botón submit (i18n). */
  submitLabel: string
  /** Labels i18n para estados de fila. */
  i18n: {
    pending: string // "Pendiente"
    dirty: string // "Sin guardar"
    saved: string // "Guardado"
    errorRow: string // "Error"
  }
}
```

### Hook `usePaseDeListaForm`

```tsx
function usePaseDeListaForm<TItem, TValue>(opts: {
  items: PaseDeListaTableProps<TItem, TValue>['items']
  columns: PaseDeListaColumn<TItem, TValue>[]
}): {
  rows: Map<
    string /* itemId */,
    { value: Partial<TValue>; dirty: boolean; errors: Record<string, string> }
  >
  setValue: (itemId: string, columnId: string, value: unknown) => void
  applyQuickAction: (action: PaseDeListaQuickAction<TValue>) => void
  validate: () =>
    | { ok: true }
    | { ok: false; firstError: { itemId: string; columnId: string; msg: string } }
  collectDirty: () => Array<{ itemId: string; value: TValue }>
  resetSaved: (itemIds: string[]) => void // marca como guardados (no dirty)
}
```

### Comportamientos

- **State local** per row con dirty tracking. El hook mantiene un `Map<itemId, row>` para mutaciones O(1).
- **Validación por celda con Zod**: se valida solo en submit y en blur (para no spamear errores mientras la profe escribe).
- **Quick actions**: aplican un patch a cada fila visible; respetan `onlyClean` si está marcado.
- **Submit batch**: el componente llama `onBatchSubmit` con solo las filas dirty; tras success, las marca como saved con badge verde temporal (3s).
- **Estados visuales por fila**: borde gris (pending), azul (dirty), verde (saved), rojo (error).
- **Realtime**: el padre puede pasar `key={fecha + refreshKey}` para forzar re-mount si llega un cambio externo importante; el componente no se acopla directamente al canal Realtime — eso queda en el padre (consistente con Fase 3, ver hook `useAgendaRealtime`).
- **Accesibilidad**: tabla con `role="table"`, celdas con `role="cell"`, inputs con labels asociados, anuncios `aria-live="polite"` para "Pase de lista guardado". Targets táctiles ≥ 44px en mobile.

### Tests unitarios mínimos

`src/shared/components/pase-de-lista/__tests__/PaseDeListaTable.test.tsx`:

- Renderiza N filas con valores iniciales.
- `setValue` marca la fila como dirty.
- Quick action "Marcar todos presentes" aplica patch a todas las filas.
- `collectDirty` devuelve solo las tocadas.
- `validate` falla con mensaje localizable si Zod rechaza una celda.
- `onBatchSubmit` se llama con el subset correcto al pulsar Guardar.
- `readOnly` deshabilita todos los inputs y oculta el botón submit.

### Uso desde Fase 4 (asistencia)

```tsx
<PaseDeListaTable
  items={resumenes} // { item: nino, initial: asistenciaActual, badges: [...] }
  renderItem={(nino) => <NinoAvatar nino={nino} />}
  columns={[
    {
      id: 'estado',
      label: t('estado'),
      type: 'radio',
      options: [
        { value: 'presente', label: t('presente') },
        { value: 'ausente', label: t('ausente') },
        { value: 'llegada_tarde', label: t('llegada_tarde') },
        { value: 'salida_temprana', label: t('salida_temprana') },
      ],
    },
    {
      id: 'hora_llegada',
      label: t('hora_llegada'),
      type: 'time',
      visibleWhen: (r) => r?.estado === 'presente' || r?.estado === 'llegada_tarde',
    },
    {
      id: 'hora_salida',
      label: t('hora_salida'),
      type: 'time',
      visibleWhen: (r) => r?.estado === 'salida_temprana',
    },
    { id: 'observaciones', label: t('observaciones'), type: 'text-short' },
  ]}
  quickActions={[
    {
      id: 'presentes',
      label: t('marcar_todos_presentes'),
      apply: (r) => ({ estado: 'presente', hora_llegada: r?.hora_llegada ?? horaActualMadrid() }),
    },
  ]}
  onBatchSubmit={async (rows) => {
    const r = await batchUpsertAsistencias(aulaId, fecha, rows)
    return r.success ? { success: true } : { success: false, error: r.error }
  }}
  readOnly={fecha !== hoy}
  submitLabel={t('guardar_pase_de_lista')}
  i18n={{
    pending: t('pendiente'),
    dirty: t('sin_guardar'),
    saved: t('guardado'),
    errorRow: t('error'),
  }}
/>
```

## Pantallas y rutas

- **Profe**: `/teacher/aula/[id]/asistencia?fecha=YYYY-MM-DD` (nueva ruta hija de la del aula). Tab/link desde `/teacher/aula/[id]`.
- **Familia**: nueva sección "Ausencias" en `/family/nino/[id]` (después de "Agenda"). Gated por `puede_ver_agenda`.
- **Admin**: `/admin` card "Asistencia hoy" (sin ruta nueva); navegación a la del profe para ver detalle.

## Componentes UI

`src/shared/components/pase-de-lista/`:

- `PaseDeListaTable.tsx` (Client) — componente genérico reusable.
- `usePaseDeListaForm.ts` — hook de estado y validación.
- `types.ts` — interfaces compartidas.
- `__tests__/PaseDeListaTable.test.tsx` — unit tests.

`src/features/asistencia/components/`:

- `AsistenciaPaseDeListaCliente.tsx` (Client) — wrapper específico de asistencia (configura las `columns`, hace fetch del state inicial, gestiona Realtime + refreshKey).
- `AsistenciaResumenAdminCard.tsx` (Server) — la card del dashboard admin con counts.

`src/features/ausencias/components/`:

- `AusenciasSection.tsx` (Server) — server component que carga y renderiza la lista.
- `AusenciasLista.tsx` (Client) — lista + estado de "editando".
- `AusenciaForm.tsx` (Client) — modal/inline form (RHF + Zod).
- `BotonCancelarAusencia.tsx` (Client) — diálogo de confirmación.

## Eventos y notificaciones

- **Push**: NO en Fase 4 (llega en Fase 5).
- **Audit log**: automático.
- **Realtime**: subscriptions a `asistencias` (canal `asistencias-aula-${aulaId}`) y `ausencias` (canal `ausencias-nino-${ninoId}` para familia; el de profe queda cubierto por el de aula via JOIN refresh).
- **Telemetría**: `asistencia_pase_de_lista_guardado { aula_id, count }`, `ausencia_reportada { motivo, dias }`, sin PII.

## i18n

Namespaces nuevos: `asistencia.*`, `ausencia.*`. Estructura (extracto):

```json
{
  "asistencia": {
    "title": "Pase de lista",
    "selector": { "anterior": "Día anterior", "siguiente": "Día siguiente" },
    "dia_cerrado": "Día cerrado",
    "guardar_pase_de_lista": "Guardar pase de lista",
    "marcar_todos_presentes": "Marcar todos presentes",
    "limpiar": "Limpiar",
    "pendiente": "Pendiente",
    "sin_guardar": "Sin guardar",
    "guardado": "Guardado",
    "error": "Error",
    "estado_opciones": {
      "presente": "Presente",
      "ausente": "Ausente",
      "llegada_tarde": "Llegada tarde",
      "salida_temprana": "Salida temprana"
    },
    "campos": {
      "estado": "Estado",
      "hora_llegada": "Hora llegada",
      "hora_salida": "Hora salida",
      "observaciones": "Observaciones"
    },
    "badges": {
      "ausencia_reportada_familia": "Ausencia reportada por familia",
      "ausencia_reportada_profe": "Ausencia reportada por la profe"
    },
    "validation": {
      "hora_invalida": "Hora inválida. Formato HH:MM.",
      "fecha_invalida": "Fecha inválida.",
      "observaciones_largas": "Máximo 500 caracteres.",
      "requiere_hora_llegada": "Indica la hora de llegada.",
      "requiere_hora_salida": "Indica la hora de salida.",
      "salida_anterior_llegada": "La hora de salida debe ser posterior a la llegada."
    },
    "errors": {
      "fuera_de_ventana": "Ya no puedes editar este día.",
      "guardar_fallo": "No se pudo guardar. Inténtalo de nuevo."
    },
    "resumen_admin": {
      "title": "Asistencia hoy",
      "presentes": "presentes",
      "ausentes": "ausentes",
      "pendientes": "pendientes",
      "sin_aulas_activas": "Sin aulas activas."
    },
    "ningun_nino": "No hay niños matriculados en esta aula."
  },
  "ausencia": {
    "title": "Ausencias",
    "reportar": "Reportar ausencia",
    "editar": "Editar",
    "cancelar": "Cancelar ausencia",
    "sin_ausencias": "Sin ausencias registradas.",
    "estado_cancelada": "Cancelada",
    "campos": {
      "fecha_inicio": "Desde",
      "fecha_fin": "Hasta",
      "motivo": "Motivo",
      "descripcion": "Descripción"
    },
    "motivo_opciones": {
      "enfermedad": "Enfermedad",
      "cita_medica": "Cita médica",
      "vacaciones": "Vacaciones",
      "familiar": "Asunto familiar",
      "otro": "Otro"
    },
    "validation": {
      "fecha_fin_anterior": "La fecha fin debe ser posterior o igual a la fecha inicio.",
      "descripcion_larga": "Máximo 500 caracteres.",
      "fecha_pasada": "No se puede reportar una ausencia en fecha pasada."
    },
    "confirmar_cancelar": {
      "title": "Cancelar ausencia",
      "descripcion": "Esto marca la ausencia como cancelada (no se elimina). La profe lo verá. ¿Continuar?",
      "si": "Sí, cancelar",
      "no": "Volver"
    },
    "errors": {
      "guardar_fallo": "No se pudo guardar. Inténtalo de nuevo.",
      "sin_permiso": "No tienes permiso para reportar ausencias.",
      "fuera_de_ventana": "Solo puedes editar ausencias futuras o de hoy."
    }
  },
  "family": {
    "nino": {
      "tabs": { "ausencias": "Ausencias" },
      "ausencias": {
        "sin_permiso": {
          "title": "No tienes permiso para gestionar ausencias",
          "description": "Pide al administrador del centro que te lo active."
        }
      }
    }
  }
}
```

## Accesibilidad

- Tabla de pase de lista con `role="table"`, headers asociados, filas con `aria-label` que incluye el nombre del niño.
- Quick actions con `<button>` reales y `aria-label`.
- Estados (pending/dirty/saved/error) anunciados con `aria-live="polite"` en una región summary.
- Form de ausencia con labels asociados, errores con `aria-describedby` y `role="alert"`.
- Modal de confirmación de cancelar ausencia: focus trap, ESC cierra.
- Contraste WCAG AA en todos los badges (warm, info, destructive, secondary).
- Targets táctiles ≥ 44 CSS px en mobile (botones del pase de lista).
- axe-core sin violations en `/teacher/aula/[id]/asistencia` y `/family/nino/[id]`.

## Performance

- Query principal profe: 1 query con JOIN a 3 tablas + LEFT JOIN a asistencias y ausencias del día. Índices `(nino_id, fecha)` y `(fecha_inicio, fecha_fin)` cubren los joins.
- Batch UPSERT: 1 round-trip a Supabase para N filas. Si N > 30 niños, sigue siendo <100ms p50.
- Bundle: vista profe es Client por Realtime + RHF + state local; objetivo < 230 KB JS (sidebar consume ~80 KB + agenda compartida).
- Lighthouse > 90 en performance y accesibilidad en `/teacher/aula/[id]/asistencia`.

## Telemetría

- `asistencia_pase_de_lista_abierto { aula_id }`
- `asistencia_pase_de_lista_guardado { aula_id, count }`
- `asistencia_quick_action_aplicada { aula_id, accion_id }`
- `ausencia_reportada { motivo, dias }`
- `ausencia_cancelada {}`
- `asistencia_resumen_visto_admin {}` (cuando dashboard admin renderiza el card)

Sin PII.

## Tests requeridos

**Vitest (unit/integration):**

- [ ] `asistencia.schema.test.ts`: enum + cross-field rules.
- [ ] `ausencia.schema.test.ts`: enum + cross-field rules + helper `esCancelada`.
- [ ] `PaseDeListaTable.test.tsx`: render, dirty, quick actions, validate, collectDirty, readOnly, onBatchSubmit.
- [ ] `usePaseDeListaForm.test.ts` (si se separa del componente).

**Vitest (RLS) — `src/test/rls/asistencia.rls.test.ts` (≥6):**

- [ ] Admin centro A no ve asistencias de centro B.
- [ ] Profe aula A no ve asistencias de aula B (cross-aula mismo centro).
- [ ] Profe aula del niño puede INSERT asistencia de hoy.
- [ ] Profe aula del niño NO puede INSERT/UPDATE asistencia con fecha=ayer.
- [ ] Tutor sin `puede_ver_agenda` NO ve asistencias.
- [ ] Tutor con `puede_ver_agenda` ve asistencias pero NO puede INSERT.
- [ ] DELETE rechazado a admin, profe y tutor.

**Vitest (RLS) — `src/test/rls/ausencia.rls.test.ts` (≥7):**

- [ ] Admin centro A no ve ausencias centro B.
- [ ] Tutor con `puede_reportar_ausencias=true` puede INSERT ausencia con fecha_inicio = hoy.
- [ ] Tutor con `puede_reportar_ausencias=true` NO puede INSERT ausencia con fecha_inicio = ayer.
- [ ] Tutor con `puede_ver_agenda=true` pero `puede_reportar_ausencias=false` (caso autorizado) ve ausencias pero NO puede INSERT.
- [ ] Tutor con `puede_reportar_ausencias=false` NO puede INSERT aunque pueda leer.
- [ ] Profe del aula puede INSERT (registro retrospectivo).
- [ ] Profe puede UPDATE ausencia propia (`reportada_por = self`); NO puede UPDATE ausencia de la familia.
- [ ] DELETE rechazado a todos.

**Vitest (audit) — `src/test/audit/asistencia-audit.test.ts`:**

- [ ] INSERT en `asistencias` genera audit_log con `centro_id` correcto.
- [ ] UPDATE en `ausencias` captura antes/después.

**Playwright (E2E) — `e2e/attendance.spec.ts`:**

- [ ] **profe-pasa-lista**: profe entra a `/es/teacher/aula/[id]/asistencia`, pulsa "Marcar todos presentes", ajusta uno a `llegada_tarde`, guarda, recarga la página, ve los cambios.
- [ ] **familia-reporta-ausencia**: familia entra a `/es/family/nino/[id]`, reporta ausencia para mañana, guarda. (Opcional: profe la ve en el pase de lista del día — requiere setup E2E real, queda `test.skip` condicional como en Fase 3.)
- [ ] **dia-cerrado-readonly**: profe navega a ayer en `/teacher/aula/[id]/asistencia` → badge "Día cerrado" + inputs disabled.

Más smoke tests rutas protegidas + i18n en 3 idiomas (mismo patrón que Fase 3).

## Criterios de aceptación

- [ ] Tests Vitest + Playwright pasan en CI verde.
- [ ] Lighthouse > 90 en `/teacher/aula/[id]/asistencia` y `/family/nino/[id]`.
- [ ] axe-core sin violations en ambas vistas.
- [ ] 100% claves i18n en es/en/va; lint i18n verde.
- [ ] Audit log captura INSERT/UPDATE de ambas tablas.
- [ ] Componente `<PaseDeListaTable />` documentado y con tests unitarios; **genérico** (no asume nada de asistencia).
- [ ] ADR-0014 (pase de lista) y ADR-0015 (asistencia lazy) escritos.
- [ ] `docs/architecture/data-model.md` actualizado.
- [ ] `docs/architecture/rls-policies.md` con sección de Fase 4.
- [ ] Entrada en `docs/journey/progress.md`.

## Decisiones técnicas relevantes

- **ADR-0014 — Patrón "Pase de Lista" como componente reutilizable.** `<PaseDeListaTable />` y `usePaseDeListaForm` en `src/shared/components/pase-de-lista/`. API genérica con `items + columns + quickActions + onBatchSubmit`. F4.5 (menús) y F7 (confirmación de eventos) lo reusan sin tocar el componente, solo cambiando la configuración de columnas y la server action de batch. Coste: hacerlo genérico ahora añade ~50% de tiempo vs hacerlo específico, pero ahorra el doble en F4.5.

- **ADR-0015 — Asistencia "lazy" (sin pre-creación nocturna).** Alternativa rechazada: cron job que pre-crea filas con `estado='pendiente'` cada noche. Razones del rechazo: (1) Supabase Cloud no expone cron nativo fácilmente sin pg_cron + extensión; (2) huérfanos si un niño se da de baja entre la creación y el día; (3) el JOIN con `LEFT JOIN asistencias` en el query cubre el caso "no hay fila" sin coste real; (4) lazy es más simple y más correcto: la ausencia de fila significa "no se ha pasado lista", no se confunde con "presente". Coste: cliente debe gestionar el caso "sin fila" en UI (lo hace el `<PaseDeListaTable />` con `initial: null`).

- **ADR-0016 — Ventana de edición compartida "día cerrado para todos los roles" como invariante transversal de las fases operativas.** Eleva a principio explícito lo que ya se establecía implícitamente en ADR-0013 (agenda) y se extiende ahora a asistencia. El helper `public.dentro_de_ventana_edicion(fecha)` con `Europe/Madrid` hardcoded es la fuente única de verdad para INSERT/UPDATE de tablas operativas con concepto de "día". A las 00:00 hora Madrid del día siguiente, **read-only para todos los roles incluido admin** vía RLS. Correcciones a posteriori solo por SQL con `service_role` (queda en `audit_log`). Aplica también a F4.5 (`comidas` con plantilla pre-cargada), F7 (confirmaciones de evento) y futuras tablas con la misma semántica. Las **ausencias quedan fuera** porque su lógica es distinta (notificación previa con ventana propia `fecha_inicio >= hoy`).

- **Permiso `puede_reportar_ausencias` (Fase 4, ajuste tras review):** clave JSONB nueva en `vinculos_familiares.permisos`. Default `true` para tutores legales, `false` para autorizados. RLS de INSERT/UPDATE en `ausencias` usa este permiso, no `puede_ver_agenda`. Justificación: leer y reportar son semánticamente distintos — un autorizado puede tener visibilidad sin la responsabilidad de notificar. Backfill idempotente en la misma migración. ADR-0006 se actualiza con la nueva entrada en la matriz de permisos JSONB.

## Referencias

- ADR-0007 — RLS recursion avoidance (patrón helpers SECURITY DEFINER, reusado para `centro_de_nino`).
- ADR-0011 — Timezone Europe/Madrid (`hoy_madrid()` sigue el mismo huso).
- ADR-0013 — Ventana de edición = mismo día (reusada vía `dentro_de_ventana_edicion(fecha)`).
- Spec `daily-agenda.md` — patrón ventana, Realtime + RLS, marcar como erróneo / cancelado.
- Spec `core-entities.md` — modelo `ninos`, `matriculas`, `vinculos_familiares`.

---

**Workflow:**

1. Spec `draft`.
2. Responsable revisa y aprueba (→ `approved`).
3. Migración + componente genérico + tests RLS (Checkpoint B).
4. UI completa + i18n + E2E (Checkpoint C).
5. Merge + deploy (→ `done`).
