-- =============================================================================
-- FEAT — Marcar enviada exige el fichero guardado (R-4), y la marca solo la pone su registro
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/altas-serie.md, «Reabrir una remesa» (R-4, decisión del responsable del
-- 2026-10-31; lo de esta migración, del 2026-11-02).
--
--   · La marca del fichero (`remesas.fichero_generado_at`), de la que salen el MsgId y la ruta del
--     fichero guardado, solo la pone `registrar_fichero_remesa`, en la misma transacción que el
--     registro. Hasta aquí una sesión de Dirección podía ponerla con un UPDATE directo (privilegio
--     de columna de `authenticated`; `remesas_proteger` solo impide quitarla), y también al crear
--     la remesa. Una marca puesta así no tiene fichero: la descarga guardaría uno con esa marca y,
--     si el servidor caía entre la subida y el registro, el reintento repetía la ruta (409) hasta la
--     pasada del día siguiente. Ahora un trigger lo rechaza en INSERT y UPDATE, para todos, también
--     para service_role, salvo con el marcador local `app.registrar_fichero` = el id de la remesa,
--     que solo pone el registro (como `app.resolver_devolucion`). Quitarla sigue siendo cosa de
--     `remesas_proteger`; reabrir tendrá su propio marcador.
--   · `marcar_remesa_enviada` sustituye a los dos UPDATE que hacía la app (la remesa y después, en
--     otra llamada, los recibos: si la segunda fallaba, la remesa quedaba enviada con los recibos
--     pendientes). Una transacción, y exige:
--       - la marca y su fichero guardado; si no, HINT `sin_fichero` (falta descargarlo);
--       - que los recibos cobrables de la remesa sean exactamente los del fichero, con el mismo
--         importe; si no, HINT `fichero_no_coincide` (la remesa cambió después de descargarlo y hay
--         que reabrirla).
--     Pasan a `enviado_banco` solo los recibos del fichero: marcar enviados los que el banco no
--     recibió sería decirle al centro que ha cobrado algo que nadie pidió cobrar. Pone `enviada_at`
--     en el fichero. SECURITY DEFINER con `es_admin` explícito (la spec decía «de invocador»: no
--     puede serlo, porque `remesa_ficheros` no tiene privilegios para las sesiones desde
--     20261220120000). La fecha de envío es el día de Madrid (`hoy_madrid`), no el de UTC.
--
-- La aplica el responsable por SQL Editor, después de 20261220120000. Sin BEGIN ni COMMIT. Tras
-- aplicar: registrar en supabase_migrations.schema_migrations. ORDEN: aplicar ANTES de desplegar
-- la app de este PR, que marca enviada con esta función. La app de ahora sigue funcionando con la
-- migración aplicada: su descarga pasa por el registro y su marcar enviada no toca la marca.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF to_regprocedure('public.marcar_remesa_enviada(uuid)') IS NOT NULL
     OR to_regprocedure('public.remesas_marca_solo_registro()') IS NOT NULL THEN
    RAISE EXCEPTION 'ya aplicada: existe marcar_remesa_enviada o remesas_marca_solo_registro';
  END IF;
  IF to_regclass('public.remesa_ficheros') IS NULL THEN
    RAISE EXCEPTION 'falta 20261220120000: no existe remesa_ficheros';
  END IF;
  -- Lo que se reescribe es lo que hay, tal como quedó (20261220120000).
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.registrar_fichero_remesa(uuid,timestamptz,text,text,text,jsonb)');
  IF v_md5 IS DISTINCT FROM '3aa922d7d5b97e6ac3f0feb037b02c23' THEN
    RAISE EXCEPTION 'registrar_fichero_remesa no es la de 20261220120000: %', coalesce(v_md5, 'falta');
  END IF;
  -- Las remesas con marca y sin fichero de esa marca no se tocan: la descarga guarda el suyo.
  RAISE NOTICE 'guarda previa: % remesas vivas, % con marca, % de ellas sin su fichero; % borradores, % enviadas; % ficheros guardados',
    (SELECT count(*) FROM public.remesas WHERE deleted_at IS NULL),
    (SELECT count(*) FROM public.remesas WHERE deleted_at IS NULL AND fichero_generado_at IS NOT NULL),
    (SELECT count(*) FROM public.remesas r
      WHERE r.deleted_at IS NULL AND r.fichero_generado_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.remesa_ficheros f
                         WHERE f.remesa_id = r.id AND f.generado_at = r.fichero_generado_at)),
    (SELECT count(*) FROM public.remesas WHERE deleted_at IS NULL AND estado = 'borrador'),
    (SELECT count(*) FROM public.remesas WHERE deleted_at IS NULL AND estado = 'enviada'),
    (SELECT count(*) FROM public.remesa_ficheros);
END
$guarda$;

-- ---- 1. La marca solo la pone su registro ----
CREATE FUNCTION public.remesas_marca_solo_registro()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Vale para todos, también para service_role: la marca fija el MsgId y la ruta del fichero
  -- guardado, y sin su registro es una versión sin fichero.
  IF TG_OP = 'INSERT' THEN
    IF NEW.fichero_generado_at IS NOT NULL THEN
      RAISE EXCEPTION 'la marca del fichero solo la pone su registro' USING ERRCODE = 'P0001', HINT = 'marca_solo_registro';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.fichero_generado_at IS NULL AND NEW.fichero_generado_at IS NOT NULL
     AND COALESCE(current_setting('app.registrar_fichero', true), '') IS DISTINCT FROM OLD.id::text THEN
    RAISE EXCEPTION 'la marca del fichero solo la pone su registro' USING ERRCODE = 'P0001', HINT = 'marca_solo_registro';
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.remesas_marca_solo_registro() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER remesas_marca_solo_registro
  BEFORE INSERT OR UPDATE OF fichero_generado_at ON public.remesas
  FOR EACH ROW EXECUTE FUNCTION public.remesas_marca_solo_registro();

-- ---- 2. El registro pone la marca con su marcador ----
-- Igual que en 20261220120000, salvo el marcador alrededor del UPDATE de la marca.
CREATE OR REPLACE FUNCTION public.registrar_fichero_remesa(
  p_remesa_id uuid,
  p_marca     timestamptz,
  p_msg_id    text,
  p_sha256    text,
  p_ruta      text,
  p_adeudos   jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_remesa  public.remesas%ROWTYPE;
  v_fichero uuid;
  v_n       integer;
  v_total   bigint;
  v_malos   integer;
  v_distintos integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_remesa FROM public.remesas WHERE id = p_remesa_id FOR UPDATE;
  IF NOT FOUND OR v_remesa.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'remesa no encontrada' USING ERRCODE = 'P0001', HINT = 'no_encontrada';
  END IF;
  IF NOT public.es_admin(v_remesa.centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- La versión: la marca que hay o, si no hay, la que trae la descarga (la hora del servidor).
  IF v_remesa.fichero_generado_at IS NULL THEN
    IF p_marca IS NULL OR p_marca > now() + interval '1 minute'
       OR p_marca < now() - interval '10 minutes' THEN
      RAISE EXCEPTION 'la marca no es de ahora' USING ERRCODE = 'P0001', HINT = 'marca_no_valida';
    END IF;
    -- El único sitio que pone la marca (remesas_marca_solo_registro, 20261221120000).
    PERFORM set_config('app.registrar_fichero', p_remesa_id::text, true);
    UPDATE public.remesas SET fichero_generado_at = p_marca WHERE id = p_remesa_id;
    PERFORM set_config('app.registrar_fichero', '', true);
  ELSIF v_remesa.fichero_generado_at IS DISTINCT FROM p_marca THEN
    RAISE EXCEPTION 'otra descarga ya fijó la versión' USING ERRCODE = 'P0001', HINT = 'marca_distinta';
  END IF;
  IF EXISTS (SELECT 1 FROM public.remesa_ficheros
              WHERE remesa_id = p_remesa_id AND generado_at = p_marca) THEN
    RAISE EXCEPTION 'esta versión ya está guardada' USING ERRCODE = 'P0001', HINT = 'ya_guardado';
  END IF;

  -- El fichero ya está en el bucket, donde solo sube el servidor, y en su sitio.
  IF p_msg_id IS NULL OR p_msg_id NOT LIKE 'NIDO-' || left(p_remesa_id::text, 8) || '-%'
     OR char_length(p_msg_id) > 35
     OR p_ruta IS DISTINCT FROM format('%s/%s/%s.xml', v_remesa.centro_id, p_remesa_id, p_msg_id) THEN
    RAISE EXCEPTION 'el MsgId o la ruta no son de esta remesa' USING ERRCODE = 'P0001', HINT = 'ruta_no_valida';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o
                  WHERE o.bucket_id = 'remesas-ficheros' AND o.name = p_ruta) THEN
    RAISE EXCEPTION 'el fichero no está guardado' USING ERRCODE = 'P0001', HINT = 'sin_fichero';
  END IF;

  -- Los adeudos son exactamente los recibos cobrables de la remesa (el filtro de
  -- get_mandatos_remesa y prepararRemesa: por banco, pendientes o enviados, vivos, con importe),
  -- cada uno con su importe, su EndToEndId y un mandato de su familia.
  IF jsonb_typeof(p_adeudos) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'adeudos no válidos' USING ERRCODE = 'P0001', HINT = 'recibos_cambiaron';
  END IF;
  WITH a AS (
    SELECT * FROM jsonb_to_recordset(p_adeudos)
      AS x(recibo_id uuid, end_to_end_id text, importe_centimos bigint, mndt_id text)
  ), cobrables AS (
    SELECT r.id, r.total_centimos, r.familia_id
      FROM public.recibos_remesa rr
      JOIN public.recibos r ON r.id = rr.recibo_id
     WHERE rr.remesa_id = p_remesa_id AND r.metodo = 'sepa'
       AND r.estado IN ('pendiente_procesar', 'enviado_banco')
       AND r.deleted_at IS NULL AND r.total_centimos > 0
  )
  SELECT count(*) INTO v_malos
    FROM cobrables c
    FULL JOIN a ON a.recibo_id = c.id
   WHERE c.id IS NULL OR a.recibo_id IS NULL
      OR a.importe_centimos IS DISTINCT FROM c.total_centimos
      OR a.end_to_end_id IS DISTINCT FROM upper(replace(c.id::text, '-', ''))
      OR NOT EXISTS (SELECT 1 FROM public.mandatos_sepa m
                      WHERE m.identificador_mandato = a.mndt_id AND m.familia_id = c.familia_id);
  SELECT count(*), count(DISTINCT recibo_id), sum(importe_centimos) INTO v_n, v_distintos, v_total
    FROM jsonb_to_recordset(p_adeudos) AS x(recibo_id uuid, importe_centimos bigint);
  IF v_malos > 0 OR v_n <> v_distintos THEN
    RAISE EXCEPTION 'los recibos de la remesa no son los del fichero (% distintos)', v_malos
      USING ERRCODE = 'P0001', HINT = 'recibos_cambiaron';
  END IF;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'un fichero sin adeudos no se guarda' USING ERRCODE = 'P0001', HINT = 'recibos_cambiaron';
  END IF;
  INSERT INTO public.remesa_ficheros
    (centro_id, remesa_id, msg_id, generado_at, sha256, n_adeudos, total_centimos, ruta)
  VALUES (v_remesa.centro_id, p_remesa_id, p_msg_id, p_marca, p_sha256, v_n, v_total, p_ruta)
  RETURNING id INTO v_fichero;
  INSERT INTO public.remesa_fichero_adeudos
    (fichero_id, recibo_id, end_to_end_id, importe_centimos, mandato_id, mndt_id)
  SELECT v_fichero, a.recibo_id, a.end_to_end_id, a.importe_centimos,
         (SELECT m.id FROM public.mandatos_sepa m WHERE m.identificador_mandato = a.mndt_id),
         a.mndt_id
    FROM jsonb_to_recordset(p_adeudos)
      AS a(recibo_id uuid, end_to_end_id text, importe_centimos bigint, mndt_id text);
  RETURN v_fichero;
END;
$function$;

-- ---- 3. Marcar enviada ----
-- Devuelve cuántos recibos pasaron a enviado_banco.
CREATE FUNCTION public.marcar_remesa_enviada(p_remesa_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_remesa  public.remesas%ROWTYPE;
  v_fichero public.remesa_ficheros%ROWTYPE;
  v_hoy     date := public.hoy_madrid();
  v_malos   integer;
  v_n       integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- La remesa, bloqueada: el registro de su fichero y otro marcar enviada esperan.
  SELECT * INTO v_remesa FROM public.remesas WHERE id = p_remesa_id FOR UPDATE;
  IF NOT FOUND OR v_remesa.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'remesa no encontrada' USING ERRCODE = 'P0001', HINT = 'no_encontrada';
  END IF;
  IF NOT public.es_admin(v_remesa.centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_remesa.estado <> 'borrador' THEN
    RAISE EXCEPTION 'la remesa ya está enviada' USING ERRCODE = 'P0001', HINT = 'ya_enviada';
  END IF;

  -- El fichero de la versión vigente: sin él, no hay nada que el banco pueda tener.
  SELECT * INTO v_fichero FROM public.remesa_ficheros
   WHERE remesa_id = p_remesa_id AND generado_at = v_remesa.fichero_generado_at;
  IF v_remesa.fichero_generado_at IS NULL OR NOT FOUND THEN
    RAISE EXCEPTION 'falta descargar el fichero' USING ERRCODE = 'P0001', HINT = 'sin_fichero';
  END IF;

  -- Sus recibos, bloqueados: un cobro o un cambio de importe a la vez espera, y después ve la
  -- remesa enviada.
  PERFORM 1 FROM public.recibos r
    JOIN public.recibos_remesa rr ON rr.recibo_id = r.id
   WHERE rr.remesa_id = p_remesa_id
     FOR UPDATE OF r;
  -- Los cobrables de la remesa (el filtro de registrar_fichero_remesa) son los del fichero, con
  -- el mismo importe.
  WITH cobrables AS (
    SELECT r.id, r.total_centimos
      FROM public.recibos_remesa rr
      JOIN public.recibos r ON r.id = rr.recibo_id
     WHERE rr.remesa_id = p_remesa_id AND r.metodo = 'sepa'
       AND r.estado IN ('pendiente_procesar', 'enviado_banco')
       AND r.deleted_at IS NULL AND r.total_centimos > 0
  ), a AS (
    SELECT recibo_id, importe_centimos FROM public.remesa_fichero_adeudos
     WHERE fichero_id = v_fichero.id
  )
  SELECT count(*) INTO v_malos
    FROM cobrables c
    FULL JOIN a ON a.recibo_id = c.id
   WHERE c.id IS NULL OR a.recibo_id IS NULL
      OR a.importe_centimos IS DISTINCT FROM c.total_centimos;
  IF v_malos > 0 THEN
    RAISE EXCEPTION 'la remesa cambió después de descargar su fichero (% recibos)', v_malos
      USING ERRCODE = 'P0001', HINT = 'fichero_no_coincide';
  END IF;

  UPDATE public.remesas SET estado = 'enviada', fecha_envio_banco = v_hoy WHERE id = p_remesa_id;
  -- Solo los del fichero: es lo que el banco recibió.
  UPDATE public.recibos r SET estado = 'enviado_banco', fecha_envio_banco = v_hoy
    FROM public.remesa_fichero_adeudos a
   WHERE a.fichero_id = v_fichero.id AND r.id = a.recibo_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.remesa_ficheros SET enviada_at = now() WHERE id = v_fichero.id;
  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.marcar_remesa_enviada(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.marcar_remesa_enviada(uuid) TO authenticated;

COMMENT ON FUNCTION public.marcar_remesa_enviada(uuid) IS
  'R-4: marca enviada una remesa en borrador con el fichero de su versión guardado y sus recibos cobrables iguales a los del fichero. Pasan a enviado_banco solo los del fichero. es_admin.';

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p
   WHERE p.oid = 'public.registrar_fichero_remesa(uuid,timestamptz,text,text,text,jsonb)'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'a101708df6362342ab5554d8bc5dab2c' THEN
    RAISE EXCEPTION 'registrar_fichero_remesa no quedó como este fichero: %', coalesce(v_md5, 'falta');
  END IF;
  IF (SELECT count(*) FROM pg_trigger t
       WHERE t.tgrelid = 'public.remesas'::regclass AND t.tgname = 'remesas_marca_solo_registro'
         AND NOT t.tgisinternal AND t.tgenabled = 'O'
         AND pg_get_triggerdef(t.oid) LIKE '%BEFORE INSERT OR UPDATE OF fichero_generado_at ON public.remesas FOR EACH ROW%') <> 1 THEN
    RAISE EXCEPTION 'falta el trigger remesas_marca_solo_registro';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.remesas_marca_solo_registro()'::regprocedure)
     OR (SELECT bool_or(has_function_privilege(r, 'public.remesas_marca_solo_registro()', 'EXECUTE'))
           FROM unnest(ARRAY['public', 'anon', 'authenticated']) r) THEN
    RAISE EXCEPTION 'el trigger de la marca es de invocador y no se ejecuta por RPC';
  END IF;
  IF NOT (SELECT prosecdef AND proconfig = ARRAY['search_path=public'] FROM pg_proc
           WHERE oid = 'public.marcar_remesa_enviada(uuid)'::regprocedure)
     OR NOT has_function_privilege('authenticated', 'public.marcar_remesa_enviada(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.marcar_remesa_enviada(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.marcar_remesa_enviada(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'marcar_remesa_enviada no es SECURITY DEFINER solo para authenticated';
  END IF;
  RAISE NOTICE 'guarda posterior: la marca solo por su registro, y marcar enviada por función';
END
$guarda$;
