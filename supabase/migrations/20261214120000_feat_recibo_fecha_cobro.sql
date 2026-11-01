-- =============================================================================
-- FEAT — Fecha de cobro, F1: la fecha en el recibo y una función para ponerla en bloque
-- -----------------------------------------------------------------------------
-- `docs/specs/altas-serie.md`, «La fecha de cobro». Decisión de Jose (2026-11-01): «cada recibo
-- tiene su propia fecha, si no indicas nada es el próximo día, si indicas una fecha es cuando se
-- indica». Hasta ahora el fichero pain.008 pedía el cobro el día de la descarga, y el recibo no
-- tenía dónde guardar otra fecha.
--
--   · `recibos.fecha_cobro_banco` (date, NULL): la fecha de cobro que se pide al banco
--     (`ReqdColltnDt`). NULL = sin fecha: el fichero pondrá la del día de su versión (F2). No se
--     valida ningún plazo: si no los cumple, el banco la ajusta a la primera disponible (cuaderno
--     19-14; el plazo vigente es D-1, SDD Core Rulebook 2025).
--   · Trigger `recibos_fecha_cobro_proteger` (BEFORE UPDATE OF fecha_cobro_banco, para todos,
--     también service_role). El congelado de los recibos confirmados (`congelar_si_mes_cerrado`)
--     lista una a una las columnas que no se tocan, así que una columna nueva quedaría libre en
--     cualquier estado. La fecha solo cambia:
--       - con el recibo en `borrador` o `pendiente_procesar` (ni enviado al banco, ni devuelto, ni
--         cobrado: HINT `fecha_cobro_recibo_cerrado`);
--       - y sin estar en una remesa viva enviada o con el fichero generado (HINT
--         `fecha_cobro_en_fichero`). Así la misma versión del fichero no cambia de fecha entre dos
--         descargas.
--     Bloquea (FOR SHARE) las remesas vivas del recibo antes de mirarlas: la marca del fichero
--     (UPDATE de `remesas`) espera a que termine el cambio de fecha, o el cambio ve la marca.
--   · `fijar_fecha_cobro_recibos(centro, recibos, fecha)`: la misma fecha (o NULL, quitarla) a una
--     lista de recibos, todos o ninguno, para no tocar 40 recibos uno a uno. `SECURITY INVOKER`: la
--     RLS de `recibos` (Dirección) y su auditoría siguen actuando, con quien la pone como actor.
--     Puerta propia: `es_admin` del centro pedido, si no 42501; con centro NULL también 42501
--     (`es_admin(NULL)` da TRUE a cualquier persona de Dirección). Un recibo que no es del centro
--     (o no se ve) tumba la llamada (42501). Solo recibos por banco (P0001, HINT `recibo_no_sepa`).
--     Lista de 1 a 1000, sin NULL ni repetidos (22023). Devuelve cada recibo con `cambiada` o
--     `sin_cambio`.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor, DESPUÉS de
-- `20261213120000`. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_n integer;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'recibos'
                AND column_name = 'fecha_cobro_banco')
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('fijar_fecha_cobro_recibos',
                                                        'recibos_fecha_cobro_proteger')) THEN
    RAISE EXCEPTION 'ya aplicada: existe la columna, la función o el trigger de la fecha de cobro';
  END IF;
  -- La puerta de la función nueva es la leída en producción (md5 normalizado: sin \r, sin
  -- comentarios, espacios colapsados).
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.es_admin(uuid)');
  IF v_md5 IS DISTINCT FROM 'da96f192cef9402cf0618ea2cbd82902' THEN
    RAISE EXCEPTION 'es_admin no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT count(*) INTO v_n FROM public.recibos WHERE deleted_at IS NULL;
  RAISE NOTICE 'guarda previa: % recibos vivos, todos quedarán sin fecha de cobro', v_n;
END
$guarda$;

ALTER TABLE public.recibos ADD COLUMN fecha_cobro_banco date NULL;

COMMENT ON COLUMN public.recibos.fecha_cobro_banco IS
  'Fecha de cobro que se pide al banco (ReqdColltnDt del pain.008). NULL = sin fecha: el fichero pone la del día de su versión. No se validan plazos: el banco la ajusta. Solo cambia en borrador o pendiente, fuera de una remesa enviada o con fichero (recibos_fecha_cobro_proteger, 20261214120000).';

CREATE FUNCTION public.recibos_fecha_cobro_proteger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.fecha_cobro_banco IS NOT DISTINCT FROM OLD.fecha_cobro_banco THEN
    RETURN NEW;
  END IF;
  IF OLD.estado NOT IN ('borrador', 'pendiente_procesar') THEN
    RAISE EXCEPTION 'la fecha de cobro de un recibo % no se cambia', OLD.estado
      USING ERRCODE = 'P0001', HINT = 'fecha_cobro_recibo_cerrado';
  END IF;
  -- Las remesas vivas del recibo, bloqueadas: la marca del fichero espera a este cambio.
  PERFORM 1
     FROM public.recibos_remesa rr
     JOIN public.remesas r ON r.id = rr.remesa_id
    WHERE rr.recibo_id = OLD.id
      AND r.deleted_at IS NULL
      FOR SHARE OF r;
  IF EXISTS (SELECT 1
               FROM public.recibos_remesa rr
               JOIN public.remesas r ON r.id = rr.remesa_id
              WHERE rr.recibo_id = OLD.id
                AND r.deleted_at IS NULL
                AND (r.estado <> 'borrador' OR r.fichero_generado_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'el recibo está en una remesa enviada o con el fichero generado: su fecha de cobro no se cambia'
      USING ERRCODE = 'P0001', HINT = 'fecha_cobro_en_fichero';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.recibos_fecha_cobro_proteger() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER recibos_fecha_cobro_proteger
  BEFORE UPDATE OF fecha_cobro_banco ON public.recibos
  FOR EACH ROW EXECUTE FUNCTION public.recibos_fecha_cobro_proteger();

CREATE FUNCTION public.fijar_fecha_cobro_recibos(
  p_centro_id uuid,
  p_recibo_ids uuid[],
  p_fecha date
)
RETURNS TABLE (
  recibo_id uuid,
  resultado text
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $function$
#variable_conflict use_column
DECLARE
  v_n integer;
BEGIN
  IF p_centro_id IS NULL OR NOT public.es_admin(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado: solo Dirección del centro' USING ERRCODE = '42501';
  END IF;
  IF p_recibo_ids IS NULL OR cardinality(p_recibo_ids) NOT BETWEEN 1 AND 1000
     OR array_position(p_recibo_ids, NULL) IS NOT NULL
     OR (SELECT count(DISTINCT x) FROM unnest(p_recibo_ids) x) <> cardinality(p_recibo_ids) THEN
    RAISE EXCEPTION 'fecha de cobro: lista de recibos vacía, con huecos o con repetidos'
      USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_n
    FROM public.recibos r
   WHERE r.id = ANY (p_recibo_ids) AND r.centro_id = p_centro_id AND r.deleted_at IS NULL;
  IF v_n <> cardinality(p_recibo_ids) THEN
    RAISE EXCEPTION 'no autorizado: algún recibo no es de este centro' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.recibos r
              WHERE r.id = ANY (p_recibo_ids) AND r.metodo IS DISTINCT FROM 'sepa') THEN
    RAISE EXCEPTION 'fecha de cobro: solo los recibos por banco llevan fecha de cobro'
      USING ERRCODE = 'P0001', HINT = 'recibo_no_sepa';
  END IF;

  RETURN QUERY
  WITH cambiados AS (
    UPDATE public.recibos r
       SET fecha_cobro_banco = p_fecha
     WHERE r.id = ANY (p_recibo_ids)
       AND r.fecha_cobro_banco IS DISTINCT FROM p_fecha
    RETURNING r.id
  )
  SELECT x.id,
         CASE WHEN x.id IN (SELECT c.id FROM cambiados c) THEN 'cambiada' ELSE 'sin_cambio' END
    FROM unnest(p_recibo_ids) AS x(id);
END
$function$;

REVOKE ALL ON FUNCTION public.fijar_fecha_cobro_recibos(uuid, uuid[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fijar_fecha_cobro_recibos(uuid, uuid[], date) TO authenticated;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_f constant regprocedure := 'public.fijar_fecha_cobro_recibos(uuid, uuid[], date)'::regprocedure;
  v_t constant regprocedure := 'public.recibos_fecha_cobro_proteger()'::regprocedure;
  v_md5 text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'recibos'
                    AND column_name = 'fecha_cobro_banco' AND data_type = 'date'
                    AND is_nullable = 'YES') THEN
    RAISE EXCEPTION 'falta recibos.fecha_cobro_banco (date, NULL)';
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = v_t;
  IF v_md5 IS DISTINCT FROM '3f8dce3b70d7a012834218598533d284' THEN
    RAISE EXCEPTION 'recibos_fecha_cobro_proteger no quedó como este fichero: %', v_md5;
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = v_f;
  IF v_md5 IS DISTINCT FROM '8183a31d089bf395f3cda69e0a8e528c' THEN
    RAISE EXCEPTION 'fijar_fecha_cobro_recibos no quedó como este fichero: %', v_md5;
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_t) THEN
    RAISE EXCEPTION 'recibos_fecha_cobro_proteger tiene que ser SECURITY DEFINER (lee todas las remesas)';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_f) THEN
    RAISE EXCEPTION 'fijar_fecha_cobro_recibos es SECURITY DEFINER: debe ser INVOKER (la RLS manda)';
  END IF;
  IF (SELECT proconfig FROM pg_proc WHERE oid = v_f) IS DISTINCT FROM ARRAY['search_path=public']
     OR (SELECT proconfig FROM pg_proc WHERE oid = v_t) IS DISTINCT FROM ARRAY['search_path=public'] THEN
    RAISE EXCEPTION 'las funciones de la fecha de cobro sin search_path = public';
  END IF;
  IF has_function_privilege('anon', v_f, 'EXECUTE') OR has_function_privilege('public', v_f, 'EXECUTE') THEN
    RAISE EXCEPTION 'fijar_fecha_cobro_recibos abierta a anon o a PUBLIC';
  END IF;
  IF NOT has_function_privilege('authenticated', v_f, 'EXECUTE') THEN
    RAISE EXCEPTION 'fijar_fecha_cobro_recibos no la puede ejecutar authenticated';
  END IF;
  IF has_function_privilege('authenticated', v_t, 'EXECUTE') OR has_function_privilege('anon', v_t, 'EXECUTE')
     OR has_function_privilege('public', v_t, 'EXECUTE') THEN
    RAISE EXCEPTION 'la función del trigger se puede ejecutar por RPC';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t
       WHERE t.tgrelid = 'public.recibos'::regclass AND NOT t.tgisinternal
         AND t.tgname = 'recibos_fecha_cobro_proteger'
         AND t.tgfoid = v_t
         AND pg_get_triggerdef(t.oid) LIKE '%BEFORE UPDATE OF fecha_cobro_banco ON public.recibos FOR EACH ROW%') <> 1 THEN
    RAISE EXCEPTION 'falta el trigger recibos_fecha_cobro_proteger';
  END IF;
  RAISE NOTICE 'guarda posterior: fecha de cobro con su trigger para todos y la función en bloque, INVOKER';
END
$guarda$;
