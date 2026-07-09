-- =============================================================================
-- FIX — índice de apoyo para el FK audit_log.usuario_id → usuarios
-- -----------------------------------------------------------------------------
-- El FK `audit_log.usuario_id → public.usuarios(id)` es NO ACTION (sin ON DELETE
-- explícito en phase2_core_entities). Al borrar/desactivar una cuenta, Postgres
-- verifica el FK con `SELECT 1 FROM audit_log WHERE usuario_id = <id>`; SIN índice
-- sobre esa columna eso es un SEQ SCAN de toda la tabla POR CADA cuenta borrada.
--
-- Con ~433k filas / ~320 MB en audit_log esto hizo IMPOSIBLE borrar cuentas:
-- timeouts en el SQL Editor (incluso por lotes con statement_timeout a 600s) y
-- 504 (AuthRetryableFetchError) en la Admin API de GoTrue. Un FK sin índice de
-- apoyo es un antipatrón conocido: toda operación que resuelva el FK (borrado o
-- verificación) degrada a O(filas de audit_log) por cuenta.
--
-- `audit_log` YA tiene índices en (centro_id, ts) y (tabla, ts), pero NINGUNO
-- sobre usuario_id → ningún plan puede resolver el FK por índice.
--
-- ADITIVA e IDEMPOTENTE: solo CREATE INDEX IF NOT EXISTS. No toca datos, RLS,
-- policies ni tipos (no regenera database.ts). Aplicar por SQL Editor (rol postgres).
-- NOTA: se emite SIN CONCURRENTLY porque va en el flujo de migraciones (una sola
-- sentencia, transacción corta); el build del índice bloquea escrituras de
-- audit_log unos segundos — asumible en ventana de baja actividad.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_audit_log_usuario_id
  ON public.audit_log (usuario_id);
