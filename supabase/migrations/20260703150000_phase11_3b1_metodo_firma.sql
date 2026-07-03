-- =============================================================================
-- F11 alta PR-3b-1 (modo "Completa Dirección") — (1/4) firma_metodo + CHECK
-- -----------------------------------------------------------------------------
-- Soporta la FIRMA FÍSICA: la Directora registra "autorización en papel" EN NOMBRE
-- del tutor (no dibuja trazo, no es firma digital). Añade el método de firma:
--   - CREATE TYPE firma_metodo ('digital','presencial').
--   - firmas_autorizacion.metodo_firma NOT NULL DEFAULT 'digital' → las firmas
--     EXISTENTES quedan 'digital' (correcto: son trazos dibujados).
--   - Relaja el CHECK del trazo obligatorio: `firma_imagen` se exige SOLO en firma
--     DIGITAL; en PRESENCIAL no hay trazo (firma_imagen NULL).
--       (decision<>'firmado') OR (digital AND imagen NOT NULL) OR (presencial)
--
-- Idempotente. APLICAR POR SQL EDITOR (rol postgres → bypassa RLS). NO por CLI.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'firma_metodo' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.firma_metodo AS ENUM ('digital', 'presencial');
  END IF;
END $$;

ALTER TABLE public.firmas_autorizacion
  ADD COLUMN IF NOT EXISTS metodo_firma public.firma_metodo NOT NULL DEFAULT 'digital';

-- Relaja el trazo obligatorio: exigido solo en firma DIGITAL. En PRESENCIAL no hay
-- trazo (autorización en papel). Equivale a la fórmula del CHECK original salvo
-- por la excepción del método presencial.
ALTER TABLE public.firmas_autorizacion
  DROP CONSTRAINT IF EXISTS firmas_firma_imagen_req;
ALTER TABLE public.firmas_autorizacion
  ADD CONSTRAINT firmas_firma_imagen_req CHECK (
    decision <> 'firmado'
    OR (metodo_firma = 'digital' AND firma_imagen IS NOT NULL)
    OR (metodo_firma = 'presencial')
  );

COMMENT ON COLUMN public.firmas_autorizacion.metodo_firma IS
  'Método de la firma: digital (trazo dibujado — firma electrónica simple del propio tutor) o presencial (autorización en papel que la Dirección registra en nombre del tutor, sin trazo). PR-3b-1.';
