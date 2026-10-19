-- =============================================================================
-- Multicentro · avatar de usuario con prefijo propio: usuarios-fotos/{usuarioId}/…
--
-- La ruta {centroId}/{usuarioId}/… (20260622100000) ataba la foto de una persona a UN centro,
-- y una persona puede tener rol en varios. Decisión del responsable (2026-10-19): opción (b),
-- prefijo del propio usuario. Quién la ve y quién la cambia sale de los centros donde el dueño
-- tiene rol, no de la ruta.
--
-- Medido en producción (read_only, 2026-10-19): 0 objetos en usuarios-fotos; 2 usuarios con
-- foto_url {centro}/{usuario}/….jpg que no apunta a ningún objeto de ningún bucket; 0 filas
-- de usuarios en audit_log. No hay nada que mover en Storage.
--
-- 1. Guarda de entrada: las 4 políticas y purgar_sujeto_db son las esperadas, y no hay
--    ningún objeto con la ruta vieja (un objeto no se mueve por SQL: si lo hubiera, aborta).
-- 2. Datos: las foto_url que no apuntan a ningún objeto del bucket, a NULL (decisión del
--    responsable: la BD dice la verdad en vez de guardar una ruta falsa). Se imprime la cuenta:
--    2 en producción, 0 en la base vacía del CI.
-- 3. es_staff_de_usuario(dueño) / es_admin_de_usuario(dueño): el usuario actual es admin o
--    profe (o solo admin) de algún centro donde el dueño tiene rol activo.
-- 4. Las 4 políticas, con [1]=usuarioId: leer = el dueño o staff de un centro del dueño;
--    escribir = el dueño o admin de un centro del dueño.
-- 5. purgar_sujeto_db: 'foto_url' entra en las claves que se redactan del usuario en
--    audit_log (k_user), como ya pasa con la del niño (k_nino). Sin esto, el paso 2 y cada
--    subida de avatar dejarían en la auditoría una ruta que la purga no sabe limpiar. El resto
--    de la función es literal la de 20261015120000.
--
-- ORDEN: va a producción ANTES del merge. El código nuevo sube a {usuarioId}/… y llama a
-- es_admin_de_usuario; con las políticas viejas la subida fallaría.
-- =============================================================================

-- 0. Foto previa y guarda de entrada.
CREATE TEMP TABLE _avatar_antes AS
SELECT p.prosrc, p.prosecdef, p.proconfig, p.proacl::text AS proacl
  FROM pg_proc p WHERE p.oid = 'public.purgar_sujeto_db(uuid)'::regprocedure;

DO $guarda$
DECLARE
  f        text[] := '{}';
  r        record;
  v_md5    text;
  v_viejos int;
BEGIN
  SELECT md5(regexp_replace(regexp_replace(replace(prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM _avatar_antes;
  IF v_md5 IS DISTINCT FROM 'bb60efb570e3c0d936933e6dc4552ccc' THEN
    f := f || format('purgar_sujeto_db no es la de 20261015120000 (md5 normalizado %s)', v_md5);
  END IF;

  FOR r IN SELECT n.nombre,
                  (SELECT md5(coalesce(qual, '') || '|' || coalesce(with_check, '')) FROM pg_policies
                    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = n.nombre) AS m,
                  n.esperado
             FROM (VALUES ('usuarios_fotos_select', 'fcd8a9aca2ff12fe85923cb194cc2e35'),
                          ('usuarios_fotos_insert', 'e259e3b939d09385bb4e26a40d71f7e4'),
                          ('usuarios_fotos_update', 'ca4d2b00f9c624484e8fb58f7e8bd891'),
                          ('usuarios_fotos_delete', '20938472a481898bcb21996984acd659')) n(nombre, esperado) LOOP
    IF r.m IS DISTINCT FROM r.esperado THEN
      f := f || format('%s no es la de 20260622100000 (md5 %s)', r.nombre, r.m);
    END IF;
  END LOOP;

  IF to_regprocedure('public.es_staff_de_usuario(uuid)') IS NOT NULL
     OR to_regprocedure('public.es_admin_de_usuario(uuid)') IS NOT NULL THEN
    f := f || 'es_staff_de_usuario / es_admin_de_usuario ya existen'::text;
  END IF;

  -- Ruta nueva = una sola carpeta ({usuarioId}); cualquier otra forma es la vieja.
  SELECT count(*) INTO v_viejos FROM storage.objects
   WHERE bucket_id = 'usuarios-fotos' AND cardinality(storage.foldername(name)) <> 1;
  IF v_viejos > 0 THEN
    f := f || format('%s objeto(s) de usuarios-fotos con la ruta vieja: moverlos no se hace por SQL', v_viejos);
  END IF;

  IF cardinality(f) > 0 THEN
    RAISE EXCEPTION 'guarda de entrada: %', array_to_string(f, ' | ');
  END IF;
  RAISE NOTICE 'guarda de entrada OK: políticas y purga esperadas, % objetos con la ruta vieja', v_viejos;
END
$guarda$;

-- 2. Las foto_url que no apuntan a ningún objeto del bucket, a NULL.
DO $datos$
DECLARE
  v_n int;
BEGIN
  PERFORM set_config('app.audit_actor', 'system:migracion_avatar_prefijo', true);
  UPDATE public.usuarios u SET foto_url = NULL
   WHERE u.foto_url IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM storage.objects o
                      WHERE o.bucket_id = 'usuarios-fotos' AND o.name = u.foto_url);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('app.audit_actor', '', true);
  -- Producción, medido el 2026-10-19: 2. La base vacía del CI: 0 (lo cubre usuarios-fotos.rls).
  RAISE NOTICE 'foto_url sin objeto puestas a NULL: %', v_n;
END
$datos$;

COMMENT ON COLUMN public.usuarios.foto_url IS
  'Ruta del avatar en el bucket privado usuarios-fotos ({usuarioId}/...). Se firma para mostrar. Opcional (NULL = sin foto). Patrón ninos.foto_url.';

-- 3. Helpers: el usuario actual es staff / admin de algún centro donde el dueño tiene rol.
CREATE OR REPLACE FUNCTION public.es_staff_de_usuario(p_usuario_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.roles_usuario yo
      JOIN public.roles_usuario el ON el.centro_id = yo.centro_id
     WHERE yo.usuario_id = auth.uid() AND yo.rol IN ('admin', 'profe') AND yo.deleted_at IS NULL
       AND el.usuario_id = p_usuario_id AND el.deleted_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.es_admin_de_usuario(p_usuario_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.roles_usuario yo
      JOIN public.roles_usuario el ON el.centro_id = yo.centro_id
     WHERE yo.usuario_id = auth.uid() AND yo.rol = 'admin' AND yo.deleted_at IS NULL
       AND el.usuario_id = p_usuario_id AND el.deleted_at IS NULL
  );
$$;

REVOKE ALL ON FUNCTION public.es_staff_de_usuario(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.es_admin_de_usuario(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.es_staff_de_usuario(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.es_admin_de_usuario(uuid) TO authenticated;

-- 4. Políticas. Ruta: {usuarioId}/...  → [1]=usuarioId (el dueño).
DROP POLICY "usuarios_fotos_select" ON storage.objects;
DROP POLICY "usuarios_fotos_insert" ON storage.objects;
DROP POLICY "usuarios_fotos_update" ON storage.objects;
DROP POLICY "usuarios_fotos_delete" ON storage.objects;

-- Leer: el dueño, o admin/profe de un centro donde el dueño tiene rol.
CREATE POLICY "usuarios_fotos_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'usuarios-fotos'
    AND (
      ((storage.foldername(name))[1])::uuid = auth.uid()
      OR public.es_staff_de_usuario(((storage.foldername(name))[1])::uuid)
    )
  );
-- Escribir: el dueño, o admin de un centro donde el dueño tiene rol.
CREATE POLICY "usuarios_fotos_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'usuarios-fotos'
    AND (
      ((storage.foldername(name))[1])::uuid = auth.uid()
      OR public.es_admin_de_usuario(((storage.foldername(name))[1])::uuid)
    )
  );
-- Actualizar (overwrite/upsert): el dueño, o admin de un centro donde el dueño tiene rol.
CREATE POLICY "usuarios_fotos_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'usuarios-fotos'
    AND (
      ((storage.foldername(name))[1])::uuid = auth.uid()
      OR public.es_admin_de_usuario(((storage.foldername(name))[1])::uuid)
    )
  )
  WITH CHECK (
    bucket_id = 'usuarios-fotos'
    AND (
      ((storage.foldername(name))[1])::uuid = auth.uid()
      OR public.es_admin_de_usuario(((storage.foldername(name))[1])::uuid)
    )
  );
-- Borrar: el dueño, o admin de un centro donde el dueño tiene rol.
CREATE POLICY "usuarios_fotos_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'usuarios-fotos'
    AND (
      ((storage.foldername(name))[1])::uuid = auth.uid()
      OR public.es_admin_de_usuario(((storage.foldername(name))[1])::uuid)
    )
  );

-- 5. purgar_sujeto_db: la de 20261015120000 con 'foto_url' en k_user.
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
  END IF;

  UPDATE public.olvido_solicitudes SET purgado_en = now() WHERE id = p_solicitud_id;
  PERFORM set_config('app.audit_actor', '', true);
END $function$;

-- 6. Guarda de salida.
DO $guarda$
DECLARE
  f   text[] := '{}';
  r   record;
  v_n int;
BEGIN
  -- Las 4 políticas existen, miran al dueño y no a un centro de la ruta.
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'usuarios_fotos%';
  IF v_n <> 4 THEN f := f || format('%s políticas usuarios_fotos_* (se esperaban 4)', v_n); END IF;
  FOR r IN SELECT policyname, coalesce(qual, '') || coalesce(with_check, '') AS def FROM pg_policies
            WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'usuarios_fotos%' LOOP
    IF r.def !~ '_de_usuario\(' OR r.def ~ 'es_admin\(|es_profe_en_centro\(|\[2\]' THEN
      f := f || format('%s no es la nueva', r.policyname);
    END IF;
  END LOOP;

  -- Ninguna foto_url apunta a la nada, y no queda ningún objeto con la ruta vieja.
  SELECT count(*) INTO v_n FROM public.usuarios u
   WHERE u.foto_url IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM storage.objects o
                      WHERE o.bucket_id = 'usuarios-fotos' AND o.name = u.foto_url);
  IF v_n > 0 THEN f := f || format('%s foto_url sin objeto', v_n); END IF;
  SELECT count(*) INTO v_n FROM storage.objects
   WHERE bucket_id = 'usuarios-fotos' AND cardinality(storage.foldername(name)) <> 1;
  IF v_n > 0 THEN f := f || format('%s objetos con la ruta vieja', v_n); END IF;

  -- Helpers: SECURITY DEFINER, search_path fijo, authenticated sí y anon no.
  FOR r IN SELECT p.oid::regprocedure::text AS fn, p.prosecdef, p.proconfig, p.oid FROM pg_proc p
            WHERE p.oid IN ('public.es_staff_de_usuario(uuid)'::regprocedure,
                            'public.es_admin_de_usuario(uuid)'::regprocedure) LOOP
    IF NOT r.prosecdef OR NOT COALESCE('search_path=public' = ANY (r.proconfig), false)
       OR has_function_privilege('anon', r.oid, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      f := f || format('%s: seguridad o permisos no son los esperados', r.fn);
    END IF;
  END LOOP;

  -- purgar_sujeto_db: redacta foto_url del usuario y conserva seguridad, configuración y permisos.
  FOR r IN SELECT a.prosecdef, a.proconfig, a.proacl, p.prosrc AS src1,
                  p.prosecdef AS sec1, p.proconfig AS cfg1, p.proacl::text AS acl1
             FROM _avatar_antes a, pg_proc p WHERE p.oid = 'public.purgar_sujeto_db(uuid)'::regprocedure LOOP
    IF r.sec1 IS DISTINCT FROM r.prosecdef OR r.cfg1 IS DISTINCT FROM r.proconfig
       OR r.acl1 IS DISTINCT FROM r.proacl THEN
      f := f || 'purgar_sujeto_db: cambió su seguridad, configuración o permisos'::text;
    END IF;
    -- Espacios colapsados: el SQL Editor reescribe saltos y comentarios del cuerpo.
    IF strpos(regexp_replace(r.src1, '\s+', ' ', 'g'),
              'k_user text[] := ARRAY[''nombre_completo'',''foto_url''];') = 0 THEN
      f := f || 'purgar_sujeto_db: k_user no lleva foto_url'::text;
    END IF;
  END LOOP;

  IF cardinality(f) > 0 THEN
    RAISE EXCEPTION 'guarda de salida: %', array_to_string(f, ' | ');
  END IF;
  RAISE NOTICE 'avatar con prefijo de usuario: guardas de salida OK';
END
$guarda$;

DROP TABLE _avatar_antes;
