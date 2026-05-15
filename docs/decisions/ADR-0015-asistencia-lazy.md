# ADR-0015: Asistencia lazy (sin pre-creación de filas)

## Estado

`accepted`

**Fecha:** 2026-05-15
**Autores:** jovimib + claude-code
**Fase del proyecto:** Fase 4 — Asistencia y ausencias

## Contexto

La tabla `asistencias` registra el estado de cada niño en cada día lectivo. La pregunta de diseño es: ¿cuándo se crean las filas?

Dos modelos en juego:

1. **Eager / pre-creación**: al amanecer (o al matricular un niño) un job/trigger crea una fila por (niño, día) con `estado = NULL` o `pendiente`. La profe siempre encuentra todas las filas existentes y solo las edita.
2. **Lazy / sin pre-creación**: las filas nacen cuando la profe (o un trigger del primer evento) las inserta por primera vez. Mientras tanto, "ausencia de registro" = "sin marcar".

La fricción del modelo lazy es que la query del pase de lista no es un simple `SELECT * FROM asistencias` — necesita un `LEFT JOIN` con la matrícula del aula. La ventaja es que **no hay nunca filas con `estado NULL`**: cualquier fila implica que alguien la registró.

Restricciones del proyecto que afectan la decisión:

- F4 introduce un componente reutilizable (`<PaseDeListaTable />`, ADR-0014) cuya API permite `initial: TValue | null` por fila. El componente está diseñado para tolerar filas sin pre-cargar.
- F3 ya estableció el patrón "ventana de edición = mismo día Madrid" (ADR-0013). Crear filas a las 00:00 para un día que todavía no ha empezado a editarse abre una zona temporal ambigua (¿qué `registrada_por` ponemos?).
- La ausencia (`ausencias`) puede pre-rellenar el pase de lista por auto-link sin necesidad de crear filas en `asistencias`: la query LEFT JOIN ya devuelve la ausencia activa y el cliente pinta `estado='ausente'` como valor inicial.
- Cumplimiento RGPD: si la profe no marca asistencia ese día (festivo no laborable, error operativo), preferimos que no exista fila a tener filas "fantasma" con `estado NULL` que parecen olvidos.

## Opciones consideradas

### Opción A: Eager — trigger nocturno crea filas pendientes

Un cron job de Supabase crea, cada noche a las 00:00 Madrid, una fila `(nino_id, fecha, estado='pendiente')` por cada niño con matrícula activa.

**Pros:**

- La query del pase de lista es `SELECT * FROM asistencias WHERE fecha=... AND aula_id...`. Cero JOINs.
- La profe ve "10/15 marcados" fácilmente desde el count.
- Histórico explícito: si no hay fila, es porque ese niño no estaba matriculado.

**Contras:**

- Job nocturno = más superficie operativa. Si falla, la profe abre y ve un aula vacía sin asistencia disponible.
- Filas `estado='pendiente'` no son hechos auditables: ¿quién las creó? ¿`registrada_por = system_user`? Eso ensucia el audit log.
- Festivos / no lectivos generan ruido (filas pendientes que nadie va a tocar).
- La ENUM `estado_asistencia` necesita un valor extra (`pendiente`) que solo existe por razones de pre-creación. Filtra-explica en toda query.

### Opción B: Eager — al cargar el pase de lista (server-side)

La query del pase de lista, si detecta que no hay fila para `(niño, fecha)`, hace INSERT inmediato.

**Pros:**

- No hay cron job: la creación es bajo demanda.
- La query "siguiente" tiene filas para todos los niños.

**Contras:**

- Un GET tiene efectos secundarios. Cualquier admin que abra el resumen "Asistencia hoy" del centro crea filas en aulas que no son suyas.
- `registrada_por` queda confuso: si abre admin, ¿es la admin la que las "creó"?
- Audit log se llena de INSERTs sin acción real del usuario.

### Opción C: Lazy — filas solo cuando la profe (o trigger ausencia) las crea

`asistencias` solo se inserta vía `upsertAsistencia` o `batchUpsertAsistencias`. El pase de lista hace `LEFT JOIN`: si no hay fila, `asistencia = null` y el componente lo trata como "pendiente". Si hay ausencia activa para la fecha, se pre-rellena `estado='ausente'` en cliente como sugerencia (auto-link, no INSERT).

**Pros:**

- Sin cron. Sin INSERTs con efectos secundarios. Sin valor extra en la ENUM.
- Filas existentes = hechos reales con `registrada_por` auditable.
- Festivos / no lectivos no generan ruido en BD.
- El componente `<PaseDeListaTable />` ya soporta `initial: null` ⇒ encaja directamente.

**Contras:**

- Query del pase de lista no es trivial — combina matrícula activa + LEFT JOIN asistencias + LEFT JOIN ausencia activa. Pero queda encapsulada en `getPaseDeListaAula(aulaId, fecha)`.
- Count "presentes/ausentes" se calcula en runtime (no es solo `COUNT(*)`).
- Si quisiéramos exportar "estado de presencia diario del centro" históricamente, hay que reconstruirlo cruzando con matrículas. La query del admin `getResumenAsistenciaCentro` ya lo hace.

## Decisión

**Se elige la Opción C** porque encaja con el resto del modelo y elimina superficie operativa innecesaria:

- F3 ya usa lazy en `agendas_diarias` (la fila padre se crea al primer evento) — coherencia con ADR-0012.
- ENUM `estado_asistencia` puede ser cerrado y exhaustivo (`presente`/`ausente`/`llegada_tarde`/`salida_temprana`) sin un placeholder.
- El componente F4 ya está preparado para fila sin registro previo.
- Auto-link familia→profe no necesita pre-creación: el cliente sintetiza `initial='ausente'` desde la ausencia activa.

## Consecuencias

### Positivas

- Sin job nocturno, sin INSERTs con side effects.
- ENUM más limpio (4 valores reales, ninguno "técnico").
- Audit log refleja acciones humanas, no creaciones automáticas.
- Festivos no generan ruido.

### Negativas

- `getPaseDeListaAula(aulaId, fecha)` hace 4 queries (matrículas, asistencias, ausencias, info_medica). Para aulas pequeñas (≤20 niños) es despreciable.
- No hay un único `SELECT` que conteste "cuántos niños están marcados hoy". El admin `getResumenAsistenciaCentro` recolecta y agrega en aplicación.

### Neutras

- Convención: "ausencia de fila en `asistencias`" = "sin marcar". Documentado en la docstring de `getPaseDeListaAula` y en la spec.

## La regla de "día cerrado" aplica también a asistencia

Como extensión transversal de ADR-0013 (mismo día Madrid para edición), las RLS de `asistencias` exigen `dentro_de_ventana_edicion(fecha) = TRUE` en INSERT/UPDATE — incluido admin. A las 00:00 hora Madrid del día siguiente, **nadie** (ni admin) puede crear ni editar asistencias del día anterior desde la app. Correcciones de histórico solo vía SQL con `service_role`, lo cual queda en `audit_log`. Esta extensión queda documentada en ADR-0016 (día cerrado transversal). El motivo: si la asistencia se pudiera reescribir en histórico desde admin, perdería su valor como hecho auditable para inspecciones y disputas.

## Plan de implementación

- [x] Migración `phase4_attendance.sql`: `asistencias` SIN trigger de pre-creación.
- [x] RLS INSERT/UPDATE exigen `dentro_de_ventana_edicion(fecha)` (incluido admin).
- [x] `getPaseDeListaAula(aulaId, fecha)` con LEFT JOIN lógico.
- [x] `getResumenAsistenciaCentro(fecha)` para el admin.
- [x] Auto-link ausencia→asistencia en cliente: `initial='ausente'` si hay ausencia activa y no hay asistencia previa.
- [x] Tests RLS verifican que no aparecen filas "fantasma" `estado=NULL`.

## Verificación

- Tests RLS pasan: ningún rol puede leer filas con `estado=NULL` (porque no existen).
- E2E: `/teacher/aula/[id]/asistencia` con un aula recién creada renderiza todos los niños con badge "Sin marcar".
- Audit log: solo entradas de INSERTs/UPDATEs hechos por humanos. Cero entradas "system".

## Referencias

- Specs: `/docs/specs/attendance.md`
- ADRs relacionados: ADR-0011 (timezone Madrid), ADR-0012 (5 tablas en F3), ADR-0013 (mismo día), ADR-0014 (pase de lista reutilizable), ADR-0016 (día cerrado transversal).
