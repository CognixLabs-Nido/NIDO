-- =============================================================================
-- Cierre del frente de la purga RGPD (PR 5).
--
-- Entrada verificada en vivo (read_only, 2026-10-15): purgar_sujeto_db, _redactar_jsonb,
-- _claves_pii_nino, purgar_esqueleto_huerfano_nino y familia_tutores_proteger_usuario_id son las
-- de las migraciones aplicadas (md5 normalizado en la guarda de entrada).
--
-- 1. Ítem 9 — idioma_principal: la purga del niño ponía 'es' (DEFAULT), un dato inventado. Pasa
--    a 'zz', como idiomas_casa. El CHECK solo admite 'zz' junto a deleted_reason='purga_rgpd':
--    ningún niño vivo puede tenerlo, y la app solo tiene que esconderlo al mostrarlo. Los niños
--    ya purgados se ponen a 'zz' (0 en producción hoy; la cuenta se imprime).
-- 2. Ítem 10 — _redactar_jsonb conserva el null de JSON: «[borrado]» solo donde había un
--    valor. Lo ya redactado no se toca (decidido: solo de aquí en adelante).
-- 3. purgar_sujeto_db, rama del usuario:
--    · familia_tutores: su perfil (nombre, email, dirección, ruta del DNI) a NULL y de baja;
--      usuario_id/familia_id/rol_familia se quedan; su copia en audit_log, por registro_id.
--    · usuarios.foto_url a NULL; preferencias_usuario y lectura_* borradas.
--    · cambios_pendientes que pidió sobre sus datos de tutor (datos_tutor, datos_tutor_dni):
--      borrados (el payload guarda su email, su dirección y la ruta de su DNI).
--    · cita_invitados.comentario a NULL, y 'comentario' entra en las claves de audit_log.
--    Rama del niño: sus cambios_pendientes, borrados.
--    Los objetos de Storage (avatar, DNI, documentos de cambios pendientes) los borra antes el
--    manifiesto de adjuntos de la app, por ruta exacta.
-- 4. Familia sin titular: la purga no asciende al otro tutor (lo decide la directora). Para
--    que la directora pueda hacerlo, promover_a_titular(p_familia_tutor_id): SECURITY DEFINER,
--    con la sesión de la directora (queda como actor en audit_log); solo admin del centro de
--    la familia, solo si la familia no tiene titular activo y la fila es un segundo_tutor
--    activo. Pasa la fila a 'titular' y sus vínculos con los niños de la familia a
--    tutor_legal_principal (mapeo único titular ⇔ principal). El trigger que congela
--    rol_familia deja pasar exactamente ese cambio, y solo con el marcador local que pone esta
--    función; cualquier otro cambio sigue yendo por service_role.
--
-- Fuera, decidido por el responsable: mandatos_sepa (prueba legal, plazo con F11-B),
-- firmas_autorizacion, los mensajes (solo se quita el nombre), los tutores sin cuenta.
-- =============================================================================

-- 0. Foto previa y guarda de entrada.
CREATE TEMP TABLE _cierre_antes AS
SELECT v.f, p.prosrc, p.prosecdef, p.proconfig, p.proacl::text AS proacl
  FROM (VALUES ('purga',   'public.purgar_sujeto_db(uuid)'::regprocedure),
               ('redactar','public._redactar_jsonb(jsonb,text[])'::regprocedure),
               ('claves',  'public._claves_pii_nino(text)'::regprocedure),
               ('esq',     'public.purgar_esqueleto_huerfano_nino(uuid,timestamptz)'::regprocedure),
               ('congela', 'public.familia_tutores_proteger_usuario_id()'::regprocedure)) v(f, oid)
  JOIN pg_proc p ON p.oid = v.oid;

DO $guarda$
DECLARE
  f          text[] := '{}';
  r          record;
  v_esperado text;
  v_check    text;
BEGIN
  FOR r IN SELECT a.f, md5(regexp_replace(regexp_replace(replace(a.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) AS m FROM _cierre_antes a LOOP
    -- El CASE va a una variable: dentro de IF ... THEN, plpgsql corta en el primer THEN.
    v_esperado := CASE r.f WHEN 'purga'    THEN '1a6d2ee2416b341459b2ab299920dfa0'
                           WHEN 'redactar' THEN '4161104fe80f2fb5c6173e0c45c95251'
                           WHEN 'claves'   THEN '134c101b177d508759f3d800ebaf2fd8'
                           WHEN 'esq'      THEN '3f3835996b963099dbbb04522ce8762b'
                           WHEN 'congela'  THEN '05160a803ca0dbb30cb8346137fb474d' END;
    IF r.m IS DISTINCT FROM v_esperado THEN
      f := f || format('%s no es la versión esperada (md5 normalizado %s)', r.f, r.m);
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM _cierre_antes) <> 5 THEN f := f || 'faltan funciones'::text; END IF;

  SELECT pg_get_constraintdef(oid) INTO v_check FROM pg_constraint
   WHERE conrelid = 'public.ninos'::regclass AND conname = 'ninos_idioma_principal_check';
  IF v_check IS DISTINCT FROM 'CHECK ((idioma_principal = ANY (ARRAY[''es''::text, ''en''::text, ''va''::text])))' THEN
    f := f || format('ninos_idioma_principal_check no es el esperado: %s', v_check);
  END IF;
  IF to_regprocedure('public.promover_a_titular(uuid)') IS NOT NULL THEN
    f := f || 'promover_a_titular ya existe'::text;
  END IF;
  IF cardinality(f) > 0 THEN
    RAISE EXCEPTION 'guarda de entrada: %', array_to_string(f, ' | ');
  END IF;
END
$guarda$;

-- 1. Ítem 9: el CHECK de idioma_principal admite 'zz' solo en un niño purgado.
ALTER TABLE public.ninos DROP CONSTRAINT ninos_idioma_principal_check;
ALTER TABLE public.ninos ADD CONSTRAINT ninos_idioma_principal_check CHECK (
  idioma_principal IN ('es', 'en', 'va')
  OR (idioma_principal = 'zz' AND deleted_reason = 'purga_rgpd')
);

-- Los niños ya purgados conservaban el 'es' inventado.
DO $backfill$
DECLARE
  v_n int;
BEGIN
  UPDATE public.ninos SET idioma_principal = 'zz'
   WHERE deleted_reason = 'purga_rgpd' AND idioma_principal <> 'zz';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'idioma_principal: % niños ya purgados pasan a ''zz''', v_n;
END
$backfill$;

-- 2. Ítem 10: _redactar_jsonb conserva el null de JSON.
CREATE OR REPLACE FUNCTION public._redactar_jsonb(j jsonb, claves text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  k text;
  r jsonb := j;
BEGIN
  IF r IS NULL THEN RETURN NULL; END IF;
  FOREACH k IN ARRAY claves LOOP
    -- Solo donde había un valor: un null sigue siendo null (no se inventa que hubo un dato).
    IF r ? k AND jsonb_typeof(r -> k) <> 'null' THEN
      r := jsonb_set(r, ARRAY[k], '"[borrado]"'::jsonb, false);
    END IF;
  END LOOP;
  RETURN r;
END
$function$;

-- 3. El trigger que congela usuario_id/familia_id/rol_familia deja pasar un único cambio:
--    segundo_tutor → titular, con el marcador local que pone promover_a_titular.
CREATE OR REPLACE FUNCTION public.familia_tutores_proteger_usuario_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user <> 'service_role' AND (
       NEW.usuario_id  IS DISTINCT FROM OLD.usuario_id
    OR NEW.familia_id  IS DISTINCT FROM OLD.familia_id
    OR NEW.rol_familia IS DISTINCT FROM OLD.rol_familia
  ) AND NOT (
       -- promover_a_titular: solo el rol, solo de segundo_tutor a titular.
       current_setting('app.promover_titular', true) = 'on'
   AND NEW.usuario_id IS NOT DISTINCT FROM OLD.usuario_id
   AND NEW.familia_id = OLD.familia_id
   AND OLD.rol_familia = 'segundo_tutor'
   AND NEW.rol_familia = 'titular'
  ) THEN
    RAISE EXCEPTION
      'familia_tutores: usuario_id/familia_id/rol_familia no son editables por este rol; (des)vinculacion y reasignacion van por service_role (F-2b)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$function$;

-- 4. La directora asciende al segundo tutor cuando la familia se ha quedado sin titular.
CREATE FUNCTION public.promover_a_titular(p_familia_tutor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_fila   public.familia_tutores%ROWTYPE;
  v_centro uuid;
BEGIN
  SELECT * INTO v_fila FROM public.familia_tutores
   WHERE id = p_familia_tutor_id AND deleted_at IS NULL;
  v_centro := public.centro_de_familia(v_fila.familia_id);
  -- Sin fila o sin centro también es 42501: es_admin(NULL) sería TRUE para cualquier admin.
  IF auth.uid() IS NULL OR v_centro IS NULL OR NOT public.es_admin(v_centro) THEN
    RAISE EXCEPTION 'no autorizado a cambiar el titular de esta familia'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_fila.rol_familia <> 'segundo_tutor' THEN
    RAISE EXCEPTION 'solo un segundo tutor puede pasar a titular'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.familia_tutores
              WHERE familia_id = v_fila.familia_id AND rol_familia = 'titular'
                AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'la familia ya tiene titular'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('app.promover_titular', 'on', true);
  UPDATE public.familia_tutores SET rol_familia = 'titular' WHERE id = v_fila.id;
  PERFORM set_config('app.promover_titular', '', true);

  -- Sus vínculos con los niños de la familia: titular ⇔ tutor_legal_principal.
  IF v_fila.usuario_id IS NOT NULL THEN
    UPDATE public.vinculos_familiares vf SET tipo_vinculo = 'tutor_legal_principal'
      FROM public.ninos n
     WHERE vf.nino_id = n.id
       AND n.familia_id = v_fila.familia_id
       AND vf.usuario_id = v_fila.usuario_id
       AND vf.tipo_vinculo = 'tutor_legal_secundario'
       AND vf.deleted_at IS NULL;
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.promover_a_titular(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promover_a_titular(uuid) TO authenticated;

-- 5. purgar_sujeto_db: ítem 9, familia_tutores y los huecos del barrido.
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
  k_user  text[] := ARRAY['nombre_completo'];
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
  -- Las que no debían cambiar.
  FOR r IN SELECT a.f, a.prosrc, a.prosecdef, a.proconfig, a.proacl,
                  p.prosrc AS src1, p.prosecdef AS sec1, p.proconfig AS cfg1, p.proacl::text AS acl1
             FROM _cierre_antes a
             JOIN pg_proc p ON p.oid = CASE a.f WHEN 'claves' THEN 'public._claves_pii_nino(text)'::regprocedure
                                               WHEN 'esq' THEN 'public.purgar_esqueleto_huerfano_nino(uuid,timestamptz)'::regprocedure END
            WHERE a.f IN ('claves', 'esq') LOOP
    IF r.src1 IS DISTINCT FROM r.prosrc OR r.sec1 IS DISTINCT FROM r.prosecdef
       OR r.cfg1 IS DISTINCT FROM r.proconfig OR r.acl1 IS DISTINCT FROM r.proacl THEN
      f := f || format('%s ha cambiado y no debía', r.f);
    END IF;
  END LOOP;
  -- Las reescritas conservan seguridad, configuración y permisos.
  FOR r IN SELECT a.f, a.prosecdef, a.proconfig, a.proacl,
                  p.prosecdef AS sec1, p.proconfig AS cfg1, p.proacl::text AS acl1
             FROM _cierre_antes a
             JOIN pg_proc p ON p.oid = CASE a.f WHEN 'purga' THEN 'public.purgar_sujeto_db(uuid)'::regprocedure
                                               WHEN 'redactar' THEN 'public._redactar_jsonb(jsonb,text[])'::regprocedure
                                               WHEN 'congela' THEN 'public.familia_tutores_proteger_usuario_id()'::regprocedure END
            WHERE a.f IN ('purga', 'redactar', 'congela') LOOP
    IF r.sec1 IS DISTINCT FROM r.prosecdef OR r.cfg1 IS DISTINCT FROM r.proconfig
       OR r.acl1 IS DISTINCT FROM r.proacl THEN
      f := f || format('%s: cambió su seguridad, configuración o permisos', r.f);
    END IF;
  END LOOP;

  -- Ítem 10, con su control: un null se queda, un valor se redacta, una clave ausente no aparece.
  IF public._redactar_jsonb('{"a": null, "b": "x", "c": 1}'::jsonb, ARRAY['a', 'b', 'z'])
     IS DISTINCT FROM '{"a": null, "b": "[borrado]", "c": 1}'::jsonb THEN
    f := f || '_redactar_jsonb no conserva el null o no redacta el valor'::text;
  END IF;

  -- Ítem 9: ningún purgado con otro idioma, y el CHECK sigue cerrando a los vivos.
  SELECT count(*) INTO v_n FROM public.ninos
   WHERE deleted_reason = 'purga_rgpd' AND idioma_principal <> 'zz';
  IF v_n > 0 THEN f := f || format('%s niños purgados sin ''zz''', v_n); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.ninos'::regclass AND conname = 'ninos_idioma_principal_check'
                    AND pg_get_constraintdef(oid) LIKE '%purga_rgpd%') THEN
    f := f || 'el CHECK de idioma_principal no está atado a la purga'::text;
  END IF;

  -- promover_a_titular: SECURITY DEFINER, search_path fijo, sin anon.
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.promover_a_titular(uuid)'::regprocedure)
     OR NOT COALESCE((SELECT 'search_path=public' = ANY (proconfig) FROM pg_proc
                       WHERE oid = 'public.promover_a_titular(uuid)'::regprocedure), false)
     OR has_function_privilege('anon', 'public.promover_a_titular(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.promover_a_titular(uuid)', 'EXECUTE') THEN
    f := f || 'promover_a_titular: seguridad o permisos no son los esperados'::text;
  END IF;

  IF cardinality(f) > 0 THEN
    RAISE EXCEPTION 'guarda de salida: %', array_to_string(f, ' | ');
  END IF;
  RAISE NOTICE 'cierre de la purga: guardas de salida OK';
END
$guarda$;

DROP TABLE _cierre_antes;
