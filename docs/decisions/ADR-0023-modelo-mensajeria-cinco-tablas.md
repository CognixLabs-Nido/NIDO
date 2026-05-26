# ADR-0023: Modelo de mensajería con 5 tablas separadas (conversaciones vs anuncios)

## Estado

`accepted`

**Fecha:** 2026-05-25
**Autores:** Responsable NIDO + Claude Code
**Fase del proyecto:** Fase 5 — Mensajería profe ↔ familia + anuncios

## Contexto

Fase 5 introduce dos flujos de comunicación con políticas y necesidades de UI distintas:

- **Conversaciones bidireccionales**: 1 hilo por niño donde profe del aula actual y tutores con `puede_recibir_mensajes` intercambian mensajes. Necesita lectura/escritura, contador de no leídos por usuario, scroll y paginación, Realtime granular por hilo.
- **Anuncios unidireccionales**: profe → aula o admin → aula/centro. La audiencia los lee pero no responde. Necesita read-receipts agregados ("leído por N de M"), filtrado por ámbito, ordenación cronológica.

Las RLS son **sustancialmente distintas**: en conversaciones se ejercita `puede_participar_conversacion(conv)` con admin observador del centro; en anuncios la audiencia se calcula con un helper que mezcla profes activos del aula/centro y tutores con permiso. Los índices también difieren (por `conversacion_id` vs por `aula_id`/`centro_id`). El patrón "marcar como erróneo" es transversal (flag + prefijo) pero la verificación de autoría y la presentación visual difieren entre los dos tipos.

Decidir el modelo antes de escribir la migración para no atarse a un esquema rígido y luego pagar refactor.

## Opciones consideradas

### Opción A: Tabla única `comunicaciones` con discriminador `tipo`

Una sola tabla con columnas opcionales por tipo (`conversacion_id`, `aula_id`, `centro_id`, `ambito`, etc.), un enum `tipo_comunicacion` discriminando.

**Pros:**

- Un único punto de auditoría e índice de Realtime.
- Reutilización del patrón "marcar como erróneo".

**Contras:**

- Muchas columnas NULLable según el tipo → CHECKs complejos.
- RLS con `CASE WHEN tipo = ...` o OR ramificados → más superficie de bugs y peor lectura del SQL.
- Realtime con filtros client-side cosméticos pero entrega de eventos cruzados (profe recibe pings por anuncios cuando solo le interesa la conversación abierta).
- Un agregado de "N de M leídos" en anuncios y un contador "K sin leer" en conversaciones requieren joins distintos sobre la misma tabla.
- Audit log mezcla todo: dificulta queries de cumplimiento.

### Opción B: 5 tablas separadas (la elegida)

- `conversaciones` (1 por niño, padre).
- `mensajes` (hijos de conversación).
- `lectura_conversacion` (read-receipt por usuario).
- `anuncios` (broadcast).
- `lectura_anuncio` (read-receipt por usuario).

**Pros:**

- Cada policy RLS es directa: lee la tabla "real" sin disjunciones por tipo.
- Índices precisos: `(conversacion_id, created_at DESC)` en `mensajes`, `(centro_id, created_at DESC)` en `anuncios`, `(aula_id, created_at DESC) WHERE aula_id IS NOT NULL` para anuncios de aula.
- Realtime publication granular: solo `mensajes` y `anuncios`. Las `lectura_*` no se publican.
- Audit log con `tabla` distintos → queries y filtrado más fáciles.
- TypeScript: tipos distintos `MensajeRow`, `AnuncioRow` evita confusión accidental.

**Contras:**

- 5 tablas vs 1 → más superficie de esquema (5 CREATE TABLE, 5 sets de policies).
- El patrón "marcar erróneo" se repite en `mensajes` y `anuncios` (flag + prefijo) — duplicación controlada.

### Opción C: 3 tablas (anuncios + conversaciones + mensajes; lectura unificada)

Unificar `lectura_conversacion` y `lectura_anuncio` en una sola tabla con discriminador.

**Pros:**

- Una sola tabla de telemetría de lectura.

**Contras:**

- Cuello de botella conceptual: las queries de no leídos de conversaciones y anuncios son distintas (cursor `last_read_at` vs existencia de fila); unificar no aporta.
- FK CASCADE: tendríamos que CASCADE-eliminar filas de tipo `conversacion` cuando se borra una conversación y de tipo `anuncio` cuando se borra un anuncio → triggers complejos.
- RLS dual sobre la misma tabla.

## Decisión

**Se elige la Opción B (5 tablas separadas)** porque las dos formas de comunicación tienen políticas RLS, índices y necesidades de UI claramente distintas. Unificarlas crearía una tabla con muchos NULLables y políticas RLS con OR ramificados que mezclan dos lógicas. La duplicación del patrón "marcar erróneo" se mitiga con helpers compartidos en TypeScript (`PREFIX_ANULADO`, `esMensajeAnulado`, `esAnuncioAnulado`) y un componente único `<MarcarErroneoButton target="mensaje" | "anuncio">`.

## Consecuencias

### Positivas

- RLS legibles: cada policy USING/CHECK es lineal sin disjunciones por tipo.
- Realtime preciso: el cliente solo recibe lo que necesita ver.
- Audit log filtrable por `tabla` (`mensajes`, `anuncios`, `conversaciones`) sin necesidad de un campo extra.
- Tipos TypeScript explícitos por tabla previenen confusión entre `MensajeRow` y `AnuncioRow`.

### Negativas

- 5 tablas + 1 ENUM + 4 helpers SQL = más esquema. Aceptable: el modelo cabe en una migración de ~520 líneas y es estable.
- El patrón "marcar erróneo" se duplica entre `mensajes.contenido` y `anuncios.titulo`. Mitigación: componente `<MarcarErroneoButton>` único en UI y constante `PREFIX_ANULADO` compartida en `types.ts`.

### Neutras

- Adoptar el helper row-aware `usuario_es_audiencia_anuncio_row` en la policy de SELECT de `anuncios` (ver ADR derivado en migración correctiva `20260525201151_phase5_fix_audience_returning.sql`).

## Plan de implementación

- [x] Migración `20260525154228_phase5_messaging.sql` con las 5 tablas, helpers, RLS, audit y Realtime.
- [x] Migración correctiva `20260525201151_phase5_fix_audience_returning.sql` con el helper row-aware.
- [x] Tipos TS regenerados (`src/types/database.ts`).
- [x] Helpers TS compartidos en `src/features/messaging/types.ts`.
- [x] Tests: 20 RLS + 4 helpers + 3 audit + 27 schemas Zod.

## Verificación

- Suite Vitest verde: 271 tests pasan.
- RLS específicas testeadas con sesiones reales (no mocks): t01-t20 cubren aislamiento por centro/aula, anti-suplantación, flag global `puede_recibir_mensajes`, DELETE bloqueado.

## Notas

La Opción B se inspira en la separación clásica entre "mensajería directa" (chat) y "broadcast" (notificaciones) usada en sistemas similares. El precedente interno son las 5 tablas de F3 (agenda padre + 4 hijos): ahí también ganamos en claridad por tablas separadas en lugar de un JSONB blob (ADR-0012).

## Referencias

- Spec: `/docs/specs/messaging.md`
- ADR-0007 — RLS recursion avoidance
- ADR-0012 — Agenda en 5 tablas vs JSONB (mismo razonamiento de "separar lo que tiene políticas distintas")
- ADR-0024 — Participantes y audiencia calculados dinámicamente
- ADR-0025 — Push notifications fuera de F5 (módulo transversal F5.5)
