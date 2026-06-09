# ADR-0042: Modelo de datos de Informes de evolución (F9)

## Estado

`accepted`

**Fecha:** 2026-06-09
**Autores:** Jovi Mibimbi + claude-code (Opus 4.8)
**Fase del proyecto:** Fase 9 — Informes de evolución (F9-0: capa de datos)

## Contexto

F9 añade los **informes de evolución** (boletines de desarrollo del niño): documentos cualitativos, estructurados en **áreas → ítems**, que la profe del aula rellena por niño y período y que la familia consulta y descarga en PDF cuando están publicados. No es el parte diario (eso es la agenda de F3): es la valoración pedagógica periódica.

La spec aprobada (`docs/specs/informes-evolucion.md`, resoluciones Q1–Q11) fija el comportamiento. F9-0 implementa **solo la capa de datos**: 2 tablas (`plantillas_informe`, `informes_evolucion` — ya previstas en `data-model.md` como `⏳ Fase 9`), sus RLS, helpers y tests. Sin UI ni server actions (eso es F9-1/F9-2).

Hay que decidir ahora la **forma del modelo** porque condiciona todo lo que viene encima: cómo se guarda la estructura áreas→ítems, cómo se aísla un informe de las ediciones posteriores de su plantilla, cómo se reparte la autoría entre tipos de personal, y cómo se evita el gotcha MVCC de RLS que ya nos mordió en F5/F8.

## Opciones consideradas

### Opción A: Estructura áreas→ítems en JSONB dentro de las 2 tablas (elegida)

`plantillas_informe.estructura` (jsonb) guarda `[{ titulo, items: [{ id, texto }] }]`. El informe guarda `estructura_snapshot` (copia congelada) + `respuestas` (jsonb `{ item_id: { valoracion, comentario } }`). Sin tablas hijo.

**Pros:**

- Encaja con las **2 tablas** que el `data-model.md` ya reservó para F9.
- La estructura es un **árbol** (áreas con ítems ordenados) que se lee y escribe siempre entero: JSONB es la representación natural, sin JOINs ni reordenamientos por FK.
- El **snapshot** (Q3/Q4) es trivial: copiar el jsonb de la plantilla al informe. Con tablas hijo habría que clonar filas y versionarlas.
- Sin análisis por ítem en F9 (ver Fuera): no necesitamos consultas agregadas sobre ítems individuales.

**Contras:**

- No hay validación referencial a nivel BD de la forma del jsonb (la garantiza Zod en el server action, F9-2).
- Consultas analíticas por ítem (medias, % de "conseguido" por aula) serían incómodas — **pero F9 NO las hace** (queda fuera de alcance).

### Opción B: Tablas hijo (`informe_areas`, `informe_items`, `informe_respuestas`)

Normalizar la estructura en filas, estilo ADR-0012 (que eligió 5 tablas para la agenda).

**Pros:**

- Consultas analíticas por ítem en SQL plano.
- Validación referencial a nivel BD.

**Contras:**

- **Amplía el conteo de tablas** del data-model (que fija 2 para F9) sin contraprestación: en F9 no hay análisis por ítem.
- El **snapshot** se vuelve caro: clonar N filas por informe y versionarlas para que editar la plantilla no afecte informes ya creados.
- Más superficie de RLS (3-4 tablas nuevas en vez de 2).

### Opción C: No hacer F9 con tablas propias (reusar autorizaciones/agenda)

Descartada de plano: los informes no son ni firmas (F8) ni hechos diarios (F3); tienen su propio ciclo de vida y audiencia.

## Decisión

**Se elige la Opción A: estructura áreas→ítems y respuestas en JSONB dentro de las 2 tablas previstas, sin tablas hijo.**

El matiz frente a **ADR-0012** (que prefirió tablas sobre JSONB para la agenda) es deliberado y se sostiene: ADR-0012 optó por tablas **porque la agenda alimenta queries analíticas** (medias de sueño/comida, percentiles — justamente "informes Fase 9"). Pero en F9 hemos decidido (spec, Fuera de alcance) que **el informe es cualitativo y NO agrega datos de la agenda ni analiza ítems individualmente**. Sin esa necesidad analítica, la razón de ADR-0012 no aplica y el árbol áreas→ítems se modela mejor como JSONB. Si en una fase futura se quiere análisis por ítem, se añadirá una proyección/tabla derivada sin re-modelar lo de F9.

Decisiones acopladas (todas de la spec, Q1–Q11):

- **Q1 — Varias plantillas por centro.** Sin índice único que fuerce una sola. El tramo de edad (p. ej. "1-2 años") es solo el `titulo` que ponga la dirección; **no se modela la edad**. La profe elige plantilla al crear el informe (F9-2).
- **Q3/Q4 — Snapshot.** `informes_evolucion.estructura_snapshot` congela la estructura de la plantilla en el momento de crear el informe. Editar la plantilla después **no** toca informes ya creados ni borradores en curso.
- **Q5 — Autoría por `tipo_personal_aula` (ADR-0032).** `coordinadora` y `profesora` redactan/publican; `tecnico` y `apoyo` solo leen; `admin` todo. Se implementa con el helper nuevo `es_redactor_de_nino` (espejo de `es_profe_de_nino` filtrando `tipo_personal_aula IN ('coordinadora','profesora')`). Sin paso de visto bueno separado.
- **Q6 — Sin cierre temporal.** Los informes **no** siguen la regla "día cerrado" de ADR-0016 (no son hechos diarios): se pueden corregir informes de trimestres/cursos pasados. No hay helper de ventana de edición.
- **Q7 — Lectura de la familia.** Se **reutiliza** el permiso existente `puede_ver_datos_pedagogicos` (de F2.6 en `vinculos_familiares`). Tutor legal ve siempre (helper `es_tutor_legal_de`, que excluye `autorizado`); el `autorizado` ve solo si tiene el permiso (`tiene_permiso_sobre`). **No se crea permiso nuevo.** La familia solo ve **publicados**, nunca borradores.
- **Q8 — `notificado_at`.** Columna que sella la **primera** publicación notificada. El aviso in-app (ADR-0025) y el sellado los hace el server action en F9-2; si `notificado_at` ya está puesto, las republicaciones **no** re-avisan. F9-0 solo aporta la columna.
- **Q9 — Regla de publicación.** "Todos los ítems valorados para publicar" se enforza en el **server action (F9-2)**, no a nivel BD: un borrador puede estar incompleto. Aquí solo queda anotado.
- **Q10 — Contenido en castellano**, un idioma (la interfaz sigue es/en/va).
- **Q11 — PDF server-side** (F9-2; no afecta a la capa de datos).

### Modelo RLS y gotcha MVCC

`usuario_es_audiencia_informe_row(centro_id, nino_id, estado)` es **row-aware**: recibe los campos del row por parámetro y **no re-lee `informes_evolucion`**, así que el gotcha MVCC en `INSERT…RETURNING` (documentado en F5/`rls-policies.md`, reincidente en F8) no aplica — sus lookups internos van a **otras** tablas (`roles_usuario`, `matriculas`, `profes_aulas`, `vinculos_familiares`). Test explícito de `.insert().select()` por la coordinadora lo bloquea como regresión.

- `plantillas_informe`: SELECT staff del centro (`es_admin OR es_profe_en_centro`) — la familia **no** accede; INSERT/UPDATE solo `es_admin`; DELETE default DENY (se archiva con `estado='archivada'`). Nota: **no** se usa `pertenece_a_centro` en la SELECT porque incluiría a los tutores (tienen fila en `roles_usuario`).
- `informes_evolucion`: SELECT audiencia row-aware; INSERT/UPDATE `es_admin OR es_redactor_de_nino`; DELETE default DENY.

### Auditoría

`audit_trigger_function` gana 2 ramas (`plantillas_informe`, `informes_evolucion`), ambas `centro_id` directo. **Ambas se auditan**. Sin Realtime (el contenido no es de baja latencia).

## Consecuencias

### Positivas

- Modelo mínimo (2 tablas) coherente con el data-model; snapshot barato; sin JOINs para renderizar un informe.
- Reutiliza permisos y helpers existentes (`puede_ver_datos_pedagogicos`, `es_profe_de_nino`, `es_profe_en_centro`, `tiene_permiso_sobre`, `centro_de_nino`, `set_updated_at`); solo 3 helpers nuevos.
- RLS a prueba del gotcha MVCC por diseño (helper row-aware) — verificado por test.

### Negativas

- La integridad de la forma del jsonb (estructura/respuestas) **no** está a nivel BD: depende de la validación Zod del server action (F9-2). Riesgo aceptado.
- Sin análisis por ítem en SQL plano (no necesario en F9; requeriría proyección futura).
- Deuda menor: la regla de publicación (Q9) vive solo en el server action, no en una constraint.

### Neutras

- Naming: las columnas de actor/estado siguen la convención **española** del esquema existente (`creado_por`, `publicado_at`, `archivada_at/por`), no los nombres en inglés del borrador de la instrucción (`created_by`, `published_at`).
- 4 ENUMs nuevos en la lista de `data-model.md`: `periodo_informe`, `estado_informe`, `valoracion_item_informe`, `estado_plantilla_informe`. El valor del período es `fin_curso` (no `fin_de_curso`).

## Plan de implementación

- [x] Migración `20260609130000_phase9_0_informes_evolucion.sql` (ENUMs + 2 tablas + helpers + RLS + audit + triggers).
- [x] Tipos en `src/types/database.ts` (hand-add, como F8-0; regen con `npm run db:types` tras aplicar al remoto).
- [x] Tests RLS gateados por `F9_0_MIGRATION_APPLIED=1` (`src/test/rls/informes-evolucion.rls.test.ts`).
- [x] Actualizar `data-model.md` y `rls-policies.md` (sección F9).
- [ ] **Aplicar la migración manualmente** (SQL Editor; CLI con bug SIGILL) + registrar en `supabase_migrations.schema_migrations` + `npm run db:types`. — Lo hace el responsable.
- [ ] F9-1/F9-2: UI + server actions (regla de publicación Q9, aviso ADR-0025 + sellado `notificado_at`, PDF server-side).

## Verificación

- `npm run typecheck`, `npm run lint`, `npm run build`, `npm test` en verde con el flag **apagado** (tests F9-0 omitidos).
- Tras aplicar la migración: `F9_0_MIGRATION_APPLIED=1 npm run test:rls -- informes-evolucion.rls` en verde (autoría por tipo de personal, audiencia familia publicados-only, aislamiento aula/centro, DELETE bloqueado, MVCC `.insert().select()`).

## Notas

El acuse de recibo de la familia (confirmación de lectura trazable) **no** entra en F9: si se quiere, se construiría reusando el mecanismo de firma de F8 (ADR-0041 §F9–F11) en una fase posterior.

## Referencias

- Spec: `docs/specs/informes-evolucion.md` (resoluciones Q1–Q11).
- ADRs relacionados: ADR-0012 (agenda 5 tablas — matiz analítico), ADR-0032 (`tipo_personal_aula`), ADR-0025 (push transversal), ADR-0016 (día cerrado — NO aplica a F9), ADR-0007/0002 (RLS recursión / helpers en `public`).
- Modelo de datos: `docs/architecture/data-model.md`; RLS: `docs/architecture/rls-policies.md` (gotcha MVCC / row-aware F5/F8).
- Migración: `supabase/migrations/20260609130000_phase9_0_informes_evolucion.sql`.
