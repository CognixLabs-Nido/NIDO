-- =============================================================================
-- FIX — La base compara con lo que ya sabe, no con la forma (2026-11-06)
-- -----------------------------------------------------------------------------
-- Principio (rls-policies.md, «Rutas e identificadores del cliente»): si la base puede derivar un
-- valor, no lo acepta del cliente; lo compara con el que deriva. Dos sitios donde solo miraba la forma:
--
-- 1. **El MsgId de un fichero de remesa** (`registrar_fichero_remesa`). Desde #462 el MsgId sale de la
--    marca de la versión (`NIDO-{8 del id}-{AAAAMMDDhhmmss UTC}`, `messageIdRemesa`), pero la base solo
--    comprobaba el prefijo `NIDO-{8 del id}-` y la longitud: con la marca de hoy aceptaba un MsgId con
--    la fecha de otro día (lo hacían cuatro tests de la suite RLS, que pasaban). La función recibe la
--    marca: ahora exige el MsgId que sale de ella (HINT `msg_id_no_es_de_la_marca`). Lo demás de la
--    función no cambia (copiada de 20261221120000, md5 normalizado en la guarda previa).
--
-- 2. **El bucket de una foto del blog** (`media.bucket`). `media` es solo del blog (ADR-0045,
--    P-media-reuso) y su único bucket es `aula-fotos`, pero la columna no tenía CHECK: el trigger
--    `media_validar_ruta_trg` valida la ruta contra la publicación, no el bucket, y el export firma
--    con el servicio el bucket y la ruta de la fila. Una fila con otro bucket hoy no lleva a ningún
--    fichero: **es una casualidad de la forma de las rutas** (ningún otro bucket tiene ficheros de
--    cuatro niveles `{centro}/{aula}/{publicación}/…`), **no una defensa**. Ahora, CHECK
--    `media_bucket_blog` (`bucket = 'aula-fotos'`).
--
-- En producción (2026-11-06, lectura): 0 filas en `remesa_ficheros` y 0 en `media`. Las guardas
-- previas lo cuentan y abortan si alguna fila ya no cumple lo nuevo.
--
-- Sin orden con el despliegue: la app ya manda el MsgId de la marca (`versionRemesa`) y sube las
-- fotos del blog a `aula-fotos`. La aplica el responsable por SQL Editor, copiando el fichero. Tras
-- aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_n   bigint;
BEGIN
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.registrar_fichero_remesa(uuid,timestamptz,text,text,text,jsonb)');
  IF v_md5 IS DISTINCT FROM 'a101708df6362342ab5554d8bc5dab2c' THEN
    RAISE EXCEPTION 'registrar_fichero_remesa no es la de 20261221120000: %', coalesce(v_md5, 'falta');
  END IF;

  SELECT count(*) INTO v_n FROM public.remesa_ficheros f
   WHERE f.msg_id IS DISTINCT FROM 'NIDO-' || left(f.remesa_id::text, 8) || '-'
                                   || to_char(f.generado_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS');
  RAISE NOTICE 'remesa_ficheros: % filas, % con un MsgId que no es el de su marca',
    (SELECT count(*) FROM public.remesa_ficheros), v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'hay % ficheros de remesa con un MsgId que no es el de su marca; no se aplica', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.media WHERE bucket IS DISTINCT FROM 'aula-fotos';
  RAISE NOTICE 'media: % filas, % fuera de aula-fotos', (SELECT count(*) FROM public.media), v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'hay % filas de media fuera de aula-fotos; no se aplica', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.media'::regclass AND conname = 'media_bucket_blog') THEN
    RAISE EXCEPTION 'media_bucket_blog ya existe';
  END IF;
END
$guarda$;

-- ---- 1. El MsgId, el de la marca ----
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

  -- El MsgId sale de la marca (#462, `messageIdRemesa`): `NIDO-{8 del id}-{AAAAMMDDhhmmss UTC}`.
  -- La base lo puede derivar, así que lo compara con el que deriva, no con su forma (20270107120000).
  IF p_msg_id IS DISTINCT FROM 'NIDO-' || left(p_remesa_id::text, 8) || '-'
                               || to_char(p_marca AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS') THEN
    RAISE EXCEPTION 'el MsgId no es el de la marca de esta versión' USING ERRCODE = 'P0001', HINT = 'msg_id_no_es_de_la_marca';
  END IF;
  -- El fichero ya está en el bucket, donde solo sube el servidor, y en su sitio.
  IF p_ruta IS DISTINCT FROM format('%s/%s/%s.xml', v_remesa.centro_id, p_remesa_id, p_msg_id) THEN
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

-- ---- 2. El bucket del blog ----
ALTER TABLE public.media
  ADD CONSTRAINT media_bucket_blog CHECK (bucket = 'aula-fotos');

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_md5 text;
  v_p   oid := 'public.registrar_fichero_remesa(uuid,timestamptz,text,text,text,jsonb)'::regprocedure;
BEGIN
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = v_p;
  IF v_md5 IS DISTINCT FROM '8d4a1df6abcf02582968636f95d07602' THEN
    RAISE EXCEPTION 'registrar_fichero_remesa no quedó como este fichero: %', coalesce(v_md5, 'falta');
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_p)
     OR NOT has_function_privilege('authenticated', v_p, 'EXECUTE')
     OR has_function_privilege('anon', v_p, 'EXECUTE') THEN
    RAISE EXCEPTION 'registrar_fichero_remesa: SECURITY DEFINER, EXECUTE para authenticated y no para anon';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.media'::regclass AND conname = 'media_bucket_blog'
                    AND contype = 'c' AND convalidated
                    AND pg_get_constraintdef(oid) = 'CHECK ((bucket = ''aula-fotos''::text))') THEN
    RAISE EXCEPTION 'falta el CHECK media_bucket_blog validado';
  END IF;
END
$guarda$;
