-- ============================================================================
-- Fase 5.6-B — "Marcar como erróneo" con ventana de 5 minutos
-- ============================================================================
--
-- Reemplaza las policies UPDATE de `mensajes` y `anuncios` añadiendo la
-- ventana temporal `created_at > now() - interval '5 minutes'` como
-- capa autoritativa. La UI desaparece el botón al expirar la ventana;
-- esta migración es la red de seguridad: aunque el cliente fuerce el
-- request, RLS rechaza con 42501.
--
-- Aplica a mensajes (profe↔familia y admin↔familia comparten la misma
-- tabla) y a anuncios. Mismo límite de 5 min por coherencia
-- (decisión cerrada en Checkpoint A).
--
-- Inline (no helper SQL): no es lookup cross-tabla, no hay riesgo MVCC
-- (UPDATE, no INSERT…RETURNING), evita coste extra de función.
--
-- IMPACTO EN DATOS HEREDADOS: mensajes/anuncios creados hace >5 min
-- quedan inmutables desde el momento en que se aplique esta migración.
-- En ANAIA pre-prod (sin tráfico productivo aún) el impacto es nulo.
-- ============================================================================

BEGIN;

-- ─── mensajes ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS mensajes_update_autor ON public.mensajes;

CREATE POLICY mensajes_update_autor ON public.mensajes
  FOR UPDATE
  USING (
    autor_id = auth.uid()
    AND created_at > now() - interval '5 minutes'
  )
  WITH CHECK (
    autor_id = auth.uid()
    AND created_at > now() - interval '5 minutes'
  );

-- ─── anuncios ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS anuncios_update_autor ON public.anuncios;

CREATE POLICY anuncios_update_autor ON public.anuncios
  FOR UPDATE
  USING (
    autor_id = auth.uid()
    AND created_at > now() - interval '5 minutes'
  )
  WITH CHECK (
    autor_id = auth.uid()
    AND created_at > now() - interval '5 minutes'
  );

COMMIT;
