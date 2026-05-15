# ADR-0016: "Día cerrado" como regla transversal del producto

## Estado

`accepted`

**Fecha:** 2026-05-15
**Autores:** jovimib + claude-code
**Fase del proyecto:** Fase 4 — Asistencia y ausencias

## Contexto

ADR-0013 estableció en Fase 3 que la **agenda diaria** se edita solo durante el mismo día calendario hora `Europe/Madrid`. A las 00:00 del día siguiente, las 5 tablas de la agenda (`agendas_diarias`, `comidas`, `biberones`, `suenos`, `deposiciones`) quedan **read-only para todos los roles**, incluido admin, vía RLS. Correcciones solo vía SQL con `service_role` (queda en `audit_log`). DELETE bloqueado por default DENY — eventos erróneos se anulan con prefijo `[anulado] `.

Esta regla nació pensada solo para la agenda. Pero Fase 4 trae **dos tablas nuevas** que también describen hechos diarios:

- `asistencias` — un upsert por (niño, fecha). Hecho que ocurrió ese día.
- `ausencias` — rango de fechas que cubre uno o más días.

La pregunta es: ¿la regla "día cerrado a las 00:00 Madrid" aplica también a estas tablas? Hay dos lecturas:

1. **Solo aplica a la agenda.** La asistencia es más operativa: si la profe se olvidó de marcar a un niño ayer, queremos que pueda corregirlo hoy.
2. **Aplica a todo lo que describe hechos diarios.** La asistencia es un hecho auditable: si en cualquier momento se pudiera reescribir, perdería valor para inspecciones, disputas con familias, RGPD.

Restricciones que afectan la decisión:

- La RLS de F3 ya implementa `dentro_de_ventana_edicion(fecha)` como helper público — gratis ampliarlo a F4 si decidimos esa misma regla.
- La consigna del producto desde Fase 0 es **"hecho registrado, hecho cerrado"**: la app no es un sistema de edición libre.
- Para correcciones reales (errores operativos, no fraude), la salida es `service_role` desde DBA — queda auditado.
- Las **ausencias futuras** son diferentes: la familia reporta hoy una ausencia para mañana o la semana que viene. Eso NO es "día cerrado" — es planificación.

## Opciones consideradas

### Opción A: "Día cerrado" solo aplica a la agenda (F3)

F4 (`asistencias`, `ausencias`) admite UPDATE libre por admin sin restricción de ventana.

**Pros:**

- Más flexibilidad operativa: la admin corrige errores de ayer sin pasar por DBA.
- No introduce más reglas transversales — F3 sigue siendo el único caso.

**Contras:**

- La asistencia deja de ser un hecho auditable inmutable.
- Crea inconsistencia interna: ¿por qué la profe no puede editar la agenda de ayer pero la admin sí puede editar su asistencia? Difícil de explicar.
- Abre la puerta a reescritura "rutinaria" en lugar de "excepcional".

### Opción B: "Día cerrado" aplica a `asistencias`, NO a `ausencias`

`asistencias` con la misma regla que F3. `ausencias` libre (admin/tutor pueden modificar futuras y pasadas).

**Pros:**

- Asistencia mantiene su valor auditable.
- Ausencias pueden ajustarse (un médico justifica retrospectivamente, una familia añade descripción tarde).

**Contras:**

- Una ausencia retrospectiva puede contradecir una asistencia ya marcada. Necesitamos lógica de reconciliación.
- Reportar ausencia de "ayer" desde la familia es raro y casi siempre indica error operativo.

### Opción C: "Día cerrado" aplica a `asistencias`. `ausencias` solo permite **futuras**

Mismo "día cerrado" para asistencias. Ausencias: la RLS de INSERT/UPDATE exige `fecha_inicio >= hoy_madrid()`. Una ausencia ya iniciada no puede modificarse desde la app (cancelar sí, vía prefijo `[cancelada] `, mismo patrón ADR-0013).

**Pros:**

- Asistencia: regla idéntica a F3, hecho auditable.
- Ausencia: solo planificación futura. Cancelable in-place (no DELETE).
- Coherencia con "hecho registrado, hecho cerrado".
- Edge cases (ausencia que se solapa con asistencia futura) se previenen porque ambas se planifican adelantadas.

**Contras:**

- Una familia que olvida reportar hoy no puede hacerlo retrospectivamente. Tiene que avisar al centro por otro canal (mensajería F5).
- Admin no puede "regularizar" desde la app — necesita DBA si el dato debe quedar en BD. Pero ese caso ya se acepta para la agenda.

## Decisión

**Se elige la Opción C** y se eleva a **regla transversal del producto**: cualquier tabla operativa que registre hechos diarios (agenda, asistencia) aplica la regla "día cerrado a las 00:00 Madrid". Las tablas de planificación (ausencias futuras, eventos, autorizaciones) siguen reglas propias adecuadas al caso.

Concretamente para F4:

- `asistencias`: RLS de INSERT/UPDATE exige `dentro_de_ventana_edicion(fecha)` — incluido admin. DELETE bloqueado para todos.
- `ausencias`: RLS de INSERT (familia con permiso) exige `fecha_inicio >= hoy_madrid()`. UPDATE permitido a admin/tutor con permiso siempre que `fecha_inicio >= hoy_madrid()` para tutor; admin sin restricción para corregir errores administrativos puntuales (typo de fechas, motivo equivocado). Cancelación = UPDATE con prefijo `[cancelada] `. DELETE bloqueado.
- Profe puede UPDATE solo sobre ausencias que ella misma creó (`reportada_por = auth.uid()`) — el server action valida que el único cambio aceptable es la cancelación.

Esta regla se hace explícita en la documentación de RLS y en cada migración futura que cree tablas con timestamps de hechos diarios.

## Consecuencias

### Positivas

- Coherencia entre agenda, asistencia y futuras tablas de hechos diarios: una única regla mental.
- Asistencia es hecho auditable inmutable desde la app — refuerzo RGPD e inspecciones.
- Helper `dentro_de_ventana_edicion(fecha)` se reusa, no se duplican implementaciones.
- Ausencias futuras NO necesitan vetar ediciones de admin — siguen siendo planificación.

### Negativas

- La familia que olvida reportar hoy debe usar mensajería (F5) o avisar al centro. La app no le ofrece "reporte retroactivo".
- La admin que detecta hoy un error en la asistencia de ayer tiene que pedir corrección DBA. Aceptable: el caso es excepcional, queda en `audit_log`.

### Neutras

- ADR-0011 / ADR-0013 ya tenían la regla — esta decisión la promueve a "principio del producto" y la extiende formalmente a F4. La sección 'Ventana de edición agenda diaria' de `docs/architecture/rls-policies.md` cambia de título a 'Ventana de edición y "día cerrado"' para reflejar el alcance transversal.

## Plan de implementación

- [x] Migración `phase4_attendance.sql`: RLS de `asistencias` (INSERT/UPDATE) exige `dentro_de_ventana_edicion(fecha)`.
- [x] Migración `phase4_attendance.sql`: RLS de `ausencias` (INSERT) exige `fecha_inicio >= hoy_madrid()` para tutor; admin/profe sin esa restricción.
- [x] Helper `public.hoy_madrid()` (SQL stable, security definer, search_path explícito) usado por las policies de `ausencias`. Lectura compartida con `dentro_de_ventana_edicion`.
- [x] Tests RLS verifican que admin NO puede INSERT/UPDATE `asistencias` fuera de hoy Madrid, y que tutor NO puede crear ausencia retroactiva.
- [x] Documentar en `docs/architecture/rls-policies.md` la sección "día cerrado" como **transversal**, no solo agenda.
- [x] Server action `cancelarAusencia` implementa el patrón de prefijo `[cancelada] `.

## Verificación

- Tests RLS Fase 4: ausencia retroactiva por tutor → falla; admin update asistencia con `fecha=ayer` → falla; profe edita asistencia con `fecha=ayer` → falla.
- Tests E2E (smoke + `E2E_REAL_SESSIONS=1`): día cerrado → tabla `<PaseDeListaTable />` queda en `readOnly`, sin botón submit ni quick actions.

## Notas

`hoy_madrid()` y `dentro_de_ventana_edicion(fecha)` son helpers gemelos:

```sql
CREATE OR REPLACE FUNCTION public.hoy_madrid() RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (now() AT TIME ZONE 'Europe/Madrid')::date;
$$;

CREATE OR REPLACE FUNCTION public.dentro_de_ventana_edicion(p_fecha date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_fecha = (now() AT TIME ZONE 'Europe/Madrid')::date;
$$;
```

El primero devuelve "hoy"; el segundo compara con una fecha dada. Ambos sirven a casos distintos: el primero se usa en políticas de ausencias para "solo desde hoy en adelante"; el segundo se usa en políticas de agenda y asistencia para "solo hoy".

## Referencias

- Specs: `/docs/specs/daily-agenda.md`, `/docs/specs/attendance.md`
- ADRs relacionados: ADR-0011 (timezone Madrid), ADR-0013 (mismo día agenda), ADR-0015 (asistencia lazy).
