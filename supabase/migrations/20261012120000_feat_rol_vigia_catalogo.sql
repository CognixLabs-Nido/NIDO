-- =============================================================================
-- Rol de solo lectura del job vigía de producción (suite a efímera, PR 2).
--
-- El job vigía compara el catálogo de producción con el que sale de aplicar el repo en una BD
-- efímera, el registro de migraciones y la configuración. Necesita leer:
--   - el catálogo (pg_catalog): funciones con su cuerpo, permisos, policies, triggers, columnas,
--     constraints, tipos y privilegios por defecto. PUBLIC ya puede leerlo; no hace falta GRANT.
--   - supabase_migrations.schema_migrations (versión y nombre);
--   - storage.buckets (configuración de los buckets);
--   - los NOMBRES de los secretos de Vault (nunca su valor).
-- Las tres últimas, solo a través de tres funciones del esquema vigia: el rol no recibe USAGE
-- en supabase_migrations, storage ni vault, ni SELECT sobre ninguna tabla.
--
-- Supabase ya trae supabase_read_only_user, pero no sirve: es miembro de pg_read_all_data y
-- tiene BYPASSRLS (lee todos los datos de negocio).
--
-- SIN CONTRASEÑA: el rol nace con LOGIN pero sin contraseña, así que no puede conectarse hasta
-- que el responsable fije una aparte (ALTER ROLE … PASSWORD con el verificador SCRAM, nunca la
-- contraseña en claro; ver docs/vigia-credencial.md). La contraseña no está en el repo.
--
-- Idempotente (la BD efímera de cada PR la aplica en limpio; un `db reset` local conserva los
-- roles del clúster): crea el rol si no existe y fija sus atributos siempre.
-- =============================================================================

-- 0. Guarda de entrada: si el rol ya existe, que sea el nuestro (sin pertenencias ni poderes).
DO $$
DECLARE
  f text[] := '{}';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_catalogo') THEN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_catalogo'
                AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) THEN
      f := f || 'vigia_catalogo ya existe con poderes'::text;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
                WHERE r.rolname = 'vigia_catalogo') THEN
      f := f || 'vigia_catalogo ya existe y es miembro de otro rol'::text;
    END IF;
  END IF;
  IF cardinality(f) > 0 THEN
    RAISE EXCEPTION 'guarda de entrada: %', array_to_string(f, ' | ');
  END IF;
END $$;

-- 1. El rol.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_catalogo') THEN
    CREATE ROLE vigia_catalogo WITH LOGIN;
  END IF;
END $$;

ALTER ROLE vigia_catalogo WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION
  NOBYPASSRLS CONNECTION LIMIT 3;
-- Cinturón además de los permisos: toda transacción nace de solo lectura y no se eterniza.
ALTER ROLE vigia_catalogo SET default_transaction_read_only = on;
ALTER ROLE vigia_catalogo SET statement_timeout = '30s';
ALTER ROLE vigia_catalogo SET idle_in_transaction_session_timeout = '60s';

COMMENT ON ROLE vigia_catalogo IS
  'Job vigía de producción (CI): solo lee el catálogo y las 3 funciones de vigia. Sin datos de negocio, sin escritura.';

-- 2. Esquema propio, cerrado a todos menos al rol.
CREATE SCHEMA IF NOT EXISTS vigia;
REVOKE ALL ON SCHEMA vigia FROM PUBLIC;
GRANT USAGE ON SCHEMA vigia TO vigia_catalogo;

COMMENT ON SCHEMA vigia IS
  'Funciones de solo lectura para el job vigía (rol vigia_catalogo). No se expone por la API.';

-- 3. Lo que el catálogo no da: tres funciones SECURITY DEFINER que devuelven solo metadatos.
CREATE OR REPLACE FUNCTION vigia.migraciones()
RETURNS TABLE (version text, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  SELECT m.version::text, m.name::text
    FROM supabase_migrations.schema_migrations m
   ORDER BY m.version;
$fn$;

CREATE OR REPLACE FUNCTION vigia.buckets()
RETURNS TABLE (id text, name text, publico boolean, file_size_limit bigint, allowed_mime_types text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  SELECT b.id::text, b.name::text, b.public, b.file_size_limit::bigint, b.allowed_mime_types::text[]
    FROM storage.buckets b
   ORDER BY b.id;
$fn$;

-- Solo el nombre: ni el secreto cifrado, ni su nonce, ni la descripción.
CREATE OR REPLACE FUNCTION vigia.secretos_vault()
RETURNS TABLE (name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  SELECT s.name::text
    FROM vault.secrets s
   WHERE s.name IS NOT NULL
   ORDER BY s.name;
$fn$;

REVOKE ALL ON FUNCTION vigia.migraciones() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION vigia.buckets() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION vigia.secretos_vault() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION vigia.migraciones() TO vigia_catalogo;
GRANT EXECUTE ON FUNCTION vigia.buckets() TO vigia_catalogo;
GRANT EXECUTE ON FUNCTION vigia.secretos_vault() TO vigia_catalogo;

-- 4. Guarda de salida: lo que el rol puede y lo que no, comprobado con has_*_privilege.
DO $guarda$
DECLARE
  f   text[] := '{}';
  r   record;
  v_n int;
BEGIN
  -- Atributos y pertenencias.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_catalogo' AND rolcanlogin
                   AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb
                   AND NOT rolreplication AND NOT rolinherit AND rolconnlimit = 3) THEN
    f := f || 'atributos del rol'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r2 ON r2.oid = m.member
              WHERE r2.rolname = 'vigia_catalogo') THEN
    f := f || 'el rol es miembro de otro rol'::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r2 ON r2.oid = s.setrole
                  WHERE r2.rolname = 'vigia_catalogo' AND s.setdatabase = 0
                    AND 'default_transaction_read_only=on' = ANY (s.setconfig)) THEN
    f := f || 'falta default_transaction_read_only=on'::text;
  END IF;

  -- Ninguna tabla, vista o secuencia de ningún esquema: ni leer ni escribir.
  SELECT count(*) INTO v_n
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND has_schema_privilege('vigia_catalogo', n.oid, 'USAGE')
     AND (has_table_privilege('vigia_catalogo', c.oid, 'SELECT')
       OR has_table_privilege('vigia_catalogo', c.oid, 'INSERT')
       OR has_table_privilege('vigia_catalogo', c.oid, 'UPDATE')
       OR has_table_privilege('vigia_catalogo', c.oid, 'DELETE')
       OR has_table_privilege('vigia_catalogo', c.oid, 'TRUNCATE'));
  IF v_n > 0 THEN f := f || format('%s tablas o vistas fuera del catálogo accesibles', v_n); END IF;
  SELECT count(*) INTO v_n
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind = 'S' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND has_schema_privilege('vigia_catalogo', n.oid, 'USAGE')
     AND (has_sequence_privilege('vigia_catalogo', c.oid, 'SELECT')
       OR has_sequence_privilege('vigia_catalogo', c.oid, 'USAGE')
       OR has_sequence_privilege('vigia_catalogo', c.oid, 'UPDATE'));
  IF v_n > 0 THEN f := f || format('%s secuencias accesibles', v_n); END IF;
  SELECT count(*) INTO v_n
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p', 'v', 'm') AND n.nspname IN ('pg_catalog', 'information_schema')
     -- pg_settings: UPDATE de PUBLIC es de serie en Postgres y equivale a SET en la propia
     -- sesión (solo parámetros de usuario); no escribe nada que dure.
     AND c.oid <> 'pg_catalog.pg_settings'::regclass
     AND (has_table_privilege('vigia_catalogo', c.oid, 'INSERT')
       OR has_table_privilege('vigia_catalogo', c.oid, 'UPDATE')
       OR has_table_privilege('vigia_catalogo', c.oid, 'DELETE')
       OR has_table_privilege('vigia_catalogo', c.oid, 'TRUNCATE'));
  IF v_n > 0 THEN f := f || format('%s tablas del catálogo escribibles', v_n); END IF;

  -- Esquemas: USAGE solo en pg_catalog, information_schema, public (de PUBLIC) y vigia; CREATE en ninguno.
  FOR r IN SELECT n.nspname FROM pg_namespace n
            WHERE n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
              AND (has_schema_privilege('vigia_catalogo', n.oid, 'CREATE')
                OR (has_schema_privilege('vigia_catalogo', n.oid, 'USAGE')
                    AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'public', 'vigia'))) LOOP
    f := f || format('esquema %s accesible', r.nspname);
  END LOOP;

  -- Funciones SECURITY DEFINER ejecutables: exactamente las tres de vigia (las demás de PUBLIC
  -- son de trigger y no se pueden llamar).
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.prosecdef AND p.prorettype <> 'trigger'::regtype
     AND has_schema_privilege('vigia_catalogo', n.oid, 'USAGE')
     AND has_function_privilege('vigia_catalogo', p.oid, 'EXECUTE')
     AND p.oid NOT IN ('vigia.migraciones()'::regprocedure, 'vigia.buckets()'::regprocedure,
                       'vigia.secretos_vault()'::regprocedure);
  IF v_n > 0 THEN f := f || format('%s funciones SECURITY DEFINER ajenas ejecutables', v_n); END IF;

  -- Las tres de vigia: solo el rol (ni anon, ni authenticated, ni service_role).
  IF has_function_privilege('anon', 'vigia.secretos_vault()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'vigia.secretos_vault()', 'EXECUTE')
     OR has_function_privilege('service_role', 'vigia.secretos_vault()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'vigia.migraciones()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'vigia.buckets()', 'EXECUTE')
     OR NOT has_function_privilege('vigia_catalogo', 'vigia.secretos_vault()', 'EXECUTE')
     OR NOT has_function_privilege('vigia_catalogo', 'vigia.migraciones()', 'EXECUTE')
     OR NOT has_function_privilege('vigia_catalogo', 'vigia.buckets()', 'EXECUTE') THEN
    f := f || 'permisos de las funciones de vigia'::text;
  END IF;

  IF cardinality(f) > 0 THEN
    RAISE EXCEPTION 'guarda de salida: %', array_to_string(f, ' | ');
  END IF;
END $guarda$;
