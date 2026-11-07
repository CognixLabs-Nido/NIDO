-- =============================================================================
-- FEAT — La refirma de los documentos del centro (fase 4, 4d; 2026-11-07)
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/altas-serie.md, «4d». Decidido (J4): una versión nueva NO pide volver a firmar
-- sola; la admin lo PIDE al subir una versión corregida. Las familias que firmaron una versión anterior
-- de ese documento y ese curso pasan a «por firmar» y salen donde ya sale lo pendiente (el alta, la
-- ficha del niño y los dos inicios, 4c), porque todos leen `privado.documentos_del_nino`.
--
--   · `registrar_version_documento` gana `p_pide_refirma` (DEFAULT false: la app de antes, que llama
--     con cuatro, sigue subiendo igual). En la primera versión de un documento y un curso no se puede
--     pedir (`sin_version_anterior`); NULL, 22023. El evento `version_subida` lo dice.
--   · `privado.documentos_del_nino`: una firma vale si su versión es la misma o posterior a la última
--     que pidió volver a firmar. Si no, `por_firmar`, con la firma de antes en `firma_id` y
--     `disponible_desde` en la subida de la versión que lo pidió. Firmar sigue yendo por
--     `privado.version_por_firmar`, que lee el estado de aquí: se firma la vigente.
--   · `documentos_centro_admin`: cada versión dice si pidió volver a firmar.
--
-- `pide_refirma` existe desde el 3a (`20270101120000`), siempre false; una versión no cambia nunca
-- (`documentos_centro_versiones_defensa`), así que se decide al subirla. Medido en producción el
-- 2026-11-07: 0 documentos, 0 versiones, 0 firmas; la guarda previa lo vuelve a contar.
--
-- Generada con un guion desde las definiciones vivas (sin CR: copiar del `prosrc` vivo los trae).
-- ORDEN: APLICAR ANTES DE MERGEAR. La migración no rompe la app de antes (subir con cuatro
-- argumentos es pedir `false`), y la app nueva llama con cinco: desplegada antes, no subiría. La aplica
-- el responsable por SQL Editor, copiando el fichero de la rama. Tras aplicar: registrar en
-- supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_n   integer;
BEGIN
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.registrar_version_documento(uuid,uuid,text,integer)');
  IF v_md5 IS DISTINCT FROM 'a7a9a76a485252549a7039a2250f88b9' THEN
    RAISE EXCEPTION 'registrar_version_documento no es la de antes: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('privado.documentos_del_nino(uuid)');
  IF v_md5 IS DISTINCT FROM 'a866632fd7a7761a4900bb13beeb8856' THEN
    RAISE EXCEPTION 'privado.documentos_del_nino no es la de antes: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.documentos_centro_admin(uuid)');
  IF v_md5 IS DISTINCT FROM 'e57ffa380bdd165ab33dbb581d7e1335' THEN
    RAISE EXCEPTION 'documentos_centro_admin no es la de antes: %', coalesce(v_md5, 'falta');
  END IF;
  IF to_regprocedure('public.registrar_version_documento(uuid,uuid,text,integer,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'registrar_version_documento ya tiene la firma de cinco argumentos';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.documentos_centro_versiones'::regclass
                  AND a.attname = 'pide_refirma' AND a.atttypid = 'boolean'::regtype AND a.attnotnull AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'documentos_centro_versiones.pide_refirma no es boolean NOT NULL';
  END IF;
  SELECT count(*) INTO v_n FROM public.documentos_centro_versiones WHERE pide_refirma;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'hay % versiones con pide_refirma antes de construir la refirma', v_n;
  END IF;
  RAISE NOTICE '4d: versiones con pide_refirma antes de aplicar: % (de % versiones y % firmas)', v_n,
    (SELECT count(*) FROM public.documentos_centro_versiones), (SELECT count(*) FROM public.firmas_documentos_centro);
END
$guarda$;

-- ---- 1. Pedir volver a firmar, al subir ----
DROP FUNCTION public.registrar_version_documento(uuid, uuid, text, integer);
CREATE FUNCTION public.registrar_version_documento(p_documento_id uuid, p_curso_academico_id uuid, p_sha256 text, p_bytes integer,
  p_pide_refirma boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_doc    public.documentos_centro%ROWTYPE;
  v_ruta   text;
  v_obj    storage.objects%ROWTYPE;
  v_numero integer;
  v_id     uuid;
BEGIN
  SELECT * INTO v_doc FROM public.documentos_centro WHERE id = p_documento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM privado.documentos_centro_puerta(v_doc.centro_id);
  IF v_doc.retirado_at IS NOT NULL THEN
    RAISE EXCEPTION 'el documento está retirado' USING ERRCODE = 'P0001', HINT = 'retirado';
  END IF;
  IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'hash no válido' USING ERRCODE = 'invalid_parameter_value', HINT = 'sha256';
  END IF;
  IF p_pide_refirma IS NULL THEN
    RAISE EXCEPTION 'falta decir si pide volver a firmar' USING ERRCODE = 'invalid_parameter_value', HINT = 'pide_refirma';
  END IF;
  IF EXISTS (SELECT 1 FROM public.documentos_centro_versiones
              WHERE documento_id = p_documento_id AND sha256 = p_sha256) THEN
    RAISE EXCEPTION 'ese fichero ya es una versión de este documento' USING ERRCODE = 'P0001', HINT = 'ya_subida';
  END IF;

  -- El fichero ya está en el bucket, donde solo sube el servidor, en su sitio, con su tamaño y su tipo.
  v_ruta := format('%s/%s/%s.pdf', v_doc.centro_id, p_documento_id, p_sha256);
  SELECT * INTO v_obj FROM storage.objects o WHERE o.bucket_id = 'documentos-centro' AND o.name = v_ruta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'el fichero no está subido' USING ERRCODE = 'P0001', HINT = 'sin_fichero';
  END IF;
  IF (v_obj.metadata->>'size') IS DISTINCT FROM p_bytes::text
     OR (v_obj.metadata->>'mimetype') IS DISTINCT FROM 'application/pdf' THEN
    RAISE EXCEPTION 'el fichero subido no es el que se registra' USING ERRCODE = 'P0001', HINT = 'fichero_distinto';
  END IF;

  SELECT coalesce(max(numero), 0) + 1 INTO v_numero FROM public.documentos_centro_versiones
   WHERE documento_id = p_documento_id AND curso_academico_id IS NOT DISTINCT FROM p_curso_academico_id;
  -- 4d: volver a firmar se pide sobre lo que alguien pudo firmar antes. En la primera versión de ese
  -- documento y ese curso no hay nada que volver a firmar.
  IF p_pide_refirma AND v_numero = 1 THEN
    RAISE EXCEPTION 'no hay una versión anterior que volver a firmar' USING ERRCODE = 'P0001', HINT = 'sin_version_anterior';
  END IF;
  -- El trigger vuelve a mirar el curso: obligatorio si es de curso, del centro y no cerrado.
  INSERT INTO public.documentos_centro_versiones
    (documento_id, centro_id, curso_academico_id, numero, sha256, ruta, bytes, subida_por, pide_refirma)
  VALUES (p_documento_id, v_doc.centro_id, p_curso_academico_id, v_numero, p_sha256, v_ruta, p_bytes, auth.uid(),
          p_pide_refirma)
  RETURNING id INTO v_id;
  PERFORM privado.documentos_centro_evento(v_doc.centro_id,
    jsonb_build_object('accion', 'version_subida', 'documento_id', p_documento_id, 'version_id', v_id,
                       'curso_academico_id', p_curso_academico_id, 'numero', v_numero, 'sha256', p_sha256,
                       'pide_refirma', p_pide_refirma));
  RETURN v_id;
END
$function$;
REVOKE ALL ON FUNCTION public.registrar_version_documento(uuid, uuid, text, integer, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_version_documento(uuid, uuid, text, integer, boolean) TO authenticated;

-- ---- 2. Qué firma vale ----
CREATE OR REPLACE FUNCTION privado.documentos_del_nino(p_nino_id uuid)
 RETURNS TABLE(documento_id uuid, titulo text, de_curso boolean, obligatorio boolean, orden integer, curso_academico_id uuid, curso_nombre text, estado text, version_id uuid, numero integer, disponible_desde timestamp with time zone, firma_id uuid, firmado_at timestamp with time zone, metodo_firma firma_metodo)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH nino AS (
    SELECT n.id, n.centro_id FROM public.ninos n WHERE n.id = p_nino_id AND n.deleted_at IS NULL
  ),
  -- Las matrículas vivas del niño en un curso no cerrado: cada una pide el documento de su curso.
  cursos AS (
    SELECT m.curso_academico_id, c.nombre, min(m.created_at) AS desde
      FROM public.matriculas m
      JOIN public.cursos_academicos c ON c.id = m.curso_academico_id
     WHERE m.nino_id = p_nino_id AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
       AND c.estado <> 'cerrado' AND c.deleted_at IS NULL
     GROUP BY m.curso_academico_id, c.nombre
  ),
  -- Lo que se pide: (documento, curso). Un documento que no es de curso, una vez, sin curso, desde la
  -- primera matrícula viva.
  pedidos AS (
    SELECT d.id AS documento_id, d.titulo, d.de_curso, d.obligatorio, d.orden,
           k.curso_academico_id, k.nombre AS curso_nombre, k.desde
      FROM public.documentos_centro d JOIN nino ON nino.centro_id = d.centro_id
      JOIN cursos k ON d.de_curso
     WHERE d.retirado_at IS NULL
    UNION ALL
    SELECT d.id, d.titulo, d.de_curso, d.obligatorio, d.orden, NULL, NULL,
           (SELECT min(k.desde) FROM cursos k)
      FROM public.documentos_centro d JOIN nino ON nino.centro_id = d.centro_id
     WHERE d.retirado_at IS NULL AND NOT d.de_curso AND EXISTS (SELECT 1 FROM cursos)
  )
  -- 4d: `firma_id`, `firmado_at` y `metodo_firma` son la última firma de ese documento y curso, también
  -- cuando ya no vale: `por_firmar` con `firma_id` es «vuelve a firmar», y sin él, «firma por primera
  -- vez». `disponible_desde` de quien vuelve a firmar es la subida de la versión que lo pidió.
  SELECT p.documento_id, p.titulo, p.de_curso, p.obligatorio, p.orden,
         p.curso_academico_id, p.curso_nombre,
         CASE WHEN fv.vale THEN 'firmado'
              WHEN v.id IS NULL THEN 'falta_documento'
              ELSE 'por_firmar' END,
         CASE WHEN fv.vale THEN f.version_id ELSE v.id END,
         CASE WHEN fv.vale THEN f.numero ELSE v.numero END,
         CASE WHEN fv.vale OR v.id IS NULL THEN NULL
              WHEN f.id IS NOT NULL THEN greatest(r.subida_at, p.desde)
              ELSE greatest(primera.subida_at, p.desde) END,
         f.id, f.firmado_at, f.metodo_firma
    FROM pedidos p
    -- La vigente de ese documento y ese curso: la de número mayor.
    LEFT JOIN LATERAL (
      SELECT x.id, x.numero FROM public.documentos_centro_versiones x
       WHERE x.documento_id = p.documento_id
         AND x.curso_academico_id IS NOT DISTINCT FROM p.curso_academico_id
       ORDER BY x.numero DESC LIMIT 1
    ) v ON true
    LEFT JOIN LATERAL (
      SELECT min(x.subida_at) AS subida_at FROM public.documentos_centro_versiones x
       WHERE x.documento_id = p.documento_id
         AND x.curso_academico_id IS NOT DISTINCT FROM p.curso_academico_id
    ) primera ON true
    -- La última versión de ese documento y ese curso que pidió volver a firmar (4d).
    LEFT JOIN LATERAL (
      SELECT x.numero, x.subida_at FROM public.documentos_centro_versiones x
       WHERE x.documento_id = p.documento_id
         AND x.curso_academico_id IS NOT DISTINCT FROM p.curso_academico_id
         AND x.pide_refirma
       ORDER BY x.numero DESC LIMIT 1
    ) r ON true
    -- J4: una firma de cualquier versión de ese documento y ese curso vale, salvo que una versión
    -- posterior a la firmada pidiera volver a firmar (4d). La firma de la versión más alta.
    LEFT JOIN LATERAL (
      SELECT y.id, y.version_id, y.numero, y.firmado_at, y.metodo_firma
        FROM public.firmas_documentos_centro y
       WHERE y.nino_id = p_nino_id AND y.documento_id = p.documento_id
         AND y.curso_academico_id IS NOT DISTINCT FROM p.curso_academico_id
       ORDER BY y.numero DESC, y.firmado_at DESC LIMIT 1
    ) f ON true
    CROSS JOIN LATERAL (SELECT f.id IS NOT NULL AND (r.numero IS NULL OR f.numero >= r.numero) AS vale) fv;
$function$;

-- ---- 3. La lista de la admin ----
CREATE OR REPLACE FUNCTION public.documentos_centro_admin(p_centro_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM privado.documentos_centro_puerta(p_centro_id);
  RETURN jsonb_build_object(
    'documentos', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id, 'titulo', d.titulo, 'de_curso', d.de_curso, 'obligatorio', d.obligatorio,
        'orden', d.orden, 'retirado_at', d.retirado_at,
        'versiones', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'id', v.id, 'curso_academico_id', v.curso_academico_id, 'numero', v.numero,
            'sha256', v.sha256, 'bytes', v.bytes, 'subida_at', v.subida_at, 'pide_refirma', v.pide_refirma,
            -- La vigente de CADA curso: la de número mayor de ese documento y ese curso.
            'vigente', v.numero = (SELECT max(v2.numero) FROM public.documentos_centro_versiones v2
                                    WHERE v2.documento_id = v.documento_id
                                      AND v2.curso_academico_id IS NOT DISTINCT FROM v.curso_academico_id))
            ORDER BY v.curso_academico_id NULLS FIRST, v.numero DESC)
          FROM public.documentos_centro_versiones v WHERE v.documento_id = d.id), '[]'::jsonb))
        ORDER BY d.orden, d.titulo)
      FROM public.documentos_centro d WHERE d.centro_id = p_centro_id), '[]'::jsonb),
    'ficheros_sueltos', coalesce((
      SELECT jsonb_agg(o.name ORDER BY o.name) FROM storage.objects o
       WHERE o.bucket_id = 'documentos-centro' AND o.name LIKE p_centro_id::text || '/%'
         AND NOT EXISTS (SELECT 1 FROM public.documentos_centro_versiones v WHERE v.ruta = o.name)), '[]'::jsonb));
END
$function$;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_src text;
BEGIN
  IF to_regprocedure('public.registrar_version_documento(uuid,uuid,text,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'sigue la firma de cuatro argumentos de registrar_version_documento';
  END IF;
  IF to_regprocedure('public.registrar_version_documento(uuid,uuid,text,integer,boolean)') IS NULL THEN
    RAISE EXCEPTION 'falta registrar_version_documento de cinco argumentos';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.registrar_version_documento(uuid,uuid,text,integer,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.registrar_version_documento(uuid,uuid,text,integer,boolean)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.registrar_version_documento(uuid,uuid,text,integer,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'registrar_version_documento: EXECUTE no es solo de authenticated';
  END IF;
  SELECT replace(prosrc, E'\r', '') INTO v_src FROM pg_proc WHERE oid = 'public.registrar_version_documento(uuid,uuid,text,integer,boolean)'::regprocedure;
  IF v_src NOT LIKE '%sin_version_anterior%' OR v_src NOT LIKE '%subida_por, pide_refirma)%' OR v_src NOT LIKE '%privado.documentos_centro_puerta(v_doc.centro_id)%' THEN
    RAISE EXCEPTION 'registrar_version_documento no pide la versión anterior, no guarda pide_refirma o no pasa por la puerta';
  END IF;
  SELECT replace(prosrc, E'\r', '') INTO v_src FROM pg_proc WHERE oid = 'privado.documentos_del_nino(uuid)'::regprocedure;
  IF v_src NOT LIKE '%AND x.pide_refirma%' OR v_src NOT LIKE '%(r.numero IS NULL OR f.numero >= r.numero) AS vale%'
     OR v_src NOT LIKE '%CASE WHEN fv.vale THEN ''firmado''%' THEN
    RAISE EXCEPTION 'privado.documentos_del_nino no mira la refirma';
  END IF;
  IF has_function_privilege('authenticated', 'privado.documentos_del_nino(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'privado.documentos_del_nino(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'privado.documentos_del_nino se ha abierto';
  END IF;
  SELECT replace(prosrc, E'\r', '') INTO v_src FROM pg_proc WHERE oid = 'public.documentos_centro_admin(uuid)'::regprocedure;
  IF v_src NOT LIKE '%''pide_refirma'', v.pide_refirma%' THEN
    RAISE EXCEPTION 'documentos_centro_admin no dice pide_refirma';
  END IF;
END
$guarda$;
