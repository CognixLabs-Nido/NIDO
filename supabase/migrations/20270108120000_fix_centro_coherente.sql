-- =============================================================================
-- FIX — Una fila y lo que nombra son del mismo centro (2026-11-06)
-- -----------------------------------------------------------------------------
-- Toda tabla con `centro_id` que apunta (FK) a otra tabla con `centro_id` lleva una regla que no
-- estaba escrita en ningún sitio: lo que nombra es de su centro. Las policies la miraban a trozos:
-- en informes, citas y eventos la rama de la profe comparaba el centro del niño o del aula y la de
-- Dirección no (`es_admin(centro_id)`), y los triggers `*_set_centro_id` solo ponen el centro si
-- llega NULL. Medido en producción el 2026-11-06, en un ensayo terminado en RAISE con un segundo
-- centro creado dentro: la admin de A creaba en A un informe, una cita y un evento del niño o del
-- aula de B, y el tutor de ese niño leía el informe publicado. Hoy hay un solo centro y 0 filas
-- incoherentes en los 75 pares; se abre con el segundo centro, que el panel de plataforma ya crea.
--
-- La defensa, en la base y para todos (sesión, `service_role` y funciones; no `postgres`,
-- rls-policies.md «La llave de postgres»): por cada tabla, un trigger `zz_centro_coherente`
-- (BEFORE INSERT OR UPDATE de `centro_id` o de sus columnas FK) que exige que la fila nombrada por
-- cada FK sea del centro de la fila: si no, 23514 con HINT `centro_ajeno`. `zz_` para que corra
-- después de los triggers que ponen el centro (los BEFORE se disparan por orden de nombre).
--
-- La lista de pares sale del catálogo (`privado.centro_coherente_pares()`), no de una lista escrita
-- a mano: una FK nueva entre tablas con centro entra sola en la guarda posterior y en el test, que
-- fallan si no tiene su comprobación. La comprobación de cada tabla se GENERA aquí, con sus
-- columnas escritas: el trigger no lee el catálogo en cada escritura (coste medido en la CI).
--
-- Una tabla o una columna que no deba mirarse va en `privado.centro_coherente_excepciones`, con su
-- razón (CHECK de longitud): «esta no, y por esto», nunca un olvido. Hoy está vacía.
--
-- Fuera de esta migración (follow-up): las tablas SIN `centro_id` que unen dos entidades con
-- centro (`matriculas`, `profes_aulas`…).
--
-- Sin orden con el despliegue: la app no escribe filas cruzadas. La aplica el responsable por SQL
-- Editor, copiando el fichero. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Los pares, del catálogo ----
CREATE FUNCTION privado.centro_coherente_pares()
RETURNS TABLE (tabla text, columna text, ref text, ref_columna text)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT c.conrelid::regclass::text, a.attname::text, c.confrelid::regclass::text, ra.attname::text
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    JOIN pg_catalog.pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = c.confkey[1]
   WHERE c.contype = 'f' AND cardinality(c.conkey) = 1
     AND c.connamespace = 'public'::regnamespace
     AND a.attname <> 'centro_id'
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute x WHERE x.attrelid = c.conrelid
                    AND x.attname = 'centro_id' AND NOT x.attisdropped)
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute x WHERE x.attrelid = c.confrelid
                    AND x.attname = 'centro_id' AND NOT x.attisdropped)
   ORDER BY 1, 2
$$;
REVOKE ALL ON FUNCTION privado.centro_coherente_pares() FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE privado.centro_coherente_excepciones (
  tabla   text NOT NULL,
  columna text NOT NULL,
  motivo  text NOT NULL CHECK (char_length(motivo) >= 30),
  PRIMARY KEY (tabla, columna)
);
REVOKE ALL ON privado.centro_coherente_excepciones FROM PUBLIC, anon, authenticated, service_role;

-- ---- Guarda previa: ninguna fila incoherente hoy ----
DO $guarda$
DECLARE
  p record;
  v_n bigint;
  v_total bigint := 0;
  v_pares int := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'zz_centro_coherente') THEN
    RAISE EXCEPTION 'zz_centro_coherente ya existe';
  END IF;
  FOR p IN SELECT * FROM privado.centro_coherente_pares() LOOP
    v_pares := v_pares + 1;
    EXECUTE format('SELECT count(*) FROM %s x LEFT JOIN %s r ON r.%I = x.%I
                     WHERE x.%I IS NOT NULL AND r.centro_id IS DISTINCT FROM x.centro_id',
                   p.tabla, p.ref, p.ref_columna, p.columna, p.columna) INTO v_n;
    IF v_n > 0 THEN
      RAISE NOTICE 'incoherente: % filas de %.% (→ %)', v_n, p.tabla, p.columna, p.ref;
    END IF;
    v_total := v_total + v_n;
  END LOOP;
  RAISE NOTICE 'centro coherente: % pares, % filas incoherentes', v_pares, v_total;
  IF v_total > 0 THEN
    RAISE EXCEPTION 'hay % filas que nombran algo de otro centro; no se aplica', v_total;
  END IF;
END
$guarda$;

-- ---- Una comprobación por tabla, generada con sus columnas ----
DO $genera$
DECLARE
  t record;
  v_cuerpo text;
  v_cols text;
  v_fn text;
BEGIN
  FOR t IN
    SELECT p.tabla, array_agg(p.columna ORDER BY p.columna) AS columnas,
           array_agg(p.ref ORDER BY p.columna) AS refs, array_agg(p.ref_columna ORDER BY p.columna) AS ref_cols
      FROM privado.centro_coherente_pares() p
     WHERE NOT EXISTS (SELECT 1 FROM privado.centro_coherente_excepciones e
                        WHERE e.tabla = p.tabla AND e.columna = p.columna)
     GROUP BY p.tabla
  LOOP
    v_cuerpo := '';
    FOR i IN 1 .. cardinality(t.columnas) LOOP
      v_cuerpo := v_cuerpo || format(
        E'  IF NEW.%1$I IS NOT NULL AND NEW.centro_id IS DISTINCT FROM\n' ||
        E'     (SELECT r.centro_id FROM %2$s r WHERE r.%3$I = NEW.%1$I) THEN\n' ||
        E'    RAISE EXCEPTION %4$L USING ERRCODE = %5$L, HINT = %6$L;\n' ||
        E'  END IF;\n',
        t.columnas[i], t.refs[i], t.ref_cols[i],
        format('%s.%s no es del centro de la fila', t.tabla, t.columnas[i]), '23514', 'centro_ajeno');
    END LOOP;
    v_fn := format('privado.%I', replace(t.tabla, 'public.', '') || '_centro_coherente');
    EXECUTE format(E'CREATE FUNCTION %s() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = %L AS $f$\nBEGIN\n%sRETURN NEW;\nEND\n$f$',
                   v_fn, '', v_cuerpo);
    EXECUTE format('REVOKE ALL ON FUNCTION %s() FROM PUBLIC, anon, authenticated, service_role', v_fn);
    SELECT string_agg(quote_ident(c), ', ') INTO v_cols FROM unnest(t.columnas) c;
    EXECUTE format('CREATE TRIGGER zz_centro_coherente BEFORE INSERT OR UPDATE OF centro_id, %s ON %s FOR EACH ROW EXECUTE FUNCTION %s()',
                   v_cols, t.tabla, v_fn);
  END LOOP;
END
$genera$;

-- ---- Guarda posterior: cada par, mirado o con su excepción ----
DO $guarda$
DECLARE
  v_sin int;
  v_tablas int;
BEGIN
  -- Un par está cubierto si su tabla tiene zz_centro_coherente sobre esa columna y su función la nombra.
  SELECT count(*) INTO v_sin
    FROM privado.centro_coherente_pares() p
   WHERE NOT EXISTS (SELECT 1 FROM privado.centro_coherente_excepciones e
                      WHERE e.tabla = p.tabla AND e.columna = p.columna)
     AND NOT EXISTS (
       SELECT 1 FROM pg_trigger tg JOIN pg_proc f ON f.oid = tg.tgfoid
        WHERE tg.tgrelid = p.tabla::regclass AND tg.tgname = 'zz_centro_coherente'
          AND tg.tgenabled = 'O' AND f.prosecdef
          AND pg_get_triggerdef(tg.oid) ~ ('UPDATE OF centro_id, .*\m' || p.columna || '\M')
          AND f.prosrc LIKE '%NEW.' || p.columna || ' IS NOT NULL%');
  SELECT count(DISTINCT tabla) INTO v_tablas FROM privado.centro_coherente_pares();
  RAISE NOTICE 'centro coherente: % tablas, % pares sin comprobación ni excepción', v_tablas, v_sin;
  IF v_sin > 0 THEN
    RAISE EXCEPTION '% pares sin comprobación ni excepción', v_sin;
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname = 'zz_centro_coherente') <> v_tablas THEN
    RAISE EXCEPTION 'esperaba un zz_centro_coherente por tabla con pares (%)', v_tablas;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid = f.pronamespace
              WHERE n.nspname = 'privado' AND f.proname LIKE '%\_centro\_coherente'
                AND (has_function_privilege('authenticated', f.oid, 'EXECUTE')
                     OR has_function_privilege('anon', f.oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'una función de centro coherente es ejecutable por authenticated o anon';
  END IF;
END
$guarda$;
