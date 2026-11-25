-- Censo C, grupo 1, PR 1 (decisión de Jose del 2026-11-25, docs/specs/fallos-leidos-c.md):
-- el barrido de huérfanos del blog, la red de «primero el fichero, después la fila».
--
-- Las fotos del blog ya se borran antes que su fila (gestionar-publicacion.ts), así que borrar una
-- publicación o una foto ya no deja huérfanos. Lo que queda: la subida que inserta la fila, falla al
-- subir y no consigue borrar el fichero que sí subió (fotos/upload), y lo que dejó el orden de antes.
-- «Como red, lo mismo que hicimos con el mandato: que esos ficheros entren en el barrido de huérfanos
-- que ya corre a diario.»
--
--   · `aula_fotos_huerfanas()`: los objetos de `aula-fotos` que ninguna fila de `media` nombra (ni
--     `path` ni `path_miniatura`), de más de un día. La forma de `mandatos_sepa_huerfanos`.
--   · `retencion_pasadas` pasa de catorce claves a quince (`fotosBlogHuerfanas`), NOT VALID como antes:
--     las pasadas ya registradas no la llevan.
--
-- Medido antes (2026-11-25, solo lectura): `aula-fotos` tiene 0 objetos en producción.

-- ---------------------------------------------------------------------------------------------
DO $previa$
BEGIN
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conname = 'retencion_pasadas_recuentos_check'
         AND conrelid = 'public.retencion_pasadas'::regclass)
     IS DISTINCT FROM 'CHECK (((jsonb_typeof(recuentos) = ''object''::text) AND (recuentos ?& ARRAY[''olvido''::text, ''retencion''::text, ''lecturasFichaMedica''::text, ''auditLog''::text, ''exportLog''::text, ''listaEspera''::text, ''operativa''::text, ''expediente''::text, ''firmas''::text, ''cuentas''::text, ''fiscal''::text, ''cuentasOlvidadas''::text, ''ficherosRemesa''::text, ''mandatosHuerfanos''::text]))) NOT VALID' THEN
    RAISE EXCEPTION 'barrido del blog: el CHECK de retencion_pasadas no es el de catorce claves';
  END IF;
  IF to_regprocedure('public.aula_fotos_huerfanas()') IS NOT NULL THEN
    RAISE EXCEPTION 'barrido del blog: aula_fotos_huerfanas ya existe';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'aula-fotos') THEN
    RAISE EXCEPTION 'barrido del blog: no existe el bucket aula-fotos';
  END IF;
END
$previa$;

-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION public.aula_fotos_huerfanas()
RETURNS TABLE(ruta text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT o.name FROM storage.objects o
   WHERE o.bucket_id = 'aula-fotos'
     AND o.created_at < now() - interval '1 day'
     AND NOT EXISTS (SELECT 1 FROM public.media m
                      WHERE m.path = o.name OR m.path_miniatura = o.name);
$function$;
REVOKE ALL ON FUNCTION public.aula_fotos_huerfanas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aula_fotos_huerfanas() TO service_role;
COMMENT ON FUNCTION public.aula_fotos_huerfanas() IS
  'Los objetos del blog (aula-fotos) que ninguna fila de media nombra, de más de un día: los cuenta y '
  'los borra el cron de retención (barrerFotosBlogHuerfanas). Censo C, decisión del 2026-11-25.';

ALTER TABLE public.retencion_pasadas DROP CONSTRAINT retencion_pasadas_recuentos_check;
ALTER TABLE public.retencion_pasadas ADD CONSTRAINT retencion_pasadas_recuentos_check
  CHECK (jsonb_typeof(recuentos) = 'object'
         AND recuentos ?& ARRAY['olvido', 'retencion', 'lecturasFichaMedica',
                                'auditLog', 'exportLog', 'listaEspera', 'operativa',
                                'expediente', 'firmas', 'cuentas', 'fiscal',
                                'cuentasOlvidadas', 'ficherosRemesa', 'mandatosHuerfanos',
                                'fotosBlogHuerfanas'])
  NOT VALID;

-- ---------------------------------------------------------------------------------------------
DO $posterior$
BEGIN
  IF to_regprocedure('public.aula_fotos_huerfanas()') IS NULL THEN
    RAISE EXCEPTION 'barrido del blog: falta aula_fotos_huerfanas';
  END IF;
  IF has_function_privilege('anon', 'public.aula_fotos_huerfanas()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.aula_fotos_huerfanas()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.aula_fotos_huerfanas()', 'EXECUTE') THEN
    RAISE EXCEPTION 'barrido del blog: aula_fotos_huerfanas no es solo del servicio';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conname = 'retencion_pasadas_recuentos_check'
         AND conrelid = 'public.retencion_pasadas'::regclass) NOT LIKE '%''fotosBlogHuerfanas''::text]))) NOT VALID' THEN
    RAISE EXCEPTION 'barrido del blog: el CHECK no lleva la decimoquinta clave';
  END IF;
END
$posterior$;
