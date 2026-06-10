# ADR-0044: Modelo de campaña de informes (capa de coordinación sobre F9)

## Estado

`accepted`

**Fecha:** 2026-06-10
**Autores:** responsable + claude-code
**Fase del proyecto:** Fase 9-5 — Campaña de informes (F9-5-0: capa de datos)

## Contexto

F9 (informes de evolución) ya cubre el ciclo completo por niño: crear → rellenar → publicar (F9-2), vista familia + aviso (F9-3) y PDF (F9-4). Falta la **gestión de plazos a nivel de centro**: que la dirección fije una fecha límite por período, que las profes vean en su INICIO **cuántos informes les faltan**, que la dirección tenga una **foto del avance**, y que la profe pueda **publicar en lote** los informes completos de su aula. La necesidad estaba anotada en `docs/roadmap.md` (§F9-5) y se especificó en `docs/specs/campana-informes.md` (approved).

Restricción de diseño impuesta por el responsable y reflejada en la spec: **la campaña es una CAPA de coordinación, NO una puerta.** No debe bloquear ni habilitar el flujo individual de informes; este sigue funcionando exactamente igual exista o no una campaña abierta.

Esta ADR cubre **F9-5-0** (capa de datos: tabla + ENUM + RLS + audit). La UI (abrir/cerrar, seguimiento, aviso en INICIO, publicar en lote) llega en sub-fases siguientes y reusa esta base.

## Opciones consideradas

### Opción A: Tabla `campanas_informe` + pendientes derivados, vínculo lógico (elegida)

Una tabla mínima que guarda el **plazo** (centro, curso, período, fecha límite, estado). Los **pendientes** no se materializan: se **derivan** en consulta (niños con matrícula activa sin informe publicado de la terna), reusando el patrón de los avisos de INICIO de #64 (feed derivado, sin tabla de avisos). El vínculo informe↔campaña es **lógico** por (centro, curso, período); `informes_evolucion` **no** se toca.

**Pros:**

- **Capa no-puerta** literal: `informes_evolucion` no cambia ni gana dependencias; el flujo F9 es independiente.
- Sin duplicar estado: "completado = publicado" se evalúa siempre contra la verdad (`informes_evolucion.estado`), no contra una copia que se desincronice.
- Reusa infraestructura existente (#64 avisos derivados; `publicarInforme` de F9-2 para el lote).
- Migración aditiva mínima (1 tabla + 1 ENUM), bajo riesgo.

**Contras:**

- La derivación de pendientes es una query por carga (mitigable con índices; volumen pequeño: niños de un centro).
- Sin FK, no hay traza "este informe se publicó en el marco de la campaña X" (aceptable; se puede añadir después).

### Opción B: FK `campana_id` en `informes_evolucion` + estado por informe

Cada informe apunta a su campaña; el "pendiente" se materializa o se consulta por FK.

**Pros:**

- Trazabilidad fuerte informe→campaña; queries de seguimiento triviales por join.

**Contras:**

- **Convierte la campaña en parte del modelo del informe** → roza la línea "capa no-puerta": habría que decidir qué pasa con informes sin campaña, retro-rellenar la FK, etc.
- Acopla F9 (ya cerrado y en producción) a una feature opcional. Migración sobre una tabla con datos.
- Rechazada por el responsable (Q6): vínculo lógico es suficiente para el seguimiento.

### Opción C: No hacer nada (statu quo)

Las profes se coordinan por fuera (mensajería, verbal); la dirección no tiene foto del avance.

**Contras:** no cubre la necesidad; la coordinación de boletines es justo el hueco que F9-5 viene a llenar.

## Decisión

**Opción A.** Tabla `campanas_informe` (centro_id, curso_academico_id, periodo `periodo_informe`, fecha_limite date, estado `estado_campana_informe`, created_by, timestamps), **UNIQUE (centro_id, curso_academico_id, periodo)**. ENUM nuevo `estado_campana_informe` (`abierta`/`cerrada`). Sin tocar `informes_evolucion` (vínculo lógico, Q6). Pendientes derivados (sin tabla de avisos). Migración `20260610140000_phase9_5_0_campanas_informe.sql` (aditiva; se aplica a mano por SQL Editor — CLI SIGILL).

Decisiones de modelo cerradas en la spec (resumen):

- **Q1** — Varias campañas abiertas a la vez **permitidas** (períodos distintos). El UNIQUE evita **duplicar la misma terna**, no "una abierta por centro".
- **Q4** — `estado` `abierta⇄cerrada` **reversible** (reabrir); `fecha_limite` editable mientras abierta. **Sin `deleted_at`**; DELETE bloqueado (default DENY) — cerrar sustituye al borrado.
- **Q6** — Vínculo **lógico** por (centro, curso, período); sin FK `campana_id`.
- **Q7** — Solo el **curso activo** (lo resuelve el server al abrir; la BD solo persiste el `curso_academico_id`).
- **Q2/Q3/Q5/Q8/Q9** — "completado = publicado", pendientes = matrícula activa, lote solo-publica, y la lógica de publicación viven en la **app** (capas siguientes), no en esta migración.

**RLS (patrón F8/F9):**

- **SELECT**: `es_admin(centro_id) OR es_profe_en_centro(centro_id)` — staff del centro (las profes necesitan ver la campaña y su fecha). La familia **no** accede.
- **INSERT / UPDATE**: solo `es_admin(centro_id)` (abrir, cerrar, reabrir, editar fecha); INSERT exige `created_by = auth.uid()`.
- **DELETE**: sin policy → default DENY.
- **Gotcha MVCC**: no aplica. `campanas_informe_select` usa `es_admin`/`es_profe_en_centro`, que leen `roles_usuario`/`profes_aulas` (otras tablas), **nunca** `campanas_informe`. No hace falta helper row-aware nuevo (a diferencia de `informes_evolucion`, cuyo audiencia depende de columnas del propio row). Test `.insert().select()` por el admin como bloqueo de regresión.

**Audit:** `campanas_informe` se audita (rama nueva en `audit_trigger_function`, `centro_id` directo) — es registro administrativo de plazos. Sin Realtime.

## Consecuencias

- **Positivas:** F9 intacto (capa no-puerta real); base mínima y de bajo riesgo; el seguimiento y el aviso de pendientes se construyen encima sin más migraciones de modelo; "completado" siempre coherente con la verdad de `informes_evolucion`.
- **Negativas / límites:** sin traza informe→campaña por FK (si se necesita, `campana_id` nullable se añade después sin migración compleja); la derivación de pendientes es una query por carga (volumen pequeño, indexada).
- **Siguiente:** F9-5-1+ (UI dirección abrir/cerrar + seguimiento; aviso derivado en INICIO de la profe; publicar en lote por aula reusando `publicarInforme`).

## Addendum F9-5-3 — Publicar en lote (best-effort)

La capa de UI se completa con el **"Publicar todos"**. Decisiones:

- **Reusa `publicarInforme` de F9-2**, no reimplementa la publicación: el lote lee los informes en **borrador** de la terna (curso, período) de las aulas objetivo e itera la acción individual por cada uno. Así hereda la validación de completitud (Q9: todos los ítems valorados) y el **sellado de `notificado_at`** (avisar a la familia una sola vez, Q8). El sello se extrae a `sellarNotificado(previo, ahora) = previo ?? ahora` (puro, testeado) y se comparte entre la acción individual y el lote.
- **Best-effort (Q5/Q8):** publica los **completos** e informa de cuántos quedaron **sin publicar por incompletos** (resumen `{ total, publicados, incompletos }`); los incompletos se quedan en borrador. **No crea ni rellena** nada (los "sin empezar" no existen como fila y no se tocan).
- **Quién (Q2):** la **profe** para su aula (botón en su lista de informes, por campaña abierta) y la **dirección** para un aula o **todo el centro** (botones en el seguimiento). La autorización es la RLS existente `informes_evolucion_update` (redactora de su aula o admin del centro; técnico/apoyo no) — el lote **no añade policy ni migración**.
- **Color de pendientes:** `fondoInforme` pasa a **verde = publicado / ámbar = pendiente** (borrador o sin empezar), helper único reutilizado en las listas.

## Referencias

- Spec: `docs/specs/campana-informes.md` (approved; decisiones Q1–Q9).
- ADR-0042 — Modelo de informes de evolución (F9).
- ADR-0037 / PR #64 — avisos de INICIO derivados + marcador en `preferencias_usuario`.
- ADR-0025 — canal de aviso a la familia en la publicación (lo dispara cada publicación del lote).
