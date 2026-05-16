# ADR-0018: Lazy materialization de comidas desde plantilla

## Estado

`accepted`

**Fecha:** 2026-05-16
**Autores:** jovimib + claude-code
**Fase del proyecto:** Fase 4.5 — Menús + pase de lista comida batch

## Contexto

Fase 4.5 introduce `plantillas_menu` (lo que el centro cocina cada día de semana). Fase 3 ya tiene la tabla `comidas` (hechos: qué comió cada niño en cada momento). La relación entre ambas necesita una decisión:

¿La plantilla materializa filas en `comidas`? Es decir, ¿al publicar una plantilla se crean filas pre-llenas para cada (niño, fecha futura, momento) que la profe luego solo "rellena con cantidad"?

Restricciones del proyecto:

- F3 estableció el patrón **lazy** para `agendas_diarias`: la cabecera se crea al primer evento, no por adelantado (ADR-0012 + ADR-0015 generalizan el principio "filas = hechos humanos").
- `comidas` es una tabla de hechos auditable: cada fila refleja qué pasó realmente con ese niño ese día.
- La plantilla puede cambiar (admin publica una nueva, archiva la previa). Si las filas estuvieran materializadas, habría que decidir cómo se sincronizan.
- F4.5 reusa el `<PaseDeListaTable />` de F4. Ese componente tolera `initial: null` por fila (no necesita filas preexistentes).
- ADR-0015 ya definió que `asistencias` es lazy. Mantener el mismo principio en comidas mantiene coherencia mental.

## Opciones consideradas

### Opción A: Materialización al publicar (eager)

Al publicar una plantilla, un job/trigger crea filas en `comidas` para cada (niño_matriculado, día_calendario_de_la_vigencia, momento) con `cantidad=NULL` (o un valor "sin marcar"). La profe luego "rellena" filas existentes.

**Pros:**

- Query del pase de lista es un simple `SELECT * FROM comidas WHERE agenda_id=... AND momento=...`.
- Count "X/N marcados" es trivial.

**Contras:**

- Para 12 niños × 4 momentos × 20 días = **960 filas materializadas** por mes y aula. Por centro con 6 aulas, ~5.700/mes solo en `comidas`. Tabla se infla 10× por filas que nadie ha tocado.
- `cantidad NOT NULL` actual obliga a añadir un valor placeholder ('pendiente') al ENUM — contaminación del modelo.
- Cuando admin archiva la plantilla, ¿qué pasa con las filas pre-creadas que aún no se han usado? Borrarlas requiere DELETE masivo (RLS bloquea DELETE a profe, hay que recurrir a service_role).
- Festivos / días no lectivos generan filas fantasma.
- `audit_log` se llena de INSERTs sin acción humana (`auth.uid()` no aplicable).
- Si la matrícula cambia (niño se va, llega otro), hay que sincronizar las filas pre-creadas.

### Opción B: Materialización al cargar el pase de lista

Cada vez que un profe abre `/teacher/aula/[id]/comida`, el server inserta filas faltantes para los niños del aula. La profe ve filas existentes y solo cambia la cantidad.

**Pros:**

- Sin job nocturno.

**Contras:**

- Un GET tiene efectos secundarios graves. Cualquier admin que abra el resumen también materializa.
- `registrada_por`/`creada_por` queda confuso: ¿qué identidad escribió la fila si nadie pulsó "guardar"?
- Si la profe abre y cierra sin tocar nada, queda contaminación.
- Una fila con `cantidad=NULL` (o placeholder) es indistinguible de "el niño no comió" — semánticamente ambiguo.

### Opción C: Lazy — fila solo cuando la profe marca cantidad (elegida)

`comidas` NO se materializa desde la plantilla. La plantilla es **referencia de lectura**.

Al pasar lista batch:

- El cliente pre-rellena la columna "Descripción" en cada fila con `menu_del_dia(centro, fecha)[momento]`.
- La profe marca cantidad y submitea.
- Server hace UPSERT (`SELECT` + `INSERT/UPDATE`) en `comidas`. La descripción copiada queda **embebida** en `comidas.descripcion` (puede ser el menú estándar o un override manual).

**Pros:**

- `comidas` sigue siendo tabla de hechos humanos: cada fila = acción real.
- Tabla pequeña: solo lo que efectivamente se ha registrado.
- Cambios de plantilla no afectan filas pasadas (la descripción ya está copiada).
- Niños con `lactancia_estado IN ('materna','biberon')` se excluyen del pase de lista — no se materializan filas para ellos.
- Festivos / días sin clase no generan ruido.
- `audit_log` solo refleja acciones humanas.

**Contras:**

- Query del pase de lista es más compleja: matrículas + LEFT JOIN comidas + RPC `menu_del_dia`. ~5 queries en paralelo (asumible para aulas pequeñas).
- La descripción del menú está duplicada en cada `comidas` que la copia. Si admin corrige un typo en la plantilla, las filas ya creadas conservan el typo (cosmético; lo importante es el dato histórico, no el menú).

## Decisión

**Se elige la Opción C (lazy)** porque:

- Mantiene coherencia con ADR-0012 (agendas_diarias lazy) y ADR-0015 (asistencias lazy). El principio "filas en BD = hechos humanos" se aplica transversalmente.
- Mantiene `comidas` limpia de placeholders y filas fantasma.
- Permite que la plantilla cambie (publicar/archivar) sin requerir sincronización.
- Aprovecha la genericidad de `<PaseDeListaTable />` que ya tolera `initial: null`.

La descripción se **copia** (no se referencia por FK) al rellenar la fila para mantener `comidas` autocontenida e inmutable a cambios posteriores de la plantilla.

## Consecuencias

### Positivas

- `comidas` mantiene su rol de tabla de hechos auditable (consistencia con F3).
- Sin job nocturno ni efectos secundarios en GET.
- ENUM `cantidad_comida` sigue siendo cerrado, sin 'pendiente'.
- Niños lactantes exclusivos no contaminan la tabla.
- `audit_log` solo INSERTs/UPDATEs humanos.

### Negativas

- `getPaseDeListaComida` hace ~5 queries en paralelo (asumible).
- Si admin corrige un typo en la plantilla, las filas ya creadas en `comidas` conservan el texto antiguo. Cosmético: el dato histórico ya está cerrado por ventana, y los días futuros (cuando aún no se ha pasado lista) ya tomarán el texto corregido.
- La query del pase de lista necesita conocer el centro_id del aula (para llamar a `menu_del_dia(centro, fecha)`). Se deriva del primer niño matriculado — coste despreciable.

### Neutras

- Override por niño: si la profe edita "Descripción" de un niño (porque trae tupper), ese override queda en su fila de `comidas`. La plantilla y las filas de los demás niños no se afectan. La familia ve siempre el menú estándar (decisión Checkpoint A, no el override).

## Plan de implementación

- [x] `comidas` sigue sin modificarse (Fase 3 ya la creó).
- [x] `batchRegistrarComidas`: por fila SELECT existente + UPDATE / INSERT. No upsert directo porque `comidas` no tiene UNIQUE (agenda_id, momento) — F3 permite múltiples filas por momento intencionadamente.
- [x] `asegurarAgenda(nino_id, fecha)` de F3 crea la cabecera lazy si no existe.
- [x] Cliente `PaseDeListaComidaCliente`: pre-rellena `descripcion` con `menu_del_dia[momento]` cuando la fila no tiene `comida` previa.
- [x] Familia ve `menu.descripcion` (no `comidas.descripcion` por niño).

## Verificación

- `comidas` queda igual de pequeña que antes de F4.5 si nadie pasa lista batch.
- Cambiar la plantilla publicada NO modifica filas pasadas en `comidas`.
- Test E2E (`E2E_REAL_SESSIONS=1`): profe pasa lista batch, ve filas insertadas; cambiar plantilla luego no toca las filas existentes.

## Referencias

- Spec: `docs/specs/menus.md` (B39, B40, B41, casos edge).
- ADRs relacionados: ADR-0012 (cinco tablas en agenda), ADR-0015 (asistencia lazy), ADR-0017 (plantilla por día de semana).
- Migración: `supabase/migrations/20260516000000_phase4_5_menus.sql`.
