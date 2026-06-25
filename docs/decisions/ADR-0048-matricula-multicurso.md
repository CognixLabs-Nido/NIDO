# ADR-0048: Matrícula multi-curso — aula física + `aulas_curso` + helpers cualificados por curso

## Estado

`accepted`

**Fecha:** 2026-06-25
**Autores:** responsable + claude-code
**Fase del proyecto:** Fase 11 — Pulido final (subfase F11-H)

## Contexto

Hasta F11-H el modelo acoplaba **aula** y **curso académico** en una sola fila: `aulas` llevaba `curso_academico_id`, `cohorte_anos_nacimiento` y `capacidad_maxima`, y `matriculas`/`profes_aulas` referenciaban el aula directamente. Consecuencias:

- Un mismo espacio físico ("Aula Roja") era **filas distintas** en cada curso → duplicación de identidad del aula, imposible seguir "la misma sala" entre años.
- La operación de **fin de curso** ("pasar de curso": configurar el año siguiente, reasignar niños por edad, dar continuidad al personal) no tenía dónde apoyarse: no existía una configuración del aula **por curso** ni un estado de matrícula planificado.
- No había **lista de espera** (admisiones) como antesala del alta.

El piloto (ANAIA) necesita gestionar el ciclo anual completo de un centro 0-3: salas físicas estables, configuración (tramo de edad + capacidad) que cambia cada curso, matrícula y personal **por curso**, rollover de fin de año y cola de admisiones. Había que decidir el modelo de datos antes de construir la capa de aplicación y la UI.

## Opciones consideradas

### Opción A: mantener el statu quo (aula = aula+curso acoplados)

Seguir creando un aula nueva por curso.

**Pros:**

- Cero migración; el código existente no se toca.

**Contras:**

- La identidad física del aula se pierde entre cursos (no hay "la misma Aula Roja en 25/26 y 26/27").
- El rollover y la lista de espera no tienen modelo donde aterrizar → bloquean el cierre del ciclo anual.
- `capacidad`/`tramo_edad` viven en el aula → no se pueden variar por curso sin duplicar la sala.

### Opción B: aula física + tabla de configuración por curso (`aulas_curso`)

Separar `aulas` (sala física: `id`, `nombre`, `centro_id`) de `aulas_curso` (configuración del aula en un curso: `tramo_edad`, `capacidad`), y mover la **cualificación por curso** a `matriculas` y `profes_aulas` (ambas con `curso_academico_id`), con FK **compuesta** `matriculas (aula_id, curso) → aulas_curso (aula_id, curso)`.

**Pros:**

- La sala física es estable y reusable entre cursos.
- La configuración (edad/capacidad) varía por curso sin duplicar la sala.
- La FK compuesta garantiza que no se matricula en un aula que no existe ese curso (valida aula y curso de una vez).
- Da soporte natural a "pasar de curso" (configurar `aulas_curso` del siguiente + matrículas `pendiente` en el curso planificado) y a la lista de espera.

**Contras:**

- Migración estructural con `DROP+CREATE` de `matriculas`/`profes_aulas` y `ALTER` de `aulas` → reescritura de helpers RLS y de toda la capa de aplicación.
- Más joins (aula↔aulas_curso) en queries operativas.

### Opción C: `aulas_curso` pero sin cualificar los helpers por curso

Igual que B, pero dejando `es_profe_de_aula`/`es_profe_de_nino` sin filtrar por curso activo.

**Pros:**

- Menos cambios en los helpers RLS.

**Contras:**

- Un profe asignado a una sala en un curso vería a los niños de esa sala en **cualquier** curso → fuga de aislamiento temporal (el profe del año pasado vería al niño del año en curso).
- El curso planificado (admisiones) sería visible para staff → rompe la invisibilidad del rollout antes de confirmar.

## Decisión

**Se elige la Opción B**, con los helpers de personal **cualificados por curso activo** (lo que C descartaba).

`aulas` pasa a ser **sala física** (`ALTER`, no `DROP`: conserva su id e historial). La configuración por curso vive en **`aulas_curso (aula_id, curso_academico_id, tramo_edad, capacidad)`** con `UNIQUE(aula_id, curso)` — destino de la FK compuesta de `matriculas`. `matriculas` y `profes_aulas` se recrean con `curso_academico_id`. Los helpers `es_profe_de_aula`/`es_redactor_de_aula` se anclan a `curso_activo_de_centro(...)`, y `es_profe_de_nino`/`es_redactor_de_nino` hacen **JOIN curso-exacto** (`pa.curso = m.curso`) sobre matrícula `estado='activa'`. Así un profe solo "ve" a través del curso operativo activo; el curso planificado del módulo de admisiones es **invisible para staff** (la matrícula planificada no es `activa` y `matriculas_profe_select` exige `curso = curso_activo`).

Para el **rollover** ("pasar de curso") la propuesta de matrículas por edad agrupa, cuando hay **varias salas candidatas para el mismo tramo**, **por aula de origen** (round-robin determinista sobre las candidatas ordenadas): los niños que estaban juntos siguen juntos; la directora reasigna a mano lo que no encaje. La **capacidad es informativa**: el aforo se **avisa, no se bloquea** (decisión del responsable). La **lista de espera** (`lista_espera`) es admin-only (datos de admisiones previos a crear el niño); "invitar al alta" crea el esqueleto de niño y dispara la invitación reusando la infra D6.

## Consecuencias

### Positivas

- Sala física estable y reusable; configuración (edad/capacidad) por curso.
- Soporte completo del ciclo anual: admisiones (lista de espera) → alta → operación → fin de curso (rollover) → activación del curso siguiente.
- Aislamiento temporal correcto: el profe del curso pasado no ve a los niños del curso activo; el curso planificado es invisible para staff hasta confirmar.
- La FK compuesta cierra de un golpe la validez de (aula, curso) en cada matrícula.

### Negativas

- Migración estructural grande (recreación de 2 tablas + reescritura de helpers + capa de aplicación completa en H-1).
- `matriculas` ya **no** puede anidarse a `aulas` por PostgREST (la FK es compuesta a `aulas_curso`): el nombre del aula se resuelve por id (`getAulaNombresPorIds`).
- `es_profe_principal` queda **deprecated** en el recreate (drop en PR posterior, ya en follow-ups).
- La invisibilidad del curso planificado es para **staff** y para el acceso **operativo** (gating por `estado='activa'`); `matriculas_tutor_select` (= `es_tutor_de`) **no** filtra por curso → la familia ve la fila de matrícula planificada de su hijo (benigno: no abre datos operativos).

### Neutras

- Más joins aula↔aulas_curso en queries operativas (coste despreciable a la escala del piloto).
- Nuevo flag de CI `F11_H0_MIGRATION_APPLIED` para los gated-tests del modelo.

## Plan de implementación

- [x] **H-0** — migración `20260624130000_phase11h_0_matricula_multicurso_fundacion.sql`: `aulas` física, `aulas_curso`, `matriculas` (FK compuesta + `UNIQUE(nino,curso)` activo), `profes_aulas` por curso, `lista_espera`, helpers cualificados, `curso_activo_de_centro`/`centro_de_curso`.
- [x] **H-1** — capa de aplicación migrada al modelo aula/aulas_curso (queries, actions, asignación de personal por curso).
- [x] **H-2** — "pasar de curso": backend + tabla de revisión (agrupación por aula de origen; aforo avisa, no bloquea; confirmar = flip `pendiente→activa` + activar curso).
- [x] **H-3** — UI de admisiones (lista de espera) con drag-and-drop, "invitar al alta" (reusa D6).
- [x] **H-4** — consolidación: tests RLS/gated del modelo (`multicurso.rls.test.ts`, gate `F11_H0_MIGRATION_APPLIED`), este ADR, `progress.md`, `follow-ups.md`.

## Verificación

- `src/test/rls/multicurso.rls.test.ts` (gate `F11_H0_MIGRATION_APPLIED=1`) — 18 casos verdes contra el remoto: aulas_curso (admin escribe / staff+familia leen / aislamiento entre centros), profes_aulas cualificado (profe del curso pasado no ve al niño del activo), matriculas (FK compuesta 23503, UNIQUE 23505, políticas admin/profe/tutor), lista_espera (admin-only + aislamiento), aforo (no bloquea), doble matrícula (planificada invisible para staff), rollover end-to-end (un único curso activo por centro; pendiente→activa; cierre/activación).
- Tests unitarios del núcleo puro de propuesta (`proponer.test.ts`) y del schema de lista de espera.

## Notas

La capacidad es **informativa** por decisión explícita del responsable: a más edad, más ratio permitida; el riesgo de overflow real es bajo, así que se avisa sin bloquear (coherente con el patrón "avisar, no impedir" de H-0).

## Referencias

- Migración: `supabase/migrations/20260624130000_phase11h_0_matricula_multicurso_fundacion.sql`
- ADRs relacionados: ADR-0005 (matrículas históricas), ADR-0007 (recursión RLS), ADR-0032 (corte de autoría coordinadora/profesora)
- Progress: `docs/journey/progress.md` (Fase 11-H)
