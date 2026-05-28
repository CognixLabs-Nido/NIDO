# ADR-0029: Modelo admin↔familia 1-por-(admin, tutor) con reapertura por UPSERT

## Estado

`accepted`

**Fecha:** 2026-05-28
**Autores:** Jovi Mibimbi + claude-code (Opus 4.7)
**Fase del proyecto:** Fase 5.6 — Conversación admin ↔ familia (F5.6-A)

## Contexto

F5 modeló las conversaciones como **un hilo por niño** (`UNIQUE(nino_id)`), pensado para "profe ↔ tutores del niño". En F5.6-A entra un canal nuevo: la dirección del centro (admin) necesita escribir a la familia sobre temas que **no son por niño** sino por persona — pagos, faltas reiteradas, citación a tutoría, etc.

Restricciones de partida:

- Tutor puede tener más de un hijo en el centro → un hilo "por niño" multiplicaría conversaciones del mismo par admin-tutor.
- Admin no quiere mandar el mismo mensaje N veces si el tutor tiene 3 hijos.
- El tutor tampoco quiere recibir el mismo aviso 3 veces.
- Spec F5.6 (Checkpoint A): conversación admin↔familia "caduca" a los 3 días sin actividad y se "reabre" al enviar/recibir un nuevo mensaje. La granularidad del hilo afecta a cómo se gestiona ese timer.
- El modelo debe coexistir con F5 (profe↔familia per niño) sin romper la RLS ni los queries.

Hay que decidir AHORA porque toda la fase F5.6 depende de esta granularidad: schema, RLS, server actions, queries y UI.

## Opciones consideradas

### Opción A: Un hilo por (admin, tutor)

Hilo único entre cada par de personas. `tipo_conversacion='admin_familia'`, `admin_id` y `tutor_id` poblados, `nino_id NULL`. Índice parcial único `(admin_id, tutor_id) WHERE tipo='admin_familia'`.

**Pros:**

- 1:1 mapping con la mental model "conversación con esta persona".
- Independiente del nº de hijos del tutor: 3 hijos → 1 hilo.
- Reapertura natural: si el hilo caducó, el admin "lo reabre" y sigue donde lo dejaron. Histórico preservado.
- El timer (`expires_at`) vive en la conversación, no en el mensaje, y se resetea con cada INSERT (trigger).

**Contras:**

- Asimetría con F5 (`nino_id NULL` en este tipo, `NOT NULL` en `profe_familia`). Implica `nino_id nullable` + CHECK estructural por tipo.
- Cambio de tipo en cliente: queries F5 que asumían `nino_id: string` ahora ven `string | null` (resuelto en C3.5).

### Opción B: Un hilo por niño (extender F5 con autor admin)

Mantener el modelo de F5, simplemente permitir que el admin escriba en el hilo del niño además de la profe.

**Pros:**

- Cero cambios de schema.
- Una sola query, un solo flujo UI.

**Contras:**

- Mezcla en el mismo hilo conversaciones "operativas del día a día" (profe ↔ familia: agenda, fotos, comida) con "comunicación institucional" (admin ↔ familia: cuotas, faltas, citaciones). Tono y contexto distintos.
- Si el tutor tiene 2 hijos, el admin tiene que escribir 2 veces el mismo mensaje y el tutor lo recibe duplicado.
- El timer "caduca a 3 días" no tiene sentido per niño: no caduca el canal profe↔familia, solo el admin↔familia. Habría que añadir un timer por _mensaje del admin_, no por hilo.

### Opción C: Un hilo por centro (admin del centro ↔ tutor)

Si en el futuro hay varios admin en el centro, un solo hilo con todos ellos. Granularidad: `(centro_id, tutor_id)`.

**Pros:**

- Modelo "buzón institucional": el tutor habla con "dirección" como entidad, no con una persona concreta.
- Si un admin se da de baja, otro recoge el hilo sin esfuerzo.

**Contras:**

- ANAIA hoy tiene 1 admin; en Ola 1 no hay multi-admin per centro real. Sobre-diseño.
- Si llega un segundo admin, ¿quién es responsable del hilo? ¿quién marca como leído? El modelo per-par lo resuelve trivialmente (cada admin gestiona los suyos).
- Histórico: si el admin antiguo se reemplaza, el nuevo ve toda la conversación previa de su predecesor — confuso para el tutor ("¿quién ha escrito esto?").

### Opción D: No hacer nada (statu quo)

Renunciar a F5.6-A. La dirección sigue usando email/WhatsApp personales para temas institucionales.

**Pros:**

- Cero esfuerzo.

**Contras:**

- Rompe el principio "todo lo del centro vive en NIDO" — RGPD, audit log, trazabilidad.
- Spec de F5.6 ya validada por producto; la decisión es de implementación, no de scope.

## Decisión

**Opción A: un hilo por (admin, tutor).**

Implementación:

- Migración `20260528100000_phase5_6_admin_family_messaging.sql`: añade ENUM `tipo_conversacion`, columnas `admin_id`/`tutor_id`/`tipo_conversacion`/`expires_at`, hace `nino_id` nullable, CHECK estructural `conversaciones_tipo_coherencia` por tipo, índice único parcial `(admin_id, tutor_id) WHERE tipo='admin_familia'`.
- Server action `abrirConversacionAdminFamilia(tutorId)`: SELECT-then-INSERT-or-UPDATE con captura de `23505` para resolver el doble-click. UPSERT sería ideal pero supabase-js no permite añadir el predicado del índice parcial al `onConflict`.
- Queries separadas (`get-admin-familia-list`, `get-admin-familia-detalle`) — no mezclamos con las de F5 profe↔familia.

## Consecuencias

**Positivas:**

- Buzón claro y simétrico por par. Cero duplicaciones si el tutor tiene varios hijos.
- El timer de 3 días caduca en el lugar correcto (conversación), reseteable de forma trivial vía trigger AFTER INSERT (ver ADR-0030).
- Compatibilidad con F5 preservada: profe↔familia sigue igual, solo añadimos un tipo nuevo.

**Negativas:**

- `nino_id` pasó a nullable; las queries F5 (`get-conversacion-detalle`, `get-conversaciones`) y `audiencia.ts` (push) necesitaron filtrar `tipo='profe_familia'` y/o cerrar el narrow (cubierto en C3.5).
- Asimetría visible en la BD: una columna que no aplica a la mitad de los hilos. Mitigado por CHECK estructural que enforza coherencia por tipo.

**Tareas derivadas:**

- F5.6-A cierra con esta decisión.
- F5.6-B (ventana de 5 min para marcar erróneo): aplica a mensajes de ambos tipos sin distinción (ver ADR-0031).
- C3.5 tuvo que filtrar las queries F5 para excluir `admin_familia` y cerrar los nullable del tipo cliente.

## Referencias

- Spec: [docs/specs/phase-5-6-admin-family-messaging.md](../specs/phase-5-6-admin-family-messaging.md)
- Migración: [supabase/migrations/20260528100000_phase5_6_admin_family_messaging.sql](../../supabase/migrations/20260528100000_phase5_6_admin_family_messaging.sql)
- ADR-0023 (modelo F5 de 5 tablas): [ADR-0023-modelo-mensajeria-cinco-tablas.md](ADR-0023-modelo-mensajeria-cinco-tablas.md)
- ADR-0030 (timer reseteable por trigger): [ADR-0030-admin-familia-timer-trigger.md](ADR-0030-admin-familia-timer-trigger.md)
- ADR-0031 (ventana de 5 min para anular): [ADR-0031-ventana-anulacion-5min.md](ADR-0031-ventana-anulacion-5min.md)
