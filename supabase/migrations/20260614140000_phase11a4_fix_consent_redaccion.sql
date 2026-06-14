-- =============================================================================
-- Fase 11-A4 (RGPD) — Fix: permitir la redacción de metadatos en consentimientos
-- =============================================================================
--
-- Contexto: el derecho al olvido (migración 20260614130000) anula
-- `consentimientos.ip_address`/`user_agent` del sujeto purgado (metadatos
-- re-identificables, Decisión F11-A #plan). Pero el trigger `consentimientos_
-- solo_revocar` de #88 (BEFORE UPDATE) revertía CUALQUIER cambio que no fuera
-- `revocado_en` (forzaba NEW := OLD) y ADEMÁS lanzaba excepción sobre filas ya
-- revocadas → la redacción quedaba sin efecto / fallaba.
--
-- Esta migración relaja el trigger de forma MÍNIMA y segura (no hay policy
-- UPDATE: los clientes no pueden tocar la tabla — verificado por c07; el trigger
-- solo lo alcanzan las RPC SECURITY DEFINER que controlamos):
--   - id/usuario_id/tipo/version/aceptado_en/created_at siguen INMUTABLES.
--   - ip_address/user_agent: SOLO pueden BORRARSE (→NULL) — redacción RGPD; nunca
--     alterarse a otro valor (si llega un valor, se fuerza al de OLD).
--   - revocado_en: transición única NULL→now() (revocación normal); si la fila ya
--     estaba revocada, se CONSERVA (permite redactar metadatos de filas revocadas
--     sin re-sellar ni lanzar excepción).
--
-- No edita la migración aplicada #88 (regla de inmutabilidad): CREATE OR REPLACE
-- de la función del trigger en una migración nueva.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.consentimientos_solo_revocar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Inmutables siempre.
  NEW.id          := OLD.id;
  NEW.usuario_id  := OLD.usuario_id;
  NEW.tipo        := OLD.tipo;
  NEW.version     := OLD.version;
  NEW.aceptado_en := OLD.aceptado_en;
  NEW.created_at  := OLD.created_at;

  -- Metadatos re-identificables: solo se permiten BORRAR (→NULL) para la
  -- redacción del derecho al olvido; cualquier otro valor se rechaza forzando OLD.
  NEW.ip_address  := CASE WHEN NEW.ip_address IS NULL THEN NULL ELSE OLD.ip_address END;
  NEW.user_agent  := CASE WHEN NEW.user_agent IS NULL THEN NULL ELSE OLD.user_agent END;

  -- Revocación: transición única NULL→now(). Si ya estaba revocada, se conserva
  -- (no se re-sella) para permitir la redacción de metadatos sobre filas revocadas.
  IF OLD.revocado_en IS NULL THEN
    NEW.revocado_en := now();
  ELSE
    NEW.revocado_en := OLD.revocado_en;
  END IF;

  RETURN NEW;
END $$;

COMMIT;
