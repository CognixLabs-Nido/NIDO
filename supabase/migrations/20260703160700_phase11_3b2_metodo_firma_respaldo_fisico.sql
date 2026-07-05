-- =============================================================================
-- F11 alta PR-3b-2 · B2-SQL — marcador de RESPALDO FÍSICO (modo "Completa Dirección")
-- -----------------------------------------------------------------------------
-- En el modo Dirección la Directora CARGA documentación EN PAPEL: la familia ya
-- firmó TODO físicamente (privacidad, términos, médicos, imagen, mandato SEPA). El
-- sistema debe MARCAR esos acuses y el mandato como respaldo en papel ('presencial'),
-- no como consentimiento digital de la familia.
--
-- `firmas_autorizacion` ya tiene `metodo_firma` (PR-3b-1/#180). Esta migración añade la
-- MISMA marca a `consentimientos` y `mandatos_sepa`, REUTILIZANDO el ENUM
-- `public.firma_metodo` ('digital'|'presencial') que ya creó #180 (NO se crea enum).
--
-- ADITIVA y NO destructiva. `DEFAULT 'digital'` → las filas existentes y el flujo
-- DIGITAL del tutor NO cambian. Los `p_metodo` de las RPC llevan `DEFAULT 'digital'`
-- → las llamadas actuales (5 args en consentimiento, 11 en mandato) siguen compilando.
--
-- **INERTE hasta B2-app**: nadie pasa 'presencial' todavía. B2-app cablea las 3 ramas
-- de escritura del admin y pasa `p_metodo='presencial'` en modo Dirección.
--
-- CRÍTICO (reproducción EXACTA): las defs de ambas RPC se copian VERBATIM de su
-- migración vigente —`registrar_consentimiento` de 20260613190000, `registrar_mandato_sepa`
-- de 20260703160300 (#180)— y el ÚNICO cambio es (a) el parámetro trailing `p_metodo` y
-- (b) escribir `metodo_firma = p_metodo` en el INSERT. Se conservan intactos: el gate
-- `auth.uid() IS NOT NULL AND auth.uid()<>p_usuario_id` (consentimiento), el gate
-- `es_admin OR es_tutor_legal_de` y el CIFRADO del IBAN con la clave del Vault (mandato),
-- la caché denormalizada de términos/privacidad, y los GRANT/REVOKE originales. Como el
-- parámetro nuevo cambia la firma, se hace DROP de la firma vieja + CREATE de la nueva.
--
-- APLICAR POR SQL EDITOR (rol postgres). NO por CLI. `database.ts` se regenera DESPUÉS.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columna de marcador en `consentimientos` (reusa el ENUM de #180).
-- -----------------------------------------------------------------------------
ALTER TABLE public.consentimientos
  ADD COLUMN metodo_firma public.firma_metodo NOT NULL DEFAULT 'digital';

-- -----------------------------------------------------------------------------
-- 2. Columna de marcador en `mandatos_sepa`.
-- -----------------------------------------------------------------------------
ALTER TABLE public.mandatos_sepa
  ADD COLUMN metodo_firma public.firma_metodo NOT NULL DEFAULT 'digital';

-- -----------------------------------------------------------------------------
-- 3. registrar_consentimiento(+ p_metodo). VERBATIM de 20260613190000 salvo el
--    parámetro trailing y la escritura de `metodo_firma`. La firma cambia (6 args)
--    → DROP de la vieja (5 args) + CREATE. RE-GRANT idéntico: authenticated, service_role.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.registrar_consentimiento(
  uuid, public.consentimiento_tipo, text, inet, text
);

CREATE OR REPLACE FUNCTION public.registrar_consentimiento(
  p_usuario_id uuid,
  p_tipo       public.consentimiento_tipo,
  p_version    text,
  p_ip         inet                DEFAULT NULL,
  p_user_agent text                DEFAULT NULL,
  p_metodo     public.firma_metodo DEFAULT 'digital'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Service role (captura en el alta) tiene auth.uid() NULL; un usuario
  -- autenticado solo puede registrar el suyo.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'no autorizado a registrar consentimientos de otro usuario'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.consentimientos (usuario_id, tipo, version, ip_address, user_agent, metodo_firma)
  VALUES (p_usuario_id, p_tipo, p_version, p_ip, p_user_agent, p_metodo)
  RETURNING id INTO v_id;

  -- Caché denormalizada (solo terminos/privacidad tienen columna en usuarios).
  IF p_tipo = 'terminos' THEN
    UPDATE public.usuarios SET consentimiento_terminos_version = p_version WHERE id = p_usuario_id;
  ELSIF p_tipo = 'privacidad' THEN
    UPDATE public.usuarios SET consentimiento_privacidad_version = p_version WHERE id = p_usuario_id;
  END IF;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.registrar_consentimiento(
  uuid, public.consentimiento_tipo, text, inet, text, public.firma_metodo
) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. registrar_mandato_sepa(+ p_metodo). VERBATIM de 20260703160300 (#180) salvo el
--    parámetro trailing y la escritura de `metodo_firma` en el UPDATE y el INSERT.
--    Se CONSERVAN INTACTOS el gate `es_admin OR es_tutor_legal_de` y el CIFRADO del
--    IBAN (pgp_sym_encrypt con la clave del Vault). La firma cambia (12 args) → DROP
--    de la vieja (11 args) + CREATE. RE-GRANT idéntico: REVOKE PUBLIC + GRANT authenticated.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.registrar_mandato_sepa(
  uuid, text, text, text, text, text, text, text, inet, text, timestamptz
);

CREATE OR REPLACE FUNCTION public.registrar_mandato_sepa(
  p_nino_id               uuid,
  p_iban                  text,
  p_titular               text,
  p_identificador_mandato text,
  p_documento_path        text,
  p_firma_imagen          text,
  p_nombre_tecleado       text,
  p_texto_hash            text,
  p_ip_address            inet,
  p_user_agent            text,
  p_fecha_firma           timestamptz,
  p_metodo                public.firma_metodo DEFAULT 'digital'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_clave text := public._get_sepa_key();
  v_uid   uuid := auth.uid();
  v_id    uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  -- Gate AMPLIADO (#180): admin del centro del niño O tutor legal (el tutor pasa igual).
  IF NOT (public.es_admin(public.centro_de_nino(p_nino_id))
          OR public.es_tutor_legal_de(p_nino_id)) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF p_iban IS NULL OR char_length(p_iban) < 15 OR char_length(p_iban) > 34 THEN
    RAISE EXCEPTION 'IBAN inválido';
  END IF;

  SELECT id INTO v_id
  FROM public.mandatos_sepa
  WHERE nino_id = p_nino_id AND usuario_id = v_uid AND deleted_at IS NULL
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.mandatos_sepa SET
      iban_cifrado          = pgp_sym_encrypt(p_iban, v_clave),
      titular               = p_titular,
      identificador_mandato = p_identificador_mandato,
      documento_path        = p_documento_path,
      estado                = 'activo',
      firma_imagen          = p_firma_imagen,
      nombre_tecleado       = p_nombre_tecleado,
      texto_hash            = p_texto_hash,
      ip_address            = p_ip_address,
      user_agent            = p_user_agent,
      fecha_firma           = p_fecha_firma,
      metodo_firma          = p_metodo
    WHERE id = v_id;
  ELSE
    INSERT INTO public.mandatos_sepa (
      centro_id, nino_id, usuario_id, iban_cifrado, titular,
      identificador_mandato, documento_path, estado, firma_imagen,
      nombre_tecleado, texto_hash, ip_address, user_agent, fecha_firma, metodo_firma
    ) VALUES (
      public.centro_de_nino(p_nino_id), p_nino_id, v_uid,
      pgp_sym_encrypt(p_iban, v_clave), p_titular,
      p_identificador_mandato, p_documento_path, 'activo', p_firma_imagen,
      p_nombre_tecleado, p_texto_hash, p_ip_address, p_user_agent, p_fecha_firma, p_metodo
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_mandato_sepa(
  uuid, text, text, text, text, text, text, text, inet, text, timestamptz, public.firma_metodo
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_mandato_sepa(
  uuid, text, text, text, text, text, text, text, inet, text, timestamptz, public.firma_metodo
) TO authenticated;
