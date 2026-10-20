-- =============================================================================
-- FIX — El rol directora en la base de datos (PR 2 del modelo de roles)
-- -----------------------------------------------------------------------------
-- Tres niveles: superusuario, admin (una por centro) y directora (una o varias). La admin es
-- también directora sin fila aparte. `20261030120000` añadió el valor `directora` a `user_role`;
-- esta migración le da su sitio:
--   · `es_admin(centro)` pasa a ser «Dirección»: la admin o una directora del centro, o el
--     superusuario. Todo el día a día que ya pasaba por `es_admin` le llega a la directora.
--     Lo exclusivo de la admin pasa por `privado.es_responsable` desde `20261029120000`.
--   · Anti-escalada: en `roles_usuario` e `invitaciones`, crear, cambiar o quitar una fila de rol
--     `admin` o `directora` exige `es_responsable`. Una directora no nombra a otra ni toca a la
--     admin, ni se toca a sí misma. Los demás roles siguen siendo de Dirección. Ninguna función
--     escribe roles de Dirección (censo en producción): solo `tutor_legal`, o los retira.
--   · `firma_imagen_sync` comparaba `rol = 'admin'`: la firma presencial de la directora entraba
--     por la policy (`es_admin`) y el consentimiento de imagen no se registraba. Ahora cuenta la
--     admin o la directora del centro del niño. El superusuario sigue fuera, como hasta ahora.
--   · Una admin viva por centro: índice único parcial. En producción hay una.
--   · Autorizaciones:
--       - la identidad de un documento no cambia: tipo, plantilla o instancia, alcance (niño, aula,
--         evento), centro, plantilla de la que sale y autor. Quien crea la fila (la directora, la
--         profe de su salida, la familia de su recogida o medicación) podía cambiarla entera
--         mientras nadie la firmara: una familia convertía su recogida en las normas del centro
--         para todo el centro o se la llevaba a otro centro, y una profe convertía su salida en la
--         plantilla de las normas. Trigger para todos, también `service_role`: ni la app ni
--         ninguna función cambian esas columnas (solo `archivar_autorizacion`, las de archivado);
--       - las plantillas de las normas internas y del consentimiento de imagen las edita solo la
--         admin, también si las creó otra persona (una directora que fue admin). En producción no
--         hay ninguna.
--
-- Los roles se comparan como texto (`rol::text IN ('admin', 'directora')`): así esta migración no
-- usa el valor nuevo como literal del enum y se puede ensayar en producción en la misma
-- transacción que lo añade. La guarda previa exige que el valor exista.
--
-- `es_admin(NULL)` sigue siendo TRUE para cualquier persona de Dirección de cualquier centro, como
-- hasta ahora para cualquier admin: ninguna policy ni función se lo pasa (Fase 4).
--
-- Sin cambio para nadie que no sea directora, salvo lo declarado: el cambio de identidad de una
-- autorización, que ya no puede hacer nadie. Hoy no hay ninguna directora.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor, DESPUÉS de
-- `20261030120000`. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_n int;
  v_admins int;
  v_directoras int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.user_role'::regtype AND enumlabel = 'directora') THEN
    RAISE EXCEPTION 'falta el valor directora en user_role: aplica antes 20261030120000';
  END IF;

  -- Las 12 policies de las tres tablas que se tocan, como en el repo.
  SELECT md5(string_agg(md5(schemaname || '.' || tablename || '.' || policyname || '|' || cmd || '|'
                            || permissive || '|' || roles::text || '|' || coalesce(qual, '') || '|'
                            || coalesce(with_check, '')), ',' ORDER BY schemaname, tablename, policyname)),
         count(*)
    INTO v_md5, v_n
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('autorizaciones', 'invitaciones', 'roles_usuario');
  IF v_n <> 12 OR v_md5 IS DISTINCT FROM '73301ba50a90fb8856170d62c1321b33' THEN
    RAISE EXCEPTION 'las policies no son las esperadas (% policies, md5 %)', v_n, v_md5;
  END IF;

  SELECT md5(regexp_replace(regexp_replace(replace(prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc WHERE oid = 'public.es_admin(uuid)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '33083a5ff24e8fd5ebaa03cb251e8ec8' THEN
    RAISE EXCEPTION 'el cuerpo de es_admin no es el esperado (md5 %)', v_md5;
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc WHERE oid = 'public.firma_imagen_sync()'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'bf1f1a278def5c76aa4ffe40aab23dc9' THEN
    RAISE EXCEPTION 'el cuerpo de firma_imagen_sync no es el esperado (md5 %)', v_md5;
  END IF;

  IF to_regprocedure('public.autorizaciones_identidad_inmutable()') IS NOT NULL
     OR to_regclass('public.idx_roles_usuario_una_admin_viva') IS NOT NULL THEN
    RAISE EXCEPTION 'el trigger o el índice ya existen';
  END IF;

  -- El índice: ningún centro con dos admins vivas (si no, el CREATE INDEX fallaría sin decir cuál).
  SELECT coalesce(max(n), 0) INTO v_admins
    FROM (SELECT count(*) n FROM public.roles_usuario
           WHERE rol = 'admin' AND deleted_at IS NULL GROUP BY centro_id) x;
  IF v_admins > 1 THEN
    RAISE EXCEPTION 'hay un centro con % admins vivas: el índice no cabe', v_admins;
  END IF;
  SELECT count(*) INTO v_directoras FROM public.roles_usuario WHERE rol::text = 'directora';
  RAISE NOTICE 'guarda previa: 12 policies y 2 cuerpos como en el repo; admins vivas por centro, como mucho %; filas de directora: %',
    v_admins, v_directoras;
END
$guarda$;

-- -----------------------------------------------------------------------------
-- es_admin: Dirección
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.es_admin(p_centro_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Dirección: la admin o una directora del centro, o el superusuario si el centro existe.
  -- Con NULL, TRUE para cualquiera de ellas: lo exclusivo de la admin va por es_responsable.
  SELECT EXISTS (
    SELECT 1 FROM public.roles_usuario
    WHERE usuario_id = auth.uid()
      AND rol::text IN ('admin', 'directora')
      AND deleted_at IS NULL
      AND (p_centro_id IS NULL OR centro_id = p_centro_id)
  )
  OR (public.is_superadmin()
      AND (p_centro_id IS NULL OR EXISTS (SELECT 1 FROM public.centros c WHERE c.id = p_centro_id)));
$function$;

-- -----------------------------------------------------------------------------
-- Anti-escalada: los roles de Dirección, solo la admin
-- -----------------------------------------------------------------------------
ALTER POLICY roles_admin_insert ON public.roles_usuario
  WITH CHECK (es_admin(centro_id) AND ((rol)::text NOT IN ('admin', 'directora') OR privado.es_responsable(centro_id)));
ALTER POLICY roles_admin_update ON public.roles_usuario
  USING (es_admin(centro_id) AND ((rol)::text NOT IN ('admin', 'directora') OR privado.es_responsable(centro_id)))
  WITH CHECK (es_admin(centro_id) AND ((rol)::text NOT IN ('admin', 'directora') OR privado.es_responsable(centro_id)));
ALTER POLICY roles_admin_delete ON public.roles_usuario
  USING (es_admin(centro_id) AND ((rol)::text NOT IN ('admin', 'directora') OR privado.es_responsable(centro_id)));

ALTER POLICY invitaciones_admin_insert ON public.invitaciones
  WITH CHECK (es_admin(centro_id) AND ((rol_objetivo)::text NOT IN ('admin', 'directora') OR privado.es_responsable(centro_id)));
ALTER POLICY invitaciones_admin_update ON public.invitaciones
  USING (es_admin(centro_id) AND ((rol_objetivo)::text NOT IN ('admin', 'directora') OR privado.es_responsable(centro_id)))
  WITH CHECK (es_admin(centro_id) AND ((rol_objetivo)::text NOT IN ('admin', 'directora') OR privado.es_responsable(centro_id)));
ALTER POLICY invitaciones_admin_delete ON public.invitaciones
  USING (es_admin(centro_id) AND ((rol_objetivo)::text NOT IN ('admin', 'directora') OR privado.es_responsable(centro_id)));

-- -----------------------------------------------------------------------------
-- Una admin viva por centro
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX idx_roles_usuario_una_admin_viva ON public.roles_usuario (centro_id)
  WHERE rol = 'admin'::user_role AND deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- firma_imagen_sync: la firma presencial de la admin o de una directora del centro
-- -----------------------------------------------------------------------------
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
          AND EXISTS (SELECT 1 FROM public.roles_usuario ru
                       WHERE ru.usuario_id = NEW.firmante_id
                         AND ru.rol::text IN ('admin', 'directora')
                         AND ru.deleted_at IS NULL
                         AND ru.centro_id = privado.centro_de_nino(NEW.nino_id)))
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

-- -----------------------------------------------------------------------------
-- Autorizaciones: la identidad del documento no cambia
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.autorizaciones_identidad_inmutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Para todos, también service_role: nadie cambia estas columnas (censo en producción).
  IF NEW.tipo         IS DISTINCT FROM OLD.tipo
  OR NEW.es_plantilla IS DISTINCT FROM OLD.es_plantilla
  OR NEW.ambito       IS DISTINCT FROM OLD.ambito
  OR NEW.centro_id    IS DISTINCT FROM OLD.centro_id
  OR NEW.nino_id      IS DISTINCT FROM OLD.nino_id
  OR NEW.evento_id    IS DISTINCT FROM OLD.evento_id
  OR NEW.aula_id      IS DISTINCT FROM OLD.aula_id
  OR NEW.plantilla_id IS DISTINCT FROM OLD.plantilla_id
  OR NEW.creado_por   IS DISTINCT FROM OLD.creado_por THEN
    RAISE EXCEPTION 'autorizaciones: el tipo, el alcance, el centro, la plantilla y el autor no se cambian (crea otra)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.autorizaciones_identidad_inmutable() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER autorizaciones_identidad_inmutable_trg
  BEFORE UPDATE ON public.autorizaciones
  FOR EACH ROW EXECUTE FUNCTION public.autorizaciones_identidad_inmutable();

-- Las plantillas de las normas internas y del consentimiento de imagen, solo la admin, también si
-- las creó otra persona. El resto, como hasta ahora: quien la creó o Dirección.
ALTER POLICY autorizaciones_update ON public.autorizaciones
  USING (privado.es_responsable(centro_id) OR (NOT (es_plantilla AND (tipo = ANY (ARRAY['reglas_regimen_interno'::tipo_autorizacion, 'autorizacion_imagenes'::tipo_autorizacion]))) AND ((creado_por = auth.uid()) OR es_admin(centro_id))))
  WITH CHECK (privado.es_responsable(centro_id) OR (NOT (es_plantilla AND (tipo = ANY (ARRAY['reglas_regimen_interno'::tipo_autorizacion, 'autorizacion_imagenes'::tipo_autorizacion]))) AND ((creado_por = auth.uid()) OR es_admin(centro_id))));

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_md5 text;
  v_n int;
  v_con text[];
BEGIN
  SELECT md5(regexp_replace(regexp_replace(replace(prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc WHERE oid = 'public.es_admin(uuid)'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'da96f192cef9402cf0618ea2cbd82902' THEN
    RAISE EXCEPTION 'es_admin no es la esperada (md5 %)', v_md5;
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc WHERE oid = 'public.firma_imagen_sync()'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'b5d5d3631eb3ff181ad1ebbd7ce7f428' THEN
    RAISE EXCEPTION 'firma_imagen_sync no es la esperada (md5 %)', v_md5;
  END IF;

  -- Ninguna función de public ni de privado compara ya rol = 'admin' a secas, salvo es_responsable.
  SELECT array_agg(nombre ORDER BY nombre COLLATE "C") INTO v_con
    FROM (SELECT n.nspname || '.' || p.proname AS nombre
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname IN ('public', 'privado')
             AND regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~ 'rol\s*=\s*''admin''') f;
  IF v_con IS DISTINCT FROM ARRAY['privado.es_responsable'] THEN
    RAISE EXCEPTION 'funciones que comparan rol = admin: %', v_con;
  END IF;

  -- Las 6 policies de roles e invitaciones con la anti-escalada, y ninguna con la de antes.
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('roles_usuario', 'invitaciones')
     AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%''directora''%';
  IF v_n <> 6 OR EXISTS (SELECT 1 FROM pg_policies
                          WHERE coalesce(qual, '') || coalesce(with_check, '') LIKE '%<> ''admin''::user_role%') THEN
    RAISE EXCEPTION 'anti-escalada: % de 6 policies, o queda la condición de antes', v_n;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'autorizaciones_identidad_inmutable_trg'
                  AND tgrelid = 'public.autorizaciones'::regclass AND tgenabled = 'O')
     OR has_function_privilege('authenticated', 'public.autorizaciones_identidad_inmutable()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.autorizaciones_identidad_inmutable()', 'EXECUTE') THEN
    RAISE EXCEPTION 'trigger de identidad: no está, o su función se puede ejecutar';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = 'public.idx_roles_usuario_una_admin_viva'::regclass AND indisunique) THEN
    RAISE EXCEPTION 'falta el índice único de una admin viva por centro';
  END IF;

  SELECT md5(string_agg(md5(schemaname || '.' || tablename || '.' || policyname || '|' || cmd || '|'
                            || permissive || '|' || roles::text || '|' || coalesce(qual, '') || '|'
                            || coalesce(with_check, '')), ',' ORDER BY schemaname, tablename, policyname)),
         count(*)
    INTO v_md5, v_n
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('autorizaciones', 'invitaciones', 'roles_usuario');
  IF v_n <> 12 THEN
    RAISE EXCEPTION 'se esperaban 12 policies en las tres tablas, hay %', v_n;
  END IF;
  RAISE NOTICE 'guarda posterior: es_admin y firma_imagen_sync con directora, anti-escalada en 6 policies, trigger e índice (md5 de las 12: %)', v_md5;
END
$guarda$;
