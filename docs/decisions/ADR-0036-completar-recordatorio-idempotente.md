# ADR-0036: Completar recordatorio — idempotencia y race safety vía `WHERE completado_en IS NULL`

## Estado

`accepted` — vigente también bajo el modelo granular de [ADR-0037](ADR-0037-modelo-granular-destinatarios-recordatorios.md).

**Fecha:** 2026-05-31
**Autores:** Jovi Mibimbi + claude-code (Opus 4.8)
**Fase del proyecto:** Fase 6 — Recordatorios bidireccionales (F6-A)

## Contexto

Un recordatorio `familia`/`equipo` puede tener varios destinatarios que lo vean a la vez (p.ej. dos tutores del niño, o tutor + profe). "Marcar como completado" debe ser:

- **Idempotente**: marcar dos veces no debe duplicar efecto ni dar error duro.
- **Race-safe**: si dos destinatarios pulsan "hecho" casi a la vez, uno gana y el otro debe enterarse de que ya estaba completado, sin un 500 ni un estado inconsistente.

El proyecto ya documenta el gotcha **"USING falso → 0 filas, sin error"** (F5.6-B, `rls-policies.md`): un `UPDATE` bajo RLS cuya `USING` no matchea ninguna fila devuelve `data: null, error: null` (no `42501`). El contexto de F6 anticipó que este patrón volvería para "marcar como completado solo si no estaba ya completo".

Hay que decidir cómo se implementa la operación de completar de forma robusta.

## Opciones consideradas

### Opción A: `UPDATE … WHERE completado_en IS NULL` + `.select().maybeSingle()` (elegida)

El server action ejecuta:

```ts
.update({ completado_en: now, completado_por: userId })
.eq('id', id)
.is('completado_en', null)     // guard de idempotencia
.select('id').maybeSingle()
// data === null && error === null → ya completado (o RLS rechazó) → 'ya_completado'
```

**Pros:**

- El guard `completado_en IS NULL` vive en la **misma sentencia** → atómico a nivel de fila en Postgres. Dos UPDATE concurrentes: el segundo no encuentra fila pendiente → 0 filas.
- Distingue "lo completé yo" (fila devuelta) de "ya estaba / no puedo" (null) con un único roundtrip.
- Reutiliza el patrón ya probado en mensajería (`marcarMensajeErroneo`) para el null-check.

**Contras:**

- `null` colapsa dos causas (ya completado vs RLS USING rechazó). Para la UX da igual: ambas → "ya estaba completado / no disponible". Si se necesitara distinguir, habría que un SELECT extra (no merece la pena).

### Opción B: SELECT-then-UPDATE en dos pasos

Leer el estado, decidir en JS, luego UPDATE.

**Contras:**

- TOCTOU: entre el SELECT y el UPDATE otro destinatario completa → doble escritura / lectura sucia. Requiere transacción o lock explícito que PostgREST no expone limpiamente.

### Opción C: Estado de cumplimiento por usuario (tabla `lectura_*`-like)

Modelar "completado" como filas por (usuario, recordatorio).

**Contras:**

- Sobre-modela: un recordatorio se completa una vez (lo trajo, lo hizo), no "por persona". Complica queries y UI sin valor para el piloto.

## Decisión

**Se elige la Opción A.** El guard `WHERE completado_en IS NULL` en la propia sentencia da idempotencia y race safety sin transacciones explícitas, y el `.select().maybeSingle()` con null-check mapea limpiamente a `ya_completado`. Es coherente con el manejo de "0 filas" ya adoptado en F5.6-B.

## Consecuencias

### Positivas

- Completar es seguro ante concurrencia con un único roundtrip.
- Cero estado extra; el lifecycle vive en dos columnas (`completado_en`, `completado_por`).

### Negativas

- `null` agrupa "ya completado" y "RLS rechazó"; aceptable para la UX (mismo mensaje).

### Neutras

- La **anulación** (marcar erróneo) usa el mismo null-check pero su ventana de 5 min se enforza en el action, no en RLS (ver ADR-0035, trade-off).

## Plan de implementación

- [x] `completarRecordatorioCore` con `.is('completado_en', null).select().maybeSingle()`.
- [x] Test unit: happy path, "ya completado / race" (0 filas → `ya_completado`), 42501 → `no_autorizado`.
- [x] Test RLS: tutor completa familia; segundo intento afecta 0 filas.

## Verificación

- `completar-recordatorio.test.ts` (unit) y `recordatorios.rls.test.ts` (integración).

## Referencias

- `docs/architecture/rls-policies.md` — sección "USING falso → 0 filas, sin error".
- ADR-0035 (modelo recordatorios), ADR-0031 (ventana anulación mensajería).
- Spec: `docs/specs/reminders.md` (🔒 D6).
