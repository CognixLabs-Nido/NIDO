-- =============================================================================
-- FIX — Remesas: un recibo, una remesa; y añadir recibos a una remesa en borrador
-- -----------------------------------------------------------------------------
-- Un mismo recibo podía entrar en dos remesas vivas: la única unicidad era (remesa, recibo) y
-- `crearRemesa` no volvía a comprobar en el servidor que los recibos siguieran libres. Bastaba una
-- pestaña abierta desde antes de crear la primera remesa, o dos personas de Dirección a la vez, y
-- el banco cobraba dos veces a la familia. El mismo fallo que la devolución resuelta dos veces del
-- PR-2.
--
-- Y lo que faltaba (decisión del responsable): a una remesa en BORRADOR, con el fichero sin
-- generar, se le pueden AÑADIR recibos. Una vez generado el fichero o enviada al banco, no se toca.
--
--   · `remesas.fichero_generado_at`: cuándo se generó por primera vez el fichero pain.008. Lo pone
--     la descarga del XML, ANTES de leer los recibos; una vez puesta, no se quita.
--   · Trigger `recibos_remesa_validar` (BEFORE INSERT OR UPDATE OR DELETE, también para
--     service_role salvo donde se dice):
--       - bloquea la remesa (FOR UPDATE): un envío, la marca del fichero o el borrado de la remesa
--         esperan al enlace, y el enlace a ellos;
--       - entra un recibo solo si la remesa está viva, en borrador y sin fichero;
--       - bloquea el recibo (FOR UPDATE): dos remesas con el mismo recibo, a la vez, esperan una a
--         otra, y la segunda ve el enlace de la primera. Un recibo en una remesa viva no entra en
--         otra. El de una remesa borrada sí;
--       - el recibo es del centro de la remesa; con sesión, además, por banco, confirmado
--         (`pendiente_procesar`) y con importe. service_role puede enlazar uno en otro estado: la
--         red defensiva de `get_mandatos_remesa` tiene su test;
--       - un enlace no cambia de remesa ni de recibo;
--       - de una remesa enviada o con fichero no sale ningún recibo, salvo con service_role (la
--         limpieza de un centro).
--   · Trigger `remesas_proteger` (BEFORE UPDATE): la marca del fichero no se quita, para nadie. Con
--     sesión, una remesa enviada no vuelve a borrador, y una enviada o con fichero no se borra: sus
--     recibos quedarían libres para otra remesa.
--   · Trigger `recibos_en_remesa_no_vuelven_a_borrador` (BEFORE UPDATE OF estado, de
--     `pendiente_procesar` a `borrador`, para todos): `desconfirmar_recibo` ya lo comprobaba, pero
--     sin bloquear el recibo; un enlace que entraba a la vez dejaba un borrador dentro de la remesa.
--     El trigger corre con la fila ya bloqueada y ve el enlace confirmado.
--
-- `desconfirmar_recibo`, `recibo_en_remesa` y `get_mandatos_remesa` no se tocan: la guarda previa
-- comprueba que son las leídas en producción el 2026-10-25.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor. Tras aplicar:
-- registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_firma text;
  v_md5 text;
  v_n integer;
  v_leido jsonb := jsonb_build_object(
    -- No se recrean, pero las cruza el enlace: tienen que ser las que se leyeron.
    'public.desconfirmar_recibo(uuid)', 'c8772170326a5421b4bd790785d0312c',
    'public.recibo_en_remesa(uuid)', '743673c49024c6c98a1b7882bacb8d80',
    'public.get_mandatos_remesa(uuid)', '64c3ef42b79b9ce51e8ce45ac67c1ec9',
    'public.derivar_centro_id_de_remesa()', '39059fe4f8d3cb8711dca4b9b00dfcde',
    'public.centro_de_remesa(uuid)', '9d3f79107cb579ab5a417e39141aedb5',
    'public.es_admin(uuid)', 'da96f192cef9402cf0618ea2cbd82902');
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'remesas'
                AND column_name = 'fichero_generado_at')
     OR to_regprocedure('public.recibos_remesa_validar()') IS NOT NULL THEN
    RAISE EXCEPTION 'ya aplicada: existe la marca del fichero o el trigger del enlace';
  END IF;
  FOR v_firma IN SELECT jsonb_object_keys(v_leido) LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_firma);
    IF v_md5 IS DISTINCT FROM v_leido ->> v_firma THEN
      RAISE EXCEPTION '% no es la leída en producción: %', v_firma, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;
  -- Los triggers de las tres tablas son los leídos: los nuevos se suman a estos.
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.recibos'::regclass AND NOT tgisinternal) <> 8
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.recibos_remesa'::regclass AND NOT tgisinternal) <> 2
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.remesas'::regclass AND NOT tgisinternal) <> 2 THEN
    RAISE EXCEPTION 'los triggers de recibos, recibos_remesa o remesas no son los leídos';
  END IF;
  -- El invariante que se instala tiene que cumplirse ya: ningún recibo en dos remesas vivas.
  SELECT count(*) INTO v_n FROM (
    SELECT rr.recibo_id FROM public.recibos_remesa rr
      JOIN public.remesas rm ON rm.id = rr.remesa_id
     WHERE rm.deleted_at IS NULL
     GROUP BY rr.recibo_id HAVING count(*) > 1) x;
  RAISE NOTICE 'guarda previa: % recibos en más de una remesa viva; % remesas vivas (% enviadas), % enlaces',
    v_n,
    (SELECT count(*) FROM public.remesas WHERE deleted_at IS NULL),
    (SELECT count(*) FROM public.remesas WHERE deleted_at IS NULL AND estado = 'enviada'),
    (SELECT count(*) FROM public.recibos_remesa);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'hay % recibos en más de una remesa viva: revisarlos antes de aplicar', v_n;
  END IF;
END
$guarda$;

-- ---- La marca del fichero ----
ALTER TABLE public.remesas ADD COLUMN fichero_generado_at timestamptz NULL;

COMMENT ON COLUMN public.remesas.fichero_generado_at IS
  'Cuándo se generó por primera vez el fichero pain.008 de la remesa. Lo pone la descarga del XML antes de leer los recibos; desde entonces no entra ni sale ningún recibo, y no se quita (remesas_proteger).';

-- ---- El enlace remesa ↔ recibo ----
CREATE FUNCTION public.recibos_remesa_validar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_servicio boolean := COALESCE(auth.role(), '') = 'service_role';
  v_remesa record;
  v_recibo record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.remesa_id IS DISTINCT FROM OLD.remesa_id OR NEW.recibo_id IS DISTINCT FROM OLD.recibo_id THEN
      RAISE EXCEPTION 'un enlace no cambia de remesa ni de recibo' USING ERRCODE = 'P0001', HINT = 'enlace_fijo';
    END IF;
    RETURN NEW;
  END IF;

  -- La remesa, bloqueada: el envío, la marca del fichero y el borrado esperan a este enlace.
  SELECT id, centro_id, estado, fichero_generado_at, deleted_at INTO v_remesa
    FROM public.remesas
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.remesa_id ELSE NEW.remesa_id END
     FOR UPDATE;

  IF TG_OP = 'DELETE' THEN
    -- Sin remesa: cae en cascada con ella. Con service_role: la limpieza de un centro.
    IF v_servicio OR NOT FOUND THEN
      RETURN OLD;
    END IF;
    IF v_remesa.estado <> 'borrador' OR v_remesa.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'de una remesa enviada no sale ningún recibo' USING ERRCODE = 'P0001', HINT = 'remesa_cerrada';
    END IF;
    IF v_remesa.fichero_generado_at IS NOT NULL THEN
      RAISE EXCEPTION 'de una remesa con el fichero generado no sale ningún recibo' USING ERRCODE = 'P0001', HINT = 'remesa_con_fichero';
    END IF;
    RETURN OLD;
  END IF;

  IF NOT FOUND OR v_remesa.estado <> 'borrador' OR v_remesa.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'a una remesa enviada o borrada no se le añaden recibos' USING ERRCODE = 'P0001', HINT = 'remesa_cerrada';
  END IF;
  IF v_remesa.fichero_generado_at IS NOT NULL THEN
    RAISE EXCEPTION 'a una remesa con el fichero generado no se le añaden recibos' USING ERRCODE = 'P0001', HINT = 'remesa_con_fichero';
  END IF;

  -- El recibo, bloqueado: otra remesa con el mismo recibo espera, y después ve este enlace.
  SELECT id, centro_id, estado, metodo, total_centimos, deleted_at INTO v_recibo
    FROM public.recibos WHERE id = NEW.recibo_id FOR UPDATE;
  IF NOT FOUND OR v_recibo.deleted_at IS NOT NULL OR v_recibo.centro_id IS DISTINCT FROM v_remesa.centro_id THEN
    RAISE EXCEPTION 'el recibo no es de esta remesa' USING ERRCODE = 'P0001', HINT = 'recibo_no_remesable';
  END IF;
  IF NOT v_servicio
     AND (v_recibo.metodo IS DISTINCT FROM 'sepa' OR v_recibo.estado <> 'pendiente_procesar'
          OR v_recibo.total_centimos <= 0) THEN
    RAISE EXCEPTION 'solo entran recibos por banco, confirmados y con importe' USING ERRCODE = 'P0001', HINT = 'recibo_no_remesable';
  END IF;
  IF EXISTS (SELECT 1 FROM public.recibos_remesa rr
               JOIN public.remesas rm ON rm.id = rr.remesa_id
              WHERE rr.recibo_id = NEW.recibo_id AND rm.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'el recibo ya está en una remesa' USING ERRCODE = 'P0001', HINT = 'recibo_en_otra_remesa';
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.recibos_remesa_validar() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER recibos_remesa_validar
  BEFORE INSERT OR UPDATE OR DELETE ON public.recibos_remesa
  FOR EACH ROW EXECUTE FUNCTION public.recibos_remesa_validar();

-- ---- La remesa: la marca no se quita, y la enviada no vuelve ni se borra ----
CREATE FUNCTION public.remesas_proteger()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.fichero_generado_at IS NOT NULL
     AND NEW.fichero_generado_at IS DISTINCT FROM OLD.fichero_generado_at THEN
    RAISE EXCEPTION 'la marca del fichero generado no se quita' USING ERRCODE = 'P0001', HINT = 'fichero_generado';
  END IF;
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF OLD.estado = 'enviada' AND NEW.estado <> 'enviada' THEN
    RAISE EXCEPTION 'una remesa enviada no vuelve a borrador' USING ERRCODE = 'P0001', HINT = 'remesa_cerrada';
  END IF;
  -- Borrarla soltaría sus recibos para otra remesa, y el banco ya puede tener el fichero.
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    IF OLD.estado = 'enviada' THEN
      RAISE EXCEPTION 'una remesa enviada no se borra' USING ERRCODE = 'P0001', HINT = 'remesa_cerrada';
    END IF;
    IF OLD.fichero_generado_at IS NOT NULL THEN
      RAISE EXCEPTION 'una remesa con el fichero generado no se borra' USING ERRCODE = 'P0001', HINT = 'remesa_con_fichero';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.remesas_proteger() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER remesas_proteger
  BEFORE UPDATE ON public.remesas
  FOR EACH ROW EXECUTE FUNCTION public.remesas_proteger();

-- ---- Un recibo en una remesa viva no vuelve a borrador ----
CREATE FUNCTION public.recibos_en_remesa_no_vuelven_a_borrador()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- La fila ya está bloqueada: un enlace que entró a la vez está confirmado y se ve aquí.
  IF EXISTS (SELECT 1 FROM public.recibos_remesa rr
               JOIN public.remesas rm ON rm.id = rr.remesa_id
              WHERE rr.recibo_id = NEW.id AND rm.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'recibo en remesa: no vuelve a borrador' USING ERRCODE = 'P0001', HINT = 'recibo_en_remesa';
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.recibos_en_remesa_no_vuelven_a_borrador() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER recibos_en_remesa_no_vuelven_a_borrador
  BEFORE UPDATE OF estado ON public.recibos
  FOR EACH ROW
  WHEN (OLD.estado = 'pendiente_procesar' AND NEW.estado = 'borrador')
  EXECUTE FUNCTION public.recibos_en_remesa_no_vuelven_a_borrador();

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_firma text;
  v_md5 text;
  v_esperado jsonb := jsonb_build_object(
    'public.recibos_remesa_validar()', '9960f37d762a9c1d34e3d2893d4612f1',
    'public.remesas_proteger()', '3032f20c7994c4aad78dcfaaa52db9be',
    'public.recibos_en_remesa_no_vuelven_a_borrador()', '986d80b42695367c9758c9edae812e8f');
BEGIN
  FOR v_firma IN SELECT jsonb_object_keys(v_esperado) LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_firma);
    IF v_md5 IS DISTINCT FROM v_esperado ->> v_firma THEN
      RAISE EXCEPTION '% no quedó como este fichero: %', v_firma, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;
  -- Las dos que leen y bloquean otras tablas, SECURITY DEFINER con search_path; ninguna, ejecutable.
  IF NOT (SELECT bool_and(prosecdef AND proconfig = ARRAY['search_path=public']) FROM pg_proc WHERE oid IN (
            'public.recibos_remesa_validar()'::regprocedure,
            'public.recibos_en_remesa_no_vuelven_a_borrador()'::regprocedure))
     OR (SELECT prosecdef FROM pg_proc WHERE oid = 'public.remesas_proteger()'::regprocedure) THEN
    RAISE EXCEPTION 'el enlace y la vuelta a borrador, SECURITY DEFINER; la remesa, de invocador';
  END IF;
  IF (SELECT bool_or(has_function_privilege(r, f, 'EXECUTE'))
        FROM unnest(ARRAY['public', 'anon', 'authenticated']) r,
             unnest(ARRAY['public.recibos_remesa_validar()'::regprocedure,
                          'public.remesas_proteger()'::regprocedure,
                          'public.recibos_en_remesa_no_vuelven_a_borrador()'::regprocedure]) f) THEN
    RAISE EXCEPTION 'las funciones de los triggers no se ejecutan por RPC';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t
       WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
         AND ((t.tgrelid = 'public.recibos_remesa'::regclass AND t.tgname = 'recibos_remesa_validar'
               AND pg_get_triggerdef(t.oid) LIKE '%BEFORE INSERT OR DELETE OR UPDATE ON public.recibos_remesa FOR EACH ROW%')
           OR (t.tgrelid = 'public.remesas'::regclass AND t.tgname = 'remesas_proteger'
               AND pg_get_triggerdef(t.oid) LIKE '%BEFORE UPDATE ON public.remesas FOR EACH ROW%')
           OR (t.tgrelid = 'public.recibos'::regclass AND t.tgname = 'recibos_en_remesa_no_vuelven_a_borrador'
               AND pg_get_triggerdef(t.oid) LIKE '%BEFORE UPDATE OF estado ON public.recibos FOR EACH ROW WHEN %pendiente_procesar%borrador%'))) <> 3 THEN
    RAISE EXCEPTION 'faltan los triggers del enlace, de la remesa o de la vuelta a borrador';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'remesas'
                    AND column_name = 'fichero_generado_at' AND data_type = 'timestamp with time zone'
                    AND is_nullable = 'YES') THEN
    RAISE EXCEPTION 'falta remesas.fichero_generado_at';
  END IF;
  RAISE NOTICE 'guarda posterior: un recibo en una sola remesa viva, añadir solo sin fichero, la enviada no se toca';
END
$guarda$;
