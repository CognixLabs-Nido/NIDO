-- =============================================================================
-- Purga RGPD y lista_espera: la tabla real Y su copia en audit_log.
--
-- Entrada (verificada en vivo, read_only, 2026-10-12): purgar_sujeto_db, _claves_pii_nino y
-- purgar_esqueleto_huerfano_nino son las de 20261011140000 (lógica normalizada).
--
-- El hueco: ninguna purga tocaba lista_espera. El prospecto de un niño purgado conservaba su
-- nombre, apellidos, fecha de nacimiento, el teléfono y el email del tutor y la nota, y su copia
-- en audit_log solo perdía la fecha de nacimiento (la única clave de la lista genérica). El
-- INSERT del prospecto nace con nino_id NULL, así que ninguna redacción por niño lo alcanzaba.
--
-- 1. _claves_pii_nino: rama 'lista_espera' (nombre_nino, apellidos_nino, telefono_tutor,
--    email_tutor, nota; fecha_nacimiento ya está en la genérica).
-- 2. purgar_sujeto_db, rama del niño: borra la fila entera de lista_espera (nino_id = niño) y
--    redacta su copia en audit_log por tabla + registro_id (alcanza el INSERT y el DELETE).
-- 3. purgar_sujeto_db, rama del usuario: limpia telefono_tutor y email_tutor de los prospectos
--    del tutor (tutor_usuario_id = sujeto) y esas dos claves en su copia en audit_log.
-- 4. Retroactiva: _redactar_auditoria_lista_espera_retro redacta la auditoría de los prospectos
--    cuyo nino_id apunta a un niño que ya no existe o ya purgado (0 en producción hoy).
--
-- Fuera, a propósito: purgar_esqueleto_huerfano_nino no se toca (el prospecto se conserva en
-- admisiones, U-4). No se casa por nombre y fecha para pillar prospectos sin nino_id. La
-- retención de lista_espera (F11-B) y el export art. 15 van en follow-ups.
-- =============================================================================

-- 0. Foto previa y guarda de entrada.
CREATE TEMP TABLE _purga_antes AS
SELECT v.f, p.prosrc, p.prosecdef, p.proconfig, p.proacl::text AS proacl
  FROM (VALUES ('purga',  'public.purgar_sujeto_db(uuid)'::regprocedure),
               ('claves', 'public._claves_pii_nino(text)'::regprocedure),
               ('esq',    'public.purgar_esqueleto_huerfano_nino(uuid,timestamptz)'::regprocedure)) v(f, oid)
  JOIN pg_proc p ON p.oid = v.oid;

DO $$
DECLARE
  f          text[] := '{}';
  r          record;
  v_esperado text;
BEGIN
  FOR r IN SELECT a.f, md5(regexp_replace(regexp_replace(replace(a.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) AS m FROM _purga_antes a LOOP
    -- El CASE va a una variable: dentro de IF ... THEN, plpgsql corta en el primer THEN.
    v_esperado := CASE r.f WHEN 'purga'  THEN 'b4b50f71e8a08e7c1cc0488fe60d659b'
                           WHEN 'claves' THEN 'f2831624c8ac468682eed59ca8e8e885'
                           WHEN 'esq'    THEN '3f3835996b963099dbbb04522ce8762b' END;
    IF r.m IS DISTINCT FROM v_esperado THEN
      f := f || format('%s no es la versión esperada (md5 normalizado %s)', r.f, r.m);
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM _purga_antes) <> 3 THEN f := f || 'faltan funciones'::text; END IF;
  IF to_regprocedure('public._redactar_auditoria_lista_espera_retro()') IS NOT NULL THEN
    f := f || 'la retroactiva de lista_espera ya existe'::text;
  END IF;
  IF cardinality(f) > 0 THEN
    RAISE EXCEPTION 'guarda de entrada: %', array_to_string(f, ' | ');
  END IF;
END $$;

-- 1. La lista de claves personales por tabla: rama nueva para lista_espera.
CREATE OR REPLACE FUNCTION public._claves_pii_nino(p_tabla text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  SELECT ARRAY[
    'nombre', 'apellidos', 'fecha_nacimiento', 'sexo', 'nacionalidad', 'foto_url', 'notas_admin',
    'alergias_graves', 'notas_emergencia', 'medicacion_habitual', 'alergias_leves',
    'medico_familia', 'telefono_emergencia',
    'ip_address', 'user_agent', 'descripcion_parentesco', 'nombre_externo', 'observaciones',
    'observaciones_generales', 'contenido', 'nombre_tecleado'
  ]::text[] || CASE p_tabla
    WHEN 'ninos' THEN ARRAY['idioma_principal', 'direccion_calle', 'direccion_numero', 'direccion_cp',
                            'direccion_ciudad', 'libro_familia_path', 'estado_civil_familia']
    WHEN 'datos_pedagogicos_nino' THEN ARRAY['lactancia_observaciones', 'control_esfinteres_observaciones',
                            'siesta_horario_habitual', 'siesta_observaciones',
                            'alimentacion_observaciones', 'idiomas_casa']
    WHEN 'matriculas' THEN ARRAY['motivo_baja']
    WHEN 'firmas_autorizacion' THEN ARRAY['firma_imagen', 'comentario', 'datos']
    WHEN 'autorizaciones' THEN ARRAY['titulo', 'texto', 'datos']
    WHEN 'cita_invitados' THEN ARRAY['comentario']
    WHEN 'lista_espera' THEN ARRAY['nombre_nino', 'apellidos_nino', 'telefono_tutor', 'email_tutor', 'nota']
    ELSE ARRAY[]::text[]
  END;
$fn$;

-- 2. Retroactiva: la auditoría de los prospectos de niños que ya no existen o ya purgados (por
--    registro_id, para alcanzar también el INSERT sin nino_id). Nunca la de un niño vivo y no
--    purgado. Idempotente. Devuelve las filas tocadas.
CREATE FUNCTION public._redactar_auditoria_lista_espera_retro()
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  v_n integer;
BEGIN
  WITH ref AS (
    SELECT DISTINCT a.registro_id, x.nino
      FROM public.audit_log a
      CROSS JOIN LATERAL (VALUES (a.valores_antes->>'nino_id'), (a.valores_despues->>'nino_id')) x(nino)
     WHERE a.tabla = 'lista_espera' AND x.nino IS NOT NULL
  ), prospectos AS (
    SELECT r.registro_id FROM ref r
     WHERE NOT EXISTS (SELECT 1 FROM public.ninos n WHERE n.id = r.nino::uuid)
        OR EXISTS (SELECT 1 FROM public.ninos n
                    WHERE n.id = r.nino::uuid AND n.deleted_reason = 'purga_rgpd')
  )
  UPDATE public.audit_log a SET
    valores_antes   = public._redactar_jsonb(a.valores_antes,   public._claves_pii_nino('lista_espera')),
    valores_despues = public._redactar_jsonb(a.valores_despues, public._claves_pii_nino('lista_espera'))
  WHERE a.tabla = 'lista_espera'
    AND a.registro_id IN (SELECT p.registro_id FROM prospectos p);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

-- Solo el servidor: ni PUBLIC, ni anon, ni authenticated.
REVOKE ALL ON FUNCTION public._redactar_auditoria_lista_espera_retro() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._redactar_auditoria_lista_espera_retro() TO service_role;

-- 3. purgar_sujeto_db: la de 20261011140000 más lista_espera en las dos ramas.
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
      -- es NOT NULL con CHECK (es/en/va): vuelve a su valor por defecto.
      idioma_principal     = DEFAULT,
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

    UPDATE public.usuarios SET
      nombre_completo = '[borrado]',
      deleted_at      = COALESCE(deleted_at, now())
    WHERE id = s.sujeto_id;

    UPDATE public.consentimientos SET ip_address = NULL, user_agent = NULL
      WHERE usuario_id = s.sujeto_id;
    DELETE FROM public.push_subscriptions WHERE usuario_id = s.sujeto_id;

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

-- 4. Retroactiva.
DO $retro$
DECLARE
  v_n integer;
BEGIN
  v_n := public._redactar_auditoria_lista_espera_retro();
  RAISE NOTICE 'retroactiva: % filas de audit_log de prospectos de niños borrados o purgados', v_n;
END $retro$;

-- 5. Guarda de salida.
DO $guarda$
DECLARE
  f          text[] := '{}';
  v_old      text;
  v_new      text;
  v_exp      text;
  v_frag     text;
  v_secdef0  boolean;
  v_secdef   boolean;
  v_config0  text[];
  v_config   text[];
  v_acl0     text;
  v_acl      text;
  v_n        bigint;
BEGIN
  -- purga: la nueva = la anterior con solo los tres fragmentos de este PR.
  SELECT regexp_replace(regexp_replace(replace(a.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'), a.prosecdef, a.proconfig, a.proacl
    INTO v_old, v_secdef0, v_config0, v_acl0 FROM _purga_antes a WHERE a.f = 'purga';
  v_frag := btrim(regexp_replace(regexp_replace(replace('  v_nombre text;', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'));
  IF (length(v_old) - length(replace(v_old, v_frag, ''))) / length(v_frag) <> 1 THEN
    f := f || 'purga: el fragmento 1 no aparece exactamente una vez en la versión anterior'::text;
  END IF;
  v_frag := btrim(regexp_replace(regexp_replace(replace('    PERFORM public._redactar_auditoria_nino(s.sujeto_id);', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'));
  IF (length(v_old) - length(replace(v_old, v_frag, ''))) / length(v_frag) <> 1 THEN
    f := f || 'purga: el fragmento 2 no aparece exactamente una vez en la versión anterior'::text;
  END IF;
  v_frag := btrim(regexp_replace(regexp_replace(replace('    DELETE FROM public.push_subscriptions WHERE usuario_id = s.sujeto_id;', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'));
  IF (length(v_old) - length(replace(v_old, v_frag, ''))) / length(v_frag) <> 1 THEN
    f := f || 'purga: el fragmento 3 no aparece exactamente una vez en la versión anterior'::text;
  END IF;
  SELECT regexp_replace(regexp_replace(replace(p.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'), p.prosecdef, p.proconfig, p.proacl::text
    INTO v_new, v_secdef, v_config, v_acl
    FROM pg_proc p WHERE p.oid = 'public.purgar_sujeto_db(uuid)'::regprocedure;
  v_exp := replace(replace(replace(v_old,
      btrim(regexp_replace(regexp_replace(replace('  v_nombre text;', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')),
      btrim(regexp_replace(regexp_replace(replace('  v_nombre text;
  v_lista  uuid[];', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))),
      btrim(regexp_replace(regexp_replace(replace('    PERFORM public._redactar_auditoria_nino(s.sujeto_id);', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')),
      btrim(regexp_replace(regexp_replace(replace('    PERFORM public._redactar_auditoria_nino(s.sujeto_id);

    -- Purga de lista_espera: el prospecto del niño se borra entero (la plaza no tiene sentido
    -- sin el niño). Su copia en audit_log se redacta por registro_id: así se alcanza también el
    -- INSERT, que nace con nino_id NULL, y el DELETE que acaba de escribir esta purga.
    WITH borrados AS (
      DELETE FROM public.lista_espera WHERE nino_id = s.sujeto_id RETURNING id
    )
    SELECT array_agg(id) INTO v_lista FROM borrados;
    UPDATE public.audit_log SET
      valores_antes   = public._redactar_jsonb(valores_antes,   public._claves_pii_nino(''lista_espera'')),
      valores_despues = public._redactar_jsonb(valores_despues, public._claves_pii_nino(''lista_espera''))
    WHERE tabla = ''lista_espera'' AND registro_id = ANY (v_lista);', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))),
      btrim(regexp_replace(regexp_replace(replace('    DELETE FROM public.push_subscriptions WHERE usuario_id = s.sujeto_id;', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')),
      btrim(regexp_replace(regexp_replace(replace('    DELETE FROM public.push_subscriptions WHERE usuario_id = s.sujeto_id;

    -- Purga de lista_espera: el teléfono y el email que el tutor dejó en sus prospectos. El
    -- prospecto es del niño y se queda; su copia en audit_log pierde esas dos claves.
    WITH limpiados AS (
      UPDATE public.lista_espera SET telefono_tutor = NULL, email_tutor = NULL
      WHERE tutor_usuario_id = s.sujeto_id RETURNING id
    )
    SELECT array_agg(id) INTO v_lista FROM limpiados;
    UPDATE public.audit_log SET
      valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY[''telefono_tutor'', ''email_tutor'']),
      valores_despues = public._redactar_jsonb(valores_despues, ARRAY[''telefono_tutor'', ''email_tutor''])
    WHERE tabla = ''lista_espera'' AND registro_id = ANY (v_lista);', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')));
  IF md5(v_new) IS DISTINCT FROM md5(v_exp) THEN
    f := f || 'purga: la función nueva no es la anterior con solo los cambios de este PR'::text;
  END IF;
  IF v_secdef IS DISTINCT FROM v_secdef0 OR v_config IS DISTINCT FROM v_config0 OR v_acl IS DISTINCT FROM v_acl0 THEN
    f := f || format('purga: cambió SECURITY DEFINER, search_path o permisos (%s %s %s)', v_secdef, v_config, v_acl);
  END IF;

  -- claves: la nueva = la anterior con solo la rama de lista_espera.
  SELECT regexp_replace(regexp_replace(replace(a.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'), a.prosecdef, a.proconfig, a.proacl
    INTO v_old, v_secdef0, v_config0, v_acl0 FROM _purga_antes a WHERE a.f = 'claves';
  v_frag := btrim(regexp_replace(regexp_replace(replace('    WHEN ''cita_invitados'' THEN ARRAY[''comentario'']', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'));
  IF (length(v_old) - length(replace(v_old, v_frag, ''))) / length(v_frag) <> 1 THEN
    f := f || 'claves: el fragmento 1 no aparece exactamente una vez en la versión anterior'::text;
  END IF;
  SELECT regexp_replace(regexp_replace(replace(p.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'), p.prosecdef, p.proconfig, p.proacl::text
    INTO v_new, v_secdef, v_config, v_acl
    FROM pg_proc p WHERE p.oid = 'public._claves_pii_nino(text)'::regprocedure;
  v_exp := replace(v_old,
      btrim(regexp_replace(regexp_replace(replace('    WHEN ''cita_invitados'' THEN ARRAY[''comentario'']', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')),
      btrim(regexp_replace(regexp_replace(replace('    WHEN ''cita_invitados'' THEN ARRAY[''comentario'']
    WHEN ''lista_espera'' THEN ARRAY[''nombre_nino'', ''apellidos_nino'', ''telefono_tutor'', ''email_tutor'', ''nota'']', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')));
  IF md5(v_new) IS DISTINCT FROM md5(v_exp) THEN
    f := f || 'claves: la función nueva no es la anterior con solo la rama de lista_espera'::text;
  END IF;
  IF v_secdef IS DISTINCT FROM v_secdef0 OR v_config IS DISTINCT FROM v_config0 OR v_acl IS DISTINCT FROM v_acl0 THEN
    f := f || format('claves: cambió SECURITY DEFINER, search_path o permisos (%s %s %s)', v_secdef, v_config, v_acl);
  END IF;
  IF NOT (SELECT p.provolatile = 'i' FROM pg_proc p WHERE p.oid = 'public._claves_pii_nino(text)'::regprocedure) THEN
    f := f || 'claves: ya no es IMMUTABLE'::text;
  END IF;

  -- esq: intacta (el prospecto se conserva a propósito, U-4).
  SELECT a.prosrc, a.prosecdef, a.proconfig, a.proacl INTO v_old, v_secdef0, v_config0, v_acl0
    FROM _purga_antes a WHERE a.f = 'esq';
  SELECT p.prosrc, p.prosecdef, p.proconfig, p.proacl::text INTO v_new, v_secdef, v_config, v_acl
    FROM pg_proc p WHERE p.oid = 'public.purgar_esqueleto_huerfano_nino(uuid,timestamptz)'::regprocedure;
  IF v_new IS DISTINCT FROM v_old OR v_secdef IS DISTINCT FROM v_secdef0
     OR v_config IS DISTINCT FROM v_config0 OR v_acl IS DISTINCT FROM v_acl0 THEN
    f := f || 'esq: purgar_esqueleto_huerfano_nino ha cambiado y no debía'::text;
  END IF;

  -- La retroactiva: solo el servidor.
  IF has_function_privilege('anon', 'public._redactar_auditoria_lista_espera_retro()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._redactar_auditoria_lista_espera_retro()', 'EXECUTE') THEN
    f := f || 'la retroactiva de lista_espera es ejecutable por anon o authenticated'::text;
  END IF;
  -- Y ningún prospecto de un niño borrado o purgado conserva una clave personal en audit_log.
  SELECT count(*) INTO v_n
    FROM public.audit_log a
    CROSS JOIN LATERAL unnest(public._claves_pii_nino('lista_espera')) AS k(clave)
   WHERE a.tabla = 'lista_espera'
     AND a.registro_id IN (
           SELECT b.registro_id FROM public.audit_log b
            CROSS JOIN LATERAL (VALUES (b.valores_antes->>'nino_id'), (b.valores_despues->>'nino_id')) x(nino)
            WHERE b.tabla = 'lista_espera' AND x.nino IS NOT NULL
              AND (NOT EXISTS (SELECT 1 FROM public.ninos n WHERE n.id = x.nino::uuid)
                   OR EXISTS (SELECT 1 FROM public.ninos n
                               WHERE n.id = x.nino::uuid AND n.deleted_reason = 'purga_rgpd')))
     AND ((a.valores_antes ? k.clave AND a.valores_antes->>k.clave IS NOT NULL
           AND a.valores_antes->>k.clave <> '[borrado]')
       OR (a.valores_despues ? k.clave AND a.valores_despues->>k.clave IS NOT NULL
           AND a.valores_despues->>k.clave <> '[borrado]'));
  IF v_n > 0 THEN
    f := f || format('retroactiva: %s claves personales sin redactar en prospectos de niños borrados o purgados', v_n);
  END IF;

  IF cardinality(f) > 0 THEN
    RAISE EXCEPTION 'guarda de salida: %', array_to_string(f, ' | ');
  END IF;
END $guarda$;

DROP TABLE _purga_antes;
