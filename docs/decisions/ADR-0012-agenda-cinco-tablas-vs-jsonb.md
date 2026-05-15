# ADR-0012: 5 tablas separadas para la agenda diaria, no JSONB

## Estado

`accepted`

**Fecha:** 2026-05-15
**Autores:** Claude Code + responsable NIDO
**Fase del proyecto:** Fase 3 — Agenda diaria + bienestar

## Contexto

La agenda diaria es la pantalla más usada de NIDO. Cada niño tiene, por día, una "cabecera" (humor, observaciones generales, estado general) y varios eventos puntuales: comidas (4 momentos al día), biberones, sueños, deposiciones. La cantidad de eventos por día y niño varía: un bebé pequeño puede tener 6-8 biberones; uno mayor solo 4 comidas.

Hay dos modelos de datos razonables: (A) **5 tablas separadas** (1 padre + 4 hijo en relación 1:N), o (B) **1 sola tabla** `agendas_diarias` con columnas JSONB para los eventos (`comidas jsonb`, `biberones jsonb`, etc.).

Decidimos antes de la Fase 3 cuál usar, porque cambiar el modelo después implica migración pesada (datos + RLS + audit log + UI).

## Opciones consideradas

### Opción A: 5 tablas separadas con FKs

```sql
agendas_diarias (id, nino_id, fecha, estado_general, humor, observaciones_generales, ...)
comidas         (id, agenda_id, momento, hora, cantidad, descripcion, observaciones, ...)
biberones       (id, agenda_id, hora, cantidad_ml, tipo, tomado_completo, observaciones, ...)
suenos          (id, agenda_id, hora_inicio, hora_fin, calidad, observaciones, ...)
deposiciones    (id, agenda_id, hora, tipo, consistencia, cantidad, observaciones, ...)
```

**Pros:**

- ENUMs Postgres en cada campo enumerado → integridad referencial fuerte.
- Tests RLS por tabla pueden validar políticas de manera granular.
- Audit log per-evento: cada INSERT/UPDATE deja una fila en `audit_log` con valores antes/después del **evento exacto** (no del blob entero).
- Supabase Realtime envía notificaciones por tabla y por fila — el cliente filtra por `agenda_id` sin parsear JSON.
- TypeScript estricto: tipos generados por Supabase son ricos, sin `Json` opaco.
- Queries analíticas (informes Fase 9): `SELECT AVG(cantidad_ml) FROM biberones WHERE agenda_id IN (...)` vs ungainly JSONB extracción.
- Índices `(agenda_id)` y constraints CHECK por campo (`cantidad_ml BETWEEN 0 AND 500`).

**Contras:**

- 5 ENUMs nuevos + 5 tablas + 15 políticas RLS (3 por tabla) en lugar de 1 conjunto.
- Server actions: 5 acciones de upsert + 1 de marcar-erróneo, más boilerplate.
- Coste de creación inicial mayor (≈500 líneas de migración SQL frente a ≈150).

### Opción B: 1 tabla con columnas JSONB

```sql
agendas_diarias (
  id, nino_id, fecha,
  estado_general, humor, observaciones_generales,
  comidas jsonb,      -- array de {momento, hora, cantidad, ...}
  biberones jsonb,    -- array
  suenos jsonb,
  deposiciones jsonb,
  ...
)
```

**Pros:**

- 1 sola tabla, 1 set de políticas RLS, 1 server action de upsert.
- Migración más corta.
- "Atomicidad por día": cualquier cambio impacta la fila completa.

**Contras:**

- Sin ENUMs en JSONB: la validación queda en Zod + CHECK constraints frágiles.
- `audit_log` captura el blob completo cada vez: el diff `valores_antes`/`valores_despues` es ruidoso (todos los campos JSONB) — difícil saber qué evento concreto se modificó.
- Realtime entrega un evento "se modificó el blob": el cliente debe diffearlo manualmente para saber qué cambió. Mucho código de UI.
- Tipos TS: Supabase los genera como `Json` opaco; necesitamos un wrapper Zod en cada lectura.
- Concurrencia: si dos profes editan a la vez, el último UPDATE sobrescribe sin merge — perdemos cambios silenciosamente (vs. con tablas separadas, cada evento es una fila independiente y los conflictos son por `id`, mucho más controlables).
- Análisis Fase 9: queries con `jsonb_array_elements` y `jsonb_path_query` son lentas y verbosas frente a SQL plano sobre tablas hijo.

### Opción C: tabla cabecera + 1 tabla de eventos genérica (`eventos_agenda` con `tipo` discriminator)

```sql
agendas_diarias (id, nino_id, fecha, ...)
eventos_agenda (id, agenda_id, tipo, payload jsonb)
```

**Pros:**

- Solo 2 tablas.
- Extensible: añadir un nuevo tipo de evento no requiere migración de esquema.

**Contras:**

- Vuelve al problema de JSONB para el contenido específico de cada tipo.
- Sin tipos TS ricos.
- Indices por tipo de evento son antinaturales.
- "Lo peor de los dos mundos": tienes que mantener tanto la tabla genérica como la lógica de discriminación por `tipo`.

## Decisión

**Se elige la Opción A (5 tablas separadas)** porque optimiza para los tres usos críticos de NIDO Ola 1 y futuras:

1. **Audit log per-evento** — RGPD y trazabilidad: cuando una familia pregunta "¿qué cambió en la merienda de mi hijo ayer?", el `audit_log` responde con la fila exacta de `comidas`, no con el blob entero del día.
2. **Realtime granular** — el diferencial del producto: la familia ve actualizaciones en vivo sin que el cliente tenga que diffear JSON.
3. **Informes Fase 9** — queries analíticas (medias, percentiles, frecuencias) son SQL plano sin gimnasia JSONB.

El coste (≈500 líneas SQL en una migración, 4 server actions más, 4 secciones UI) es asumible y queda dentro del alcance esperado de Fase 3.

## Consecuencias

### Positivas

- Tipos TypeScript ricos generados automáticamente por Supabase.
- Audit log entrega valor inmediato (granular por evento).
- Concurrencia robusta: dos profes pueden añadir eventos en paralelo sin pisarse.
- Postgres ENUMs validan a nivel BD (no solo Zod).
- Política RLS por tabla con `agenda_id` cohesivo simplifica el debugging.

### Negativas

- 5 ENUMs nuevos a mantener (`momento_comida`, `cantidad_comida`, `tipo_biberon`, `calidad_sueno`, `tipo_deposicion`, `consistencia_deposicion`, `cantidad_deposicion`, `estado_general_agenda`, `humor_agenda`).
- 15 políticas RLS (3 por tabla × 5 tablas) — duplicación inevitable.
- UI con 5 sub-componentes de sección frente a 1 tab JSONB.
- Cualquier nuevo tipo de evento futuro (ej. "medicación tomada") implica crear una tabla más con su set completo.

### Neutras

- Convención: cada tabla hija tiene `agenda_id`, no `nino_id` (la derivación va vía `agenda_id → nino_id → centro_id` para RLS).
- Naming: tablas en plural snake_case siguiendo convenciones NIDO.

## Plan de implementación

- [x] Crear los 9 ENUMs en la migración Fase 3.
- [x] Crear las 5 tablas con `agenda_id` FK ON DELETE CASCADE y CHECKs.
- [x] Helpers `centro_de_agenda`, `nino_de_agenda`, `fecha_de_agenda` SECURITY DEFINER STABLE.
- [x] 15 políticas RLS (SELECT/INSERT/UPDATE por tabla; DELETE default DENY).
- [x] Triggers `set_updated_at` en las 5 tablas.
- [x] Ampliar `audit_trigger_function()` con ramas para las 5 tablas.
- [x] `ALTER PUBLICATION supabase_realtime ADD TABLE ...` para las 5 tablas.
- [x] Schemas Zod en `src/features/agenda-diaria/schemas/`.
- [x] Server actions (`upsertAgendaCabecera`, `upsertComida`, etc.).
- [x] UI profe con 5 sub-secciones.

## Verificación

- Tests RLS por tabla en verde (`src/test/rls/agenda-diaria.rls.test.ts`).
- Tests audit (`src/test/audit/agenda-audit.test.ts`) verifican que `valores_antes` y `valores_despues` capturan el cambio de un evento individual, no del día entero.
- Schemas Zod tests (`src/features/agenda-diaria/__tests__/agenda-diaria.schema.test.ts`) en verde.
- Build prod completa sin errores de tipos.

## Notas

- Alternativa híbrida descartada: tablas hijo con `payload jsonb` para campos abiertos (ej. `observaciones`). Innecesario, `TEXT` con CHECK length ≤ 500 ya cubre.
- `agendas_diarias.nino_id` con `ON DELETE RESTRICT` (no CASCADE): si se borra un niño con histórico, queremos que falle el delete y forzar `deleted_at` (soft delete). Las tablas hijo sí tienen CASCADE: si se borra una agenda padre — operación que solo ocurriría manualmente vía SQL con razón fundada —, los eventos asociados van con ella.

## Referencias

- Spec: `/docs/specs/daily-agenda.md` § "Modelo de datos afectado"
- Migración: `supabase/migrations/20260515153711_phase3_daily_agenda.sql`
- ADR-0011 — Timezone Madrid
- ADR-0013 — Ventana de edición = mismo día
- ADR-0007 — RLS recursion avoidance (patrón helpers SECURITY DEFINER)
