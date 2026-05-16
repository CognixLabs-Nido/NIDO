# ADR-0021: Extensión de `comidas` con `tipo_plato` vs tabla separada

## Estado

`accepted`

**Fecha:** 2026-05-16
**Autores:** jovimib + claude-code
**Fase del proyecto:** Fase 4.5b — Menús mensuales

## Contexto

Fase 3 estructuró las comidas como **una fila por `momento`** (desayuno / media_manana / comida / merienda). Cada fila guarda `cantidad`, `descripcion`, `hora`, `observaciones`. F3 no necesitaba más: la profe registra "la comida del niño" como una unidad.

Fase 4.5b introduce el **pase de lista comida por platos**: el momento `comida` tiene 3 platos (primer plato + segundo plato + postre) y la profe quiere marcar cuánto comió de cada uno por separado. Caso real ANAIA: "el primer plato lo comió todo pero el segundo nada — la familia lo preguntará".

Hay dos formas de modelar esto:

### Opción A: Tabla separada `comida_platos` 1:N a `comidas`

`comidas` queda como F3 (genérica del momento). Una nueva tabla `comida_platos(id, comida_id FK, tipo_plato, cantidad, descripcion)`.

**Pros:**

- F3 intacto a nivel datos.
- Separación conceptual: `comidas` = "evento del momento", `comida_platos` = "detalle".
- Posibilidad futura de tener un evento `comidas` con observaciones generales del momento y N platos con detalle.

**Contras:**

- Doble JOIN en la query del pase de lista y de la vista familia.
- "Una sola fila padre vacía" cuando solo se marca 1 plato — sintetiza información que no aporta.
- El audit log se reparte entre `comidas` y `comida_platos`; reconstruir "qué comió el niño en la comida" exige composición.
- Migración más compleja: si en el futuro queremos volver a "comida unitaria", hay que cargar el batch.
- Las queries de la agenda diaria de F3 tendrían que ampliarse para mostrar los platos — pero `comidas` ya devolvía suficiente.

### Opción B: Extender `comidas` con `tipo_plato` (la elegida)

`ALTER TABLE comidas ADD COLUMN tipo_plato tipo_plato_comida NULL`. Las filas de F3 quedan con `tipo_plato=NULL`; las filas del batch del pase de lista vienen con `tipo_plato` no nulo. Una fila por (agenda_id, momento, tipo_plato).

Además: `menu_dia_id NULL REFERENCES menu_dia(id) ON DELETE SET NULL` como traza opcional al menú origen.

**Pros:**

- Las queries de F3 funcionan sin cambios: `SELECT * FROM comidas WHERE agenda_id=?`.
- El batch del pase de lista hace UPSERT atómico sobre el índice único parcial `(agenda_id, momento, tipo_plato) WHERE tipo_plato IS NOT NULL`.
- La vista familia/profe agrupa por `momento` y desglosa por `tipo_plato` cuando lo hay — sin tocar la estructura, solo la presentación.
- Compatibilidad total con datos pre-F4.5b: las filas viejas mantienen `tipo_plato=NULL` y se renderizan como antes (fila única del momento).
- Audit log unificado: cualquier cambio sobre una comida (legacy o nueva) queda en la misma tabla.
- ON DELETE SET NULL en `menu_dia_id`: si una plantilla se borra (CASCADE desde centro), las cantidades históricas sobreviven.

**Contras:**

- `comidas` se vuelve ligeramente bicéfala: filas con `tipo_plato=NULL` (legacy F3 o registros individuales sin batch) y filas con `tipo_plato` no nulo (batch pase de lista o pase comida individual). Hay que documentarlo (este ADR + spec) y los componentes UI lo gestionan vía `agruparComidasPorMomento`.
- El índice único parcial `WHERE tipo_plato IS NOT NULL` requiere predicado explícito en `ON CONFLICT` — PostgREST/supabase-js no lo soporta directamente, por lo que las server actions usan el patrón "lookup + split en UPDATE/INSERT" (documentado en `batch-registrar-comidas-platos.ts`).

## Decisión

**Se elige la Opción B.** Extender `comidas` con `tipo_plato NULL` + `menu_dia_id NULL` + índice único parcial. Las filas legacy de F3 (`tipo_plato=NULL`) y las nuevas de F4.5b (`tipo_plato` no nulo) coexisten en la misma tabla.

Razones decisivas:

1. **Continuidad para la familia/profe**: la sección "Comidas" de la agenda muestra todo lo que comió el niño en un solo lugar; no hay distinción "comidas de antes" vs "platos de ahora".
2. **F3 sigue funcionando sin tocar nada**: `upsertComida`, queries y vistas existentes operan sobre las filas como antes.
3. **Auditoría unificada**: una sola tabla con un solo trigger captura todo cambio sobre lo que el niño come.

## Consecuencias

### Positivas

- F3 intacto: cero migración de datos.
- Las server actions del pase de lista batch usan `comidas` directamente — sin tabla intermedia.
- El helper TS `agruparComidasPorMomento` resuelve el render bicéfalo en un solo lugar, con tests unitarios que cubren los 6 casos (legacy puro, nuevo puro, mezcla, vacío, orden, tipo `unico`).

### Negativas

- Una tabla con filas semánticamente distintas (legacy vs nuevas). El comentario en la migración y este ADR lo documentan.
- El batch UPSERT requiere el patrón "lookup + split" (el `ON CONFLICT (cols) WHERE pred` no es expresable desde supabase-js sin RPC custom). Documentado en `batch-registrar-comidas-platos.ts`.

### Neutras

- 2 columnas nuevas en `comidas`, 1 índice único parcial, 1 índice secundario para joins desde `menu_dia_id`.
- El audit trigger de F3 ya graba `to_jsonb(NEW)` con todas las columnas — recoge automáticamente las nuevas.

## Plan de implementación

- [x] `ALTER TABLE comidas ADD COLUMN tipo_plato`, `menu_dia_id`.
- [x] `CREATE UNIQUE INDEX … WHERE tipo_plato IS NOT NULL`.
- [x] Ampliar `ComidaRow` TS con `tipo_plato` y `menu_dia_id`.
- [x] Helper `agruparComidasPorMomento` + tests unitarios.
- [x] Actualizar `<AgendaFamiliaView />` y `<SeccionComidas />` para usar el helper.
- [x] Server action `batchRegistrarComidasPlatos` con patrón lookup+split.

## Verificación

- Tests RLS de F3 sobre `comidas` siguen verdes (regresión OK).
- Tests unit `agruparComidasPorMomento` cubren legacy, nuevo, mezcla.
- Tests audit verdes — `comidas` audit de F3 no necesita cambios.

## Referencias

- Spec: `/docs/specs/menus.md`.
- ADRs relacionados: ADR-0020 (plantilla mensual), ADR-0022 (escala 1-5).
- Spec daily-agenda: `/docs/specs/daily-agenda.md`.
- Patrón lookup+split: action `aplicarTipoARango` de F4.5a.
