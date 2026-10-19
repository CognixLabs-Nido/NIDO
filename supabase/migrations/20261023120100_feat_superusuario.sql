-- =============================================================================
-- Multicentro · Fase 3 · El superusuario (base de datos).
--
-- Decisiones del responsable (2026-10-19): un solo superusuario, con acceso total (admin de
-- todos los centros) y cada entrada a un centro auditada. Su rol de admin en CEI Ejemplo se
-- retira (borrado lógico con motivo) y en la MISMA migración entra una directora, para que el
-- centro no quede ni un momento sin admin. Es admin, no profe ni tutor: no entra en los helpers
-- de profe ni de tutor (si fuera tutor podría firmar en nombre de una familia).
--
-- 1. Guarda de entrada: las seis funciones que se reescriben y las cuatro policies que se
--    tocan son las vivas, lo nuevo no existe y el motivo de 20261023120000 ya está.
-- 2. platform_admins: quién es superusuario. Sin ninguna policy (ni de lectura ni de
--    escritura) y sin permisos para anon ni authenticated: desde la app solo se pregunta, con
--    is_superadmin(). Se escribe aquí, en migraciones. No se audita: su histórico es git.
-- 3. is_superadmin(): ¿quien llama está en platform_admins?
-- 4. es_admin(centro): además, el superusuario es admin de todo centro que EXISTA. Con NULL
--    («admin de algún centro») le da TRUE, como a cualquier admin: censado el 2026-10-19, en
--    producción no hay ninguna llamada con NULL literal (las cuatro que salen en el código son
--    comentarios de funciones que ya rechazan el centro NULL antes de preguntar).
-- 5. es_admin_de_usuario / es_staff_de_usuario (avatares, usuarios-fotos): leían el rol de
--    quien llama en roles_usuario, sin pasar por es_admin. Ahora preguntan a es_admin y a
--    es_profe_en_centro por cada centro del usuario objetivo: lo mismo para todos, y el
--    superusuario entra por es_admin.
-- 6. Los registros presenciales en nombre de una familia NO son del superusuario: los hace la
--    directora, que tiene a la familia delante (decisión del responsable, 2026-10-20). Se le
--    cierra la rama de admin de firmas_insert (firma presencial de una autorización),
--    otorgar_consentimiento_imagen y registrar_/sustituir_mandato_sepa. La de tutor no cambia.
-- 7. menu_dia_select, dias_centro_select y plantillas_menu_select: el admin leía estas tres
--    tablas solo como miembro del centro (pertenece_a_centro). Se añade OR es_admin, que para
--    un admin con rol no cambia nada y deja leer al superusuario.
-- 8. registrar_entrada_superusuario(centro): cada entrada a un centro deja una fila en
--    audit_log (tabla 'entrada_superusuario', registro y centro = el centro, usuario = el
--    superusuario, sin valores): ningún dato de ningún sujeto, así que la redacción de la
--    purga no tiene nada que limpiar. La llama la app al elegir centro.
-- 9. Siembra y relevo en CEI Ejemplo:
--    - siembra el superusuario buscando su cuenta por email; si no la encuentra, no siembra y
--      lo dice (la base vacía del CI no la tiene). Imprime el recuento en los dos casos;
--    - si el superusuario es admin de CEI Ejemplo: da el rol de admin a la directora (su
--      cuenta tiene que existir ya en Auth y no tener ningún rol) y retira el suyo con motivo
--      'paso_a_superusuario'. Sin la cuenta de la directora la migración ABORTA entera: no se
--      retira nada ni se siembra nada.
-- 10. Guarda de salida: ningún centro que tenía admin se queda sin él, y lo nuevo es lo que se
--     ha escrito.
--
-- ANTES DE APLICAR: crear la cuenta de la directora en Supabase (Authentication → Users → Add
-- user → Create new user, con «Auto Confirm User»). Después, aplicar 20261023120000 y luego esta.
--
-- ORDEN: va a producción antes del merge. Hasta que se despliegue la app del superusuario, la
-- app no le reconoce: entra en CEI Ejemplo con la cuenta de la directora.
-- =============================================================================

-- 0. Foto previa: admins vivos por centro, para la guarda de salida.
CREATE TEMP TABLE _superusuario_admins_antes AS
SELECT c.id AS centro_id,
       (SELECT count(*) FROM public.roles_usuario r
         WHERE r.centro_id = c.id AND r.rol = 'admin' AND r.deleted_at IS NULL) AS n
  FROM public.centros c;

-- 1. Guarda de entrada.
DO $guarda$
DECLARE
  f text[] := '{}';
  r record;
BEGIN
  FOR r IN SELECT e.firma, e.esperado,
                  (SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
                     FROM pg_proc p WHERE p.oid = to_regprocedure(e.firma)) AS m
             FROM (VALUES ('public.es_admin(uuid)',            'd3ffb2a24bc96d5e9a4199738f2b9b83'),
                          ('public.es_admin_de_usuario(uuid)', '46c5b8ad337b41d89579129fa797d884'),
                          ('public.es_staff_de_usuario(uuid)', '181ee311e37788a3b115019f05b60728'),
                          ('public.otorgar_consentimiento_imagen(uuid,uuid,text,inet,text,firma_metodo)', '1dc1516dc56b567529157ce374fb131a'),
                          ('public.registrar_mandato_sepa(uuid,uuid,text,text,text,text,text,text,text,inet,text,timestamp with time zone,firma_metodo)', '6164aba769640c96694a54b3f8acc36d'),
                          ('public.sustituir_mandato_sepa(uuid,uuid,text,text,text,text,text,text,text,inet,text,timestamp with time zone,firma_metodo)', 'aa108e5d5552c03e6f3c08c2a41bbc4d')) e(firma, esperado) LOOP
    IF r.m IS DISTINCT FROM r.esperado THEN
      f := f || format('%s no es la viva esperada (md5 normalizado %s)', r.firma, coalesce(r.m, 'no existe'));
    END IF;
  END LOOP;

  FOR r IN SELECT e.tabla, e.pol, e.esperado,
                  (SELECT pg_get_expr(p.polqual, p.polrelid) FROM pg_policy p
                    WHERE p.polrelid = to_regclass('public.' || e.tabla) AND p.polname = e.pol) AS q
             FROM (VALUES ('menu_dia',                'menu_dia_select',        'pertenece_a_centro(centro_de_plantilla(plantilla_id))'),
                          ('dias_centro',             'dias_centro_select',     'pertenece_a_centro(centro_id)'),
                          ('plantillas_menu_mensual', 'plantillas_menu_select', 'pertenece_a_centro(centro_id)')) e(tabla, pol, esperado) LOOP
    IF r.q IS DISTINCT FROM r.esperado THEN
      f := f || format('%s no es la esperada (%s)', r.pol, coalesce(r.q, 'no existe'));
    END IF;
  END LOOP;
  IF (SELECT pg_get_expr(p.polwithcheck, p.polrelid) FROM pg_policy p
       WHERE p.polrelid = 'public.firmas_autorizacion'::regclass AND p.polname = 'firmas_insert')
     IS DISTINCT FROM '((tiene_permiso_sobre(nino_id, ''puede_firmar_autorizaciones''::text) OR es_admin(centro_de_nino(nino_id))) AND (firmante_id = auth.uid()) AND autorizacion_aplica_a_nino(autorizacion_id, nino_id) AND autorizacion_firmable(autorizacion_id))' THEN
    f := f || 'firmas_insert no es la esperada'::text;
  END IF;

  IF to_regclass('public.platform_admins') IS NOT NULL
     OR to_regprocedure('public.is_superadmin()') IS NOT NULL
     OR to_regprocedure('public.registrar_entrada_superusuario(uuid)') IS NOT NULL THEN
    f := f || 'lo nuevo ya existe'::text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_enum
                  WHERE enumtypid = 'public.motivo_borrado'::regtype
                    AND enumlabel = 'paso_a_superusuario') THEN
    f := f || 'falta el motivo paso_a_superusuario: aplicar antes 20261023120000'::text;
  END IF;

  IF cardinality(f) > 0 THEN
    RAISE EXCEPTION 'guarda de entrada: %', array_to_string(f, ' | ');
  END IF;
  RAISE NOTICE 'guarda de entrada OK: % centros, % con admin',
    (SELECT count(*) FROM _superusuario_admins_antes),
    (SELECT count(*) FROM _superusuario_admins_antes WHERE n > 0);
END
$guarda$;

-- 2. Quién es superusuario.
CREATE TABLE public.platform_admins (
  usuario_id uuid PRIMARY KEY REFERENCES public.usuarios(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.platform_admins IS
  'Superusuarios de la plataforma (ADR-0061). Sin policies: se escribe solo en migraciones y se pregunta con is_superadmin().';
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_admins FROM PUBLIC, anon, authenticated;

-- 3. ¿Quien llama es superusuario?
CREATE FUNCTION public.is_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE usuario_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.is_superadmin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_superadmin() TO authenticated, service_role;

-- 4. es_admin: el superusuario es admin de todo centro que exista. Un centro inexistente le da
--    FALSE, como a cualquier admin (sin esto podría escribir en carpetas de Storage de un centro
--    que no existe). Con NULL, TRUE: «admin de algún centro».
CREATE OR REPLACE FUNCTION public.es_admin(p_centro_id uuid DEFAULT NULL::uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.roles_usuario
    WHERE usuario_id = auth.uid()
      AND rol = 'admin'
      AND deleted_at IS NULL
      AND (p_centro_id IS NULL OR centro_id = p_centro_id)
  )
  OR (public.is_superadmin()
      AND (p_centro_id IS NULL OR EXISTS (SELECT 1 FROM public.centros c WHERE c.id = p_centro_id)));
$function$;

-- 5. Avatares: por cada centro donde el usuario objetivo tiene un rol vivo, ¿quien llama es
--    admin (o admin o profe) de ese centro? Lo mismo que antes para quien tiene rol; el
--    superusuario entra por es_admin.
CREATE OR REPLACE FUNCTION public.es_admin_de_usuario(p_usuario_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.roles_usuario el
     WHERE el.usuario_id = p_usuario_id AND el.deleted_at IS NULL
       AND public.es_admin(el.centro_id)
  );
$function$;

CREATE OR REPLACE FUNCTION public.es_staff_de_usuario(p_usuario_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.roles_usuario el
     WHERE el.usuario_id = p_usuario_id AND el.deleted_at IS NULL
       AND (public.es_admin(el.centro_id) OR public.es_profe_en_centro(el.centro_id))
  );
$function$;

-- 6. Los registros presenciales en nombre de una familia los hace la directora del centro, que
--    es quien tiene a la familia delante; el superusuario no (decisión del responsable,
--    2026-10-20). Firma presencial de una autorización (firmas_insert), consentimiento de imagen
--    presencial (otorgar_consentimiento_imagen) y mandato SEPA presencial (registrar_ y
--    sustituir_mandato_sepa): se le cierra la rama de admin. La de tutor no cambia. Las tres
--    funciones son las vivas con ese único cambio en la puerta.
ALTER POLICY firmas_insert ON public.firmas_autorizacion
  WITH CHECK ((tiene_permiso_sobre(nino_id, 'puede_firmar_autorizaciones'::text)
               OR (es_admin(centro_de_nino(nino_id)) AND NOT is_superadmin()))
              AND (firmante_id = auth.uid())
              AND autorizacion_aplica_a_nino(autorizacion_id, nino_id)
              AND autorizacion_firmable(autorizacion_id));

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
    -- El superusuario no registra el consentimiento en nombre de un tutor (ADR-0061).
    v_admin := public.es_admin(public.centro_de_nino(p_nino_id)) AND NOT public.is_superadmin();
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

CREATE OR REPLACE FUNCTION public.registrar_mandato_sepa(p_familia_id uuid, p_nino_id uuid, p_iban text, p_titular text, p_identificador_mandato text, p_documento_path text, p_firma_imagen text, p_nombre_tecleado text, p_texto_hash text, p_ip_address inet, p_user_agent text, p_fecha_firma timestamp with time zone, p_metodo firma_metodo DEFAULT 'digital'::firma_metodo)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
  -- El superusuario no registra el mandato en nombre de la familia (ADR-0061).
  IF NOT ((public.es_admin(public.centro_de_familia(p_familia_id)) AND NOT public.is_superadmin())
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
$function$;

CREATE OR REPLACE FUNCTION public.sustituir_mandato_sepa(p_familia_id uuid, p_nino_id uuid, p_iban text, p_titular text, p_identificador_mandato text, p_documento_path text, p_firma_imagen text, p_nombre_tecleado text, p_texto_hash text, p_ip_address inet, p_user_agent text, p_fecha_firma timestamp with time zone, p_metodo firma_metodo DEFAULT 'digital'::firma_metodo)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clave text := public._get_sepa_key();
  v_uid   uuid := auth.uid();
  v_id    uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  -- El superusuario no registra el mandato en nombre de la familia (ADR-0061).
  IF NOT ((public.es_admin(public.centro_de_familia(p_familia_id)) AND NOT public.is_superadmin())
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
$function$;

-- 7. Las tres lecturas que el admin hacía solo como miembro del centro.
ALTER POLICY menu_dia_select ON public.menu_dia
  USING (pertenece_a_centro(centro_de_plantilla(plantilla_id)) OR es_admin(centro_de_plantilla(plantilla_id)));
ALTER POLICY dias_centro_select ON public.dias_centro
  USING (pertenece_a_centro(centro_id) OR es_admin(centro_id));
ALTER POLICY plantillas_menu_select ON public.plantillas_menu_mensual
  USING (pertenece_a_centro(centro_id) OR es_admin(centro_id));

-- 8. Entrada auditada del superusuario a un centro.
CREATE FUNCTION public.registrar_entrada_superusuario(p_centro_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'solo el superusuario registra su entrada a un centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_centro_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.centros WHERE id = p_centro_id) THEN
    RAISE EXCEPTION 'centro no encontrado: %', p_centro_id USING ERRCODE = 'no_data_found';
  END IF;
  -- Sin valores: el evento es «este superusuario entró en este centro», nada de un sujeto.
  INSERT INTO public.audit_log (tabla, registro_id, accion, usuario_id, centro_id)
  VALUES ('entrada_superusuario', p_centro_id, 'INSERT', auth.uid(), p_centro_id);
END
$$;
REVOKE ALL ON FUNCTION public.registrar_entrada_superusuario(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_entrada_superusuario(uuid) TO authenticated, service_role;

-- 9. Siembra y relevo en CEI Ejemplo.
DO $siembra$
DECLARE
  c_centro   CONSTANT uuid := '33c79b50-13b5-4962-b849-d88dd6a21366';  -- CEI Ejemplo
  v_super    uuid;
  v_dir      uuid;
  v_n        int;
  v_retirado int;
BEGIN
  PERFORM set_config('app.audit_actor', 'system:migracion_superusuario', true);

  SELECT id INTO v_super FROM auth.users WHERE lower(email) = 'jovimib@gmail.com';
  IF v_super IS NULL THEN
    -- La base vacía del CI no tiene la cuenta: no se siembra ni se retira nada.
    RAISE NOTICE 'superusuario: cuenta NO encontrada, 0 sembrados; relevo en CEI Ejemplo: no aplica';
    PERFORM set_config('app.audit_actor', '', true);
    RETURN;
  END IF;

  INSERT INTO public.platform_admins (usuario_id) VALUES (v_super);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'superusuario: cuenta encontrada, % sembrado(s)', v_n;

  IF NOT EXISTS (SELECT 1 FROM public.roles_usuario
                  WHERE usuario_id = v_super AND centro_id = c_centro
                    AND rol = 'admin' AND deleted_at IS NULL) THEN
    RAISE NOTICE 'relevo en CEI Ejemplo: el superusuario no es admin ahí, nada que retirar';
    PERFORM set_config('app.audit_actor', '', true);
    RETURN;
  END IF;

  SELECT id INTO v_dir FROM auth.users WHERE lower(email) = 'jovimib+director@gmail.com';
  IF v_dir IS NULL THEN
    RAISE EXCEPTION 'relevo en CEI Ejemplo: falta la cuenta de la directora en Auth; créala antes (no se ha aplicado nada)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE id = v_dir) THEN
    RAISE EXCEPTION 'relevo en CEI Ejemplo: la cuenta de la directora no tiene fila en usuarios';
  END IF;
  IF EXISTS (SELECT 1 FROM public.roles_usuario WHERE usuario_id = v_dir) THEN
    RAISE EXCEPTION 'relevo en CEI Ejemplo: la cuenta de la directora ya tiene roles; se esperaba una cuenta nueva';
  END IF;

  UPDATE public.usuarios SET nombre_completo = 'Dirección CEI Ejemplo' WHERE id = v_dir;
  INSERT INTO public.roles_usuario (usuario_id, centro_id, rol) VALUES (v_dir, c_centro, 'admin');
  UPDATE public.roles_usuario
     SET deleted_at = now(), deleted_reason = 'paso_a_superusuario'
   WHERE usuario_id = v_super AND centro_id = c_centro AND rol = 'admin' AND deleted_at IS NULL;
  GET DIAGNOSTICS v_retirado = ROW_COUNT;
  RAISE NOTICE 'relevo en CEI Ejemplo: 1 directora con rol admin, % rol(es) del superusuario retirado(s)', v_retirado;

  PERFORM set_config('app.audit_actor', '', true);
END
$siembra$;

-- 10. Guarda de salida.
DO $guarda$
DECLARE
  f text[] := '{}';
  r record;
BEGIN
  -- Ningún centro que tenía admin se queda sin él.
  FOR r IN SELECT a.centro_id, a.n,
                  (SELECT count(*) FROM public.roles_usuario x
                    WHERE x.centro_id = a.centro_id AND x.rol = 'admin' AND x.deleted_at IS NULL) AS n1
             FROM _superusuario_admins_antes a LOOP
    IF r.n > 0 AND r.n1 = 0 THEN
      f := f || format('el centro %s se queda sin admin', r.centro_id);
    END IF;
  END LOOP;

  -- Sin policies en platform_admins y sin permisos para anon ni authenticated.
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.platform_admins'::regclass)
     OR has_table_privilege('authenticated', 'public.platform_admins', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('anon', 'public.platform_admins', 'SELECT,INSERT,UPDATE,DELETE')
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.platform_admins'::regclass) THEN
    f := f || 'platform_admins: tiene policies, permisos para la app o RLS apagado'::text;
  END IF;

  FOR r IN SELECT p.oid::regprocedure::text AS fn, p.prosecdef, p.proconfig FROM pg_proc p
            WHERE p.oid IN ('public.is_superadmin()'::regprocedure,
                            'public.registrar_entrada_superusuario(uuid)'::regprocedure,
                            'public.es_admin(uuid)'::regprocedure,
                            'public.es_admin_de_usuario(uuid)'::regprocedure,
                            'public.es_staff_de_usuario(uuid)'::regprocedure,
                            'public.otorgar_consentimiento_imagen(uuid,uuid,text,inet,text,firma_metodo)'::regprocedure) LOOP
    IF NOT r.prosecdef OR NOT COALESCE('search_path=public' = ANY (r.proconfig), false) THEN
      f := f || format('%s: no es SECURITY DEFINER con search_path=public', r.fn);
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.is_superadmin()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.is_superadmin()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.registrar_entrada_superusuario(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.registrar_entrada_superusuario(uuid)', 'EXECUTE') THEN
    f := f || 'is_superadmin / registrar_entrada_superusuario: permisos no esperados'::text;
  END IF;

  -- Lo escrito es lo nuevo (espacios colapsados).
  IF strpos(regexp_replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.es_admin(uuid)'::regprocedure), '\s+', ' ', 'g'),
            'OR (public.is_superadmin()') = 0 THEN
    f := f || 'es_admin no pregunta por el superusuario'::text;
  END IF;
  -- Los registros presenciales: la rama de admin cierra al superusuario en las tres funciones y en
  -- la policy de firmas.
  FOR r IN SELECT p.oid::regprocedure::text AS fn, regexp_replace(p.prosrc, '\s+', ' ', 'g') AS src
             FROM pg_proc p
            WHERE p.oid IN ('public.otorgar_consentimiento_imagen(uuid,uuid,text,inet,text,firma_metodo)'::regprocedure,
                            'public.registrar_mandato_sepa(uuid,uuid,text,text,text,text,text,text,text,inet,text,timestamp with time zone,firma_metodo)'::regprocedure,
                            'public.sustituir_mandato_sepa(uuid,uuid,text,text,text,text,text,text,text,inet,text,timestamp with time zone,firma_metodo)'::regprocedure) LOOP
    IF strpos(r.src, 'AND NOT public.is_superadmin()') = 0 THEN
      f := f || format('%s: la rama de admin no cierra al superusuario', r.fn);
    END IF;
  END LOOP;
  IF strpos((SELECT pg_get_expr(p.polwithcheck, p.polrelid) FROM pg_policy p
              WHERE p.polrelid = 'public.firmas_autorizacion'::regclass AND p.polname = 'firmas_insert'),
            'NOT is_superadmin()') = 0 THEN
    f := f || 'firmas_insert: la rama de admin no cierra al superusuario'::text;
  END IF;

  FOR r IN SELECT e.pol, (SELECT pg_get_expr(p.polqual, p.polrelid) FROM pg_policy p WHERE p.polname = e.pol) AS q
             FROM (VALUES ('menu_dia_select'), ('dias_centro_select'), ('plantillas_menu_select')) e(pol) LOOP
    IF strpos(r.q, 'es_admin(') = 0 THEN
      f := f || format('%s no pregunta a es_admin', r.pol);
    END IF;
  END LOOP;

  IF cardinality(f) > 0 THEN
    RAISE EXCEPTION 'guarda de salida: %', array_to_string(f, ' | ');
  END IF;
  RAISE NOTICE 'superusuario: guardas de salida OK; % superusuario(s), % centros sin admin',
    (SELECT count(*) FROM public.platform_admins),
    (SELECT count(*) FROM public.centros c
      WHERE NOT EXISTS (SELECT 1 FROM public.roles_usuario x
                         WHERE x.centro_id = c.id AND x.rol = 'admin' AND x.deleted_at IS NULL));
END
$guarda$;

DROP TABLE _superusuario_admins_antes;
