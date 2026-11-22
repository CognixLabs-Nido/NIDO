-- 20270202120000 · La recogida firmada (2026-11-20 y 2026-11-21): la subida de las fotos del DNI, solo a
-- quien firma la recogida; y la consulta de cualquier profe del centro (la foto, la lista y el nombre del
-- niño), a propósito y con su motivo escrito. Spec: docs/specs/altas-serie.md, «7, DECIDIDO por Jose».
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
    RAISE EXCEPTION 'recogida: % no es la leída en producción (2026-11-20 y 21)', 'public.es_admin(uuid)';
  END IF;
  IF (SELECT md5(regexp_replace(regexp_replace(replace(prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) FROM pg_proc WHERE oid = 'public.tiene_permiso_sobre(uuid,text)'::regprocedure) IS DISTINCT FROM '01d9e96f7c740fdd71379ee88117332b' THEN
    RAISE EXCEPTION 'recogida: % no es la leída en producción (2026-11-20 y 21)', 'public.tiene_permiso_sobre(uuid,text)';
  END IF;
  IF (SELECT md5(regexp_replace(regexp_replace(replace(prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) FROM pg_proc WHERE oid = 'privado.ruta_coherente(text,text)'::regprocedure) IS DISTINCT FROM '5fce6211e90610931afdcb23481b3ec9' THEN
    RAISE EXCEPTION 'recogida: % no es la leída en producción (2026-11-20 y 21)', 'privado.ruta_coherente(text,text)';
  END IF;
  IF (SELECT md5(regexp_replace(regexp_replace(replace(prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) FROM pg_proc WHERE oid = 'public.es_profe_en_centro(uuid)'::regprocedure) IS DISTINCT FROM '529a7048689278ad679a9225e2f4e1e1' THEN
    RAISE EXCEPTION 'recogida: % no es la leída en producción (2026-11-20 y 21)', 'public.es_profe_en_centro(uuid)';
  END IF;
  IF (SELECT md5(regexp_replace(regexp_replace(replace(prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) FROM pg_proc WHERE oid = 'public.contenido_firmas(uuid[])'::regprocedure) IS DISTINCT FROM '3c29ea8a839e96923ec82fcb177f3c43' THEN
    RAISE EXCEPTION 'recogida: % no es la leída en producción (2026-11-20 y 21)', 'public.contenido_firmas(uuid[])';
  END IF;
  IF (SELECT md5(regexp_replace(regexp_replace(replace(prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) FROM pg_proc WHERE oid = 'public.es_profe_de_nino(uuid)'::regprocedure) IS DISTINCT FROM 'ba3d64df31679c8cf1408b7446b69798' THEN
    RAISE EXCEPTION 'recogida: % no es la leída en producción (2026-11-20 y 21)', 'public.es_profe_de_nino(uuid)';
  END IF;
  IF (SELECT md5(regexp_replace(regexp_replace(replace(prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) FROM pg_proc WHERE oid = 'public.es_tutor_legal_de(uuid)'::regprocedure) IS DISTINCT FROM '325ff04c13cc8877f7aecbbce5377d00' THEN
    RAISE EXCEPTION 'recogida: % no es la leída en producción (2026-11-20 y 21)', 'public.es_tutor_legal_de(uuid)';
  END IF;
  IF (SELECT md5(regexp_replace(regexp_replace(replace(prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) FROM pg_proc WHERE oid = 'privado.firma_bloqueada(uuid,uuid)'::regprocedure) IS DISTINCT FROM 'bf048f313b21b9c4278e5147b3891197' THEN
    RAISE EXCEPTION 'recogida: % no es la leída en producción (2026-11-20 y 21)', 'privado.firma_bloqueada(uuid,uuid)';
  END IF;
  IF (SELECT md5(regexp_replace(regexp_replace(replace(prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) FROM pg_proc WHERE oid = 'privado.centro_de_nino(uuid)'::regprocedure) IS DISTINCT FROM '7b5b55363325e117e858ab793b227073' THEN
    RAISE EXCEPTION 'recogida: % no es la leída en producción (2026-11-20 y 21)', 'privado.centro_de_nino(uuid)';
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

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'autorizaciones' AND policyname = 'autorizaciones_select'
                   AND cmd = 'SELECT' AND qual = '(usuario_es_audiencia_autorizacion_row(centro_id, tipo, es_plantilla, ambito, evento_id, nino_id, aula_id) AND (es_plantilla OR (ambito IS DISTINCT FROM ''nino''::autorizacion_ambito) OR es_admin(centro_id) OR es_profe_de_nino(nino_id) OR es_tutor_legal_de(nino_id) OR (creado_por = auth.uid()) OR privado.firmo_autorizacion(id) OR ((tipo = ''medicacion''::tipo_autorizacion) AND tiene_permiso_sobre(nino_id, ''puede_ver_info_medica''::text))))') THEN
    RAISE EXCEPTION 'recogida: la política % no es la leída en producción el 2026-11-21', 'autorizaciones_select';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'firmas_autorizacion' AND policyname = 'firmas_select'
                   AND cmd = 'SELECT' AND qual = '((firmante_id = auth.uid()) OR es_tutor_de(nino_id) OR es_profe_de_nino(nino_id) OR es_admin(privado.centro_de_nino(nino_id)))') THEN
    RAISE EXCEPTION 'recogida: la política % no es la leída en producción el 2026-11-21', 'firmas_select';
  END IF;
  IF to_regprocedure('privado.recogida_para_profe_del_centro(uuid)') IS NOT NULL
     OR to_regprocedure('public.nombres_de_recogidas(uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'recogida: alguna función nueva ya existe';
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

-- ---------------------------------------------------------------------------------------------
-- 3 · La lista, con el mismo alcance que la foto (2026-11-21). Medido antes: una profe de otra aula
-- veía la foto y no la autorización, ni sus firmas, ni la lista, ni de qué niño era. Se abre a
-- cualquier profe del centro, SOLO la recogida: la autorización, la fila de sus firmas (quién y
-- cuándo como ids, no el nombre) y, de su contenido, solo `datos` (personas, DNI escrito y la
-- referencia a la foto). El trazo, la IP, el navegador, el nombre tecleado y el comentario, no.
CREATE FUNCTION privado.recogida_para_profe_del_centro(p_autorizacion_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.autorizaciones a
     WHERE a.id = p_autorizacion_id AND a.tipo = 'recogida' AND NOT a.es_plantilla
       AND public.es_profe_en_centro(a.centro_id));
$function$;
REVOKE ALL ON FUNCTION privado.recogida_para_profe_del_centro(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION privado.recogida_para_profe_del_centro(uuid) TO authenticated;
COMMENT ON FUNCTION privado.recogida_para_profe_del_centro(uuid) IS 'Decisión de Jose del 2026-11-20 y su consecuencia del 2026-11-21 (docs/specs/altas-serie.md, «7, DECIDIDO por Jose»): CUALQUIER profe del centro consulta la recogida de cualquier niño del centro, A PROPÓSITO: la lista, el DNI escrito y la foto. «puede que la profe titular no sea la que entrega a los niños»; una foto sin la lista no sirve para comprobar quién se lleva al niño. Solo la recogida (la medicación no) y sin quién la firmó. No es un agujero; estrecharlo rompe la salida del centro.';
DROP POLICY autorizaciones_select ON public.autorizaciones;
CREATE POLICY autorizaciones_select ON public.autorizaciones AS PERMISSIVE FOR SELECT TO authenticated
  USING ((usuario_es_audiencia_autorizacion_row(centro_id, tipo, es_plantilla, ambito, evento_id, nino_id, aula_id) AND (es_plantilla OR (ambito IS DISTINCT FROM 'nino'::autorizacion_ambito) OR es_admin(centro_id) OR es_profe_de_nino(nino_id) OR es_tutor_legal_de(nino_id) OR (creado_por = auth.uid()) OR privado.firmo_autorizacion(id) OR ((tipo = 'medicacion'::tipo_autorizacion) AND tiene_permiso_sobre(nino_id, 'puede_ver_info_medica'::text)))) OR ((tipo = 'recogida'::tipo_autorizacion) AND (NOT es_plantilla) AND es_profe_en_centro(centro_id)));
COMMENT ON POLICY autorizaciones_select ON public.autorizaciones IS 'Decisión de Jose del 2026-11-20 y su consecuencia del 2026-11-21 (docs/specs/altas-serie.md, «7, DECIDIDO por Jose»): CUALQUIER profe del centro consulta la recogida de cualquier niño del centro, A PROPÓSITO: la lista, el DNI escrito y la foto. «puede que la profe titular no sea la que entrega a los niños»; una foto sin la lista no sirve para comprobar quién se lleva al niño. Solo la recogida (la medicación no) y sin quién la firmó. No es un agujero; estrecharlo rompe la salida del centro.';
DROP POLICY firmas_select ON public.firmas_autorizacion;
CREATE POLICY firmas_select ON public.firmas_autorizacion AS PERMISSIVE FOR SELECT TO authenticated
  USING (((firmante_id = auth.uid()) OR es_tutor_de(nino_id) OR es_profe_de_nino(nino_id) OR es_admin(privado.centro_de_nino(nino_id))) OR privado.recogida_para_profe_del_centro(autorizacion_id));
COMMENT ON POLICY firmas_select ON public.firmas_autorizacion IS 'Decisión de Jose del 2026-11-20 y su consecuencia del 2026-11-21 (docs/specs/altas-serie.md, «7, DECIDIDO por Jose»): CUALQUIER profe del centro consulta la recogida de cualquier niño del centro, A PROPÓSITO: la lista, el DNI escrito y la foto. «puede que la profe titular no sea la que entrega a los niños»; una foto sin la lista no sirve para comprobar quién se lleva al niño. Solo la recogida (la medicación no) y sin quién la firmó. No es un agujero; estrecharlo rompe la salida del centro.';
CREATE OR REPLACE FUNCTION public.contenido_firmas(p_firma_ids uuid[])
 RETURNS TABLE(firma_id uuid, nombre_tecleado text, firma_imagen text, ip_address inet, user_agent text, comentario text, datos jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- 2026-11-21: la profe de cualquier aula del centro recibe, de una firma de RECOGIDA, solo `datos`
  -- (la lista, el DNI escrito y la referencia a la foto); el resto le llega NULL. Los demás, como antes.
  SELECT f.id,
         CASE WHEN c.completo THEN f.nombre_tecleado END,
         CASE WHEN c.completo THEN f.firma_imagen END,
         CASE WHEN c.completo THEN f.ip_address END,
         CASE WHEN c.completo THEN f.user_agent END,
         CASE WHEN c.completo THEN f.comentario END,
         f.datos
    FROM public.firmas_autorizacion f
    CROSS JOIN LATERAL (SELECT (f.firmante_id = auth.uid()
          OR public.es_tutor_legal_de(f.nino_id)
          OR public.es_profe_de_nino(f.nino_id)
          OR public.es_admin(privado.centro_de_nino(f.nino_id))) AS completo) c
   WHERE f.id = ANY (p_firma_ids)
     AND auth.uid() IS NOT NULL
     AND NOT privado.firma_bloqueada(f.nino_id, f.firmante_id)
     AND (c.completo OR privado.recogida_para_profe_del_centro(f.autorizacion_id));
$function$;
COMMENT ON FUNCTION public.contenido_firmas(uuid[]) IS 'Decisión de Jose del 2026-11-20 y su consecuencia del 2026-11-21 (docs/specs/altas-serie.md, «7, DECIDIDO por Jose»): CUALQUIER profe del centro consulta la recogida de cualquier niño del centro, A PROPÓSITO: la lista, el DNI escrito y la foto. «puede que la profe titular no sea la que entrega a los niños»; una foto sin la lista no sirve para comprobar quién se lleva al niño. Solo la recogida (la medicación no) y sin quién la firmó. No es un agujero; estrecharlo rompe la salida del centro.';
-- El nombre del niño, SOLO a través de su recogida (2026-11-21): sin él la lista no dice de quién es.
-- No abre la ficha ni los vínculos, y no sirve para listar niños por otro camino: entra una lista de
-- autorizaciones de recogida y sale el niño de cada una, si tiene matrícula activa del curso activo
-- (los mismos que ya ve cualquier profe del centro en `listado_pase_servicios`, medido con sesión).
CREATE FUNCTION public.nombres_de_recogidas(p_autorizacion_ids uuid[])
RETURNS TABLE(autorizacion_id uuid, nino_id uuid, nombre text, apellidos text, de_mi_aula boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT a.id, n.id, n.nombre::text, n.apellidos::text, public.es_profe_de_nino(n.id)
    FROM public.autorizaciones a
    JOIN public.ninos n ON n.id = a.nino_id
   WHERE a.id = ANY (p_autorizacion_ids)
     AND auth.uid() IS NOT NULL
     AND a.tipo = 'recogida' AND NOT a.es_plantilla
     AND (public.es_profe_en_centro(a.centro_id) OR public.es_admin(a.centro_id))
     AND n.centro_id = a.centro_id AND n.deleted_at IS NULL
     AND NOT privado.nino_bloqueado(n.id)
     AND EXISTS (SELECT 1 FROM public.matriculas m
                   JOIN public.cursos_academicos cu ON cu.id = m.curso_academico_id
                  WHERE m.nino_id = n.id AND m.estado = 'activa' AND m.fecha_baja IS NULL
                    AND m.deleted_at IS NULL AND cu.centro_id = a.centro_id AND cu.estado = 'activo');
$function$;
REVOKE ALL ON FUNCTION public.nombres_de_recogidas(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nombres_de_recogidas(uuid[]) TO authenticated;
COMMENT ON FUNCTION public.nombres_de_recogidas(uuid[]) IS 'Decisión de Jose del 2026-11-20 y su consecuencia del 2026-11-21 (docs/specs/altas-serie.md, «7, DECIDIDO por Jose»): CUALQUIER profe del centro consulta la recogida de cualquier niño del centro, A PROPÓSITO: la lista, el DNI escrito y la foto. «puede que la profe titular no sea la que entrega a los niños»; una foto sin la lista no sirve para comprobar quién se lleva al niño. Solo la recogida (la medicación no) y sin quién la firmó. No es un agujero; estrecharlo rompe la salida del centro.';

DO $posterior$
BEGIN
  IF (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'autorizaciones' AND policyname = 'autorizaciones_select')
       NOT LIKE '%es_profe_en_centro(centro_id)%'
     OR (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'firmas_autorizacion' AND policyname = 'firmas_select')
       NOT LIKE '%recogida_para_profe_del_centro(autorizacion_id)%'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.contenido_firmas(uuid[])'::regprocedure) NOT LIKE '%recogida_para_profe_del_centro(f.autorizacion_id)%' THEN
    RAISE EXCEPTION 'recogida: la lista no quedó abierta a la profe del centro';
  END IF;
  IF obj_description((SELECT oid FROM pg_policy WHERE polname = 'autorizaciones_select' AND polrelid = 'public.autorizaciones'::regclass), 'pg_policy') IS DISTINCT FROM 'Decisión de Jose del 2026-11-20 y su consecuencia del 2026-11-21 (docs/specs/altas-serie.md, «7, DECIDIDO por Jose»): CUALQUIER profe del centro consulta la recogida de cualquier niño del centro, A PROPÓSITO: la lista, el DNI escrito y la foto. «puede que la profe titular no sea la que entrega a los niños»; una foto sin la lista no sirve para comprobar quién se lleva al niño. Solo la recogida (la medicación no) y sin quién la firmó. No es un agujero; estrecharlo rompe la salida del centro.'
     OR obj_description((SELECT oid FROM pg_policy WHERE polname = 'firmas_select' AND polrelid = 'public.firmas_autorizacion'::regclass), 'pg_policy') IS DISTINCT FROM 'Decisión de Jose del 2026-11-20 y su consecuencia del 2026-11-21 (docs/specs/altas-serie.md, «7, DECIDIDO por Jose»): CUALQUIER profe del centro consulta la recogida de cualquier niño del centro, A PROPÓSITO: la lista, el DNI escrito y la foto. «puede que la profe titular no sea la que entrega a los niños»; una foto sin la lista no sirve para comprobar quién se lleva al niño. Solo la recogida (la medicación no) y sin quién la firmó. No es un agujero; estrecharlo rompe la salida del centro.'
     OR obj_description('public.contenido_firmas(uuid[])'::regprocedure, 'pg_proc') IS DISTINCT FROM 'Decisión de Jose del 2026-11-20 y su consecuencia del 2026-11-21 (docs/specs/altas-serie.md, «7, DECIDIDO por Jose»): CUALQUIER profe del centro consulta la recogida de cualquier niño del centro, A PROPÓSITO: la lista, el DNI escrito y la foto. «puede que la profe titular no sea la que entrega a los niños»; una foto sin la lista no sirve para comprobar quién se lleva al niño. Solo la recogida (la medicación no) y sin quién la firmó. No es un agujero; estrecharlo rompe la salida del centro.'
     OR obj_description('public.nombres_de_recogidas(uuid[])'::regprocedure, 'pg_proc') IS DISTINCT FROM 'Decisión de Jose del 2026-11-20 y su consecuencia del 2026-11-21 (docs/specs/altas-serie.md, «7, DECIDIDO por Jose»): CUALQUIER profe del centro consulta la recogida de cualquier niño del centro, A PROPÓSITO: la lista, el DNI escrito y la foto. «puede que la profe titular no sea la que entrega a los niños»; una foto sin la lista no sirve para comprobar quién se lleva al niño. Solo la recogida (la medicación no) y sin quién la firmó. No es un agujero; estrecharlo rompe la salida del centro.'
     OR obj_description('privado.recogida_para_profe_del_centro(uuid)'::regprocedure, 'pg_proc') IS DISTINCT FROM 'Decisión de Jose del 2026-11-20 y su consecuencia del 2026-11-21 (docs/specs/altas-serie.md, «7, DECIDIDO por Jose»): CUALQUIER profe del centro consulta la recogida de cualquier niño del centro, A PROPÓSITO: la lista, el DNI escrito y la foto. «puede que la profe titular no sea la que entrega a los niños»; una foto sin la lista no sirve para comprobar quién se lleva al niño. Solo la recogida (la medicación no) y sin quién la firmó. No es un agujero; estrecharlo rompe la salida del centro.' THEN
    RAISE EXCEPTION 'recogida: la lista abierta no lleva escrito su motivo';
  END IF;
  IF has_function_privilege('anon', 'public.nombres_de_recogidas(uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'privado.recogida_para_profe_del_centro(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.nombres_de_recogidas(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'recogida: privilegios de las funciones nuevas';
  END IF;
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
