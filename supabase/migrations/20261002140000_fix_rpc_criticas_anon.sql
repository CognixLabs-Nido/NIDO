-- =============================================================================
-- FIX — cerrar a anon las 10 RPCs críticas (limpieza de seguridad, PR-1)
-- -----------------------------------------------------------------------------
-- Con la anon key (pública, va en el bundle) PostgREST ejecutaba estas funciones:
--   · _get_medical_key / _get_sepa_key devolvían las claves de cifrado de Vault, sin guarda.
--   · solicitar_olvido_usuario / solicitar_olvido_nino / purgar_sujeto_db / olvido_pendientes y
--     registrar_consentimiento trataban "auth.uid() NULL" como el servicio: anon (uid NULL) se
--     saltaba la guarda → podía pedir y ejecutar el olvido de cualquiera, listar las solicitudes
--     de todos los centros o registrar consentimientos a nombre de otro.
--   · listar_esqueletos_huerfanos_stub / es_esqueleto_stub_purgable /
--     purgar_esqueleto_huerfano_nino no tienen guarda de identidad (las usa el cron).
--
-- Dos capas (defensa en profundidad, patrón #284):
--   1. Cuerpo (5 funciones): la rama "sin uid" solo deja pasar a service_role o a una sesión
--      directa sin JWT. Es una INSERCIÓN marcada [CRIT-ANON] (en olvido_pendientes, la condición
--      del WHERE); el resto del cuerpo es el vivo, verbatim (fines de línea normalizados a LF).
--   2. ACL: REVOKE de PUBLIC y anon en las 10; además de authenticated donde nadie autenticado la
--      llama (claves: solo el dueño; olvido_pendientes, purgar_sujeto_db y las de esqueletos:
--      solo service_role). solicitar_olvido_* (la directora) y registrar_consentimiento (el acuse
--      médico del tutor en el wizard) conservan authenticated.
--
-- Fuera de alcance: el resto de RPCs con EXECUTE a anon (grupo B) y los helpers de RLS (C).
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor (CLI SIGILL
-- en ARM). Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.registrar_consentimiento(p_usuario_id uuid, p_tipo consentimiento_tipo, p_version text, p_ip inet DEFAULT NULL::inet, p_user_agent text DEFAULT NULL::text, p_metodo firma_metodo DEFAULT 'digital'::firma_metodo, p_nino_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  -- [CRIT-ANON] Sin uid solo entra el servicio: service_role o sesión directa sin JWT
  -- (SQL Editor / psql). anon, o un JWT sin sub, ya no se cuela por la rama "uid NULL". Patrón #284.
  IF auth.uid() IS NULL
     AND NOT (COALESCE(auth.role(), '') = 'service_role'
              OR (session_user <> 'authenticator'
                  AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                  AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
    RAISE EXCEPTION 'no autorizado: sin sesión solo el servicio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- [/CRIT-ANON]
  -- Service role (captura en el alta) tiene auth.uid() NULL; un usuario
  -- autenticado solo puede registrar el suyo.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'no autorizado a registrar consentimientos de otro usuario'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.consentimientos
    (usuario_id, tipo, version, ip_address, user_agent, metodo_firma, nino_id)
  VALUES (p_usuario_id, p_tipo, p_version, p_ip, p_user_agent, p_metodo, p_nino_id)
  RETURNING id INTO v_id;

  -- Caché denormalizada (solo terminos/privacidad tienen columna en usuarios).
  IF p_tipo = 'terminos' THEN
    UPDATE public.usuarios SET consentimiento_terminos_version = p_version WHERE id = p_usuario_id;
  ELSIF p_tipo = 'privacidad' THEN
    UPDATE public.usuarios SET consentimiento_privacidad_version = p_version WHERE id = p_usuario_id;
  END IF;

  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.solicitar_olvido_usuario(p_usuario_id uuid, p_inmediato boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro uuid;
  v_gracia timestamptz;
  v_id     uuid;
BEGIN
  -- [CRIT-ANON] Sin uid solo entra el servicio: service_role o sesión directa sin JWT
  -- (SQL Editor / psql). anon, o un JWT sin sub, ya no se cuela por la rama "uid NULL". Patrón #284.
  IF auth.uid() IS NULL
     AND NOT (COALESCE(auth.role(), '') = 'service_role'
              OR (session_user <> 'authenticator'
                  AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                  AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
    RAISE EXCEPTION 'no autorizado: sin sesión solo el servicio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- [/CRIT-ANON]
  IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE id = p_usuario_id) THEN
    RAISE EXCEPTION 'usuario no encontrado: %', p_usuario_id USING ERRCODE = 'no_data_found';
  END IF;

  SELECT centro_id INTO v_centro
  FROM public.roles_usuario
  WHERE usuario_id = p_usuario_id AND deleted_at IS NULL
  ORDER BY created_at
  LIMIT 1;

  IF v_centro IS NULL THEN
    RAISE EXCEPTION 'usuario sin centro: no se puede ubicar el responsable del tratamiento'
      USING ERRCODE = 'no_data_found';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.es_admin(v_centro) THEN
    RAISE EXCEPTION 'no autorizado a ejercer el olvido en este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_gracia := CASE WHEN p_inmediato THEN now() ELSE now() + interval '30 days' END;

  UPDATE public.usuarios SET deleted_at = COALESCE(deleted_at, now()) WHERE id = p_usuario_id;

  INSERT INTO public.olvido_solicitudes
    (sujeto_tipo, sujeto_id, centro_id, solicitado_por, gracia_hasta, inmediato)
  VALUES ('usuario', p_usuario_id, v_centro, auth.uid(), v_gracia, p_inmediato)
  ON CONFLICT (sujeto_tipo, sujeto_id) WHERE purgado_en IS NULL
  DO UPDATE SET
    gracia_hasta = LEAST(public.olvido_solicitudes.gracia_hasta, EXCLUDED.gracia_hasta),
    inmediato    = public.olvido_solicitudes.inmediato OR EXCLUDED.inmediato
  RETURNING id INTO v_id;

  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.solicitar_olvido_nino(p_nino_id uuid, p_inmediato boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro uuid;
  v_gracia timestamptz;
  v_id     uuid;
BEGIN
  -- [CRIT-ANON] Sin uid solo entra el servicio: service_role o sesión directa sin JWT
  -- (SQL Editor / psql). anon, o un JWT sin sub, ya no se cuela por la rama "uid NULL". Patrón #284.
  IF auth.uid() IS NULL
     AND NOT (COALESCE(auth.role(), '') = 'service_role'
              OR (session_user <> 'authenticator'
                  AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                  AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
    RAISE EXCEPTION 'no autorizado: sin sesión solo el servicio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- [/CRIT-ANON]
  SELECT centro_id INTO v_centro FROM public.ninos WHERE id = p_nino_id;
  IF v_centro IS NULL THEN
    RAISE EXCEPTION 'niño no encontrado: %', p_nino_id USING ERRCODE = 'no_data_found';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.es_admin(v_centro) THEN
    RAISE EXCEPTION 'no autorizado a ejercer el olvido en este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_gracia := CASE WHEN p_inmediato THEN now() ELSE now() + interval '30 days' END;

  -- D-5: estampa el motivo del soft-delete (respeta el CHECK). Preserva 'purga_rgpd'
  -- si el niño ya estaba purgado; en el resto de casos marca 'solicitud_olvido'.
  -- Cast EXPLÍCITO de cada rama al ENUM: un CASE de literales `unknown` resuelve a `text`
  -- y `text`→`motivo_borrado` no tiene cast implícito (42804). Ver cabecera.
  UPDATE public.ninos
     SET deleted_at = COALESCE(deleted_at, now()),
         deleted_reason = CASE WHEN deleted_reason = 'purga_rgpd'
                               THEN 'purga_rgpd'::public.motivo_borrado
                               ELSE 'solicitud_olvido'::public.motivo_borrado END
   WHERE id = p_nino_id;

  INSERT INTO public.olvido_solicitudes
    (sujeto_tipo, sujeto_id, centro_id, solicitado_por, gracia_hasta, inmediato)
  VALUES ('nino', p_nino_id, v_centro, auth.uid(), v_gracia, p_inmediato)
  ON CONFLICT (sujeto_tipo, sujeto_id) WHERE purgado_en IS NULL
  DO UPDATE SET
    gracia_hasta = LEAST(public.olvido_solicitudes.gracia_hasta, EXCLUDED.gracia_hasta),
    inmediato    = public.olvido_solicitudes.inmediato OR EXCLUDED.inmediato
  RETURNING id INTO v_id;

  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.purgar_sujeto_db(p_solicitud_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s        public.olvido_solicitudes%ROWTYPE;
  v_nombre text;
  k_nino  text[] := ARRAY['nombre','apellidos','fecha_nacimiento','sexo','nacionalidad',
                          'foto_url','notas_admin'];
  k_med   text[] := ARRAY['alergias_graves','notas_emergencia','medicacion_habitual',
                          'alergias_leves','medico_familia','telefono_emergencia'];
  k_user  text[] := ARRAY['nombre_completo'];
  k_extra text[] := ARRAY['ip_address','user_agent','descripcion_parentesco',
                          'nombre_externo','observaciones','observaciones_generales',
                          'contenido','nombre_tecleado'];
BEGIN
  -- [CRIT-ANON] Sin uid solo entra el servicio: service_role o sesión directa sin JWT
  -- (SQL Editor / psql). anon, o un JWT sin sub, ya no se cuela por la rama "uid NULL". Patrón #284.
  IF auth.uid() IS NULL
     AND NOT (COALESCE(auth.role(), '') = 'service_role'
              OR (session_user <> 'authenticator'
                  AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                  AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
    RAISE EXCEPTION 'no autorizado: sin sesión solo el servicio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- [/CRIT-ANON]
  SELECT * INTO s FROM public.olvido_solicitudes WHERE id = p_solicitud_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'solicitud de olvido no encontrada: %', p_solicitud_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.es_admin(s.centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF s.purgado_en IS NOT NULL THEN
    RETURN;
  END IF;

  IF s.sujeto_tipo = 'nino' THEN
    -- D-5: motivo 'purga_rgpd' → desarchivar_nino RAISE (no reincorpora un sujeto purgado).
    UPDATE public.ninos SET
      nombre           = '[borrado]',
      apellidos        = '[borrado]',
      fecha_nacimiento = DATE '1900-01-01',
      sexo             = NULL,
      nacionalidad     = NULL,
      foto_url         = NULL,
      notas_admin      = NULL,
      deleted_reason   = 'purga_rgpd',
      deleted_at       = COALESCE(deleted_at, now())
    WHERE id = s.sujeto_id;

    UPDATE public.info_medica_emergencia SET
      alergias_graves     = NULL,
      notas_emergencia    = NULL,
      medicacion_habitual = NULL,
      alergias_leves      = NULL,
      medico_familia      = NULL,
      telefono_emergencia = NULL
    WHERE nino_id = s.sujeto_id;

    UPDATE public.datos_pedagogicos_nino SET
      lactancia_observaciones          = NULL,
      control_esfinteres_observaciones = NULL,
      siesta_horario_habitual          = NULL,
      siesta_observaciones             = NULL,
      alimentacion_observaciones       = CASE WHEN tipo_alimentacion = 'otra'
                                              THEN '[borrado]' ELSE NULL END,
      deleted_at                       = COALESCE(deleted_at, now())
    WHERE nino_id = s.sujeto_id;

    -- D-5: motivo 'purga_rgpd' → desarchivar_nino NUNCA revive un vínculo purgado.
    UPDATE public.vinculos_familiares SET
      descripcion_parentesco = NULL,
      deleted_reason         = 'purga_rgpd',
      deleted_at             = COALESCE(deleted_at, now())
    WHERE nino_id = s.sujeto_id;

    DELETE FROM public.media m
    WHERE EXISTS (
            SELECT 1 FROM public.media_etiquetas e
            WHERE e.media_id = m.id AND e.nino_id = s.sujeto_id)
      AND NOT EXISTS (
            SELECT 1 FROM public.media_etiquetas e2
            WHERE e2.media_id = m.id AND e2.nino_id <> s.sujeto_id);
    DELETE FROM public.media_etiquetas WHERE nino_id = s.sujeto_id;

    UPDATE public.audit_log SET
      valores_antes   = public._redactar_jsonb(valores_antes,   k_nino || k_med || k_extra),
      valores_despues = public._redactar_jsonb(valores_despues, k_nino || k_med || k_extra)
    WHERE registro_id = s.sujeto_id
       OR (valores_antes->>'nino_id'   = s.sujeto_id::text)
       OR (valores_despues->>'nino_id' = s.sujeto_id::text);

  ELSE  -- usuario
    SELECT nombre_completo INTO v_nombre FROM public.usuarios WHERE id = s.sujeto_id;

    IF v_nombre IS NOT NULL AND length(trim(v_nombre)) > 0 THEN
      UPDATE public.mensajes
        SET contenido = replace(contenido, v_nombre, '[borrado]')
        WHERE contenido LIKE '%' || v_nombre || '%';
    END IF;

    UPDATE public.usuarios SET
      nombre_completo = '[borrado]',
      deleted_at      = COALESCE(deleted_at, now())
    WHERE id = s.sujeto_id;

    UPDATE public.consentimientos SET ip_address = NULL, user_agent = NULL
      WHERE usuario_id = s.sujeto_id;
    DELETE FROM public.push_subscriptions WHERE usuario_id = s.sujeto_id;

    -- D-5: motivo 'purga_rgpd' → la reactivación de familia NUNCA revive estas filas.
    UPDATE public.roles_usuario SET
      deleted_reason = 'purga_rgpd',
      deleted_at     = COALESCE(deleted_at, now())
      WHERE usuario_id = s.sujeto_id;
    UPDATE public.vinculos_familiares SET
      descripcion_parentesco = NULL,
      deleted_reason         = 'purga_rgpd',
      deleted_at             = COALESCE(deleted_at, now())
    WHERE usuario_id = s.sujeto_id;

    UPDATE public.audit_log SET
      valores_antes   = public._redactar_jsonb(valores_antes,   k_user || k_extra),
      valores_despues = public._redactar_jsonb(valores_despues, k_user || k_extra)
    WHERE registro_id = s.sujeto_id OR usuario_id = s.sujeto_id;
  END IF;

  UPDATE public.olvido_solicitudes SET purgado_en = now() WHERE id = p_solicitud_id;
END $function$;

CREATE OR REPLACE FUNCTION public.olvido_pendientes()
 RETURNS TABLE(solicitud_id uuid, sujeto_tipo olvido_sujeto_tipo, sujeto_id uuid, centro_id uuid, gracia_hasta timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.id, s.sujeto_tipo, s.sujeto_id, s.centro_id, s.gracia_hasta
  FROM public.olvido_solicitudes s
  WHERE s.purgado_en IS NULL
    AND s.gracia_hasta <= now()
    -- [CRIT-ANON] sin uid, solo el servicio (service_role o sesión directa sin JWT). Patrón #284.
    AND ((auth.uid() IS NULL
          AND (COALESCE(auth.role(), '') = 'service_role'
               OR (session_user <> 'authenticator'
                   AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                   AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)))
         OR public.es_admin(s.centro_id))
  ORDER BY s.gracia_hasta;
$function$;

-- ---------------------------------------------------------------------------
-- ACL (CREATE OR REPLACE conserva la ACL previa: los REVOKE van después)
-- ---------------------------------------------------------------------------
-- Claves de Vault: solo el dueño (las usan otras funciones SECURITY DEFINER, que corren como él).
REVOKE EXECUTE ON FUNCTION public._get_medical_key() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public._get_sepa_key() FROM PUBLIC, anon, authenticated, service_role;

-- Conservan authenticated + service_role.
REVOKE EXECUTE ON FUNCTION public.registrar_consentimiento(uuid, public.consentimiento_tipo, text, inet, text, public.firma_metodo, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.solicitar_olvido_usuario(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.solicitar_olvido_nino(uuid, boolean) FROM PUBLIC, anon;

-- Solo service_role (cron de purga y de retención).
REVOKE EXECUTE ON FUNCTION public.purgar_sujeto_db(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.olvido_pendientes() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.listar_esqueletos_huerfanos_stub(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.es_esqueleto_stub_purgable(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.purgar_esqueleto_huerfano_nino(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
