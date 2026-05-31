# ADR-0035: Modelo de recordatorios bidireccionales — tabla propia con ENUM de destino

## Estado

`proposed`

**Fecha:** 2026-05-31
**Autores:** Jovi Mibimbi + claude-code (Opus 4.8)
**Fase del proyecto:** Fase 6 — Recordatorios bidireccionales (F6-A)

## Contexto

F6 introduce "recordatorios bidireccionales" (feature E del research): un mensaje **accionable** con vencimiento opcional y estado de cumplimiento, dirigido a un destinatario que debe verlo o actuar. La bidireccionalidad real vive en la arista **centro ↔ familia de un niño**, recorrida en los dos sentidos.

Restricciones de partida:

- Ya existe mensajería (F5: `conversaciones`/`mensajes`, conversación libre) y anuncios (broadcast). Un recordatorio NO es ninguno de los dos: tiene `vencimiento` y un ciclo `pendiente → completado`.
- El piloto ANAIA es un centro pequeño (5 aulas, 0-3). Casos: staff→familia (documentación, material, cuotas, reuniones), familia→staff (recogida distinta, medicación del día), profe/familia→dirección (material, baja), y notas personales.
- El modelo debe ser compatible con F7 (Calendario y eventos) sin rehacerse.
- RLS debe seguir los patrones del proyecto (helpers `SECURITY DEFINER`, default DENY) y evitar el gotcha MVCC de `INSERT…RETURNING` (F5).

Hay que decidir AHORA la forma de la entidad antes de la migración F6-A.

## Opciones consideradas

### Opción A: Tabla propia `recordatorios` con ENUM `destinatario` (elegida)

Una tabla nueva con 4 destinos (`familia`, `equipo`, `direccion`, `personal`), `vencimiento` opcional, `completado_en`/`completado_por`, flag `erroneo`, y CHECK estructural por destino (paralelo a `conversaciones_tipo_coherencia` de F5.6-A).

**Pros:**

- El ciclo `pendiente → completado` y el `vencimiento` son propios de la entidad — no encajan en `mensajes`.
- Un único ENUM modela las dos direcciones de la arista niño-céntrica (`familia`/`equipo`) + dos destinos auxiliares, con RLS por rama reutilizando helpers existentes.
- La SELECT policy lee solo columnas del row + helpers que consultan OTRAS tablas → el gotcha MVCC NO aplica (sin helper row-aware nuevo).
- Compatible con F7: un `evento_id uuid NULL` se añade con `ALTER TABLE ADD COLUMN` cuando F7 quiera generar recordatorios desde eventos.

**Contras:**

- Una tabla y un ENUM más en el modelo.
- La visibilidad por destino multiplica las ramas RLS (mitigado: helpers ya existen, sin SQL nuevo).

### Opción B: Extender `mensajes`/`conversaciones`

Añadir `vencimiento` y `completado_en` a `mensajes`, modelando recordatorios como un tipo de mensaje.

**Pros:**

- Reutiliza tabla, RLS y Realtime de mensajería.

**Contras:**

- Contamina `mensajes` con columnas que solo aplican a una fracción de filas.
- El "destinatario" de un recordatorio (familia del niño / dirección / uno mismo) no mapea a una conversación 1-a-1 ni a un hilo por niño.
- El ciclo de cumplimiento (completar/race) entra en conflicto con la semántica de un mensaje inmutable.

### Opción C: No hacer entidad — usar anuncios + convención

Recordatorios como anuncios con una etiqueta. Descartada: los anuncios son broadcast unidireccional sin estado de cumplimiento ni vencimiento, y no cubren familia→centro.

## Decisión

**Se elige la Opción A** porque el ciclo `pendiente → completado` + `vencimiento` es una entidad nueva, no un mensaje; el ENUM `destinatario` captura la bidireccionalidad con RLS tractable reutilizando helpers existentes; y deja el modelo abierto a F7 con un `ALTER TABLE` trivial.

Detalle de visibilidad/escritura por destino en `docs/architecture/rls-policies.md` y `docs/specs/reminders.md`.

### Trade-off aceptado: ventana de anulación en el server action (no en RLS)

El UPDATE de `recordatorios` multiplexa dos operaciones: **completar** (sin límite temporal, por destinatario o emisor) y **anular** (5 min, solo emisor). No es posible separar ambas por condición temporal en una sola policy. A diferencia de mensajería (ventana de 5 min en RLS, ADR-0031), aquí la ventana de anulación se enforza en el **server action** (`anularRecordatorioCore`: pre-check de `created_at` + null-check del UPDATE). Riesgo: un cliente manipulado podría anular un recordatorio **propio** pasados los 5 min — impacto bajo (solo añade prefijo `[anulado] ` a algo suyo, queda en `audit_log`). La idempotencia de completar sí va en la sentencia (`WHERE completado_en IS NULL`), ver ADR-0036.

## Consecuencias

### Positivas

- Entidad limpia y auto-contenida; mensajería intacta.
- RLS sin helpers nuevos ni riesgo MVCC (verificado con test de `INSERT…RETURNING`).
- Compatible con F7 sin migración compleja.

### Negativas

- +1 tabla, +1 ENUM. RLS por destino más verboso.
- La ventana de anulación no es defensa a nivel BD (riesgo aceptado arriba).

### Neutras

- Push reutiliza el pipeline F5.5 con un helper de audiencia por destino.

## Plan de implementación

- [x] Migración `20260531120000_phase6_reminders.sql` (tabla, ENUM, triggers, RLS, audit, Realtime).
- [x] Tipos, schemas Zod, actions (crear/completar/anular), queries.
- [x] Tests unit (cores) + RLS (gated) + audit (gated), incl. test del gotcha MVCC.
- [ ] F6-B: UI, i18n, badge.
- [ ] F7: añadir `evento_id` si procede.

## Verificación

- Test RLS `recordatorios.rls.test.ts`: visibilidad por destino, INSERT…RETURNING ok, DELETE denegado.
- Test audit `recordatorios-audit.test.ts`.

## Referencias

- Spec: `docs/specs/reminders.md`
- ADRs relacionados: ADR-0029/0030 (patrón bidireccional admin↔familia), ADR-0031 (ventana anulación), ADR-0036 (idempotencia al completar).
- RLS: `docs/architecture/rls-policies.md` (gotcha MVCC, "USING falso → 0 filas").
