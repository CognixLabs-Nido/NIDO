-- =============================================================================
-- Multicentro · Fase 2 · PR B: el olvido es por centro, la purga se parte en dos y el hilo
-- dirección↔familia es por centro.
--
-- Decisiones del responsable (2026-10-19): cada centro es independiente. El olvido se pide en
-- un centro (el activo de la directora, que tiene que ser admin en él). Al pedirlo se retiran
-- los roles de ESE centro, y la cuenta (usuarios.deleted_at) se bloquea solo si no le queda
-- ningún otro. La purga borra lo que tiene centro por centro; lo que no tiene centro es de la
-- cuenta y se va con el último centro, junto con «el resto» (lo de centros sin solicitud).
--
-- 1. Guarda de entrada: purgar_sujeto_db, solicitar_olvido_usuario y solicitar_olvido_nino son
--    las vivas (md5 de la lógica normalizada), los dos índices son los esperados y lo nuevo no
--    existe. Imprime cuántas solicitudes pendientes y cuántos hilos dirección↔familia hay.
-- 2. olvido_solicitudes: una solicitud pendiente por sujeto Y CENTRO (antes, por sujeto).
-- 3. conversaciones: un hilo dirección↔familia por admin, tutor Y CENTRO (antes, por par).
-- 4. olvido_es_ultimo_centro(solicitud): ¿le queda otro centro al sujeto? Un rol vivo en otro
--    centro u otra solicitud pendiente. La usan purgar_sujeto_db y purgar-vencidos.ts (Auth,
--    invitaciones, DNI y avatar), para que la BD y la app decidan lo mismo. Solo service_role.
-- 5. solicitar_olvido_usuario(usuario, centro, inmediato): el centro es explícito (antes, el del
--    rol más antiguo); retira los roles de ese centro; bloquea la cuenta solo si no le queda
--    otro. La versión sin centro desaparece.
-- 6. solicitar_olvido_nino: solo cambia el ON CONFLICT, que tiene que nombrar el índice nuevo.
-- 7. purgar_sujeto_db: la rama del niño no cambia. La del usuario: si es el último centro, hace
--    LITERALMENTE lo de antes (la cuenta entera y todo lo que quede); si no, lo mismo acotado a
--    s.centro_id, sin tocar la cuenta. Lo que cada sentencia acota está en su comentario.
-- 8. Guarda de salida.
--
-- ORDEN: va a producción ANTES del merge. Entre la migración y el despliegue, el código viejo
-- llama a solicitar_olvido_usuario sin centro (ya no existe: la solicitud falla con un error, no
-- hay ninguna llamada desde la interfaz) y abre hilos dirección↔familia buscando por par (el
-- índice nuevo admite lo mismo que el viejo y más). purgar-vencidos.ts viejo con la purga nueva:
-- con un solo centro hace lo mismo que hoy; con dos, la parte de Auth del código viejo bloquea
-- la cuenta antes de tiempo. En producción hay 0 solicitudes pendientes (medido 2026-10-19).
-- =============================================================================

-- 0. Foto previa (seguridad, configuración y permisos) para compararla en la salida.
CREATE TEMP TABLE _olvido_antes AS
SELECT p.proname::text AS nombre, p.prosecdef, p.proconfig, p.proacl::text AS proacl
  FROM pg_proc p
 WHERE p.oid IN ('public.purgar_sujeto_db(uuid)'::regprocedure,
                 'public.solicitar_olvido_nino(uuid,boolean)'::regprocedure);

-- 1. Guarda de entrada.
DO $guarda$
DECLARE
  f   text[] := '{}';
  r   record;
  v_n int;
  v_h int;
BEGIN
  FOR r IN SELECT e.firma, e.esperado,
                  (SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
                     FROM pg_proc p WHERE p.oid = to_regprocedure(e.firma)) AS m
             FROM (VALUES ('public.purgar_sujeto_db(uuid)',                  '916f43585884c9bab691a7a90c81fc31'),
                          ('public.solicitar_olvido_usuario(uuid,boolean)',  'fe1c18387dbce00ba82565c471ba602e'),
                          ('public.solicitar_olvido_nino(uuid,boolean)',     '154315cf7c37e5e41fc9337a83ba5e29')) e(firma, esperado) LOOP
    IF r.m IS DISTINCT FROM r.esperado THEN
      f := f || format('%s no es la viva esperada (md5 normalizado %s)', r.firma, coalesce(r.m, 'no existe'));
    END IF;
  END LOOP;

  IF (SELECT pg_get_indexdef(to_regclass('public.olvido_solicitudes_sujeto_pendiente')))
     IS DISTINCT FROM 'CREATE UNIQUE INDEX olvido_solicitudes_sujeto_pendiente ON public.olvido_solicitudes USING btree (sujeto_tipo, sujeto_id) WHERE (purgado_en IS NULL)' THEN
    f := f || 'olvido_solicitudes_sujeto_pendiente no es el esperado'::text;
  END IF;
  IF (SELECT pg_get_indexdef(to_regclass('public.idx_conv_admin_familia_unique')))
     IS DISTINCT FROM 'CREATE UNIQUE INDEX idx_conv_admin_familia_unique ON public.conversaciones USING btree (admin_id, tutor_id) WHERE (tipo_conversacion = ''admin_familia''::tipo_conversacion)' THEN
    f := f || 'idx_conv_admin_familia_unique no es el esperado'::text;
  END IF;

  IF to_regprocedure('public.olvido_es_ultimo_centro(uuid)') IS NOT NULL
     OR to_regprocedure('public.solicitar_olvido_usuario(uuid,uuid,boolean)') IS NOT NULL
     OR to_regclass('public.olvido_solicitudes_sujeto_centro_pendiente') IS NOT NULL
     OR to_regclass('public.idx_conv_admin_familia_centro_unique') IS NOT NULL THEN
    f := f || 'lo nuevo ya existe'::text;
  END IF;

  IF cardinality(f) > 0 THEN
    RAISE EXCEPTION 'guarda de entrada: %', array_to_string(f, ' | ');
  END IF;

  SELECT count(*) INTO v_n FROM public.olvido_solicitudes WHERE purgado_en IS NULL;
  SELECT count(*) INTO v_h FROM public.conversaciones WHERE tipo_conversacion = 'admin_familia';
  -- Producción, medido el 2026-10-19: 0 y 0. La base vacía del CI: 0 y 0.
  RAISE NOTICE 'guarda de entrada OK: % solicitudes pendientes, % hilos dirección↔familia', v_n, v_h;
END
$guarda$;

-- 2. Una solicitud pendiente por sujeto y centro. El índice nuevo es más ancho que el viejo:
--    ninguna fila que cumpla el viejo puede romperlo.
DROP INDEX public.olvido_solicitudes_sujeto_pendiente;
CREATE UNIQUE INDEX olvido_solicitudes_sujeto_centro_pendiente
  ON public.olvido_solicitudes (sujeto_tipo, sujeto_id, centro_id)
  WHERE purgado_en IS NULL;

-- 3. Un hilo dirección↔familia por admin, tutor y centro. Igual: más ancho que el viejo.
DROP INDEX public.idx_conv_admin_familia_unique;
CREATE UNIQUE INDEX idx_conv_admin_familia_centro_unique
  ON public.conversaciones (admin_id, tutor_id, centro_id)
  WHERE tipo_conversacion = 'admin_familia';

-- 4. ¿Es el último centro del sujeto? Para un niño, siempre (es de un solo centro). Para un
--    usuario: no le queda ningún rol vivo en otro centro ni otra solicitud pendiente (la de
--    otro centro, que se purgará después y será la última).
CREATE FUNCTION public.olvido_es_ultimo_centro(p_solicitud_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.sujeto_tipo <> 'usuario'
      OR (NOT EXISTS (SELECT 1 FROM public.roles_usuario r
                       WHERE r.usuario_id = s.sujeto_id AND r.deleted_at IS NULL
                         AND r.centro_id <> s.centro_id)
          AND NOT EXISTS (SELECT 1 FROM public.olvido_solicitudes o
                           WHERE o.sujeto_tipo = 'usuario' AND o.sujeto_id = s.sujeto_id
                             AND o.purgado_en IS NULL AND o.id <> s.id))
  FROM public.olvido_solicitudes s
  WHERE s.id = p_solicitud_id;
$$;

REVOKE ALL ON FUNCTION public.olvido_es_ultimo_centro(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.olvido_es_ultimo_centro(uuid) TO service_role;

-- 5. solicitar_olvido_usuario con el centro explícito. La versión sin centro desaparece.
DROP FUNCTION public.solicitar_olvido_usuario(uuid, boolean);

CREATE FUNCTION public.solicitar_olvido_usuario(p_usuario_id uuid, p_centro_id uuid, p_inmediato boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gracia timestamptz;
  v_id     uuid;
BEGIN
  IF auth.uid() IS NULL
     AND NOT (COALESCE(auth.role(), '') = 'service_role'
              OR (session_user <> 'authenticator'
                  AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                  AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
    RAISE EXCEPTION 'no autorizado: sin sesión solo el servicio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE id = p_usuario_id) THEN
    RAISE EXCEPTION 'usuario no encontrado: %', p_usuario_id USING ERRCODE = 'no_data_found';
  END IF;
  -- Multicentro: el centro lo dice quien pide (la directora, desde su centro activo), no se
  -- deduce del rol más antiguo. Un centro inexistente no pasa por es_admin(NULL).
  IF NOT EXISTS (SELECT 1 FROM public.centros WHERE id = p_centro_id) THEN
    RAISE EXCEPTION 'centro no encontrado: %', p_centro_id USING ERRCODE = 'no_data_found';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.es_admin(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado a ejercer el olvido en este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- El usuario está o estuvo en el centro: un rol (vivo o retirado) o un perfil de tutor.
  IF NOT EXISTS (SELECT 1 FROM public.roles_usuario
                  WHERE usuario_id = p_usuario_id AND centro_id = p_centro_id)
     AND NOT EXISTS (SELECT 1 FROM public.familia_tutores
                      WHERE usuario_id = p_usuario_id AND centro_id = p_centro_id) THEN
    RAISE EXCEPTION 'el usuario no está en este centro' USING ERRCODE = 'no_data_found';
  END IF;

  v_gracia := CASE WHEN p_inmediato THEN now() ELSE now() + interval '30 days' END;

  -- Se retiran sus roles en ESTE centro. La purga los pasa después a 'purga_rgpd'.
  UPDATE public.roles_usuario
     SET deleted_at = now(), deleted_reason = 'solicitud_olvido'
   WHERE usuario_id = p_usuario_id AND centro_id = p_centro_id AND deleted_at IS NULL;

  -- La cuenta se bloquea solo si no le queda ningún otro centro.
  IF NOT EXISTS (SELECT 1 FROM public.roles_usuario
                  WHERE usuario_id = p_usuario_id AND deleted_at IS NULL
                    AND centro_id <> p_centro_id) THEN
    UPDATE public.usuarios SET deleted_at = COALESCE(deleted_at, now()) WHERE id = p_usuario_id;
  END IF;

  INSERT INTO public.olvido_solicitudes
    (sujeto_tipo, sujeto_id, centro_id, solicitado_por, gracia_hasta, inmediato)
  VALUES ('usuario', p_usuario_id, p_centro_id, auth.uid(), v_gracia, p_inmediato)
  ON CONFLICT (sujeto_tipo, sujeto_id, centro_id) WHERE purgado_en IS NULL
  DO UPDATE SET
    gracia_hasta = LEAST(public.olvido_solicitudes.gracia_hasta, EXCLUDED.gracia_hasta),
    inmediato    = public.olvido_solicitudes.inmediato OR EXCLUDED.inmediato
  RETURNING id INTO v_id;

  RETURN v_id;
END $function$;

REVOKE ALL ON FUNCTION public.solicitar_olvido_usuario(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.solicitar_olvido_usuario(uuid, uuid, boolean) TO authenticated, service_role;

-- 6. solicitar_olvido_nino: la de 20261002140000; solo cambia el ON CONFLICT (el índice nuevo).
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
  ON CONFLICT (sujeto_tipo, sujeto_id, centro_id) WHERE purgado_en IS NULL
  DO UPDATE SET
    gracia_hasta = LEAST(public.olvido_solicitudes.gracia_hasta, EXCLUDED.gracia_hasta),
    inmediato    = public.olvido_solicitudes.inmediato OR EXCLUDED.inmediato
  RETURNING id INTO v_id;

  RETURN v_id;
END $function$;

-- 7. purgar_sujeto_db: la de 20261019120000, con la rama del usuario partida.
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
  IF auth.uid() IS NOT NULL AND NOT public.es_admin(s.centro_id) THEN
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

-- 8. Guarda de salida.
DO $guarda$
DECLARE
  f   text[] := '{}';
  r   record;
BEGIN
  IF to_regclass('public.olvido_solicitudes_sujeto_pendiente') IS NOT NULL
     OR to_regclass('public.idx_conv_admin_familia_unique') IS NOT NULL THEN
    f := f || 'sigue algún índice viejo'::text;
  END IF;
  IF (SELECT pg_get_indexdef(to_regclass('public.olvido_solicitudes_sujeto_centro_pendiente')))
     IS DISTINCT FROM 'CREATE UNIQUE INDEX olvido_solicitudes_sujeto_centro_pendiente ON public.olvido_solicitudes USING btree (sujeto_tipo, sujeto_id, centro_id) WHERE (purgado_en IS NULL)' THEN
    f := f || 'olvido_solicitudes_sujeto_centro_pendiente no es el esperado'::text;
  END IF;
  IF (SELECT pg_get_indexdef(to_regclass('public.idx_conv_admin_familia_centro_unique')))
     IS DISTINCT FROM 'CREATE UNIQUE INDEX idx_conv_admin_familia_centro_unique ON public.conversaciones USING btree (admin_id, tutor_id, centro_id) WHERE (tipo_conversacion = ''admin_familia''::tipo_conversacion)' THEN
    f := f || 'idx_conv_admin_familia_centro_unique no es el esperado'::text;
  END IF;

  IF to_regprocedure('public.solicitar_olvido_usuario(uuid,boolean)') IS NOT NULL THEN
    f := f || 'solicitar_olvido_usuario sin centro sigue existiendo'::text;
  END IF;

  -- Permisos de lo nuevo: solicitar con sesión (authenticated) sí; anon nunca; es_ultimo solo el servicio.
  IF has_function_privilege('anon', 'public.solicitar_olvido_usuario(uuid,uuid,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.solicitar_olvido_usuario(uuid,uuid,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.solicitar_olvido_usuario(uuid,uuid,boolean)', 'EXECUTE') THEN
    f := f || 'solicitar_olvido_usuario(uuid,uuid,boolean): permisos no esperados'::text;
  END IF;
  IF has_function_privilege('anon', 'public.olvido_es_ultimo_centro(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.olvido_es_ultimo_centro(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.olvido_es_ultimo_centro(uuid)', 'EXECUTE') THEN
    f := f || 'olvido_es_ultimo_centro: permisos no esperados'::text;
  END IF;
  FOR r IN SELECT p.oid::regprocedure::text AS fn, p.prosecdef, p.proconfig FROM pg_proc p
            WHERE p.oid IN ('public.solicitar_olvido_usuario(uuid,uuid,boolean)'::regprocedure,
                            'public.olvido_es_ultimo_centro(uuid)'::regprocedure) LOOP
    IF NOT r.prosecdef OR NOT COALESCE('search_path=public' = ANY (r.proconfig), false) THEN
      f := f || format('%s: no es SECURITY DEFINER con search_path=public', r.fn);
    END IF;
  END LOOP;

  -- purgar_sujeto_db y solicitar_olvido_nino conservan seguridad, configuración y permisos.
  FOR r IN SELECT a.nombre, a.prosecdef, a.proconfig, a.proacl,
                  p.prosecdef AS sec1, p.proconfig AS cfg1, p.proacl::text AS acl1
             FROM _olvido_antes a JOIN pg_proc p ON p.proname = a.nombre
            WHERE p.oid IN ('public.purgar_sujeto_db(uuid)'::regprocedure,
                            'public.solicitar_olvido_nino(uuid,boolean)'::regprocedure) LOOP
    IF r.sec1 IS DISTINCT FROM r.prosecdef OR r.cfg1 IS DISTINCT FROM r.proconfig
       OR r.acl1 IS DISTINCT FROM r.proacl THEN
      f := f || format('%s: cambió su seguridad, configuración o permisos', r.nombre);
    END IF;
  END LOOP;

  -- Los dos ON CONFLICT y la purga nombran lo nuevo (espacios colapsados: el SQL Editor
  -- reescribe saltos y comentarios del cuerpo).
  FOR r IN SELECT p.oid::regprocedure::text AS fn, regexp_replace(p.prosrc, '\s+', ' ', 'g') AS src
             FROM pg_proc p
            WHERE p.oid IN ('public.solicitar_olvido_nino(uuid,boolean)'::regprocedure,
                            'public.solicitar_olvido_usuario(uuid,uuid,boolean)'::regprocedure) LOOP
    IF strpos(r.src, 'ON CONFLICT (sujeto_tipo, sujeto_id, centro_id) WHERE purgado_en IS NULL') = 0 THEN
      f := f || format('%s: el ON CONFLICT no nombra el índice nuevo', r.fn);
    END IF;
  END LOOP;
  IF strpos((SELECT prosrc FROM pg_proc WHERE oid = 'public.purgar_sujeto_db(uuid)'::regprocedure),
            'public.olvido_es_ultimo_centro(s.id)') = 0 THEN
    f := f || 'purgar_sujeto_db no pregunta si es el último centro'::text;
  END IF;

  IF cardinality(f) > 0 THEN
    RAISE EXCEPTION 'guarda de salida: %', array_to_string(f, ' | ');
  END IF;
  RAISE NOTICE 'olvido por centro: guardas de salida OK';
END
$guarda$;

DROP TABLE _olvido_antes;
