-- =============================================================================
-- F11-G-2bis — CIFRADO DEL IBAN del mandato SEPA (pgcrypto, espejo del médico)
-- =============================================================================
-- El IBAN es dato sensible: debe ir CIFRADO en reposo. A diferencia del dato
-- médico (que solo se descifra para mostrar al tutor/staff), el IBAN además lo
-- necesita la FASE B en claro para generar el XML SEPA pain.008 (el IBAN del
-- deudor viaja en claro en el fichero al banco). Patrón: cifrado en reposo +
-- descifrado SOLO server-side por un proceso autorizado (remesas de dirección).
--
-- Decisiones (confirmadas por el responsable):
--  - pgcrypto espejo de info_medica_emergencia: columna `iban_cifrado bytea`,
--    DROP de `iban` en claro (sin dual-write: NO hay datos reales; el piloto
--    no ha arrancado). Clave SEPA SEPARADA de la médica.
--  - Escritura por RPC `registrar_mandato_sepa` SECURITY DEFINER que autoriza
--    `es_tutor_legal_de(nino_id)` y cifra antes del upsert → el route deja de
--    usar service-role (#108): cliente de usuario + RPC.
--  - `get_mandatos_remesa` (descifrado de LOTE, admin-only) se DIFIERE a la
--    Fase B. Aquí NO hay ningún camino de descifrado (la app solo escribe).
--
-- ⚠️ PRERREQUISITO DE OPERADOR (ANTES de aplicar esta migración):
--    Crear en Supabase Vault un secreto con name='sepa_encryption_key' y un
--    valor aleatorio fuerte (NO reutilizar la clave médica). Si no existe, esta
--    migración FALLA y revierte entera (validación al final con PERFORM).
--      Opción SQL:  select vault.create_secret('<VALOR_ALEATORIO_FUERTE>',
--                     'sepa_encryption_key', 'F11-G-2bis cifrado IBAN SEPA');
--      Opción UI:   Dashboard → Project → Vault → Add new secret.
--
-- Tras aplicar: regenerar src/types/database.ts (`npm run db:types`).
-- =============================================================================
BEGIN;

-- ─── 1. Clave SEPA en Vault (separada de la médica) ──────────────────────────
-- Lee la clave de Vault o falla con excepción explícita. Espejo de
-- public._get_medical_key() (ADR-0004), pero con su propio secreto.
CREATE OR REPLACE FUNCTION public._get_sepa_key()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_clave text;
BEGIN
  SELECT decrypted_secret INTO v_clave
  FROM vault.decrypted_secrets
  WHERE name = 'sepa_encryption_key'
  LIMIT 1;

  IF v_clave IS NULL THEN
    RAISE EXCEPTION 'Clave de cifrado SEPA no configurada en Vault'
      USING HINT = 'Crea un secreto en Supabase Dashboard → Vault con name=sepa_encryption_key';
  END IF;

  RETURN v_clave;
END;
$$;

-- La clave nunca se expone a roles cliente.
REVOKE ALL ON FUNCTION public._get_sepa_key() FROM PUBLIC;

-- ─── 2. Columna cifrada + retirada del IBAN en claro ─────────────────────────
-- iban_cifrado se llena cifrando cualquier fila existente (datos de prueba) y
-- pasa a NOT NULL; luego se DROPea el iban en claro y se reescribe el CHECK de
-- longitudes (ya no referencia el iban en claro).
ALTER TABLE public.mandatos_sepa ADD COLUMN iban_cifrado bytea;

UPDATE public.mandatos_sepa
  SET iban_cifrado = extensions.pgp_sym_encrypt(iban, public._get_sepa_key())
  WHERE iban IS NOT NULL AND iban_cifrado IS NULL;

ALTER TABLE public.mandatos_sepa ALTER COLUMN iban_cifrado SET NOT NULL;

ALTER TABLE public.mandatos_sepa DROP CONSTRAINT mandatos_sepa_longitudes;
ALTER TABLE public.mandatos_sepa DROP COLUMN iban;

ALTER TABLE public.mandatos_sepa ADD CONSTRAINT mandatos_sepa_longitudes CHECK (
  char_length(identificador_mandato) BETWEEN 1 AND 80 AND
  char_length(titular) BETWEEN 1 AND 140 AND
  (firma_imagen    IS NULL OR char_length(firma_imagen)    <= 500000) AND
  (nombre_tecleado IS NULL OR char_length(nombre_tecleado) <= 140)    AND
  (texto_hash      IS NULL OR texto_hash ~ '^[0-9a-f]{64}$')
);

COMMENT ON COLUMN public.mandatos_sepa.iban_cifrado IS
  'F11-G-2bis: IBAN cifrado con pgp_sym_encrypt (clave sepa_encryption_key de Vault, separada de la médica). Se descifra SOLO server-side por proceso autorizado (Fase B: remesas pain.008 de dirección). Espejo del patrón de info_medica_emergencia (ADR-0004).';

-- ─── 3. RPC de escritura: autoriza + cifra + upsert ──────────────────────────
-- Sustituye la escritura service-role del route (#108). El tutor (cliente de
-- usuario) llama esta RPC; SECURITY DEFINER autoriza es_tutor_legal_de y cifra
-- el IBAN antes de persistir. usuario_id = auth.uid() (titular = tutor 1).
-- 1 mandato activo por (nino, usuario): si existe, UPDATE; si no, INSERT.
-- `texto_hash` llega ya calculado por el servidor (route) sobre el IBAN en claro
-- del formulario; aquí solo se persiste. centro_id lo deriva el trigger.
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
  IF NOT public.es_tutor_legal_de(p_nino_id) THEN
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

-- ─── 4. Validación: la clave de Vault debe existir (si no, revierte todo) ─────
DO $$ BEGIN PERFORM public._get_sepa_key(); END $$;

COMMIT;
