-- =============================================================================
-- Fase 11-F — Teardown cartilla + info médica voluntaria + acuse de
-- confidencialidad de datos médicos.
--
-- 1) RPC médica (set_info_medica_emergencia_cifrada_tutor): aridad 8→7 (fuera el
--    parámetro p_cartilla_vacunas_path) y se DES-GATEA: pierde el check
--    tiene_consentimiento('datos_medicos'); conserva SOLO es_tutor_legal_de.
--    La info médica pasa a VOLUNTARIA.
-- 2) marcar_matricula_lista: backstop del ACUSE de confidencialidad (datos_medicos)
--    para cerrar el alta, espejo del backstop de identidad; resto verbatim.
-- 3) Cartilla: se elimina por completo (columna + 4 policies por SQL; los 6
--    objetos del bucket y el bucket mismo se eliminan por Storage API, porque
--    storage.protect_delete() prohíbe el DELETE directo de storage.objects/buckets).
--
-- NO toca el ENUM consentimiento_tipo ni la tabla consentimientos: el acuse reusa
-- el tipo 'datos_medicos' con versión nueva (v2.0, en el código); las filas v1.0
-- quedan (Decisión A). Tampoco toca firmas_autorizacion.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) RPC médica: DROP de la 8-aria y CREATE de la 7-aria sin cartilla y sin gate
--    de consentimiento. Se recrea ANTES del DROP COLUMN para que en ningún
--    instante una función viva referencie la columna eliminada.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.set_info_medica_emergencia_cifrada_tutor(
  uuid, text, text, text, text, text, text, text
);

CREATE FUNCTION public.set_info_medica_emergencia_cifrada_tutor(
  p_nino_id uuid,
  p_alergias_graves text,
  p_notas_emergencia text,
  p_medicacion_habitual text,
  p_alergias_leves text,
  p_medico_familia text,
  p_telefono_emergencia text
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
  -- (marcar_matricula_lista), no aquí.
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
    -- NULL en EXCLUDED.* significa "no tocar" → COALESCE preserva el valor existente.
    alergias_graves     = COALESCE(EXCLUDED.alergias_graves,     public.info_medica_emergencia.alergias_graves),
    notas_emergencia    = COALESCE(EXCLUDED.notas_emergencia,    public.info_medica_emergencia.notas_emergencia),
    medicacion_habitual = COALESCE(EXCLUDED.medicacion_habitual, public.info_medica_emergencia.medicacion_habitual),
    alergias_leves      = COALESCE(EXCLUDED.alergias_leves,      public.info_medica_emergencia.alergias_leves),
    medico_familia      = COALESCE(EXCLUDED.medico_familia,      public.info_medica_emergencia.medico_familia),
    telefono_emergencia = COALESCE(EXCLUDED.telefono_emergencia, public.info_medica_emergencia.telefono_emergencia),
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_info_medica_emergencia_cifrada_tutor(
  uuid, text, text, text, text, text, text
) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2) marcar_matricula_lista: + backstop del acuse de confidencialidad.
--    Espejo del backstop de identidad, PERO con RAISE (no condición en el WHERE):
--    finalizarAlta trata el NULL del UPDATE como idempotente-éxito, así que meter
--    el acuse en el WHERE dejaría la matrícula 'pendiente' reportando éxito. El
--    RAISE lo bloquea visiblemente (42501). Se exige SOLO si hay una transición
--    real pendiente→lista, para no romper el re-finalizar idempotente de altas ya
--    'lista'/'activa' (que pudieron cerrarse antes de existir el acuse). Resto
--    verbatim respecto a la definición viva.
-- -----------------------------------------------------------------------------
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
  IF NOT public.es_tutor_legal_de(p_nino_id) THEN
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

  -- Acuse de confidencialidad de datos médicos obligatorio para cerrar el alta.
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

-- -----------------------------------------------------------------------------
-- 3) Cartilla — teardown DDL. La columna ya no la referencia ninguna función
--    (la RPC médica se recreó sin ella); el trigger de audit es genérico
--    (to_jsonb), deja de capturarla sola.
-- -----------------------------------------------------------------------------
ALTER TABLE public.info_medica_emergencia
  DROP COLUMN IF EXISTS cartilla_vacunas_path;

DROP POLICY IF EXISTS cartilla_tutor_insert ON storage.objects;
DROP POLICY IF EXISTS cartilla_tutor_select ON storage.objects;
DROP POLICY IF EXISTS cartilla_tutor_delete ON storage.objects;
DROP POLICY IF EXISTS cartilla_staff_select ON storage.objects;

-- El bucket 'cartilla-vacunas' se elimina por Storage API (DELETE /storage/v1/bucket/
-- cartilla-vacunas, ya vacío); storage.protect_delete() prohíbe borrarlo por SQL.

COMMIT;
