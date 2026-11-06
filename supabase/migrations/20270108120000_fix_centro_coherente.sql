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
-- Solo salta si lo nombrado EXISTE y es de otro centro: si no existe, lo dice la FK (23503). Una
-- primera versión comparaba con `IS DISTINCT FROM` contra la subconsulta, que da NULL cuando no hay
-- fila, y contestaba «no es del centro» a algo que no existía (lo cazó la CI: multicurso, la FK
-- compuesta de matriculas sin aulas_curso).
--
-- La lista de pares sale del catálogo (`privado.centro_coherente_pares()`), no de una lista escrita
-- a mano: una FK nueva entre tablas con centro entra sola en la guarda posterior y en el test, que
-- fallan si no tiene su comprobación. La comprobación de cada tabla se GENERA aquí, con sus
-- columnas escritas: el trigger no lee el catálogo en cada escritura (coste medido en la CI).
--
-- Una tabla o una columna que no deba mirarse va en `privado.centro_coherente_excepciones`, con su
-- razón (CHECK de longitud): «esta no, y por esto», nunca un olvido. Hoy está vacía.
--
-- La segunda clase, en la misma migración: las tablas SIN `centro_id` que unen dos entidades con
-- centro (un niño de un centro en el aula de otro es el mismo daño que un informe cruzado). Salen
-- también del catálogo (`privado.centro_coherente_cruces()`: dos o más FK de una columna a tablas
-- con centro) y su trigger exige que todas las filas nombradas sean del mismo centro. Hoy son 4:
-- `confirmaciones_evento`, `firmas_autorizacion`, `profes_aulas` y `remesa_fichero_adeudos`.
-- `matriculas` va A MANO: une el niño (`nino_id`) con el aula-curso por una FK COMPUESTA
-- (`aula_id`, `curso_academico_id`) → `aulas_curso`, la única del esquema, y las dos funciones de
-- pares solo leen FK de una columna, así que para ellas `matriculas` tiene una sola FK con centro y
-- no une nada. La guarda posterior falla si aparece otra FK compuesta hacia una tabla con centro.
--
-- LO QUE ESTE MÉTODO NO VE (los números son un SUELO, no la cuenta cerrada). Medido en producción
-- el 2026-11-06, en el ensayo: 75 pares en 38 tablas (32 de ellas, con 63 pares, escribibles por una
-- sesión), 4 tablas de cruce (8 columnas) y `matriculas`: 43 triggers. Fuera quedan:
--   * las FK compuestas (hoy solo la de `matriculas`, cubierta a mano; una nueva rompe la guarda);
--   * las columnas que nombran algo SIN FK declarada: hoy 8 uuid en tablas con centro, todas
--     polimórficas (`audit_log.registro_id`, `cambios_pendientes.registro_id`, los `sujeto_id` de
--     accesos_datos_bloqueados, olvido_solicitudes, retenciones y export_log,
--     `retencion_ejecuciones.ref_id`, `invitaciones.token`); y los ids dentro de json o arrays;
--   * lo que llega a un centro a más de un salto (una tabla sin centro que apunta a otra sin centro);
--   * los esquemas que no son `public`.
-- Quien lea «75» que lo lea como «al menos estos, con FK de una columna en public».
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

-- ---- La segunda clase, del catálogo: tablas sin centro con dos o más FK a tablas con centro ----
CREATE FUNCTION privado.centro_coherente_cruces()
RETURNS TABLE (tabla text, columna text, ref text, ref_columna text)
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH fk AS (
    SELECT c.conrelid, c.conrelid::regclass::text AS tabla, a.attname::text AS columna,
           c.confrelid::regclass::text AS ref, ra.attname::text AS ref_columna
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      JOIN pg_catalog.pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = c.confkey[1]
     WHERE c.contype = 'f' AND cardinality(c.conkey) = 1
       AND c.connamespace = 'public'::regnamespace
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute x WHERE x.attrelid = c.conrelid
                          AND x.attname = 'centro_id' AND NOT x.attisdropped)
       AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute x WHERE x.attrelid = c.confrelid
                      AND x.attname = 'centro_id' AND NOT x.attisdropped)
  )
  SELECT f.tabla, f.columna, f.ref, f.ref_columna FROM fk f
   WHERE (SELECT count(*) FROM fk g WHERE g.conrelid = f.conrelid) >= 2
   ORDER BY 1, 2
$$;
REVOKE ALL ON FUNCTION privado.centro_coherente_cruces() FROM PUBLIC, anon, authenticated, service_role;

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
  v_cruces int := 0;
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
  -- Las tablas de cruce: filas cuyas dos referencias no son del mismo centro.
  FOR p IN SELECT a.tabla, a.columna AS c1, a.ref AS r1, a.ref_columna AS rc1,
                  b.columna AS c2, b.ref AS r2, b.ref_columna AS rc2
             FROM privado.centro_coherente_cruces() a
             JOIN privado.centro_coherente_cruces() b ON b.tabla = a.tabla AND a.columna < b.columna LOOP
    v_cruces := v_cruces + 1;
    EXECUTE format('SELECT count(*) FROM %s x JOIN %s r1 ON r1.%I = x.%I JOIN %s r2 ON r2.%I = x.%I
                     WHERE r1.centro_id IS DISTINCT FROM r2.centro_id',
                   p.tabla, p.r1, p.rc1, p.c1, p.r2, p.rc2, p.c2) INTO v_n;
    IF v_n > 0 THEN
      RAISE NOTICE 'incoherente: % filas de % (% ↔ %)', v_n, p.tabla, p.c1, p.c2;
    END IF;
    v_total := v_total + v_n;
  END LOOP;
  SELECT count(*) INTO v_n FROM public.matriculas m JOIN public.ninos n ON n.id = m.nino_id
    JOIN public.aulas_curso ac ON ac.aula_id = m.aula_id AND ac.curso_academico_id = m.curso_academico_id
   WHERE n.centro_id IS DISTINCT FROM ac.centro_id;
  RAISE NOTICE 'centro coherente: % pares de cruce y matriculas, % filas incoherentes en total', v_cruces, v_total + v_n;
  v_total := v_total + v_n;
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
        E'  IF NEW.%1$I IS NOT NULL AND EXISTS (SELECT 1 FROM %2$s r\n' ||
        E'     WHERE r.%3$I = NEW.%1$I AND r.centro_id IS DISTINCT FROM NEW.centro_id) THEN\n' ||
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

-- ---- La segunda clase: en cada tabla de cruce, todo lo que nombra es del mismo centro ----
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
      FROM privado.centro_coherente_cruces() p
     WHERE NOT EXISTS (SELECT 1 FROM privado.centro_coherente_excepciones e
                        WHERE e.tabla = p.tabla AND e.columna = p.columna)
     GROUP BY p.tabla
    HAVING count(*) >= 2
  LOOP
    v_cuerpo := '';
    FOR i IN 1 .. cardinality(t.columnas) - 1 LOOP
      FOR j IN i + 1 .. cardinality(t.columnas) LOOP
        v_cuerpo := v_cuerpo || format(
          E'  IF NEW.%1$I IS NOT NULL AND NEW.%4$I IS NOT NULL AND EXISTS (SELECT 1 FROM %2$s a, %5$s b\n' ||
          E'     WHERE a.%3$I = NEW.%1$I AND b.%6$I = NEW.%4$I AND a.centro_id IS DISTINCT FROM b.centro_id) THEN\n' ||
          E'    RAISE EXCEPTION %7$L USING ERRCODE = %8$L, HINT = %9$L;\n' ||
          E'  END IF;\n',
          t.columnas[i], t.refs[i], t.ref_cols[i], t.columnas[j], t.refs[j], t.ref_cols[j],
          format('%s: %s y %s no son del mismo centro', t.tabla, t.columnas[i], t.columnas[j]),
          '23514', 'centro_ajeno');
      END LOOP;
    END LOOP;
    v_fn := format('privado.%I', replace(t.tabla, 'public.', '') || '_centro_coherente');
    EXECUTE format(E'CREATE FUNCTION %s() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = %L AS $f$\nBEGIN\n%sRETURN NEW;\nEND\n$f$',
                   v_fn, '', v_cuerpo);
    EXECUTE format('REVOKE ALL ON FUNCTION %s() FROM PUBLIC, anon, authenticated, service_role', v_fn);
    SELECT string_agg(quote_ident(c), ', ') INTO v_cols FROM unnest(t.columnas) c;
    EXECUTE format('CREATE TRIGGER zz_centro_coherente BEFORE INSERT OR UPDATE OF %s ON %s FOR EACH ROW EXECUTE FUNCTION %s()',
                   v_cols, t.tabla, v_fn);
  END LOOP;
END
$genera$;

-- ---- matriculas, a mano ----
-- El niño y el aula-curso, del mismo centro. No la cubre ninguna de las dos funciones de pares: el
-- aula-curso se nombra por una FK compuesta (`aula_id`, `curso_academico_id`) → `aulas_curso`, y
-- las funciones solo leen FK de una columna (con ellas, `matriculas` tiene una sola FK con centro, la
-- del niño, y no une nada). Es la única FK compuesta del esquema; la guarda posterior falla si hay otra.
CREATE FUNCTION privado.matriculas_centro_coherente()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
BEGIN
  IF NEW.nino_id IS NOT NULL AND NEW.aula_id IS NOT NULL AND NEW.curso_academico_id IS NOT NULL AND
     EXISTS (SELECT 1 FROM public.ninos n, public.aulas_curso ac
              WHERE n.id = NEW.nino_id AND ac.aula_id = NEW.aula_id
                AND ac.curso_academico_id = NEW.curso_academico_id
                AND n.centro_id IS DISTINCT FROM ac.centro_id) THEN
    RAISE EXCEPTION 'public.matriculas: nino_id y (aula_id, curso_academico_id) no son del mismo centro'
      USING ERRCODE = '23514', HINT = 'centro_ajeno';
  END IF;
  RETURN NEW;
END
$f$;
REVOKE ALL ON FUNCTION privado.matriculas_centro_coherente() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER zz_centro_coherente BEFORE INSERT OR UPDATE OF nino_id, aula_id, curso_academico_id
  ON public.matriculas FOR EACH ROW EXECUTE FUNCTION privado.matriculas_centro_coherente();

-- ---- Guarda posterior: cada par, mirado o con su excepción ----
DO $guarda$
DECLARE
  v_sin int;
  v_tablas int;
  v_cruces int;
  v_comp int;
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
          AND f.prosrc LIKE '%NEW.' || p.columna || ' IS NOT NULL AND EXISTS%');
  SELECT count(DISTINCT tabla) INTO v_tablas FROM privado.centro_coherente_pares();
  RAISE NOTICE 'centro coherente: % tablas, % pares sin comprobación ni excepción', v_tablas, v_sin;
  IF v_sin > 0 THEN
    RAISE EXCEPTION '% pares sin comprobación ni excepción', v_sin;
  END IF;
  -- Las tablas de cruce: cada pareja de columnas, en su función y en el UPDATE OF de su trigger.
  SELECT count(*) INTO v_sin
    FROM privado.centro_coherente_cruces() a
    JOIN privado.centro_coherente_cruces() b ON b.tabla = a.tabla AND a.columna < b.columna
   WHERE NOT EXISTS (SELECT 1 FROM privado.centro_coherente_excepciones e
                      WHERE e.tabla = a.tabla AND e.columna IN (a.columna, b.columna))
     AND NOT EXISTS (
       SELECT 1 FROM pg_trigger tg JOIN pg_proc f ON f.oid = tg.tgfoid
        WHERE tg.tgrelid = a.tabla::regclass AND tg.tgname = 'zz_centro_coherente'
          AND tg.tgenabled = 'O' AND f.prosecdef
          AND pg_get_triggerdef(tg.oid) ~ ('UPDATE OF .*\m' || a.columna || '\M')
          AND pg_get_triggerdef(tg.oid) ~ ('UPDATE OF .*\m' || b.columna || '\M')
          AND f.prosrc LIKE '%NEW.' || a.columna || ' IS NOT NULL AND NEW.' || b.columna || ' IS NOT NULL AND EXISTS%');
  SELECT count(DISTINCT tabla) INTO v_cruces FROM privado.centro_coherente_cruces();
  RAISE NOTICE 'centro coherente: % tablas de cruce, % parejas sin comprobación ni excepción', v_cruces, v_sin;
  IF v_sin > 0 THEN
    RAISE EXCEPTION '% parejas de cruce sin comprobación ni excepción', v_sin;
  END IF;
  -- El límite del método, vigilado: la única FK compuesta hacia una tabla con centro es la de
  -- matriculas, y su comprobación a mano está puesta.
  SELECT count(*) INTO v_comp FROM pg_constraint c
   WHERE c.contype = 'f' AND cardinality(c.conkey) > 1 AND c.connamespace = 'public'::regnamespace
     AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = c.confrelid
                    AND x.attname = 'centro_id' AND NOT x.attisdropped);
  RAISE NOTICE 'centro coherente: % FK compuestas hacia tablas con centro (esperada 1, matriculas)', v_comp;
  IF v_comp <> 1 OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matriculas_aula_curso_fkey'
                                  AND conrelid = 'public.matriculas'::regclass) THEN
    RAISE EXCEPTION 'FK compuestas hacia tablas con centro: % (esperada solo matriculas_aula_curso_fkey); las funciones de pares no las ven', v_comp;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_proc f ON f.oid = tg.tgfoid
                  WHERE tg.tgrelid = 'public.matriculas'::regclass AND tg.tgname = 'zz_centro_coherente'
                    AND tg.tgenabled = 'O' AND f.prosecdef
                    AND f.proname = 'matriculas_centro_coherente') THEN
    RAISE EXCEPTION 'matriculas sin su zz_centro_coherente';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname = 'zz_centro_coherente') <> v_tablas + v_cruces + 1 THEN
    RAISE EXCEPTION 'esperaba un zz_centro_coherente por tabla: % con pares, % de cruce y matriculas', v_tablas, v_cruces;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid = f.pronamespace
              WHERE n.nspname = 'privado' AND f.proname LIKE '%\_centro\_coherente'
                AND (has_function_privilege('authenticated', f.oid, 'EXECUTE')
                     OR has_function_privilege('anon', f.oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'una función de centro coherente es ejecutable por authenticated o anon';
  END IF;
END
$guarda$;
