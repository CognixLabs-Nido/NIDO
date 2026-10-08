-- =============================================================================
-- Limpieza: DROP de `profes_aulas.es_profe_principal` (deprecated desde F5B-#34).
--
-- La semántica la lleva `tipo_personal_aula` (coordinadora/profesora/tecnico/apoyo)
-- desde 20260529193000. F11-H-0 (20260624130000) conservó la columna al recrear la
-- tabla "para no ampliar el blast radius", con el drop pendiente de un PR posterior.
--
-- Estado verificado en producción el 2026-10-08:
--   · ninguna función, policy, vista ni publicación la lee; su única dependencia es
--     su propio DEFAULT, que cae con ella;
--   · `profes_aulas` tiene 0 filas (F11-H-0 la vació sin backfill);
--   · el único lector en la app (`copiar-config-curso.ts`) deja de leerla en este PR.
--
-- Guardas: aborta si alguna función sigue nombrando la columna (los cuerpos plpgsql no
-- dejan dependencia en pg_depend, así que el DROP no lo detectaría) y comprueba después
-- que la columna ya no existe. Sin CASCADE: si una vista dependiera, el DROP fallaría.
-- Idempotente: si la columna ya no está, no hace nada.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_funcs text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ')
    INTO v_funcs
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosrc ~ 'es_profe_principal';
  IF v_funcs IS NOT NULL THEN
    RAISE EXCEPTION 'drop es_profe_principal: estas funciones aún la nombran: %', v_funcs;
  END IF;
END
$guarda$;

ALTER TABLE public.profes_aulas DROP COLUMN IF EXISTS es_profe_principal;

-- ---- Guarda posterior ----
DO $guarda$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'profes_aulas'
       AND column_name = 'es_profe_principal'
  ) THEN
    RAISE EXCEPTION 'drop es_profe_principal: la columna sigue existiendo';
  END IF;
END
$guarda$;
