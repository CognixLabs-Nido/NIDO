-- =============================================================================
-- F-2c-2 — `mandatos_sepa.iban_ultimos4` (enmascarado del IBAN) + relleno en RPCs
-- -----------------------------------------------------------------------------
-- El paso 8 del alta muestra un INFORMATIVO cuando la familia YA tiene mandato
-- activo ("domiciliación activa · ****1234 · a nombre de {titular}"), sin re-pedir
-- IBAN ni firma. Para pintar "****1234" sin descifrar el IBAN en el cliente, se
-- guardan los ÚLTIMOS 4 dígitos EN CLARO (no sensibles) en una columna nueva.
--
-- Contenido (subfase 2c-2, solo el enmascarado):
--   a) ADD COLUMN mandatos_sepa.iban_ultimos4 (NULL o 4 dígitos).
--   b) CREATE OR REPLACE registrar_mandato_sepa / sustituir_mandato_sepa (las de
--      F-2c-1): ÚNICO cambio = rellenan iban_ultimos4 = right(IBAN normalizado, 4)
--      en el INSERT y en el UPDATE in-place de registrar. TODO lo demás intacto
--      (endurecimiento por IBAN distinto, gate por familia, cifrado, índice único,
--      sustituir atómico revoca+inserta). `get_mandatos_remesa` NO se toca.
--   c) 0 filas → sin backfill.
--
-- Reutiliza helpers YA existentes (centro_de_familia/es_tutor_de_familia/_get_sepa_key).
-- Los últimos 4 NO son categoría sensible (no permiten reconstruir el IBAN); se leen
-- por la RLS de `mandatos_sepa` (es_admin OR es_tutor_de_familia) sin RPC de descifrado.
--
-- ⚠️ PRERREQUISITO DE OPERADOR: el secreto 'sepa_encryption_key' debe existir en
--    Vault (F11-G-2bis). El PERFORM final revierte si no.
-- APLICAR POR SQL EDITOR (rol postgres). NO por CLI. `database.ts` se tipa a mano.
-- =============================================================================
BEGIN;

-- ─── 1. Columna del enmascarado (últimos 4 dígitos del IBAN, en claro) ────────
ALTER TABLE public.mandatos_sepa
  ADD COLUMN IF NOT EXISTS iban_ultimos4 text;

ALTER TABLE public.mandatos_sepa
  DROP CONSTRAINT IF EXISTS mandatos_sepa_ultimos4_formato;
ALTER TABLE public.mandatos_sepa
  ADD CONSTRAINT mandatos_sepa_ultimos4_formato
  CHECK (iban_ultimos4 IS NULL OR iban_ultimos4 ~ '^[0-9]{4}$');

COMMENT ON COLUMN public.mandatos_sepa.iban_ultimos4 IS
  'F-2c-2: últimos 4 dígitos del IBAN en CLARO para enmascarado (****1234). No sensible (no reconstruye el IBAN). Lo rellenan registrar/sustituir_mandato_sepa; el IBAN completo sigue solo en iban_cifrado.';

-- ─── 2. registrar_mandato_sepa (F-2c-1) + relleno de iban_ultimos4 ────────────
-- VERBATIM de 20260725120000 salvo el relleno de iban_ultimos4 en el UPDATE
-- in-place y en el INSERT. La firma NO cambia → CREATE OR REPLACE (sin DROP).
CREATE OR REPLACE FUNCTION public.registrar_mandato_sepa(
  p_familia_id            uuid,
  p_nino_id               uuid,   -- INFORMATIVO/OPCIONAL: qué niño originó el alta
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
  v_clave       text := public._get_sepa_key();
  v_uid         uuid := auth.uid();
  v_id          uuid;
  v_iban_actual text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  -- Gate por FAMILIA: admin del centro de la familia O tutor de la familia.
  IF NOT (public.es_admin(public.centro_de_familia(p_familia_id))
          OR public.es_tutor_de_familia(p_familia_id)) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF p_iban IS NULL OR char_length(p_iban) < 15 OR char_length(p_iban) > 34 THEN
    RAISE EXCEPTION 'IBAN inválido';
  END IF;

  -- Mandato ACTIVO de la familia (no por nino+usuario). Se descifra su IBAN para
  -- decidir: mismo IBAN = reintento del alta (UPDATE in-place, sin ensuciar histórico);
  -- IBAN distinto = cambio real de cuenta → NO se pisa aquí, se exige sustituir_mandato_sepa
  -- (revoca + inserta, con histórico). NO se compara `iban_cifrado` directamente:
  -- pgp_sym_encrypt no es determinista (mismo IBAN cifra distinto) → hay que descifrar.
  SELECT id, pgp_sym_decrypt(iban_cifrado, v_clave) INTO v_id, v_iban_actual
  FROM public.mandatos_sepa
  WHERE familia_id = p_familia_id AND estado = 'activo' AND deleted_at IS NULL
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    -- Comparación en CLARO normalizada (sin espacios/tabuladores, mayúsculas) por si el
    -- tecleo trae espacios. Distinto → error claro; el cambio de cuenta va por sustituir.
    IF upper(regexp_replace(v_iban_actual, '\s', '', 'g'))
       <> upper(regexp_replace(p_iban, '\s', '', 'g')) THEN
      RAISE EXCEPTION 'mandato_activo_otro_iban'
        USING HINT = 'existe un mandato activo con otro IBAN; usa sustituir_mandato_sepa';
    END IF;
    UPDATE public.mandatos_sepa SET
      nino_id               = p_nino_id,
      usuario_id            = v_uid,
      iban_cifrado          = pgp_sym_encrypt(p_iban, v_clave),
      iban_ultimos4         = right(regexp_replace(p_iban, '\s', '', 'g'), 4),
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
      centro_id, familia_id, nino_id, usuario_id, iban_cifrado, iban_ultimos4, titular,
      identificador_mandato, documento_path, estado, firma_imagen,
      nombre_tecleado, texto_hash, ip_address, user_agent, fecha_firma, metodo_firma
    ) VALUES (
      public.centro_de_familia(p_familia_id), p_familia_id, p_nino_id, v_uid,
      pgp_sym_encrypt(p_iban, v_clave), right(regexp_replace(p_iban, '\s', '', 'g'), 4), p_titular,
      p_identificador_mandato, p_documento_path, 'activo', p_firma_imagen,
      p_nombre_tecleado, p_texto_hash, p_ip_address, p_user_agent, p_fecha_firma, p_metodo
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_mandato_sepa(
  uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamptz, public.firma_metodo
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_mandato_sepa(
  uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamptz, public.firma_metodo
) TO authenticated;

-- ─── 3. sustituir_mandato_sepa (F-2c-1) + relleno de iban_ultimos4 ────────────
-- VERBATIM de 20260725120000 salvo el relleno de iban_ultimos4 en el INSERT. El
-- revocado conserva su iban_ultimos4 (solo se le cambia estado → 'revocado').
CREATE OR REPLACE FUNCTION public.sustituir_mandato_sepa(
  p_familia_id            uuid,
  p_nino_id               uuid,   -- INFORMATIVO/OPCIONAL
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
  IF NOT (public.es_admin(public.centro_de_familia(p_familia_id))
          OR public.es_tutor_de_familia(p_familia_id)) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF p_iban IS NULL OR char_length(p_iban) < 15 OR char_length(p_iban) > 34 THEN
    RAISE EXCEPTION 'IBAN inválido';
  END IF;

  -- Revoca el activo actual de la familia (se conserva la fila: estado='revocado',
  -- deleted_at NULL, con SU iban_ultimos4 intacto). Libera el índice único ANTES
  -- del INSERT del nuevo activo.
  UPDATE public.mandatos_sepa
    SET estado = 'revocado'
    WHERE familia_id = p_familia_id AND estado = 'activo' AND deleted_at IS NULL;

  INSERT INTO public.mandatos_sepa (
    centro_id, familia_id, nino_id, usuario_id, iban_cifrado, iban_ultimos4, titular,
    identificador_mandato, documento_path, estado, firma_imagen,
    nombre_tecleado, texto_hash, ip_address, user_agent, fecha_firma, metodo_firma
  ) VALUES (
    public.centro_de_familia(p_familia_id), p_familia_id, p_nino_id, v_uid,
    pgp_sym_encrypt(p_iban, v_clave), right(regexp_replace(p_iban, '\s', '', 'g'), 4), p_titular,
    p_identificador_mandato, p_documento_path, 'activo', p_firma_imagen,
    p_nombre_tecleado, p_texto_hash, p_ip_address, p_user_agent, p_fecha_firma, p_metodo
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sustituir_mandato_sepa(
  uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamptz, public.firma_metodo
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sustituir_mandato_sepa(
  uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamptz, public.firma_metodo
) TO authenticated;

-- ─── 4. Validación: la clave de Vault debe existir (si no, revierte todo) ──────
DO $$ BEGIN PERFORM public._get_sepa_key(); END $$;

COMMIT;
