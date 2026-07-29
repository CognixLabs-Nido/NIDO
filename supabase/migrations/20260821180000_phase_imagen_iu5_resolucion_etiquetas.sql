-- =============================================================================
-- IU-5 · Estado de RESOLUCIÓN por foto×niño en `media_etiquetas` + pantalla de
--        gestión de revocaciones (Dirección).
-- -----------------------------------------------------------------------------
-- Al revocar la imagen de un niño (IU-4) sus publicaciones quedan OCULTAS a las
-- familias (por el flag derivado + RLS), NO borradas (decisión B). Dirección las
-- gestiona a mano, foto por foto, sin plazo. Falta el ESTADO por foto para saber
-- qué queda pendiente de resolver.
--
-- Grano exacto foto×niño = la fila de `media_etiquetas`. Una etiqueta de un niño
-- revocado está PENDIENTE mientras `resuelta_en IS NULL`; Dirección la resuelve
-- (a) borrando la publicación (reusa `eliminarPublicacion`, cascada) o (b) marcándola
-- resuelta/conservada aquí (la ha pixelado/gestionado fuera del sistema).
--
-- No hay borrado ni pixelado automático. La foto sigue oculta a las familias mientras
-- tanto (ya lo hace la RLS por el flag; esto solo registra el estado de gestión).
-- =============================================================================

BEGIN;

-- 1. Estado de resolución por etiqueta (foto×niño). `resuelta_por` con SET NULL para
--    no bloquear el borrado del usuario resolutor; no hay CHECK de coherencia entre
--    ambas por eso (resuelta_por puede quedar NULL tras SET NULL sin des-resolver).
ALTER TABLE public.media_etiquetas
  ADD COLUMN resuelta_en  timestamptz NULL,
  ADD COLUMN resuelta_por uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL;

-- Índice parcial para el listado de pendientes (etiquetas sin resolver por niño).
CREATE INDEX idx_media_etiquetas_pendientes
  ON public.media_etiquetas (nino_id)
  WHERE resuelta_en IS NULL;

-- 2. RPC de resolución — SOLO Dirección (es_admin del centro de la etiqueta). Se hace
--    por RPC SECURITY DEFINER (patrón `archivar_autorizacion`) para NO abrir una policy
--    UPDATE general en `media_etiquetas`: solo toca resuelta_en/resuelta_por. Idempotente
--    (si ya estaba resuelta → 0 filas, sin error). El audit trigger (AFTER UPDATE) la
--    registra. `resuelta_en = now()` server-side (reloj de BD).
CREATE OR REPLACE FUNCTION public.resolver_etiqueta_imagen(p_media_etiqueta_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro uuid;
  v_n int;
BEGIN
  SELECT centro_id INTO v_centro
    FROM public.media_etiquetas
   WHERE id = p_media_etiqueta_id;
  IF v_centro IS NULL THEN
    RETURN 0;  -- etiqueta inexistente (o ya borrada por eliminarPublicacion)
  END IF;

  IF NOT public.es_admin(v_centro) THEN
    RAISE EXCEPTION 'no autorizado a resolver esta etiqueta de imagen'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.media_etiquetas
     SET resuelta_en = now(),
         resuelta_por = auth.uid()
   WHERE id = p_media_etiqueta_id
     AND resuelta_en IS NULL;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.resolver_etiqueta_imagen(uuid) TO authenticated;

COMMIT;
