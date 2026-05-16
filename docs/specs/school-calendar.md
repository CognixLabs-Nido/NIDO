---
feature: school-calendar
wave: 1
phase: 4.5a
status: draft
priority: critical
last_updated: 2026-05-16
related_adrs: [ADR-0011, ADR-0019]
related_specs: [scope-ola-1, core-entities]
---

# Spec — Calendario laboral del centro (Fase 4.5a)

> Primera mitad del módulo de menús. Construye el calendario laboral del centro (qué días abre, qué tipo de día es cada uno) como **prerequisito** del menú mensual (Fase 4.5b) y como **base reutilizable** para el calendario y eventos (Fase 7). Introduce un componente compartido `<CalendarioMensual />` agnóstico de dominio.

## Resumen ejecutivo

Una tabla nueva — `dias_centro` — que registra **solo los días que se desvían del comportamiento por defecto** (lun-vie = lectivo, sáb-dom = cerrado). El tipo real de un día se calcula con un helper SQL `tipo_de_dia(centro, fecha)` que primero busca un override y, si no existe, devuelve el default por día de la semana. La directora edita el calendario desde `/admin/calendario` con una vista mensual color-coded; profes y familias tienen una vista read-only equivalente. El componente `<CalendarioMensual />` vive en `src/shared/components/calendario/` y es **completamente genérico** — Fase 7 (eventos) lo reusará pintando otra cosa en cada celda.

## Contexto

Fase 4.5 se rehizo: el modelo de "plantilla semanal recurrente" se descartó porque no encajaba con la realidad operativa (festivos locales, vacaciones escolares, escuela de verano como servicio aparte). Tras la limpieza del drift (PR #13 mergeado el 2026-05-16), el módulo se divide ahora en dos fases secuenciales:

- **Fase 4.5a (esta):** calendario laboral del centro.
- **Fase 4.5b (siguiente):** menú mensual + pase de lista comida por platos.

El calendario laboral lo consultarán múltiples módulos:

- **Menús (F4.5b):** no se genera menú para días cerrados; los días `escuela_verano` / `escuela_navidad` pueden tener un menú distinto.
- **Asistencia (F4):** el pase de lista de hoy ya funciona, pero `/admin` puede contextualizar con "Hoy es festivo, no se espera asistencia".
- **Calendario y eventos (F7):** los eventos se publican sobre el mismo grid mensual.

Hacer el calendario aislado (sin acoplarlo al modelo de menús) permite:

1. Que Fase 4.5b parta de un módulo ya en producción.
2. Que Fase 7 reuse el componente sin esperarlo.
3. Probar la decisión "default + excepciones" con un caso pequeño antes de extenderla.

## User stories

- **US-36:** Como **admin del centro**, quiero marcar un día concreto como festivo para que el resto de módulos (menú, asistencia) sepan que el centro está cerrado.
- **US-37:** Como **admin**, quiero seleccionar un rango de días (ej. del 1 al 31 de agosto) y aplicar un tipo a todos de una vez para no hacer 31 clicks.
- **US-38:** Como **admin**, quiero que los lunes-viernes aparezcan como lectivos y los sábados-domingos como cerrados sin tener que marcar nada (default).
- **US-39:** Como **admin**, quiero poder eliminar un día marcado (volver al default) en un solo click cuando me equivoco al marcar un festivo.
- **US-40:** Como **profe**, quiero ver el calendario del centro con los festivos y vacaciones marcados para planificar.
- **US-41:** Como **tutor legal o autorizado**, quiero ver qué días el centro está abierto para saber cuándo llevo a mi hijo.
- **US-42:** Como **admin / DPD**, quiero que cada cambio en el calendario quede en `audit_log` con `centro_id`, `usuario_id` y diff antes/después (incluido el DELETE).

## Alcance

**Dentro:**

- 1 tabla nueva: `dias_centro` + 1 ENUM `tipo_dia_centro` (7 valores).
- 2 helpers SQL: `tipo_de_dia(centro, fecha)` y `centro_abierto(centro, fecha)`.
- Políticas RLS: SELECT amplio (todos los miembros del centro), INSERT/UPDATE/**DELETE** solo admin. Excepción explícita al patrón "no DELETE" — ver §RLS y ADR-0019.
- Audit log automático en `dias_centro` (heredando `audit_trigger_function()`).
- Componente compartido **`<CalendarioMensual />`** + types + tests unitarios en `src/shared/components/calendario/`. **Genérico, no acoplado a `dias_centro`.**
- Server actions: `upsertDiaCentro`, `aplicarTipoARango`, `eliminarDiaCentro`.
- Queries: `getCalendarioMes(centroId, año, mes)` (devuelve los 7 días previos/posteriores como overflow para el grid de 6 semanas + los días del mes con tipo resuelto), `getProximosDiasCerrados(centroId, desde, dias)`.
- UI admin: `/admin/calendario` con editor mensual (click individual + selección de rango + leyenda + observaciones opcionales).
- UI familia: `/family/calendario` read-only + widget compacto "Próximos días cerrados" en `/family`.
- UI profe: `/teacher/calendario` read-only + widget compacto en `/teacher`.
- i18n trilingüe (es/en/va).
- ADR-0019.
- Tests: RLS (≥5), functions SQL (≥4), audit (≥1), unit del componente (≥6), Playwright E2E (≥2).

**Fuera (no se hace aquí):**

- **Menús diarios** — Fase 4.5b. Esta fase **no** introduce `platos`, `menus_mensuales` ni nada relacionado.
- **Calendario académico vs laboral del centro:** `cursos_academicos` ya cubre la fecha de inicio/fin del curso. El calendario laboral es operativo (qué días abre el centro físicamente). No se acoplan; un curso puede estar `activo` y el centro cerrado un lunes festivo sin contradicción.
- **Notificaciones push** ("recordatorio: mañana vacaciones") — fuera de Ola 1.
- **Eventos / reuniones** — Fase 7 reusará `<CalendarioMensual />`, pero los eventos como entidad llegan ahí.
- **Calendarios distintos por aula** — descartado conscientemente; el calendario es del centro.
- **Importación de festivos oficiales (BOE, etc.)** — el admin los introduce a mano, simple y suficiente para ANAIA.

## Comportamientos detallados

### B43 — Cálculo del tipo de un día (helper SQL)

El sistema **no persiste** una fila por cada día del año. El tipo de un día se calcula bajo demanda:

1. ¿Hay una fila en `dias_centro` para `(centro_id, fecha)`? → devuelve `tipo` persistido.
2. Si no hay fila: `EXTRACT(ISODOW FROM fecha)` (1=lun … 7=dom).
   - 1-5 → `lectivo`.
   - 6-7 → `cerrado`.

El helper booleano `centro_abierto(centro, fecha)` devuelve `true` si el tipo resuelto está en `('lectivo', 'escuela_verano', 'escuela_navidad', 'jornada_reducida')` y `false` para `('festivo', 'vacaciones', 'cerrado')`.

> **Por qué no persistir el default:** evita 365 filas/año/centro y que la directora tenga que marcar todo el año al alta. Para ANAIA (1 centro) son ~30-50 filas/año en `dias_centro` (festivos + vacaciones + escuela de verano), no 365. Detalle en ADR-0019.

### B44 — Admin marca un día concreto

**Pre-condiciones:**

- Usuario autenticado con rol `admin` en el centro.

**Flujo:**

1. Admin abre `/admin/calendario`. Se renderiza el mes actual con `<CalendarioMensual />`. Cada celda muestra el tipo resuelto (via `getCalendarioMes`) color-coded.
2. Admin hace click en una celda concreta (ej. lunes 15 de junio).
3. Se abre un Popover con:
   - Select de `tipo` (7 opciones, traducidas).
   - Textarea opcional `observaciones` (≤500 chars).
   - Botones "Guardar" / "Eliminar" (este último solo si ya había una fila) / "Cancelar".
4. Admin elige `festivo`, escribe "San Vicente Mártir" y guarda.
5. Server action `upsertDiaCentro({centro_id, fecha, tipo, observaciones})`:
   - Valida con Zod.
   - INSERT … ON CONFLICT (centro_id, fecha) DO UPDATE.
   - Setea `creado_por = auth.uid()` (en INSERT) o no lo toca en UPDATE.
6. Audit trigger graba INSERT o UPDATE.
7. La celda se re-renderiza con el nuevo color (server component → revalidatePath). Toast "Día actualizado".

**Post-condiciones:**

- Fila en `dias_centro`.
- Audit log con la operación.
- Resto de módulos (futuros: menú, asistencia) verán el nuevo tipo vía `tipo_de_dia`.

### B45 — Admin aplica un tipo a un rango

**Pre-condiciones:**

- Igual que B44.

**Flujo:**

1. Admin selecciona un rango: click sostenido o shift+click sobre la celda final (modo `onSeleccionRango`).
2. Aparece un dialog modal con:
   - Resumen "Aplicar a 31 días (1 ago — 31 ago)".
   - Select de `tipo`.
   - Textarea opcional `observaciones` (se aplica a todos los días del rango).
   - Botones "Aplicar" / "Cancelar".
3. Admin elige `escuela_verano` y aplica.
4. Server action `aplicarTipoARango({centro_id, desde, hasta, tipo, observaciones})`:
   - Valida `hasta >= desde` y span ≤ 366 días (anti-abuso).
   - Itera fechas con `generate_series` server-side: una sola query `INSERT … SELECT generate_series(desde, hasta, '1 day') … ON CONFLICT DO UPDATE`.
   - Audit log graba una fila por día (vía trigger).
5. UI revalida y muestra el rango con el nuevo color. Toast "31 días actualizados".

**Por qué `generate_series` server-side:** una sola operación atómica que respeta el `UNIQUE(centro_id, fecha)` y se audita fila a fila desde el trigger. Aplicar el rango en cliente con N round-trips sería frágil y ruidoso en audit.

### B46 — Admin elimina un día marcado (vuelve al default)

**Pre-condiciones:**

- Igual que B44.
- El día tiene una fila persistida (si no, "Eliminar" no aparece).

**Flujo:**

1. Admin abre el popover de un día marcado (ej. el lunes que marcó como festivo por error).
2. Pulsa "Eliminar".
3. Server action `eliminarDiaCentro({centro_id, fecha})`:
   - DELETE FROM `dias_centro` WHERE centro_id=? AND fecha=?.
4. Audit trigger graba DELETE.
5. UI re-renderiza la celda con el tipo default calculado (lectivo o cerrado según el día de la semana). Toast "Día restaurado al default".

**Por qué SÍ permitimos DELETE (excepción al patrón habitual):**

En el resto de tablas operativas, DELETE está bloqueado a todos (default DENY) y "anular" se hace con UPDATE de un prefijo `[anulado] ` u análogo. Aquí no aplica porque `dias_centro` representa **excepciones al default**: la "ausencia de fila" tiene significado semántico (el día sigue el default). Si la directora se equivoca al marcar un día, lo más natural y comprensible es **borrar la fila** para que el día vuelva al default — no dejar un registro "anulado" que confunde al render. El DELETE queda en `audit_log` (la fila completa va en `valores_antes`), así que la trazabilidad se preserva.

Documentado explícitamente en ADR-0019.

### B47 — Profe y familia ven el calendario

**Pre-condiciones:**

- Profe: rol `profe` con al menos un `profes_aulas` activo en el centro.
- Familia (tutor legal o autorizado): `vinculos_familiares` activo con al menos un niño matriculado en el centro.

**Flujo:**

1. Profe abre `/teacher/calendario` o familia abre `/family/calendario`.
2. Server query `getCalendarioMes(centro_id, año, mes)`:
   - Para profe: `centro_id` derivado del primer aula asignada (o si tiene varias, el del primer rol).
   - Para familia: `centro_id` del niño (si tiene varios niños en distintos centros, decisión: el del primero por orden de creación; documentado en código).
3. `<CalendarioMensual mes={mes} anio={año} renderDia={...} />` pinta las celdas color-coded.
4. **Read-only:** click en celda no abre nada (o muestra tooltip con tipo + observaciones si las hay).
5. Navegación ← → entre meses funciona igual que en admin.

**Widget compacto en dashboards** (`/family` y `/teacher`):

- `<ProximosDiasCerradosWidget />` server component que llama `getProximosDiasCerrados(centro_id, hoy, 30)` → lista hasta 5 próximos días cerrados en los **próximos 30 días naturales** (horizonte fijo).
- Ejemplo: "Próximos días cerrados: Lun 22 jun · Festivo · S. Juan; Mié 24 jul · Vacaciones".
- **Empty state amable si no hay días cerrados en esos 30 días:** se muestra el card con el título y un mensaje "Sin cierres previstos el próximo mes" (i18n: `calendario.widget_proximos_cerrados.vacio_amable`). No se oculta el card — la ausencia de cierres también es información útil para la familia ("este mes sin sustos").

### B48 — Selección de rango en `<CalendarioMensual />`

El componente expone `onSeleccionRango?: (desde: Date, hasta: Date) => void`. Comportamiento:

1. Click en una celda inicial → si está habilitado el modo selección, queda marcada con borde primary.
2. Click en una celda final → invoca `onSeleccionRango(desde, hasta)` (normaliza el orden: `desde <= hasta`).
3. Shift+click sobre la celda final funciona igual.
4. ESC cancela la selección parcial.

En el editor admin, el flujo es: click → popover con el día (B44); shift+click → dialog de rango (B45). Detección por el handler: si el click es simple, se invoca `onClickDia(fecha)`; si es shift+click, se invoca `onSeleccionRango(diaActivo, fecha)`.

> **Decisión deliberada:** no implementamos click-arrastrar (drag) para el rango por complejidad y problemas de accesibilidad. Shift+click es estándar y navegable con teclado.

## Casos edge

- **Mes sin overrides**: todas las celdas muestran el default. La query devuelve 0 filas; el componente calcula los tipos en el cliente con el helper `tipoPorDefecto(fecha)`. Cero round-trips innecesarios.
- **Mes con día de cambio de huso (DST)**: los cálculos se hacen sobre `DATE` (sin hora) usando `EXTRACT(ISODOW FROM fecha)`. El cambio DST no afecta porque la fecha no lleva hora. Coherente con ADR-0011: la fuente de verdad para "hoy" es la fecha `Europe/Madrid`, pero aquí trabajamos con fechas calendario, no timestamps.
- **Rango muy grande (ej. años)**: la server action limita `hasta - desde <= 366 días` y devuelve `{success:false, error:'calendario.errors.rango_demasiado_grande'}`. Razón: aplicar 5 años de golpe genera 1825 filas + 1825 audit_log; no es un caso real.
- **Día sábado/domingo marcado como `lectivo`**: válido. La persistencia gana sobre el default. Caso real: ANAIA podría abrir un sábado puntual (reunión, jornada de puertas abiertas) y marcarlo `lectivo` para que el menú lo tenga.
- **Día laboral marcado como `cerrado`**: válido. Caso real: cierre puntual por avería o causa de fuerza mayor.
- **Admin de centro A intenta crear día para centro B**: RLS lo rechaza (el helper `es_admin(centro_id)` evalúa el `centro_id` del INSERT).
- **DELETE de día inexistente**: silencioso (DELETE devuelve 0 filas afectadas). La server action devuelve `{success:true}` igual — es idempotente.
- **Concurrencia (dos admins editan a la vez)**: el UNIQUE(centro_id, fecha) + ON CONFLICT DO UPDATE hace que gane el último. Audit log captura ambos cambios. No usamos optimistic locking — el dominio no lo justifica.
- **Familia sin permisos sobre niños del centro**: la query `getCalendarioMes` no expone el centro si el usuario no pertenece (RLS de `dias_centro` lo gateda). La página `/family/calendario` muestra empty state "Sin centro asociado".
- **Usuario con niños en >1 centro (caso poco común)**: usa el centro del primer niño por orden de creación. Documentado en el código. Si en el futuro emerge el caso real, se añade selector de centro.
- **Fila huérfana si se borra el centro (CASCADE)**: la FK `centro_id` es `ON DELETE CASCADE`. Coherente con el resto del modelo.
- **Observaciones con PII (ej. "Cerrado por defunción de Ana López")**: el campo es libre. No se cifra. La directora es responsable; en producción real, esto se aborda con guía editorial, no con tooling. Documentado en `accesibilidad` / consideraciones RGPD.
- **Día anterior a hoy o más allá del año académico**: editable sin restricción. A diferencia de la agenda/asistencia (ventana hoy), el calendario es planificación a futuro **y** puede corregirse retrospectivamente — no es un hecho operacional.

> **Sin ventana de edición — confirmación explícita.** `dias_centro` **NO** hereda el patrón de día cerrado de [ADR-0013](../decisions/ADR-0013-ventana-edicion-mismo-dia.md) ni [ADR-0016](../decisions/ADR-0016-dia-cerrado-transversal.md). El admin puede crear, modificar o eliminar overrides para **cualquier fecha** (pasada, presente o futura) sin restricción de RLS, ni del helper `dentro_de_ventana_edicion()`. Razón: el calendario es planificación administrativa, no un hecho operativo del día. Corregir un festivo marcado por error tres meses después es legítimo. Las RLS de §RLS solo gatean `es_admin(centro_id)`, no la fecha. Esto contrasta con `agendas_diarias`, `asistencias`, `comidas`, etc., donde la RLS sí compara contra `hoy_madrid()`.

## Limitaciones conocidas

- **Festivos introducidos manualmente.** No hay importación automática de festivos oficiales (BOE estatal, BOPV autonómico, calendario laboral municipal). El admin los marca a mano. Para ANAIA (1 centro en Valencia) son ~12-14 festivos al año, viable. La importación automática (parseo de fuentes oficiales o integración con APIs como `nager.date`) queda explícitamente **fuera de Ola 1** y se planificará en Ola 2 si emerge demanda real (multi-centro). Documentado también en ADR-0019.
- **Sin recurrencia anual.** Si la directora marca "Día de la Constitución 6 dic 2026 = festivo", el 6 dic 2027 hay que volver a marcarlo. La recurrencia ("este día siempre es festivo") añadiría complejidad al modelo de datos (¿cómo se anula una instancia concreta?) sin uso real probado. Fuera de Ola 1.
- **Sin granularidad por aula** (ya mencionado en §Alcance, refuerzo aquí): un calendario por centro, todas las aulas comparten.

## Validaciones (Zod)

`src/features/calendario-centro/schemas/dia-centro.ts`:

```typescript
import { z } from 'zod'

const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'calendario.validation.fecha_invalida')

const observacionesSchema = z.string().max(500, 'calendario.validation.observaciones_largas')

export const tipoDiaCentroEnum = z.enum([
  'lectivo',
  'festivo',
  'vacaciones',
  'escuela_verano',
  'escuela_navidad',
  'jornada_reducida',
  'cerrado',
])
export type TipoDiaCentro = z.infer<typeof tipoDiaCentroEnum>

export const upsertDiaCentroSchema = z.object({
  centro_id: z.string().uuid(),
  fecha: fechaSchema,
  tipo: tipoDiaCentroEnum,
  observaciones: observacionesSchema.nullable(),
})

export const aplicarTipoARangoSchema = z
  .object({
    centro_id: z.string().uuid(),
    desde: fechaSchema,
    hasta: fechaSchema,
    tipo: tipoDiaCentroEnum,
    observaciones: observacionesSchema.nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.hasta < v.desde) {
      ctx.addIssue({
        code: 'custom',
        path: ['hasta'],
        message: 'calendario.validation.rango_invertido',
      })
    }
    // Span máximo 366 días (incluye año bisiesto)
    const desde = new Date(v.desde)
    const hasta = new Date(v.hasta)
    const dias = Math.round((hasta.getTime() - desde.getTime()) / 86400000) + 1
    if (dias > 366) {
      ctx.addIssue({
        code: 'custom',
        path: ['hasta'],
        message: 'calendario.validation.rango_demasiado_grande',
      })
    }
  })

export const eliminarDiaCentroSchema = z.object({
  centro_id: z.string().uuid(),
  fecha: fechaSchema,
})

export type UpsertDiaCentroInput = z.infer<typeof upsertDiaCentroSchema>
export type AplicarTipoARangoInput = z.infer<typeof aplicarTipoARangoSchema>
export type EliminarDiaCentroInput = z.infer<typeof eliminarDiaCentroSchema>
```

## Modelo de datos afectado

**Tabla nueva: `dias_centro`**

| Columna         | Tipo                       | Notas                                                   |
| --------------- | -------------------------- | ------------------------------------------------------- |
| `id`            | `uuid PK`                  | `DEFAULT gen_random_uuid()`                             |
| `centro_id`     | `uuid NOT NULL`            | FK a `centros(id)` ON DELETE CASCADE                    |
| `fecha`         | `date NOT NULL`            |                                                         |
| `tipo`          | `tipo_dia_centro NOT NULL` | ENUM (7 valores)                                        |
| `observaciones` | `text NULL`                | CHECK `length(observaciones) <= 500`                    |
| `creado_por`    | `uuid NULL`                | FK a `usuarios(id)` ON DELETE SET NULL                  |
| `created_at`    | `timestamptz`              | DEFAULT `now()`                                         |
| `updated_at`    | `timestamptz`              | DEFAULT `now()`, mantenido por trigger `set_updated_at` |

**Constraints e índices:**

- `UNIQUE (centro_id, fecha)` — un override por día por centro.
- Índice secundario `(centro_id, fecha)` — el UNIQUE ya cubre la query principal `WHERE centro_id=? AND fecha BETWEEN ? AND ?`.
- CHECK `length(observaciones) <= 500`.

**ENUM nuevo:**

```sql
CREATE TYPE public.tipo_dia_centro AS ENUM (
  'lectivo',
  'festivo',
  'vacaciones',
  'escuela_verano',
  'escuela_navidad',
  'jornada_reducida',
  'cerrado'
);
```

**Triggers:**

- `set_updated_at_dias_centro` BEFORE UPDATE → mantiene `updated_at`.
- `audit_dias_centro` AFTER INSERT OR UPDATE OR DELETE → graba en `audit_log`.

**Tablas consultadas (sin modificar):**

- `centros` para el FK.
- `usuarios` para `creado_por`.
- `roles_usuario`, `profes_aulas`, `vinculos_familiares`, `ninos`, `matriculas` para los helpers RLS existentes.

## Helpers SQL

```sql
-- Devuelve el tipo de un día (override si existe, default por día de semana si no)
CREATE OR REPLACE FUNCTION public.tipo_de_dia(p_centro_id uuid, p_fecha date)
RETURNS public.tipo_dia_centro
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tipo public.tipo_dia_centro;
  v_dow int;
BEGIN
  SELECT tipo INTO v_tipo
  FROM public.dias_centro
  WHERE centro_id = p_centro_id AND fecha = p_fecha;

  IF FOUND THEN
    RETURN v_tipo;
  END IF;

  v_dow := EXTRACT(ISODOW FROM p_fecha)::int;
  IF v_dow <= 5 THEN
    RETURN 'lectivo'::public.tipo_dia_centro;
  ELSE
    RETURN 'cerrado'::public.tipo_dia_centro;
  END IF;
END;
$$;

-- Boolean de conveniencia: ¿está abierto el centro ese día?
CREATE OR REPLACE FUNCTION public.centro_abierto(p_centro_id uuid, p_fecha date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.tipo_de_dia(p_centro_id, p_fecha) IN
    ('lectivo'::public.tipo_dia_centro,
     'escuela_verano'::public.tipo_dia_centro,
     'escuela_navidad'::public.tipo_dia_centro,
     'jornada_reducida'::public.tipo_dia_centro);
$$;
```

Ambas `STABLE SECURITY DEFINER` con `search_path = public` siguiendo el patrón de Fase 2 (ADR-0007). Coherentes con `hoy_madrid()`, `dentro_de_ventana_edicion()`, `centro_de_nino()`, etc.

## Políticas RLS

**`dias_centro`:**

```sql
ALTER TABLE public.dias_centro ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier miembro del centro (admin, profe, tutor/autorizado).
-- pertenece_a_centro ya cubre los tres roles vía las tablas asociadas
-- (roles_usuario, profes_aulas, vinculos_familiares → ninos).
CREATE POLICY dias_centro_select ON public.dias_centro
  FOR SELECT USING (
    public.pertenece_a_centro(centro_id)
  );

-- INSERT: solo admin del centro.
CREATE POLICY dias_centro_insert ON public.dias_centro
  FOR INSERT WITH CHECK (
    public.es_admin(centro_id)
  );

-- UPDATE: solo admin del centro (USING y WITH CHECK iguales).
CREATE POLICY dias_centro_update ON public.dias_centro
  FOR UPDATE USING (
    public.es_admin(centro_id)
  ) WITH CHECK (
    public.es_admin(centro_id)
  );

-- DELETE: solo admin del centro. EXCEPCIÓN AL PATRÓN HABITUAL — ver ADR-0019.
CREATE POLICY dias_centro_delete ON public.dias_centro
  FOR DELETE USING (
    public.es_admin(centro_id)
  );
```

> **Por qué se permite DELETE aquí y en el resto de tablas operativas no:** ver §B46 arriba y ADR-0019. Resumen: la "ausencia de fila" tiene significado semántico (default por día de semana). Eliminar un override es la operación natural; no procede "anular con prefijo". La trazabilidad del DELETE queda en `audit_log` con `valores_antes` poblado por el trigger.

## Audit log

Ampliar `audit_trigger_function()` con una rama nueva para `dias_centro`:

```sql
ELSIF TG_TABLE_NAME = 'dias_centro' THEN
  v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
```

Y crear el trigger:

```sql
CREATE TRIGGER audit_dias_centro
AFTER INSERT OR UPDATE OR DELETE ON public.dias_centro
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
```

El DELETE queda registrado: `valores_antes` contiene la fila completa (centro_id, fecha, tipo, observaciones), `valores_despues` es NULL. Si la directora marca-borra-marca un día varias veces, todas las operaciones quedan en `audit_log`.

## Componente compartido `<CalendarioMensual />`

`src/shared/components/calendario/CalendarioMensual.tsx` (Client Component).

### API genérica

```tsx
interface CalendarioMensualProps {
  /** Mes a mostrar (1-12). */
  mes: number
  /** Año (4 dígitos). */
  anio: number
  /** Cómo renderizar el contenido de cada celda. */
  renderDia: (fecha: Date, dentroDelMes: boolean) => React.ReactNode
  /** Handler de click simple sobre una celda. */
  onClickDia?: (fecha: Date) => void
  /** Handler de selección de rango (shift+click). */
  onSeleccionRango?: (desde: Date, hasta: Date) => void
  /** Día actualmente resaltado (focus/active). */
  diaActivo?: Date | null
  /** Handler de cambio de mes (← →). Si no se provee, navegación deshabilitada. */
  onCambioMes?: (mes: number, anio: number) => void
  /** Texto a usar en navegación accesible (i18n por el padre). */
  ariaLabel?: string
  /** Locale para nombres de meses/días. Default 'es'. */
  locale?: 'es' | 'en' | 'va'
}
```

### Comportamiento

- **Grid CSS de 7 columnas × 6 filas** (siempre 42 celdas — algunas son del mes anterior/siguiente para mantener el grid completo).
- **Cabecera lunes a domingo** (ISO: lunes primer día). Los nombres de días y meses se localizan con `Intl.DateTimeFormat(locale)` — el componente es agnóstico a la librería i18n.
- **Días de otros meses (overflow)**: se renderizan con `dentroDelMes=false` para que el padre los muestre atenuados (opacity-40) o vacíos.
- **Navegación ← →** entre meses si `onCambioMes` está presente. El propio componente mantiene mes/año vía props (controlled).
- **Click simple → `onClickDia(fecha)`**.
- **Shift+click sobre una celda final → `onSeleccionRango(diaActivo, fecha)`** (orden normalizado).
- **ESC limpia `diaActivo`** (vía el padre, que controla el estado).
- **Accesibilidad**:
  - Grid con `role="grid"`, celdas con `role="gridcell"`.
  - Navegación con flechas ←↑→↓ (mueve `diaActivo`).
  - Enter/Space activa `onClickDia`.
  - `aria-label` por celda con la fecha formateada (`"Lunes 15 de junio de 2026"`).
  - Día actual marcado con `aria-current="date"`.

### Lo que NO hace

- **No conoce `dias_centro` ni nada de menús/eventos.** Es puramente un grid mensual con un `renderDia` enchufable.
- **No hace fetch.** El padre carga datos y los pasa via `renderDia`.
- **No estiliza el contenido de cada celda** más allá del marco (borde, altura mínima, padding). Color, badges, iconos van dentro de `renderDia`.

### Tests unitarios mínimos

`src/shared/components/calendario/__tests__/CalendarioMensual.test.tsx`:

1. Renderiza 42 celdas para cualquier mes.
2. La primera celda del grid es un lunes (ISODOW=1).
3. `renderDia` se llama con `dentroDelMes=true` para los días del mes y `false` para overflow.
4. `onClickDia` se invoca con la fecha correcta al hacer click.
5. `onSeleccionRango` se invoca con `desde<=hasta` cuando se hace shift+click.
6. Navegación con flechas mueve `diaActivo` y dispara navegación de mes en bordes.
7. (Opcional) `onCambioMes` se invoca al pulsar ← →.

## Pantallas y rutas

- **Admin**: `/admin/calendario` — editor del calendario. Item nuevo en sidebar admin (`SidebarNav` items).
- **Profe**: `/teacher/calendario` — vista read-only. Item nuevo en sidebar teacher.
- **Familia**: `/family/calendario` — vista read-only. Item nuevo en sidebar family.
- **Widget**: `<ProximosDiasCerradosWidget />` montado en `/family` y `/teacher` (server component dentro del layout existente, no en `/admin` por ahora).

## Componentes UI

`src/shared/components/calendario/`:

- `CalendarioMensual.tsx` (Client) — el componente genérico.
- `types.ts` — interfaces compartidas.
- `__tests__/CalendarioMensual.test.tsx` — unit tests.

`src/features/calendario-centro/components/`:

- `CalendarioCentroEditor.tsx` (Client) — wrapper específico admin: mete `<CalendarioMensual />`, maneja el popover de día y el dialog de rango, llama a server actions.
- `CalendarioCentroReadOnly.tsx` (Server) — wrapper específico read-only para profe/familia: mete `<CalendarioMensual />` con `renderDia` que pinta el tipo + observaciones tooltip, sin handlers.
- `DiaCentroPopover.tsx` (Client) — popover de edición de un día (select tipo + textarea + botones).
- `RangoCentroDialog.tsx` (Client) — dialog modal para aplicar tipo a rango.
- `LeyendaTiposDia.tsx` (Server) — leyenda de colores debajo del calendario.
- `ProximosDiasCerradosWidget.tsx` (Server) — widget compacto.

## Eventos y notificaciones

- **Push**: ninguna en F4.5a.
- **Audit log**: automático en `dias_centro` (INSERT/UPDATE/DELETE) vía trigger.
- **Realtime**: NO. El calendario es estado planificado, no operativo en tiempo real; la cardinalidad de cambios es baja (días, no segundos). Si Fase 7 (eventos) lo necesita, se añade entonces.
- **Telemetría**: `calendario_dia_marcado { tipo }`, `calendario_rango_aplicado { tipo, dias }`, `calendario_dia_eliminado {}`, `calendario_visto_admin {}`. Sin PII (no se logguea `observaciones`).

## i18n

Namespace nuevo: `calendario.*`. Estructura:

```json
{
  "calendario": {
    "title": "Calendario del centro",
    "selector": { "anterior": "Mes anterior", "siguiente": "Mes siguiente" },
    "tipos": {
      "lectivo": "Lectivo",
      "festivo": "Festivo",
      "vacaciones": "Vacaciones",
      "escuela_verano": "Escuela de verano",
      "escuela_navidad": "Escuela de navidad",
      "jornada_reducida": "Jornada reducida",
      "cerrado": "Cerrado"
    },
    "leyenda": {
      "title": "Leyenda",
      "intro": "Color por tipo de día. Los lun-vie son lectivos y los sáb-dom cerrados por defecto."
    },
    "popover_dia": {
      "title": "Día {fecha}",
      "tipo_label": "Tipo de día",
      "observaciones_label": "Observaciones (opcional)",
      "guardar": "Guardar",
      "eliminar": "Eliminar",
      "cancelar": "Cancelar",
      "confirmar_eliminar": "¿Eliminar el override de este día? Volverá al default."
    },
    "dialog_rango": {
      "title": "Aplicar tipo a un rango",
      "resumen": "Se aplicará a {dias} días ({desde} — {hasta}).",
      "aplicar": "Aplicar",
      "cancelar": "Cancelar"
    },
    "validation": {
      "fecha_invalida": "Fecha inválida.",
      "rango_invertido": "La fecha fin debe ser posterior o igual a la inicial.",
      "rango_demasiado_grande": "Máximo 366 días por aplicación.",
      "observaciones_largas": "Máximo 500 caracteres."
    },
    "toasts": {
      "guardado": "Día actualizado",
      "guardado_rango": "{dias} días actualizados",
      "eliminado": "Día restaurado al default",
      "error_guardar": "No se pudo guardar. Inténtalo de nuevo.",
      "error_eliminar": "No se pudo eliminar. Inténtalo de nuevo."
    },
    "widget_proximos_cerrados": {
      "title": "Próximos días cerrados",
      "vacio_amable": "Sin cierres previstos el próximo mes."
    },
    "vista_solo_lectura": "Vista del calendario del centro.",
    "sin_centro": "Sin centro asociado."
  },
  "admin": { "nav": { "calendario": "Calendario" } },
  "teacher": { "nav": { "calendario": "Calendario" } },
  "family": { "nav": { "calendario": "Calendario" } }
}
```

Trilingüe (es/en/va). Lint i18n verde.

## Accesibilidad

- `<CalendarioMensual />`: `role="grid"`, celdas con `role="gridcell"`, navegación con flechas ←↑→↓, Enter/Space activa, `aria-label` por celda, `aria-current="date"` para hoy.
- Cabecera de días de la semana con `role="columnheader"`.
- Color de los tipos **nunca** como único portador de información: cada celda incluye texto corto (`Festivo`, `Vacaciones`...) accesible a lectores de pantalla. La leyenda lo refuerza.
- Contraste WCAG AA en los 7 colores (verificado con tokens del design system, ADR-0008).
- Popover y dialog con focus trap, ESC cierra, focus vuelve al elemento que abrió.
- Targets táctiles ≥ 44 CSS px en mobile (celdas y botones).
- axe-core sin violations en `/admin/calendario`, `/teacher/calendario`, `/family/calendario`.

## Performance

- Query principal `getCalendarioMes` devuelve ≤ 31 filas (los overrides del mes). El cliente combina con el default calculado. <50ms p50.
- `getProximosDiasCerrados` con LIMIT 5 + índice `(centro_id, fecha)` cubre la query. <30ms p50.
- Bundle de `/admin/calendario`: <200 KB JS (Client por el editor; sidebar admin ya tira ~80 KB).
- Bundle de `/family/calendario` y `/teacher/calendario`: Client mínimo (solo el `<CalendarioMensual />` para navegación entre meses); el resto es Server. <150 KB.
- Lighthouse > 90 en performance y accesibilidad en las tres rutas.

## Telemetría

- `calendario_dia_marcado { tipo }`
- `calendario_dia_eliminado {}`
- `calendario_rango_aplicado { tipo, dias }`
- `calendario_visto_admin {}`
- `calendario_visto_profe {}`
- `calendario_visto_familia {}`
- `calendario_widget_proximos_cerrados_visto { count }`

Sin PII. **No** se loguea `observaciones` (puede contener nombres).

## Tests requeridos

**Vitest (unit/integration):**

- [ ] `dia-centro.schema.test.ts`: schemas Zod (enum, cross-field, span máximo).
- [ ] `CalendarioMensual.test.tsx`: render, click, shift+click, navegación, ARIA (≥6 casos).
- [ ] `tipo-default.test.ts`: helper TS `tipoDefaultDeFecha(fecha)` que el cliente usa para overflow (ISODOW 1-5 → lectivo, 6-7 → cerrado).

**Vitest (RLS) — `src/test/rls/dias-centro.rls.test.ts` (≥5):**

- [ ] Admin de centro A puede INSERT/UPDATE/DELETE en su centro.
- [ ] Admin de centro A NO puede INSERT/UPDATE/DELETE en centro B (rechazado por RLS).
- [ ] Profe del centro puede SELECT pero NO INSERT/UPDATE/DELETE.
- [ ] Tutor con vínculo a niño del centro puede SELECT pero NO INSERT/UPDATE/DELETE.
- [ ] Usuario sin ningún vínculo al centro NO puede SELECT.

**Vitest (functions) — `src/test/rls/tipo-de-dia.test.ts` (≥4):**

- [ ] `tipo_de_dia(centro, lunes_sin_override)` → `lectivo`.
- [ ] `tipo_de_dia(centro, domingo_sin_override)` → `cerrado`.
- [ ] `tipo_de_dia(centro, lunes_con_festivo)` → `festivo` (override gana).
- [ ] `centro_abierto(centro, festivo)` → `false`; `centro_abierto(centro, escuela_verano)` → `true`.

**Vitest (audit) — `src/test/audit/dias-centro-audit.test.ts`:**

- [ ] INSERT en `dias_centro` graba en `audit_log` con `centro_id` correcto y `valores_despues` poblado.
- [ ] DELETE graba en `audit_log` con `valores_antes` poblado y `valores_despues` NULL.

**Playwright (E2E) — `e2e/school-calendar.spec.ts`:**

- [ ] **admin-marca-festivo**: admin abre `/es/admin/calendario`, hace click en un lunes, marca `festivo`, guarda; recarga la página; la celda sigue mostrando `festivo`.
- [ ] **admin-aplica-rango**: admin selecciona un rango (shift+click), aplica `escuela_verano`, verifica que las celdas del rango cambian al nuevo tipo.

Smoke tests opcionales (mismo patrón que F4): rutas protegidas por rol y i18n en las 3 lenguas.

## Criterios de aceptación

- [ ] `npm run typecheck && npm run lint && npm test && npm run test:e2e && npm run build` todo verde.
- [ ] Tests RLS (≥5), functions (≥4), audit (≥1), unit (≥6), E2E (≥2) pasan.
- [ ] Lighthouse > 90 en performance y accesibilidad en `/admin/calendario`, `/teacher/calendario`, `/family/calendario`.
- [ ] axe-core sin violations en esas tres rutas.
- [ ] 100% claves i18n en es/en/va; lint i18n verde.
- [ ] Audit log captura INSERT/UPDATE/DELETE.
- [ ] Componente `<CalendarioMensual />` **genérico** (no conoce `dias_centro`) y con tests unitarios.
- [ ] ADR-0019 escrito.
- [ ] `docs/architecture/data-model.md` actualizado (nueva tabla + actualización de la nota de audit log).
- [ ] `docs/architecture/rls-policies.md` con sección F4.5a (excepción DELETE).
- [ ] Entrada en `docs/journey/progress.md`.
- [ ] `docs/specs/scope-ola-1.md` registra F4.5a.

## Decisiones técnicas relevantes

- **ADR-0019 — Calendario laboral "default + excepciones" + DELETE permitido como excepción.** Modelo: persistir solo overrides; default lun-vie/sáb-dom calculado por helper SQL. Justificación: 30-50 filas/año/centro vs 365, alta sin marcar todo el año. Y DELETE permitido en `dias_centro` porque la "ausencia de fila" tiene significado (vuelta al default), a diferencia del resto de tablas operativas donde DELETE bloqueado + UPDATE con prefijo.

- **Componente `<CalendarioMensual />` agnóstico de dominio en `src/shared/`.** Igual que `<PaseDeListaTable />` (ADR-0014), se construye genérico desde día 1 para que F7 (eventos) lo reuse sin tocarlo. La API `renderDia + onClickDia + onSeleccionRango` cubre todos los casos previstos en Ola 1.

- **Realtime no aplica.** El calendario es planificación, no operación en tiempo real. Si F7 lo requiere para eventos, se añade entonces — coste de añadirlo a posteriori es bajo (`ALTER PUBLICATION supabase_realtime ADD TABLE …`).

- **Sin granularidad por aula.** El calendario es del centro entero. ANAIA tiene 5 aulas que comparten festivos y vacaciones; granularidad por aula sería complejidad sin uso real.

## Referencias

- ADR-0007 — RLS recursion avoidance (patrón helpers `SECURITY DEFINER STABLE`).
- ADR-0008 — Design system (colores del calendario, tokens existentes).
- ADR-0011 — Timezone Europe/Madrid (`hoy_madrid()` se reutiliza para "próximos días").
- ADR-0014 — Pase de lista reutilizable (mismo patrón "componente compartido en `shared/`").
- ADR-0016 — Día cerrado transversal (la ventana de edición de F3/F4 no aplica aquí — el calendario sí es editable retrospectivamente).

---

**Workflow:**

1. Spec `draft`.
2. Responsable revisa y aprueba (→ `approved`).
3. Migración + helpers SQL + RLS + `<CalendarioMensual />` + tests (Checkpoint B).
4. Server actions + UI admin + UI read-only + i18n + E2E (Checkpoint C).
5. Merge + deploy (→ `done`).
