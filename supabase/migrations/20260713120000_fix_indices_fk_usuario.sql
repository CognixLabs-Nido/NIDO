-- =============================================================================
-- Índices de apoyo para FKs a public.usuarios (autoría/actor) — Tier 1 + Tier 2
-- -----------------------------------------------------------------------------
-- CRITERIO. Un FK sin índice de apoyo en la columna referenciante es un
-- antipatrón: al borrar (o modificar) la fila PADRE, Postgres debe localizar las
-- filas HIJAS que la referencian, y sin índice hace un SEQ-SCAN completo de la
-- tabla hija por cada fila padre borrada. Con tablas hijas grandes esto degrada
-- a O(n) por borrado → timeouts. Es el mismo problema que ya cerró #194 para
-- audit_log.usuario_id (seq-scan de ~433k filas / 320 MB por cuenta borrada).
--
-- EL ON DELETE NO EXIME DEL ÍNDICE. Todas las variantes tienen que ENCONTRAR las
-- filas hijas primero:
--   - RESTRICT / NO ACTION → verifican que NO existan hijas (o fallan).
--   - SET NULL             → localizan las hijas para hacerles UPDATE ... = NULL.
--   - CASCADE              → localizan las hijas para borrarlas.
-- En los tres casos, sin índice sobre la columna FK = seq-scan de la tabla hija.
--
-- INCLUSIÓN. El criterio fue el CRECIMIENTO de la tabla hija: se indexan los FKs
-- de actor/autoría sobre tablas que crecen con la operación diaria del centro
-- (mensajes, asistencias, recordatorios, anuncios, publicaciones, eventos y sus
-- confirmaciones, autorizaciones, ausencias, invitaciones). El disparador real es
-- el borrado de una cuenta (derecho al olvido / limpieza de test): cada usuario es
-- padre de estas filas y su borrado las recorre todas.
--
-- ÍNDICES COMPLETOS, NO PARCIALES. A propósito NO se filtra por `deleted_at IS NULL`:
-- el FK referencia la fila con independencia del soft-delete (una fila soft-deleted
-- sigue apuntando a su usuario), así que la verificación del constraint necesita
-- cubrir TODAS las filas. Un índice parcial dejaría fuera las soft-deleted y el
-- planner volvería al seq-scan. Espejo del índice pleno de #194.
--
-- YA CUBIERTO (verificado en pg_index sobre el remoto, NO se recrea):
--   - recordatorios.creado_por              → idx_recordatorios_creado_por
--   - recordatorios.usuario_destinatario_id → idx_recordatorios_usuario_destinatario
-- Por eso de las tres columnas de `recordatorios` solo entra `completado_por`.
--
-- Todos IF NOT EXISTS: idempotente, seguro de re-aplicar. NO aplicar por CLI;
-- lo aplica el operador por el SQL Editor (rol postgres).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tier 1 — tablas hijas de mayor volumen (crecen en cada jornada).
-- -----------------------------------------------------------------------------

-- mensajes.autor_id → usuarios (ON DELETE RESTRICT). La tabla de mayor crecimiento
-- (cada mensaje de cada conversación). Sin índice, borrar una cuenta seq-scanea
-- toda la mensajería para verificar el RESTRICT.
CREATE INDEX IF NOT EXISTS idx_mensajes_autor_id
  ON public.mensajes (autor_id);

-- asistencias.registrada_por → usuarios (ON DELETE SET NULL). Una fila por niño y
-- día lectivo: crecimiento lineal permanente. SET NULL debe localizar cada fila del
-- actor para anularla.
CREATE INDEX IF NOT EXISTS idx_asistencias_registrada_por
  ON public.asistencias (registrada_por);

-- recordatorios.completado_por → usuarios (ON DELETE SET NULL). creado_por y
-- usuario_destinatario_id ya están indexados; completado_por no. SET NULL necesita
-- encontrar los recordatorios completados por el actor.
CREATE INDEX IF NOT EXISTS idx_recordatorios_completado_por
  ON public.recordatorios (completado_por);

-- -----------------------------------------------------------------------------
-- Tier 2 — tablas hijas de crecimiento medio (autoría de contenido / eventos).
-- -----------------------------------------------------------------------------

-- anuncios.autor_id → usuarios (ON DELETE RESTRICT).
CREATE INDEX IF NOT EXISTS idx_anuncios_autor_id
  ON public.anuncios (autor_id);

-- publicaciones.autor_id → usuarios (ON DELETE RESTRICT).
CREATE INDEX IF NOT EXISTS idx_publicaciones_autor_id
  ON public.publicaciones (autor_id);

-- confirmaciones_evento.confirmado_por → usuarios (ON DELETE RESTRICT). Crece con
-- (evento × asistentes que confirman).
CREATE INDEX IF NOT EXISTS idx_confirmaciones_evento_confirmado_por
  ON public.confirmaciones_evento (confirmado_por);

-- eventos.creado_por → usuarios (ON DELETE RESTRICT).
CREATE INDEX IF NOT EXISTS idx_eventos_creado_por
  ON public.eventos (creado_por);

-- autorizaciones.creado_por → usuarios (ON DELETE RESTRICT).
CREATE INDEX IF NOT EXISTS idx_autorizaciones_creado_por
  ON public.autorizaciones (creado_por);

-- ausencias.reportada_por → usuarios (ON DELETE SET NULL).
CREATE INDEX IF NOT EXISTS idx_ausencias_reportada_por
  ON public.ausencias (reportada_por);

-- invitaciones.invitado_por → usuarios (ON DELETE NO ACTION). NO ACTION verifica la
-- ausencia de hijas igual que RESTRICT: necesita el índice para no seq-scanear.
CREATE INDEX IF NOT EXISTS idx_invitaciones_invitado_por
  ON public.invitaciones (invitado_por);
