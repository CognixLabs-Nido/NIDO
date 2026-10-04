-- =============================================================================
-- Reparación de 20261005120000 (PR-D, D2) en producción.
--
-- Al aplicar 20261005120000 por el SQL Editor se pegó un SQL distinto del fichero:
-- `actualizar_familia_nino` escribía columnas que no existen en `ninos` (direccion,
-- codigo_postal, municipio, provincia, estado_civil_familiar), devolvía `void` y rechazaba
-- las claves de la app → el guardado de la dirección del asistente de alta fallaba siempre.
-- Las otras tres eran equivalentes pero con otro cuerpo.
--
-- Esta migración recrea las cuatro funciones EXACTAMENTE como en 20261005120000 (bloques
-- copiados del fichero, no retranscritos). `actualizar_familia_nino` se borra antes porque
-- CREATE OR REPLACE no puede cambiar el tipo de retorno (void → uuid).
--
-- Guardas de equivalencia de LÓGICA, no de bytes (el SQL Editor guarda CRLF y a veces se
-- come comentarios): md5 del cuerpo sin \r, sin comentarios `--` y con espacios colapsados.
--   ANTES:   cada función es o el estado roto visto en producción el 2026-10-04, o ya la
--            del repo (la BD efímera del CI, construida desde las migraciones). Cualquier
--            otra cosa aborta sin tocar nada.
--   DESPUÉS: cada función es la del repo, `actualizar_familia_nino` devuelve uuid y el ACL
--            es el de 20261005120000.
-- Los md5 se calcularon con esta misma normalización en Postgres.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
BEGIN
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.actualizar_familia_nino(uuid, jsonb)'::regprocedure), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     NOT IN ('9ec4b292544e6c690dc0755a6d980575', '050d839732e475cfe625dea8a47594ee') THEN
    RAISE EXCEPTION 'D2-reparacion: actualizar_familia_nino no es ni el estado roto visto el 2026-10-04 ni el del repo; revisar antes de aplicar';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.alta_validada_de_nino(uuid)'::regprocedure), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     NOT IN ('b53b3c60f1af5353f14569837f4c080c', '96d5d5cf8c4d0c52529ccf352eb4f693') THEN
    RAISE EXCEPTION 'D2-reparacion: alta_validada_de_nino no es ni el estado roto visto el 2026-10-04 ni el del repo; revisar antes de aplicar';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.fijar_libro_familia_nino(uuid, text)'::regprocedure), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     NOT IN ('339f10ebc2e776abc05d8b6a99af3da3', 'd44c2cc5daaa0cd177ebbb5e0c19ce54') THEN
    RAISE EXCEPTION 'D2-reparacion: fijar_libro_familia_nino no es ni el estado roto visto el 2026-10-04 ni el del repo; revisar antes de aplicar';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.quitar_foto_perfil_nino(uuid)'::regprocedure), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     NOT IN ('c0af1eff2e067f27590ff7ef38576bfd', '3cb4ec827f8a5cec1a3289cd5a273ce5') THEN
    RAISE EXCEPTION 'D2-reparacion: quitar_foto_perfil_nino no es ni el estado roto visto el 2026-10-04 ni el del repo; revisar antes de aplicar';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.alta_validada_de_nino(p_nino_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.matriculas
     WHERE nino_id = p_nino_id
       AND fecha_baja IS NULL
       AND deleted_at IS NULL
       AND estado = 'activa'
  );
$$;

REVOKE ALL ON FUNCTION public.alta_validada_de_nino(uuid) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.actualizar_familia_nino(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.actualizar_familia_nino(p_nino_id uuid, p_patch jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_centro uuid;
  v_admin boolean;
  v_clave text;
BEGIN
  SELECT centro_id INTO v_centro
    FROM public.ninos
   WHERE id = p_nino_id AND deleted_at IS NULL;
  IF v_centro IS NULL THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_admin := public.es_admin(v_centro);
  IF NOT (v_admin OR public.es_tutor_legal_de(p_nino_id)) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'patch invalido' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR v_clave IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_clave NOT IN ('direccion_calle', 'direccion_numero', 'direccion_cp',
                       'direccion_ciudad', 'estado_civil_familia') THEN
      RAISE EXCEPTION 'columna no permitida: %', v_clave USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF jsonb_typeof(p_patch -> v_clave) NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'valor no permitido: %', v_clave USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END LOOP;

  IF p_patch = '{}'::jsonb THEN
    RETURN p_nino_id;
  END IF;

  IF NOT v_admin AND public.alta_validada_de_nino(p_nino_id) THEN
    RAISE EXCEPTION 'alta validada: el cambio va a la cola de validacion'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.ninos SET
    direccion_calle  = CASE WHEN p_patch ? 'direccion_calle'  THEN p_patch ->> 'direccion_calle'  ELSE direccion_calle  END,
    direccion_numero = CASE WHEN p_patch ? 'direccion_numero' THEN p_patch ->> 'direccion_numero' ELSE direccion_numero END,
    direccion_cp     = CASE WHEN p_patch ? 'direccion_cp'     THEN p_patch ->> 'direccion_cp'     ELSE direccion_cp     END,
    direccion_ciudad = CASE WHEN p_patch ? 'direccion_ciudad' THEN p_patch ->> 'direccion_ciudad' ELSE direccion_ciudad END,
    estado_civil_familia = CASE WHEN p_patch ? 'estado_civil_familia'
                                THEN (p_patch ->> 'estado_civil_familia')::public.estado_civil
                                ELSE estado_civil_familia END
  WHERE id = p_nino_id AND deleted_at IS NULL;

  RETURN p_nino_id;
END;
$$;

REVOKE ALL ON FUNCTION public.actualizar_familia_nino(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.actualizar_familia_nino(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.fijar_libro_familia_nino(p_nino_id uuid, p_path text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_centro uuid;
  v_admin boolean;
  v_anterior text;
BEGIN
  SELECT centro_id, libro_familia_path INTO v_centro, v_anterior
    FROM public.ninos
   WHERE id = p_nino_id AND deleted_at IS NULL;
  IF v_centro IS NULL THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_admin := public.es_admin(v_centro);
  IF NOT (v_admin OR public.es_tutor_legal_de(p_nino_id)) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_path IS NULL
     OR p_path !~ ('^' || v_centro::text || '/' || p_nino_id::text || '/[A-Za-z0-9_-]+\.pdf$') THEN
    RAISE EXCEPTION 'la ruta del libro de familia no es del nino'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT v_admin AND public.alta_validada_de_nino(p_nino_id) THEN
    RAISE EXCEPTION 'alta validada: el cambio va a la cola de validacion'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.ninos
     SET libro_familia_path = p_path
   WHERE id = p_nino_id AND deleted_at IS NULL;

  RETURN v_anterior;
END;
$$;

REVOKE ALL ON FUNCTION public.fijar_libro_familia_nino(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fijar_libro_familia_nino(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.quitar_foto_perfil_nino(p_nino_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_centro uuid;
  v_anterior text;
BEGIN
  SELECT centro_id, foto_url INTO v_centro, v_anterior
    FROM public.ninos
   WHERE id = p_nino_id AND deleted_at IS NULL;
  IF v_centro IS NULL THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (public.es_admin(v_centro) OR public.es_tutor_legal_de(p_nino_id)) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_anterior IS NOT NULL THEN
    UPDATE public.ninos
       SET foto_url = NULL
     WHERE id = p_nino_id AND deleted_at IS NULL;
  END IF;

  RETURN v_anterior;
END;
$$;

REVOKE ALL ON FUNCTION public.quitar_foto_perfil_nino(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quitar_foto_perfil_nino(uuid) TO authenticated;

-- ---- Guarda posterior ----
DO $guarda$
BEGIN
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.actualizar_familia_nino(uuid, jsonb)'::regprocedure), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM '050d839732e475cfe625dea8a47594ee' THEN
    RAISE EXCEPTION 'D2-reparacion: actualizar_familia_nino no quedo igual que en 20261005120000';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.alta_validada_de_nino(uuid)'::regprocedure), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM '96d5d5cf8c4d0c52529ccf352eb4f693' THEN
    RAISE EXCEPTION 'D2-reparacion: alta_validada_de_nino no quedo igual que en 20261005120000';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.fijar_libro_familia_nino(uuid, text)'::regprocedure), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM 'd44c2cc5daaa0cd177ebbb5e0c19ce54' THEN
    RAISE EXCEPTION 'D2-reparacion: fijar_libro_familia_nino no quedo igual que en 20261005120000';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.quitar_foto_perfil_nino(uuid)'::regprocedure), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM '3cb4ec827f8a5cec1a3289cd5a273ce5' THEN
    RAISE EXCEPTION 'D2-reparacion: quitar_foto_perfil_nino no quedo igual que en 20261005120000';
  END IF;
  IF pg_get_function_result('public.actualizar_familia_nino(uuid, jsonb)'::regprocedure) IS DISTINCT FROM 'uuid' THEN
    RAISE EXCEPTION 'D2-reparacion: actualizar_familia_nino no devuelve uuid';
  END IF;
  IF has_function_privilege('anon', 'public.actualizar_familia_nino(uuid, jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fijar_libro_familia_nino(uuid, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.quitar_foto_perfil_nino(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.alta_validada_de_nino(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.alta_validada_de_nino(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'D2-reparacion: ACL inesperado (anon o el helper ejecutables)';
  END IF;
  IF NOT (has_function_privilege('authenticated', 'public.actualizar_familia_nino(uuid, jsonb)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.fijar_libro_familia_nino(uuid, text)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.quitar_foto_perfil_nino(uuid)', 'EXECUTE')) THEN
    RAISE EXCEPTION 'D2-reparacion: authenticated sin EXECUTE en alguna RPC';
  END IF;
END
$guarda$;
