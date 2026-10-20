-- =============================================================================
-- FIX — Las rutas de documentos guardadas se validan contra su familia (PR 0b, Fase 4)
-- -----------------------------------------------------------------------------
-- El export (`/export/me`, `recolectarUsuario`) firma con SERVICE ROLE dos rutas que el tutor
-- puede escribir y que nada validaba:
--
--   - `familia_tutores.dni_documento_path`: el tutor actualiza su fila
--     (`familia_tutores_update_tutor`) sin ningún CHECK sobre la ruta;
--   - `mandatos_sepa.documento_path`: `registrar_mandato_sepa` / `sustituir_mandato_sepa`
--     guardan `p_documento_path` tal cual.
--
-- Un tutor apuntaba la suya al DNI o al mandato de OTRA familia —también del mismo centro— y su
-- propio export le firmaba el fichero (service role no pasa por las policies de Storage).
-- Demostrado contra la BD efímera del CI: `rutas-guardadas-export.rls.test.ts`.
--
-- Mismo patrón que `media_validar_ruta` (20261003140000): un trigger BEFORE valida la ruta
-- contra la FILA, y se aplica a todos (sesión, service role y el dueño). Rutas válidas, las que
-- dejan las rutas de subida de la app:
--
--   - DNI:     `{centro}/{niño de ESA familia}/<nombre>.pdf`        (alta/[ninoId]/dni)
--   - mandato: `{centro}/{niño de ESA familia}/<nombre>.pdf`        (alta/[ninoId]/mandato-sepa)
--              `{centro}/familia/{ESA familia}/<nombre>.pdf`         (family/domiciliacion)
--   con `{centro}` = el de la familia y `<nombre>` de un solo segmento `[A-Za-z0-9_-]`.
--
-- NULL (y '' en el mandato, el presencial sin PDF) siguen valiendo. El trigger solo mira la ruta
-- cuando CAMBIA (o al insertar): una fila vieja no impide tocar otras columnas. Las purgas la
-- ponen a NULL, que pasa.
--
-- Estado verificado en producción el 2026-10-20 (lectura read_only): 3 rutas de DNI y 2 de
-- mandato guardadas, 0 fuera de su familia. La guarda previa lo cuenta y lo imprime.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor. Tras aplicar:
-- registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_dni_fuera int;
  v_mandato_fuera int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
     WHERE pronamespace = 'public'::regnamespace
       AND proname IN ('familia_tutores_validar_ruta_dni', 'mandatos_sepa_validar_ruta')
  ) THEN
    RAISE EXCEPTION 'las funciones de validación de rutas ya existen';
  END IF;

  -- Las filas de hoy que la regla nueva no admitiría. Si hay alguna, se para: una ruta así
  -- ya se habría podido firmar, y hay que mirarla a mano antes de cerrar.
  SELECT count(*) INTO v_dni_fuera
    FROM public.familia_tutores ft
   WHERE ft.dni_documento_path IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.ninos n JOIN public.familias f ON f.id = n.familia_id
        WHERE n.familia_id = ft.familia_id
          AND ft.dni_documento_path ~ ('^' || f.centro_id || '/' || n.id || '/[A-Za-z0-9_-]+\.pdf$'));

  SELECT count(*) INTO v_mandato_fuera
    FROM public.mandatos_sepa m
    JOIN public.familias f ON f.id = m.familia_id
   WHERE m.documento_path IS NOT NULL AND m.documento_path <> ''
     AND m.documento_path !~ ('^' || f.centro_id || '/familia/' || m.familia_id || '/[A-Za-z0-9_-]+\.pdf$')
     AND NOT EXISTS (
       SELECT 1 FROM public.ninos n
        WHERE n.familia_id = m.familia_id
          AND m.documento_path ~ ('^' || f.centro_id || '/' || n.id || '/[A-Za-z0-9_-]+\.pdf$'));

  RAISE NOTICE 'rutas fuera de su familia antes de cerrar: % de DNI, % de mandato',
    v_dni_fuera, v_mandato_fuera;
  IF v_dni_fuera > 0 OR v_mandato_fuera > 0 THEN
    RAISE EXCEPTION 'hay rutas fuera de su familia (% DNI, % mandato): revisarlas antes de aplicar',
      v_dni_fuera, v_mandato_fuera;
  END IF;
END
$guarda$;

-- ---- 1. DNI del tutor ----
CREATE FUNCTION public.familia_tutores_validar_ruta_dni()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.dni_documento_path IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.dni_documento_path IS NOT DISTINCT FROM OLD.dni_documento_path THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ninos n JOIN public.familias f ON f.id = n.familia_id
     WHERE n.familia_id = NEW.familia_id
       AND NEW.dni_documento_path ~ ('^' || f.centro_id || '/' || n.id || '/[A-Za-z0-9_-]+\.pdf$')
  ) THEN
    RETURN NEW; -- MUTACION control negativo
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.familia_tutores_validar_ruta_dni() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER familia_tutores_validar_ruta_dni_trg
  BEFORE INSERT OR UPDATE OF dni_documento_path ON public.familia_tutores
  FOR EACH ROW EXECUTE FUNCTION public.familia_tutores_validar_ruta_dni();

-- ---- 2. Documento del mandato ----
CREATE FUNCTION public.mandatos_sepa_validar_ruta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_centro uuid;
BEGIN
  IF NEW.documento_path IS NULL OR NEW.documento_path = '' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.documento_path IS NOT DISTINCT FROM OLD.documento_path THEN
    RETURN NEW;
  END IF;
  SELECT centro_id INTO v_centro FROM public.familias WHERE id = NEW.familia_id;
  IF v_centro IS NULL
     OR NOT (
       NEW.documento_path ~ ('^' || v_centro || '/familia/' || NEW.familia_id || '/[A-Za-z0-9_-]+\.pdf$')
       OR EXISTS (
         SELECT 1 FROM public.ninos n
          WHERE n.familia_id = NEW.familia_id
            AND NEW.documento_path ~ ('^' || v_centro || '/' || n.id || '/[A-Za-z0-9_-]+\.pdf$'))
     ) THEN
    RETURN NEW; -- MUTACION control negativo
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.mandatos_sepa_validar_ruta() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER mandatos_sepa_validar_ruta_trg
  BEFORE INSERT OR UPDATE OF documento_path ON public.mandatos_sepa
  FOR EACH ROW EXECUTE FUNCTION public.mandatos_sepa_validar_ruta();

-- ---- Guarda posterior ----
DO $comprueba$
DECLARE
  v_triggers int;
BEGIN
  SELECT count(*) INTO v_triggers
    FROM pg_trigger
   WHERE NOT tgisinternal
     AND tgenabled <> 'D'
     AND ((tgrelid = 'public.familia_tutores'::regclass AND tgname = 'familia_tutores_validar_ruta_dni_trg')
       OR (tgrelid = 'public.mandatos_sepa'::regclass AND tgname = 'mandatos_sepa_validar_ruta_trg'));
  IF v_triggers <> 2 THEN
    RAISE EXCEPTION 'se esperaban 2 triggers de validación de rutas activos; hay %', v_triggers;
  END IF;
  RAISE NOTICE 'rutas de documentos: % triggers de validación activos (DNI del tutor y mandato)',
    v_triggers;
END
$comprueba$;
