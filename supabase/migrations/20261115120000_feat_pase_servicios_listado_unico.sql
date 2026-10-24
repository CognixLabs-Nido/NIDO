-- =============================================================================
-- FEAT — Recibos, PR-12: el listado único del pase de servicios
-- -----------------------------------------------------------------------------
-- Hasta ahora el parte de servicio (matinera, comedor, vespertina) se pasaba por aula, y solo lo
-- podía apuntar la profe del niño (`es_profe_de_nino`). En el centro lo rellena quien esté en el
-- comedor ese día, y marca a todos los niños, no solo a los de su aula.
--
-- Decisión del responsable: un listado ÚNICO con todos los alumnos del centro (clase, nombre) y
-- los tres servicios marcables en él. No se distingue quién tiene cuota mensual: se marca a todos
-- los que se quedan y el motor decide a quién se le cobra (PR-4). Lo rellena cualquier profesora,
-- tutora o ayudante del centro.
--
--   · Las tres policies de `parte_servicio_diario` pasan de `es_profe_de_nino(nino_id)` a
--     `es_profe_en_centro(centro_id)`: el rol `profe` vivo en el centro de la fila (la profesora,
--     la tutora y la ayudante tienen ese rol; su tipo en el aula es otra cosa). `es_admin` sigue.
--     La escritura exige además que el centro de la fila sea el del niño
--     (`privado.centro_de_nino`): al insertar ya lo fuerza el trigger
--     `parte_servicio_diario_set_centro_id`, pero un UPDATE podía cambiar el niño por uno de otro
--     centro conservando el `centro_id`. El DELETE sigue sin policy.
--   · `listado_pase_servicios(centro)`: los niños con matrícula activa en el curso activo del
--     centro, con SOLO su nombre, sus apellidos y su clase. `SECURITY DEFINER` porque la RLS de
--     `ninos` y `matriculas` no deja a la profe ver a los niños de otras aulas, y abrirle esas
--     tablas le daría la ficha completa de todos. Puerta: `es_admin` o `es_profe_en_centro` del
--     centro pedido, si no 42501; con centro NULL también 42501 (`es_admin(NULL)` da TRUE a
--     cualquier persona de Dirección).
--
-- En producción `parte_servicio_diario` tiene 0 filas (2026-10-24).
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor, DESPUÉS de
-- `20261114120000`. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_n integer;
BEGIN
  IF to_regprocedure('public.listado_pase_servicios(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'ya aplicada: existe listado_pase_servicios';
  END IF;
  -- Las tres policies son las leídas en producción (texto que deparsea Postgres: sin \r).
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'parte_servicio_diario';
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'parte_servicio_diario tiene % policies, se esperaban 3', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'parte_servicio_diario'
     AND roles = '{authenticated}'
     AND (   (policyname = 'parte_servicio_diario_select' AND cmd = 'SELECT'
              AND qual = '(es_admin(centro_id) OR es_profe_de_nino(nino_id))' AND with_check IS NULL)
          OR (policyname = 'parte_servicio_diario_insert' AND cmd = 'INSERT'
              AND qual IS NULL AND with_check = '(es_admin(centro_id) OR es_profe_de_nino(nino_id))')
          OR (policyname = 'parte_servicio_diario_update' AND cmd = 'UPDATE'
              AND qual = '(es_admin(centro_id) OR es_profe_de_nino(nino_id))'
              AND with_check = '(es_admin(centro_id) OR es_profe_de_nino(nino_id))'));
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'las policies de parte_servicio_diario no son las leídas en producción';
  END IF;
  -- Los helpers que se usan son los leídos (md5 normalizado: sin \r, sin comentarios, espacios
  -- colapsados).
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.es_profe_en_centro(uuid)');
  IF v_md5 IS DISTINCT FROM '529a7048689278ad679a9225e2f4e1e1' THEN
    RAISE EXCEPTION 'es_profe_en_centro no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('privado.centro_de_nino(uuid)');
  IF v_md5 IS DISTINCT FROM '7b5b55363325e117e858ab793b227073' THEN
    RAISE EXCEPTION 'privado.centro_de_nino no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.es_admin(uuid)');
  IF v_md5 IS DISTINCT FROM 'da96f192cef9402cf0618ea2cbd82902' THEN
    RAISE EXCEPTION 'es_admin no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT count(*) INTO v_n FROM public.parte_servicio_diario;
  RAISE NOTICE 'filas en parte_servicio_diario antes de aplicar: %', v_n;
END
$guarda$;

-- ---- Policies: cualquier profe del centro ----
ALTER POLICY parte_servicio_diario_select ON public.parte_servicio_diario
  USING (public.es_admin(centro_id) OR public.es_profe_en_centro(centro_id));
ALTER POLICY parte_servicio_diario_insert ON public.parte_servicio_diario
  WITH CHECK ((public.es_admin(centro_id) OR public.es_profe_en_centro(centro_id))
              AND centro_id = privado.centro_de_nino(nino_id));
ALTER POLICY parte_servicio_diario_update ON public.parte_servicio_diario
  USING (public.es_admin(centro_id) OR public.es_profe_en_centro(centro_id))
  WITH CHECK ((public.es_admin(centro_id) OR public.es_profe_en_centro(centro_id))
              AND centro_id = privado.centro_de_nino(nino_id));

-- ---- El listado: nombre y clase, nada más ----
CREATE FUNCTION public.listado_pase_servicios(p_centro_id uuid)
 RETURNS TABLE (nino_id uuid, nombre text, apellidos text, aula_id uuid, aula_nombre text)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_centro_id IS NULL
     OR NOT (public.es_admin(p_centro_id) OR public.es_profe_en_centro(p_centro_id)) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT n.id, n.nombre::text, n.apellidos::text, a.id, a.nombre::text
    FROM public.ninos n
    JOIN public.matriculas m ON m.nino_id = n.id
    JOIN public.cursos_academicos c ON c.id = m.curso_academico_id
    JOIN public.aulas a ON a.id = m.aula_id
   WHERE n.centro_id = p_centro_id
     AND n.deleted_at IS NULL
     AND c.centro_id = p_centro_id
     AND c.estado = 'activo'
     AND m.estado = 'activa' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
   ORDER BY a.nombre, n.apellidos, n.nombre, n.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.listado_pase_servicios(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listado_pase_servicios(uuid) TO authenticated;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_f constant regprocedure := 'public.listado_pase_servicios(uuid)'::regprocedure;
  v_md5 text;
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'parte_servicio_diario'
     AND roles = '{authenticated}'
     AND (   (policyname = 'parte_servicio_diario_select' AND cmd = 'SELECT'
              AND qual = '(es_admin(centro_id) OR es_profe_en_centro(centro_id))' AND with_check IS NULL)
          OR (policyname = 'parte_servicio_diario_insert' AND cmd = 'INSERT' AND qual IS NULL
              AND with_check = '((es_admin(centro_id) OR es_profe_en_centro(centro_id)) AND (centro_id = privado.centro_de_nino(nino_id)))')
          OR (policyname = 'parte_servicio_diario_update' AND cmd = 'UPDATE'
              AND qual = '(es_admin(centro_id) OR es_profe_en_centro(centro_id))'
              AND with_check = '((es_admin(centro_id) OR es_profe_en_centro(centro_id)) AND (centro_id = privado.centro_de_nino(nino_id)))'));
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'las policies de parte_servicio_diario no quedaron como este fichero (% de 3)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'parte_servicio_diario';
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'parte_servicio_diario tiene % policies, se esperaban 3 (sin DELETE)', v_n;
  END IF;
  -- La lógica de la función (md5 normalizado), calculada en Postgres sobre el cuerpo creado.
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = v_f;
  IF v_md5 IS DISTINCT FROM '3765ccbfa83093b64882aac64eee6918' THEN
    RAISE EXCEPTION 'listado_pase_servicios no quedó como este fichero: %', v_md5;
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_f) THEN
    RAISE EXCEPTION 'listado_pase_servicios no es SECURITY DEFINER';
  END IF;
  IF (SELECT proconfig FROM pg_proc WHERE oid = v_f) IS DISTINCT FROM ARRAY['search_path=public'] THEN
    RAISE EXCEPTION 'listado_pase_servicios sin search_path = public';
  END IF;
  IF has_function_privilege('anon', v_f, 'EXECUTE') OR has_function_privilege('public', v_f, 'EXECUTE') THEN
    RAISE EXCEPTION 'listado_pase_servicios abierta a anon o a PUBLIC';
  END IF;
  IF NOT has_function_privilege('authenticated', v_f, 'EXECUTE') THEN
    RAISE EXCEPTION 'listado_pase_servicios no la puede ejecutar authenticated';
  END IF;
  -- Devuelve solo nombre y clase: ninguna otra columna del niño.
  SELECT count(*) INTO v_n FROM unnest((SELECT proargnames FROM pg_proc WHERE oid = v_f)) a(nombre)
   WHERE a.nombre NOT IN ('p_centro_id', 'nino_id', 'nombre', 'apellidos', 'aula_id', 'aula_nombre');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'listado_pase_servicios devuelve % columnas de más', v_n;
  END IF;
  RAISE NOTICE 'guarda posterior: 3 policies con es_profe_en_centro; listado_pase_servicios solo para authenticated';
END
$guarda$;
