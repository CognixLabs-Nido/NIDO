-- =============================================================================
-- FIX — mandatos_sepa solo se escribe por sus funciones
-- -----------------------------------------------------------------------------
-- Decisión del responsable del 2026-11-03.
--
--   · Se cierra la escritura directa en `mandatos_sepa`: ni las sesiones (`authenticated`) ni
--     `service_role` tienen INSERT, UPDATE, DELETE, TRUNCATE ni MAINTAIN, y se quitan las políticas
--     de INSERT y de UPDATE. La lectura no cambia (`mandatos_sepa_select` y el SELECT de los dos).
--   · Escriben solo sus funciones, todas SECURITY DEFINER de `postgres`, el dueño de la tabla, a
--     las que el REVOKE no alcanza: `registrar_mandato_sepa` y `sustituir_mandato_sepa` (la app,
--     con sesión), `anular_alta` y `destruir_fiscal_familia` (el servidor). La app no escribe la
--     tabla por ningún otro camino (censo del 2026-11-03), y `service_role` no lo necesita: solo lo
--     usaban los tests, que ahora escriben como `postgres` por psql.
--   · Una escritura nueva de un mandato va por función, nunca por política ni por service_role.
--
-- La aplica el responsable por SQL Editor. Sin BEGIN ni COMMIT. Tras aplicar: registrar en
-- supabase_migrations.schema_migrations. La app no cambia: aplicar en cuanto esté el visto bueno,
-- antes o después del merge.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_pol text;
  v_fn record;
  v_n int;
BEGIN
  SELECT string_agg(policyname || ':' || cmd, ', ' ORDER BY policyname) INTO v_pol
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'mandatos_sepa';
  RAISE NOTICE 'políticas de mandatos_sepa antes: %', v_pol;
  IF v_pol IS DISTINCT FROM 'mandatos_sepa_insert:INSERT, mandatos_sepa_select:SELECT, mandatos_sepa_update:UPDATE' THEN
    RAISE EXCEPTION 'las políticas de mandatos_sepa no son las esperadas (ya aplicada?): %', v_pol;
  END IF;
  RAISE NOTICE 'antes: authenticated escribe %, service_role escribe %',
    has_table_privilege('authenticated', 'public.mandatos_sepa', 'INSERT,UPDATE,DELETE'),
    has_table_privilege('service_role', 'public.mandatos_sepa', 'INSERT,UPDATE,DELETE,TRUNCATE');

  -- Las cuatro funciones que escriben la tabla siguen pudiendo: SECURITY DEFINER de su dueño.
  v_n := 0;
  FOR v_fn IN
    SELECT p.proname, p.prosecdef, pg_get_userbyid(p.proowner) AS dueno
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('registrar_mandato_sepa', 'sustituir_mandato_sepa', 'anular_alta',
                         'destruir_fiscal_familia')
  LOOP
    v_n := v_n + 1;
    IF NOT v_fn.prosecdef OR v_fn.dueno <> 'postgres' THEN
      RAISE EXCEPTION '% no es SECURITY DEFINER de postgres (%, %): el REVOKE la rompería',
        v_fn.proname, v_fn.prosecdef, v_fn.dueno;
    END IF;
  END LOOP;
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'esperaba las 4 funciones que escriben mandatos_sepa y hay %', v_n;
  END IF;
  IF pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.mandatos_sepa'::regclass)) <> 'postgres' THEN
    RAISE EXCEPTION 'mandatos_sepa no es de postgres';
  END IF;

  -- Ninguna otra función de la base la escribe (las que la leen no cuentan).
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.prosrc ~* '(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(public\.)?mandatos_sepa\M'
     AND p.proname NOT IN ('registrar_mandato_sepa', 'sustituir_mandato_sepa', 'anular_alta',
                           'destruir_fiscal_familia');
  RAISE NOTICE 'otras funciones que escriben mandatos_sepa: %', v_n;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'hay % funciones más que escriben mandatos_sepa: revisar antes de cerrar', v_n;
  END IF;
END
$guarda$;

DROP POLICY mandatos_sepa_insert ON public.mandatos_sepa;
DROP POLICY mandatos_sepa_update ON public.mandatos_sepa;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, MAINTAIN ON public.mandatos_sepa
  FROM PUBLIC, anon, authenticated, service_role;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_rol text;
  v_pol text;
BEGIN
  FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_table_privilege(v_rol, 'public.mandatos_sepa', 'INSERT')
       OR has_table_privilege(v_rol, 'public.mandatos_sepa', 'UPDATE')
       OR has_table_privilege(v_rol, 'public.mandatos_sepa', 'DELETE')
       OR has_table_privilege(v_rol, 'public.mandatos_sepa', 'TRUNCATE')
       OR has_table_privilege(v_rol, 'public.mandatos_sepa', 'MAINTAIN')
       OR has_any_column_privilege(v_rol, 'public.mandatos_sepa', 'INSERT')
       OR has_any_column_privilege(v_rol, 'public.mandatos_sepa', 'UPDATE') THEN
      RAISE EXCEPTION '% sigue pudiendo escribir en mandatos_sepa', v_rol;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('authenticated', 'public.mandatos_sepa', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.mandatos_sepa', 'SELECT') THEN
    RAISE EXCEPTION 'se ha perdido el SELECT de mandatos_sepa';
  END IF;
  IF NOT has_table_privilege('postgres', 'public.mandatos_sepa', 'INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'postgres (el dueño de las funciones) ya no escribe mandatos_sepa';
  END IF;
  SELECT string_agg(policyname || ':' || cmd, ', ' ORDER BY policyname) INTO v_pol
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'mandatos_sepa';
  IF v_pol IS DISTINCT FROM 'mandatos_sepa_select:SELECT' THEN
    RAISE EXCEPTION 'esperaba solo la política de lectura y hay: %', v_pol;
  END IF;
  RAISE NOTICE 'después: políticas %; anon, authenticated y service_role sin escritura', v_pol;
END
$guarda$;
