---
feature: daily-agenda
wave: 1
phase: 3
status: draft
priority: critical
last_updated: 2026-05-14
related_adrs: [ADR-0011, ADR-0012, ADR-0013]
related_specs: [core-entities, pedagogical-data]
---

# Spec — Agenda diaria + bienestar (Fase 3)

> Pantalla más usada de NIDO: la profe la abre 50 veces al día, la familia la mira al recoger al niño. Diferencial principal frente a Tyra / Schooltivity.

## Resumen ejecutivo

Implementa la **agenda diaria por niño**: una fila padre `agendas_diarias` (humor, observaciones generales) más cuatro tablas hijo (`comidas`, `biberones`, `suenos`, `deposiciones`) que registran eventos puntuales. La profe edita la agenda **solo durante el mismo día calendario hora Madrid**; al cambiar el día queda inmutable para todos por RLS (correcciones a posteriori, vía SQL con audit forzado). La familia ve el día actual en **Realtime** y dispone de histórico ilimitado.

## Contexto

ANAIA pasa de papel a digital con NIDO. La agenda diaria es lo único que las familias miran cada tarde: si esto no es rápido, claro y vivo, NIDO no vale. Decisiones de modelo (tablas separadas), ventana de edición (mismo día), y Realtime ya están fijadas en el prompt del responsable. Los datos médicos y pedagógicos (Fases 2 y 2.6) ya existen y se referencian como contexto en la ficha lateral. La asistencia (Fase 4) y mensajería (Fase 5) llegan después; la agenda no depende de ellas.

## User stories

- **US-18:** Como **profe**, quiero ver los niños matriculados en mis aulas en una sola pantalla con el resumen del día y poder abrir cada uno para rellenar comidas, biberones, sueños y deposiciones, sin recargar.
- **US-19:** Como **profe**, quiero que la app me impida editar la agenda de días anteriores para no estropear datos por error y para que la familia tenga garantía de inmutabilidad.
- **US-20:** Como **profe**, quiero ver los datos médicos y pedagógicos relevantes (alergias, lactancia, control de esfínteres) al lado del formulario, sin tener que salir de la agenda.
- **US-21:** Como **tutor legal con permiso de agenda**, quiero ver el día actual del niño actualizándose en vivo mientras la profe rellena, sin pulsar recargar.
- **US-22:** Como **tutor legal**, quiero navegar al histórico de agendas pasadas para revisar la evolución (por ejemplo, cómo durmió la semana pasada).
- **US-23:** Como **tutor autorizado sin permiso de agenda**, quiero un mensaje claro indicando que no tengo acceso y a quién pedirlo, en vez de un 404.
- **US-24:** Como **admin del centro**, quiero ver y leer las agendas de cualquier aula y día. (No editar desde UI: si hay que corregir, se hace por SQL con audit forzado.)
- **US-25:** Como **auditor / DPD**, quiero que cada cambio en la agenda quede registrado en `audit_log` con valor antes/después, usuario y `centro_id`.

## Alcance

**Dentro:**

- 5 tablas nuevas (`agendas_diarias`, `comidas`, `biberones`, `suenos`, `deposiciones`) con sus ENUMs.
- Helper RLS `public.dentro_de_ventana_edicion(fecha)` (Europe/Madrid hardcoded — ver ADR-0011).
- Políticas RLS: SELECT (admin / profe del aula actual / tutor con flag), INSERT+UPDATE (admin / profe del aula actual SOLO si ventana abierta), DELETE bloqueado a todos.
- Audit log automático en las 5 tablas (heredando `audit_trigger_function()` de Fase 2 — ampliada con las nuevas tablas).
- Server actions CRUD para los 4 tipos de evento + UPSERT de la fila padre.
- UI profe (`/teacher/aula/[id]`): cabecera con selector de día, lista de niños del aula, panel expandible con 5 secciones, Realtime.
- UI familia (`/family/nino/[id]`): nueva tab "Agenda" con selector de día (histórico ilimitado hacia atrás, hasta hoy hacia delante), Realtime para hoy.
- Gating de permiso `puede_ver_agenda` en `vinculos_familiares.permisos` (default `true` para tutores legales; el flag ya se backfill-eará en esta migración para vínculos pre-existentes).
- i18n trilingüe completa (es/en/va) para todas las nuevas claves.
- ADRs 0011, 0012, 0013.
- Tests RLS (≥8), audit (≥1), schemas (≥5 archivos), Playwright E2E (≥3).

**Fuera (no se hace aquí):**

- **Asistencia / check-in B / check-out** — Fase 4.
- **Notificaciones push** al cerrar la agenda — Fase 5 (cuando exista la infraestructura push). En Fase 3 no se "cierra" la agenda; queda viva hasta que cambia el día.
- **Estadísticas y gráficos** de evolución (cuántas siestas la última semana, etc.) — Fase 9 (Informes).
- **Bulk-edit** para varios niños a la vez (clase entera comió lo mismo) — Ola 2.
- **Plantillas de día** (ej. comida planificada por la cocina) — Ola 2.
- **Edición de histórico desde admin UI** — fuera del alcance Ola 1. Si admin debe corregir un evento pasado, ejecuta SQL directo (queda en `audit_log`).

## Comportamientos detallados

### B17 — Apertura de la agenda del aula por la profe

**Pre-condiciones:**

- Usuario autenticado con rol `profe` y `profes_aulas` activo (`fecha_fin IS NULL`) sobre el aula.
- El curso del aula tiene estado `activo`.

**Flujo:**

1. Ruta `/teacher/aula/[id]` carga server-side `get-agendas-aula-del-dia(aulaId, fecha=hoy)`.
2. Server query devuelve, por cada niño con matrícula activa en esa aula y curso activo, la fila `agendas_diarias` del día (puede no existir aún) + conteos de eventos por tipo + alertas (alergias graves, medicación) leídas con `get_info_medica_emergencia` y `datos_pedagogicos_nino`.
3. UI renderiza la lista de cards colapsadas por defecto. Si la profe abre una, se carga `get-agenda-del-dia(ninoId, fecha)` con todos los eventos.
4. Una subscription Supabase Realtime canal `agenda-aula-${aulaId}` se abre client-side y se filtra por `agenda_id IN (...ids del aula)`.

**Post-condiciones:**

- Profe ve hasta el último cambio sin recargar.

### B18 — Rellenado / edición de un evento (comida / biberón / sueño / deposición)

**Pre-condiciones:**

- Profe en la pantalla `/teacher/aula/[id]` con la tarjeta de un niño expandida.
- `dentro_de_ventana_edicion(fecha) = TRUE` (es decir, la fecha que está mirando es **hoy** hora Madrid).

**Flujo (añadir evento):**

1. Profe pulsa "Añadir comida" (o biberón/sueño/deposición).
2. Modal/inline-row con form RHF + zodResolver. Campos según tabla (ver "Validaciones").
3. Submit → server action `add-comida` (o equivalente). Resultado tipado `{success, data} | {success, error}`.
4. Si no existe aún `agendas_diarias` para `(nino_id, fecha)`, server action hace **UPSERT idempotente** primero antes de insertar el evento (lo veremos en B19).
5. Trigger de audit graba INSERT.
6. Realtime broadcast → familia y otras profes ven la nueva fila al instante.

**Flujo (editar evento existente):**

1. Profe pulsa el lápiz sobre la fila del evento.
2. Form en sitio. Submit → server action `update-comida(id, patch)`.
3. Trigger de audit graba UPDATE con `valores_antes` y `valores_despues`.

**Marcar como erróneo (en vez de DELETE):** RLS bloquea DELETE para todos. Cada evento (comida, biberón, sueño, deposición) tiene en su fila un botón **"Marcar como erróneo"** (icono triangulito + texto). Al confirmar (modal de confirmación con i18n `agenda.anular.confirm_title` / `confirm_descripcion` / `confirm_si` / `cancelar`):

1. Server action `marcar-evento-erroneo(tabla, id)` ejecuta `UPDATE` poniendo `observaciones = '[anulado] ' || COALESCE(observaciones, '')`. Idempotente: si ya empieza por `'[anulado] '`, no se duplica el prefijo.
2. Trigger de audit deja constancia (valores antes/después).
3. Realtime propaga.

**Render visual del evento anulado:**

- Fila completa con `opacity-50` + `line-through` sobre los campos numéricos / enums.
- Badge `<Badge variant="muted">{t('agenda.estado.anulado')}</Badge>` antepuesto al texto.
- Botón "Marcar como erróneo" sustituido por texto deshabilitado "Anulado el {fecha/hora del último update}" — no se puede des-anular desde UI (decisión: si se anuló por error, se crea evento nuevo correcto).
- Familia ve el evento anulado igual de visible (no desaparece): preserva trazabilidad y evita que cada profe invente su propio formato (`"borrar"`, `"ignorar"`, etc.).

**Detección programática:** un evento está anulado si `starts_with(observaciones, '[anulado] ')`. Sin columna boolean dedicada: la sentinela en `observaciones` es suficiente para Fase 3 y mantiene el modelo flat. Si se vuelve común (Fase 9+), podemos migrar a `anulado_en timestamptz NULL`.

**Post-condiciones:**

- Audit log con la operación.
- Realtime propagado.
- Evento visible para todos pero claramente marcado como inválido.

### B19 — Idempotencia de creación de la fila padre

`agendas_diarias` tiene `UNIQUE (nino_id, fecha)`. Las server actions que añaden eventos hijo hacen `INSERT ... ON CONFLICT (nino_id, fecha) DO NOTHING RETURNING id` antes del insert hijo. Si la fila padre no existe, la crea con `estado_general=NULL`, `humor=NULL`, `observaciones_generales=NULL`. Esto permite que cualquier evento sea el "primer toque" sin lógica especial en la UI.

### B20 — Edición de la fila padre (humor + observaciones generales)

Sección "General" del panel expandido. RHF debounced (1.2s tras último cambio) → server action `upsert-agenda-cabecera(ninoId, fecha, patch)`. Misma ventana de edición que los hijos.

### B21 — Ventana de edición (RLS-enforced)

A las 00:00:00 hora local Madrid del día siguiente, **todos los INSERT/UPDATE sobre las 5 tablas fallan por RLS para el día anterior**, incluidos admins. La UI:

- Si el usuario abre día != hoy hora Madrid → todos los inputs en `disabled`, badge "Día cerrado" visible junto al selector de fecha.
- Si el usuario está rellenando a las 23:59 y son las 00:00 antes de hacer submit → la server action devuelve `{success: false, error: 'agenda.errors.fuera_de_ventana'}` (la RLS ha rechazado el INSERT). La UI muestra un toast y refresca a estado read-only.

### B22 — Vista familia con Realtime y gating de permiso

**Pre-condiciones:**

- Tutor autenticado con `vinculos_familiares` al niño.

**Flujo:**

1. Ruta `/family/nino/[id]`. Server query `permisos_para_nino(usuarioId, ninoId)` lee la fila `vinculos_familiares` (cacheada per-request) y obtiene `permisos.puede_ver_agenda`.
2. Si `false` → tab "Agenda" muestra `EmptyState` con i18n `family.nino.agenda.sin_permiso.{title,description,cta_admin}`.
3. Si `true` → render `<AgendaFamiliaView>` con selector de día (ilimitado hacia atrás, hasta hoy hacia delante). Por defecto carga **hoy**.
4. Cards colapsables: General / Comidas / Biberones / Sueños / Deposiciones. Conteos arriba, detalle al expandir.
5. Subscription Realtime canal `agenda-nino-${ninoId}` filtrado por `nino_id`, **solo activo si fecha seleccionada == hoy** (para histórico no tiene sentido).

**Post-condiciones:**

- Family ve cambios sin pulsar nada.

### B23 — Selector de día (cabecera ambas vistas)

Componente compartido `<AgendaDayPicker>`:

- Flecha izquierda: día - 1 (sin límite atrás).
- Texto central: `today | weekday, DD de MMMM` (i18n).
- Flecha derecha: día + 1, **deshabilitada si día visible == hoy hora Madrid**.
- "Volver a hoy": chip visible solo si día != hoy.

Para la **profe**: si selecciona un día distinto a hoy, los inputs quedan disabled (B21). Para la **familia**: lo mismo (siempre es read-only) + Realtime se desconecta.

### B24 — Agrupación visual y conteos rápidos

En la vista profe, la card colapsada de cada niño muestra: foto/iniciales, nombre, badges con counts (`5🍽 · 2🍼 · 1😴 · 3🚼`), y badges de alerta médica si `alergias_graves` no NULL o `medicacion_habitual` no vacío. Datos pedagógicos (lactancia, control de esfínteres) visibles al expandir en una pestaña secundaria informativa.

### B25 — Concurrencia entre profes

Dos profes del mismo aula pueden editar a la vez. Política optimista: cada submit es independiente (INSERT crea fila nueva; UPDATE actualiza por `id`). La subscription Realtime entrega al otro cliente la última versión. Si dos profes editan el mismo evento simultáneamente (caso raro), gana la última escritura — sin merge de campos, sin lock. Audit log conserva el rastro completo.

## Casos edge

- **Sin datos previos para hoy**: tarjeta del niño muestra "Sin registros aún" en cada sección. Conteos a 0. Botón "Añadir" visible. Click en "Añadir" hace upsert de la fila padre antes del INSERT hijo.
- **Sin permisos** (familia o profe que se le quitó la asignación a mitad de día): la próxima query/subscription Realtime devuelve vacío. El cliente redirige a `/family` o `/teacher` con toast i18n.
- **Sin conexión**: server actions devuelven error → toast i18n "agenda.errors.conexion". Subscription Realtime se reintenta automáticamente cuando vuelve la red.
- **Datos inválidos**:
  - `biberones.cantidad_ml > 500` → Zod rechaza, mensaje i18n.
  - `suenos.hora_fin <= hora_inicio` → Zod superRefine rechaza.
  - `comidas.descripcion > 500` chars → Zod rechaza.
  - Hora con formato no `HH:MM` → Zod rechaza, mensaje i18n.
  - Día seleccionado > hoy en el picker → la flecha está disabled, pero si por hack alguien lo intenta, la server action rechaza con `agenda.errors.dia_futuro_invalido`.
- **Concurrencia**: ver B25.
- **Permisos cambiados mientras se usa**: refresco lazy en próxima interacción. Si la subscription Realtime entrega un evento que ya no es accesible (RLS lo filtra a 0 filas), no hay desuscripción manual; el siguiente reload limpia el estado.
- **Idiomas**:
  - Fecha en cabecera: `Intl.DateTimeFormat` con locale activo (es/en/va).
  - Enums (lactancia, calidad, etc.): claves i18n por enum (`agenda.comidas.cantidad.todo`).
  - Pluralización: `Intl.PluralRules` o claves explícitas (`agenda.contador.comidas_one` / `_other`).
- **Borrado y soft delete**: en estas tablas **NO hay `deleted_at`**. Decisión consciente (ver ADR-0012): las agendas son un registro histórico, no se borran. Si se borra un niño (soft delete en `ninos`), la agenda permanece (ON DELETE RESTRICT en `agendas_diarias.nino_id`).
- **Datos sensibles**: `observaciones` puede contener PII clínico ligero ("hoy ha vomitado tras comer"). Se aplica audit log normal. No se cifra (decisión: el riesgo es bajo y el coste alto; las observaciones se eliminan retroactivamente si la familia ejerce derecho al olvido, igual que el resto de tablas operativas).
- **Día cambia mientras la profe edita**: ver B21.
- **Niño con matrícula en curso `cerrado`**: la vista profe NO lo muestra (filtro `curso_academico_id IN cursos activos`). Si por algún motivo aparece, los inputs estarán disabled.
- **Niño sin matrícula activa en el aula consultada**: no aparece en la lista.

## Validaciones (Zod)

Cinco schemas en `src/features/agenda-diaria/schemas/agenda-diaria.ts`:

```typescript
import { z } from 'zod'

// Helper común
const horaSchema = z.string().regex(/^\d{2}:\d{2}$/, 'agenda.validation.hora_invalida')
const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'agenda.validation.fecha_invalida')
const observacionesSchema = z.string().trim().max(500, 'agenda.validation.observaciones_largas')

// ENUMs
export const estadoGeneralEnum = z.enum(['bien', 'regular', 'mal', 'mixto'])
export const humorEnum = z.enum(['feliz', 'tranquilo', 'inquieto', 'triste', 'cansado'])
export const momentoComidaEnum = z.enum(['desayuno', 'media_manana', 'comida', 'merienda'])
export const cantidadComidaEnum = z.enum(['todo', 'mayoria', 'mitad', 'poco', 'nada'])
export const tipoBiberonEnum = z.enum(['materna', 'formula', 'agua', 'infusion', 'zumo'])
export const calidadSuenoEnum = z.enum(['profundo', 'tranquilo', 'intermitente', 'nada'])
export const tipoDeposicionEnum = z.enum(['pipi', 'caca', 'mixto'])
export const consistenciaDeposicionEnum = z.enum(['normal', 'dura', 'blanda', 'diarrea'])
export const cantidadDeposicionEnum = z.enum(['mucha', 'normal', 'poca'])

// Cabecera (1 por nino/fecha)
export const agendaCabeceraInputSchema = z.object({
  nino_id: z.string().uuid(),
  fecha: fechaSchema,
  estado_general: estadoGeneralEnum.nullable(),
  humor: humorEnum.nullable(),
  observaciones_generales: observacionesSchema.nullable(),
})

// Comida
export const comidaInputSchema = z.object({
  agenda_id: z.string().uuid(),
  momento: momentoComidaEnum,
  hora: horaSchema.nullable(),
  cantidad: cantidadComidaEnum,
  descripcion: observacionesSchema.nullable(),
  observaciones: observacionesSchema.nullable(),
})

// Biberón
export const biberonInputSchema = z.object({
  agenda_id: z.string().uuid(),
  hora: horaSchema,
  cantidad_ml: z
    .number()
    .int()
    .min(0, 'agenda.validation.ml_min')
    .max(500, 'agenda.validation.ml_max'),
  tipo: tipoBiberonEnum,
  tomado_completo: z.boolean().default(true),
  observaciones: observacionesSchema.nullable(),
})

// Sueño
export const suenoInputSchema = z
  .object({
    agenda_id: z.string().uuid(),
    hora_inicio: horaSchema,
    hora_fin: horaSchema.nullable(),
    calidad: calidadSuenoEnum.nullable(),
    observaciones: observacionesSchema.nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.hora_fin && v.hora_fin <= v.hora_inicio) {
      ctx.addIssue({
        code: 'custom',
        path: ['hora_fin'],
        message: 'agenda.validation.sueno_fin_anterior',
      })
    }
  })

// Deposición
export const deposicionInputSchema = z
  .object({
    agenda_id: z.string().uuid(),
    hora: horaSchema.nullable(),
    tipo: tipoDeposicionEnum,
    consistencia: consistenciaDeposicionEnum.nullable(),
    cantidad: cantidadDeposicionEnum,
    observaciones: observacionesSchema.nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.tipo === 'pipi' && v.consistencia) {
      ctx.addIssue({
        code: 'custom',
        path: ['consistencia'],
        message: 'agenda.validation.consistencia_solo_caca',
      })
    }
  })
```

Las server actions reciben `Input` (sin `id`) en INSERT y `Partial<Input> & { id: string }` en UPDATE.

## Modelo de datos afectado

**Tablas nuevas:**

1. **`agendas_diarias`** — `id uuid PK`, `nino_id uuid NOT NULL REFERENCES ninos ON DELETE RESTRICT`, `fecha date NOT NULL`, `estado_general estado_general_agenda NULL`, `humor humor_agenda NULL`, `observaciones_generales text NULL` (max 500 via CHECK), `created_at timestamptz DEFAULT now()`, `updated_at timestamptz DEFAULT now()`. UNIQUE(nino_id, fecha). Trigger `set_updated_at`. Trigger audit. CHECK `length(observaciones_generales) <= 500`.

2. **`comidas`** — `id uuid PK`, `agenda_id uuid NOT NULL REFERENCES agendas_diarias ON DELETE CASCADE`, `momento momento_comida NOT NULL`, `hora time NULL`, `cantidad cantidad_comida NOT NULL`, `descripcion text NULL` (CHECK <=500), `observaciones text NULL` (CHECK <=500), `created_at`, `updated_at`. Trigger updated_at + audit.

3. **`biberones`** — `id uuid PK`, `agenda_id uuid NOT NULL REFERENCES agendas_diarias ON DELETE CASCADE`, `hora time NOT NULL`, `cantidad_ml smallint NOT NULL CHECK (cantidad_ml BETWEEN 0 AND 500)`, `tipo tipo_biberon NOT NULL`, `tomado_completo boolean NOT NULL DEFAULT true`, `observaciones text NULL` (CHECK <=500), `created_at`, `updated_at`. Trigger updated_at + audit.

4. **`suenos`** — `id uuid PK`, `agenda_id uuid NOT NULL REFERENCES agendas_diarias ON DELETE CASCADE`, `hora_inicio time NOT NULL`, `hora_fin time NULL`, `calidad calidad_sueno NULL`, `observaciones text NULL` (CHECK <=500), `created_at`, `updated_at`. CHECK `hora_fin IS NULL OR hora_fin > hora_inicio`. Trigger updated_at + audit.

5. **`deposiciones`** — `id uuid PK`, `agenda_id uuid NOT NULL REFERENCES agendas_diarias ON DELETE CASCADE`, `hora time NULL`, `tipo tipo_deposicion NOT NULL`, `consistencia consistencia_deposicion NULL`, `cantidad cantidad_deposicion NOT NULL`, `observaciones text NULL` (CHECK <=500), `created_at`, `updated_at`. Trigger updated_at + audit.

**ENUMs nuevos** (9): `estado_general_agenda`, `humor_agenda`, `momento_comida`, `cantidad_comida`, `tipo_biberon`, `calidad_sueno`, `tipo_deposicion`, `consistencia_deposicion`, `cantidad_deposicion`.

**Índices:**

- `agendas_diarias`: UNIQUE(nino_id, fecha); índice secundario `(fecha DESC)` para histórico familia.
- `comidas`, `biberones`, `suenos`, `deposiciones`: índice `(agenda_id)` (B-tree).

**Tablas modificadas:**

- `vinculos_familiares.permisos` (JSONB): backfill de clave `puede_ver_agenda` (default `true` para vínculos `tutor_legal_*`, `false` para `autorizado`). Idempotente (`WHERE NOT (permisos ? 'puede_ver_agenda')`).
- `audit_trigger_function()`: añadir branch para las 5 tablas nuevas (derivar `centro_id` vía `agenda_id → nino_id → centros`).

**Tablas consultadas:**

- `ninos` (centro_id, foto, nombre, apellidos, fecha_nacimiento).
- `info_medica_emergencia` (alergias_graves, medicacion_habitual) — solo para alerta UI; lectura vía `get_info_medica_emergencia()` SECURITY DEFINER, no SELECT directo.
- `datos_pedagogicos_nino` (lactancia_estado, control_esfinteres) — informativo en panel profe.
- `matriculas` (para filtrar niños activos del aula).
- `aulas`, `cursos_academicos` (filtros activos).
- `vinculos_familiares` (permiso `puede_ver_agenda`).

## Políticas RLS

Antes de las políticas, **helper nuevo**:

```sql
CREATE OR REPLACE FUNCTION public.dentro_de_ventana_edicion(p_fecha date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_fecha = (now() AT TIME ZONE 'Europe/Madrid')::date;
$$;
```

Y un helper auxiliar para derivar `centro_id` de la agenda padre desde tablas hijo (evita recursión RLS, patrón ADR-0007):

```sql
CREATE OR REPLACE FUNCTION public.centro_de_agenda(p_agenda_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT n.centro_id
  FROM public.agendas_diarias a
  JOIN public.ninos n ON n.id = a.nino_id
  WHERE a.id = p_agenda_id;
$$;

CREATE OR REPLACE FUNCTION public.nino_de_agenda(p_agenda_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT nino_id FROM public.agendas_diarias WHERE id = p_agenda_id;
$$;

CREATE OR REPLACE FUNCTION public.fecha_de_agenda(p_agenda_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT fecha FROM public.agendas_diarias WHERE id = p_agenda_id;
$$;
```

### Política patrón para `agendas_diarias`

```sql
ALTER TABLE public.agendas_diarias ENABLE ROW LEVEL SECURITY;

-- SELECT: admin, profe del aula actual, o tutor con permiso
CREATE POLICY agenda_select
ON public.agendas_diarias
FOR SELECT
USING (
  public.es_admin(public.centro_de_nino(nino_id))
  OR public.es_profe_de_nino(nino_id)
  OR public.tiene_permiso_sobre(nino_id, 'puede_ver_agenda')
);

-- INSERT: admin OR profe del aula actual; ambos requieren ventana abierta
CREATE POLICY agenda_insert
ON public.agendas_diarias
FOR INSERT
WITH CHECK (
  public.dentro_de_ventana_edicion(fecha)
  AND (
    public.es_admin(public.centro_de_nino(nino_id))
    OR public.es_profe_de_nino(nino_id)
  )
);

-- UPDATE: idem; ventana evaluada sobre fila antigua Y nueva (no permitimos mover de día)
CREATE POLICY agenda_update
ON public.agendas_diarias
FOR UPDATE
USING (
  public.dentro_de_ventana_edicion(fecha)
  AND (
    public.es_admin(public.centro_de_nino(nino_id))
    OR public.es_profe_de_nino(nino_id)
  )
)
WITH CHECK (
  public.dentro_de_ventana_edicion(fecha)
  AND (
    public.es_admin(public.centro_de_nino(nino_id))
    OR public.es_profe_de_nino(nino_id)
  )
);

-- DELETE: nadie por RLS (default DENY ALL)
```

### Patrón para tablas hijo (idéntico, derivando vía `agenda_id`)

```sql
ALTER TABLE public.comidas ENABLE ROW LEVEL SECURITY;

CREATE POLICY comida_select
ON public.comidas
FOR SELECT
USING (
  public.es_admin(public.centro_de_agenda(agenda_id))
  OR public.es_profe_de_nino(public.nino_de_agenda(agenda_id))
  OR public.tiene_permiso_sobre(public.nino_de_agenda(agenda_id), 'puede_ver_agenda')
);

CREATE POLICY comida_insert
ON public.comidas
FOR INSERT
WITH CHECK (
  public.dentro_de_ventana_edicion(public.fecha_de_agenda(agenda_id))
  AND (
    public.es_admin(public.centro_de_agenda(agenda_id))
    OR public.es_profe_de_nino(public.nino_de_agenda(agenda_id))
  )
);

CREATE POLICY comida_update
ON public.comidas
FOR UPDATE
USING (
  public.dentro_de_ventana_edicion(public.fecha_de_agenda(agenda_id))
  AND (
    public.es_admin(public.centro_de_agenda(agenda_id))
    OR public.es_profe_de_nino(public.nino_de_agenda(agenda_id))
  )
)
WITH CHECK (
  public.dentro_de_ventana_edicion(public.fecha_de_agenda(agenda_id))
  AND (
    public.es_admin(public.centro_de_agenda(agenda_id))
    OR public.es_profe_de_nino(public.nino_de_agenda(agenda_id))
  )
);
```

Repetir idéntico patrón para `biberones`, `suenos`, `deposiciones`.

> **Nota sobre admin sin UI**: la decisión de "admin no edita por UI" se enforza por **producto** (no hay formulario admin para esta fase). RLS sí permite admin para no romper escenarios de migración / corrección por SQL. Si admin necesita corregir histórico, lo hará vía `psql` con `SET LOCAL ROLE service_role` (que **bypassa** las políticas) **o** vía un futuro `function admin_corregir_evento(...)` SECURITY DEFINER que registre razón en `observaciones` con prefijo `[admin-corrige]`. Esto último queda fuera de Fase 3.

### Realtime

Habilitar las 5 tablas en la publication `supabase_realtime`:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.agendas_diarias, public.comidas, public.biberones, public.suenos, public.deposiciones;
```

Las RLS de SELECT se aplican también a las notificaciones Realtime — los clientes solo reciben eventos sobre filas que su rol puede leer.

> **Nota de seguridad (importante):** el filtrado client-side de las notificaciones por `aula_id` (vista profe) o `nino_id` (vista familia) es **cosmético**, no de seguridad. La seguridad real la garantiza la RLS de `SELECT` sobre las 5 tablas, que **Supabase aplica también a las notificaciones Realtime** antes de entregarlas al cliente: un cliente solo recibe eventos `INSERT/UPDATE` cuyas filas su rol puede leer. Manipular el filtro client-side desde devtools (cambiar `aula_id` o `nino_id` en la subscription) **no** expone notificaciones de aulas o niños no autorizados — el backend las descarta. Esto vale tanto para los tests de RLS como para auditorías RGPD.

## Audit log

Extender `audit_trigger_function()` para soportar las 5 tablas. El centro se deriva así:

```sql
ELSIF TG_TABLE_NAME = 'agendas_diarias' THEN
  v_centro_id := public.centro_de_nino(COALESCE((NEW).nino_id, (OLD).nino_id));
ELSIF TG_TABLE_NAME IN ('comidas', 'biberones', 'suenos', 'deposiciones') THEN
  v_centro_id := public.centro_de_agenda(COALESCE((NEW).agenda_id, (OLD).agenda_id));
```

Y aplicar el trigger `AFTER INSERT OR UPDATE OR DELETE ... EXECUTE FUNCTION audit_trigger_function()` en cada una. (DELETE no se ejecuta nunca por RLS, pero el trigger se deja registrado por completitud.)

Actualizar `docs/architecture/data-model.md` para añadir las 5 tablas a la lista de "Triggers Postgres para audit log automático".

## Pantallas y rutas

- `/teacher/aula/[id]` — **reescritura completa** del placeholder actual. Server Component que carga aula + lista de niños activos + agendas de hoy + counts. Anidada con un Client Component `<AgendaAulaCliente>` que maneja state + Realtime + UI expandible.
- `/family/nino/[id]` — **añadir** una nueva tab "Agenda" (a continuación de Datos pedagógicos). Renderiza `<AgendaFamiliaView>` si `puede_ver_agenda`, `<AgendaFamiliaSinPermiso>` si no.

Sin nuevas rutas top-level.

## Componentes UI

`src/features/agenda-diaria/components/`:

- `AgendaAulaCliente.tsx` (Client) — wrapper de la página profe: state de "qué niño está expandido", filtro de día, subscription Realtime.
- `AgendaDayPicker.tsx` (Client) — selector de fecha compartido.
- `NinoCard.tsx` (Server-friendly, props pasados desde Cliente) — card colapsable.
- `NinoAgendaPanel.tsx` (Client) — panel expandido con 5 secciones.
- `SeccionCabecera.tsx`, `SeccionComidas.tsx`, `SeccionBiberones.tsx`, `SeccionSuenos.tsx`, `SeccionDeposiciones.tsx` (Client) — cada uno con su form RHF + lista de eventos.
- `EventoForm.tsx` × 4 (Client) — formularios reutilizables (uno por tipo).
- `BadgeAlertasMedicas.tsx` (Server) — derivado de info médica + pedagógica.
- `AgendaFamiliaView.tsx` (Client) — vista familia con Realtime.
- `AgendaFamiliaSinPermiso.tsx` (Server) — empty state.

## Eventos y notificaciones

- **Push**: NO en Fase 3. Llega en Fase 5 cuando exista infraestructura push.
- **Audit log**: automático por triggers en las 5 tablas (cambios INSERT/UPDATE; DELETE bloqueado).
- **Realtime**: subscription Supabase `postgres_changes` sobre las 5 tablas. Filtrado client-side por aula (profe) o por niño (familia).
- **Telemetría custom**: `agenda_evento_creado`, `agenda_evento_editado`, `agenda_vista_familia` (sin PII).

## i18n

Namespaces nuevos en `messages/{es,en,va}.json` bajo la clave raíz `agenda` (vista profe), `family.nino.agenda` (vista familia) y `teacher.aula` (vista del aula).

Estructura prevista (extracto en español; la traducción en/va se hará en la implementación):

```json
{
  "agenda": {
    "title": "Agenda diaria",
    "dia_cerrado": "Día cerrado",
    "volver_a_hoy": "Volver a hoy",
    "selector": { "anterior": "Día anterior", "siguiente": "Día siguiente" },
    "sin_registros": "Sin registros aún",
    "anadir": {
      "comida": "Añadir comida",
      "biberon": "Añadir biberón",
      "sueno": "Añadir siesta",
      "deposicion": "Añadir deposición"
    },
    "secciones": {
      "general": "General",
      "comidas": "Comidas",
      "biberones": "Biberones",
      "suenos": "Sueños",
      "deposiciones": "Deposiciones"
    },
    "campos": {
      "estado_general": "Estado general",
      "humor": "Humor",
      "observaciones_generales": "Observaciones del día",
      "momento": "Momento",
      "hora": "Hora",
      "cantidad": "Cantidad",
      "descripcion": "Descripción",
      "observaciones": "Observaciones",
      "cantidad_ml": "Cantidad (ml)",
      "tipo": "Tipo",
      "tomado_completo": "Tomó todo",
      "hora_inicio": "Inicio",
      "hora_fin": "Fin",
      "calidad": "Calidad",
      "consistencia": "Consistencia"
    },
    "estado_general_opciones": {
      "bien": "Bien",
      "regular": "Regular",
      "mal": "Mal",
      "mixto": "Mixto"
    },
    "humor_opciones": {
      "feliz": "Feliz",
      "tranquilo": "Tranquilo",
      "inquieto": "Inquieto",
      "triste": "Triste",
      "cansado": "Cansado"
    },
    "momento_opciones": {
      "desayuno": "Desayuno",
      "media_manana": "Media mañana",
      "comida": "Comida",
      "merienda": "Merienda"
    },
    "cantidad_comida_opciones": {
      "todo": "Todo",
      "mayoria": "Mayoría",
      "mitad": "Mitad",
      "poco": "Poco",
      "nada": "Nada"
    },
    "tipo_biberon_opciones": {
      "materna": "Leche materna",
      "formula": "Fórmula",
      "agua": "Agua",
      "infusion": "Infusión",
      "zumo": "Zumo"
    },
    "calidad_sueno_opciones": {
      "profundo": "Profundo",
      "tranquilo": "Tranquilo",
      "intermitente": "Intermitente",
      "nada": "No durmió"
    },
    "tipo_deposicion_opciones": { "pipi": "Pipí", "caca": "Caca", "mixto": "Mixto" },
    "consistencia_opciones": {
      "normal": "Normal",
      "dura": "Dura",
      "blanda": "Blanda",
      "diarrea": "Diarrea"
    },
    "cantidad_deposicion_opciones": { "mucha": "Mucha", "normal": "Normal", "poca": "Poca" },
    "validation": {
      "hora_invalida": "Hora inválida. Formato HH:MM.",
      "fecha_invalida": "Fecha inválida.",
      "observaciones_largas": "Máximo 500 caracteres.",
      "ml_min": "La cantidad no puede ser negativa.",
      "ml_max": "Máximo 500 ml.",
      "sueno_fin_anterior": "La hora de fin debe ser posterior al inicio.",
      "consistencia_solo_caca": "La consistencia solo aplica si hay caca."
    },
    "errors": {
      "fuera_de_ventana": "Ya no puedes editar este día.",
      "dia_futuro_invalido": "No se puede editar el futuro.",
      "guardar_fallo": "No se pudo guardar. Inténtalo de nuevo.",
      "conexion": "Sin conexión. Reintentando…"
    },
    "alertas": {
      "alergia_grave": "Alergia grave",
      "medicacion": "Medicación"
    },
    "estado": { "anulado": "Anulado" },
    "anular": {
      "boton": "Marcar como erróneo",
      "ya_anulado": "Anulado",
      "confirm_title": "Marcar evento como erróneo",
      "confirm_descripcion": "El evento quedará tachado y visible para todos como anulado. No se podrá deshacer desde la app. ¿Continuar?",
      "confirm_si": "Sí, marcar como erróneo",
      "cancelar": "Cancelar"
    },
    "guardando": "Guardando…",
    "guardado": "Guardado"
  },
  "teacher": {
    "aula": {
      "titulo": "Aula {nombre}",
      "ninos_vacios": "No hay niños matriculados en esta aula."
    }
  },
  "family": {
    "nino": {
      "tabs": { "agenda": "Agenda" },
      "agenda": {
        "sin_permiso": {
          "title": "No tienes permiso para ver la agenda",
          "description": "Pide al administrador del centro que te lo active.",
          "cta_admin": "Contactar con el administrador"
        },
        "historico_vacio": "Sin registros este día."
      }
    }
  }
}
```

Las claves en `admin.ninos.tabs.pedagogico` ya existen; no se tocan.

## Accesibilidad

- **Selector de día** con flechas: botones reales `<button>` con `aria-label` traducido + `aria-disabled` cuando se llega al máximo (hoy).
- **Cards colapsables**: pattern `<button aria-expanded aria-controls>` apuntando a region `role="region"`.
- **Forms**: cada input con `<label>` asociado; errores Zod con `aria-describedby` y `role="alert"` para anuncios al lector.
- **Badge "Día cerrado"**: además de visual, `aria-live="polite"` para que el lector lo anuncie cuando cambia el día.
- **Contraste**: badges de estado / alerta cumplen WCAG AA (4.5:1 mínimo). Reutilizar paletas `success`, `warn`, `danger` del design system de Fase 2.5.
- **Targets táctiles**: botones de añadir y flechas ≥ 44×44 CSS px (móvil).
- **axe-core**: 0 violations en `/teacher/aula/[id]` y `/family/nino/[id]` (tab Agenda activa).

## Performance

- Query principal profe: 1 JOIN (`matriculas` ⨝ `ninos` ⨝ `agendas_diarias` ⨝ counts subquery por tabla hijo). Índices `(aula_id, fecha_baja)` en matrículas y `(nino_id, fecha)` en agendas evitan secuencial.
- Histórico familia: paginación implícita por `fecha` del picker (1 día por carga). No infinite scroll en Fase 3.
- Bundle: la vista profe es Client por necesidad de Realtime; objetivo `< 200 KB` JS de página (la sidebar de Fase 2.5 ya consume ~80 KB).
- Realtime: 1 canal por aula (profe) o por niño (familia). Cierre en `useEffect` cleanup.
- Lighthouse > 90 en performance y accesibilidad en `/teacher/aula/[id]` y `/family/nino/[id]`.

## Telemetría

Eventos client-side enviados al sink interno (placeholder console.debug en dev, no-op en prod hasta Fase 11 que añade Posthog):

- `agenda_evento_creado { tipo: 'comida'|'biberon'|'sueno'|'deposicion', aula_id }`
- `agenda_evento_editado { tipo, aula_id }`
- `agenda_vista_profe_abierta { aula_id }`
- `agenda_vista_familia_abierta { fecha_es_hoy: boolean }`
- `agenda_fuera_de_ventana_intento { tipo }` (cuando RLS rechaza por ventana)

Sin PII (ni `nino_id`, ni `usuario_id`).

## Tests requeridos

**Vitest (unit/integration):**

- [ ] `agenda-diaria.schema.test.ts`: 9 ENUMs + 5 schemas + cross-field rules (sueno_fin > inicio, consistencia solo si caca).
- [ ] `agenda-diaria.action.test.ts`: server actions devuelven Result; UPSERT idempotente; errores tipados.

**Vitest (RLS) — `src/test/rls/agenda-diaria.rls.test.ts`** (mínimo 8 tests):

- [ ] Admin centro A NO ve agendas de centro B.
- [ ] Profe aula A NO ve agendas de aula B (cross-aula del mismo centro).
- [ ] Profe aula A puede INSERT/UPDATE en agenda de hoy de aula A.
- [ ] Profe aula A NO puede INSERT en agenda con `fecha = ayer` (RLS rechaza).
- [ ] Profe aula A NO puede UPDATE en agenda existente con `fecha = ayer` (RLS rechaza).
- [ ] Tutor sin `puede_ver_agenda` NO ve la fila ni los eventos.
- [ ] Tutor con `puede_ver_agenda` ve fila y eventos pero falla INSERT/UPDATE.
- [ ] DELETE rechazado a todos los roles (incluido admin) por defecto DENY.

**Vitest (helper)** — `src/test/rls/dentro-de-ventana-edicion.test.ts`:

- [ ] `dentro_de_ventana_edicion(CURRENT_DATE)` → `true`.
- [ ] `dentro_de_ventana_edicion(CURRENT_DATE - 1)` → `false`.
- [ ] `dentro_de_ventana_edicion(CURRENT_DATE + 1)` → `false`.

**Vitest (audit) — `src/test/audit/agenda-audit.test.ts`:**

- [ ] INSERT en `comidas` genera fila en `audit_log` con `accion='INSERT'`, `centro_id` correcto, `valores_despues` JSONB.
- [ ] UPDATE en `agendas_diarias` registra `valores_antes` y `valores_despues`.

**Playwright (E2E) — `e2e/agenda-diaria.spec.ts`:**

- [ ] **profe-anade-comida**: profe entra a `/teacher/aula/[id]`, expande tarjeta de niño de prueba, añade comida, recarga la página, ve la comida persistida.
- [ ] **realtime-familia-ve-cambio**: dos contextos Playwright en paralelo — profe añade biberón, familia (sesión secundaria) ve aparecer la fila sin recargar.
- [ ] **dia-anterior-readonly**: profe navega a ayer con el selector, verifica badge "Día cerrado" + inputs `disabled` + intento manual de submit responde error.

## Criterios de aceptación

- [ ] Todos los tests Vitest + Playwright pasan en CI verde.
- [ ] Lighthouse > 90 (performance y accesibilidad) en `/teacher/aula/[id]` y `/family/nino/[id]` (tab Agenda).
- [ ] axe-core sin violations en ambas vistas.
- [ ] 100% claves i18n en es/en/va; lint i18n verde.
- [ ] Realtime verificado en preview de Vercel antes de mergear (manual smoke en Checkpoint C).
- [ ] Audit log captura INSERT/UPDATE de las 5 tablas con `centro_id` correcto.
- [ ] ADRs 0011, 0012, 0013 escritos.
- [ ] `docs/architecture/data-model.md` actualizado: 16 → 21 tablas implementadas, lista de triggers audit ampliada.
- [ ] `docs/architecture/rls-policies.md` actualizado: ventana de edición a "mismo día calendario Madrid", helper `dentro_de_ventana_edicion` documentado, sección Realtime añadida.
- [ ] `CLAUDE.md` actualizado: línea de ventana de tiempo cambiada a "mismo día calendario hora Madrid".
- [ ] Entrada en `docs/journey/progress.md` con Fase 3 cerrada.

## Decisiones técnicas relevantes

- **ADR-0011 — Timezone Europe/Madrid hardcoded en helper de ventana de edición.** ANAIA está en Valencia (mismo huso). NIDO arranca single-tenant; añadir un campo `centros.timezone` y hacer el helper dinámico introduce complejidad innecesaria hoy. Plan de internacionalización: cuando se incorpore un centro fuera del huso CET, migrar a `centros.timezone TEXT NOT NULL DEFAULT 'Europe/Madrid'` y reescribir el helper para aceptarlo. ADR documenta el trade-off.

- **ADR-0012 — 5 tablas separadas vs JSONB en la agenda.** Tablas separadas porque (1) queries analíticas en Fase 9 (informes) requieren filtros por campo, (2) audit log per-evento es más útil que diff de blob, (3) RLS por campo (`agenda_id` cohesivo), (4) tipos TypeScript explícitos sin `any`, (5) Supabase Realtime entrega cambios por tabla y por fila, no por path JSONB. Coste: 5 ENUMs + 5 tablas + 5 sets de políticas vs 1 columna JSONB. Aceptable.

- **ADR-0013 — Ventana de edición = mismo día calendario Madrid, sin excepciones desde UI.** Cerrar a las 00:00 hora Madrid simplifica el modelo mental (la familia sabe que lo que ve por la noche es definitivo). Excepciones admin: vía SQL con audit log forzado, no por UI. Coste: si la profe olvida algo a las 23:55 y guarda a las 00:01, pierde la ventana — riesgo asumido. Alternativa rechazada: ventana hasta 06:00 del día siguiente (CLAUDE.md original) introducía ambigüedad para la familia.

  **Esta decisión deroga explícitamente la regla original** documentada en `CLAUDE.md` (línea 94) y `docs/architecture/rls-policies.md` (sección "Ventana de edición agenda diaria"): _"profe edita hasta 06:00 del día siguiente; admin puede editar histórico con audit log forzado"_. Razón documentada:
  - **Simplificar el modelo mental**: una sola ventana, un solo criterio (`fecha == hoy hora Madrid`), sin franjas horarias raras que la familia no entendería.
  - **Una sola ventana**: facilita los tests RLS (no hay que mockear "es de madrugada con margen extendido"), reduce la superficie de bugs.
  - **Menos errores**: si admin puede editar histórico desde UI, antes o después alguien corrige a posteriori sin que la familia lo perciba. Forzar el paso por SQL deja una barrera explícita y auditada.
  - **Trazabilidad histórica**: el ADR registra cuándo y por qué se cambió la regla — futuros lectores no se confunden viendo doc viejo.

  Los dos documentos derogados (CLAUDE.md + rls-policies.md) se actualizan en el commit de docs de Fase 3 con un enlace cruzado al ADR-0013.

## Referencias

- ADR-0007 — RLS recursion avoidance (patrón helpers SECURITY DEFINER para lookups cruzados).
- ADR-0004 — Cifrado pgcrypto en info médica (lectura via `get_info_medica_emergencia` para badges).
- ADR-0006 — Permisos granulares JSONB en `vinculos_familiares` (clave nueva `puede_ver_agenda`).
- Spec `core-entities.md` — modelo Fase 2.
- Spec `pedagogical-data.md` — modelo Fase 2.6, patrón ya validado.

---

**Workflow:**

1. Spec en estado `draft`.
2. Responsable revisa y aprueba (→ `approved`).
3. Implementación crea migración + tests RLS (Checkpoint B).
4. UI + i18n + E2E (Checkpoint C).
5. Merge + deploy (→ `done`).
