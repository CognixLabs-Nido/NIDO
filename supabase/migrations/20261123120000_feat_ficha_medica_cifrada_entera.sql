-- =============================================================================
-- FEAT — La ficha médica, cifrada entera: los seis campos con pgcrypto
-- -----------------------------------------------------------------------------
-- Hasta ahora solo `alergias_graves` y `notas_emergencia` iban cifradas (ADR-0004). Los otros
-- cuatro (`medicacion_habitual`, `alergias_leves`, `medico_familia`, `telefono_emergencia`) eran
-- texto: se leían tal cual con la sesión y `audit_trigger_function`, que guarda la fila entera, los
-- copiaba en claro en `audit_log`. Decisión del responsable (F11-B, punto 3): los seis, igual.
--
--   · Las cuatro columnas pasan a `bytea` cifrando lo que haya (en producción, a 2026-10-26, las
--     tres fichas las tienen a NULL; el cambio de tipo cifra igual si hubiera texto).
--   · Vacío = NULL, en los seis: las listas del aula pintan «Alergia grave» y «Medicación» si la
--     columna no es NULL, sin descifrar. Un texto vacío cifrado no es NULL y pintaría el aviso.
--     Los setters guardan NULL para '' (o solo espacios), y los cifrados vacíos que hubiera
--     pasan a NULL.
--   · `set_info_medica_emergencia_cifrada` y `..._tutor` cifran los seis; el contrato no cambia:
--     NULL = preservar (salvo `p_reemplazar`, que escribe tal cual). '' = vaciar el campo, como
--     antes (antes guardaba '', ahora NULL).
--   · `get_info_medica_emergencia` descifra los seis.
--   · `audit_log`: las copias anteriores de esta tabla con alguno de los cuatro campos en claro se
--     cifran igual que las nuevas (una cadena vacía, a null). La purga del niño ya redacta esas
--     claves (`_claves_pii_nino`).
--
-- Operación sobre datos productivos → la aplica el responsable por SQL Editor, DESPUÉS de
-- `20261122120000`. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_n integer;
BEGIN
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'info_medica_emergencia'
         AND column_name = 'medicacion_habitual') <> 'text' THEN
    RAISE EXCEPTION 'ya aplicada: medicacion_habitual no es text';
  END IF;
  -- Las tres funciones que se reescriben tienen que ser las leídas en producción
  -- (md5 normalizado: sin \r, sin comentarios, espacios colapsados).
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.set_info_medica_emergencia_cifrada(uuid,text,text,text,text,text,text)');
  IF v_md5 IS DISTINCT FROM '6d048ce965fecd17ccb3a00fd9228e8b' THEN
    RAISE EXCEPTION 'set_info_medica_emergencia_cifrada no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.set_info_medica_emergencia_cifrada_tutor(uuid,text,text,text,text,text,text,boolean)');
  IF v_md5 IS DISTINCT FROM 'fc79dc7e972c48a653ac7f9170b23944' THEN
    RAISE EXCEPTION 'set_info_medica_emergencia_cifrada_tutor no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.get_info_medica_emergencia(uuid)');
  IF v_md5 IS DISTINCT FROM '1cb99fa2f3ef859eef7e9efe63af6ca4' THEN
    RAISE EXCEPTION 'get_info_medica_emergencia no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;

  SELECT count(*) INTO v_n FROM public.info_medica_emergencia
   WHERE medicacion_habitual IS NOT NULL OR alergias_leves IS NOT NULL
      OR medico_familia IS NOT NULL OR telefono_emergencia IS NOT NULL;
  RAISE NOTICE 'guarda previa: % fichas con alguno de los cuatro campos en claro', v_n;
END
$guarda$;

-- ---- Las cuatro columnas, a bytea cifrado ----
-- La clave solo se pide si hay filas: con la tabla vacía (la BD efímera del CI) la expresión
-- no se evalúa.
ALTER TABLE public.info_medica_emergencia
  ALTER COLUMN medicacion_habitual TYPE bytea USING
    CASE WHEN medicacion_habitual IS NULL OR btrim(medicacion_habitual) = '' THEN NULL
         ELSE extensions.pgp_sym_encrypt(medicacion_habitual, public._get_medical_key()) END,
  ALTER COLUMN alergias_leves TYPE bytea USING
    CASE WHEN alergias_leves IS NULL OR btrim(alergias_leves) = '' THEN NULL
         ELSE extensions.pgp_sym_encrypt(alergias_leves, public._get_medical_key()) END,
  ALTER COLUMN medico_familia TYPE bytea USING
    CASE WHEN medico_familia IS NULL OR btrim(medico_familia) = '' THEN NULL
         ELSE extensions.pgp_sym_encrypt(medico_familia, public._get_medical_key()) END,
  ALTER COLUMN telefono_emergencia TYPE bytea USING
    CASE WHEN telefono_emergencia IS NULL OR btrim(telefono_emergencia) = '' THEN NULL
         ELSE extensions.pgp_sym_encrypt(telefono_emergencia, public._get_medical_key()) END;

-- ---- Vacío = NULL en las dos que ya iban cifradas ----
DO $vacios$
DECLARE
  v_clave text;
  v_n integer := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM public.info_medica_emergencia
              WHERE alergias_graves IS NOT NULL OR notas_emergencia IS NOT NULL) THEN
    v_clave := public._get_medical_key();
    PERFORM set_config('app.audit_actor', 'system:migracion_ficha_medica_cifrada', true);
    UPDATE public.info_medica_emergencia SET
      alergias_graves  = CASE WHEN alergias_graves IS NOT NULL
                               AND btrim(extensions.pgp_sym_decrypt(alergias_graves, v_clave)) = ''
                              THEN NULL ELSE alergias_graves END,
      notas_emergencia = CASE WHEN notas_emergencia IS NOT NULL
                               AND btrim(extensions.pgp_sym_decrypt(notas_emergencia, v_clave)) = ''
                              THEN NULL ELSE notas_emergencia END
    WHERE (alergias_graves IS NOT NULL AND btrim(extensions.pgp_sym_decrypt(alergias_graves, v_clave)) = '')
       OR (notas_emergencia IS NOT NULL AND btrim(extensions.pgp_sym_decrypt(notas_emergencia, v_clave)) = '');
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;
  RAISE NOTICE 'fichas con un cifrado vacío pasado a NULL: %', v_n;
END
$vacios$;

-- ---- audit_log: las copias anteriores, cifradas como las nuevas ----
-- `audit_trigger_function` guarda la fila con to_jsonb: un bytea sale como cadena '\x…'. Una
-- cadena que no empieza por '\x' es texto en claro de antes de esta migración.
DO $auditoria$
DECLARE
  v_clave text;
  v_claves text[] := ARRAY['medicacion_habitual', 'alergias_leves', 'medico_familia', 'telefono_emergencia'];
  v_k text;
  v_n integer;
  v_total integer := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.audit_log a, unnest(v_claves) k
     WHERE a.tabla = 'info_medica_emergencia'
       AND ((jsonb_typeof(a.valores_antes -> k) = 'string' AND left(a.valores_antes ->> k, 2) <> '\x')
         OR (jsonb_typeof(a.valores_despues -> k) = 'string' AND left(a.valores_despues ->> k, 2) <> '\x'))
  ) THEN
    v_clave := public._get_medical_key();
    FOREACH v_k IN ARRAY v_claves LOOP
      UPDATE public.audit_log SET
        valores_antes = CASE
          WHEN jsonb_typeof(valores_antes -> v_k) = 'string' AND left(valores_antes ->> v_k, 2) <> '\x'
          THEN jsonb_set(valores_antes, ARRAY[v_k],
                 CASE WHEN btrim(valores_antes ->> v_k) = '' THEN 'null'::jsonb
                      ELSE to_jsonb(extensions.pgp_sym_encrypt(valores_antes ->> v_k, v_clave)) END)
          ELSE valores_antes END,
        valores_despues = CASE
          WHEN jsonb_typeof(valores_despues -> v_k) = 'string' AND left(valores_despues ->> v_k, 2) <> '\x'
          THEN jsonb_set(valores_despues, ARRAY[v_k],
                 CASE WHEN btrim(valores_despues ->> v_k) = '' THEN 'null'::jsonb
                      ELSE to_jsonb(extensions.pgp_sym_encrypt(valores_despues ->> v_k, v_clave)) END)
          ELSE valores_despues END
      WHERE tabla = 'info_medica_emergencia'
        AND ((jsonb_typeof(valores_antes -> v_k) = 'string' AND left(valores_antes ->> v_k, 2) <> '\x')
          OR (jsonb_typeof(valores_despues -> v_k) = 'string' AND left(valores_despues ->> v_k, 2) <> '\x'));
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_total := v_total + v_n;
    END LOOP;
  END IF;
  RAISE NOTICE 'campos en claro cifrados en audit_log (filas por campo): %', v_total;
END
$auditoria$;

-- ---- El setter de Dirección: cifra los seis ----
CREATE OR REPLACE FUNCTION public.set_info_medica_emergencia_cifrada(p_nino_id uuid, p_alergias_graves text, p_notas_emergencia text, p_medicacion_habitual text, p_alergias_leves text, p_medico_familia text, p_telefono_emergencia text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clave text := public._get_medical_key();
  v_centro_del_nino uuid;
  v_id uuid;
BEGIN
  SELECT centro_id INTO v_centro_del_nino FROM public.ninos WHERE id = p_nino_id;
  IF v_centro_del_nino IS NULL THEN
    RAISE EXCEPTION 'Niño no encontrado: %', p_nino_id;
  END IF;
  IF NOT public.es_admin(v_centro_del_nino) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- Los seis cifrados. Vacío (o solo espacios) = NULL: las listas del aula pintan el aviso si
  -- la columna no es NULL.
  INSERT INTO public.info_medica_emergencia (
    nino_id, alergias_graves, notas_emergencia,
    medicacion_habitual, alergias_leves, medico_familia, telefono_emergencia
  ) VALUES (
    p_nino_id,
    CASE WHEN p_alergias_graves     IS NULL OR btrim(p_alergias_graves)     = '' THEN NULL ELSE pgp_sym_encrypt(p_alergias_graves,     v_clave) END,
    CASE WHEN p_notas_emergencia    IS NULL OR btrim(p_notas_emergencia)    = '' THEN NULL ELSE pgp_sym_encrypt(p_notas_emergencia,    v_clave) END,
    CASE WHEN p_medicacion_habitual IS NULL OR btrim(p_medicacion_habitual) = '' THEN NULL ELSE pgp_sym_encrypt(p_medicacion_habitual, v_clave) END,
    CASE WHEN p_alergias_leves      IS NULL OR btrim(p_alergias_leves)      = '' THEN NULL ELSE pgp_sym_encrypt(p_alergias_leves,      v_clave) END,
    CASE WHEN p_medico_familia      IS NULL OR btrim(p_medico_familia)      = '' THEN NULL ELSE pgp_sym_encrypt(p_medico_familia,      v_clave) END,
    CASE WHEN p_telefono_emergencia IS NULL OR btrim(p_telefono_emergencia) = '' THEN NULL ELSE pgp_sym_encrypt(p_telefono_emergencia, v_clave) END
  )
  ON CONFLICT (nino_id) DO UPDATE SET
    -- Parámetro NULL = "no tocar" → se preserva el valor existente. '' vacía el campo (NULL).
    alergias_graves      = CASE WHEN p_alergias_graves     IS NULL THEN public.info_medica_emergencia.alergias_graves     ELSE EXCLUDED.alergias_graves     END,
    notas_emergencia     = CASE WHEN p_notas_emergencia    IS NULL THEN public.info_medica_emergencia.notas_emergencia    ELSE EXCLUDED.notas_emergencia    END,
    medicacion_habitual  = CASE WHEN p_medicacion_habitual IS NULL THEN public.info_medica_emergencia.medicacion_habitual ELSE EXCLUDED.medicacion_habitual END,
    alergias_leves       = CASE WHEN p_alergias_leves      IS NULL THEN public.info_medica_emergencia.alergias_leves      ELSE EXCLUDED.alergias_leves      END,
    medico_familia       = CASE WHEN p_medico_familia      IS NULL THEN public.info_medica_emergencia.medico_familia      ELSE EXCLUDED.medico_familia      END,
    telefono_emergencia  = CASE WHEN p_telefono_emergencia IS NULL THEN public.info_medica_emergencia.telefono_emergencia ELSE EXCLUDED.telefono_emergencia END,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- ---- El setter de la familia (y de Dirección desde la ficha): cifra los seis ----
CREATE OR REPLACE FUNCTION public.set_info_medica_emergencia_cifrada_tutor(p_nino_id uuid, p_alergias_graves text, p_notas_emergencia text, p_medicacion_habitual text, p_alergias_leves text, p_medico_familia text, p_telefono_emergencia text, p_reemplazar boolean DEFAULT false)
 RETURNS uuid
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
  IF NOT (public.es_admin(privado.centro_de_nino(p_nino_id))
          OR public.es_tutor_legal_de(p_nino_id)) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_clave := public._get_medical_key();

  -- Los seis cifrados. Vacío (o solo espacios) = NULL: las listas del aula pintan el aviso si
  -- la columna no es NULL.
  INSERT INTO public.info_medica_emergencia (
    nino_id, alergias_graves, notas_emergencia,
    medicacion_habitual, alergias_leves, medico_familia, telefono_emergencia
  ) VALUES (
    p_nino_id,
    CASE WHEN p_alergias_graves     IS NULL OR btrim(p_alergias_graves)     = '' THEN NULL ELSE pgp_sym_encrypt(p_alergias_graves,     v_clave) END,
    CASE WHEN p_notas_emergencia    IS NULL OR btrim(p_notas_emergencia)    = '' THEN NULL ELSE pgp_sym_encrypt(p_notas_emergencia,    v_clave) END,
    CASE WHEN p_medicacion_habitual IS NULL OR btrim(p_medicacion_habitual) = '' THEN NULL ELSE pgp_sym_encrypt(p_medicacion_habitual, v_clave) END,
    CASE WHEN p_alergias_leves      IS NULL OR btrim(p_alergias_leves)      = '' THEN NULL ELSE pgp_sym_encrypt(p_alergias_leves,      v_clave) END,
    CASE WHEN p_medico_familia      IS NULL OR btrim(p_medico_familia)      = '' THEN NULL ELSE pgp_sym_encrypt(p_medico_familia,      v_clave) END,
    CASE WHEN p_telefono_emergencia IS NULL OR btrim(p_telefono_emergencia) = '' THEN NULL ELSE pgp_sym_encrypt(p_telefono_emergencia, v_clave) END
  )
  ON CONFLICT (nino_id) DO UPDATE SET
    -- MERGE (default): parámetro NULL = "no tocar" → se preserva; '' vacía el campo (NULL).
    -- REPLACE (p_reemplazar): escribe EXCLUDED.* verbatim → NULL LIMPIA.
    alergias_graves     = CASE WHEN p_reemplazar OR p_alergias_graves     IS NOT NULL THEN EXCLUDED.alergias_graves
                               ELSE public.info_medica_emergencia.alergias_graves END,
    notas_emergencia    = CASE WHEN p_reemplazar OR p_notas_emergencia    IS NOT NULL THEN EXCLUDED.notas_emergencia
                               ELSE public.info_medica_emergencia.notas_emergencia END,
    medicacion_habitual = CASE WHEN p_reemplazar OR p_medicacion_habitual IS NOT NULL THEN EXCLUDED.medicacion_habitual
                               ELSE public.info_medica_emergencia.medicacion_habitual END,
    alergias_leves      = CASE WHEN p_reemplazar OR p_alergias_leves      IS NOT NULL THEN EXCLUDED.alergias_leves
                               ELSE public.info_medica_emergencia.alergias_leves END,
    medico_familia      = CASE WHEN p_reemplazar OR p_medico_familia      IS NOT NULL THEN EXCLUDED.medico_familia
                               ELSE public.info_medica_emergencia.medico_familia END,
    telefono_emergencia = CASE WHEN p_reemplazar OR p_telefono_emergencia IS NOT NULL THEN EXCLUDED.telefono_emergencia
                               ELSE public.info_medica_emergencia.telefono_emergencia END,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- ---- La lectura: descifra los seis ----
CREATE OR REPLACE FUNCTION public.get_info_medica_emergencia(p_nino_id uuid)
 RETURNS TABLE(alergias_graves text, notas_emergencia text, medicacion_habitual text, alergias_leves text, medico_familia text, telefono_emergencia text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clave text := public._get_medical_key();
  v_centro_del_nino uuid;
  v_autorizado boolean := false;
BEGIN
  SELECT centro_id INTO v_centro_del_nino FROM public.ninos WHERE id = p_nino_id;
  IF v_centro_del_nino IS NULL THEN
    RAISE EXCEPTION 'Niño no encontrado: %', p_nino_id;
  END IF;

  IF public.es_admin(v_centro_del_nino) THEN
    v_autorizado := true;
  ELSIF EXISTS (
    SELECT 1 FROM public.matriculas m
    WHERE m.nino_id = p_nino_id
      AND m.fecha_baja IS NULL AND m.deleted_at IS NULL AND m.estado = 'activa'
      AND public.es_profe_de_aula(m.aula_id)
  ) THEN
    v_autorizado := true;
  ELSIF public.tiene_permiso_sobre(p_nino_id, 'puede_ver_info_medica') THEN
    v_autorizado := true;
  END IF;

  IF NOT v_autorizado THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  RETURN QUERY
  SELECT
    CASE WHEN ime.alergias_graves     IS NULL THEN NULL ELSE pgp_sym_decrypt(ime.alergias_graves,     v_clave) END,
    CASE WHEN ime.notas_emergencia    IS NULL THEN NULL ELSE pgp_sym_decrypt(ime.notas_emergencia,    v_clave) END,
    CASE WHEN ime.medicacion_habitual IS NULL THEN NULL ELSE pgp_sym_decrypt(ime.medicacion_habitual, v_clave) END,
    CASE WHEN ime.alergias_leves      IS NULL THEN NULL ELSE pgp_sym_decrypt(ime.alergias_leves,      v_clave) END,
    CASE WHEN ime.medico_familia      IS NULL THEN NULL ELSE pgp_sym_decrypt(ime.medico_familia,      v_clave) END,
    CASE WHEN ime.telefono_emergencia IS NULL THEN NULL ELSE pgp_sym_decrypt(ime.telefono_emergencia, v_clave) END
  FROM public.info_medica_emergencia ime
  WHERE ime.nino_id = p_nino_id;
END;
$function$;

COMMENT ON TABLE public.info_medica_emergencia IS
  'Ficha médica de urgencia del niño. Los seis campos van cifrados con pgcrypto (clave medical_encryption_key en Vault): solo los escriben set_info_medica_emergencia_cifrada(_tutor) y solo los descifra get_info_medica_emergencia. Vacío = NULL (20261123120000).';

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_md5 text;
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'info_medica_emergencia'
     AND column_name IN ('alergias_graves', 'notas_emergencia', 'medicacion_habitual',
                         'alergias_leves', 'medico_familia', 'telefono_emergencia')
     AND data_type = 'bytea';
  IF v_n <> 6 THEN
    RAISE EXCEPTION 'quedan columnas de la ficha médica sin cifrar: % de 6 en bytea', v_n;
  END IF;

  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.set_info_medica_emergencia_cifrada(uuid,text,text,text,text,text,text)');
  IF v_md5 IS DISTINCT FROM 'cd9c990bd9e26b3d10a749fb1647df47' THEN
    RAISE EXCEPTION 'set_info_medica_emergencia_cifrada no quedó como este fichero: %', v_md5;
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.set_info_medica_emergencia_cifrada_tutor(uuid,text,text,text,text,text,text,boolean)');
  IF v_md5 IS DISTINCT FROM '8c967584875287a753765939d7442fa2' THEN
    RAISE EXCEPTION 'set_info_medica_emergencia_cifrada_tutor no quedó como este fichero: %', v_md5;
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.get_info_medica_emergencia(uuid)');
  IF v_md5 IS DISTINCT FROM '688878514101e68eb2e938cef4e37959' THEN
    RAISE EXCEPTION 'get_info_medica_emergencia no quedó como este fichero: %', v_md5;
  END IF;

  SELECT count(*) INTO v_n FROM public.audit_log a,
       unnest(ARRAY['medicacion_habitual', 'alergias_leves', 'medico_familia', 'telefono_emergencia']) k
   WHERE a.tabla = 'info_medica_emergencia'
     AND ((jsonb_typeof(a.valores_antes -> k) = 'string' AND left(a.valores_antes ->> k, 2) <> '\x')
       OR (jsonb_typeof(a.valores_despues -> k) = 'string' AND left(a.valores_despues ->> k, 2) <> '\x'));
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'quedan % campos de la ficha médica en claro en audit_log', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.info_medica_emergencia;
  RAISE NOTICE 'guarda posterior: los seis campos cifrados, ninguno en claro en audit_log; % fichas', v_n;
END
$guarda$;
