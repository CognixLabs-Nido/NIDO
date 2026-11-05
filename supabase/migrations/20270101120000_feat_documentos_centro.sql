-- =============================================================================
-- FEAT — Documentos del centro versionados (serie de altas, paso 1, pieza 1a; 2026-11-05)
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/altas-serie.md, «Paso 1: documentos del centro versionados». El centro sube su
-- PDF (el presupuesto de cada curso, las normas…) y la familia lo firma tal cual (D1). Esta pieza es
-- la base: los documentos, sus versiones y el bucket. Las firmas, con su retención, son el 1b; la
-- pantalla de la admin, el 1c.
--
-- - `documentos_centro`: la lista que define cada centro (D3), con su título en un solo idioma (J7),
--   si es obligatorio y si es DE CURSO (J2). «De curso» solo se cambia mientras no tenga versiones (J6).
-- - `documentos_centro_versiones`: cada fichero subido. En un documento de curso lleva su curso, y hay
--   VARIOS VIVOS A LA VEZ: la vigente es la última de ese documento y ese curso (Jose: «tengo los dos
--   y cada uno firma el suyo»). `pide_refirma` queda preparado para la refirma, que no se construye
--   todavía (spec, «Pendiente: pedir que lo vuelvan a firmar»): hoy siempre es false.
-- - El bucket `documentos-centro`: privado, PDF, sin políticas. El fichero se llama por su sha256, que
--   calcula el servidor con los bytes que sube; la función que registra comprueba que está.
-- - UNA VERSIÓN NO CAMBIA NUNCA, para nadie (tampoco service_role ni postgres): ni la fila ni su
--   fichero. Se puede BORRAR mientras no tenga firmas (J5), solo por su función, que deja quién lo
--   hizo; desde el 1b, el RESTRICT de las firmas lo impide en cuanto haya una.
-- - Todo por funciones de la admin del centro (`privado.es_responsable`, J1). Cada acción deja un
--   evento directo en audit_log (`documento_centro`), sin datos de ninguna familia.
--
-- Sin orden con el despliegue: todo es nuevo y nadie lo usa hasta que llegue la app. La aplica el
-- responsable por SQL Editor, copiando el fichero. Tras aplicar: registrar en
-- supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
BEGIN
  IF to_regclass('public.documentos_centro') IS NOT NULL THEN
    RAISE EXCEPTION 'ya aplicada: existe public.documentos_centro';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'documentos-centro') THEN
    RAISE EXCEPTION 'el bucket documentos-centro ya existe';
  END IF;
  IF to_regprocedure('privado.es_responsable(uuid)') IS NULL THEN
    RAISE EXCEPTION 'falta privado.es_responsable (20261029120000): esta va detrás';
  END IF;
  IF NOT has_table_privilege('postgres', 'storage.objects', 'TRIGGER') THEN
    RAISE EXCEPTION 'postgres no puede crear triggers en storage.objects';
  END IF;
  RAISE NOTICE 'guarda previa: % centros vivos, % cursos no cerrados',
    (SELECT count(*) FROM public.centros WHERE deleted_at IS NULL),
    (SELECT count(*) FROM public.cursos_academicos WHERE deleted_at IS NULL AND estado <> 'cerrado');
END
$guarda$;

-- ---- 1. El bucket ----
-- Privado y sin políticas en storage.objects: ninguna sesión lo lee ni lo escribe. Sube y sirve el
-- servidor, tras comprobar la sesión.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('documentos-centro', 'documentos-centro', false, 10485760, ARRAY['application/pdf']);

-- ---- 2. Las tablas ----
CREATE TABLE public.documentos_centro (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id    uuid NOT NULL REFERENCES public.centros(id),
  titulo       text NOT NULL CHECK (char_length(btrim(titulo)) BETWEEN 1 AND 200),
  de_curso     boolean NOT NULL,
  obligatorio  boolean NOT NULL DEFAULT true,
  orden        integer NOT NULL DEFAULT 0 CHECK (orden BETWEEN 0 AND 1000),
  retirado_at  timestamptz NULL,
  creado_por   uuid NOT NULL REFERENCES public.usuarios(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
-- Dos documentos vivos del mismo centro no se llaman igual.
CREATE UNIQUE INDEX documentos_centro_titulo_vivo
  ON public.documentos_centro (centro_id, lower(btrim(titulo))) WHERE retirado_at IS NULL;

CREATE TABLE public.documentos_centro_versiones (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT: un documento con versiones no se borra (se retira).
  documento_id       uuid NOT NULL REFERENCES public.documentos_centro(id) ON DELETE RESTRICT,
  centro_id          uuid NOT NULL REFERENCES public.centros(id),
  -- RESTRICT: un curso con versiones de documentos no se borra.
  curso_academico_id uuid NULL REFERENCES public.cursos_academicos(id) ON DELETE RESTRICT,
  numero             integer NOT NULL CHECK (numero > 0),
  sha256             text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  ruta               text NOT NULL UNIQUE,
  bytes              integer NOT NULL CHECK (bytes BETWEEN 1 AND 10485760),
  -- La refirma (pendiente, spec): con true, las firmas de las versiones anteriores del mismo
  -- documento y curso dejan de valer. Hoy siempre false; se decide al subir, porque la fila no cambia.
  pide_refirma       boolean NOT NULL DEFAULT false,
  subida_por         uuid NOT NULL REFERENCES public.usuarios(id),
  subida_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documentos_centro_versiones_numero UNIQUE NULLS NOT DISTINCT (documento_id, curso_academico_id, numero),
  -- El mismo fichero no se sube dos veces al mismo documento.
  CONSTRAINT documentos_centro_versiones_fichero UNIQUE (documento_id, sha256),
  CONSTRAINT documentos_centro_versiones_ruta CHECK (ruta = format('%s/%s/%s.pdf', centro_id, documento_id, sha256))
);
CREATE INDEX documentos_centro_versiones_curso_idx
  ON public.documentos_centro_versiones (curso_academico_id) WHERE curso_academico_id IS NOT NULL;

-- Sin políticas ni privilegios para nadie: solo las funciones de abajo.
ALTER TABLE public.documentos_centro ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documentos_centro_versiones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.documentos_centro FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.documentos_centro_versiones FROM PUBLIC, anon, authenticated, service_role;

-- ---- 3. Las defensas, para todos (también service_role y postgres) ----

-- 3a. La versión: el documento y el curso son coherentes al crearla, y la fila no cambia nunca.
--     Solo se borra por `borrar_version_documento`, que deja quién lo hizo (marcador local, el
--     patrón de `app.resolver_devolucion`).
CREATE OR REPLACE FUNCTION privado.documentos_centro_version_defensa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_doc   public.documentos_centro%ROWTYPE;
  v_curso public.cursos_academicos%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'una versión de un documento del centro no cambia nunca'
      USING ERRCODE = 'P0001', HINT = 'version_inmutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.borrar_version_documento', true) IS DISTINCT FROM OLD.id::text THEN
      RAISE EXCEPTION 'una versión solo se borra con borrar_version_documento'
        USING ERRCODE = 'P0001', HINT = 'borrar_solo_por_funcion';
    END IF;
    RETURN OLD;
  END IF;
  -- INSERT
  SELECT * INTO v_doc FROM public.documentos_centro WHERE id = NEW.documento_id;
  IF NEW.centro_id IS DISTINCT FROM v_doc.centro_id THEN
    RAISE EXCEPTION 'la versión no es del centro de su documento' USING ERRCODE = '23514', HINT = 'centro_distinto';
  END IF;
  IF v_doc.de_curso THEN
    IF NEW.curso_academico_id IS NULL THEN
      RAISE EXCEPTION 'un documento de curso lleva el curso en cada versión' USING ERRCODE = '23514', HINT = 'falta_curso';
    END IF;
    SELECT * INTO v_curso FROM public.cursos_academicos WHERE id = NEW.curso_academico_id;
    IF v_curso.centro_id IS DISTINCT FROM v_doc.centro_id OR v_curso.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'el curso no es del centro' USING ERRCODE = '23514', HINT = 'curso_ajeno';
    END IF;
    IF v_curso.estado = 'cerrado' THEN
      RAISE EXCEPTION 'no se sube una versión para un curso cerrado' USING ERRCODE = '23514', HINT = 'curso_cerrado';
    END IF;
  ELSIF NEW.curso_academico_id IS NOT NULL THEN
    RAISE EXCEPTION 'un documento que no es de curso no lleva curso' USING ERRCODE = '23514', HINT = 'sobra_curso';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION privado.documentos_centro_version_defensa() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER documentos_centro_versiones_defensa
  BEFORE INSERT OR UPDATE OR DELETE ON public.documentos_centro_versiones
  FOR EACH ROW EXECUTE FUNCTION privado.documentos_centro_version_defensa();

-- 3b. El documento: el centro no cambia, y «de curso» solo mientras no tenga versiones (J6).
CREATE OR REPLACE FUNCTION privado.documentos_centro_defensa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.centro_id IS DISTINCT FROM OLD.centro_id THEN
    RAISE EXCEPTION 'el centro de un documento no cambia' USING ERRCODE = '23514', HINT = 'centro_fijo';
  END IF;
  IF NEW.de_curso IS DISTINCT FROM OLD.de_curso
     AND EXISTS (SELECT 1 FROM public.documentos_centro_versiones WHERE documento_id = OLD.id) THEN
    RAISE EXCEPTION '«de curso» no cambia en un documento con versiones'
      USING ERRCODE = '23514', HINT = 'de_curso_fijo';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION privado.documentos_centro_defensa() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER documentos_centro_defensa
  BEFORE UPDATE ON public.documentos_centro
  FOR EACH ROW EXECUTE FUNCTION privado.documentos_centro_defensa();

-- 3c. El fichero de una versión, en Storage: no se sustituye, no se mueve y no se borra mientras una
--     versión apunte a él. Solo en este bucket, y solo sobre objetos registrados: no toca la subida
--     (que Storage hace antes del registro) ni la lectura (Storage toca `updated_at` y
--     `last_accessed_at` al servir un fichero, y eso se deja pasar). Se ignoran también las columnas
--     generadas (`path_tokens`, medido el 2026-11-05): en un BEFORE, NEW aún no las trae calculadas, y
--     sin ignorarlas una simple lectura parecía un cambio. Se leen del catálogo, no se escriben a mano.
CREATE OR REPLACE FUNCTION privado.documentos_centro_objeto_defensa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_ignorar text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.documentos_centro_versiones v WHERE v.ruta = OLD.name) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'el fichero de una versión no se borra mientras exista la versión'
      USING ERRCODE = 'P0001', HINT = 'fichero_de_version';
  END IF;
  SELECT coalesce(array_agg(a.attname::text), '{}') INTO v_ignorar FROM pg_attribute a
   WHERE a.attrelid = TG_RELID AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated <> '';
  v_ignorar := v_ignorar || ARRAY['updated_at', 'last_accessed_at'];
  IF (to_jsonb(NEW) - v_ignorar) IS DISTINCT FROM (to_jsonb(OLD) - v_ignorar) THEN
    RAISE EXCEPTION 'el fichero de una versión no cambia nunca'
      USING ERRCODE = 'P0001', HINT = 'fichero_de_version';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION privado.documentos_centro_objeto_defensa() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER documentos_centro_objeto_defensa
  BEFORE UPDATE OR DELETE ON storage.objects
  FOR EACH ROW WHEN (OLD.bucket_id = 'documentos-centro')
  EXECUTE FUNCTION privado.documentos_centro_objeto_defensa();

-- ---- 4. Las funciones de la admin (J1) ----

-- La puerta de todas: la admin del centro (o el superusuario), con sesión.
CREATE OR REPLACE FUNCTION privado.documentos_centro_puerta(p_centro_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL OR p_centro_id IS NULL OR NOT privado.es_responsable(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION privado.documentos_centro_puerta(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION privado.documentos_centro_evento(p_centro_id uuid, p_valores jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  INSERT INTO public.audit_log (tabla, registro_id, accion, usuario_id, centro_id, valores_antes, valores_despues)
  VALUES ('documento_centro', p_centro_id, 'UPDATE', auth.uid(), p_centro_id, NULL, p_valores);
$function$;
REVOKE ALL ON FUNCTION privado.documentos_centro_evento(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crear_documento_centro(
  p_centro_id uuid, p_titulo text, p_de_curso boolean, p_obligatorio boolean, p_orden integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_id uuid;
BEGIN
  PERFORM privado.documentos_centro_puerta(p_centro_id);
  IF p_de_curso IS NULL THEN
    RAISE EXCEPTION 'falta decir si es de curso' USING ERRCODE = 'invalid_parameter_value', HINT = 'de_curso';
  END IF;
  INSERT INTO public.documentos_centro (centro_id, titulo, de_curso, obligatorio, orden, creado_por)
  VALUES (p_centro_id, btrim(p_titulo), p_de_curso, coalesce(p_obligatorio, true), coalesce(p_orden, 0), auth.uid())
  RETURNING id INTO v_id;
  PERFORM privado.documentos_centro_evento(p_centro_id,
    jsonb_build_object('accion', 'creado', 'documento_id', v_id, 'de_curso', p_de_curso,
                       'obligatorio', coalesce(p_obligatorio, true)));
  RETURN v_id;
END
$function$;

-- Cambia lo que se pase (NULL = lo deja como está). «Retirar» y «volver a poner»: p_retirado.
CREATE OR REPLACE FUNCTION public.editar_documento_centro(
  p_documento_id uuid, p_titulo text, p_de_curso boolean, p_obligatorio boolean, p_orden integer,
  p_retirado boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_doc public.documentos_centro%ROWTYPE;
BEGIN
  SELECT * INTO v_doc FROM public.documentos_centro WHERE id = p_documento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM privado.documentos_centro_puerta(v_doc.centro_id);
  UPDATE public.documentos_centro SET
    titulo      = coalesce(btrim(p_titulo), titulo),
    de_curso    = coalesce(p_de_curso, de_curso),
    obligatorio = coalesce(p_obligatorio, obligatorio),
    orden       = coalesce(p_orden, orden),
    retirado_at = CASE WHEN p_retirado IS NULL THEN retirado_at
                       WHEN p_retirado THEN coalesce(retirado_at, now()) ELSE NULL END
  WHERE id = p_documento_id;
  PERFORM privado.documentos_centro_evento(v_doc.centro_id,
    jsonb_strip_nulls(jsonb_build_object('accion', 'editado', 'documento_id', p_documento_id,
      'titulo', CASE WHEN p_titulo IS NOT NULL THEN true END, 'de_curso', p_de_curso,
      'obligatorio', p_obligatorio, 'orden', p_orden, 'retirado', p_retirado)));
END
$function$;

-- Registra una versión cuyo fichero ya subió el servidor a su ruta. El número es el siguiente del
-- documento y su curso; la vigente de cada curso es la de número mayor.
CREATE OR REPLACE FUNCTION public.registrar_version_documento(
  p_documento_id uuid, p_curso_academico_id uuid, p_sha256 text, p_bytes integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  -- El trigger vuelve a mirar el curso: obligatorio si es de curso, del centro y no cerrado.
  INSERT INTO public.documentos_centro_versiones
    (documento_id, centro_id, curso_academico_id, numero, sha256, ruta, bytes, subida_por)
  VALUES (p_documento_id, v_doc.centro_id, p_curso_academico_id, v_numero, p_sha256, v_ruta, p_bytes, auth.uid())
  RETURNING id INTO v_id;
  PERFORM privado.documentos_centro_evento(v_doc.centro_id,
    jsonb_build_object('accion', 'version_subida', 'documento_id', p_documento_id, 'version_id', v_id,
                       'curso_academico_id', p_curso_academico_id, 'numero', v_numero, 'sha256', p_sha256));
  RETURN v_id;
END
$function$;

-- J5: borra una versión sin firmas y devuelve su ruta, para que la app borre el fichero. Desde el 1b
-- la FK RESTRICT de las firmas lo impide en cuanto tenga una.
CREATE OR REPLACE FUNCTION public.borrar_version_documento(p_version_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_ver public.documentos_centro_versiones%ROWTYPE;
BEGIN
  SELECT * INTO v_ver FROM public.documentos_centro_versiones WHERE id = p_version_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM privado.documentos_centro_puerta(v_ver.centro_id);
  PERFORM set_config('app.borrar_version_documento', v_ver.id::text, true);
  DELETE FROM public.documentos_centro_versiones WHERE id = p_version_id;
  PERFORM set_config('app.borrar_version_documento', '', true);
  PERFORM privado.documentos_centro_evento(v_ver.centro_id,
    jsonb_build_object('accion', 'version_borrada', 'documento_id', v_ver.documento_id, 'version_id', v_ver.id,
                       'curso_academico_id', v_ver.curso_academico_id, 'numero', v_ver.numero, 'sha256', v_ver.sha256));
  RETURN v_ver.ruta;
END
$function$;

-- La lista para la pantalla de la admin: cada documento con sus versiones, la vigente de cada curso
-- marcada, y los ficheros del bucket de su centro que ya no son de ninguna versión (un borrado cuyo
-- fichero no se pudo quitar: la app lo reintenta).
CREATE OR REPLACE FUNCTION public.documentos_centro_admin(p_centro_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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
            'sha256', v.sha256, 'bytes', v.bytes, 'subida_at', v.subida_at,
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

REVOKE ALL ON FUNCTION public.crear_documento_centro(uuid, text, boolean, boolean, integer) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.editar_documento_centro(uuid, text, boolean, boolean, integer, boolean) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.registrar_version_documento(uuid, uuid, text, integer) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.borrar_version_documento(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.documentos_centro_admin(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crear_documento_centro(uuid, text, boolean, boolean, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.editar_documento_centro(uuid, text, boolean, boolean, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_version_documento(uuid, uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.borrar_version_documento(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.documentos_centro_admin(uuid) TO authenticated;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_t text;
  v_f text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'documentos-centro' AND NOT public
                  AND allowed_mime_types = ARRAY['application/pdf'] AND file_size_limit = 10485760) THEN
    RAISE EXCEPTION 'el bucket documentos-centro no es privado, de PDF y 10 MB';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
              AND (qual LIKE '%documentos-centro%' OR with_check LIKE '%documentos-centro%')) THEN
    RAISE EXCEPTION 'hay políticas de Storage para documentos-centro';
  END IF;
  FOREACH v_t IN ARRAY ARRAY['public.documentos_centro', 'public.documentos_centro_versiones'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_t::regclass) THEN
      RAISE EXCEPTION '% sin RLS', v_t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = v_t::regclass) THEN
      RAISE EXCEPTION '% tiene políticas', v_t;
    END IF;
    IF has_table_privilege('authenticated', v_t, 'SELECT') OR has_table_privilege('anon', v_t, 'SELECT')
       OR has_table_privilege('service_role', v_t, 'SELECT') OR has_table_privilege('service_role', v_t, 'UPDATE')
       OR has_table_privilege('service_role', v_t, 'DELETE') OR has_table_privilege('authenticated', v_t, 'INSERT') THEN
      RAISE EXCEPTION '% tiene privilegios para alguien', v_t;
    END IF;
  END LOOP;
  FOREACH v_f IN ARRAY ARRAY[
    'public.crear_documento_centro(uuid,text,boolean,boolean,integer)',
    'public.editar_documento_centro(uuid,text,boolean,boolean,integer,boolean)',
    'public.registrar_version_documento(uuid,uuid,text,integer)',
    'public.borrar_version_documento(uuid)',
    'public.documentos_centro_admin(uuid)'] LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_f::regprocedure)
       OR NOT has_function_privilege('authenticated', v_f, 'EXECUTE')
       OR has_function_privilege('anon', v_f, 'EXECUTE')
       OR has_function_privilege('service_role', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION '% no es SECURITY DEFINER solo para authenticated', v_f;
    END IF;
    IF position('privado.documentos_centro_puerta(' IN pg_get_functiondef(v_f::regprocedure)) = 0 THEN
      RAISE EXCEPTION '% no pasa por la puerta de la admin', v_f;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.documentos_centro_versiones'::regclass
                  AND tgname = 'documentos_centro_versiones_defensa' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'falta el trigger que no deja cambiar una versión';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'storage.objects'::regclass
                  AND tgname = 'documentos_centro_objeto_defensa' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'falta el trigger que no deja cambiar el fichero de una versión';
  END IF;
  RAISE NOTICE 'guarda posterior: bucket privado, 2 tablas cerradas, 5 funciones de la admin, 3 triggers';
END
$guarda$;
