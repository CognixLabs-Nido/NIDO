-- =============================================================================
-- Fase 9 — F9-2 fix: relajar el CHECK `informes_evolucion_notificado_coherencia`
-- =============================================================================
-- El CHECK de F9-0 exigía `notificado_at IS NULL OR estado = 'publicado'`. Eso
-- entra en conflicto con el flujo despublicar→corregir→republicar (Q8): al
-- DESPUBLICAR un informe ya avisado, `estado` vuelve a 'borrador' pero
-- `notificado_at` DEBE persistir (es el sello de "ya se avisó una vez" → la
-- republicación NO re-avisa). Con el CHECK puesto, esa transición violaba la
-- restricción.
--
-- `notificado_at` es un marcador HISTÓRICO independiente del estado actual
-- (¿se notificó alguna vez?), así que la coherencia con `estado` no aplica. Se
-- elimina el CHECK. El resto del modelo F9-0 (publicado_coherencia, UNIQUE de la
-- terna, etc.) se mantiene intacto.
--
-- Operación sobre esquema productivo → se aplica MANUALMENTE por SQL Editor (CLI
-- con bug SIGILL). No la ejecuta el agente. Idempotente (DROP IF EXISTS).
-- =============================================================================
ALTER TABLE public.informes_evolucion
  DROP CONSTRAINT IF EXISTS informes_evolucion_notificado_coherencia;
