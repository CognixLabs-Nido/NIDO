---
feature: pedagogical-data
wave: 1
phase: 2.6
status: draft
priority: high
last_updated: 2026-05-14
related_adrs: [ADR-0009, ADR-0010]
related_specs: [core-entities, design-system]
---

# Spec — Datos pedagógicos del niño + logo del centro

## Resumen ejecutivo

Fase ligera que prepara el terreno para Fase 3 (agenda diaria) añadiendo dos cosas: un campo `logo_url` en `centros` para que cada escuela pueda mostrar su marca propia junto a la de NIDO, y una tabla nueva `datos_pedagogicos_nino` con los datos no médicos imprescindibles (lactancia, control de esfínteres, siesta, alimentación, idiomas, hermanos en el centro) que el profe va a necesitar para rellenar la agenda diaria.

## Contexto

Tras Fase 2.5 (sistema de diseño) toca seguir con Fase 3 (agenda diaria + bienestar). Pero antes hay un par de huecos sin los que Fase 3 no se puede empezar:

1. **Logo de ANAIA**. La directora ha pedido ver el logo de su centro junto al de NIDO en la app. La marca NIDO sigue siendo la del producto; la del centro convive con ella sin sustituirla. Lo hacemos ahora porque el sidebar fijo (Fase 2.5) tiene un sitio natural para ello, y dejarlo para Fase 11 supondría re-tematizar todas las pantallas otra vez.
2. **Datos pedagógicos del niño** (lactancia, pañal, siesta, alimentación, idiomas). En Fase 3 el profe va a rellenar la agenda diaria con campos como "biberón a las 10:30", "siesta de 13:00 a 14:30", "comió mitad". Si no sabemos a priori que el niño es lactante o que su tipo de alimentación es vegana, la agenda no tiene contexto. Estos datos se rellenan una vez (al alta del niño o cuando el admin los reciba) y se actualizan ocasionalmente.

Lo que **no** se hace ahora: el campo IBAN, los datos administrativos del tutor, el flujo híbrido admin↔tutor con "campo verificado por tutor", el upload real del logo a Storage. Todo eso es de fases más tardías. El principio que aplica esta fase: no metemos en una fase cosas que se usarán mucho más tarde.

## User stories

- US-PED-01: Como admin del centro, quiero que el logo de ANAIA aparezca debajo del logo de NIDO en la sidebar para reconocer mi escuela de un vistazo.
- US-PED-02: Como admin, quiero registrar los datos pedagógicos básicos de cada niño (lactancia, pañal, siesta, alimentación, idiomas en casa, hermanos en el centro) para que el profe los tenga listos al rellenar la agenda.
- US-PED-03: Como admin, quiero editar esos datos cuando cambian (la lactancia termina, el niño deja el pañal, cambia el número de siestas) sin tener que tocar el resto de la ficha.
- US-PED-04: Como profe del aula del niño, quiero leer los datos pedagógicos del niño para preparar el día y rellenar la agenda con contexto.
- US-PED-05: Como tutor con permiso `puede_ver_datos_pedagogicos` activo en `vinculos_familiares.permisos`, quiero consultar los datos pedagógicos de mi hijo/a para confirmar que están actualizados.
- US-PED-06: Como profe **de otra aula** distinta a la del niño, NO debo poder leer estos datos.
- US-PED-07: Como tutor **sin** `puede_ver_datos_pedagogicos`, NO debo poder leer estos datos.

## Alcance

**Dentro:**

- Nueva columna `centros.logo_url TEXT NULL`.
- Seed que pone `logo_url = '/brand/anaia-logo-wordmark.png'` para ANAIA (UUID conocido).
- Nueva tabla `datos_pedagogicos_nino` (1:1 con `ninos`) con 12 campos funcionales.
- Trigger `set_updated_at`.
- Activar audit log en la nueva tabla (extender `audit_trigger_function` para derivar `centro_id` desde `nino_id`).
- 4 políticas RLS coherentes con `info_medica_emergencia`: admin del centro, profe del aula actual, tutor con nuevo permiso `puede_ver_datos_pedagogicos`, default DENY ALL.
- Migración añade el nuevo permiso al JSONB `vinculos_familiares.permisos` y lo pobla a `true` para los vínculos existentes que ya tengan `puede_ver_info_medica=true`.
- Componente `<CentroLogo />` server que lee `centros.logo_url` y lo renderiza dentro del sidebar de los layouts admin/teacher/family.
- Nueva tab **"Pedagógico"** en `/admin/ninos/[id]` (entre "Médica" y "Familia") con formulario editable + empty state cuando aún no hay fila.
- Visualización read-only de los datos pedagógicos en `/family/nino/[id]` para tutores con `puede_ver_datos_pedagogicos`.
- i18n trilingüe (es/en/va) para todos los strings nuevos.
- 4 tests RLS, 1 test Vitest del schema Zod y 1 test E2E del flujo admin (rellenar tab → guardar → recargar → ver).
- ADR-0009 (tabla separada vs columnas) y ADR-0010 (logo como URL relativa).

**Fuera (no se hace aquí):**

- **No se toca el wizard de nuevo niño** (`/admin/ninos/nuevo`). Sigue creando ni más ni menos que lo de Fase 2. La tab "Pedagógico" del detalle aparece vacía hasta que el admin la rellene.
- **No se añade campo IBAN ni datos administrativos del tutor.** Eso es de una fase futura específica de facturación / contabilidad.
- **No se hace el flujo híbrido admin↔tutor con campo "verificado por tutor".** En Fase 2.6 solo el admin escribe; tutor solo lee. El flujo de propuesta/confirmación llega cuando lo necesitemos de verdad.
- **No se sube el logo a Supabase Storage.** En esta fase es una URL relativa a `/brand/...` (asset estático en `public/`). El upload real espera a Fase 10 cuando ya esté Storage configurado.
- **No se añade `logo_full_url` a `centros`.** Una sola columna `logo_url` apuntando al wordmark (uso principal: sidebar). Si en el futuro hay que distinguir wordmark vs full vs mark, se amplía el modelo.
- **No se amplía `process-logos.mjs`** para procesar logos de ANAIA. Los PNG actuales ya están en formato usable; se commitearon manualmente. Si llega un source de mayor calidad, se amplía el script (TODO ya en `docs/dev-setup.md`).
- Sin cambios estructurales en la columna `permisos` de `vinculos_familiares` (sigue siendo `JSONB`): solo se añade una clave nueva. No se modifica el resto del modelo.

## Comportamientos detallados

### B1 — Logo del centro en sidebar

**Pre-condiciones:**

- Existe un registro en `centros` con `logo_url` poblado (para ANAIA, `/brand/anaia-logo-wordmark.png`).
- El usuario está autenticado y tiene rol en el centro (sidebar solo se renderiza dentro de los layouts admin/teacher/family).

**Flujo:**

1. El layout server-side llama a `getCentroActualId()` (ya existe).
2. Si hay `centroId`, llama a una nueva query `getCentroLogo(centroId)` que devuelve `{ logoUrl, nombre } | null`.
3. Pasa los datos al `<SidebarNav />` que en el header (debajo del `<LogoWordmark />` de NIDO) renderiza `<CentroLogo url={...} name={...} />` si hay URL.
4. `<CentroLogo />` usa `next/image` con `alt=nombre`, dimensiones fijas y `loading="eager"` (LCP del primer paint).

**Post-condiciones:**

- En `/{locale}/admin/*`, `/{locale}/teacher/*`, `/{locale}/family/*`: visible el wordmark de NIDO en la parte alta del sidebar y, justo debajo con un pequeño margen, el logo de ANAIA.

### B2 — Crear datos pedagógicos por primera vez

**Pre-condiciones:**

- Usuario es admin del centro del niño.
- No existe fila en `datos_pedagogicos_nino` con `nino_id = X`.

**Flujo:**

1. Admin entra en `/{locale}/admin/ninos/{id}`.
2. Pincha la tab "Pedagógico".
3. La query devuelve `null`.
4. Se renderiza `<EmptyState />` con icono (BookOpen o similar), título "Aún no hay datos pedagógicos", descripción "Rellena los datos que conoces. Puedes editarlos más adelante." y CTA "Añadir datos pedagógicos".
5. Al pulsar el CTA se monta el formulario completo con valores por defecto en blanco.
6. Admin rellena y pulsa "Guardar".
7. La server action `upsertDatosPedagogicos` valida con Zod, hace `INSERT ... ON CONFLICT (nino_id) DO UPDATE SET ...` y devuelve `{ success: true, data: { id } }`.
8. La página se refresca (revalidatePath o redirect a sí misma) y muestra la versión guardada en modo edición.
9. El audit trigger registra un `INSERT` en `audit_log`.

**Post-condiciones:**

- Existe una fila en `datos_pedagogicos_nino` con los datos rellenos.
- Existe una entrada en `audit_log` con `accion='INSERT'`, `usuario_id` = admin, `centro_id` = el del niño.

### B3 — Editar datos pedagógicos existentes

**Pre-condiciones:**

- Usuario es admin del centro del niño.
- Existe fila en `datos_pedagogicos_nino`.

**Flujo:**

1. Admin entra en `/{locale}/admin/ninos/{id}` → tab "Pedagógico".
2. El formulario aparece prerrelleno con los valores actuales.
3. Admin cambia uno o varios campos.
4. Al pulsar "Guardar", la misma server action hace UPSERT (con `ON CONFLICT`), por lo que termina haciendo UPDATE.
5. Audit trigger registra `UPDATE` con `valores_antes` y `valores_despues` en JSONB.
6. Toast de éxito.

**Post-condiciones:**

- La fila tiene los valores nuevos.
- `updated_at` se actualiza por trigger.
- Audit log refleja el cambio.

### B4 — Profe lee datos pedagógicos

**Pre-condiciones:**

- Usuario es profe.
- El niño está matriculado en una de las aulas asignadas a ese profe (`profes_aulas.fecha_fin IS NULL` + `matriculas.fecha_baja IS NULL`).

**Flujo:**

1. (Fase 2.6 alcance mínimo) El profe puede leer los datos vía RPC / query — pero todavía no hay pantalla profe en la que se rendericen explícitamente. La policy RLS está lista para Fase 3, cuando la agenda diaria los lea.

**Post-condiciones:**

- Profe SELECT funciona; profe de otra aula recibe filas vacías por RLS.

### B5 — Tutor lee datos pedagógicos

**Pre-condiciones:**

- Usuario es tutor del niño (vínculo activo en `vinculos_familiares`).
- `vinculos_familiares.permisos.puede_ver_datos_pedagogicos = true`.

**Flujo:**

1. Tutor entra en `/{locale}/family/nino/{id}`.
2. Bajo la sección "Médica" aparece una nueva sección "Pedagógico" (solo si la query devuelve fila).
3. Render read-only con el patrón `Row {k, v}` ya en uso.

**Post-condiciones:**

- Tutor sin permiso no ve la sección (la query devuelve `null` por RLS o por chequeo previo).

## Casos edge

- **Sin datos previos**: el niño no tiene fila en `datos_pedagogicos_nino` → tab muestra `<EmptyState />` con CTA. La sección en vista familia no se renderiza.
- **Sin permisos** (autorizado / tutor sin `puede_ver_datos_pedagogicos`): RLS devuelve 0 filas; UI no muestra la sección. No hay error visible.
- **Niño borrado** (soft delete `ninos.deleted_at`): por ON DELETE RESTRICT, no se puede hacer hard delete del niño mientras tenga `datos_pedagogicos_nino`. El soft delete del niño no afecta a la fila pedagógica (la FK es UNIQUE no cascadeada); queda accesible para auditoría pero RLS lo filtra (`ninos.deleted_at IS NOT NULL`).
- **Datos inválidos** (enum fuera de rango, idiomas con código no ISO 639-1, número de siestas negativo): Zod cliente + Zod en server action + CHECK en BD.
- **Concurrencia** (dos admins editando a la vez): `UPSERT` last-write-wins. No es crítico — son datos pedagógicos editados raramente. Si llega a ser un problema, se introduce `optimistic_lock_version` en una fase futura.
- **Idiomas**: el array `idiomas_casa` permite cualquier combinación de códigos ISO 639-1 (2 letras). UI permite multi-select con presets `es`, `en`, `va`, `ar`, `ro`, `zh` y otros frecuentes en el área de ANAIA; entrada libre prohibida (CHECK constraint length=2).
- **Permisos (decisión clave)**: introducimos un permiso nuevo `puede_ver_datos_pedagogicos` en `vinculos_familiares.permisos` (JSONB). Razón:
  - Estos datos NO son médicos (lactancia es alimentación, pañal/siesta son rutinas), aunque su sensibilidad efectiva es similar — son íntimos del niño.
  - Mantener semántica clara: el día de mañana puede haber tutores que deban ver datos médicos pero no rutinarios, o al revés.
  - La migración se ocupa de la consistencia: añade el nuevo permiso a todos los vínculos existentes con `true` para los que ya tenían `puede_ver_info_medica=true` y `false` para el resto. Esto preserva las visibilidades actuales sin sorpresas. Documentado en ADR-0009.
- **Tipo `otra` en `tipo_alimentacion`**: requiere que `alimentacion_observaciones` tenga texto. Zod cross-field validator + CHECK en BD (`CHECK (tipo_alimentacion <> 'otra' OR alimentacion_observaciones IS NOT NULL)`).
- **Borrado y soft delete de la fila pedagógica**: se admite `deleted_at` por coherencia con el resto (`ninos`, `aulas`, etc.). UI no expone borrado en Fase 2.6 — un niño tiene siempre datos pedagógicos o ninguno, no se borran "explícitamente".

## Validaciones (Zod)

```typescript
// src/features/datos-pedagogicos/schemas/datos-pedagogicos.ts
import { z } from 'zod'

export const lactanciaEstadoEnum = z.enum([
  'materna',
  'biberon',
  'mixta',
  'finalizada',
  'no_aplica',
])

export const controlEsfinteresEnum = z.enum([
  'panal_completo',
  'transicion',
  'sin_panal_diurno',
  'sin_panal_total',
])

export const tipoAlimentacionEnum = z.enum([
  'omnivora',
  'vegetariana',
  'vegana',
  'sin_lactosa',
  'sin_gluten',
  'religiosa_halal',
  'religiosa_kosher',
  'otra',
])

export const DatosPedagogicosSchema = z
  .object({
    nino_id: z.string().uuid(),
    lactancia_estado: lactanciaEstadoEnum,
    lactancia_observaciones: z.string().max(500).nullable().optional(),
    control_esfinteres: controlEsfinteresEnum,
    control_esfinteres_observaciones: z.string().max(500).nullable().optional(),
    siesta_horario_habitual: z.string().max(40).nullable().optional(),
    siesta_numero_diario: z.number().int().min(0).max(5).nullable().optional(),
    siesta_observaciones: z.string().max(500).nullable().optional(),
    tipo_alimentacion: tipoAlimentacionEnum,
    alimentacion_observaciones: z.string().max(500).nullable().optional(),
    idiomas_casa: z
      .array(z.string().length(2, 'validation.idioma_iso_invalido'))
      .min(1, 'validation.idioma_min_uno')
      .max(8, 'validation.idioma_max_ocho'),
    tiene_hermanos_en_centro: z.boolean(),
  })
  .superRefine((val, ctx) => {
    if (val.tipo_alimentacion === 'otra' && !val.alimentacion_observaciones?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['alimentacion_observaciones'],
        message: 'validation.alimentacion_observaciones_requeridas',
      })
    }
  })

export type DatosPedagogicosInput = z.infer<typeof DatosPedagogicosSchema>
```

## Modelo de datos afectado

**Tablas modificadas**:

- `centros`: añadir columna `logo_url TEXT NULL`.

**Tablas nuevas**:

- `datos_pedagogicos_nino`.

**Tablas consultadas**:

- `centros` (para leer `logo_url` en el layout).
- `ninos` (para derivar `centro_id` desde `nino_id` en RLS y audit).

### Migración

Archivo: `supabase/migrations/<timestamp>_phase2_6_pedagogical_data.sql`.

```sql
BEGIN;

-- 1. Logo del centro
ALTER TABLE public.centros ADD COLUMN logo_url TEXT NULL;
UPDATE public.centros
  SET logo_url = '/brand/anaia-logo-wordmark.png'
  WHERE id = '33c79b50-13b5-4962-b849-d88dd6a21366';

-- 2. ENUMs nuevos
CREATE TYPE public.lactancia_estado AS ENUM (
  'materna','biberon','mixta','finalizada','no_aplica'
);
CREATE TYPE public.control_esfinteres AS ENUM (
  'panal_completo','transicion','sin_panal_diurno','sin_panal_total'
);
CREATE TYPE public.tipo_alimentacion AS ENUM (
  'omnivora','vegetariana','vegana','sin_lactosa','sin_gluten',
  'religiosa_halal','religiosa_kosher','otra'
);

-- 3. Tabla datos_pedagogicos_nino
CREATE TABLE public.datos_pedagogicos_nino (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nino_id UUID NOT NULL UNIQUE REFERENCES public.ninos(id) ON DELETE RESTRICT,
  lactancia_estado public.lactancia_estado NOT NULL,
  lactancia_observaciones TEXT,
  control_esfinteres public.control_esfinteres NOT NULL,
  control_esfinteres_observaciones TEXT,
  siesta_horario_habitual TEXT,
  siesta_numero_diario SMALLINT CHECK (siesta_numero_diario IS NULL OR (siesta_numero_diario >= 0 AND siesta_numero_diario <= 5)),
  siesta_observaciones TEXT,
  tipo_alimentacion public.tipo_alimentacion NOT NULL,
  alimentacion_observaciones TEXT,
  idiomas_casa TEXT[] NOT NULL CHECK (
    array_length(idiomas_casa, 1) BETWEEN 1 AND 8
    AND NOT EXISTS (SELECT 1 FROM unnest(idiomas_casa) AS x WHERE length(x) <> 2)
  ),
  tiene_hermanos_en_centro BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT alimentacion_otra_requiere_obs CHECK (
    tipo_alimentacion <> 'otra' OR (alimentacion_observaciones IS NOT NULL AND length(trim(alimentacion_observaciones)) > 0)
  )
);

CREATE INDEX datos_pedagogicos_nino_nino_id_idx ON public.datos_pedagogicos_nino(nino_id);

-- 4. Trigger updated_at (reutiliza función existente)
CREATE TRIGGER datos_pedagogicos_nino_set_updated_at
  BEFORE UPDATE ON public.datos_pedagogicos_nino
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. RLS habilitada
ALTER TABLE public.datos_pedagogicos_nino ENABLE ROW LEVEL SECURITY;

-- 6. Políticas (mismo patrón que info_medica_emergencia, con helpers existentes)
CREATE POLICY dp_admin_all ON public.datos_pedagogicos_nino
  FOR ALL TO authenticated
  USING (public.es_admin(public.centro_de_nino(nino_id)))
  WITH CHECK (public.es_admin(public.centro_de_nino(nino_id)));

CREATE POLICY dp_profe_select ON public.datos_pedagogicos_nino
  FOR SELECT TO authenticated
  USING (public.es_profe_de_nino(nino_id));

CREATE POLICY dp_tutor_select ON public.datos_pedagogicos_nino
  FOR SELECT TO authenticated
  USING (public.tiene_permiso_sobre(nino_id, 'puede_ver_datos_pedagogicos'));

-- 7. Backfill: añadir clave en JSONB de vinculos existentes.
--    Pone TRUE en los que ya pueden ver info médica, FALSE en el resto.
UPDATE public.vinculos_familiares
SET permisos = permisos || jsonb_build_object(
  'puede_ver_datos_pedagogicos',
  COALESCE((permisos->>'puede_ver_info_medica')::boolean, false)
)
WHERE NOT (permisos ? 'puede_ver_datos_pedagogicos');

-- 7. Audit log trigger: extender audit_trigger_function para derivar centro_id
--    desde datos_pedagogicos_nino (CASE WHEN TG_TABLE_NAME = 'datos_pedagogicos_nino'
--    THEN (SELECT centro_id FROM ninos WHERE id = COALESCE((NEW).nino_id, (OLD).nino_id))).
--    Como audit_trigger_function ya soporta la lookup vía centro_de_nino, basta
--    añadir el AFTER trigger en la nueva tabla.
CREATE TRIGGER datos_pedagogicos_nino_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.datos_pedagogicos_nino
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

-- (Nota: la función audit_trigger_function se actualiza en el mismo
-- archivo para que incluya datos_pedagogicos_nino en su IF/ELSIF de
-- derivación de centro_id.)
CREATE OR REPLACE FUNCTION public.audit_trigger_function() ...; -- (cuerpo completo en la migración)

COMMIT;
```

(Si `audit_trigger_function` ya hace lookup por `centro_de_nino` sin necesidad de saber la tabla, lo cual es lo que arregló ADR-0007, **no hace falta tocar la función**: basta crear el trigger. Verificar en implementación; si el IF/ELSIF dentro de la función es necesario, añadir ahí la rama `datos_pedagogicos_nino` y dejar todas las demás intactas.)

## Políticas RLS

3 policies sobre `datos_pedagogicos_nino` + default DENY:

- `dp_admin_all` (FOR ALL): admin del centro del niño puede SELECT/INSERT/UPDATE/DELETE.
- `dp_profe_select` (FOR SELECT): profe del aula actual del niño puede leer.
- `dp_tutor_select` (FOR SELECT): tutor con `puede_ver_datos_pedagogicos=true` puede leer.

Sin policies para INSERT/UPDATE/DELETE de profe o tutor → DENY por defecto.

Las tres usan helpers existentes (`public.es_admin`, `public.centro_de_nino`, `public.es_profe_de_nino`, `public.tiene_permiso_sobre`) que ya están en `public.*` con `SECURITY DEFINER STABLE`. No se introduce ningún helper nuevo. Esto evita recursión RLS (ADR-0007) y se alinea con el patrón ya documentado de `info_medica_emergencia`.

## Pantallas y rutas

- `/{locale}/admin/ninos/[id]` — añadir tab `Pedagógico` entre `Médica` y `Familia`.
- `/{locale}/family/nino/[id]` — añadir sección read-only "Pedagógico" debajo de "Médica" (gated por `puede_ver_datos_pedagogicos`).
- `/{locale}/admin/*`, `/{locale}/teacher/*`, `/{locale}/family/*` — sidebar muestra logo del centro debajo del wordmark NIDO.

## Componentes UI

- `<CentroLogo url={string} name={string} />` (Server) — render `next/image` con dims fijas y `alt`. Ubicación: `src/shared/components/brand/CentroLogo.tsx`.
- Modificar `<SidebarNav />` para recibir un nuevo prop opcional `centroLogo: { url, name } | null` y renderizarlo bajo el wordmark si está presente.
- `<DatosPedagogicosTab nino={...} />` (Server con sub-Client form) — wrapper que decide entre `<EmptyState />` o `<DatosPedagogicosForm />`. Ubicación: `src/features/datos-pedagogicos/components/`.
- `<DatosPedagogicosForm initial={...} ninoId={...} />` (Client) — RHF + Zod resolver + `Select`s con prop `items` (patrón base-ui ya documentado), checkbox para hermanos. Para `idiomas_casa` un `<Input>` que acepta códigos separados por coma y se valida como array de 2 letras ISO 639-1; placeholder `t('idiomas_casa_placeholder')` con texto _"Usa códigos ISO 639-1 de 2 letras (es, en, va, ca, ar, zh, etc.)"_.
- `<DatosPedagogicosReadOnly data={...} />` (Server) — para vista familia y futura vista profe.

## Server Actions

- `getDatosPedagogicos(ninoId)` — query: SELECT por nino_id, normaliza fila a tipo TS.
- `upsertDatosPedagogicos(input)` — server action con patrón Result. Hace UPSERT (`ON CONFLICT (nino_id) DO UPDATE`). Valida con Zod. Revalida `/{locale}/admin/ninos/{id}` al éxito.

Ubicación: `src/features/datos-pedagogicos/{queries,actions,schemas,components}/`.

## Eventos y notificaciones

- Audit log automático en INSERT/UPDATE/DELETE de `datos_pedagogicos_nino`. Captura `auth.uid()`, `centro_id` derivado y JSONB antes/después.
- Sin notificaciones push en Fase 2.6.

## i18n

Claves nuevas, mismo patrón namespace de Fase 2/2.5:

```json
{
  "pedagogico": {
    "title": "Pedagógico",
    "vacio_title": "Aún no hay datos pedagógicos",
    "vacio_descripcion": "Rellena los datos que conoces. Puedes editarlos más adelante.",
    "vacio_cta": "Añadir datos pedagógicos",
    "guardado": "Datos pedagógicos guardados",
    "fields": {
      "lactancia_estado": "Lactancia",
      "lactancia_observaciones": "Observaciones de lactancia",
      "control_esfinteres": "Control de esfínteres",
      "control_esfinteres_observaciones": "Observaciones",
      "siesta_horario_habitual": "Horario habitual de siesta",
      "siesta_numero_diario": "Siestas al día",
      "siesta_observaciones": "Observaciones de siesta",
      "tipo_alimentacion": "Tipo de alimentación",
      "alimentacion_observaciones": "Observaciones de alimentación",
      "idiomas_casa": "Idiomas en casa",
      "tiene_hermanos_en_centro": "Tiene hermanos/as en el centro"
    },
    "lactancia_opciones": {
      "materna": "Lactancia materna",
      "biberon": "Biberón",
      "mixta": "Mixta",
      "finalizada": "Finalizada",
      "no_aplica": "No aplica"
    },
    "control_esfinteres_opciones": {
      "panal_completo": "Con pañal",
      "transicion": "En transición",
      "sin_panal_diurno": "Sin pañal de día",
      "sin_panal_total": "Sin pañal"
    },
    "alimentacion_opciones": {
      "omnivora": "Omnívora",
      "vegetariana": "Vegetariana",
      "vegana": "Vegana",
      "sin_lactosa": "Sin lactosa",
      "sin_gluten": "Sin gluten",
      "religiosa_halal": "Halal",
      "religiosa_kosher": "Kosher",
      "otra": "Otra"
    },
    "validation": {
      "idioma_iso_invalido": "Cada idioma debe ser un código ISO de 2 letras (ej. es, en, va).",
      "idioma_min_uno": "Indica al menos un idioma hablado en casa.",
      "idioma_max_ocho": "Máximo 8 idiomas.",
      "alimentacion_observaciones_requeridas": "Detalla la dieta cuando selecciones \"Otra\"."
    }
  }
}
```

Tres idiomas (es/en/va) obligatorios. Strings de tab/sección reutilizables (`admin.ninos.tabs.pedagogico = "Pedagógico"`).

## Accesibilidad

- Cada `<Select>` con `aria-label` (el `<FormLabel>` lo provee implícito).
- Cross-field validation (`alimentacion_observaciones` requerida si `tipo_alimentacion=otra`) accesible: el error aparece bajo el campo con `<FormMessage>` que ya enlaza vía `aria-describedby`.
- Logo de centro tiene `alt={centro.nombre}` (no decorativo). Si el logo es solo visual, el `alt` aporta valor a lectores de pantalla porque identifica la escuela.
- Estados hover/focus visibles en todos los botones, ya viene del sistema de diseño.

## Performance

- La query `getCentroLogo(centroId)` corre en cada layout server-render. Se memoiza con `cache()` de React para no duplicarla cuando varias rutas se renderizan en una misma request.
- `next/image` con `width`/`height` fijos: 180×48 para sidebar wordmark del centro (no se redimensiona, no hay CLS).
- La tabla `datos_pedagogicos_nino` tiene índice por `nino_id` (UNIQUE implica índice). Sin joins en queries críticas.

## Telemetría

Sin telemetría custom en Fase 2.6. El audit log cubre la trazabilidad funcional.

## Tests requeridos

**Vitest (unit):**

- [ ] `datos-pedagogicos.schema.test.ts` — valida casos correctos (todos los enums), incorrectos (idioma de 3 letras), cross-field (`otra` sin `alimentacion_observaciones` falla).

**Vitest (RLS):**

- [ ] `datos-pedagogicos.rls.test.ts` con 4 casos:
  - Admin de centro A NO ve datos de centro B.
  - Profe del aula actual del niño ve los datos.
  - Profe de otra aula NO ve los datos.
  - Tutor sin `puede_ver_datos_pedagogicos` NO ve los datos.
  - Backfill: vínculos con `puede_ver_info_medica=true` también reciben `puede_ver_datos_pedagogicos=true`; los demás reciben `false`.

**Playwright (E2E):**

- [ ] `pedagogical-data.spec.ts`: admin entra en detalle de niño, tab "Pedagógico" vacía con CTA, rellena 4 campos clave (lactancia, esfínteres, alimentación, idiomas), guarda, recarga, comprueba persistencia.
- [ ] El mismo spec hace un check visual: tras login, verificar que el sidebar muestra el `<img alt="ANAIA">` (o `<img alt="ANAIA Nursery School">` según el `centros.nombre`).

## Criterios de aceptación

- [ ] `npm run typecheck && npm run lint && npm test && npm run test:e2e && npm run build` todo verde local + CI verde en el PR.
- [ ] Migración aplicada al remoto vía `supabase db push`. `npm run db:types` regenera y commitea.
- [ ] Logo de ANAIA visible en sidebar tras login (admin/teacher/family).
- [ ] Tab "Pedagógico" aparece entre "Médica" y "Familia" en `/admin/ninos/[id]`.
- [ ] Empty state cuando no hay datos. Form prerrelleno cuando los hay.
- [ ] Vista familia muestra sección read-only sólo si `puede_ver_datos_pedagogicos=true`.
- [ ] 4 tests RLS verdes. 1 test schema verde. 1 test E2E verde.
- [ ] i18n 100% es/en/va para todos los strings nuevos.
- [ ] ADR-0009 y ADR-0010 escritos.
- [ ] `docs/journey/progress.md` con entrada Fase 2.6.
- [ ] `docs/architecture/data-model.md` con la nueva tabla y el cambio en `centros`.

## Decisiones técnicas relevantes

- **ADR-0009** Datos pedagógicos como tabla separada (`datos_pedagogicos_nino`) y no columnas dentro de `ninos`. Razón: separación de concerns, audit independiente (acciones en `INSERT/UPDATE/DELETE` distinguibles), espacio para crecer (Fase futura: hobbies/intereses, alergias específicas no médicas, etc.) sin alargar la fila principal de niño. Permiso JSONB nuevo `puede_ver_datos_pedagogicos` con backfill desde `puede_ver_info_medica` para preservar visibilidades existentes sin sorpresas.
- **ADR-0010** Logo del centro como URL relativa (`/brand/*`) almacenada en `centros.logo_url TEXT`. Razón: el upload real espera a Fase 10 (Storage configurado); mientras tanto la URL relativa apunta a assets en `public/brand/` y es trivial cambiar el campo cuando llegue Storage. Sólo una variante de URL (la del wordmark) — si se necesitan más, se amplía el modelo.

## Referencias

- ADR-0007 (recursión RLS): los helpers `centro_de_nino`, `es_profe_de_nino`, `tiene_permiso_sobre` ya cubren los patrones que esta tabla necesita.
- ADR-0008 (sistema de diseño): el sidebar y los empty states que se reutilizan vienen de esta fase.
- Spec `core-entities`: `info_medica_emergencia` como referente directo del patrón 1:1 con `ninos`.
- Spec `design-system`: `<EmptyState />`, `<SidebarNav />`, tokens del sistema.

---

**Workflow:**

1. ✅ Claude Code escribe esta spec.
2. ⏳ Responsable revisa y aprueba (Checkpoint A).
3. Claude Code implementa: migración → tipos → server actions → UI → tests → ADRs → progress.
4. PR draft con CI verde + Vercel preview → Checkpoint B.
5. Tras OK del responsable: ready → merge.
