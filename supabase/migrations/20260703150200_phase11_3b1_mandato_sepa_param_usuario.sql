-- =============================================================================
-- F11 alta PR-3b-1 (modo "Completa Dirección") — (3/4) registrar_mandato_sepa param
-- -----------------------------------------------------------------------------
-- Parametriza `registrar_mandato_sepa` para que la Directora pueda registrar el
-- mandato SEPA EN NOMBRE del tutor. El cifrado del IBAN se hace DENTRO del DEFINER
-- con la clave del Vault (`_get_sepa_key()`, RGPD) → NO puede salir fuera, por eso
-- se parametriza la función en vez de replicarla.
--
-- Se añade `p_usuario_id uuid DEFAULT NULL` AL FINAL (patrón de 4c-2: DROP de la
-- firma vieja + CREATE con el parámetro nuevo con DEFAULT + re-GRANT):
--   - p_usuario_id NULL  → RAMA TUTOR (modo familia): IDÉNTICA a la actual
--     (v_uid := auth.uid() + es_tutor_legal_de). La llamada existente de 11 args
--     resuelve a esta función con el default → NO se rompe.
--   - p_usuario_id != NULL → RAMA ADMIN (modo Dirección): GATE TRIPLE y el mandato
--     se imputa al tutor (usuario_id = p_usuario_id). El cifrado y el resto del
--     cuerpo quedan IDÉNTICOS; solo cambia de quién es el mandato.
--
-- GATE TRIPLE (rama admin): (a) es_admin(centro_de_nino) + (b) matrícula
-- pendiente/lista + (c) p_usuario_id = tutor_legal_principal del niño.
--
-- APLICAR POR SQL EDITOR (rol postgres). NO por CLI.
-- =============================================================================

-- DROP de la firma vieja (11 args) para poder cambiar la aridad de forma limpia.
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
  p_usuario_id            uuid DEFAULT NULL   -- el TUTOR (modo Dirección); NULL = modo familia
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_clave text := public._get_sepa_key();
  v_uid   uuid;
  v_id    uuid;
BEGIN
  IF p_usuario_id IS NOT NULL THEN
    -- ── RAMA ADMIN (modo Dirección): GATE TRIPLE, mandato imputado al tutor ──
    -- (a) admin DEL CENTRO del niño.
    IF NOT public.es_admin(public.centro_de_nino(p_nino_id)) THEN
      RAISE EXCEPTION 'no autorizado: no es admin del centro del nino'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- (b) alta EN CURSO: matrícula 'pendiente' o 'lista'.
    IF NOT EXISTS (
      SELECT 1 FROM public.matriculas
      WHERE nino_id = p_nino_id
        AND estado IN ('pendiente', 'lista')
        AND fecha_baja IS NULL
        AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'no autorizado: el alta no esta en curso (pendiente/lista)'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- (c) p_usuario_id ES el tutor_legal_principal de ESE niño.
    IF NOT EXISTS (
      SELECT 1 FROM public.vinculos_familiares
      WHERE nino_id = p_nino_id
        AND usuario_id = p_usuario_id
        AND tipo_vinculo = 'tutor_legal_principal'
        AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'no autorizado: el usuario no es el tutor principal de este nino'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_uid := p_usuario_id;
  ELSE
    -- ── RAMA TUTOR (modo familia) — IDÉNTICA a la versión anterior ──────────
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'No autorizado';
    END IF;
    IF NOT public.es_tutor_legal_de(p_nino_id) THEN
      RAISE EXCEPTION 'No autorizado';
    END IF;
  END IF;

  IF p_iban IS NULL OR char_length(p_iban) < 15 OR char_length(p_iban) > 34 THEN
    RAISE EXCEPTION 'IBAN inválido';
  END IF;

  -- Resto del cuerpo IDÉNTICO al original: usa v_uid (tutor en ambos modos). El
  -- cifrado del IBAN con la clave del Vault no cambia.
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
      fecha_firma           = p_fecha_firma
    WHERE id = v_id;
  ELSE
    INSERT INTO public.mandatos_sepa (
      centro_id, nino_id, usuario_id, iban_cifrado, titular,
      identificador_mandato, documento_path, estado, firma_imagen,
      nombre_tecleado, texto_hash, ip_address, user_agent, fecha_firma
    ) VALUES (
      public.centro_de_nino(p_nino_id), p_nino_id, v_uid,
      pgp_sym_encrypt(p_iban, v_clave), p_titular,
      p_identificador_mandato, p_documento_path, 'activo', p_firma_imagen,
      p_nombre_tecleado, p_texto_hash, p_ip_address, p_user_agent, p_fecha_firma
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_mandato_sepa(
  uuid, text, text, text, text, text, text, text, inet, text, timestamptz, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_mandato_sepa(
  uuid, text, text, text, text, text, text, text, inet, text, timestamptz, uuid
) TO authenticated;
