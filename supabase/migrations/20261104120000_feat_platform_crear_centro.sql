-- =============================================================================
-- FEAT — Fase 5, PR 2: crear un centro desde la plataforma e invitar a su admin
-- -----------------------------------------------------------------------------
-- El superusuario crea un centro desde el panel (`/plataforma`) y le invita la admin. Decisiones
-- del responsable:
--
--   · `platform_crear_centro`: el centro, su curso y la invitación de su admin en UNA transacción.
--     Formulario: nombre, dirección, teléfono, email de contacto e idioma (sin SEPA ni logo). El
--     curso lo calcula la app por la fecha y el superusuario lo puede cambiar; nace `activo`. Las
--     aulas las pone la directora. Sin reglas de arranque: no siembra nada más.
--   · El email de la admin es obligatorio.
--   · `platform_invitar_admin`: la invitación de admin es solo de la plataforma. Vale al crear y
--     siempre que el centro se quede sin admin viva; con admin viva, 55000 (aceptarla chocaría con
--     `idx_roles_usuario_una_admin_viva`). Sin email, reenvía la última (le da otros 7 días); con
--     email, caduca las pendientes y crea una nueva, así la última por `created_at` (la que lee
--     `platform_metricas`) es siempre la vigente.
--   · Nombres de centro únicos, bloqueado: `idx_centros_nombre_vivo_unico`, sin distinguir
--     mayúsculas ni espacios, entre los centros vivos. Cubre también renombrar (`updateCentro`).
--
-- Las dos RPC son `SECURITY DEFINER` y su PRIMERA sentencia es `is_superadmin()`: si no, 42501.
-- Nunca `es_admin(NULL)`. Escriben con la sesión del superusuario, que queda como actor en
-- `audit_log` (`centros`, `cursos_academicos` e `invitaciones` se auditan; `invitaciones` sin
-- `token`, y su email lo redacta la purga). Sin `EXECUTE` para `anon` ni `PUBLIC`.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor, DESPUÉS de
-- `20261103120000`. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_dup integer;
BEGIN
  IF to_regprocedure('public.platform_crear_centro(text,text,text,text,text,text,date,date,text)') IS NOT NULL
     OR to_regprocedure('public.platform_invitar_admin(uuid,text)') IS NOT NULL
     OR to_regclass('public.idx_centros_nombre_vivo_unico') IS NOT NULL THEN
    RAISE EXCEPTION 'platform_crear_centro, platform_invitar_admin o el índice ya existen';
  END IF;
  -- La puerta de la que depende todo: is_superadmin, con la lógica que se leyó en producción
  -- (md5 normalizado: sin \r, sin comentarios, espacios colapsados).
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.is_superadmin()');
  IF v_md5 IS DISTINCT FROM 'e5b750968737756e992fc03aacc862d6' THEN
    RAISE EXCEPTION 'is_superadmin no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  -- El índice de una admin viva por centro, del que depende el 55000 de invitar con admin.
  IF to_regclass('public.idx_roles_usuario_una_admin_viva') IS NULL THEN
    RAISE EXCEPTION 'falta idx_roles_usuario_una_admin_viva';
  END IF;
  -- El índice único no se puede crear con nombres repetidos entre los centros vivos.
  SELECT count(*) INTO v_dup
    FROM (SELECT 1 FROM public.centros
           WHERE deleted_at IS NULL
           GROUP BY lower(regexp_replace(btrim(nombre), '\s+', ' ', 'g'))
          HAVING count(*) > 1) d;
  IF v_dup > 0 THEN
    RAISE EXCEPTION 'hay % nombres de centro repetidos entre los centros vivos', v_dup;
  END IF;
  RAISE NOTICE 'guarda previa: is_superadmin es la de producción; % nombres repetidos entre los centros vivos', v_dup;
END
$guarda$;

-- Nombres de centro únicos entre los vivos, sin distinguir mayúsculas ni espacios.
CREATE UNIQUE INDEX idx_centros_nombre_vivo_unico
  ON public.centros (lower(regexp_replace(btrim(nombre), '\s+', ' ', 'g')))
  WHERE deleted_at IS NULL;

CREATE FUNCTION public.platform_invitar_admin(p_centro_id uuid, p_email text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_email text := lower(btrim(p_email));
  v_id uuid;
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Solo la plataforma invita a la admin de un centro' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.centros WHERE id = p_centro_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'El centro no existe' USING ERRCODE = 'P0002', HINT = 'centro';
  END IF;
  -- Con una admin viva no se invita otra: aceptarla chocaría con idx_roles_usuario_una_admin_viva.

  -- Sin email: reenviar la última invitación de admin sin aceptar ni rechazar, con otros 7 días.
  IF v_email IS NULL OR v_email = '' THEN
    SELECT i.id INTO v_id
      FROM public.invitaciones i
     WHERE i.centro_id = p_centro_id AND i.rol_objetivo = 'admin'
       AND i.accepted_at IS NULL AND i.rejected_at IS NULL
     ORDER BY i.created_at DESC, i.expires_at DESC
     LIMIT 1;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'No hay invitación de admin que reenviar' USING ERRCODE = 'P0002', HINT = 'sin_invitacion';
    END IF;
    UPDATE public.invitaciones SET expires_at = now() + interval '7 days' WHERE id = v_id;
    RETURN v_id;
  END IF;

  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR char_length(v_email) > 254 THEN
    RAISE EXCEPTION 'El email de la admin no es válido' USING ERRCODE = '22023', HINT = 'email_admin';
  END IF;

  -- Una invitación nueva caduca las pendientes: la última por created_at es siempre la vigente.
  UPDATE public.invitaciones
     SET expires_at = now()
   WHERE centro_id = p_centro_id AND rol_objetivo = 'admin'
     AND accepted_at IS NULL AND rejected_at IS NULL
     AND expires_at > now();

  INSERT INTO public.invitaciones (email, rol_objetivo, centro_id, invitado_por, expires_at)
  VALUES (v_email, 'admin', p_centro_id, auth.uid(), now() + interval '7 days')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE FUNCTION public.platform_crear_centro(
  p_nombre text,
  p_direccion text,
  p_telefono text,
  p_email_contacto text,
  p_idioma text,
  p_curso_nombre text,
  p_curso_inicio date,
  p_curso_fin date,
  p_email_admin text
)
RETURNS TABLE (centro_id uuid, invitacion_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
#variable_conflict use_column
DECLARE
  v_centro uuid;
  v_invitacion uuid;
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Solo la plataforma crea centros' USING ERRCODE = '42501';
  END IF;

  -- Las mismas longitudes que el formulario (updateCentroSchema y createCursoSchema).
  IF char_length(btrim(coalesce(p_nombre, ''))) NOT BETWEEN 2 AND 120
     OR char_length(btrim(coalesce(p_direccion, ''))) NOT BETWEEN 2 AND 240
     OR char_length(btrim(coalesce(p_telefono, ''))) NOT BETWEEN 5 AND 30
     OR char_length(btrim(coalesce(p_email_contacto, ''))) NOT BETWEEN 3 AND 120
     OR btrim(coalesce(p_email_contacto, '')) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     OR char_length(btrim(coalesce(p_curso_nombre, ''))) NOT BETWEEN 2 AND 40
     OR p_curso_inicio IS NULL OR p_curso_fin IS NULL THEN
    RAISE EXCEPTION 'Faltan datos del centro o del curso' USING ERRCODE = '22023', HINT = 'datos_centro';
  END IF;
  IF p_email_admin IS NULL OR btrim(p_email_admin) = '' THEN
    RAISE EXCEPTION 'El email de la admin es obligatorio' USING ERRCODE = '22023', HINT = 'email_admin';
  END IF;

  BEGIN
    INSERT INTO public.centros (nombre, direccion, telefono, email_contacto, idioma_default)
    VALUES (btrim(p_nombre), btrim(p_direccion), btrim(p_telefono), lower(btrim(p_email_contacto)), p_idioma)
    RETURNING id INTO v_centro;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Ya hay un centro con ese nombre' USING ERRCODE = '23505', HINT = 'nombre_duplicado';
  END;

  INSERT INTO public.cursos_academicos (centro_id, nombre, fecha_inicio, fecha_fin, estado)
  VALUES (v_centro, btrim(p_curso_nombre), p_curso_inicio, p_curso_fin, 'activo');

  v_invitacion := public.platform_invitar_admin(v_centro, p_email_admin);

  RETURN QUERY SELECT v_centro, v_invitacion;
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_invitar_admin(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_invitar_admin(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.platform_crear_centro(text, text, text, text, text, text, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_crear_centro(text, text, text, text, text, text, date, date, text) TO authenticated;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_f regprocedure;
  v_md5 text;
  v_src text;
  v_norm text;
  v_esperado jsonb := jsonb_build_object(
    'public.platform_invitar_admin(uuid,text)', '19d0d92dfe5bd63fb9c81ef3bacd6f34',
    'public.platform_crear_centro(text,text,text,text,text,text,date,date,text)', '7dc5ce089692c34ad3f950e8e4cc727e');
  v_firma text;
BEGIN
  FOR v_firma IN SELECT jsonb_object_keys(v_esperado) LOOP
    v_f := v_firma::regprocedure;
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = v_f;
    v_norm := regexp_replace(regexp_replace(replace(v_src, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g');
    v_md5 := md5(v_norm);
    -- La lógica de este fichero (md5 normalizado), calculada en Postgres sobre el cuerpo creado.
    IF v_md5 IS DISTINCT FROM v_esperado ->> v_firma THEN
      RAISE EXCEPTION '% no quedó como este fichero: %', v_firma, v_md5;
    END IF;
    -- La primera sentencia es la puerta del superusuario (y no es_admin).
    IF v_norm !~ '^ ?(#variable_conflict use_column )?DECLARE .*? BEGIN IF NOT public\.is_superadmin\(\) THEN RAISE EXCEPTION' THEN
      RAISE EXCEPTION 'la primera sentencia de % no es la puerta is_superadmin', v_firma;
    END IF;
    IF v_src ~ 'es_admin' THEN
      RAISE EXCEPTION '% no puede usar es_admin', v_firma;
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_f) THEN
      RAISE EXCEPTION '% no es SECURITY DEFINER', v_firma;
    END IF;
    IF (SELECT proconfig FROM pg_proc WHERE oid = v_f) IS DISTINCT FROM ARRAY['search_path=public'] THEN
      RAISE EXCEPTION '% sin search_path = public', v_firma;
    END IF;
    IF has_function_privilege('anon', v_f, 'EXECUTE') OR has_function_privilege('public', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION '% abierta a anon o a PUBLIC', v_firma;
    END IF;
    IF NOT has_function_privilege('authenticated', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION '% no la puede ejecutar authenticated', v_firma;
    END IF;
  END LOOP;
  -- El índice, único, parcial sobre los vivos y con la expresión normalizada.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index x
     WHERE x.indexrelid = 'public.idx_centros_nombre_vivo_unico'::regclass
       AND x.indisunique
       AND pg_get_expr(x.indpred, x.indrelid) = '(deleted_at IS NULL)'
       AND pg_get_indexdef(x.indexrelid) LIKE '%lower(regexp_replace(btrim(nombre)%') THEN
    RAISE EXCEPTION 'idx_centros_nombre_vivo_unico no quedó como este fichero';
  END IF;
  RAISE NOTICE 'guarda posterior: las dos RPC con la puerta is_superadmin, solo authenticated; índice de nombres';
END
$guarda$;
