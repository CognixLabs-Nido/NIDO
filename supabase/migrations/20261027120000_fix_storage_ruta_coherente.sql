-- =============================================================================
-- FIX — Las rutas de Storage no cruzan de centro, y nadie escribe en la raíz (PR 3, Fase 4)
-- -----------------------------------------------------------------------------
-- Las policies de `storage.objects` leen el centro de la ruta (`[1]`) y, aparte, el niño, la
-- familia o el aula (`[2]`, `[3]`), pero ninguna comprueba que lo segundo sea del primero. Cada
-- rama mira solo uno de los dos:
--   · el tutor de un niño de B sube un PDF a `A/niñoB/` (`es_tutor_legal_de([2])`) y la
--     directora de A lo ve (`es_admin([1])`);
--   · la directora de A sube a `A/niñoB/` y el tutor de B lo lee;
--   · la profe de A sube a `recogida-adjuntos/A/niñoB/` y el tutor de B lo lee.
-- Y un objeto en la raíz del bucket, sin carpeta, tiene `[1]` NULL: `es_admin(NULL)` es TRUE para
-- cualquier admin, así que lo sube una directora y lo lee y lo borra la de otro centro.
--
-- Arreglo:
--   · `ruta_coherente(bucket, name)`: TRUE solo si la ruta tiene centro y su `[2]` (o `[3]`) es de
--     ese centro: el niño (`centro_de_nino`), la familia del mandato (`{centro}/familia/{id}/`,
--     `centro_de_familia`) o el aula y su publicación (`aula-fotos`). Compara como texto y valida
--     cada segmento antes de convertirlo a uuid: `'familia'::uuid` rompería las del mandato por
--     familia. Sin carpeta, FALSE.
--   · Las 28 policies de `aula-fotos`, `dni-tutores`, `libro-familia`, `mandato-sepa`,
--     `ninos-fotos` y `recogida-adjuntos` la añaden con AND a su condición, sin tocar lo demás
--     (`ALTER POLICY` desde la definición viva).
--   · Las 3 de escritura de `centro-assets` (el logo, `{centro}/logo.png`) añaden que la ruta
--     tenga carpeta. Su lectura es pública a propósito (ADR-0010) y no cambia.
--   · `usuarios-fotos` no entra: su `[1]` es el usuario, y sin carpeta sus helpers dan FALSE.
--
-- `ruta_coherente` vive en `public` junto a los `centro_de_*` que usa, que `authenticated` ya
-- puede llamar: no contesta nada que no contesten ellos. Se mueve con ellos en el PR 2b.
--
-- Demostrado contra la BD efímera del CI: `storage-ruta-coherente.rls.test.ts` (control positivo
-- en el commit da54f53).
--
-- Estado verificado en producción el 2026-10-20 (read_only): los 14 objetos de centros que
-- existen tienen la ruta coherente, 0 están en la raíz, y los 60 huérfanos conocidos (`[1]` no es
-- ningún centro) ya eran inalcanzables con sesión. La guarda previa vuelve a contarlos.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor. Tras aplicar:
-- registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_raiz int;
  v_sin_centro int;
BEGIN
  -- Las 31 policies tienen que ser las del repo: md5 de su definición tal como la guarda
  -- Postgres (qual | with_check), que no depende de cómo se aplicó.
  SELECT md5(string_agg(md5(coalesce(qual, '') || '|' || coalesce(with_check, '')), ',' ORDER BY policyname))
    INTO v_md5
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname NOT LIKE 'usuarios_fotos%' AND policyname <> 'centro_assets_select';
  IF v_md5 IS DISTINCT FROM 'a75944a26349212c75886bf8786d4895' THEN
    RAISE EXCEPTION 'las policies de storage.objects no son las esperadas (md5 %)', v_md5;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'ruta_coherente') THEN
    RAISE EXCEPTION 'ruta_coherente ya existe';
  END IF;

  -- Objetos que dejarán de pasar con sesión. Solo se imprimen: la BD vacía del CI da 0.
  SELECT count(*) FILTER (WHERE (storage.foldername(name))[1] IS NULL),
         count(*) FILTER (WHERE (storage.foldername(name))[1] IS NOT NULL
                            AND NOT EXISTS (SELECT 1 FROM public.centros c
                                             WHERE c.id::text = lower((storage.foldername(name))[1])))
    INTO v_raiz, v_sin_centro
    FROM storage.objects
   WHERE bucket_id IN ('aula-fotos', 'dni-tutores', 'libro-familia', 'mandato-sepa',
                       'ninos-fotos', 'recogida-adjuntos', 'centro-assets');
  RAISE NOTICE 'guarda previa: 31 policies como en el repo; objetos en la raíz: %; con un centro que no existe: %',
    v_raiz, v_sin_centro;
END
$guarda$;

-- -----------------------------------------------------------------------------
-- La función
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.ruta_coherente(p_bucket text, p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Cada segmento se valida antes de convertirlo: un CASE fija el orden, un AND no.
  WITH r AS (
    SELECT (storage.foldername(p_name)) AS c,
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' AS uuid_re
  )
  SELECT CASE
    WHEN c[1] IS NULL OR c[2] IS NULL THEN false
    WHEN p_bucket = 'mandato-sepa' AND c[2] = 'familia' THEN
      CASE WHEN c[3] ~ uuid_re
           THEN coalesce(public.centro_de_familia(c[3]::uuid)::text = lower(c[1]), false)
           ELSE false END
    WHEN p_bucket = 'aula-fotos' THEN
      CASE WHEN c[2] ~ uuid_re AND c[3] ~ uuid_re
           THEN coalesce(public.centro_de_aula(c[2]::uuid)::text = lower(c[1])
                         AND public.aula_de_publicacion(c[3]::uuid)::text = lower(c[2]), false)
           ELSE false END
    ELSE
      CASE WHEN c[2] ~ uuid_re
           THEN coalesce(public.centro_de_nino(c[2]::uuid)::text = lower(c[1]), false)
           ELSE false END
  END
  FROM r;
$function$;

REVOKE ALL ON FUNCTION public.ruta_coherente(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ruta_coherente(text, text) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Las 28 policies con niño, familia o aula en la ruta: además, la ruta coherente
-- -----------------------------------------------------------------------------
ALTER POLICY aula_fotos_delete ON storage.objects
  USING (((bucket_id = 'aula-fotos'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR (autor_de_publicacion(((storage.foldername(name))[3])::uuid) = auth.uid()))) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY aula_fotos_insert ON storage.objects
  WITH CHECK (((bucket_id = 'aula-fotos'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_redactor_de_aula(((storage.foldername(name))[2])::uuid))) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY aula_fotos_select ON storage.objects
  USING (((bucket_id = 'aula-fotos'::text) AND usuario_ve_publicacion_row(((storage.foldername(name))[1])::uuid, ((storage.foldername(name))[2])::uuid, ((storage.foldername(name))[3])::uuid)) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY dni_tutores_delete ON storage.objects
  USING (((bucket_id = 'dni-tutores'::text) AND es_admin(((storage.foldername(name))[1])::uuid)) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY dni_tutores_insert ON storage.objects
  WITH CHECK (((bucket_id = 'dni-tutores'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_legal_de(((storage.foldername(name))[2])::uuid))) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY dni_tutores_select ON storage.objects
  USING (((bucket_id = 'dni-tutores'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_legal_de(((storage.foldername(name))[2])::uuid))) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY dni_tutores_update ON storage.objects
  USING (((bucket_id = 'dni-tutores'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_legal_de(((storage.foldername(name))[2])::uuid))) AND public.ruta_coherente(bucket_id, name))
  WITH CHECK (((bucket_id = 'dni-tutores'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_legal_de(((storage.foldername(name))[2])::uuid))) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY libro_familia_delete ON storage.objects
  USING (((bucket_id = 'libro-familia'::text) AND es_admin(((storage.foldername(name))[1])::uuid)) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY libro_familia_insert ON storage.objects
  WITH CHECK (((bucket_id = 'libro-familia'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_legal_de(((storage.foldername(name))[2])::uuid))) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY libro_familia_select ON storage.objects
  USING (((bucket_id = 'libro-familia'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_legal_de(((storage.foldername(name))[2])::uuid))) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY libro_familia_update ON storage.objects
  USING (((bucket_id = 'libro-familia'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_legal_de(((storage.foldername(name))[2])::uuid))) AND public.ruta_coherente(bucket_id, name))
  WITH CHECK (((bucket_id = 'libro-familia'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_legal_de(((storage.foldername(name))[2])::uuid))) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY mandato_sepa_delete ON storage.objects
  USING (((bucket_id = 'mandato-sepa'::text) AND es_admin(((storage.foldername(name))[1])::uuid)) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY mandato_sepa_insert ON storage.objects
  WITH CHECK (((bucket_id = 'mandato-sepa'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_legal_de(((storage.foldername(name))[2])::uuid))) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY mandato_sepa_insert_familia ON storage.objects
  WITH CHECK (((bucket_id = 'mandato-sepa'::text) AND ((storage.foldername(name))[2] = 'familia'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_de_familia(((storage.foldername(name))[3])::uuid))) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY mandato_sepa_select ON storage.objects
  USING (((bucket_id = 'mandato-sepa'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_legal_de(((storage.foldername(name))[2])::uuid))) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY mandato_sepa_select_familia ON storage.objects
  USING (((bucket_id = 'mandato-sepa'::text) AND ((storage.foldername(name))[2] = 'familia'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_de_familia(((storage.foldername(name))[3])::uuid))) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY mandato_sepa_update ON storage.objects
  USING (((bucket_id = 'mandato-sepa'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_legal_de(((storage.foldername(name))[2])::uuid))) AND public.ruta_coherente(bucket_id, name))
  WITH CHECK (((bucket_id = 'mandato-sepa'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_legal_de(((storage.foldername(name))[2])::uuid))) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY mandato_sepa_update_familia ON storage.objects
  USING (((bucket_id = 'mandato-sepa'::text) AND ((storage.foldername(name))[2] = 'familia'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_de_familia(((storage.foldername(name))[3])::uuid))) AND public.ruta_coherente(bucket_id, name))
  WITH CHECK (((bucket_id = 'mandato-sepa'::text) AND ((storage.foldername(name))[2] = 'familia'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_de_familia(((storage.foldername(name))[3])::uuid))) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY ninos_fotos_delete ON storage.objects
  USING (((bucket_id = 'ninos-fotos'::text) AND es_admin(((storage.foldername(name))[1])::uuid)) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY ninos_fotos_delete_tutor ON storage.objects
  USING (((bucket_id = 'ninos-fotos'::text) AND es_tutor_de(((storage.foldername(name))[2])::uuid)) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY ninos_fotos_insert ON storage.objects
  WITH CHECK (((bucket_id = 'ninos-fotos'::text) AND es_admin(((storage.foldername(name))[1])::uuid) AND nino_puede_aparecer(((storage.foldername(name))[2])::uuid)) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY ninos_fotos_insert_tutor ON storage.objects
  WITH CHECK (((bucket_id = 'ninos-fotos'::text) AND es_tutor_legal_de(((storage.foldername(name))[2])::uuid) AND nino_puede_aparecer(((storage.foldername(name))[2])::uuid)) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY ninos_fotos_select ON storage.objects
  USING (((bucket_id = 'ninos-fotos'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_profe_de_nino(((storage.foldername(name))[2])::uuid) OR es_tutor_de(((storage.foldername(name))[2])::uuid))) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY recogida_adjuntos_delete ON storage.objects
  USING (((bucket_id = 'recogida-adjuntos'::text) AND es_admin(((storage.foldername(name))[1])::uuid)) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY recogida_adjuntos_insert ON storage.objects
  WITH CHECK (((bucket_id = 'recogida-adjuntos'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_profe_en_centro(((storage.foldername(name))[1])::uuid))) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY recogida_adjuntos_insert_tutor ON storage.objects
  WITH CHECK (((bucket_id = 'recogida-adjuntos'::text) AND es_tutor_de(((storage.foldername(name))[2])::uuid)) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY recogida_adjuntos_select ON storage.objects
  USING (((bucket_id = 'recogida-adjuntos'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_profe_en_centro(((storage.foldername(name))[1])::uuid))) AND public.ruta_coherente(bucket_id, name));

ALTER POLICY recogida_adjuntos_select_tutor ON storage.objects
  USING (((bucket_id = 'recogida-adjuntos'::text) AND es_tutor_de(((storage.foldername(name))[2])::uuid)) AND public.ruta_coherente(bucket_id, name));

-- -----------------------------------------------------------------------------
-- Las 3 de escritura del logo: además, con carpeta
-- -----------------------------------------------------------------------------
ALTER POLICY centro_assets_delete ON storage.objects
  USING (((bucket_id = 'centro-assets'::text) AND es_admin(((storage.foldername(name))[1])::uuid)) AND (storage.foldername(name))[1] IS NOT NULL);

ALTER POLICY centro_assets_insert ON storage.objects
  WITH CHECK (((bucket_id = 'centro-assets'::text) AND es_admin(((storage.foldername(name))[1])::uuid)) AND (storage.foldername(name))[1] IS NOT NULL);

ALTER POLICY centro_assets_update ON storage.objects
  USING (((bucket_id = 'centro-assets'::text) AND es_admin(((storage.foldername(name))[1])::uuid)) AND (storage.foldername(name))[1] IS NOT NULL)
  WITH CHECK (((bucket_id = 'centro-assets'::text) AND es_admin(((storage.foldername(name))[1])::uuid)) AND (storage.foldername(name))[1] IS NOT NULL);

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_ruta int;
  v_raiz int;
  v_md5 text;
BEGIN
  SELECT count(*) FILTER (WHERE policyname NOT LIKE 'centro_assets_%'
                            AND (qual IS NULL OR qual LIKE '%ruta_coherente(bucket_id, name)%')
                            AND (with_check IS NULL OR with_check LIKE '%ruta_coherente(bucket_id, name)%')),
         count(*) FILTER (WHERE policyname LIKE 'centro_assets_%'
                            AND (qual IS NULL OR qual LIKE '%[1] IS NOT NULL%')
                            AND (with_check IS NULL OR with_check LIKE '%[1] IS NOT NULL%'))
    INTO v_ruta, v_raiz
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname NOT LIKE 'usuarios_fotos%' AND policyname <> 'centro_assets_select';
  IF v_ruta <> 28 OR v_raiz <> 3 THEN
    RAISE EXCEPTION 'policies con la comprobación: % de 28 con la ruta, % de 3 con carpeta', v_ruta, v_raiz;
  END IF;

  IF has_function_privilege('anon', 'public.ruta_coherente(text, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.ruta_coherente(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ruta_coherente: permisos inesperados';
  END IF;

  SELECT md5(string_agg(md5(coalesce(qual, '') || '|' || coalesce(with_check, '')), ',' ORDER BY policyname))
    INTO v_md5
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname NOT LIKE 'usuarios_fotos%' AND policyname <> 'centro_assets_select';
  RAISE NOTICE 'guarda posterior: 28 con la ruta coherente y 3 con carpeta (md5 de las 31: %)', v_md5;
END
$guarda$;
