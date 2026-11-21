-- 20270202120000 · La subida de las fotos del DNI de recogida, solo a quien firma la recogida; y la lectura de
-- toda profe del centro, con su motivo escrito (2026-11-20). Spec: docs/specs/altas-serie.md, «7,
-- DECIDIDO por Jose el 2026-11-20» y «El autorizado: lo que ve y lo que no».
--
-- Guarda previa: #541 aplicada, los md5 normalizados (sin CR, sin comentarios, espacios
-- colapsados) de los predicados y las cuatro políticas tal como se leyeron en producción el
-- 2026-11-20. Si algo cambió, para sin escribir nada. Guarda posterior: la forma nueva y el motivo.

DO $guarda$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20270201120000') THEN
    RAISE EXCEPTION 'recogida: falta 20270201120000 (#541) aplicada';
  END IF;
  IF (SELECT md5(regexp_replace(regexp_replace(replace(prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) FROM pg_proc WHERE oid = 'public.es_admin(uuid)'::regprocedure) IS DISTINCT FROM 'da96f192cef9402cf0618ea2cbd82902' THEN
    RAISE EXCEPTION 'recogida: % no es la leída en producción el 2026-11-20', 'public.es_admin(uuid)';
  END IF;
  IF (SELECT md5(regexp_replace(regexp_replace(replace(prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) FROM pg_proc WHERE oid = 'public.tiene_permiso_sobre(uuid,text)'::regprocedure) IS DISTINCT FROM '01d9e96f7c740fdd71379ee88117332b' THEN
    RAISE EXCEPTION 'recogida: % no es la leída en producción el 2026-11-20', 'public.tiene_permiso_sobre(uuid,text)';
  END IF;
  IF (SELECT md5(regexp_replace(regexp_replace(replace(prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) FROM pg_proc WHERE oid = 'privado.ruta_coherente(text,text)'::regprocedure) IS DISTINCT FROM '5fce6211e90610931afdcb23481b3ec9' THEN
    RAISE EXCEPTION 'recogida: % no es la leída en producción el 2026-11-20', 'privado.ruta_coherente(text,text)';
  END IF;
  IF (SELECT md5(regexp_replace(regexp_replace(replace(prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) FROM pg_proc WHERE oid = 'public.es_profe_en_centro(uuid)'::regprocedure) IS DISTINCT FROM '529a7048689278ad679a9225e2f4e1e1' THEN
    RAISE EXCEPTION 'recogida: % no es la leída en producción el 2026-11-20', 'public.es_profe_en_centro(uuid)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                   AND policyname = 'recogida_adjuntos_insert' AND cmd = 'INSERT' AND with_check = '((bucket_id = ''recogida-adjuntos''::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_profe_en_centro(((storage.foldername(name))[1])::uuid)) AND privado.ruta_coherente(bucket_id, name))') THEN
    RAISE EXCEPTION 'recogida: la política % no es la %', 'recogida_adjuntos_insert', 'leída en producción el 2026-11-20';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                   AND policyname = 'recogida_adjuntos_insert_tutor' AND cmd = 'INSERT' AND with_check = '((bucket_id = ''recogida-adjuntos''::text) AND es_tutor_de(((storage.foldername(name))[2])::uuid) AND privado.ruta_coherente(bucket_id, name))') THEN
    RAISE EXCEPTION 'recogida: la política % no es la %', 'recogida_adjuntos_insert_tutor', 'leída en producción el 2026-11-20';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                   AND policyname = 'recogida_adjuntos_select' AND cmd = 'SELECT' AND qual = '((bucket_id = ''recogida-adjuntos''::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_profe_en_centro(((storage.foldername(name))[1])::uuid)) AND privado.ruta_coherente(bucket_id, name))') THEN
    RAISE EXCEPTION 'recogida: la política % no es la %', 'recogida_adjuntos_select', 'leída en producción el 2026-11-20';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                   AND policyname = 'recogida_adjuntos_select_tutor' AND cmd = 'SELECT' AND qual = '((bucket_id = ''recogida-adjuntos''::text) AND (es_tutor_legal_de(((storage.foldername(name))[2])::uuid) OR ((owner_id = (auth.uid())::text) AND es_tutor_de(((storage.foldername(name))[2])::uuid))) AND privado.ruta_coherente(bucket_id, name))') THEN
    RAISE EXCEPTION 'recogida: la política % no es la %', 'recogida_adjuntos_select_tutor', 'leída en producción el 2026-11-20';
  END IF;

END $guarda$;

-- ---------------------------------------------------------------------------------------------
-- 1 · La subida. Medido con sesión el 2026-11-20 (ensayo en producción terminado en RAISE): la
-- profe del aula, la de otra aula y una con rol profe sin aula suben a la carpeta de cualquier niño
-- del centro; el autorizado sin permiso de firmar, también. En la app solo sube la familia: la
-- foto se sube al firmar la recogida (`/recogida/dni`, desde `/family/autorizaciones`), y ninguna
-- pantalla de profe o de Dirección la sube. Se cierra a quien la necesita:
-- el tutor con permiso de firmar autorizaciones de ese niño (el mismo permiso que pide
-- `firmas_insert`). La política del personal (`recogida_adjuntos_insert`: Dirección o cualquier
-- profe del centro) se borra entera: la profe, porque ver la foto es su trabajo y subirla no («Ver
-- la foto de quien recoge es el trabajo de la profe; subir ficheros a la carpeta de cualquier niño
-- no lo es», 2026-11-20); Dirección, porque ninguna pantalla suya la sube y ADR-0046 ya lo decía
-- («La dirección NO sube DNIs»).
DROP POLICY recogida_adjuntos_insert ON storage.objects;
DROP POLICY recogida_adjuntos_insert_tutor ON storage.objects;
CREATE POLICY recogida_adjuntos_insert_tutor ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((bucket_id = 'recogida-adjuntos'::text) AND tiene_permiso_sobre(((storage.foldername(name))[2])::uuid, 'puede_firmar_autorizaciones'::text) AND privado.ruta_coherente(bucket_id, name));

-- ---------------------------------------------------------------------------------------------
-- 2 · La lectura NO cambia: cualquier profe del centro ve la foto, a propósito. Lo dice la política
-- misma, para que quien la mida no la tome por un agujero.
COMMENT ON POLICY recogida_adjuntos_select ON storage.objects IS 'Decisión de Jose del 2026-11-20 (docs/specs/altas-serie.md, «El autorizado: lo que ve y lo que no»): CUALQUIER profe del centro ve la foto del DNI de quien recoge, A PROPÓSITO. «puede que la profe titular no sea la que entrega a los niños»: la salida la hace quien está en ese momento. No es un agujero; estrecharla rompe la salida del centro.';

DO $posterior$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'recogida_adjuntos_insert') THEN
    RAISE EXCEPTION 'recogida: la subida del personal sigue existiendo';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                   AND policyname = 'recogida_adjuntos_insert_tutor' AND cmd = 'INSERT' AND with_check = '((bucket_id = ''recogida-adjuntos''::text) AND tiene_permiso_sobre(((storage.foldername(name))[2])::uuid, ''puede_firmar_autorizaciones''::text) AND privado.ruta_coherente(bucket_id, name))') THEN
    RAISE EXCEPTION 'recogida: la política % no es la %', 'recogida_adjuntos_insert_tutor', 'nueva';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                   AND policyname = 'recogida_adjuntos_select' AND cmd = 'SELECT' AND qual = '((bucket_id = ''recogida-adjuntos''::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_profe_en_centro(((storage.foldername(name))[1])::uuid)) AND privado.ruta_coherente(bucket_id, name))') THEN
    RAISE EXCEPTION 'recogida: la política % no es la %', 'recogida_adjuntos_select', 'de antes';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                   AND policyname = 'recogida_adjuntos_select_tutor' AND cmd = 'SELECT' AND qual = '((bucket_id = ''recogida-adjuntos''::text) AND (es_tutor_legal_de(((storage.foldername(name))[2])::uuid) OR ((owner_id = (auth.uid())::text) AND es_tutor_de(((storage.foldername(name))[2])::uuid))) AND privado.ruta_coherente(bucket_id, name))') THEN
    RAISE EXCEPTION 'recogida: la política % no es la %', 'recogida_adjuntos_select_tutor', 'de antes';
  END IF;

  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
        AND (qual ILIKE '%recogida-adjuntos%' OR with_check ILIKE '%recogida-adjuntos%')) <> 4 THEN
    RAISE EXCEPTION 'recogida: el bucket no tiene sus 4 políticas';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd = 'INSERT'
        AND with_check ILIKE '%recogida-adjuntos%') <> 1 THEN
    RAISE EXCEPTION 'recogida: el bucket no tiene una sola política de subida';
  END IF;
  IF obj_description((SELECT oid FROM pg_policy WHERE polname = 'recogida_adjuntos_select'
                        AND polrelid = 'storage.objects'::regclass), 'pg_policy') IS DISTINCT FROM 'Decisión de Jose del 2026-11-20 (docs/specs/altas-serie.md, «El autorizado: lo que ve y lo que no»): CUALQUIER profe del centro ve la foto del DNI de quien recoge, A PROPÓSITO. «puede que la profe titular no sea la que entrega a los niños»: la salida la hace quien está en ese momento. No es un agujero; estrecharla rompe la salida del centro.' THEN
    RAISE EXCEPTION 'recogida: la lectura no lleva escrito su motivo';
  END IF;
END $posterior$;
