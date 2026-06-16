-- F11 Alta tutor-driven — Pieza 3a: backend de escritura del tutor (sin UI).
--
-- Alcance (DEC-3a, 2026-06-16): médico + pedagógico + identidad del niño + bucket
-- cartilla, todo gateado. NO incluye el valor de ENUM 'lista' ni el guard de
-- activarMatricula (van en 3c, máquina de estados), ni la instanciación lazy de la
-- autorización de imagen (3b). No-op hasta que el wizard (3b) lo cablee.

-- ---------------------------------------------------------------------------
-- 1) Columna cartilla en info médica (1 cartilla por niño).
-- ---------------------------------------------------------------------------
ALTER TABLE public.info_medica_emergencia
  ADD COLUMN IF NOT EXISTS cartilla_vacunas_path text NULL;

-- ---------------------------------------------------------------------------
-- 2) Helper tiene_consentimiento — ¿hay consentimiento vigente (sin revocar)
--    para (usuario, tipo)? `registrar` solo inserta y `revocar` marca la última
--    fila vigente; en el flujo normal (la action evita doble-grant) EXISTS de una
--    fila con revocado_en IS NULL = "consentimiento vigente". Lee `consentimientos`
--    (tabla distinta de las que se insertan en el flujo) → sin gotcha MVCC.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tiene_consentimiento(
  p_usuario_id uuid,
  p_tipo public.consentimiento_tipo
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.consentimientos
    WHERE usuario_id = p_usuario_id
      AND tipo = p_tipo
      AND revocado_en IS NULL
  );
$$;
GRANT EXECUTE ON FUNCTION public.tiene_consentimiento(uuid, public.consentimiento_tipo)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) RPC de escritura médica del TUTOR (la pieza más sensible).
--    Copia del cuerpo de set_info_medica_emergencia_cifrada cambiando SOLO el gate
--    (es_admin → es_tutor_de + tiene_consentimiento) y añadiendo el 7.º parámetro
--    cartilla_vacunas_path. Cifrado Vault sin exponer la clave; contrato
--    NULL = preservar (COALESCE), ADR-0004. El gate corre ANTES de leer la clave.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_info_medica_emergencia_cifrada_tutor(
  p_nino_id uuid,
  p_alergias_graves text,
  p_notas_emergencia text,
  p_medicacion_habitual text,
  p_alergias_leves text,
  p_medico_familia text,
  p_telefono_emergencia text,
  p_cartilla_vacunas_path text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clave text;
  v_id uuid;
BEGIN
  -- Gate: tutor del niño + consentimiento de datos de salud vigente.
  IF NOT public.es_tutor_de(p_nino_id) THEN
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
GRANT EXECUTE ON FUNCTION public.set_info_medica_emergencia_cifrada_tutor(
  uuid, text, text, text, text, text, text, text
) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) RPC de escritura de IDENTIDAD del niño por el tutor (whitelist de columnas).
--    RLS no acota por columna y `ninos` tiene columnas admin-only (aula via
--    matrícula, centro, flags, notas_admin) → RPC obligatoria. Solo las 5 de
--    identidad; contrato NULL = preservar. NO valida cohorte (aviso UI en 3b).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.actualizar_identidad_nino_tutor(
  p_nino_id uuid,
  p_apellidos text,
  p_fecha_nacimiento date,
  p_sexo public.nino_sexo,
  p_nacionalidad text,
  p_idioma_principal text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.es_tutor_de(p_nino_id) THEN
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
GRANT EXECUTE ON FUNCTION public.actualizar_identidad_nino_tutor(
  uuid, text, date, public.nino_sexo, text, text
) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) RLS datos_pedagogicos_nino: abrir INSERT/UPDATE al tutor (DEC-D).
--    Todas las columnas son dato de familia (sin admin-only) → sin RPC; se reusa
--    upsertDatosPedagogicos. Predicado es_tutor_de (no puede_ver_datos_pedagogicos,
--    que es gate de LECTURA). dp_admin_all (ALL) y los SELECT existentes intactos.
-- ---------------------------------------------------------------------------
CREATE POLICY dp_tutor_insert ON public.datos_pedagogicos_nino
  FOR INSERT TO authenticated
  WITH CHECK (public.es_tutor_de(nino_id));

CREATE POLICY dp_tutor_update ON public.datos_pedagogicos_nino
  FOR UPDATE TO authenticated
  USING (public.es_tutor_de(nino_id))
  WITH CHECK (public.es_tutor_de(nino_id));

-- ---------------------------------------------------------------------------
-- 6) Bucket privado cartilla-vacunas + políticas storage.objects (patrón F10-3).
--    Ruta {centroId}/{ninoId}/…  →  [1]=centroId, [2]=ninoId.
--    INSERT del tutor GATEADO TAMBIÉN por consentimiento (DEC-3a-1): ni el fichero
--    se sube sin datos_medicos vigente (evita huérfanos de dato de salud).
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('cartilla-vacunas', 'cartilla-vacunas', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY cartilla_tutor_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cartilla-vacunas'
    AND public.es_tutor_de(((storage.foldername(name))[2])::uuid)
    AND public.tiene_consentimiento(auth.uid(), 'datos_medicos')
  );

CREATE POLICY cartilla_tutor_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'cartilla-vacunas'
    AND public.es_tutor_de(((storage.foldername(name))[2])::uuid)
  );

CREATE POLICY cartilla_tutor_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'cartilla-vacunas'
    AND public.es_tutor_de(((storage.foldername(name))[2])::uuid)
  );

CREATE POLICY cartilla_staff_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'cartilla-vacunas'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR public.es_profe_en_centro(((storage.foldername(name))[1])::uuid)
    )
  );
