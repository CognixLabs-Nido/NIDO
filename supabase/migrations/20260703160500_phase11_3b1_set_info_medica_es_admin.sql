-- =============================================================================
-- F11 alta PR-3b-1 (modo "Completa Dirección") — (6/6) set_info_medica +es_admin
-- -----------------------------------------------------------------------------
-- El paso médico del wizard guarda info médica CIFRADA (clave del Vault dentro del
-- DEFINER) vía `set_info_medica_emergencia_cifrada_tutor`, hoy gated solo a tutor.
-- Amplía el gate para que la ADMIN del centro la registre (con los datos que tiene
-- EN PAPEL). El cifrado y TODO el cuerpo quedan IDÉNTICOS; solo cambia el gate.
--
-- PARTE DE LA VERSIÓN VIGENTE F3 (20260621120000, 8 args con `p_reemplazar`).
-- CAMBIO ÚNICO: `IF NOT es_tutor_legal_de(...)` pasa a
--   `IF NOT (es_admin(centro_de_nino(p_nino_id)) OR es_tutor_legal_de(p_nino_id))`.
--
-- Camino TUTOR intacto: el tutor sigue pasando por `es_tutor_legal_de` igual.
-- CREATE OR REPLACE de la MISMA firma (8 args) → sin DROP, no rompe la llamada actual.
--
-- APLICAR POR SQL EDITOR (rol postgres). NO por CLI.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_info_medica_emergencia_cifrada_tutor(
  p_nino_id uuid,
  p_alergias_graves text,
  p_notas_emergencia text,
  p_medicacion_habitual text,
  p_alergias_leves text,
  p_medico_familia text,
  p_telefono_emergencia text,
  p_reemplazar boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clave text;
  v_id uuid;
BEGIN
  -- Gate AMPLIADO: admin del centro del niño O tutor legal (el tutor pasa igual).
  -- F11-F: la info médica es VOLUNTARIA → sin gate de consentimiento; el acuse de
  -- confidencialidad se exige al cerrar el alta (marcar_matricula_lista), no aquí.
  IF NOT (public.es_admin(public.centro_de_nino(p_nino_id))
          OR public.es_tutor_legal_de(p_nino_id)) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_clave := public._get_medical_key();

  INSERT INTO public.info_medica_emergencia (
    nino_id, alergias_graves, notas_emergencia,
    medicacion_habitual, alergias_leves, medico_familia, telefono_emergencia
  ) VALUES (
    p_nino_id,
    CASE WHEN p_alergias_graves  IS NULL THEN NULL ELSE pgp_sym_encrypt(p_alergias_graves,  v_clave) END,
    CASE WHEN p_notas_emergencia IS NULL THEN NULL ELSE pgp_sym_encrypt(p_notas_emergencia, v_clave) END,
    p_medicacion_habitual, p_alergias_leves, p_medico_familia, p_telefono_emergencia
  )
  ON CONFLICT (nino_id) DO UPDATE SET
    -- MERGE (default): NULL en EXCLUDED.* = "no tocar" → COALESCE preserva.
    -- REPLACE (p_reemplazar): escribe EXCLUDED.* verbatim → NULL LIMPIA.
    alergias_graves     = CASE WHEN p_reemplazar THEN EXCLUDED.alergias_graves
                               ELSE COALESCE(EXCLUDED.alergias_graves,     public.info_medica_emergencia.alergias_graves) END,
    notas_emergencia    = CASE WHEN p_reemplazar THEN EXCLUDED.notas_emergencia
                               ELSE COALESCE(EXCLUDED.notas_emergencia,    public.info_medica_emergencia.notas_emergencia) END,
    medicacion_habitual = CASE WHEN p_reemplazar THEN EXCLUDED.medicacion_habitual
                               ELSE COALESCE(EXCLUDED.medicacion_habitual, public.info_medica_emergencia.medicacion_habitual) END,
    alergias_leves      = CASE WHEN p_reemplazar THEN EXCLUDED.alergias_leves
                               ELSE COALESCE(EXCLUDED.alergias_leves,      public.info_medica_emergencia.alergias_leves) END,
    medico_familia      = CASE WHEN p_reemplazar THEN EXCLUDED.medico_familia
                               ELSE COALESCE(EXCLUDED.medico_familia,      public.info_medica_emergencia.medico_familia) END,
    telefono_emergencia = CASE WHEN p_reemplazar THEN EXCLUDED.telefono_emergencia
                               ELSE COALESCE(EXCLUDED.telefono_emergencia, public.info_medica_emergencia.telefono_emergencia) END,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_info_medica_emergencia_cifrada_tutor(
  uuid, text, text, text, text, text, text, boolean
) TO authenticated;
