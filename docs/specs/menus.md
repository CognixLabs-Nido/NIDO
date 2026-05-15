---
feature: menus
wave: 1
phase: 4.5
status: draft
priority: high
last_updated: 2026-05-16
related_adrs: [ADR-0014, ADR-0017, ADR-0018]
related_specs: [attendance, daily-agenda, datos-pedagogicos]
---

# Spec — Menús del centro + pase de lista comida batch

## Resumen ejecutivo

Fase puente entre F4 (asistencia) y F5 (mensajería). Introduce **plantillas de menú semanales** que el admin define a nivel centro y **un pase de lista de comida batch** que la profe usa para registrar de un vistazo qué comió cada niño. Reusa el componente `<PaseDeListaTable />` (ADR-0014) sin modificarlo.

## Contexto

Las profes hoy registran cada comida (de la tabla `comidas` de Fase 3) niño a niño desde la agenda diaria. Eso es preciso pero lento: con 12 niños por aula × 4 momentos diarios, son 48 micro-formularios. Además, **la descripción de qué se ha cocinado se repite** cada día — la cocina del centro tiene un menú semanal estable.

Esta fase resuelve dos cosas a la vez:

1. **Memoria del centro**: el admin define el menú semanal en un sitio único. Profes y familias lo consultan.
2. **Velocidad de registro**: el pase de lista batch pre-rellena la descripción desde el menú vigente y solo pide la cantidad por niño. Una sola pantalla cubre todo el aula.

Es una mejora operativa, no un dato nuevo: las `comidas` se siguen guardando igual. La plantilla **no** materializa filas — el campo `descripcion` de cada `comidas` row se rellena en el momento de marcar la cantidad, copiando el menú vigente para esa fecha y momento.

## User stories

- US-33: Como admin, quiero crear una plantilla de menú con desayuno / media mañana / comida / merienda para lunes a viernes, guardarla como borrador y publicarla cuando esté lista.
- US-34: Como admin, quiero ver la plantilla publicada actualmente y archivarla cuando publique otra.
- US-35: Como profe, quiero abrir el pase de lista de comida de mi aula para un momento del día, ver la descripción del menú pre-cargada y marcar la cantidad que comió cada niño en una sola pantalla.
- US-36: Como profe, quiero modificar la descripción de un niño concreto si ha traído tupper o no ha comido el menú estándar.
- US-37: Como profe, quiero aplicar una cantidad ("todos comieron todo") a todas las filas con un solo click.
- US-38: Como familia, quiero ver en la agenda de mi hijo qué se sirvió ese día como menú del centro.
- US-39: Como profe, quiero que los niños con lactancia materna o biberón estén **excluidos** del pase de lista de comida sólida (se siguen gestionando en biberones).
- US-40: Como cualquier rol, quiero que las plantillas y los registros de comida sigan la regla de "día cerrado" (ADR-0016).

## Alcance

**Dentro:**

- Plantilla de menú **por día de la semana** (lunes–viernes), no por fecha específica.
- 4 momentos por día (desayuno, media mañana, comida, merienda) reusando el enum `momento_comida` de F3 — sin cambios al enum.
- Estado de plantilla: `borrador`, `publicada`, `archivada`. Una sola `publicada` por centro a la vez.
- Vigencia opcional con `vigente_desde` / `vigente_hasta` (rangos de validez).
- Helper SQL `menu_del_dia(centro, fecha)` que resuelve la plantilla vigente y devuelve los 4 momentos.
- Helper SQL `nino_toma_comida_solida(nino_id)` para filtrar del pase de lista a los niños con lactancia exclusiva.
- Pase de lista batch en `/teacher/aula/[id]/comida` reusando `<PaseDeListaTable />`.
- Widget compacto "Menú del día" en `/family/nino/[id]`.
- Card "Menú vigente" en el dashboard admin.

**Fuera (no se hace aquí):**

- **Excepciones por fecha** (festivos, fiestas, días especiales). Si el centro las pide, se modela en Ola 2.
- **Múltiples plantillas simultáneas** por centro (ej. una por aula). Centro = unidad. Si Ola 2 lo demanda, ya hay sitio en el modelo.
- **Calorías, ingredientes, alérgenos**. El campo es texto libre por ahora.
- **Importación desde PDF del catering**. Manual con copy/paste.
- **Notificaciones push** cuando se publica un menú. No es operativo, solo info.

## Comportamientos detallados

### B36 — Crear plantilla de menú (admin)

**Pre-condiciones:**

- Rol admin del centro.

**Flujo:**

1. Admin entra a `/admin/menus` y pulsa "Crear plantilla".
2. Form de cabecera: `nombre` (obligatorio), `vigente_desde` (opcional), `vigente_hasta` (opcional).
3. Backend INSERT con `estado='borrador'`, `creada_por = auth.uid()`.
4. Redirige a `/admin/menus/[id]` (editor).
5. En el editor hay 5 secciones (lunes a viernes), cada una con 4 inputs textarea (≤ 500 chars cada uno).
6. Al guardar cada sección, UPSERT en `plantilla_menu_dia` por `(plantilla_id, dia_semana)`.

**Post-condiciones:**

- Plantilla creada en estado `borrador`, no visible para profes ni familias.

### B37 — Publicar plantilla (admin)

**Pre-condiciones:**

- Plantilla existe en estado `borrador`.
- Tiene al menos 1 `plantilla_menu_dia` con al menos 1 momento descrito (validación cliente; el servidor no obliga porque puede haber casos extremos).

**Flujo:**

1. Admin pulsa "Publicar" en la lista o en el editor.
2. Dialog de confirmación: "Esto archivará la plantilla publicada actual ¿continuar?".
3. Server action `publicar-plantilla`:
   - Si existe otra plantilla con `estado='publicada'` en el mismo centro, la pasa a `archivada` (transacción).
   - Pone la nueva como `publicada`.

**Post-condiciones:**

- Solo una plantilla `publicada` por centro (índice parcial único lo garantiza).
- La plantilla anterior queda `archivada`.

### B38 — Archivar plantilla

**Pre-condiciones:**

- Plantilla en estado `publicada` o `borrador`.

**Flujo:**

1. Admin pulsa "Archivar". Dialog de confirmación.
2. UPDATE `estado='archivada'`.

**Post-condiciones:**

- Plantilla no aparece en el pase de lista ni en el widget de la familia.
- No se borra (`DELETE` bloqueado a todos). Queda en BD para histórico.

### B39 — Pase de lista batch de comida (profe)

**Pre-condiciones:**

- Rol profe asignado al aula.
- Fecha = hoy Madrid (ADR-0013/0016). Si no, vista read-only.

**Flujo:**

1. Profe entra a `/teacher/aula/[id]/comida?momento=comida` (o tab en detalle aula).
2. Selector de fecha (DayPicker reutilizado de F4) + selector de momento (4 botones).
3. Query `getPaseDeListaComida(aulaId, fecha, momento)` devuelve:
   - Lista de niños matriculados activos en el aula CON `nino_toma_comida_solida(id) = true`.
   - Para cada niño, su `comidas` row existente para (nino_id, fecha, momento) si la hay (vía `agendas_diarias` JOIN), o null.
   - Descripción del menú del día (`menu_del_dia(centro, fecha)`) para el momento seleccionado.
4. Si NO hay plantilla publicada → empty state con CTA "Pídele al admin que publique el menú".
5. Si hay plantilla:
   - Cabecera muestra "Menú: [descripción del momento]".
   - `<PaseDeListaTable />`:
     - Columna "Descripción" (text-short): default = menú del día. Editable por niño (override).
     - Columna "Cantidad" (enum-badges): `todo`, `mayoria`, `mitad`, `poco`, `nada`.
     - Columna "Observaciones" (text-short, ≤ 500).
     - Quick action "Aplicar cantidad a todos": pre-marca todas las filas pendientes con la cantidad elegida y el menú del día como descripción.
6. Profe submit batch:
   - Server action `batch-registrar-comidas`: para cada fila dirty, UPSERT en `comidas` por `(agenda_id, momento)` con el campo `hora` que el profe puede dejar null (el menú no es hora específica). UPSERT crea la `agendas_diarias` si no existe (ADR-0012 lazy).
   - RLS de `comidas` impone `dentro_de_ventana_edicion(fecha)`.

**Post-condiciones:**

- Filas en `comidas` creadas/actualizadas.
- Realtime ya activo (F3) propaga a familia.

### B40 — Override por niño

Misma flow que B39, pero la profe edita la columna "Descripción" antes de submitir. El valor guardado en `comidas.descripcion` es el override, no el menú del día. La plantilla queda intacta.

### B41 — Vista familia "Menú del día"

**Pre-condiciones:**

- Tutor con vínculo activo al niño.

**Flujo:**

1. En `/family/nino/[id]`, sección Agenda (ya existente de F3), se añade un widget compacto arriba:
   - Si hay plantilla publicada vigente para `fecha` y el momento seleccionado: muestra texto "Menú del día — [Comida]: …".
   - Si no hay plantilla: el widget no aparece (sin error).
2. La descripción que ve la familia es la de la plantilla, NO los overrides por niño (que son hechos privados del aula).

### B42 — Exclusión de niños con lactancia exclusiva

**Pre-condiciones:**

- Niño con `datos_pedagogicos_nino.lactancia_estado IN ('materna', 'biberon', 'mixta')`.

**Flujo:**

1. Query `getPaseDeListaComida` filtra con `nino_toma_comida_solida(id) = true`.
2. El niño no aparece en el pase de lista de comida sólida.
3. Sigue siendo registrable en `biberones` (F3) por la vía existente — esta feature no toca esa flow.

> **Nota de ajuste vs prompt original**: el prompt mencionaba `tipo_alimentacion='biberon'` como exclusión, pero ese enum (de F2.6) no tiene tal valor (sus opciones son omnivora/vegetariana/vegana/sin_lactosa/sin_gluten/religiosa_halal/religiosa_kosher/otra). La exclusión real funcional es por `lactancia_estado IN ('materna', 'biberon', 'mixta')`. `tipo_alimentacion` se queda como información dietética, no excluye del pase de lista. **Ajuste documentado en este spec, requiere aprobación.**

### B43 — Día cerrado

Sigue la regla ADR-0016 transversal:

- Pase de lista de comida en `fecha != hoy_madrid()` → read-only.
- Inputs disabled, sin quick actions ni botón submit.
- Para histórico se muestra la cantidad ya registrada como badge (mismo patrón que el `<AsistenciaReadOnlyList />` de F4 podría reutilizarse si se ve útil; para esta fase basta con disabled).

## Casos edge

- **Sin plantilla publicada**: pase de lista muestra empty state con CTA al admin. Widget familia oculto.
- **Sábado/domingo**: `menu_del_dia` devuelve filas vacías. UI muestra "Sin menú definido este día".
- **Plantilla con días incompletos**: la profe ve solo los momentos que el admin haya rellenado para el día seleccionado.
- **Niño con `datos_pedagogicos_nino` ausente**: el helper asume que sí toma sólidos (TRUE por defecto), para no excluir indebidamente niños sin datos.
- **Niño matriculado a mitad del día**: query filtra por matrícula activa al momento de la query.
- **Cambio de aula**: si el niño pasa de aula B a aula A hoy, el pase de lista de A lo incluye; el histórico de B no se ve afectado.
- **Override "tupper": la familia ve el menú estándar**: decisión consciente para no exponer overrides privados (no se materializan al widget familia).
- **Concurrencia**: dos profes pasan lista a la vez sobre la misma aula. El UPSERT por `(agenda_id, momento)` resuelve last-write-wins; el `updated_at` queda con el último.
- **Vigencia futura**: si admin pone `vigente_desde = mañana`, la plantilla no aparece hoy. Coherente con `menu_del_dia`.
- **Sin conexión**: igual que el resto de mutaciones — el patrón Result devuelve `error: 'menus.errors.guardar_fallo'`, UI muestra error inline.

## Validaciones (Zod)

```typescript
export const estadoPlantillaMenuEnum = z.enum(['borrador', 'publicada', 'archivada'])
export const diaSemanaEnum = z.enum(['lunes', 'martes', 'miercoles', 'jueves', 'viernes'])

export const plantillaMenuCrearSchema = z
  .object({
    nombre: z.string().min(2).max(120),
    vigente_desde: fechaSchema.nullable(),
    vigente_hasta: fechaSchema.nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.vigente_desde && v.vigente_hasta && v.vigente_hasta < v.vigente_desde) {
      ctx.addIssue({
        code: 'custom',
        path: ['vigente_hasta'],
        message: 'menus.validation.rango_invalido',
      })
    }
  })

export const plantillaMenuDiaSchema = z.object({
  plantilla_id: z.string().uuid(),
  dia_semana: diaSemanaEnum,
  desayuno: z.string().max(500).nullable(),
  media_manana: z.string().max(500).nullable(),
  comida: z.string().max(500).nullable(),
  merienda: z.string().max(500).nullable(),
})

export const comidaBatchItemSchema = z.object({
  nino_id: z.string().uuid(),
  descripcion: z.string().max(500).nullable(),
  cantidad: cantidadComidaEnum, // reusa enum de F3
  observaciones: z.string().max(500).nullable(),
})

export const comidaBatchInputSchema = z.object({
  fecha: fechaSchema,
  momento: momentoComidaEnum, // reusa enum de F3
  items: z.array(comidaBatchItemSchema).min(1),
})
```

## Modelo de datos afectado

**Tablas nuevas:**

### `plantillas_menu`

| Columna         | Tipo                    | Nulable | Default           | Notas                                   |
| --------------- | ----------------------- | ------- | ----------------- | --------------------------------------- |
| `id`            | uuid                    | NO      | gen_random_uuid() | PK                                      |
| `centro_id`     | uuid                    | NO      | —                 | FK `centros(id)` ON DELETE CASCADE      |
| `nombre`        | text                    | NO      | —                 | CHECK length 2..120                     |
| `estado`        | `estado_plantilla_menu` | NO      | 'borrador'        |                                         |
| `vigente_desde` | date                    | SÍ      | —                 |                                         |
| `vigente_hasta` | date                    | SÍ      | —                 | CHECK >= vigente_desde si ambos no null |
| `creada_por`    | uuid                    | SÍ      | —                 | FK `usuarios(id)` ON DELETE SET NULL    |
| `created_at`    | timestamptz             | NO      | now()             |                                         |
| `updated_at`    | timestamptz             | NO      | now()             | trigger `set_updated_at`                |
| `deleted_at`    | timestamptz             | SÍ      | —                 | soft delete                             |

- Índice parcial único: `(centro_id) WHERE estado = 'publicada' AND deleted_at IS NULL`. Garantiza máximo 1 publicada por centro.
- Índice secundario: `(centro_id, estado)` para listados.

### `plantilla_menu_dia`

| Columna        | Tipo                                              | Nulable | Default           | Notas                                      |
| -------------- | ------------------------------------------------- | ------- | ----------------- | ------------------------------------------ |
| `id`           | uuid                                              | NO      | gen_random_uuid() |                                            |
| `plantilla_id` | uuid                                              | NO      | —                 | FK `plantillas_menu(id)` ON DELETE CASCADE |
| `dia_semana`   | `dia_semana`                                      | NO      | —                 |                                            |
| `desayuno`     | text                                              | SÍ      | —                 | CHECK length ≤ 500                         |
| `media_manana` | text                                              | SÍ      | —                 | CHECK length ≤ 500                         |
| `comida`       | text                                              | SÍ      | —                 | CHECK length ≤ 500                         |
| `merienda`     | text                                              | SÍ      | —                 | CHECK length ≤ 500                         |
| `created_at`   | timestamptz                                       | NO      | now()             |                                            |
| `updated_at`   | timestamptz                                       | NO      | now()             | trigger `set_updated_at`                   |
| UNIQUE         | (plantilla_id, dia_semana) — un día por plantilla |

**ENUMs nuevos:**

- `estado_plantilla_menu`: `borrador`, `publicada`, `archivada`.
- `dia_semana`: `lunes`, `martes`, `miercoles`, `jueves`, `viernes`.

**Tablas modificadas:** ninguna.

**Tablas consultadas:** `comidas` (mutaciones del pase de lista), `agendas_diarias` (lazy create), `matriculas` (filtro por aula), `datos_pedagogicos_nino` (exclusión por lactancia), `ninos` (datos básicos para la lista).

## Helpers RLS

Reusa los existentes (`es_admin`, `pertenece_a_centro`, `es_profe_de_aula`, `es_tutor_de`).

Helper nuevo de lookup (mismo patrón que `centro_de_nino`, ver ADR-0007):

```sql
CREATE OR REPLACE FUNCTION public.centro_de_plantilla(p_plantilla_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT centro_id FROM public.plantillas_menu WHERE id = p_plantilla_id;
$$;
```

Helper nuevo de negocio (consulta del menú vigente):

```sql
CREATE OR REPLACE FUNCTION public.menu_del_dia(p_centro_id uuid, p_fecha date)
RETURNS TABLE(desayuno text, media_manana text, comida text, merienda text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dia public.dia_semana;
BEGIN
  v_dia := CASE EXTRACT(ISODOW FROM p_fecha)::int
    WHEN 1 THEN 'lunes'::public.dia_semana
    WHEN 2 THEN 'martes'::public.dia_semana
    WHEN 3 THEN 'miercoles'::public.dia_semana
    WHEN 4 THEN 'jueves'::public.dia_semana
    WHEN 5 THEN 'viernes'::public.dia_semana
    ELSE NULL
  END;
  IF v_dia IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT pd.desayuno, pd.media_manana, pd.comida, pd.merienda
    FROM public.plantillas_menu pm
    JOIN public.plantilla_menu_dia pd ON pd.plantilla_id = pm.id
    WHERE pm.centro_id = p_centro_id
      AND pm.estado = 'publicada'
      AND pm.deleted_at IS NULL
      AND (pm.vigente_desde IS NULL OR pm.vigente_desde <= p_fecha)
      AND (pm.vigente_hasta IS NULL OR pm.vigente_hasta >= p_fecha)
      AND pd.dia_semana = v_dia
    LIMIT 1;
END;
$$;
```

Nota: uso `ISODOW` (lunes=1, domingo=7) en lugar de `DOW` (domingo=0, lunes=1) para que el `CASE` sea más natural y robusto.

Helper de exclusión de niños:

```sql
CREATE OR REPLACE FUNCTION public.nino_toma_comida_solida(p_nino_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT lactancia_estado NOT IN ('materna'::public.lactancia_estado,
                                     'biberon'::public.lactancia_estado,
                                     'mixta'::public.lactancia_estado)
     FROM public.datos_pedagogicos_nino
     WHERE nino_id = p_nino_id),
    TRUE
  );
$$;
```

> **Ajuste vs prompt original** (ver B42): el prompt usaba `tipo_alimentacion != 'biberon'` que es vacuo porque ese enum no tiene tal valor. Se reemplaza por `lactancia_estado IN ('materna','biberon','mixta')` que sí es semánticamente correcto. Documentado y a revisar en Checkpoint A.

## Políticas RLS

### `plantillas_menu`

```sql
-- SELECT: admin/profe/tutor del mismo centro
CREATE POLICY pm_select ON public.plantillas_menu
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND public.pertenece_a_centro(centro_id)
  );

-- INSERT/UPDATE: admin del centro
CREATE POLICY pm_admin_insert ON public.plantillas_menu
  FOR INSERT WITH CHECK (public.es_admin(centro_id));

CREATE POLICY pm_admin_update ON public.plantillas_menu
  FOR UPDATE
  USING (public.es_admin(centro_id))
  WITH CHECK (public.es_admin(centro_id));

-- DELETE: nadie (default DENY)
```

### `plantilla_menu_dia`

```sql
CREATE POLICY pmd_select ON public.plantilla_menu_dia
  FOR SELECT
  USING (public.pertenece_a_centro(public.centro_de_plantilla(plantilla_id)));

CREATE POLICY pmd_admin_insert ON public.plantilla_menu_dia
  FOR INSERT WITH CHECK (public.es_admin(public.centro_de_plantilla(plantilla_id)));

CREATE POLICY pmd_admin_update ON public.plantilla_menu_dia
  FOR UPDATE
  USING (public.es_admin(public.centro_de_plantilla(plantilla_id)))
  WITH CHECK (public.es_admin(public.centro_de_plantilla(plantilla_id)));

-- DELETE: nadie (default DENY). Si admin necesita borrar, archiva.
```

Nota: `pertenece_a_centro` cubre admin, profe y tutor (cualquiera con rol activo en el centro o con vínculo a un niño matriculado en el centro).

## Pantallas y rutas

**Admin:**

- `/admin/menus` (Server) — listado de plantillas del centro.
- `/admin/menus/nueva` (Server + Form Client) — wizard de creación (cabecera + redirección al editor).
- `/admin/menus/[id]` (Server + Editor Client) — editor con 5 días × 4 momentos.
- Card "Menú vigente" en `/admin` (Server) — muestra nombre y vigencia de la plantilla publicada.

**Profe:**

- `/teacher/aula/[id]/comida?momento=desayuno|media_manana|comida|merienda&fecha=YYYY-MM-DD` (Server + Cliente).
- Link "Pase de comida" en `/teacher/aula/[id]` junto al de asistencia.

**Familia:**

- En `/family/nino/[id]`, sección Agenda existente: widget compacto "Menú del día" arriba de la lista de eventos (solo si hay plantilla vigente y el día tiene menú).

## Componentes UI

- `PlantillaMenuList.tsx` (Server) — listado admin con acciones (publicar/archivar).
- `PlantillaMenuEditor.tsx` (Client) — editor de los 5 días con autosave por sección al perder foco.
- `PublicarPlantillaDialog.tsx` (Client) — confirmación.
- `PaseDeListaComidaCliente.tsx` (Client) — monta `<PaseDeListaTable />` con columnas de comida y query de menú vigente. Reusa `AsistenciaDayPicker` (movido a shared) o crea su gemelo si no se quiere coupling.
- `MenuDelDiaWidget.tsx` (Server) — widget compacto familia/admin.

> Decisión: el `AsistenciaDayPicker` ya soporta tres modos (hoy/histórico/futuro). Se renombra a `ModalidadDayPicker` o se mueve a `src/shared/components/day-picker/` para reuso. Si renombrarlo añade riesgo, se duplica con nombre `ComidaDayPicker` (3 líneas de diferencia). Discutir en Checkpoint A.

## Eventos y notificaciones

- Audit log automático: triggers en `plantillas_menu` y `plantilla_menu_dia` (INSERT/UPDATE/DELETE). Acción capturada con su `centro_id`.
- Realtime: las `comidas` ya están publicadas en `supabase_realtime` (F3) → la familia recibe la actualización al guardar el pase de lista.
- Push: ninguna en esta fase.

## i18n

Namespaces nuevos: `menus.*` (admin), `comida_batch.*` (pase de lista profe).

```json
{
  "menus": {
    "title": "Menús del centro",
    "subtitle": "Plantilla semanal que verán profes y familias.",
    "nueva": "Crear plantilla",
    "estado": {
      "borrador": "Borrador",
      "publicada": "Publicada",
      "archivada": "Archivada"
    },
    "dia": {
      "lunes": "Lunes",
      "martes": "Martes",
      "miercoles": "Miércoles",
      "jueves": "Jueves",
      "viernes": "Viernes"
    },
    "momento": {
      "desayuno": "Desayuno",
      "media_manana": "Media mañana",
      "comida": "Comida",
      "merienda": "Merienda"
    },
    "campos": {
      "nombre": "Nombre",
      "vigente_desde": "Vigente desde",
      "vigente_hasta": "Vigente hasta"
    },
    "publicar": "Publicar",
    "publicar_confirm": "Esto archivará la plantilla publicada actual ¿continuar?",
    "archivar": "Archivar",
    "archivar_confirm": "Esta acción no se puede deshacer desde la app.",
    "vigente": "Menú vigente",
    "sin_publicada": "Aún no se ha publicado ningún menú.",
    "validation": {
      "nombre_corto": "Nombre demasiado corto",
      "rango_invalido": "La fecha final debe ser igual o posterior a la inicial",
      "descripcion_larga": "Máximo 500 caracteres"
    },
    "errors": {
      "guardar_fallo": "No se pudo guardar. Inténtalo de nuevo.",
      "publicar_fallo": "No se pudo publicar."
    }
  },
  "comida_batch": {
    "title": "Pase de comida",
    "ver": "Pase de comida",
    "momento_label": "Momento",
    "menu_del_dia": "Menú del día",
    "sin_plantilla": {
      "title": "Aún no hay menú publicado",
      "description": "Pídele al administrador del centro que publique el menú del mes."
    },
    "columna": {
      "descripcion": "Descripción",
      "cantidad": "Cantidad",
      "observaciones": "Observaciones"
    },
    "quick_actions": {
      "todos_aplicar": "Aplicar cantidad a todos"
    },
    "guardar": "Confirmar pase de comida",
    "guardando": "Guardando…",
    "guardado": "Guardado",
    "errors": {
      "fuera_de_ventana": "Ya no puedes editar este día.",
      "guardar_fallo": "No se pudo guardar. Inténtalo de nuevo."
    }
  },
  "menu_del_dia_widget": {
    "title": "Menú del día"
  }
}
```

## Accesibilidad

- `<PaseDeListaTable />` ya cubre roles ARIA (table/row/cell/columnheader).
- DayPicker reusado con `aria-live="polite"` ya implementado.
- Selector de momento como `radiogroup` con `aria-checked`.
- Errores Zod inline con `aria-invalid` + mensaje en `role="alert"`.

## Performance

- Query `menu_del_dia` con LIMIT 1, índice parcial cubre la búsqueda.
- `getPaseDeListaComida` hace ~5 queries en paralelo (matrículas, comidas, menú, datos pedagógicos, info médica para alertas), ningún N+1.
- Realtime ya en su sitio, sin cambios.
- Bundle: nuevas páginas admin pueden permanecer dentro de los presupuestos actuales; el editor admin es algo más pesado por los 5 form sections + autosave.

## Telemetría

Sin telemetría custom en esta fase. Se reutilizan los eventos existentes de agenda y asistencia donde aplique.

## Tests requeridos

**Vitest (unit/integration):**

- [ ] Schema `plantillaMenuCrearSchema` valida rango fechas.
- [ ] Schema `plantillaMenuDiaSchema` valida longitudes.
- [ ] Schema `comidaBatchInputSchema` valida items ≥ 1.

**Vitest (RLS) — mínimo 5:**

- [ ] Aislamiento entre centros: admin A no ve plantillas de centro B.
- [ ] Aislamiento entre centros: admin A no puede crear plantilla apuntando a centro B.
- [ ] Profe puede leer plantillas de su centro.
- [ ] Profe NO puede crear/actualizar plantillas.
- [ ] Tutor puede leer plantillas de su centro.
- [ ] DELETE bloqueado a todos (admin incluido).

**Vitest (functions):**

- [ ] `menu_del_dia(centro, lunes)` devuelve la fila correcta cuando hay publicada.
- [ ] `menu_del_dia(centro, sabado)` devuelve cero filas.
- [ ] `menu_del_dia(centro, lunes)` devuelve cero filas si la publicada está fuera del rango de vigencia.
- [ ] `nino_toma_comida_solida` devuelve FALSE si `lactancia_estado='materna'`.
- [ ] `nino_toma_comida_solida` devuelve FALSE si `lactancia_estado='biberon'`.
- [ ] `nino_toma_comida_solida` devuelve TRUE si no hay `datos_pedagogicos_nino`.

**Vitest (audit):**

- [ ] INSERT en `plantillas_menu` genera fila en `audit_log` con `accion='INSERT'` y `centro_id` correcto.

**Playwright (E2E) — al menos 2:**

- [ ] Admin crea plantilla, rellena los 5 días, publica → aparece como "Publicada" en la lista.
- [ ] Profe abre pase de comida, ve menú del día como descripción default, aplica cantidad a todos con quick action, guarda → al recargar ve los registros (cardinalidad correcta).
- [ ] (`test.skip` con `E2E_REAL_SESSIONS=1`): Profe modifica descripción de un niño (override), guarda, recarga → ve el override; familia ve menú estándar (no el override).

## Criterios de aceptación

- [ ] Todos los tests verdes en CI.
- [ ] Migración aplicada al remoto sin errores; tipos regenerados.
- [ ] i18n completa en es/en/va para los namespaces nuevos.
- [ ] Vercel deploy verde tras merge.
- [ ] `data-model.md`, `rls-policies.md`, `progress.md`, `scope-ola-1.md` actualizados.
- [ ] ADR-0017 y ADR-0018 creados y marcados `accepted`.

## Decisiones técnicas relevantes

- **ADR-0017 — Plantilla por día de semana vs fecha específica**: día de semana cubre 95% de centros. Excepciones se modelan en Ola 2.
- **ADR-0018 — Lazy materialization desde plantilla a `comidas`**: la plantilla NO duplica filas. La descripción se copia al rellenar el pase de lista. Mantiene `comidas` como tabla de hechos y `plantillas_menu` como intención.

## Pendiente de aprobación en Checkpoint A

1. **Helper `nino_toma_comida_solida`**: ajuste documental respecto al prompt. Filtra por `lactancia_estado IN ('materna','biberon','mixta')`, no por `tipo_alimentacion='biberon'` (valor inexistente). ¿OK?
2. **DayPicker compartido**: ¿renombrar `AsistenciaDayPicker` → `ModalidadDayPicker` y mover a `src/shared/components/`? ¿O duplicar para evitar coupling entre F4/F4.5?
3. **Override de descripción visible a familia**: confirmado que la familia ve el menú estándar de la plantilla, no el override por niño. ¿OK?
4. **`ISODOW` vs `DOW`**: usar `ISODOW` en el helper (lunes=1) para consistencia interna del enum. ¿OK?
5. **`comidas.hora` opcional al batch**: el pase de lista batch deja `hora=NULL` (al menú no se le asigna una hora concreta). Coherente con el CHECK actual de `comidas` (la columna ya es nullable). ¿OK?

## Referencias

- ADR-0014 — Componente `<PaseDeListaTable />` reutilizable.
- ADR-0011 — Timezone Madrid.
- ADR-0013 — Mismo día agenda.
- ADR-0016 — Día cerrado transversal.
- Spec `attendance.md` (F4) — patrón pase de lista.
- Spec `daily-agenda.md` (F3) — tabla `comidas`.
- Spec `core-entities.md` (F2) — tablas `centros`, `ninos`, `matriculas`, `vinculos_familiares`.
