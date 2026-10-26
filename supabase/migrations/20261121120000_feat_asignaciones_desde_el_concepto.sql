-- =============================================================================
-- FEAT — Recibos, cada concepto se gestiona desde el propio concepto
-- -----------------------------------------------------------------------------
-- Asignar un concepto manual (la cuota mensual del comedor, un cargo familiar…) era niño a niño,
-- en el diálogo de cada uno. Decisión del responsable: se entra en el concepto, en el catálogo, y
-- ahí se marcan los niños (o las familias, si el concepto es de familia) que lo tienen. La pestaña
-- Asignación permanente se queda como está; las dos escriben las mismas filas.
--
--   · `fijar_asignaciones_concepto(concepto, cambios)`: aplica de una vez lo marcado y desmarcado
--     en el concepto. Cada cambio es `{id, asignada}`, con `id` el niño o la familia según el
--     ámbito del concepto.
--       - Marcar: asignación manual, si no la tiene ya (`ON CONFLICT` sobre el índice único de
--         asignaciones vivas: dos guardados a la vez no la duplican). Como `asignarConcepto`.
--       - Desmarcar: borrado lógico de su asignación viva, como `desasignarConcepto`.
--       - Lo que ya estaba así sale «sin_cambio»: repetir el guardado no hace nada.
--     Los mismos conceptos que ofrece Asignación permanente: activos y manuales. Otro (borrado,
--     desactivado o automático): P0001 con HINT `concepto_no_asignable`.
--     Sin fechas ni prorrateo, como hoy: cuenta desde el siguiente recálculo del mes, y los
--     recibos validados no cambian. Todo en una transacción: o entran todos los cambios, o ninguno.
--   · `SECURITY INVOKER`: la RLS de `asignacion_concepto` (solo Dirección) y su auditoría siguen
--     actuando, con quien guarda como actor. Puerta propia: `es_admin` del centro del concepto, si
--     no 42501 (un concepto que no se ve también da 42501: no se distingue de uno ajeno). Un niño o
--     una familia de otro centro, o borrados, tumban TODO el guardado con 42501. Una lista mal
--     formada: 22023.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor, DESPUÉS de
-- `20261120120000`. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fijar_asignaciones_concepto') THEN
    RAISE EXCEPTION 'ya aplicada: existe fijar_asignaciones_concepto';
  END IF;
  -- Lo que se da por hecho es lo leído en producción (md5 normalizado: sin \r, sin comentarios,
  -- espacios colapsados).
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.es_admin(uuid)');
  IF v_md5 IS DISTINCT FROM 'da96f192cef9402cf0618ea2cbd82902' THEN
    RAISE EXCEPTION 'es_admin no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.derivar_centro_id_nino_o_familia()');
  IF v_md5 IS DISTINCT FROM '5461ca1dac40487e8e0e24620117d9a9' THEN
    RAISE EXCEPTION 'derivar_centro_id_nino_o_familia no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  -- El ON CONFLICT de la función se apoya en este índice, tal cual.
  IF (SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_asignacion_concepto_unica')
     IS DISTINCT FROM 'CREATE UNIQUE INDEX idx_asignacion_concepto_unica ON public.asignacion_concepto USING btree (concepto_id, COALESCE(nino_id, familia_id)) WHERE (deleted_at IS NULL)' THEN
    RAISE EXCEPTION 'idx_asignacion_concepto_unica no es el leído en producción';
  END IF;
  RAISE NOTICE 'guarda previa: es_admin, derivar_centro_id_nino_o_familia e idx_asignacion_concepto_unica como en producción';
END
$guarda$;

-- ---- Las asignaciones de un concepto, de golpe ----
CREATE FUNCTION public.fijar_asignaciones_concepto(p_concepto_id uuid, p_cambios jsonb)
RETURNS TABLE (destinatario_id uuid, resultado text)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $function$
#variable_conflict use_column
DECLARE
  v_centro uuid;
  v_ambito text;
  v_asignable boolean;
  v_n integer;
  r record;
BEGIN
  SELECT c.centro_id, c.ambito::text, (c.activo AND c.deleted_at IS NULL AND c.aplicacion = 'manual')
    INTO v_centro, v_ambito, v_asignable
    FROM public.conceptos_cobro c
   WHERE c.id = p_concepto_id;
  IF v_centro IS NULL OR NOT public.es_admin(v_centro) THEN
    RAISE EXCEPTION 'no autorizado: solo Dirección del centro del concepto' USING ERRCODE = '42501';
  END IF;
  IF NOT v_asignable THEN
    RAISE EXCEPTION 'asignaciones del concepto: no es un concepto activo y manual'
      USING ERRCODE = 'P0001', HINT = 'concepto_no_asignable';
  END IF;
  IF p_cambios IS NULL OR jsonb_typeof(p_cambios) <> 'array'
     OR jsonb_array_length(p_cambios) NOT BETWEEN 1 AND 3000 THEN
    RAISE EXCEPTION 'asignaciones del concepto: lista de cambios vacía o no válida' USING ERRCODE = '22023';
  END IF;
  -- Cada cambio, {id: uuid, asignada: boolean}.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_cambios) e
     WHERE jsonb_typeof(e) <> 'object'
        OR jsonb_typeof(e -> 'asignada') IS DISTINCT FROM 'boolean'
        OR (e ->> 'id') IS NULL
        OR (e ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) THEN
    RAISE EXCEPTION 'asignaciones del concepto: hay cambios mal formados' USING ERRCODE = '22023';
  END IF;
  -- Un cambio por destinatario.
  IF (SELECT count(DISTINCT (e ->> 'id')::uuid) FROM jsonb_array_elements(p_cambios) e)
     <> jsonb_array_length(p_cambios) THEN
    RAISE EXCEPTION 'asignaciones del concepto: destinatarios repetidos' USING ERRCODE = '22023';
  END IF;

  -- Todos son de este centro y están vivos. Uno solo de fuera tumba el guardado.
  IF v_ambito = 'familia' THEN
    SELECT count(*) INTO v_n
      FROM public.familias f
     WHERE f.id IN (SELECT (e ->> 'id')::uuid FROM jsonb_array_elements(p_cambios) e)
       AND f.centro_id = v_centro AND f.deleted_at IS NULL;
  ELSE
    SELECT count(*) INTO v_n
      FROM public.ninos n
     WHERE n.id IN (SELECT (e ->> 'id')::uuid FROM jsonb_array_elements(p_cambios) e)
       AND n.centro_id = v_centro AND n.deleted_at IS NULL;
  END IF;
  IF v_n <> jsonb_array_length(p_cambios) THEN
    RAISE EXCEPTION 'no autorizado: hay destinatarios que no son de este centro' USING ERRCODE = '42501';
  END IF;

  -- En orden de destinatario (los bloqueos siempre en el mismo orden).
  FOR r IN
    SELECT (e ->> 'id')::uuid AS id, (e ->> 'asignada')::boolean AS asignada
      FROM jsonb_array_elements(p_cambios) e
     ORDER BY 1
  LOOP
    destinatario_id := r.id;
    IF r.asignada THEN
      IF v_ambito = 'familia' THEN
        INSERT INTO public.asignacion_concepto (centro_id, familia_id, concepto_id, origen)
          VALUES (v_centro, r.id, p_concepto_id, 'manual')
          ON CONFLICT (concepto_id, COALESCE(nino_id, familia_id)) WHERE deleted_at IS NULL DO NOTHING;
      ELSE
        INSERT INTO public.asignacion_concepto (centro_id, nino_id, concepto_id, origen)
          VALUES (v_centro, r.id, p_concepto_id, 'manual')
          ON CONFLICT (concepto_id, COALESCE(nino_id, familia_id)) WHERE deleted_at IS NULL DO NOTHING;
      END IF;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      resultado := CASE WHEN v_n = 1 THEN 'asignada' ELSE 'sin_cambio' END;
    ELSE
      UPDATE public.asignacion_concepto a
         SET deleted_at = now()
       WHERE a.concepto_id = p_concepto_id
         AND COALESCE(a.nino_id, a.familia_id) = r.id
         AND a.deleted_at IS NULL;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      resultado := CASE WHEN v_n >= 1 THEN 'quitada' ELSE 'sin_cambio' END;
    END IF;
    RETURN NEXT;
  END LOOP;
END
$function$;

REVOKE ALL ON FUNCTION public.fijar_asignaciones_concepto(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fijar_asignaciones_concepto(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.fijar_asignaciones_concepto(uuid, jsonb) IS
  'El concepto se gestiona desde el concepto: marca y desmarca de una vez a qué niños (o familias, según su ámbito) se asigna, en una transacción. INVOKER: la RLS de asignacion_concepto y su auditoría actúan (20261121120000).';

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_f constant regprocedure := 'public.fijar_asignaciones_concepto(uuid, jsonb)'::regprocedure;
  v_md5 text;
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'fijar_asignaciones_concepto') <> 1 THEN
    RAISE EXCEPTION 'fijar_asignaciones_concepto tiene más de una firma';
  END IF;
  -- La lógica de la función (md5 normalizado), calculada en Postgres sobre el cuerpo creado.
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = v_f;
  IF v_md5 IS DISTINCT FROM 'c056c89840367bcd5082fb7cac1d83b2' THEN
    RAISE EXCEPTION 'fijar_asignaciones_concepto no quedó como este fichero: %', v_md5;
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_f) THEN
    RAISE EXCEPTION 'fijar_asignaciones_concepto es SECURITY DEFINER: debe ser INVOKER (la RLS manda)';
  END IF;
  IF (SELECT proconfig FROM pg_proc WHERE oid = v_f) IS DISTINCT FROM ARRAY['search_path=public'] THEN
    RAISE EXCEPTION 'fijar_asignaciones_concepto sin search_path = public';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = v_f) <> 'v' THEN
    RAISE EXCEPTION 'fijar_asignaciones_concepto no es VOLATILE';
  END IF;
  IF has_function_privilege('anon', v_f, 'EXECUTE') OR has_function_privilege('public', v_f, 'EXECUTE') THEN
    RAISE EXCEPTION 'fijar_asignaciones_concepto abierta a anon o a PUBLIC';
  END IF;
  IF NOT has_function_privilege('authenticated', v_f, 'EXECUTE') THEN
    RAISE EXCEPTION 'fijar_asignaciones_concepto no la puede ejecutar authenticated';
  END IF;
  IF (SELECT proargnames FROM pg_proc WHERE oid = v_f) IS DISTINCT FROM
     ARRAY['p_concepto_id', 'p_cambios', 'destinatario_id', 'resultado'] THEN
    RAISE EXCEPTION 'fijar_asignaciones_concepto no tiene los argumentos de este fichero';
  END IF;
  RAISE NOTICE 'guarda posterior: fijar_asignaciones_concepto INVOKER, solo para authenticated';
END
$guarda$;
