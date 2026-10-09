-- =============================================================================
-- FIX — `matriculas.motivo_baja` solo lo lee Dirección + recorrido reducido de la familia
-- -----------------------------------------------------------------------------
-- `motivo_baja` puede llevar notas internas del centro. Hasta ahora lo leía por la API
-- cualquiera que pudiese leer la fila: la familia (`matriculas_tutor_select`, cualquier
-- vínculo) y la profe del aula (`matriculas_profe_select`). Una policy RLS filtra FILAS,
-- no columnas, así que se cierra por PERMISO DE COLUMNA:
--
--   1. Se quita a `authenticated`/`anon`/`PUBLIC` el SELECT de TABLA sobre `matriculas` y
--      se devuelve a `authenticated` el SELECT de todas las columnas MENOS `motivo_baja`.
--      Las policies de filas NO cambian: quien leía filas las sigue leyendo, sin el motivo.
--      Pedir `motivo_baja` (o `select=*` / `matriculas(*)`) con sesión → 42501.
--      `service_role` conserva su permiso de tabla. Escribir el motivo no necesita SELECT
--      (las RPC de baja/rollover son SECURITY DEFINER).
--
--      ⚠️ CONSECUENCIA PERMANENTE: CADA COLUMNA NUEVA de `matriculas` necesitará su
--      `GRANT SELECT (columna) ON public.matriculas TO authenticated` explícito. Sin él,
--      nadie con sesión la podrá leer (ni siquiera Dirección).
--
--   2. `get_motivos_baja_matriculas(p_nino_ids)`: Dirección lee el motivo por aquí (la
--      ficha del niño y la lista de archivados). Solo admin del centro de TODOS los niños
--      pedidos; si no, 42501.
--
--   3. `get_recorrido_nino_familia(p_nino_id)`: recorrido REDUCIDO del niño para su tutor
--      LEGAL (no el autorizado): curso, aula, estado (`activa`/`baja`) y fechas. Nunca el
--      motivo ni las altas a medias (`pendiente`/`lista`). Si no es tutor legal, 42501.
--
-- Las dos RPC: REVOKE de PUBLIC/anon, GRANT EXECUTE a authenticated.
--
-- Estado verificado en producción el 2026-10-09: ninguna policy de otra tabla, función
-- SECURITY INVOKER ni vista lee `matriculas` (todas las funciones que la leen son
-- SECURITY DEFINER); no está en ninguna publicación de Realtime; ningún lector de la app
-- con sesión pide `motivo_baja` salvo las 3 consultas de Dirección que cambian en este PR.
--
-- Guardas: aborta si `matriculas` no tiene exactamente las columnas esperadas (una columna
-- nueva se quedaría sin GRANT) o si las RPC ya existen. Comprueba el resultado al final.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor (CLI SIGILL
-- en ARM). Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(attname, ',' ORDER BY attname)
    INTO v_cols
    FROM pg_attribute
   WHERE attrelid = 'public.matriculas'::regclass
     AND attnum > 0
     AND NOT attisdropped;

  IF v_cols IS DISTINCT FROM
     'activada_at,aula_id,created_at,curso_academico_id,deleted_at,estado,fecha_alta,fecha_baja,id,motivo_baja,nino_id' THEN
    RAISE EXCEPTION 'matriculas no tiene las columnas esperadas: %', v_cols;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc
     WHERE pronamespace = 'public'::regnamespace
       AND proname IN ('get_motivos_baja_matriculas', 'get_recorrido_nino_familia')
  ) THEN
    RAISE EXCEPTION 'get_motivos_baja_matriculas / get_recorrido_nino_familia ya existen';
  END IF;
END
$guarda$;

-- ---- 1. Permiso por columna ----
REVOKE SELECT ON public.matriculas FROM PUBLIC, anon, authenticated;

-- Todas MENOS motivo_baja. Columna nueva en matriculas ⇒ añadirla aquí en su migración.
GRANT SELECT (
  id,
  nino_id,
  aula_id,
  curso_academico_id,
  estado,
  fecha_alta,
  fecha_baja,
  created_at,
  deleted_at,
  activada_at
) ON public.matriculas TO authenticated;

-- ---- 2. Motivo de baja para Dirección ----
CREATE FUNCTION public.get_motivos_baja_matriculas(p_nino_ids uuid[])
RETURNS TABLE (matricula_id uuid, motivo_baja text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Admin del centro de CADA niño pedido. `centro_de_nino` NULL (niño inexistente) también
  -- se rechaza: `es_admin(NULL)` sería TRUE para cualquier admin.
  IF auth.uid() IS NULL OR EXISTS (
    SELECT 1
      FROM unnest(p_nino_ids) AS n(id)
     WHERE public.centro_de_nino(n.id) IS NULL
        OR NOT public.es_admin(public.centro_de_nino(n.id))
  ) THEN
    RAISE EXCEPTION 'no autorizado a leer el motivo de baja'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT m.id, m.motivo_baja
    FROM public.matriculas m
   WHERE m.nino_id = ANY (p_nino_ids)
     AND m.deleted_at IS NULL
     AND m.motivo_baja IS NOT NULL;
END
$function$;

REVOKE ALL ON FUNCTION public.get_motivos_baja_matriculas(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_motivos_baja_matriculas(uuid[]) TO authenticated;

-- ---- 3. Recorrido reducido para la familia ----
CREATE FUNCTION public.get_recorrido_nino_familia(p_nino_id uuid)
RETURNS TABLE (
  matricula_id uuid,
  aula_nombre text,
  curso_id uuid,
  curso_nombre text,
  curso_fecha_inicio date,
  fecha_alta date,
  fecha_baja date,
  estado public.matricula_estado
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.es_tutor_legal_de(p_nino_id) THEN
    RAISE EXCEPTION 'no autorizado a ver el recorrido de este niño'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT m.id, a.nombre, c.id, c.nombre, c.fecha_inicio, m.fecha_alta, m.fecha_baja, m.estado
    FROM public.matriculas m
    JOIN public.aulas a ON a.id = m.aula_id
    JOIN public.cursos_academicos c ON c.id = m.curso_academico_id
   WHERE m.nino_id = p_nino_id
     AND m.deleted_at IS NULL
     AND m.estado IN ('activa', 'baja')
   ORDER BY c.fecha_inicio DESC, m.fecha_alta, m.id;
END
$function$;

REVOKE ALL ON FUNCTION public.get_recorrido_nino_familia(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_recorrido_nino_familia(uuid) TO authenticated;

-- ---- Guarda posterior ----
DO $comprobacion$
BEGIN
  IF has_column_privilege('authenticated', 'public.matriculas', 'motivo_baja', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated sigue pudiendo leer matriculas.motivo_baja';
  END IF;
  IF has_table_privilege('authenticated', 'public.matriculas', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated conserva SELECT de tabla sobre matriculas';
  END IF;
  IF has_table_privilege('anon', 'public.matriculas', 'SELECT') THEN
    RAISE EXCEPTION 'anon conserva SELECT sobre matriculas';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.matriculas', 'estado', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated ha perdido el SELECT de matriculas.estado';
  END IF;
  IF has_function_privilege('anon', 'public.get_recorrido_nino_familia(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_motivos_baja_matriculas(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon puede ejecutar las RPC nuevas';
  END IF;
END
$comprobacion$;
