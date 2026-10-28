-- =============================================================================
-- FEAT — El olvido alcanza la operativa del niño (F11-B, punto 6, PR-4)
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/retencion-plazos.md. La purga del niño (`purgar_sujeto_db`) anonimizaba su
-- ficha pero dejaba entera su operativa: la agenda, la asistencia, los mensajes, los informes…
-- con el nombre y las observaciones dentro. La operativa no se conserva por ninguna obligación:
-- con el olvido se borra, con sus copias en audit_log (nada vive más en audit_log que en su tabla).
--
-- La operativa del niño (la fila de RETENCION_OPERATIVA_ANIOS):
--
--   · `agendas_diarias` y sus cuatro tablas (`comidas`, `biberones`, `suenos`, `deposiciones`,
--     en cascada);
--   · `asistencias`, `ausencias`, `informes_evolucion`;
--   · su conversación con la profe (`conversaciones` profe_familia, con `mensajes` y
--     `lectura_conversacion` en cascada). Las de dirección con la familia no tienen niño: son
--     del tutor;
--   · sus citas (`citas` reunion_familia, con `cita_invitados` en cascada);
--   · sus recordatorios (`recordatorios` familia_individual);
--   · sus respuestas a eventos (`confirmaciones_evento`; el evento es del centro y se queda).
--
-- No entra: lo que se conserva por obligación (firmas, autorizaciones, medicación administrada,
-- recibos), ni los eventos de ámbito niño (`eventos`), que no están en la tabla de plazos y de
-- los que cuelgan autorizaciones.
--
-- Ahora:
--
--   · `privado.olvido_borrar_operativa_nino(niño)`: borra esa operativa con `app.borrar_sin_copia`
--     (cada DELETE, también en cascada, se lleva sus copias) y después las copias que quedaban de
--     filas suyas borradas antes, que ya no tienen tabla en la que vivir: las que nombran al niño
--     y, en las tablas hijas, las de sus agendas, conversaciones y citas.
--   · `purgar_sujeto_db`: la rama del niño la llama antes de redactar su audit_log. El resto,
--     literal de 20261029120000.
--
-- La aplica el responsable por SQL Editor. Sin orden con el despliegue: no cambia ninguna firma
-- y el código no cambia. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_n   integer;
BEGIN
  IF to_regprocedure('privado.olvido_borrar_operativa_nino(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'ya aplicada: existe privado.olvido_borrar_operativa_nino';
  END IF;

  -- La purga que se reescribe es la de 20261029120000, tal como quedó.
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.purgar_sujeto_db(uuid)');
  IF v_md5 IS DISTINCT FROM 'aa27de309e12342106bd5551ef3cf166' THEN
    RAISE EXCEPTION 'purgar_sujeto_db no es la de 20261029120000: %', coalesce(v_md5, 'falta');
  END IF;

  -- El borrado sin copia depende del trigger de 20261129120000.
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.audit_trigger_function()');
  IF v_md5 IS DISTINCT FROM '66dd84be5ede18ca18cec3f9af1e926d' THEN
    RAISE EXCEPTION 'audit_trigger_function no es la de 20261129120000: %', coalesce(v_md5, 'falta');
  END IF;

  -- Los niños con un olvido confirmado y sin purgar: su próxima purga ya borrará su operativa.
  SELECT count(*) INTO v_n FROM public.olvido_solicitudes
   WHERE sujeto_tipo = 'nino' AND estado = 'confirmada' AND purgado_en IS NULL;
  RAISE NOTICE 'guarda previa: % olvidos de niño confirmados sin purgar', v_n;
END
$guarda$;

-- ---- 1. La operativa del niño, con sus copias ----
CREATE FUNCTION privado.olvido_borrar_operativa_nino(p_nino_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_nino    text := p_nino_id::text;
  v_agendas text[];
  v_convs   text[];
  v_citas   text[];
BEGIN
  -- Las madres del niño: las vivas y las que solo quedan en audit_log (borradas antes). Sus hijas
  -- no llevan nino_id; sus copias se encuentran por la madre.
  SELECT array_agg(id) INTO v_agendas FROM (
    SELECT id::text FROM public.agendas_diarias WHERE nino_id = p_nino_id
    UNION
    SELECT registro_id::text FROM public.audit_log
     WHERE tabla = 'agendas_diarias'
       AND (valores_antes->>'nino_id' = v_nino OR valores_despues->>'nino_id' = v_nino)) x;
  SELECT array_agg(id) INTO v_convs FROM (
    SELECT id::text FROM public.conversaciones WHERE nino_id = p_nino_id
    UNION
    SELECT registro_id::text FROM public.audit_log
     WHERE tabla = 'conversaciones'
       AND (valores_antes->>'nino_id' = v_nino OR valores_despues->>'nino_id' = v_nino)) x;
  SELECT array_agg(id) INTO v_citas FROM (
    SELECT id::text FROM public.citas WHERE nino_id = p_nino_id
    UNION
    SELECT registro_id::text FROM public.audit_log
     WHERE tabla = 'citas'
       AND (valores_antes->>'nino_id' = v_nino OR valores_despues->>'nino_id' = v_nino)) x;

  -- Sin humano, cada DELETE (también los de la cascada) se lleva sus copias (20261129120000).
  PERFORM set_config('app.borrar_sin_copia', 'on', true);
  DELETE FROM public.agendas_diarias       WHERE nino_id = p_nino_id;
  DELETE FROM public.asistencias           WHERE nino_id = p_nino_id;
  DELETE FROM public.ausencias             WHERE nino_id = p_nino_id;
  DELETE FROM public.informes_evolucion    WHERE nino_id = p_nino_id;
  DELETE FROM public.conversaciones        WHERE nino_id = p_nino_id;
  DELETE FROM public.citas                 WHERE nino_id = p_nino_id;
  DELETE FROM public.recordatorios         WHERE nino_id = p_nino_id;
  DELETE FROM public.confirmaciones_evento WHERE nino_id = p_nino_id;
  PERFORM set_config('app.borrar_sin_copia', '', true);

  -- Las copias que quedan: las de filas suyas borradas antes (su DELETE se auditó entero) y, si
  -- la purga corre con sesión, las que acaban de escribir estos DELETE.
  -- MUTACION: sin el borrado de las copias que quedan.
END;
$function$;
REVOKE ALL ON FUNCTION privado.olvido_borrar_operativa_nino(uuid) FROM PUBLIC, anon, authenticated;

-- ---- 2. La purga del niño la llama ----
CREATE OR REPLACE FUNCTION public.purgar_sujeto_db(p_solicitud_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s        public.olvido_solicitudes%ROWTYPE;
  v_nombre text;
  v_lista  uuid[];
  v_ft     uuid[];
  k_nino  text[] := ARRAY['nombre','apellidos','fecha_nacimiento','sexo','nacionalidad',
                          'foto_url','notas_admin'];
  k_med   text[] := ARRAY['alergias_graves','notas_emergencia','medicacion_habitual',
                          'alergias_leves','medico_familia','telefono_emergencia'];
  k_user  text[] := ARRAY['nombre_completo','foto_url'];
  k_ft    text[] := ARRAY['nombre_completo','email','direccion_calle','direccion_numero',
                          'direccion_cp','direccion_ciudad','dni_documento_path'];
  k_extra text[] := ARRAY['ip_address','user_agent','descripcion_parentesco',
                          'nombre_externo','observaciones','observaciones_generales',
                          'contenido','nombre_tecleado','comentario'];
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
  IF auth.uid() IS NOT NULL AND NOT privado.es_responsable(s.centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF s.purgado_en IS NOT NULL THEN
    RETURN;
  END IF;

  -- Grupo 1 (PR B): las filas de auditoría que escribe la purga llevan su etiqueta.
  PERFORM set_config('app.audit_actor', 'system:purgar_sujeto_db', true);

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
      -- Purga RGPD del niño: el resto de columnas personales de la ficha. idioma_principal
      -- es NOT NULL: 'zz' (no es un idioma, como en idiomas_casa) en vez de inventar 'es'. El
      -- CHECK solo admite 'zz' con deleted_reason = 'purga_rgpd', que pone este mismo UPDATE.
      idioma_principal     = 'zz',
      direccion_calle      = NULL,
      direccion_numero     = NULL,
      direccion_cp         = NULL,
      direccion_ciudad     = NULL,
      libro_familia_path   = NULL,
      estado_civil_familia = NULL,
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
      -- Purga RGPD del niño: el CHECK exige de 1 a 8 códigos de 2 letras; 'zz' no es un idioma.
      idiomas_casa                     = ARRAY['zz'],
      deleted_at                       = COALESCE(deleted_at, now())
    WHERE nino_id = s.sujeto_id;

    -- Purga RGPD del niño: el motivo de baja es texto libre del centro sobre el niño.
    UPDATE public.matriculas SET motivo_baja = NULL
    WHERE nino_id = s.sujeto_id AND motivo_baja IS NOT NULL;

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

    -- Cierre de la purga: los cambios pendientes del niño (su dirección, su libro de familia,
    -- los datos de sus tutores) se borran; el payload no entra en audit_log, solo la tabla lo
    -- guarda. Los documentos en Storage los borra antes el manifiesto de adjuntos.
    DELETE FROM public.cambios_pendientes WHERE nino_id = s.sujeto_id;

    -- Retención (F11-B, punto 6, PR-4): su operativa (agenda, asistencia, mensajes, informes,
    -- citas, recordatorios, respuestas a eventos) se borra, con sus copias en audit_log.
    PERFORM privado.olvido_borrar_operativa_nino(s.sujeto_id);

    -- Purga RGPD del niño: la copia en audit_log, con la lista de claves por tabla que
    -- comparte con purgar_esqueleto_huerfano_nino (_claves_pii_nino).
    PERFORM public._redactar_auditoria_nino(s.sujeto_id);

    -- Purga de lista_espera: el prospecto del niño se borra entero (la plaza no tiene sentido
    -- sin el niño). Su copia en audit_log se redacta por registro_id: así se alcanza también el
    -- INSERT, que nace con nino_id NULL, y el DELETE que acaba de escribir esta purga.
    WITH borrados AS (
      DELETE FROM public.lista_espera WHERE nino_id = s.sujeto_id RETURNING id
    )
    SELECT array_agg(id) INTO v_lista FROM borrados;
    UPDATE public.audit_log SET
      valores_antes   = public._redactar_jsonb(valores_antes,   public._claves_pii_nino('lista_espera')),
      valores_despues = public._redactar_jsonb(valores_despues, public._claves_pii_nino('lista_espera'))
    WHERE tabla = 'lista_espera' AND registro_id = ANY (v_lista);

  ELSE  -- usuario
    SELECT nombre_completo INTO v_nombre FROM public.usuarios WHERE id = s.sujeto_id;

    IF public.olvido_es_ultimo_centro(s.id) THEN
      -- Último centro: la cuenta entera y todo lo que quede, también lo de los centros sin
      -- solicitud. Es literal la rama del usuario de 20261019120000.
      IF v_nombre IS NOT NULL AND length(trim(v_nombre)) > 0 THEN
        UPDATE public.mensajes
          SET contenido = replace(contenido, v_nombre, '[borrado]')
          WHERE contenido LIKE '%' || v_nombre || '%';

        -- Grupo 1 (PR B): el nombre tampoco se queda en la auditoría de los mensajes: ni en la
        -- fila que acaba de escribir el UPDATE de arriba ni en las anteriores, de cualquier autor.
        UPDATE public.audit_log SET
          valores_antes = CASE WHEN strpos(valores_antes->>'contenido', v_nombre) > 0
            THEN jsonb_set(valores_antes, '{contenido}',
                           to_jsonb(replace(valores_antes->>'contenido', v_nombre, '[borrado]')))
            ELSE valores_antes END,
          valores_despues = CASE WHEN strpos(valores_despues->>'contenido', v_nombre) > 0
            THEN jsonb_set(valores_despues, '{contenido}',
                           to_jsonb(replace(valores_despues->>'contenido', v_nombre, '[borrado]')))
            ELSE valores_despues END
        WHERE tabla = 'mensajes'
          AND (strpos(valores_antes->>'contenido', v_nombre) > 0
               OR strpos(valores_despues->>'contenido', v_nombre) > 0);
      END IF;

      -- Cierre de la purga: también la foto de perfil (el objeto lo borra antes el manifiesto).
      UPDATE public.usuarios SET
        nombre_completo = '[borrado]',
        foto_url        = NULL,
        deleted_at      = COALESCE(deleted_at, now())
      WHERE id = s.sujeto_id;

      UPDATE public.consentimientos SET ip_address = NULL, user_agent = NULL
        WHERE usuario_id = s.sujeto_id;
      DELETE FROM public.push_subscriptions WHERE usuario_id = s.sujeto_id;
      -- Cierre de la purga: preferencias y lecturas, igual que los dispositivos.
      DELETE FROM public.preferencias_usuario WHERE usuario_id = s.sujeto_id;
      DELETE FROM public.lectura_conversacion WHERE usuario_id = s.sujeto_id;
      DELETE FROM public.lectura_anuncio      WHERE usuario_id = s.sujeto_id;

      -- Cierre de la purga: su perfil de tutor en familia_tutores. Se anonimiza y se da de baja;
      -- usuario_id, familia_id y rol_familia se quedan (seudónimos; el trigger los congela). No se
      -- asciende al otro tutor: lo decide la directora (promover_a_titular). Su copia en
      -- audit_log se redacta por registro_id, que alcanza también las filas de antes de tener
      -- cuenta. El DNI en Storage lo borra antes el manifiesto, por su ruta exacta.
      WITH anonimizados AS (
        UPDATE public.familia_tutores SET
          nombre_completo    = NULL,
          email              = NULL,
          direccion_calle    = NULL,
          direccion_numero   = NULL,
          direccion_cp       = NULL,
          direccion_ciudad   = NULL,
          dni_documento_path = NULL,
          deleted_at         = COALESCE(deleted_at, now())
        WHERE usuario_id = s.sujeto_id RETURNING id
      )
      SELECT array_agg(id) INTO v_ft FROM anonimizados;
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   k_ft),
        valores_despues = public._redactar_jsonb(valores_despues, k_ft)
      WHERE tabla = 'familia_tutores' AND registro_id = ANY (v_ft);

      -- Cierre de la purga: los cambios que pidió sobre sus propios datos de tutor (email,
      -- dirección, ruta de su DNI en el payload). Los que pidió sobre el niño son del niño.
      DELETE FROM public.cambios_pendientes
       WHERE solicitado_por = s.sujeto_id AND entidad IN ('datos_tutor', 'datos_tutor_dni');

      -- Cierre de la purga: su texto al responder a una cita (la auditoría la redacta k_extra).
      UPDATE public.cita_invitados SET comentario = NULL
       WHERE usuario_id = s.sujeto_id AND comentario IS NOT NULL;

      -- Purga de lista_espera: el teléfono y el email que el tutor dejó en sus prospectos. El
      -- prospecto es del niño y se queda; su copia en audit_log pierde esas dos claves.
      WITH limpiados AS (
        UPDATE public.lista_espera SET telefono_tutor = NULL, email_tutor = NULL
        WHERE tutor_usuario_id = s.sujeto_id RETURNING id
      )
      SELECT array_agg(id) INTO v_lista FROM limpiados;
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY['telefono_tutor', 'email_tutor']),
        valores_despues = public._redactar_jsonb(valores_despues, ARRAY['telefono_tutor', 'email_tutor'])
      WHERE tabla = 'lista_espera' AND registro_id = ANY (v_lista);

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
      WHERE registro_id = s.sujeto_id OR usuario_id = s.sujeto_id
         -- Grupo 1 (PR B): también las filas que LLEVAN al sujeto (vínculos, roles…), como su
         -- vínculo con descripcion_parentesco, escritas por otros o por esta misma purga.
         OR valores_antes->>'usuario_id'   = s.sujeto_id::text
         OR valores_despues->>'usuario_id' = s.sujeto_id::text;

      -- Grupo 1 (PR B): invitaciones. El paso 4 de la purga (purgar-vencidos.ts) ya marcó con
      -- '[borrado]' el email y el nombre de sus invitaciones; aquí se redactan sus copias en
      -- audit_log (la fila de ese UPDATE y las anteriores). Idempotente.
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY['email', 'nombre_completo']),
        valores_despues = public._redactar_jsonb(valores_despues, ARRAY['email', 'nombre_completo'])
      WHERE tabla = 'invitaciones'
        AND registro_id IN (SELECT i.id FROM public.invitaciones i WHERE i.email = '[borrado]');
    ELSE
      -- Multicentro (Fase 2 · PR B): le queda otro centro. Cada sentencia es la de la rama de
      -- arriba acotada a ESTE centro (s.centro_id). No se tocan usuarios, push, preferencias ni
      -- los consentimientos sin niño: son de la cuenta y se van con el último centro.

      -- Su nombre en los mensajes de las conversaciones de este centro, y en su auditoría.
      IF v_nombre IS NOT NULL AND length(trim(v_nombre)) > 0 THEN
        UPDATE public.mensajes
          SET contenido = replace(contenido, v_nombre, '[borrado]')
          WHERE contenido LIKE '%' || v_nombre || '%'
            AND conversacion_id IN (SELECT c.id FROM public.conversaciones c
                                     WHERE c.centro_id = s.centro_id);

        UPDATE public.audit_log SET
          valores_antes = CASE WHEN strpos(valores_antes->>'contenido', v_nombre) > 0
            THEN jsonb_set(valores_antes, '{contenido}',
                           to_jsonb(replace(valores_antes->>'contenido', v_nombre, '[borrado]')))
            ELSE valores_antes END,
          valores_despues = CASE WHEN strpos(valores_despues->>'contenido', v_nombre) > 0
            THEN jsonb_set(valores_despues, '{contenido}',
                           to_jsonb(replace(valores_despues->>'contenido', v_nombre, '[borrado]')))
            ELSE valores_despues END
        WHERE tabla = 'mensajes' AND centro_id = s.centro_id
          AND (strpos(valores_antes->>'contenido', v_nombre) > 0
               OR strpos(valores_despues->>'contenido', v_nombre) > 0);
      END IF;

      -- Los consentimientos ligados a un niño de este centro.
      UPDATE public.consentimientos SET ip_address = NULL, user_agent = NULL
        WHERE usuario_id = s.sujeto_id
          AND nino_id IN (SELECT n.id FROM public.ninos n WHERE n.centro_id = s.centro_id);
      -- Las lecturas de conversaciones y anuncios de este centro.
      DELETE FROM public.lectura_conversacion
        WHERE usuario_id = s.sujeto_id
          AND conversacion_id IN (SELECT c.id FROM public.conversaciones c
                                   WHERE c.centro_id = s.centro_id);
      DELETE FROM public.lectura_anuncio
        WHERE usuario_id = s.sujeto_id
          AND anuncio_id IN (SELECT a.id FROM public.anuncios a WHERE a.centro_id = s.centro_id);

      -- Su perfil de tutor en la familia de este centro (el DNI de esa familia lo borra antes el
      -- manifiesto, solo el de este centro).
      WITH anonimizados AS (
        UPDATE public.familia_tutores SET
          nombre_completo    = NULL,
          email              = NULL,
          direccion_calle    = NULL,
          direccion_numero   = NULL,
          direccion_cp       = NULL,
          direccion_ciudad   = NULL,
          dni_documento_path = NULL,
          deleted_at         = COALESCE(deleted_at, now())
        WHERE usuario_id = s.sujeto_id AND centro_id = s.centro_id RETURNING id
      )
      SELECT array_agg(id) INTO v_ft FROM anonimizados;
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   k_ft),
        valores_despues = public._redactar_jsonb(valores_despues, k_ft)
      WHERE tabla = 'familia_tutores' AND registro_id = ANY (v_ft);

      -- Los cambios que pidió sobre sus datos de tutor en este centro.
      DELETE FROM public.cambios_pendientes
       WHERE solicitado_por = s.sujeto_id AND entidad IN ('datos_tutor', 'datos_tutor_dni')
         AND centro_id = s.centro_id;

      -- Su texto al responder a las citas de este centro.
      UPDATE public.cita_invitados SET comentario = NULL
       WHERE usuario_id = s.sujeto_id AND comentario IS NOT NULL AND centro_id = s.centro_id;

      -- El teléfono y el email de sus prospectos de este centro.
      WITH limpiados AS (
        UPDATE public.lista_espera SET telefono_tutor = NULL, email_tutor = NULL
        WHERE tutor_usuario_id = s.sujeto_id AND centro_id = s.centro_id RETURNING id
      )
      SELECT array_agg(id) INTO v_lista FROM limpiados;
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY['telefono_tutor', 'email_tutor']),
        valores_despues = public._redactar_jsonb(valores_despues, ARRAY['telefono_tutor', 'email_tutor'])
      WHERE tabla = 'lista_espera' AND registro_id = ANY (v_lista);

      -- Sus roles en este centro y sus vínculos con niños de este centro.
      UPDATE public.roles_usuario SET
        deleted_reason = 'purga_rgpd',
        deleted_at     = COALESCE(deleted_at, now())
        WHERE usuario_id = s.sujeto_id AND centro_id = s.centro_id;
      UPDATE public.vinculos_familiares SET
        descripcion_parentesco = NULL,
        deleted_reason         = 'purga_rgpd',
        deleted_at             = COALESCE(deleted_at, now())
      WHERE usuario_id = s.sujeto_id
        AND nino_id IN (SELECT n.id FROM public.ninos n WHERE n.centro_id = s.centro_id);

      -- Su auditoría en este centro. Las filas sin centro (las de usuarios) son de la cuenta.
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   k_user || k_extra),
        valores_despues = public._redactar_jsonb(valores_despues, k_user || k_extra)
      WHERE centro_id = s.centro_id
        AND (registro_id = s.sujeto_id OR usuario_id = s.sujeto_id
             OR valores_antes->>'usuario_id'   = s.sujeto_id::text
             OR valores_despues->>'usuario_id' = s.sujeto_id::text);

      -- Sus invitaciones de este centro (purgar-vencidos.ts las marca antes, solo las de este
      -- centro), y su auditoría.
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY['email', 'nombre_completo']),
        valores_despues = public._redactar_jsonb(valores_despues, ARRAY['email', 'nombre_completo'])
      WHERE tabla = 'invitaciones' AND centro_id = s.centro_id
        AND registro_id IN (SELECT i.id FROM public.invitaciones i
                             WHERE i.email = '[borrado]' AND i.centro_id = s.centro_id);
    END IF;
  END IF;

  UPDATE public.olvido_solicitudes SET purgado_en = now() WHERE id = p_solicitud_id;
  PERFORM set_config('app.audit_actor', '', true);
END $function$;

-- public.set_datos_acreedor(p_centro_id uuid, p_identificador_acreedor text, p_bic_acreedor text, p_iban text): 1 llamada
CREATE OR REPLACE FUNCTION public.set_datos_acreedor(p_centro_id uuid, p_identificador_acreedor text, p_bic_acreedor text, p_iban text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clave text;
  v_iban  text := btrim(coalesce(p_iban, ''));
BEGIN
  IF NOT privado.es_responsable(p_centro_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  UPDATE public.centros SET
    identificador_acreedor = nullif(btrim(coalesce(p_identificador_acreedor, '')), ''),
    bic_acreedor           = nullif(btrim(coalesce(p_bic_acreedor, '')), '')
  WHERE id = p_centro_id;

  IF v_iban <> '' THEN
    IF char_length(v_iban) < 15 OR char_length(v_iban) > 34 THEN
      RAISE EXCEPTION 'IBAN inválido';
    END IF;
    v_clave := public._get_sepa_key();
    UPDATE public.centros
      SET iban_acreedor_cifrado = pgp_sym_encrypt(v_iban, v_clave)
      WHERE id = p_centro_id;
  END IF;
END;
$function$;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF has_function_privilege('authenticated', 'privado.olvido_borrar_operativa_nino(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'privado.olvido_borrar_operativa_nino(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.purgar_sujeto_db(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.purgar_sujeto_db(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'una función del olvido quedó abierta a quien no toca';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.purgar_sujeto_db(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'purgar_sujeto_db perdió el EXECUTE de service_role';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.purgar_sujeto_db(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'purgar_sujeto_db tiene que ser SECURITY DEFINER';
  END IF;

  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.purgar_sujeto_db(uuid)'::regprocedure;
  IF strpos((SELECT prosrc FROM pg_proc WHERE oid = 'public.purgar_sujeto_db(uuid)'::regprocedure),
            'privado.olvido_borrar_operativa_nino(s.sujeto_id)') = 0 THEN
    RAISE EXCEPTION 'purgar_sujeto_db no llama a olvido_borrar_operativa_nino';
  END IF;
  RAISE NOTICE 'guarda posterior: purgar_sujeto_db %', v_md5;
END
$guarda$;
