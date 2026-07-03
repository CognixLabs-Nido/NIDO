-- =============================================================================
-- F11 alta PR-3b-1 (modo "Completa Dirección") — (5/6) marcar_matricula_lista +es_admin
-- -----------------------------------------------------------------------------
-- Amplía el gate de `marcar_matricula_lista` para que la ADMIN del centro finalice
-- el alta. PARTE DE LA VERSIÓN VIGENTE F11-F (20260620120000), que incluye el
-- BACKSTOP del acuse médico — se CONSERVA verbatim:
--     IF v_pendiente AND NOT tiene_consentimiento(auth.uid(),'datos_medicos') → RAISE.
-- (auth.uid() = quien finaliza: admin o tutor; cada uno debe tener su propio acuse.)
--
-- CAMBIO ÚNICO: el gate `IF NOT es_tutor_legal_de(...)` pasa a
--   `IF NOT (es_admin(centro_de_nino(p_nino_id)) OR es_tutor_legal_de(p_nino_id))`.
-- El UPDATE y sus guardas (apellidos/fecha_nac) quedan IDÉNTICOS. SIN p_usuario_id.
--
-- Camino TUTOR intacto: el tutor sigue pasando por `es_tutor_legal_de` igual.
-- CREATE OR REPLACE de la MISMA firma (1 arg) → sin DROP, no rompe la llamada actual.
--
-- APLICAR POR SQL EDITOR (rol postgres). NO por CLI.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.marcar_matricula_lista(p_nino_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_pendiente boolean;
BEGIN
  -- Gate AMPLIADO: admin del centro del niño O tutor legal (el tutor pasa igual).
  IF NOT (public.es_admin(public.centro_de_nino(p_nino_id))
          OR public.es_tutor_legal_de(p_nino_id)) THEN
    RAISE EXCEPTION 'no autorizado a finalizar el alta de este nino'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.matriculas
     WHERE nino_id = p_nino_id
       AND estado = 'pendiente'
       AND fecha_baja IS NULL
       AND deleted_at IS NULL
  ) INTO v_pendiente;

  -- Acuse de confidencialidad de datos médicos obligatorio para cerrar el alta
  -- (backstop F11-F, CONSERVADO). auth.uid() = quien finaliza (admin o tutor).
  IF v_pendiente AND NOT public.tiene_consentimiento(auth.uid(), 'datos_medicos') THEN
    RAISE EXCEPTION 'falta el acuse de confidencialidad de datos medicos'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.matriculas
     SET estado = 'lista'
   WHERE nino_id = p_nino_id
     AND estado = 'pendiente'
     AND fecha_baja IS NULL
     AND deleted_at IS NULL
     AND EXISTS (
       SELECT 1 FROM public.ninos n
        WHERE n.id = p_nino_id
          AND n.apellidos IS NOT NULL
          AND n.fecha_nacimiento IS NOT NULL
     )
   RETURNING id INTO v_id;

  RETURN v_id;
END $function$;

GRANT EXECUTE ON FUNCTION public.marcar_matricula_lista(uuid) TO authenticated;
