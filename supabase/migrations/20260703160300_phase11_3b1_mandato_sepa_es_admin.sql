-- =============================================================================
-- F11 alta PR-3b-1 (modo "Completa Dirección") — (4/6) registrar_mandato_sepa +es_admin
-- -----------------------------------------------------------------------------
-- Amplía el gate de `registrar_mandato_sepa` para que la ADMIN del centro registre
-- el mandato SEPA (con el IBAN que tiene EN PAPEL) A SU NOMBRE: `usuario_id = v_uid
-- = auth.uid()` (=la admin cuando la usa ella; =el tutor en modo familia). NO hay
-- p_usuario_id: la MISMA firma de función que hoy.
--
-- CAMBIO ÚNICO: el gate `IF NOT es_tutor_legal_de(...)` pasa a
--   `IF NOT (es_admin(centro_de_nino(p_nino_id)) OR es_tutor_legal_de(p_nino_id))`.
-- El cifrado del IBAN con la clave del Vault y TODO el cuerpo quedan IDÉNTICOS.
--
-- Camino TUTOR intacto: el tutor sigue pasando por `es_tutor_legal_de` exactamente
-- igual (solo se AÑADE la rama admin con OR). Las remesas no consultan usuario_id
-- (get_mandatos_remesa hace JOIN por nino_id/estado) → un mandato con usuario_id de
-- la admin NO las rompe.
--
-- CREATE OR REPLACE de la MISMA firma (11 args) → sin DROP, sin cambiar la llamada
-- existente. APLICAR POR SQL EDITOR (rol postgres). NO por CLI.
-- =============================================================================

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
  p_fecha_firma           timestamptz
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
  -- Gate AMPLIADO: admin del centro del niño O tutor legal (el tutor pasa igual).
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
  uuid, text, text, text, text, text, text, text, inet, text, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_mandato_sepa(
  uuid, text, text, text, text, text, text, text, inet, text, timestamptz
) TO authenticated;
