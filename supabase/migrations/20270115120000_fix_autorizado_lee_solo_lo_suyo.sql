-- El autorizado lee solo lo suyo (2026-11-11). Spec: docs/specs/altas-serie.md, «El autorizado: lo
-- que ve y lo que no». Decisiones del responsable del 2026-11-11.
--
-- Medido ABIERTO en producción el 2026-11-11 (ensayo terminado en RAISE, con un vínculo de autorizado
-- con todos los permisos a falso simulado dentro): el autorizado leía la fila entera de `ninos`
-- (`notas_admin`, DNI, observaciones, dirección…), la firma del tutor legal (trazo, IP, navegador y
-- el DNI de la persona autorizada en `datos`), la recogida que creó el tutor legal, la medicación
-- administrada sin permiso médico y la foto del DNI de recogida. Las políticas eran `es_tutor_de`
-- (cualquier vínculo vivo) sin mirar ningún permiso, y la tabla no tenía permisos por columna.
--
-- Lo que hace, con el mecanismo de `matriculas.motivo_baja` (ADR-0053, `20261009120000`):
--   1. `ninos`: la sesión solo lee las columnas de identidad. Las 14 de gestión (notas de Dirección,
--      DNI, observaciones, dirección con la provincia, estado civil, libro de familia, hermanos y «cómo
--      nos conoció») salen por `ficha_gestion_ninos`, de la Dirección del centro y del tutor legal. Ni
--      la profe ni el autorizado. `puede_exportar_nino` es la puerta de la exportación del niño.
--   2. `firmas_autorizacion` (opción b): la fila se sigue viendo (quién firmó, qué decidió y cuándo:
--      el estado de una autorización), pero el trazo, la IP, el navegador, el nombre tecleado, el
--      comentario y `datos` salen por `contenido_firmas`: de quien firmó, del tutor legal, de la profe
--      del niño y de la Dirección. No del autorizado sobre firmas de otros.
--   3. `autorizaciones` de ámbito niño: el autorizado ve las que creó o firmó, y las de medicación con
--      `puede_ver_info_medica`. Las de otros, no.
--   4. `administraciones_medicacion`: la familia, con `puede_ver_info_medica`, como la ficha médica.
--   5. `recogida-adjuntos`: el tutor legal, o quien subió el fichero.
--
-- ORDEN: mergear → esperar el despliegue → aplicar. La app de antes lee las columnas cerradas con la
-- sesión: con la migración antes que la app, esas pantallas fallarían.
-- Sin COMMIT ni BEGIN: el SQL Editor la envuelve en su transacción.

-- ─────────────────────────────────────────────────────────────── guarda previa
DO $guarda$
DECLARE
  v text;
BEGIN
  SELECT string_agg(attname, ',' ORDER BY attname) INTO v
    FROM pg_attribute WHERE attrelid = 'public.ninos'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v IS DISTINCT FROM 'apellidos,centro_id,como_nos_conocio,como_nos_conocio_otro,created_at,deleted_at,deleted_reason,direccion_calle,direccion_ciudad,direccion_cp,direccion_numero,direccion_provincia,dni,estado_civil_familia,familia_id,fecha_nacimiento,foto_url,hermanos_lugar,hermanos_total,id,idioma_principal,libro_familia_path,lugar_nacimiento,nacionalidad,nombre,notas_admin,observaciones_familia,primer_apellido,puede_aparecer_en_fotos,purgado_en,requiere_ambos_firmantes,segundo_apellido,sexo,updated_at' THEN
    RAISE EXCEPTION 'ninos no tiene las columnas esperadas: %', v;
  END IF;

  SELECT string_agg(attname, ',' ORDER BY attname) INTO v
    FROM pg_attribute WHERE attrelid = 'public.firmas_autorizacion'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v IS DISTINCT FROM 'autorizacion_id,comentario,created_at,datos,decision,firma_imagen,firmado_at,firmante_id,id,ip_address,metodo_firma,nino_id,nombre_tecleado,rol_firmante,texto_hash,texto_version,user_agent' THEN
    RAISE EXCEPTION 'firmas_autorizacion no tiene las columnas esperadas: %', v;
  END IF;

  -- Las dos tablas, con el SELECT de tabla y sin permisos por columna: lo que se mide aquí.
  IF NOT has_table_privilege('authenticated', 'public.ninos', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.firmas_autorizacion', 'SELECT')
     OR EXISTS (SELECT 1 FROM pg_attribute
                 WHERE attrelid IN ('public.ninos'::regclass, 'public.firmas_autorizacion'::regclass)
                   AND attacl IS NOT NULL) THEN
    RAISE EXCEPTION 'ninos o firmas_autorizacion no tienen los privilegios esperados';
  END IF;

  -- Las cuatro políticas que se reescriben, tal como están vivas.
  IF (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'autorizaciones' AND policyname = 'autorizaciones_select')
       IS DISTINCT FROM 'usuario_es_audiencia_autorizacion_row(centro_id, tipo, es_plantilla, ambito, evento_id, nino_id, aula_id)'
  OR (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'administraciones_medicacion' AND policyname = 'adm_med_select')
       IS DISTINCT FROM '(es_admin(centro_id) OR es_profe_de_nino(nino_id) OR es_tutor_de(nino_id))'
  OR (SELECT qual FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'recogida_adjuntos_select_tutor')
       IS DISTINCT FROM '((bucket_id = ''recogida-adjuntos''::text) AND es_tutor_de(((storage.foldername(name))[2])::uuid) AND privado.ruta_coherente(bucket_id, name))'
  OR (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'firmas_autorizacion' AND policyname = 'firmas_select')
       IS DISTINCT FROM '((firmante_id = auth.uid()) OR es_tutor_de(nino_id) OR es_profe_de_nino(nino_id) OR es_admin(privado.centro_de_nino(nino_id)))'
  THEN
    RAISE EXCEPTION 'alguna política no es la esperada';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc
              WHERE proname IN ('ficha_gestion_ninos', 'puede_exportar_nino', 'contenido_firmas', 'firmo_autorizacion')) THEN
    RAISE EXCEPTION 'alguna función nueva ya existe';
  END IF;
END
$guarda$;

-- ─────────────────────────────────────────────────────────────── 1. ninos
REVOKE SELECT ON public.ninos FROM PUBLIC, anon, authenticated;

-- Las columnas de identidad: las lee la sesión, con la RLS de siempre (Dirección, la profe del niño,
-- cualquier vínculo). Cada columna nueva de `ninos` necesita su GRANT SELECT (columna), o su sitio en
-- `ficha_gestion_ninos`.
GRANT SELECT (
  id,
  centro_id,
  familia_id,
  nombre,
  primer_apellido,
  segundo_apellido,
  apellidos,
  fecha_nacimiento,
  sexo,
  nacionalidad,
  lugar_nacimiento,
  idioma_principal,
  foto_url,
  puede_aparecer_en_fotos,
  requiere_ambos_firmantes,
  created_at,
  updated_at,
  deleted_at,
  deleted_reason,
  purgado_en
) ON public.ninos TO authenticated;

-- Las 14 de gestión, de la Dirección del centro y del tutor legal. Las filas que quien llama no
-- puede leer no salen (ni error): así la app distingue la ausencia (no le toca) del fallo (error).
CREATE FUNCTION public.ficha_gestion_ninos(p_nino_ids uuid[])
RETURNS TABLE (
  nino_id uuid,
  notas_admin text,
  dni text,
  observaciones_familia text,
  direccion_calle text,
  direccion_numero text,
  direccion_cp text,
  direccion_ciudad text,
  direccion_provincia text,
  estado_civil_familia public.estado_civil,
  libro_familia_path text,
  hermanos_total smallint,
  hermanos_lugar smallint,
  como_nos_conocio text,
  como_nos_conocio_otro text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT n.id, n.notas_admin, n.dni, n.observaciones_familia, n.direccion_calle, n.direccion_numero,
         n.direccion_cp, n.direccion_ciudad, n.direccion_provincia, n.estado_civil_familia,
         n.libro_familia_path, n.hermanos_total, n.hermanos_lugar, n.como_nos_conocio,
         n.como_nos_conocio_otro
    FROM public.ninos n
   WHERE n.id = ANY (p_nino_ids)
     AND auth.uid() IS NOT NULL
     AND (public.es_admin(n.centro_id) OR public.es_tutor_legal_de(n.id));
$function$;

REVOKE ALL ON FUNCTION public.ficha_gestion_ninos(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ficha_gestion_ninos(uuid[]) TO authenticated;

-- La exportación del niño (art. 15): la Dirección del centro, la profe del niño (su exportación por
-- sesión, sin las columnas de gestión) y el tutor legal. El autorizado, no.
CREATE FUNCTION public.puede_exportar_nino(p_nino_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND privado.centro_de_nino(p_nino_id) IS NOT NULL
     AND (public.es_admin(privado.centro_de_nino(p_nino_id))
          OR public.es_profe_de_nino(p_nino_id)
          OR public.es_tutor_legal_de(p_nino_id));
$function$;

REVOKE ALL ON FUNCTION public.puede_exportar_nino(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.puede_exportar_nino(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────── 2. firmas_autorizacion (b)
REVOKE SELECT ON public.firmas_autorizacion FROM PUBLIC, anon, authenticated;

-- Quién firmó, qué decidió y cuándo: el estado de una autorización, para todos los que ven la fila.
GRANT SELECT (
  id,
  autorizacion_id,
  nino_id,
  firmante_id,
  rol_firmante,
  decision,
  texto_hash,
  texto_version,
  metodo_firma,
  firmado_at,
  created_at
) ON public.firmas_autorizacion TO authenticated;

-- El contenido de la firma: quien firmó, el tutor legal del niño, la profe del niño y la Dirección.
-- Respeta el bloqueo de la retención (`privado.firma_bloqueada`), como la política RESTRICTIVE.
CREATE FUNCTION public.contenido_firmas(p_firma_ids uuid[])
RETURNS TABLE (
  firma_id uuid,
  nombre_tecleado text,
  firma_imagen text,
  ip_address inet,
  user_agent text,
  comentario text,
  datos jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT f.id, f.nombre_tecleado, f.firma_imagen, f.ip_address, f.user_agent, f.comentario, f.datos
    FROM public.firmas_autorizacion f
   WHERE f.id = ANY (p_firma_ids)
     AND auth.uid() IS NOT NULL
     AND NOT privado.firma_bloqueada(f.nino_id, f.firmante_id)
     AND (f.firmante_id = auth.uid()
          OR public.es_tutor_legal_de(f.nino_id)
          OR public.es_profe_de_nino(f.nino_id)
          OR public.es_admin(privado.centro_de_nino(f.nino_id)));
$function$;

REVOKE ALL ON FUNCTION public.contenido_firmas(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contenido_firmas(uuid[]) TO authenticated;

-- ─────────────────────────────────────────────────────────────── 3. autorizaciones de ámbito niño
-- ¿Firmó quien llama esta autorización? Lee `firmas_autorizacion` (otra tabla: sin el problema de
-- MVCC de `INSERT … RETURNING` sobre `autorizaciones`).
CREATE FUNCTION privado.firmo_autorizacion(p_autorizacion_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.firmas_autorizacion
                  WHERE autorizacion_id = p_autorizacion_id AND firmante_id = auth.uid());
$function$;

REVOKE ALL ON FUNCTION privado.firmo_autorizacion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION privado.firmo_autorizacion(uuid) TO authenticated;

DROP POLICY autorizaciones_select ON public.autorizaciones;
CREATE POLICY autorizaciones_select ON public.autorizaciones
  FOR SELECT TO authenticated
  USING (
    public.usuario_es_audiencia_autorizacion_row(centro_id, tipo, es_plantilla, ambito, evento_id, nino_id, aula_id)
    AND (
      es_plantilla
      OR ambito IS DISTINCT FROM 'nino'::public.autorizacion_ambito
      OR public.es_admin(centro_id)
      OR public.es_profe_de_nino(nino_id)
      OR public.es_tutor_legal_de(nino_id)
      OR creado_por = auth.uid()
      OR privado.firmo_autorizacion(id)
      OR (tipo = 'medicacion'::public.tipo_autorizacion
          AND public.tiene_permiso_sobre(nino_id, 'puede_ver_info_medica'))
    )
  );

-- ─────────────────────────────────────────────────────────────── 4. medicación administrada
DROP POLICY adm_med_select ON public.administraciones_medicacion;
CREATE POLICY adm_med_select ON public.administraciones_medicacion
  FOR SELECT TO authenticated
  USING (
    public.es_admin(centro_id)
    OR public.es_profe_de_nino(nino_id)
    OR public.tiene_permiso_sobre(nino_id, 'puede_ver_info_medica')
  );

-- ─────────────────────────────────────────────────────────────── 5. fotos del DNI de recogida
DROP POLICY recogida_adjuntos_select_tutor ON storage.objects;
CREATE POLICY recogida_adjuntos_select_tutor ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'recogida-adjuntos'
    AND (public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid)
         OR (owner_id = (auth.uid())::text
             AND public.es_tutor_de(((storage.foldername(name))[2])::uuid)))
    AND privado.ruta_coherente(bucket_id, name)
  );

-- ─────────────────────────────────────────────────────────────── guarda posterior
DO $guarda$
DECLARE
  c text;
BEGIN
  IF has_table_privilege('authenticated', 'public.ninos', 'SELECT')
     OR has_table_privilege('authenticated', 'public.firmas_autorizacion', 'SELECT') THEN
    RAISE EXCEPTION 'la sesión sigue con el SELECT de tabla';
  END IF;

  FOREACH c IN ARRAY ARRAY['notas_admin','dni','observaciones_familia','direccion_calle','direccion_numero',
      'direccion_cp','direccion_ciudad','direccion_provincia','estado_civil_familia','libro_familia_path',
      'hermanos_total','hermanos_lugar','como_nos_conocio','como_nos_conocio_otro'] LOOP
    IF has_column_privilege('authenticated', 'public.ninos', c, 'SELECT') THEN
      RAISE EXCEPTION 'ninos.% sigue legible por la sesión', c;
    END IF;
  END LOOP;
  FOREACH c IN ARRAY ARRAY['nombre_tecleado','firma_imagen','ip_address','user_agent','comentario','datos'] LOOP
    IF has_column_privilege('authenticated', 'public.firmas_autorizacion', c, 'SELECT') THEN
      RAISE EXCEPTION 'firmas_autorizacion.% sigue legible por la sesión', c;
    END IF;
  END LOOP;

  -- Las columnas abiertas: 20 de ninos y 11 de firmas, ni una más ni una menos.
  IF (SELECT count(*) FROM pg_attribute
       WHERE attrelid = 'public.ninos'::regclass AND attnum > 0 AND NOT attisdropped
         AND has_column_privilege('authenticated', 'public.ninos', attname, 'SELECT')) <> 20
  OR (SELECT count(*) FROM pg_attribute
       WHERE attrelid = 'public.firmas_autorizacion'::regclass AND attnum > 0 AND NOT attisdropped
         AND has_column_privilege('authenticated', 'public.firmas_autorizacion', attname, 'SELECT')) <> 11 THEN
    RAISE EXCEPTION 'las columnas abiertas no son las esperadas';
  END IF;

  -- Las funciones nuevas: SECURITY DEFINER, nada para anon ni PUBLIC.
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.oid IN ('public.ficha_gestion_ninos(uuid[])'::regprocedure,
                              'public.puede_exportar_nino(uuid)'::regprocedure,
                              'public.contenido_firmas(uuid[])'::regprocedure,
                              'privado.firmo_autorizacion(uuid)'::regprocedure)
                AND (NOT p.prosecdef
                     OR has_function_privilege('anon', p.oid, 'EXECUTE')
                     OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'alguna función nueva no tiene la forma esperada';
  END IF;

  -- Ninguna política de las cuatro deja ya a `es_tutor_de` solo.
  IF (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'administraciones_medicacion' AND policyname = 'adm_med_select') LIKE '%es_tutor_de(%'
  OR (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'autorizaciones' AND policyname = 'autorizaciones_select') NOT LIKE '%es_tutor_legal_de(nino_id)%'
  OR (SELECT qual FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'recogida_adjuntos_select_tutor') NOT LIKE '%owner_id%' THEN
    RAISE EXCEPTION 'alguna política no quedó como se esperaba';
  END IF;

  RAISE NOTICE 'autorizado: vínculos de autorizado vivos hoy = %, firmas = %, objetos de recogida = %',
    (SELECT count(*) FROM public.vinculos_familiares WHERE tipo_vinculo = 'autorizado' AND deleted_at IS NULL),
    (SELECT count(*) FROM public.firmas_autorizacion),
    (SELECT count(*) FROM storage.objects WHERE bucket_id = 'recogida-adjuntos');
END
$guarda$;
