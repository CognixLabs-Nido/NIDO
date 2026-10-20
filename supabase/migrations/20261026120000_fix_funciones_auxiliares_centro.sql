-- =============================================================================
-- FIX — Las funciones auxiliares solo contestan a quien es de su centro (PR 2a, Fase 4)
-- -----------------------------------------------------------------------------
-- 20261010130000 cerró a anon las 46 funciones auxiliares de `public`, pero con sesión seguían
-- contestando a cualquiera, fuera cual fuera su centro: son consultas puras por el id recibido.
-- Con un segundo centro, la directora o una familia de B podía preguntar por A: el menú, el
-- calendario, si un mes está cerrado, el consentimiento de imagen de un niño, su lactancia, el
-- curso activo, si alguien es tutor allí o el consentimiento de una persona.
--
-- Censo en producción (2026-10-20, read_only) de las 46, por quién las usa:
--   · 10 sin ningún uso con sesión: ni policies, ni CHECK, ni la app, ni funciones de invocador
--     (solo las llaman funciones SECURITY DEFINER, que corren como su dueño). Se les quita
--     `authenticated` (apartado A). service_role la conserva.
--   · 7 que la app llama por RPC. Se les añade la comprobación del centro:
--       - 5 que no usa ninguna policy: si quien llama no es del centro, 42501 (apartado B);
--       - `curso_activo_de_centro` y `es_tutor_en_centro`, que además usan policies
--         (`matriculas_profe_select`, `conversaciones_insert`, `recordatorios_*`) y, por dentro,
--         `es_profe_de_aula` y `es_redactor_de_aula`. Un RAISE ahí rompería cualquier consulta
--         que recorra filas de otro centro, así que a quien no es del centro no le contestan
--         nada: NULL y FALSE (apartado C).
--   · `tiene_consentimiento`: solo el consentimiento propio (apartado D). Su único llamador,
--     `marcar_matricula_lista`, ya pasa `auth.uid()`.
--   · El resto (4 de reloj y puras, 24 que usan policies o triggers de invocador) va en el PR 2b.
--
-- «Del centro» es `pertenece_a_centro` (un rol vivo en él) o `es_admin`, que da TRUE al
-- superusuario (ADR-0061). `es_admin(NULL)` es TRUE para cualquier admin: por eso solo se le pasa
-- un centro que no es NULL. Sin sesión, solo el servicio (el bloque de 20261002140000).
--
-- Demostrado contra la BD efímera del CI: `funciones-auxiliares-centro.rls.test.ts` (control
-- positivo en el commit 8809681).
--
-- Estado verificado en producción el 2026-10-20 (read_only): los 8 cuerpos que se reescriben
-- son los del repo (md5 normalizado, guarda previa), y 0 de las 4 asignaciones vivas de
-- `profes_aulas` son de una profe sin rol vivo en el centro del aula (con esta migración,
-- `es_profe_de_aula` dejaría de contar esas).
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor. Tras aplicar:
-- registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_esperado constant jsonb := jsonb_build_object(
    'curso_activo_de_centro', '26cd3a2e0833177185524ea45c1afbd5',
    'es_tutor_en_centro', '55f1aa215652f126099eb2bf063b834d',
    'existe_consentimiento_imagen', '753d36a05829a73ff05ecd31f057d496',
    'menu_del_dia', 'aa0a6b5e86209c495ee015a2740822e4',
    'mes_cerrado', 'f634576677fe7a874ee7d0d724dbb479',
    'nino_toma_comida_solida', 'cbf0c6fb934de8ca0262124bf729400c',
    'tiene_consentimiento', 'a1979932c502db5706ace1db07d02cee',
    'tipo_de_dia', 'f40e89c73df03eb6659747b161f8b148');
  r record;
  v_n int := 0;
  v_con_sesion int;
BEGIN
  -- Los cuerpos vivos tienen que ser los del repo (lógica normalizada: sin \r, sin comentarios
  -- `--` y con los espacios colapsados, como lo deja el SQL Editor).
  FOR r IN
    SELECT p.proname,
           md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) AS md5
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND v_esperado ? p.proname
  LOOP
    IF r.md5 IS DISTINCT FROM v_esperado ->> r.proname THEN
      RAISE EXCEPTION '% no es la esperada (md5 normalizado %)', r.proname, r.md5;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  IF v_n <> 8 THEN
    RAISE EXCEPTION 'se esperaban 8 funciones con una sola firma, hay %', v_n;
  END IF;

  SELECT count(*) INTO v_con_sesion
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('centro_abierto', 'centro_de_conversacion', 'centro_de_curso',
                       'centro_de_remesa', 'familia_de_nino', 'nino_de_conversacion',
                       'nino_de_recibo', 'publicacion_tiene_nino_sin_permiso',
                       'recibo_en_remesa', 'tiene_consentimiento_imagen')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  RAISE NOTICE 'guarda previa: 8 cuerpos como en el repo; de las 10 sin uso, % ejecutables con sesión',
    v_con_sesion;
END
$guarda$;

-- -----------------------------------------------------------------------------
-- A. Las 10 sin ningún uso con sesión: fuera `authenticated`
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.centro_abierto(uuid, date) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.centro_de_conversacion(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.centro_de_curso(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.centro_de_remesa(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.familia_de_nino(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.nino_de_conversacion(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.nino_de_recibo(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.publicacion_tiene_nino_sin_permiso(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.recibo_en_remesa(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.tiene_consentimiento_imagen(uuid) FROM authenticated;

-- -----------------------------------------------------------------------------
-- B. Las 5 que la app llama y ninguna policy usa: quien no es del centro, 42501
-- -----------------------------------------------------------------------------
-- Pasan de `sql` a `plpgsql` para poder abortar. La consulta es la misma.

CREATE OR REPLACE FUNCTION public.menu_del_dia(p_centro_id uuid, p_fecha date)
 RETURNS public.menu_dia
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_menu public.menu_dia;
BEGIN
  -- [PR 2a] Solo quien es del centro.
  IF auth.uid() IS NULL THEN
    IF NOT (COALESCE(auth.role(), '') = 'service_role'
            OR (session_user <> 'authenticator'
                AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
      RAISE EXCEPTION 'no autorizado: sin sesión solo el servicio'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NOT (public.pertenece_a_centro(p_centro_id)
             OR (p_centro_id IS NOT NULL AND public.es_admin(p_centro_id))) THEN
    RAISE EXCEPTION 'no autorizado: no es de este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT md.* INTO v_menu
  FROM public.menu_dia md
  JOIN public.plantillas_menu_mensual p ON p.id = md.plantilla_id
  WHERE p.centro_id = p_centro_id
    AND p.estado = 'publicada'::public.estado_plantilla_menu
    AND p.deleted_at IS NULL
    AND p.mes = EXTRACT(MONTH FROM p_fecha)::smallint
    AND p.anio = EXTRACT(YEAR FROM p_fecha)::smallint
    AND md.fecha = p_fecha
  LIMIT 1;

  -- Sin menú, NULL, como la versión `sql`. Por PostgREST las dos llegan igual: una fila con todo
  -- a NULL (medido el 2026-10-20 en un ensayo).
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN v_menu;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tipo_de_dia(p_centro_id uuid, p_fecha date)
 RETURNS public.tipo_dia_centro
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tipo public.tipo_dia_centro;
  v_dow int;
BEGIN
  -- [PR 2a] Solo quien es del centro.
  IF auth.uid() IS NULL THEN
    IF NOT (COALESCE(auth.role(), '') = 'service_role'
            OR (session_user <> 'authenticator'
                AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
      RAISE EXCEPTION 'no autorizado: sin sesión solo el servicio'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NOT (public.pertenece_a_centro(p_centro_id)
             OR (p_centro_id IS NOT NULL AND public.es_admin(p_centro_id))) THEN
    RAISE EXCEPTION 'no autorizado: no es de este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT tipo INTO v_tipo
  FROM public.dias_centro
  WHERE centro_id = p_centro_id AND fecha = p_fecha;

  IF FOUND THEN
    RETURN v_tipo;
  END IF;

  v_dow := EXTRACT(ISODOW FROM p_fecha)::int;
  IF v_dow <= 5 THEN
    RETURN 'lectivo'::public.tipo_dia_centro;
  ELSE
    RETURN 'cerrado'::public.tipo_dia_centro;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mes_cerrado(p_centro_id uuid, p_anio integer, p_mes integer)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [PR 2a] Solo quien es del centro.
  IF auth.uid() IS NULL THEN
    IF NOT (COALESCE(auth.role(), '') = 'service_role'
            OR (session_user <> 'authenticator'
                AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
      RAISE EXCEPTION 'no autorizado: sin sesión solo el servicio'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF FALSE AND NOT (public.pertenece_a_centro(p_centro_id) -- MUTACION n1

             OR (p_centro_id IS NOT NULL AND public.es_admin(p_centro_id))) THEN
    RAISE EXCEPTION 'no autorizado: no es de este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.cierre_mensual
    WHERE centro_id = p_centro_id AND anio = p_anio AND mes = p_mes
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.existe_consentimiento_imagen(p_nino_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro uuid := public.centro_de_nino(p_nino_id);
BEGIN
  -- [PR 2a] Solo quien es del centro del niño.
  IF auth.uid() IS NULL THEN
    IF NOT (COALESCE(auth.role(), '') = 'service_role'
            OR (session_user <> 'authenticator'
                AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
      RAISE EXCEPTION 'no autorizado: sin sesión solo el servicio'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NOT (public.pertenece_a_centro(v_centro)
             OR (v_centro IS NOT NULL AND public.es_admin(v_centro))) THEN
    RAISE EXCEPTION 'no autorizado: no es de este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN COALESCE((
    SELECT true FROM public.consentimientos
    WHERE tipo = 'imagen' AND nino_id = p_nino_id AND revocado_en IS NULL
    LIMIT 1
  ), false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.nino_toma_comida_solida(p_nino_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro uuid := public.centro_de_nino(p_nino_id);
BEGIN
  -- [PR 2a] Solo quien es del centro del niño.
  IF auth.uid() IS NULL THEN
    IF NOT (COALESCE(auth.role(), '') = 'service_role'
            OR (session_user <> 'authenticator'
                AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
      RAISE EXCEPTION 'no autorizado: sin sesión solo el servicio'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NOT (public.pertenece_a_centro(v_centro)
             OR (v_centro IS NOT NULL AND public.es_admin(v_centro))) THEN
    RAISE EXCEPTION 'no autorizado: no es de este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN COALESCE(
    (
      SELECT lactancia_estado NOT IN (
        'materna'::public.lactancia_estado,
        'biberon'::public.lactancia_estado
      )
      FROM public.datos_pedagogicos_nino
      WHERE nino_id = p_nino_id
    ),
    TRUE
  );
END;
$function$;

-- -----------------------------------------------------------------------------
-- C. Las 2 que además usan policies: a quien no es del centro no le contestan nada
-- -----------------------------------------------------------------------------
-- Siguen en `sql` y sin RAISE: se evalúan fila a fila dentro de policies, también sobre filas
-- de otros centros. La condición va dentro de la consulta: quien no es del centro recibe NULL
-- (no hay curso) o FALSE (no es tutor), igual que si no lo hubiera.

CREATE OR REPLACE FUNCTION public.curso_activo_de_centro(p_centro_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id FROM public.cursos_academicos
  WHERE centro_id = p_centro_id
    AND estado = 'activo'
    AND deleted_at IS NULL
    -- [PR 2a] Solo para quien es del centro; sin sesión, solo el servicio.
    AND (TRUE OR public.pertenece_a_centro(p_centro_id) -- MUTACION n2

         OR public.es_admin(p_centro_id)
         OR (auth.uid() IS NULL
             AND (COALESCE(auth.role(), '') = 'service_role'
                  OR (session_user <> 'authenticator'
                      AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                      AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL))))
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.es_tutor_en_centro(p_tutor_id uuid, p_centro_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.vinculos_familiares vf
    JOIN public.ninos n ON n.id = vf.nino_id
    WHERE vf.usuario_id = p_tutor_id
      AND vf.deleted_at IS NULL
      AND n.deleted_at IS NULL
      AND n.centro_id = p_centro_id
  )
  -- [PR 2a] Solo de sí mismo, o la directora de ese centro; sin sesión, solo el servicio.
  AND (p_tutor_id = auth.uid()
       OR TRUE OR public.es_admin(p_centro_id) -- MUTACION n3

       OR (auth.uid() IS NULL
           AND (COALESCE(auth.role(), '') = 'service_role'
                OR (session_user <> 'authenticator'
                    AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                    AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL))));
$function$;

-- -----------------------------------------------------------------------------
-- D. tiene_consentimiento: solo el propio
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tiene_consentimiento(p_usuario_id uuid, p_tipo public.consentimiento_tipo)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [PR 2a] Solo el consentimiento propio; sin sesión, solo el servicio.
  IF auth.uid() IS NULL THEN
    IF NOT (COALESCE(auth.role(), '') = 'service_role'
            OR (session_user <> 'authenticator'
                AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
      RAISE EXCEPTION 'no autorizado: sin sesión solo el servicio'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF FALSE AND p_usuario_id IS DISTINCT FROM auth.uid() THEN -- MUTACION n4
    RAISE EXCEPTION 'no autorizado: solo el consentimiento propio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.consentimientos
    WHERE usuario_id = p_usuario_id
      AND tipo = p_tipo
      AND revocado_en IS NULL
  );
END;
$function$;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_sin_sesion int;
  v_ok int;
  v_md5 text;
BEGIN
  -- A: las 10 sin `authenticated` y con service_role.
  SELECT count(*) INTO v_sin_sesion
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('centro_abierto', 'centro_de_conversacion', 'centro_de_curso',
                       'centro_de_remesa', 'familia_de_nino', 'nino_de_conversacion',
                       'nino_de_recibo', 'publicacion_tiene_nino_sin_permiso',
                       'recibo_en_remesa', 'tiene_consentimiento_imagen')
     AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND has_function_privilege('service_role', p.oid, 'EXECUTE');
  IF v_sin_sesion <> 10 THEN
    RAISE EXCEPTION 'de las 10 sin uso, solo % quedan sin sesión y con service_role', v_sin_sesion;
  END IF;

  -- B, C y D: la comprobación está en el código (no en un comentario, que el SQL Editor puede
  -- comerse) y los permisos no cambian.
  SELECT count(*) INTO v_ok
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND has_function_privilege('service_role', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND ((p.proname IN ('menu_del_dia', 'tipo_de_dia', 'mes_cerrado',
                         'existe_consentimiento_imagen', 'nino_toma_comida_solida')
           AND p.prosrc LIKE '%no autorizado: no es de este centro%')
       OR (p.proname = 'curso_activo_de_centro' AND p.prosrc LIKE '%pertenece_a_centro(p_centro_id)%')
       OR (p.proname = 'es_tutor_en_centro' AND p.prosrc LIKE '%p_tutor_id = auth.uid()%')
       OR (p.proname = 'tiene_consentimiento'
           AND p.prosrc LIKE '%no autorizado: solo el consentimiento propio%'));
  IF v_ok <> 8 THEN
    RAISE EXCEPTION 'solo % de las 8 funciones tienen la comprobación y sus permisos', v_ok;
  END IF;

  SELECT string_agg(p.proname || '=' ||
           md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')),
           ', ' ORDER BY p.proname)
    INTO v_md5
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('menu_del_dia', 'tipo_de_dia', 'mes_cerrado', 'existe_consentimiento_imagen',
                       'nino_toma_comida_solida', 'curso_activo_de_centro', 'es_tutor_en_centro',
                       'tiene_consentimiento');
  RAISE NOTICE 'guarda posterior: 10 sin sesión; 8 con la comprobación (md5 normalizado: %)', v_md5;
END
$guarda$;
