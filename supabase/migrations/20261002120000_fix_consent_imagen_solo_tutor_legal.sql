-- =============================================================================
-- FIX — consentimiento de imagen: solo el tutor LEGAL (o Dirección presencial) lo da
-- -----------------------------------------------------------------------------
-- otorgar_consentimiento_imagen / revocar_consentimiento_imagen dejaban pasar a cualquier
-- vínculo del niño (`es_tutor_de`), incluido `autorizado` (persona de recogida) y `admin`.
-- El titular del consentimiento de imagen es el tutor legal: se cambia a
-- `es_tutor_legal_de` (principal/secundario). Es el ÚNICO cambio: el resto del cuerpo
-- (gate NULL, p_tutor forzado de #284, INSERT/UPDATE) queda idéntico. El ACL no cambia
-- (CREATE OR REPLACE conserva el REVOKE de anon/PUBLIC de 20261001130000).
--
-- firma_imagen_sync: la firma del documento de imagen generaba consentimiento para
-- CUALQUIER firmante (también un «autorizado» con `puede_firmar_autorizaciones`), sin pasar
-- por las RPCs. Ahora la rama `firmado` solo sincroniza si el firmante es tutor legal de
-- ese niño o Dirección del centro en firma PRESENCIAL. Es el único cambio: la rama
-- revocado/rechazado y el resto del cuerpo quedan idénticos.
--
-- Efecto colateral: el alta deja entrar a cualquier vínculo; un «autorizado» con cuenta que
-- marcase la casilla de imagen del alta recibirá 42501 (hoy no hay ninguno con cuenta).
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor (CLI SIGILL
-- en ARM). Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.otorgar_consentimiento_imagen(p_nino_id uuid, p_tutor uuid, p_version text DEFAULT 'imagen-v1'::text, p_ip inet DEFAULT NULL::inet, p_user_agent text DEFAULT NULL::text, p_metodo firma_metodo DEFAULT 'digital'::firma_metodo)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_uid uuid := auth.uid();
  v_admin boolean;
BEGIN
  IF v_uid IS NULL THEN
    IF NOT (COALESCE(auth.role(), '') = 'service_role'
            OR (session_user <> 'authenticator'
                AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
      RAISE EXCEPTION 'no autorizado a otorgar consentimiento de imagen de este niño'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    v_admin := public.es_admin(public.centro_de_nino(p_nino_id));
    IF NOT v_admin AND NOT public.es_tutor_legal_de(p_nino_id) THEN
      RAISE EXCEPTION 'no autorizado a otorgar consentimiento de imagen de este niño'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT v_admin THEN
      p_tutor := v_uid;
    END IF;
  END IF;

  INSERT INTO public.consentimientos
    (usuario_id, tipo, version, nino_id, ip_address, user_agent, metodo_firma)
  VALUES
    (p_tutor, 'imagen', p_version, p_nino_id, p_ip, p_user_agent, p_metodo)
  RETURNING id INTO v_id;

  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.revocar_consentimiento_imagen(p_nino_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    IF NOT (COALESCE(auth.role(), '') = 'service_role'
            OR (session_user <> 'authenticator'
                AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
      RAISE EXCEPTION 'no autorizado a revocar consentimiento de imagen de este niño'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NOT public.es_admin(public.centro_de_nino(p_nino_id))
     AND NOT public.es_tutor_legal_de(p_nino_id) THEN
    RAISE EXCEPTION 'no autorizado a revocar consentimiento de imagen de este niño'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH upd AS (
    UPDATE public.consentimientos
       SET revocado_en = now()
     WHERE tipo = 'imagen' AND nino_id = p_nino_id AND revocado_en IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM upd;

  RETURN v_n;
END $function$;

CREATE OR REPLACE FUNCTION public.firma_imagen_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a public.autorizaciones%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.autorizaciones WHERE id = NEW.autorizacion_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  -- Solo instancias reales de autorización de imágenes.
  IF a.es_plantilla OR a.tipo <> 'autorizacion_imagenes' THEN RETURN NEW; END IF;

  -- Fuente única = consentimientos: la firma SOLO sincroniza el CONSENT por-niño,
  -- acotado a (usuario_id = NEW.firmante_id, nino_id = NEW.nino_id). NO toca el flag
  -- puede_aparecer_en_fotos (lo deriva consentimiento_imagen_sync al cambiar el consent).
  IF NEW.decision = 'firmado' THEN
    -- Solo genera consentimiento quien puede darlo: un tutor LEGAL de ese niño, o
    -- Dirección del centro del niño firmando en PRESENCIAL (modo Dirección). Un vínculo
    -- «autorizado» (u otro firmante) que firme el documento NO genera consentimiento.
    -- (La rama de revocado/rechazado no se filtra: retirar nunca se bloquea.)
    IF NOT (
         EXISTS (SELECT 1 FROM public.vinculos_familiares vf
                  WHERE vf.usuario_id = NEW.firmante_id
                    AND vf.nino_id = NEW.nino_id
                    AND vf.deleted_at IS NULL
                    AND vf.tipo_vinculo IN ('tutor_legal_principal', 'tutor_legal_secundario'))
      OR (NEW.metodo_firma = 'presencial'
          AND EXISTS (SELECT 1 FROM public.roles_usuario ru
                       WHERE ru.usuario_id = NEW.firmante_id
                         AND ru.rol = 'admin'
                         AND ru.deleted_at IS NULL
                         AND ru.centro_id = public.centro_de_nino(NEW.nino_id)))
    ) THEN
      RETURN NEW;
    END IF;
    -- Supersede idempotente del vigente previo del firmante PARA ESE NIÑO; alta del
    -- nuevo con la versión del texto firmado (D2/D3) y nino_id = NEW.nino_id.
    UPDATE public.consentimientos
       SET revocado_en = now()
     WHERE tipo = 'imagen' AND usuario_id = NEW.firmante_id
       AND nino_id = NEW.nino_id AND revocado_en IS NULL;
    INSERT INTO public.consentimientos
      (usuario_id, tipo, version, nino_id, ip_address, user_agent)
    VALUES
      (NEW.firmante_id, 'imagen'::public.consentimiento_tipo, a.texto_version,
       NEW.nino_id, NEW.ip_address, NEW.user_agent);
  ELSE
    -- revocado / rechazado → retira el vigente del firmante PARA ESE NIÑO.
    UPDATE public.consentimientos
       SET revocado_en = now()
     WHERE tipo = 'imagen' AND usuario_id = NEW.firmante_id
       AND nino_id = NEW.nino_id AND revocado_en IS NULL;
  END IF;

  RETURN NEW;
END $function$;
