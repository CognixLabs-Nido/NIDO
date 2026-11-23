-- El mandato SEPA como prueba, migración 2 (2026-11-22): cierra. Después del despliegue de #543.
-- Spec: docs/specs/mandato-sepa-cierre.md, «La migración 2». Medido abierto antes en producción
-- (ensayo terminado en RAISE).
--
-- 1. El bucket `mandato-sepa` pierde las políticas de actualizar y borrar, y la de subir por la ruta
--    del niño (los mandatos nuevos van por la de la familia).
-- 2. Ningún PDF del bucket cambia, tampoco para service_role, como los documentos del centro. Un PDF
--    que nombra un mandato solo lo borra service_role (la anulación del alta y la destrucción
--    fiscal, que borran el fichero antes que la fila).
-- 3. De la fila del mandato solo cambia el estado, por sus transiciones, y `nino_id` a NULL (lo
--    pone anular_alta; no entra en el sello). Borrar, solo con el marcador de los borrados sin
--    copia, sin humano.
-- 4. Un mandato digital nuevo es v3. El presencial sigue v2: no tiene PDF, la prueba es el papel.
--
-- `postgres` conserva la llave sobre los tres triggers (docs/architecture/rls-policies.md, «La
-- llave de postgres»).

-- ============================================================================ guarda previa
DO $guarda$
DECLARE
  v_md5 text;
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20270203120000') THEN
    RAISE EXCEPTION 'mandato 2: falta la migración 1 (20270203120000)';
  END IF;
  -- Las políticas que se quitan y las que se quedan, como se leyeron en producción (2026-11-22).
  FOR r IN SELECT * FROM (VALUES
      ('mandato_sepa_delete', '0090da168adb521c8cda4d91b60d325c'),
      ('mandato_sepa_insert', '3c5fb80f5e650770352876e63dedecc4'),
      ('mandato_sepa_insert_familia', 'a519d1f3667cbe388b237a52ebd837f7'),
      ('mandato_sepa_select', '2b966b14dbf72d28b09e0f2bcdb4ad72'),
      ('mandato_sepa_select_familia', 'ba9eacdf8bc32dea4320b53e4f6441f4'),
      ('mandato_sepa_update', 'dd4c01a14a0873022940de36f8da0f9b'),
      ('mandato_sepa_update_familia', 'b19d10af47c75fb90ed180680fceb639')) AS t(nombre, md5)
  LOOP
    SELECT md5(cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')) INTO v_md5
      FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = r.nombre;
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'mandato 2: la política % no es la leída en producción (2026-11-22)', r.nombre;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname LIKE 'mandato_sepa%') <> 7 THEN
    RAISE EXCEPTION 'mandato 2: el bucket tiene otras políticas que las 7 leídas';
  END IF;
  -- Las funciones de las que dependen los triggers: las que ponen el marcador de borrar, la que
  -- cambia el estado, y el trigger del v1, que dispara antes.
  FOR r IN SELECT * FROM (VALUES
      ('public.anular_alta(uuid,uuid,text)', 'b7501717b6a3b37d3a6dae0d7f5c8a7c'),
      ('public.destruir_fiscal_familia(uuid,integer)', '58c7f0e940ced0a4be8a6361c3c4d332'),
      ('public.decidir_mandato_propuesto(uuid,boolean)', 'a92bfa533876e45eb0b2b210e631ea76'),
      ('privado.mandato_v1_cerrado()', '9da0e4be5782ae195540311d1d68deaa')) AS t(f, md5)
  LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f);
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'mandato 2: % no es la leída en producción (2026-11-22)', r.f;
    END IF;
  END LOOP;
  -- El estado tiene los cuatro valores que el trigger conoce.
  IF (SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_enum e
       WHERE e.enumtypid = 'public.estado_mandato_sepa'::regtype) IS DISTINCT FROM 'activo,revocado,propuesto,rechazado' THEN
    RAISE EXCEPTION 'mandato 2: estado_mandato_sepa no tiene los cuatro valores leídos';
  END IF;
  -- Nada de esta migración existe todavía.
  IF to_regprocedure('privado.mandato_sepa_objeto_defensa()') IS NOT NULL
     OR to_regprocedure('privado.mandato_sepa_firma_inmutable()') IS NOT NULL
     OR to_regprocedure('privado.mandato_sepa_digital_v3()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('mandato_sepa_objeto_defensa', 'zz_firma_inmutable', 'zz_digital_v3')) THEN
    RAISE EXCEPTION 'mandato 2: ya está aplicada (o a medias)';
  END IF;
END
$guarda$;

-- ============================================================================ 1 · el bucket
DROP POLICY mandato_sepa_update ON storage.objects;
DROP POLICY mandato_sepa_update_familia ON storage.objects;
DROP POLICY mandato_sepa_delete ON storage.objects;
DROP POLICY mandato_sepa_insert ON storage.objects;

-- ============================================================================ 2 · el PDF no cambia
CREATE FUNCTION privado.mandato_sepa_objeto_defensa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_ignorar text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- El huérfano (ninguna fila lo nombra) se borra: lo barre el cron. El que nombra un mandato,
    -- solo service_role, que lo borra antes que la fila.
    IF EXISTS (SELECT 1 FROM public.mandatos_sepa m WHERE m.documento_path = OLD.name)
       AND auth.role() IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'el PDF de un mandato solo lo borra el servidor, al borrar el mandato'
        USING ERRCODE = 'P0001', HINT = 'pdf_mandato_solo_servidor';
    END IF;
    RETURN OLD;
  END IF;
  -- UPDATE: nada cambia, para nadie. Deja pasar lo que toca la lectura y las columnas generadas.
  SELECT coalesce(array_agg(a.attname::text), '{}') INTO v_ignorar FROM pg_attribute a
   WHERE a.attrelid = TG_RELID AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated <> '';
  v_ignorar := v_ignorar || ARRAY['updated_at', 'last_accessed_at'];
  IF (to_jsonb(NEW) - v_ignorar) IS DISTINCT FROM (to_jsonb(OLD) - v_ignorar) THEN
    RAISE EXCEPTION 'el PDF de un mandato no cambia nunca: una firma nueva es un fichero nuevo'
      USING ERRCODE = 'P0001', HINT = 'pdf_mandato_inmutable';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION privado.mandato_sepa_objeto_defensa() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER mandato_sepa_objeto_defensa
  BEFORE UPDATE OR DELETE ON storage.objects
  FOR EACH ROW WHEN (OLD.bucket_id = 'mandato-sepa')
  EXECUTE FUNCTION privado.mandato_sepa_objeto_defensa();
COMMENT ON FUNCTION privado.mandato_sepa_objeto_defensa() IS
  '2026-11-22, decisión 1 del cierre del mandato: nadie sobrescribe ni borra la prueba. Ningún objeto del bucket mandato-sepa cambia, para nadie salvo postgres; el que nombra un mandato solo lo borra service_role.';

-- ============================================================================ 3 · la fila
CREATE FUNCTION privado.mandato_sepa_firma_inmutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.borrar_sin_copia', true) IS DISTINCT FROM 'on' OR auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'un mandato solo se borra con la anulación del alta o la destrucción por plazo'
        USING ERRCODE = 'P0001', HINT = 'borrar_solo_por_plazo';
    END IF;
    RETURN OLD;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['estado', 'updated_at', 'nino_id'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['estado', 'updated_at', 'nino_id'])
     OR (NEW.nino_id IS DISTINCT FROM OLD.nino_id AND NEW.nino_id IS NOT NULL) THEN
    RAISE EXCEPTION 'una firma no cambia: del mandato solo cambia el estado'
      USING ERRCODE = 'P0001', HINT = 'mandato_inmutable';
  END IF;
  IF NEW.estado IS DISTINCT FROM OLD.estado
     AND (OLD.estado::text, NEW.estado::text) NOT IN
         (('activo', 'revocado'), ('propuesto', 'activo'), ('propuesto', 'rechazado')) THEN
    RAISE EXCEPTION 'un mandato no pasa de % a %', OLD.estado, NEW.estado
      USING ERRCODE = 'P0001', HINT = 'transicion_no_valida';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION privado.mandato_sepa_firma_inmutable() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER zz_firma_inmutable
  BEFORE UPDATE OR DELETE ON public.mandatos_sepa
  FOR EACH ROW EXECUTE FUNCTION privado.mandato_sepa_firma_inmutable();
COMMENT ON FUNCTION privado.mandato_sepa_firma_inmutable() IS
  '2026-11-22, decisión 3 del cierre del mandato (el criterio de la fase 3): una firma no cambia. Solo el estado (activo→revocado, propuesto→activo, propuesto→rechazado) y nino_id a NULL; borrar, con app.borrar_sin_copia y sin humano.';

-- ============================================================================ 4 · el digital es v3
CREATE FUNCTION privado.mandato_sepa_digital_v3()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.metodo_firma = 'digital' AND NEW.version_canonico IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'un mandato digital nuevo es v3: lleva el PDF que compone el servidor'
      USING ERRCODE = 'P0001', HINT = 'digital_v3';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION privado.mandato_sepa_digital_v3() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER zz_digital_v3
  BEFORE INSERT ON public.mandatos_sepa
  FOR EACH ROW EXECUTE FUNCTION privado.mandato_sepa_digital_v3();
COMMENT ON FUNCTION privado.mandato_sepa_digital_v3() IS
  '2026-11-22, cierre del mandato: un mandato digital nuevo es v3 (el PDF del servidor atado al sello). El presencial sigue v2: no tiene PDF, la prueba es el papel.';

-- ============================================================================ guarda posterior
DO $guarda$
BEGIN
  IF (SELECT string_agg(policyname, ',' ORDER BY policyname) FROM pg_policies
       WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'mandato_sepa%')
     IS DISTINCT FROM 'mandato_sepa_insert_familia,mandato_sepa_select,mandato_sepa_select_familia' THEN
    RAISE EXCEPTION 'mandato 2: el bucket no se quedó con las tres políticas';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
              AND cmd IN ('UPDATE', 'DELETE', 'ALL')
              AND (coalesce(qual, '') LIKE '%mandato-sepa%' OR coalesce(with_check, '') LIKE '%mandato-sepa%')) THEN
    RAISE EXCEPTION 'mandato 2: queda una política que cambia o borra objetos del bucket';
  END IF;
  IF (SELECT pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text FROM pg_trigger t
       WHERE t.tgrelid = 'storage.objects'::regclass AND t.tgname = 'mandato_sepa_objeto_defensa')
     IS DISTINCT FROM 'CREATE TRIGGER mandato_sepa_objeto_defensa BEFORE DELETE OR UPDATE ON storage.objects FOR EACH ROW WHEN ((old.bucket_id = ''mandato-sepa''::text)) EXECUTE FUNCTION privado.mandato_sepa_objeto_defensa() O'
  OR (SELECT pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text FROM pg_trigger t
       WHERE t.tgrelid = 'public.mandatos_sepa'::regclass AND t.tgname = 'zz_firma_inmutable')
     IS DISTINCT FROM 'CREATE TRIGGER zz_firma_inmutable BEFORE DELETE OR UPDATE ON public.mandatos_sepa FOR EACH ROW EXECUTE FUNCTION privado.mandato_sepa_firma_inmutable() O'
  OR (SELECT pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text FROM pg_trigger t
       WHERE t.tgrelid = 'public.mandatos_sepa'::regclass AND t.tgname = 'zz_digital_v3')
     IS DISTINCT FROM 'CREATE TRIGGER zz_digital_v3 BEFORE INSERT ON public.mandatos_sepa FOR EACH ROW EXECUTE FUNCTION privado.mandato_sepa_digital_v3() O' THEN
    RAISE EXCEPTION 'mandato 2: los tres triggers no quedaron como se escribieron';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid IN ('privado.mandato_sepa_objeto_defensa()'::regprocedure,
               'privado.mandato_sepa_firma_inmutable()'::regprocedure, 'privado.mandato_sepa_digital_v3()'::regprocedure)
              AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   OR has_function_privilege('service_role', p.oid, 'EXECUTE')))
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'privado.mandato_sepa_objeto_defensa()'::regprocedure) THEN
    RAISE EXCEPTION 'mandato 2: los privilegios de las funciones nuevas';
  END IF;
END
$guarda$;
