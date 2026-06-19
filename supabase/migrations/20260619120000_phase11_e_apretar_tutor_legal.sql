-- F11-E — Apretar los writes del alta de tutor de es_tutor_de → es_tutor_legal_de
-- (excluye el vínculo 'autorizado'; rellenar el alta es acto de guardián legal) y
-- mover el UPDATE de ninos.foto_url a una RPC SECURITY DEFINER con gate interno.
--
-- Las definiciones #1/#2 reproducen pg_get_functiondef VERBATIM y las policies su
-- CREATE original VERBATIM; el ÚNICO cambio es el predicado del gate. dp_tutor_select
-- y marcar_matricula_lista ya exigían es_tutor_legal_de — esto cierra la asimetría.
-- F8 (autorizaciones_insert, firmas_autorizacion INSERT) queda como follow-up, NO se toca.

-- =============================================================================
-- 1) RPC médica del tutor — gate es_tutor_de → es_tutor_legal_de (resto verbatim)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_info_medica_emergencia_cifrada_tutor(p_nino_id uuid, p_alergias_graves text, p_notas_emergencia text, p_medicacion_habitual text, p_alergias_leves text, p_medico_familia text, p_telefono_emergencia text, p_cartilla_vacunas_path text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clave text;
  v_id uuid;
BEGIN
  -- Gate: tutor LEGAL del niño + consentimiento de datos de salud vigente.
  IF NOT public.es_tutor_legal_de(p_nino_id) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.tiene_consentimiento(auth.uid(), 'datos_medicos') THEN
    RAISE EXCEPTION 'Sin consentimiento de datos medicos' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_clave := public._get_medical_key();

  INSERT INTO public.info_medica_emergencia (
    nino_id, alergias_graves, notas_emergencia,
    medicacion_habitual, alergias_leves, medico_familia, telefono_emergencia,
    cartilla_vacunas_path
  ) VALUES (
    p_nino_id,
    CASE WHEN p_alergias_graves  IS NULL THEN NULL ELSE pgp_sym_encrypt(p_alergias_graves,  v_clave) END,
    CASE WHEN p_notas_emergencia IS NULL THEN NULL ELSE pgp_sym_encrypt(p_notas_emergencia, v_clave) END,
    p_medicacion_habitual, p_alergias_leves, p_medico_familia, p_telefono_emergencia,
    p_cartilla_vacunas_path
  )
  ON CONFLICT (nino_id) DO UPDATE SET
    -- NULL en EXCLUDED.* significa "no tocar" → COALESCE preserva el valor existente.
    alergias_graves       = COALESCE(EXCLUDED.alergias_graves,       public.info_medica_emergencia.alergias_graves),
    notas_emergencia      = COALESCE(EXCLUDED.notas_emergencia,      public.info_medica_emergencia.notas_emergencia),
    medicacion_habitual   = COALESCE(EXCLUDED.medicacion_habitual,   public.info_medica_emergencia.medicacion_habitual),
    alergias_leves        = COALESCE(EXCLUDED.alergias_leves,        public.info_medica_emergencia.alergias_leves),
    medico_familia        = COALESCE(EXCLUDED.medico_familia,        public.info_medica_emergencia.medico_familia),
    telefono_emergencia   = COALESCE(EXCLUDED.telefono_emergencia,   public.info_medica_emergencia.telefono_emergencia),
    cartilla_vacunas_path = COALESCE(EXCLUDED.cartilla_vacunas_path, public.info_medica_emergencia.cartilla_vacunas_path),
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- =============================================================================
-- 2) RPC identidad del tutor — gate es_tutor_de → es_tutor_legal_de (resto verbatim)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.actualizar_identidad_nino_tutor(p_nino_id uuid, p_apellidos text, p_fecha_nacimiento date, p_sexo nino_sexo, p_nacionalidad text, p_idioma_principal text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.es_tutor_legal_de(p_nino_id) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.ninos SET
    apellidos        = COALESCE(p_apellidos, apellidos),
    fecha_nacimiento = COALESCE(p_fecha_nacimiento, fecha_nacimiento),
    sexo             = COALESCE(p_sexo, sexo),
    nacionalidad     = COALESCE(p_nacionalidad, nacionalidad),
    idioma_principal = COALESCE(p_idioma_principal, idioma_principal)
  WHERE id = p_nino_id
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- =============================================================================
-- 3) RLS datos_pedagogicos_nino — INSERT/UPDATE del tutor a es_tutor_legal_de
--    (DROP+CREATE: no existe CREATE OR REPLACE POLICY; reproduce el CREATE original
--    verbatim cambiando solo el predicado. dp_tutor_select ya es es_tutor_legal_de.)
-- =============================================================================
DROP POLICY IF EXISTS dp_tutor_insert ON public.datos_pedagogicos_nino;
CREATE POLICY dp_tutor_insert ON public.datos_pedagogicos_nino
  FOR INSERT TO authenticated
  WITH CHECK (public.es_tutor_legal_de(nino_id));

DROP POLICY IF EXISTS dp_tutor_update ON public.datos_pedagogicos_nino;
CREATE POLICY dp_tutor_update ON public.datos_pedagogicos_nino
  FOR UPDATE TO authenticated
  USING (public.es_tutor_legal_de(nino_id))
  WITH CHECK (public.es_tutor_legal_de(nino_id));

-- =============================================================================
-- 4) Storage cartilla-vacunas — INSERT/SELECT/DELETE del tutor a es_tutor_legal_de
--    (DROP+CREATE verbatim del original, solo cambia el predicado del gate)
-- =============================================================================
DROP POLICY IF EXISTS cartilla_tutor_insert ON storage.objects;
CREATE POLICY cartilla_tutor_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cartilla-vacunas'
    AND public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid)
    AND public.tiene_consentimiento(auth.uid(), 'datos_medicos')
  );

DROP POLICY IF EXISTS cartilla_tutor_select ON storage.objects;
CREATE POLICY cartilla_tutor_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'cartilla-vacunas'
    AND public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid)
  );

DROP POLICY IF EXISTS cartilla_tutor_delete ON storage.objects;
CREATE POLICY cartilla_tutor_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'cartilla-vacunas'
    AND public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid)
  );

-- =============================================================================
-- 5) Storage ninos-fotos — INSERT del tutor a es_tutor_legal_de (excluye 'autorizado').
--    (DROP+CREATE del original F10-3; solo cambia el predicado del gate. El INSERT de
--    admin lo cubre la policy hermana ninos_fotos_insert (F10-0) → aquí estricto tutor.)
-- =============================================================================
DROP POLICY IF EXISTS "ninos_fotos_insert_tutor" ON storage.objects;
CREATE POLICY "ninos_fotos_insert_tutor" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ninos-fotos'
    AND public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid)
  );

-- =============================================================================
-- 6) RPC foto del niño — el UPDATE de ninos.foto_url pasa de service-role sin gate
--    a SECURITY DEFINER con gate interno. Admite dirección (es_admin del centro) y
--    tutor LEGAL (no 'autorizado'). Backstop: el path debe colgar de
--    {centro_id}/{id}/ del propio niño. Devuelve la foto anterior (NULL si era la
--    primera). 0 filas → check_violation (path/nino inválido) → el route hace
--    rollback del objeto. Espeja marcar_matricula_lista (gate + backstop).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.actualizar_foto_nino_tutor(
  p_nino_id uuid,
  p_foto_path text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_anterior text;
  v_n int;
BEGIN
  IF NOT (public.es_admin(public.centro_de_nino(p_nino_id))
          OR public.es_tutor_legal_de(p_nino_id)) THEN
    RAISE EXCEPTION 'no autorizado a cambiar la foto de este nino'
      USING ERRCODE = 'insufficient_privilege';
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
GRANT EXECUTE ON FUNCTION public.actualizar_foto_nino_tutor(uuid, text) TO authenticated;
