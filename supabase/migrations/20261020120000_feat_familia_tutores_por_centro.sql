-- =============================================================================
-- Multicentro · Fase 2 · una familia por adulto Y POR CENTRO
--
-- `ux_familia_tutores_usuario_unico` (F-0) decía «un adulto = una familia» en toda la
-- plataforma: un tutor con hijos en dos centros no podía tener familia en el segundo. Decisión
-- del responsable (2026-10-19): una familia por adulto y por centro, garantizada por la BD.
--
-- `familia_tutores` no tenía centro. Se le da uno, derivado de la familia por trigger (el patrón
-- de `derivar_centro_id_de_familia`), y el índice único pasa a (usuario_id, centro_id). Un
-- índice único no tiene carreras: dos altas simultáneas del mismo adulto en el mismo centro las
-- para la BD, no una comprobación previa.
--
-- Medido en producción (read_only, 2026-10-19): 4 filas en familia_tutores; 0 adultos con dos
-- familias vivas en el mismo centro; 1 centro.
--
-- 1. Guarda de entrada: el índice viejo es el de F-0, la columna no existe, y no hay ningún
--    adulto con dos familias vivas en el mismo centro (el índice nuevo no se podría crear).
-- 2. Columna centro_id + relleno desde la familia (se imprime la cuenta: 4 en producción, 0 en
--    la base vacía del CI). La auditoría de esas filas lleva su etiqueta; centro_id no es un
--    dato personal y el resto de la fila ya lo redacta la purga (k_ft, por registro_id).
-- 3. CHECK (centro_id IS NOT NULL) en vez de columna NOT NULL: el CHECK se evalúa DESPUÉS de los
--    triggers BEFORE, así que la BD garantiza igual que nunca está vacía, y los tipos generados
--    no obligan a pasarla en cada insert (la pone el trigger).
-- 4. Trigger: centro_id = el de la familia. Si quien escribe lo pasa y no coincide, error; si la
--    familia cambia (reasignación por service_role), se recalcula.
-- 5. familias.centro_id deja de poder cambiar: si cambiara, los centro_id de sus tutores
--    quedarían viejos. Nadie lo cambia hoy (ni la app ni ninguna función).
-- 6. Índice: fuera el viejo, dentro (usuario_id, centro_id) sobre filas vivas con cuenta.
-- 7. Guarda de salida: el índice nuevo está, el viejo no, y ninguna fila sin centro o con un
--    centro distinto del de su familia.
--
-- ORDEN: va a producción ANTES del merge. Con el índice viejo puesto, el código nuevo funciona
-- igual (no hay nadie en dos centros); el orden importa solo para no dejar el índice viejo vivo.
-- =============================================================================

-- 1. Guarda de entrada.
DO $guarda$
DECLARE
  f       text[] := '{}';
  v_def   text;
  v_dups  int;
BEGIN
  SELECT indexdef INTO v_def FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'ux_familia_tutores_usuario_unico';
  IF v_def IS DISTINCT FROM 'CREATE UNIQUE INDEX ux_familia_tutores_usuario_unico ON public.familia_tutores USING btree (usuario_id) WHERE ((usuario_id IS NOT NULL) AND (deleted_at IS NULL))' THEN
    f := f || format('ux_familia_tutores_usuario_unico no es el de F-0: %s', coalesce(v_def, '(no existe)'));
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'familia_tutores'
                AND column_name = 'centro_id') THEN
    f := f || 'familia_tutores.centro_id ya existe'::text;
  END IF;

  SELECT count(*) INTO v_dups FROM (
    SELECT ft.usuario_id, fa.centro_id
      FROM public.familia_tutores ft
      JOIN public.familias fa ON fa.id = ft.familia_id
     WHERE ft.usuario_id IS NOT NULL AND ft.deleted_at IS NULL
     GROUP BY 1, 2 HAVING count(*) > 1) x;
  IF v_dups > 0 THEN
    f := f || format('%s adulto(s) con dos familias vivas en el mismo centro', v_dups);
  END IF;

  IF cardinality(f) > 0 THEN
    RAISE EXCEPTION 'guarda de entrada: %', array_to_string(f, ' | ');
  END IF;
  RAISE NOTICE 'guarda de entrada OK: índice de F-0, sin columna, % adultos repetidos en un centro', v_dups;
END
$guarda$;

-- 2. Columna y relleno.
ALTER TABLE public.familia_tutores
  ADD COLUMN centro_id uuid REFERENCES public.centros(id) ON DELETE RESTRICT;

DO $relleno$
DECLARE
  v_n int;
BEGIN
  PERFORM set_config('app.audit_actor', 'system:migracion_familia_por_centro', true);
  UPDATE public.familia_tutores ft SET centro_id = fa.centro_id
    FROM public.familias fa
   WHERE fa.id = ft.familia_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('app.audit_actor', '', true);
  RAISE NOTICE 'relleno: % fila(s) de familia_tutores con su centro', v_n;
END
$relleno$;

-- 3. Nunca vacía (después de los triggers BEFORE).
ALTER TABLE public.familia_tutores
  ADD CONSTRAINT familia_tutores_centro_id_presente CHECK (centro_id IS NOT NULL);

-- 4. centro_id = el de la familia.
CREATE OR REPLACE FUNCTION public.familia_tutores_derivar_centro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_centro uuid := public.centro_de_familia(NEW.familia_id);
BEGIN
  -- En un UPDATE que no toca centro_id (p. ej. una reasignación de familia), se recalcula.
  IF TG_OP = 'UPDATE' AND NEW.centro_id IS NOT DISTINCT FROM OLD.centro_id THEN
    NEW.centro_id := v_centro;
  ELSIF NEW.centro_id IS NOT NULL AND NEW.centro_id IS DISTINCT FROM v_centro THEN
    RAISE EXCEPTION 'familia_tutores: centro_id no es el de la familia'
      USING ERRCODE = 'check_violation';
  ELSE
    NEW.centro_id := v_centro;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.familia_tutores_derivar_centro() FROM PUBLIC, anon;

CREATE TRIGGER familia_tutores_derivar_centro
  BEFORE INSERT OR UPDATE OF familia_id, centro_id ON public.familia_tutores
  FOR EACH ROW EXECUTE FUNCTION public.familia_tutores_derivar_centro();

-- 5. El centro de una familia no cambia.
CREATE OR REPLACE FUNCTION public.familias_centro_inmutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.centro_id IS DISTINCT FROM OLD.centro_id THEN
    RAISE EXCEPTION 'familias: el centro de una familia no se cambia'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.familias_centro_inmutable() FROM PUBLIC, anon;

CREATE TRIGGER familias_centro_inmutable
  BEFORE UPDATE OF centro_id ON public.familias
  FOR EACH ROW EXECUTE FUNCTION public.familias_centro_inmutable();

-- 6. Índice.
DROP INDEX public.ux_familia_tutores_usuario_unico;

CREATE UNIQUE INDEX ux_familia_tutores_usuario_centro
  ON public.familia_tutores (usuario_id, centro_id)
  WHERE usuario_id IS NOT NULL AND deleted_at IS NULL;

-- 7. Guarda de salida.
DO $salida$
DECLARE
  f        text[] := '{}';
  v_mal    int;
BEGIN
  IF to_regclass('public.ux_familia_tutores_usuario_unico') IS NOT NULL THEN
    f := f || 'el índice viejo sigue'::text;
  END IF;
  IF to_regclass('public.ux_familia_tutores_usuario_centro') IS NULL THEN
    f := f || 'falta el índice nuevo'::text;
  END IF;
  SELECT count(*) INTO v_mal
    FROM public.familia_tutores ft
    JOIN public.familias fa ON fa.id = ft.familia_id
   WHERE ft.centro_id IS DISTINCT FROM fa.centro_id;
  IF v_mal > 0 THEN
    f := f || format('%s fila(s) con un centro distinto del de su familia', v_mal);
  END IF;

  IF cardinality(f) > 0 THEN
    RAISE EXCEPTION 'guarda de salida: %', array_to_string(f, ' | ');
  END IF;
  RAISE NOTICE 'guarda de salida OK: índice (usuario_id, centro_id), % filas descuadradas', v_mal;
END
$salida$;
