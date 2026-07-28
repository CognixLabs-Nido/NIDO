-- =============================================================================
-- IU-3 · Bloqueo de subida de la FOTO DE PERFIL del niño POR-NIÑO (consent de imagen).
-- -----------------------------------------------------------------------------
-- Contexto: el ETIQUETADO en publicaciones ya está bloqueado por-niño (RLS
-- `media_etiquetas_insert` → `nino_puede_aparecer(nino_id)`, F10). Pero la FOTO DE
-- PERFIL (`ninos.foto_url`, bucket privado `ninos-fotos`) NO comprobaba el consent en
-- ninguna capa: ni la RPC `actualizar_foto_nino_tutor` (solo authz rol/tutela, F11-E),
-- ni las policies de Storage del bucket (solo rol/tutela). → un niño sin consentimiento
-- de imagen podía tener foto de perfil (mismo vector de descuadre que el flag «Pepe»).
--
-- Cierre (defensa en profundidad a nivel BD, estrictamente POR-NIÑO, coherente con el
-- etiquetado que gatea sobre el MISMO flag derivado `puede_aparecer_en_fotos`):
--   1) la RPC que escribe `foto_url` (único escritor) exige `nino_puede_aparecer(nino)`;
--   2) las policies INSERT de `ninos-fotos` (admin F10-0, tutor F10-3) exigen ese gate
--      sobre `[2]=ninoId` → el blob no aterriza sin consent (sin huérfanos en Storage).
-- El flag ya es imposible de falsear a mano (IU-1b), así que el gate es fiable.
-- La UX (mensaje claro ANTES de subir) la añade el route handler; esto es el backstop BD.
--
-- Por-niño estricto: un hermano CON consent se sube sin problema; el que no lo tiene, no.
-- NO toca el borrado de foto (revocar → quitar el perfil es IU-4). Idempotente por niño.
-- =============================================================================

BEGIN;

-- 1. RPC `actualizar_foto_nino_tutor` (F11-E) — único escritor de `ninos.foto_url`.
--    CREATE OR REPLACE: SOLO se añade el bloque de consent, DESPUÉS del gate de authz
--    (para preservar el 42501 del no-autorizado); el resto (lookup anterior, UPDATE con
--    backstop de path {centro}/{id}/, ROW_COUNT) queda idéntico al vivo.
CREATE OR REPLACE FUNCTION public.actualizar_foto_nino_tutor(p_nino_id uuid, p_foto_path text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_anterior text;
  v_n int;
BEGIN
  IF NOT (public.es_admin(public.centro_de_nino(p_nino_id))
          OR public.es_tutor_legal_de(p_nino_id)) THEN
    RAISE EXCEPTION 'no autorizado a cambiar la foto de este nino'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- IU-3: gate de consentimiento de imagen POR-NIÑO. Sin consent vigente no hay foto de
  -- perfil (mismo flag derivado que el etiquetado). Va DESPUÉS del authz para no cambiar
  -- el 42501 del no-autorizado; aquí, ya autorizado pero sin consent → check_violation.
  IF NOT public.nino_puede_aparecer(p_nino_id) THEN
    RAISE EXCEPTION 'el nino no tiene consentimiento de imagen vigente'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT foto_url INTO v_anterior
    FROM public.ninos
   WHERE id = p_nino_id AND deleted_at IS NULL;

  UPDATE public.ninos
     SET foto_url = p_foto_path
   WHERE id = p_nino_id
     AND deleted_at IS NULL
     -- Backstop: el path debe colgar de {centro_id}/{id}/ del propio niño.
     AND p_foto_path LIKE centro_id::text || '/' || id::text || '/%';

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'foto no actualizada (path o nino invalido)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN v_anterior;
END;
$function$;

-- 2. Storage: la INSERT en `ninos-fotos` exige consent del niño ([2]=ninoId). Se
--    reconstruyen las 2 policies de escritura (admin F10-0 sobre [1]=centro, tutor F10-3
--    sobre [2]=niño) AÑADIENDO el gate; el resto del predicado (bucket + rol/tutela) es
--    idéntico. Sin consent el blob no llega a Storage → no quedan huérfanos.
DROP POLICY IF EXISTS ninos_fotos_insert ON storage.objects;
CREATE POLICY ninos_fotos_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ninos-fotos'
    AND public.es_admin(((storage.foldername(name))[1])::uuid)
    AND public.nino_puede_aparecer(((storage.foldername(name))[2])::uuid)
  );

DROP POLICY IF EXISTS ninos_fotos_insert_tutor ON storage.objects;
CREATE POLICY ninos_fotos_insert_tutor ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ninos-fotos'
    AND public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid)
    AND public.nino_puede_aparecer(((storage.foldername(name))[2])::uuid)
  );

COMMIT;
