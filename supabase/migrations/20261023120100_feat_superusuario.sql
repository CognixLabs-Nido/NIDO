-- =============================================================================
-- Multicentro · Fase 3 · El superusuario (base de datos).
--
-- Decisiones del responsable (2026-10-19): un solo superusuario, con acceso total (admin de
-- todos los centros) y cada entrada a un centro auditada. Su rol de admin en CEI Ejemplo se
-- retira (borrado lógico con motivo) y en la MISMA migración entra una directora, para que el
-- centro no quede ni un momento sin admin. Es admin, no profe ni tutor: no entra en los helpers
-- de profe ni de tutor (si fuera tutor podría firmar en nombre de una familia).
--
-- 1. Guarda de entrada: las cuatro funciones que se reescriben y las tres policies que se
--    amplían son las vivas, lo nuevo no existe y el motivo de 20261023120000 ya está.
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
-- 6. firma_imagen_sync: la firma PRESENCIAL de Dirección también sincroniza el consentimiento
--    de imagen cuando la hace el superusuario (firmas_insert le deja firmar por es_admin; sin
--    esto la firma quedaba sin su consentimiento). Es el único cambio de la función.
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
                          ('public.firma_imagen_sync()',       'f95e602a1f3d00a239a5724817c8f605')) e(firma, esperado) LOOP
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

-- 6. firma_imagen_sync: la firma presencial del superusuario también sincroniza.
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
  IF a.es_plantilla OR a.tipo <> 'autorizacion_imagenes' THEN RETURN NEW; END IF;

  IF NEW.decision = 'firmado' THEN
    IF NOT (
         EXISTS (SELECT 1 FROM public.vinculos_familiares vf
                  WHERE vf.usuario_id = NEW.firmante_id
                    AND vf.nino_id = NEW.nino_id
                    AND vf.deleted_at IS NULL
                    AND vf.tipo_vinculo IN ('tutor_legal_principal', 'tutor_legal_secundario'))
      OR (NEW.metodo_firma = 'presencial'
          AND (EXISTS (SELECT 1 FROM public.roles_usuario ru
                        WHERE ru.usuario_id = NEW.firmante_id
                          AND ru.rol = 'admin'
                          AND ru.deleted_at IS NULL
                          AND ru.centro_id = public.centro_de_nino(NEW.nino_id))
               OR EXISTS (SELECT 1 FROM public.platform_admins pa
                           WHERE pa.usuario_id = NEW.firmante_id)))
    ) THEN
      RETURN NEW;
    END IF;
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
    UPDATE public.consentimientos
       SET revocado_en = now()
     WHERE tipo = 'imagen' AND usuario_id = NEW.firmante_id
       AND nino_id = NEW.nino_id AND revocado_en IS NULL;
  END IF;

  RETURN NEW;
END $function$;

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
                            'public.firma_imagen_sync()'::regprocedure) LOOP
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
