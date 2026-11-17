-- Las cuatro de gravedad media y baja, segunda de dos (2026-11-17). Spec: docs/specs/altas-serie.md,
-- «Las cuatro de gravedad media y baja». Medido ABIERTO en producción el 2026-11-16 (ensayo terminado
-- en RAISE, 21/21): el autorizado leía el trazo, la IP, el navegador y el nombre tecleado de las firmas
-- de los documentos del centro, los acuses del alta y las confirmaciones de los eventos, y confirmaba.
--
--   1. `firmas_documentos_centro` (opción b, el criterio de `firmas_autorizacion`): la fila se sigue
--      viendo (quién firmó, en calidad de qué y cuándo), pero el trazo, la IP, el navegador y el nombre
--      tecleado salen por `contenido_firmas_documentos` (de la primera, `20270125120000`).
--   2. `confirmaciones_evento` (C, decisión de Jose del 2026-11-13: «solo confirman los padres»; la
--      ADR-0038 queda sustituida): confirma y lee las confirmaciones el tutor legal del niño, no el
--      autorizado. La profe del niño y la Dirección las siguen leyendo.
--   3. `acuses_alta` (decisión del responsable del 2026-11-16: «El acuse del alta es el registro de lo
--      que la familia recibió y aceptó, y el autorizado no pinta nada ahí»): el tutor legal y la
--      Dirección.
--   `matriculas` se queda abierta (decidido el 2026-11-16): no se toca aquí.
--
-- ORDEN: aplicada la primera → mergear esta con la app → esperar el despliegue → aplicar esta. La app
-- de antes lee las cuatro columnas de la tabla en la exportación del niño y la del usuario: con esta
-- antes que la app nueva, esas exportaciones fallarían. Sin COMMIT ni BEGIN: el SQL Editor la envuelve
-- en su transacción.

-- ─────────────────────────────────────────────────────────────── guarda previa
DO $guarda$
DECLARE
  v text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20270125120000') THEN
    RAISE EXCEPTION 'falta la 20270125120000 en el registro: aplica antes la primera';
  END IF;

  SELECT string_agg(attname, ',' ORDER BY attname) INTO v
    FROM pg_attribute WHERE attrelid = 'public.firmas_documentos_centro'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v IS DISTINCT FROM 'centro_id,curso_academico_id,curso_nombre,documento_id,firma_imagen,firmado_at,firmante_id,id,ip_address,metodo_firma,nino_id,nombre_tecleado,numero,rol_firmante,sha256,titulo,user_agent,version_id' THEN
    RAISE EXCEPTION 'firmas_documentos_centro no tiene las columnas esperadas: %', v;
  END IF;

  -- La tabla, con el SELECT de tabla y sin permisos por columna: lo que se midió.
  IF NOT has_table_privilege('authenticated', 'public.firmas_documentos_centro', 'SELECT')
     OR EXISTS (SELECT 1 FROM pg_attribute
                 WHERE attrelid = 'public.firmas_documentos_centro'::regclass AND attacl IS NOT NULL) THEN
    RAISE EXCEPTION 'firmas_documentos_centro no tiene los privilegios esperados';
  END IF;

  -- La primera, aplicada: la función con su cuerpo exacto (md5 de la lógica normalizada, leído en
  -- producción el 2026-11-17) y su forma.
  IF to_regprocedure('public.contenido_firmas_documentos(uuid[])') IS NULL THEN
    RAISE EXCEPTION 'falta public.contenido_firmas_documentos(uuid[]): aplica antes 20270125120000';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.contenido_firmas_documentos(uuid[])')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM '8e8d18a6b40da774ec3dac74da74d9bc' THEN
    RAISE EXCEPTION 'public.contenido_firmas_documentos no es la de 20270125120000';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.contenido_firmas_documentos(uuid[])'))
     OR has_function_privilege('anon', to_regprocedure('public.contenido_firmas_documentos(uuid[])'), 'EXECUTE')
     OR NOT has_function_privilege('authenticated', to_regprocedure('public.contenido_firmas_documentos(uuid[])'), 'EXECUTE') THEN
    RAISE EXCEPTION 'public.contenido_firmas_documentos no tiene la forma esperada';
  END IF;

  -- Las cuatro políticas que se reescriben, tal como están vivas.
  IF (SELECT with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'confirmaciones_evento' AND policyname = 'confirmaciones_insert')
       IS DISTINCT FROM '(es_tutor_de(nino_id) AND (confirmado_por = auth.uid()) AND privado.evento_aplica_a_nino(evento_id, nino_id))'
  OR (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'confirmaciones_evento' AND policyname = 'confirmaciones_select')
       IS DISTINCT FROM '(es_tutor_de(nino_id) OR es_profe_de_nino(nino_id) OR es_admin(privado.centro_de_nino(nino_id)))'
  OR (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'confirmaciones_evento' AND policyname = 'confirmaciones_update')
       IS DISTINCT FROM 'es_tutor_de(nino_id)'
  OR (SELECT with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'confirmaciones_evento' AND policyname = 'confirmaciones_update')
       IS DISTINCT FROM '(es_tutor_de(nino_id) AND (confirmado_por = auth.uid()) AND privado.evento_aplica_a_nino(evento_id, nino_id))'
  OR (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'acuses_alta' AND policyname = 'acuses_alta_select')
       IS DISTINCT FROM '(es_tutor_de(nino_id) OR es_admin(centro_id))'
  THEN
    RAISE EXCEPTION 'alguna política no es la esperada';
  END IF;

  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('confirmaciones_evento', 'acuses_alta')) <> 5 THEN
    RAISE EXCEPTION 'confirmaciones_evento y acuses_alta no tienen las 5 políticas esperadas';
  END IF;
END
$guarda$;

-- ─────────────────────────────────────────────────────────────── 1. firmas_documentos_centro (b)
REVOKE SELECT ON public.firmas_documentos_centro FROM PUBLIC, anon, authenticated;

-- Quién firmó, qué firmó, en calidad de qué y cuándo: para todos los que ven la fila. Cada columna
-- nueva de la tabla necesita su GRANT SELECT (columna), o su sitio en `contenido_firmas_documentos`.
GRANT SELECT (
  id,
  version_id,
  documento_id,
  centro_id,
  nino_id,
  firmante_id,
  rol_firmante,
  metodo_firma,
  titulo,
  numero,
  sha256,
  curso_academico_id,
  curso_nombre,
  firmado_at
) ON public.firmas_documentos_centro TO authenticated;

-- ─────────────────────────────────────────────────────────────── 2. confirmaciones_evento (C)
DROP POLICY confirmaciones_select ON public.confirmaciones_evento;
CREATE POLICY confirmaciones_select ON public.confirmaciones_evento
  FOR SELECT TO authenticated
  USING (
    public.es_tutor_legal_de(nino_id)
    OR public.es_profe_de_nino(nino_id)
    OR public.es_admin(privado.centro_de_nino(nino_id))
  );

DROP POLICY confirmaciones_insert ON public.confirmaciones_evento;
CREATE POLICY confirmaciones_insert ON public.confirmaciones_evento
  FOR INSERT TO authenticated
  WITH CHECK (
    public.es_tutor_legal_de(nino_id)
    AND confirmado_por = auth.uid()
    AND privado.evento_aplica_a_nino(evento_id, nino_id)
  );

DROP POLICY confirmaciones_update ON public.confirmaciones_evento;
CREATE POLICY confirmaciones_update ON public.confirmaciones_evento
  FOR UPDATE TO authenticated
  USING (public.es_tutor_legal_de(nino_id))
  WITH CHECK (
    public.es_tutor_legal_de(nino_id)
    AND confirmado_por = auth.uid()
    AND privado.evento_aplica_a_nino(evento_id, nino_id)
  );

-- ─────────────────────────────────────────────────────────────── 3. acuses_alta
DROP POLICY acuses_alta_select ON public.acuses_alta;
CREATE POLICY acuses_alta_select ON public.acuses_alta
  FOR SELECT TO authenticated
  USING (public.es_tutor_legal_de(nino_id) OR public.es_admin(centro_id));

-- ─────────────────────────────────────────────────────────────── guarda posterior
DO $guarda$
DECLARE
  c text;
BEGIN
  IF has_table_privilege('authenticated', 'public.firmas_documentos_centro', 'SELECT') THEN
    RAISE EXCEPTION 'la sesión sigue con el SELECT de tabla de firmas_documentos_centro';
  END IF;

  FOREACH c IN ARRAY ARRAY['nombre_tecleado','firma_imagen','ip_address','user_agent'] LOOP
    IF has_column_privilege('authenticated', 'public.firmas_documentos_centro', c, 'SELECT') THEN
      RAISE EXCEPTION 'firmas_documentos_centro.% sigue legible por la sesión', c;
    END IF;
  END LOOP;

  -- Las columnas abiertas: 14, ni una más ni una menos.
  IF (SELECT count(*) FROM pg_attribute
       WHERE attrelid = 'public.firmas_documentos_centro'::regclass AND attnum > 0 AND NOT attisdropped
         AND has_column_privilege('authenticated', 'public.firmas_documentos_centro', attname, 'SELECT')) <> 14 THEN
    RAISE EXCEPTION 'las columnas abiertas de firmas_documentos_centro no son las esperadas';
  END IF;

  -- Ninguna de las cuatro políticas deja ya a `es_tutor_de` (cualquier vínculo).
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename IN ('confirmaciones_evento', 'acuses_alta')
                AND (coalesce(qual, '') LIKE '%es_tutor_de(%' OR coalesce(with_check, '') LIKE '%es_tutor_de(%'))
  OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('confirmaciones_evento', 'acuses_alta')) <> 5 THEN
    RAISE EXCEPTION 'alguna política no quedó como se esperaba';
  END IF;

  RAISE NOTICE 'gravedad media: vínculos de autorizado vivos = %, confirmaciones = %, acuses = %, firmas de documentos = %',
    (SELECT count(*) FROM public.vinculos_familiares WHERE tipo_vinculo = 'autorizado' AND deleted_at IS NULL),
    (SELECT count(*) FROM public.confirmaciones_evento),
    (SELECT count(*) FROM public.acuses_alta),
    (SELECT count(*) FROM public.firmas_documentos_centro);
END
$guarda$;
