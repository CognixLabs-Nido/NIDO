-- =============================================================================
-- Purga RGPD del niño: la tabla real Y su copia en audit_log (las dos purgas).
--
-- Entrada (verificada en vivo, read_only, 2026-10-11): purgar_sujeto_db y
-- purgar_esqueleto_huerfano_nino son las de 20261011130000 (lógica normalizada).
--
-- 1. purgar_sujeto_db, rama del niño, no borraba de ninos la dirección (calle, número, CP,
--    ciudad), libro_familia_path, idioma_principal ni estado_civil_familia: un niño purgado por
--    derecho al olvido conservaba su dirección en la tabla. Tampoco idiomas_casa ni el motivo de
--    baja de sus matrículas. info_medica_emergencia ya se borraba entera (también las dos
--    columnas cifradas) y datos_pedagogicos_nino, sus observaciones.
-- 2. Su redacción de audit_log no conocía esas claves, ni las observaciones pedagógicas, ni la
--    firma (trazo, comentario, datos con terceros), ni la autorización del niño, ni el invitado
--    externo de una cita del niño. Ahora usa _redactar_auditoria_nino, con una lista de claves
--    por tabla (_claves_pii_nino).
-- 3. purgar_esqueleto_huerfano_nino no redactaba nada del niño: el DELETE dejaba la fila entera
--    en valores_antes. Ahora llama a la misma función después de borrar el niño; la redacción
--    de invitaciones de 20261011130000 se conserva.
-- 4. Retroactiva: _redactar_auditoria_ninos_borrados redacta, con la misma lista, las filas de
--    audit_log de niños que ya no existen en ninos. Nunca toca la auditoría de un niño vivo.
--
-- Fuera: firmas_autorizacion en la tabla real (retención legal de las firmas, decisión #7 de
-- fuentes-adjuntos.ts; su copia en audit_log sí se redacta) y lista_espera (follow-up).
-- Principio: la purga borra el dato de la tabla real y de su copia en audit_log. audit_log
-- sigue append-only para los usuarios: se redacta, nunca se borra.
-- =============================================================================

-- 0. Foto previa y guarda de entrada.
CREATE TEMP TABLE _purga_antes AS
SELECT v.f, p.prosrc, p.prosecdef, p.proconfig, p.proacl::text AS proacl
  FROM (VALUES ('purga', 'public.purgar_sujeto_db(uuid)'::regprocedure),
               ('esq',   'public.purgar_esqueleto_huerfano_nino(uuid,timestamptz)'::regprocedure)) v(f, oid)
  JOIN pg_proc p ON p.oid = v.oid;

DO $$
DECLARE
  f          text[] := '{}';
  r          record;
  v_esperado text;
BEGIN
  FOR r IN SELECT a.f, md5(regexp_replace(regexp_replace(replace(a.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) AS m FROM _purga_antes a LOOP
    -- El CASE va a una variable: dentro de IF ... THEN, plpgsql corta en el primer THEN.
    v_esperado := CASE r.f WHEN 'purga' THEN '3931e05eee0e8c4ebfa13974a6a0cfa6'
                           WHEN 'esq'   THEN '25b6314d1b059fcbf35fb2c847b04e13' END;
    IF r.m IS DISTINCT FROM v_esperado THEN
      f := f || format('%s no es la versión esperada (md5 normalizado %s)', r.f, r.m);
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM _purga_antes) <> 2 THEN f := f || 'faltan funciones'::text; END IF;
  IF to_regprocedure('public._claves_pii_nino(text)') IS NOT NULL
     OR to_regprocedure('public._redactar_auditoria_nino(uuid)') IS NOT NULL
     OR to_regprocedure('public._redactar_auditoria_ninos_borrados()') IS NOT NULL THEN
    f := f || 'las funciones de redacción del niño ya existen'::text;
  END IF;
  IF cardinality(f) > 0 THEN
    RAISE EXCEPTION 'guarda de entrada: %', array_to_string(f, ' | ');
  END IF;
END $$;

-- 1. La lista de claves personales por tabla, compartida por las dos purgas y la retroactiva.
CREATE FUNCTION public._claves_pii_nino(p_tabla text)
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
    ELSE ARRAY[]::text[]
  END;
$fn$;

COMMENT ON FUNCTION public._claves_pii_nino(text) IS
  'Claves personales que la purga RGPD del niño redacta en audit_log, por tabla. La comparten purgar_sujeto_db, purgar_esqueleto_huerfano_nino y _redactar_auditoria_ninos_borrados.';

-- 2. Redacta la auditoría de UN niño: sus filas (registro_id o nino_id en el JSON) y las de los
--    invitados de sus citas, que no llevan nino_id.
CREATE FUNCTION public._redactar_auditoria_nino(p_nino_id uuid)
RETURNS void
LANGUAGE sql
SET search_path TO 'public'
AS $fn$
  UPDATE public.audit_log SET
    valores_antes   = public._redactar_jsonb(valores_antes,   public._claves_pii_nino(tabla)),
    valores_despues = public._redactar_jsonb(valores_despues, public._claves_pii_nino(tabla))
  WHERE registro_id = p_nino_id
     OR valores_antes->>'nino_id'   = p_nino_id::text
     OR valores_despues->>'nino_id' = p_nino_id::text
     OR (tabla = 'cita_invitados'
         AND COALESCE(valores_antes->>'cita_id', valores_despues->>'cita_id') IN (
               SELECT c.registro_id::text FROM public.audit_log c
                WHERE c.tabla = 'citas'
                  AND (c.valores_antes->>'nino_id'   = p_nino_id::text
                    OR c.valores_despues->>'nino_id' = p_nino_id::text)));
$fn$;

-- 3. Retroactiva: la auditoría de los niños que ya no existen en ninos (borrados antes de que
--    las purgas redactaran). Nunca la de un niño vivo. Idempotente. Devuelve las filas tocadas.
CREATE FUNCTION public._redactar_auditoria_ninos_borrados()
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  v_n integer;
BEGIN
  WITH ref AS (
    SELECT a.id,
           COALESCE(CASE WHEN a.tabla = 'ninos' THEN a.registro_id::text END,
                    a.valores_antes->>'nino_id', a.valores_despues->>'nino_id') AS nino
      FROM public.audit_log a
  ), muertos AS (
    SELECT r.id, r.nino FROM ref r
     WHERE r.nino IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.ninos n WHERE n.id = r.nino::uuid)
  ), citas_muertas AS (
    SELECT a.registro_id::text AS cita FROM public.audit_log a JOIN muertos m ON m.id = a.id
     WHERE a.tabla = 'citas'
  )
  UPDATE public.audit_log a SET
    valores_antes   = public._redactar_jsonb(a.valores_antes,   public._claves_pii_nino(a.tabla)),
    valores_despues = public._redactar_jsonb(a.valores_despues, public._claves_pii_nino(a.tabla))
  WHERE a.id IN (SELECT m.id FROM muertos m)
     OR (a.tabla = 'cita_invitados'
         AND COALESCE(a.valores_antes->>'cita_id', a.valores_despues->>'cita_id')
             IN (SELECT cm.cita FROM citas_muertas cm));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

-- Solo el servidor: ni PUBLIC, ni anon, ni authenticated.
REVOKE ALL ON FUNCTION public._claves_pii_nino(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._redactar_auditoria_nino(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._redactar_auditoria_ninos_borrados() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._claves_pii_nino(text) TO service_role;
GRANT EXECUTE ON FUNCTION public._redactar_auditoria_nino(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._redactar_auditoria_ninos_borrados() TO service_role;

-- 4. purgar_sujeto_db: la de 20261011130000 más la ficha completa del niño y _redactar_auditoria_nino.
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

-- 5. purgar_esqueleto_huerfano_nino: la de 20261011130000 más _redactar_auditoria_nino.
CREATE OR REPLACE FUNCTION public.purgar_esqueleto_huerfano_nino(
  p_nino_id uuid,
  p_cutoff  timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ok        boolean;
  v_actividad boolean;
BEGIN
  -- Re-validación autoritativa del predicado (TOCTOU: el estado pudo cambiar
  -- entre listar() y limpiarDb() — p. ej. el tutor acaba de aceptar).
  SELECT
        EXISTS (SELECT 1 FROM matriculas m WHERE m.nino_id = p_nino_id
                  AND m.estado = 'pendiente' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM vinculos_familiares v WHERE v.nino_id = p_nino_id
                  AND v.deleted_at IS NULL)
    AND EXISTS (SELECT 1 FROM invitaciones i WHERE i.nino_id = p_nino_id
                  AND i.accepted_at IS NULL AND i.rejected_at IS NULL AND i.expires_at < p_cutoff)
    AND NOT EXISTS (SELECT 1 FROM invitaciones i WHERE i.nino_id = p_nino_id
                  AND i.accepted_at IS NULL AND i.rejected_at IS NULL AND i.expires_at >= p_cutoff)
    INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'no es esqueleto huerfano (predicado no se cumple)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Backstop: si el niño tiene CUALQUIER actividad real, abortar (rollback atómico).
  -- Un huérfano real no tiene nada de esto (verificado en la BD).
  SELECT
        EXISTS (SELECT 1 FROM asistencias WHERE nino_id = p_nino_id)
     OR EXISTS (SELECT 1 FROM ausencias WHERE nino_id = p_nino_id)
     OR EXISTS (SELECT 1 FROM agendas_diarias WHERE nino_id = p_nino_id)
     OR EXISTS (SELECT 1 FROM conversaciones WHERE nino_id = p_nino_id)
     OR EXISTS (SELECT 1 FROM administraciones_medicacion WHERE nino_id = p_nino_id)
     OR EXISTS (SELECT 1 FROM informes_evolucion WHERE nino_id = p_nino_id)
    INTO v_actividad;

  IF v_actividad THEN
    RAISE EXCEPTION 'el nino tiene actividad real; huerfano abortado'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Borrado FK-safe (atómico). Primero los RESTRICT 1:1, luego matrícula, luego
  -- el niño (CASCADE: vinculos, invitaciones, autorizaciones, firmas, media_etiquetas).
  -- Grupo 1 (PR B): las filas de auditoría que escribe la purga llevan su etiqueta.
  PERFORM set_config('app.audit_actor', 'system:purgar_esqueleto_huerfano_nino', true);

  DELETE FROM info_medica_emergencia WHERE nino_id = p_nino_id;
  DELETE FROM datos_pedagogicos_nino WHERE nino_id = p_nino_id;
  DELETE FROM matriculas            WHERE nino_id = p_nino_id;
  DELETE FROM ninos                 WHERE id      = p_nino_id;

  -- Purga RGPD del niño: el DELETE deja la fila entera en valores_antes, y siguen ahí el
  -- alta y los cambios. Se redactan con la lista de claves que comparte con purgar_sujeto_db.
  PERFORM public._redactar_auditoria_nino(p_nino_id);

  -- Grupo 1 (PR B): las invitaciones del niño se han borrado en cascada. Sus copias en
  -- audit_log (alta, cambios y este DELETE) no conservan el email ni el nombre del invitado,
  -- que nunca llegó a tener cuenta y al que ninguna purga de usuario alcanzará.
  UPDATE public.audit_log SET
    valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY['email', 'nombre_completo']),
    valores_despues = public._redactar_jsonb(valores_despues, ARRAY['email', 'nombre_completo'])
  WHERE tabla = 'invitaciones'
    AND (valores_antes->>'nino_id' = p_nino_id::text OR valores_despues->>'nino_id' = p_nino_id::text);

  PERFORM set_config('app.audit_actor', '', true);
END;
$function$;

-- 6. Retroactiva.
DO $retro$
DECLARE
  v_n integer;
BEGIN
  v_n := public._redactar_auditoria_ninos_borrados();
  RAISE NOTICE 'retroactiva: % filas de audit_log de niños que ya no existen', v_n;
END $retro$;

-- 7. Guarda de salida.
DO $guarda$
DECLARE
  f          text[] := '{}';
  v_old      text;
  v_new      text;
  v_exp      text;
  v_secdef0  boolean;
  v_secdef   boolean;
  v_config0  text[];
  v_config   text[];
  v_acl0     text;
  v_acl      text;
  v_n        bigint;
BEGIN
  -- purga: la nueva = la anterior con solo los cambios de este PR.
  SELECT regexp_replace(regexp_replace(replace(a.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'), a.prosecdef, a.proconfig, a.proacl INTO v_old, v_secdef0, v_config0, v_acl0
    FROM _purga_antes a WHERE a.f = 'purga';
  IF position(btrim(regexp_replace(regexp_replace(replace('      notas_admin      = NULL,
      deleted_reason   = ''purga_rgpd'',', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) IN v_old) = 0 THEN f := f || 'purga: no encuentro el fragmento 1 en la versión anterior'::text; END IF;
  IF position(btrim(regexp_replace(regexp_replace(replace('                                              THEN ''[borrado]'' ELSE NULL END,
      deleted_at                       = COALESCE(deleted_at, now())
    WHERE nino_id = s.sujeto_id;', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) IN v_old) = 0 THEN f := f || 'purga: no encuentro el fragmento 2 en la versión anterior'::text; END IF;
  IF position(btrim(regexp_replace(regexp_replace(replace('    UPDATE public.audit_log SET
      valores_antes   = public._redactar_jsonb(valores_antes,   k_nino || k_med || k_extra),
      valores_despues = public._redactar_jsonb(valores_despues, k_nino || k_med || k_extra)
    WHERE registro_id = s.sujeto_id
       OR (valores_antes->>''nino_id''   = s.sujeto_id::text)
       OR (valores_despues->>''nino_id'' = s.sujeto_id::text);', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) IN v_old) = 0 THEN f := f || 'purga: no encuentro el fragmento 3 en la versión anterior'::text; END IF;
  SELECT regexp_replace(regexp_replace(replace(p.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'), p.prosecdef, p.proconfig, p.proacl::text INTO v_new, v_secdef, v_config, v_acl
    FROM pg_proc p WHERE p.oid = 'public.purgar_sujeto_db(uuid)'::regprocedure;
  v_exp := replace(replace(replace(v_old,
      btrim(regexp_replace(regexp_replace(replace('      notas_admin      = NULL,
      deleted_reason   = ''purga_rgpd'',', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')),
      btrim(regexp_replace(regexp_replace(replace('      notas_admin      = NULL,
      -- Purga RGPD del niño: el resto de columnas personales de la ficha. idioma_principal
      -- es NOT NULL con CHECK (es/en/va): vuelve a su valor por defecto.
      idioma_principal     = DEFAULT,
      direccion_calle      = NULL,
      direccion_numero     = NULL,
      direccion_cp         = NULL,
      direccion_ciudad     = NULL,
      libro_familia_path   = NULL,
      estado_civil_familia = NULL,
      deleted_reason   = ''purga_rgpd'',', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))),
      btrim(regexp_replace(regexp_replace(replace('                                              THEN ''[borrado]'' ELSE NULL END,
      deleted_at                       = COALESCE(deleted_at, now())
    WHERE nino_id = s.sujeto_id;', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')),
      btrim(regexp_replace(regexp_replace(replace('                                              THEN ''[borrado]'' ELSE NULL END,
      -- Purga RGPD del niño: el CHECK exige de 1 a 8 códigos de 2 letras; ''zz'' no es un idioma.
      idiomas_casa                     = ARRAY[''zz''],
      deleted_at                       = COALESCE(deleted_at, now())
    WHERE nino_id = s.sujeto_id;

    -- Purga RGPD del niño: el motivo de baja es texto libre del centro sobre el niño.
    UPDATE public.matriculas SET motivo_baja = NULL
    WHERE nino_id = s.sujeto_id AND motivo_baja IS NOT NULL;', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))),
      btrim(regexp_replace(regexp_replace(replace('    UPDATE public.audit_log SET
      valores_antes   = public._redactar_jsonb(valores_antes,   k_nino || k_med || k_extra),
      valores_despues = public._redactar_jsonb(valores_despues, k_nino || k_med || k_extra)
    WHERE registro_id = s.sujeto_id
       OR (valores_antes->>''nino_id''   = s.sujeto_id::text)
       OR (valores_despues->>''nino_id'' = s.sujeto_id::text);', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')),
      btrim(regexp_replace(regexp_replace(replace('    -- Purga RGPD del niño: la copia en audit_log, con la lista de claves por tabla que
    -- comparte con purgar_esqueleto_huerfano_nino (_claves_pii_nino).
    PERFORM public._redactar_auditoria_nino(s.sujeto_id);', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')));
  IF md5(v_new) IS DISTINCT FROM md5(v_exp) THEN
    f := f || 'purga: la función nueva no es la anterior con solo los cambios de este PR'::text;
  END IF;
  IF v_secdef IS DISTINCT FROM v_secdef0 OR v_config IS DISTINCT FROM v_config0 OR v_acl IS DISTINCT FROM v_acl0 THEN
    f := f || format('purga: cambió SECURITY DEFINER, search_path o permisos (%s %s %s)', v_secdef, v_config, v_acl);
  END IF;
  -- esq: la nueva = la anterior con solo los cambios de este PR.
  SELECT regexp_replace(regexp_replace(replace(a.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'), a.prosecdef, a.proconfig, a.proacl INTO v_old, v_secdef0, v_config0, v_acl0
    FROM _purga_antes a WHERE a.f = 'esq';
  IF position(btrim(regexp_replace(regexp_replace(replace('  DELETE FROM ninos                 WHERE id      = p_nino_id;', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) IN v_old) = 0 THEN f := f || 'esq: no encuentro el fragmento 1 en la versión anterior'::text; END IF;
  SELECT regexp_replace(regexp_replace(replace(p.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'), p.prosecdef, p.proconfig, p.proacl::text INTO v_new, v_secdef, v_config, v_acl
    FROM pg_proc p WHERE p.oid = 'public.purgar_esqueleto_huerfano_nino(uuid,timestamptz)'::regprocedure;
  v_exp := replace(v_old,
      btrim(regexp_replace(regexp_replace(replace('  DELETE FROM ninos                 WHERE id      = p_nino_id;', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')),
      btrim(regexp_replace(regexp_replace(replace('  DELETE FROM ninos                 WHERE id      = p_nino_id;

  -- Purga RGPD del niño: el DELETE deja la fila entera en valores_antes, y siguen ahí el
  -- alta y los cambios. Se redactan con la lista de claves que comparte con purgar_sujeto_db.
  PERFORM public._redactar_auditoria_nino(p_nino_id);', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')));
  IF md5(v_new) IS DISTINCT FROM md5(v_exp) THEN
    f := f || 'esq: la función nueva no es la anterior con solo los cambios de este PR'::text;
  END IF;
  IF v_secdef IS DISTINCT FROM v_secdef0 OR v_config IS DISTINCT FROM v_config0 OR v_acl IS DISTINCT FROM v_acl0 THEN
    f := f || format('esq: cambió SECURITY DEFINER, search_path o permisos (%s %s %s)', v_secdef, v_config, v_acl);
  END IF;

  -- Las funciones nuevas: solo el servidor.
  IF has_function_privilege('anon', 'public._redactar_auditoria_nino(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._redactar_auditoria_nino(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public._redactar_auditoria_ninos_borrados()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._redactar_auditoria_ninos_borrados()', 'EXECUTE')
     OR has_function_privilege('anon', 'public._claves_pii_nino(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._claves_pii_nino(text)', 'EXECUTE') THEN
    f := f || 'una función de redacción del niño es ejecutable por anon o authenticated'::text;
  END IF;
  -- La retroactiva: ninguna fila de un niño que ya no existe conserva una clave personal.
  SELECT count(*) INTO v_n
    FROM public.audit_log a
    CROSS JOIN LATERAL unnest(public._claves_pii_nino(a.tabla)) AS k(clave)
   WHERE COALESCE(CASE WHEN a.tabla = 'ninos' THEN a.registro_id::text END,
                  a.valores_antes->>'nino_id', a.valores_despues->>'nino_id') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.ninos n
                      WHERE n.id = COALESCE(CASE WHEN a.tabla = 'ninos' THEN a.registro_id::text END,
                                            a.valores_antes->>'nino_id', a.valores_despues->>'nino_id')::uuid)
     AND ((a.valores_antes ? k.clave AND a.valores_antes->>k.clave IS NOT NULL
           AND a.valores_antes->>k.clave <> '[borrado]')
       OR (a.valores_despues ? k.clave AND a.valores_despues->>k.clave IS NOT NULL
           AND a.valores_despues->>k.clave <> '[borrado]'));
  IF v_n > 0 THEN
    f := f || format('retroactiva: %s claves personales sin redactar de niños que ya no existen', v_n);
  END IF;

  IF cardinality(f) > 0 THEN
    RAISE EXCEPTION 'guarda de salida: %', array_to_string(f, ' | ');
  END IF;
END $guarda$;

DROP TABLE _purga_antes;
