-- =============================================================================
-- F11 alta PR-3b-1 (modo "Completa Dirección") — (1/6) firma_metodo + CHECK
-- -----------------------------------------------------------------------------
-- MODELO: la DIRECTORA (admin del centro) rellena el wizard COMO ELLA MISMA, con
-- documentación EN PAPEL, y firma A SU PROPIO NOMBRE con marca de "respaldo físico".
-- NO se imputa nada al tutor; NO hay impersonación. La única diferencia con el modo
-- familia es que no se manda email.
--
-- Soporta la firma PRESENCIAL: añade el método de firma.
--   - CREATE TYPE firma_metodo ('digital','presencial').
--   - firmas_autorizacion.metodo_firma NOT NULL DEFAULT 'digital' → las firmas
--     EXISTENTES quedan 'digital' (correcto: son trazos dibujados).
--   - Relaja el CHECK del trazo: `firma_imagen` se exige SOLO en firma DIGITAL; en
--     PRESENCIAL no hay trazo (firma_imagen NULL).
--
-- Idempotente. APLICAR POR SQL EDITOR (rol postgres). NO por CLI.
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

ALTER TABLE public.firmas_autorizacion
  DROP CONSTRAINT IF EXISTS firmas_firma_imagen_req;
ALTER TABLE public.firmas_autorizacion
  ADD CONSTRAINT firmas_firma_imagen_req CHECK (
    decision <> 'firmado'
    OR (metodo_firma = 'digital' AND firma_imagen IS NOT NULL)
    OR (metodo_firma = 'presencial')
  );

COMMENT ON COLUMN public.firmas_autorizacion.metodo_firma IS
  'Método de la firma: digital (trazo dibujado — firma electrónica simple del propio tutor) o presencial (autorización en papel que la Dirección firma a su nombre, con respaldo físico, sin trazo). PR-3b-1.';
