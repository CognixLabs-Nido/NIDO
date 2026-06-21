-- =============================================================================
-- Fase 11-F3 — Edición a nivel de campo de la info médica del tutor (post-alta).
--
-- Añade un parámetro explícito `p_reemplazar boolean DEFAULT false` a la RPC
-- `set_info_medica_emergencia_cifrada_tutor` para desacoplar dos semánticas que
-- antes se multiplexaban en una sola (NULL=preservar):
--
--   * p_reemplazar = false (DEFAULT, MERGE) — comportamiento de F11-F intacto: el
--     wizard de alta llama SIN el flag, así que NULL en un campo PRESERVA el valor
--     existente (COALESCE). Su llenado incremental no se rompe.
--   * p_reemplazar = true (REPLACE) — "lo que se ve es lo que se guarda": cada
--     campo se escribe VERBATIM; un campo a NULL LIMPIA el valor existente. La UI
--     de edición post-alta (ficha /family/nino/[id]) usa este modo y normaliza el
--     string vacío del form a NULL antes de llamar.
--
-- DROP + CREATE (no CREATE OR REPLACE) porque cambia la aridad (7→8); el DEFAULT
-- mantiene compatible la llamada de 7 args del wizard. Mismo patrón que F11-F.
-- Gate intacto: SOLO es_tutor_legal_de. Sigue VOLUNTARIA (sin gate de
-- consentimiento). NO toca esquema, datos, ni la RPC admin homónima.
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.set_info_medica_emergencia_cifrada_tutor(
  uuid, text, text, text, text, text, text
);

CREATE FUNCTION public.set_info_medica_emergencia_cifrada_tutor(
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
  -- Gate: tutor LEGAL del niño. F11-F: la info médica es VOLUNTARIA → sin gate de
  -- consentimiento; el acuse de confidencialidad se exige al cerrar el alta
  -- (marcar_matricula_lista), no aquí ni al editar.
  IF NOT public.es_tutor_legal_de(p_nino_id) THEN
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

COMMIT;
