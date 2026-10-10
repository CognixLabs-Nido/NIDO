-- =============================================================================
-- FIX — privilegios de TABLA: nada para anon, sin TRUNCATE/MAINTAIN para authenticated, y la
-- causa raíz (default privileges de postgres en public) cerrada
-- -----------------------------------------------------------------------------
-- Estado en producción (2026-10-10, solo lectura):
--   · anon tenía INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER y MAINTAIN en 72 de las 73
--     tablas de public (todas menos audit_log, cerrada en #283) y SELECT en 71 (menos audit_log y
--     matriculas). La RLS frena las filas, pero TRUNCATE y MAINTAIN (VACUUM, REINDEX, CLUSTER,
--     LOCK TABLE…) no pasan por RLS: es el agujero de audit_log (#283) replicado en 72 tablas.
--   · authenticated tenía TRUNCATE y MAINTAIN en las mismas 72.
--   · La causa: los default privileges de postgres en public conceden arwdDxtm a anon en cada
--     tabla nueva, EXECUTE en cada función nueva y rwU en cada secuencia nueva. Cada migración
--     volvía a abrir lo que se había cerrado.
--
-- Qué necesita cada rol:
--   · anon: NADA. Todo lo previo al login (auth_attempts, /invitation/[token], aceptar
--     invitación) va con service_role; ninguna ruta pública lee ni escribe tablas sin sesión.
--   · authenticated: SELECT/INSERT/UPDATE/DELETE (acotados por la RLS) — no se tocan. TRUNCATE y
--     MAINTAIN no los usa nadie (PostgREST no los expone y la app no los emite). REFERENCES y
--     TRIGGER se quedan (authenticated no puede crear funciones en public).
--   · service_role: intacto.
--
-- Cambios:
--   1. REVOKE ALL de anon (y PUBLIC) en todas las tablas de public.
--   2. REVOKE TRUNCATE, MAINTAIN de authenticated en todas las tablas de public.
--   3. Default privileges de postgres: las tablas, funciones y secuencias nuevas en public ya no
--      nacen abiertas a anon, ni las tablas con TRUNCATE/MAINTAIN para authenticated. EXECUTE de
--      PUBLIC en funciones es un default GLOBAL de Postgres (no por esquema): se quita a nivel
--      global para las funciones que cree postgres; authenticated y service_role lo siguen
--      recibiendo por el default de public.
--   4. Guarda: aborta si anon conserva cualquier privilegio (tabla o columna) en alguna tabla de
--      public, si authenticated conserva TRUNCATE/MAINTAIN, si authenticated o service_role
--      pierden algún privilegio que no se pretendía quitar, o si los default privileges siguen
--      dando algo a anon/PUBLIC o TRUNCATE/MAINTAIN a authenticated.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor (CLI SIGILL
-- en ARM). Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- 0. Foto previa de lo que NO debe cambiar (authenticated sin TRUNCATE/MAINTAIN, y service_role).
CREATE TEMP TABLE _priv_antes AS
SELECT r.rol, c.oid AS tabla, p.priv
  FROM pg_class c
 CROSS JOIN (VALUES ('authenticated'), ('service_role')) r(rol)
 CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'),
                    ('TRIGGER'), ('MAINTAIN')) p(priv)
 WHERE c.relnamespace = 'public'::regnamespace
   AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
   AND has_table_privilege(r.rol, c.oid, p.priv)
   AND NOT (r.rol = 'authenticated' AND p.priv IN ('TRUNCATE', 'MAINTAIN'));

-- 1. anon: nada en ninguna tabla de public (revoca también los privilegios por columna).
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon;

-- 2. authenticated: sin TRUNCATE ni MAINTAIN (no pasan por RLS).
REVOKE TRUNCATE, MAINTAIN ON ALL TABLES IN SCHEMA public FROM authenticated;

-- 3. La causa raíz: default privileges de postgres.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE, MAINTAIN ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
-- EXECUTE para PUBLIC es un default global de Postgres: solo se puede quitar sin IN SCHEMA.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- 4. Guarda
DO $$
DECLARE
  v_anon       text;
  v_anon_col   text;
  v_auth_tm    text;
  v_perdidos   text;
  v_defacl     text;
  v_func_pub   boolean;
BEGIN
  -- anon (o PUBLIC) con algún privilegio de tabla en public
  SELECT string_agg(DISTINCT c.relname || ':' || p.priv || '(' || r.rol || ')', ', ')
    INTO v_anon
    FROM pg_class c
   CROSS JOIN (VALUES ('anon'), ('public')) r(rol)
   CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'),
                      ('TRIGGER'), ('MAINTAIN')) p(priv)
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND has_table_privilege(r.rol, c.oid, p.priv);

  -- anon con privilegios por columna
  SELECT string_agg(DISTINCT table_name, ', ') INTO v_anon_col
    FROM information_schema.column_privileges
   WHERE table_schema = 'public' AND grantee IN ('anon', 'PUBLIC');

  -- authenticated con TRUNCATE o MAINTAIN
  SELECT string_agg(DISTINCT c.relname || ':' || p.priv, ', ')
    INTO v_auth_tm
    FROM pg_class c
   CROSS JOIN (VALUES ('TRUNCATE'), ('MAINTAIN')) p(priv)
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND has_table_privilege('authenticated', c.oid, p.priv);

  -- privilegios de authenticated o service_role que no se pretendía quitar
  SELECT string_agg(a.tabla::regclass::text || ':' || a.priv || '(' || a.rol || ')', ', ')
    INTO v_perdidos
    FROM _priv_antes a
   WHERE NOT has_table_privilege(a.rol, a.tabla, a.priv);

  -- default privileges de postgres en public que sigan dando algo a anon/PUBLIC, o
  -- TRUNCATE (D) / MAINTAIN (m) a authenticated en tablas
  SELECT string_agg(d.defaclobjtype::text || ' ' || coalesce(pg_get_userbyid(x.grantee), 'PUBLIC') || ' ' || x.privilege_type, ', ')
    INTO v_defacl
    FROM pg_default_acl d
   CROSS JOIN LATERAL aclexplode(d.defaclacl) x
   WHERE d.defaclrole = 'postgres'::regrole
     AND d.defaclnamespace IN (0, 'public'::regnamespace)
     AND (x.grantee IN (0, 'anon'::regrole)
          OR (x.grantee = 'authenticated'::regrole AND d.defaclobjtype = 'r'
              AND x.privilege_type IN ('TRUNCATE', 'MAINTAIN')));

  -- EXECUTE para PUBLIC en funciones nuevas de postgres: tiene que existir la entrada global que
  -- lo quita (sin ella, el default de Postgres concede EXECUTE a PUBLIC y anon lo hereda).
  SELECT EXISTS (
           SELECT 1 FROM pg_default_acl d
            WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 0
              AND d.defaclobjtype = 'f'
              AND NOT EXISTS (SELECT 1 FROM aclexplode(d.defaclacl) x
                               WHERE x.grantee = 0 AND x.privilege_type = 'EXECUTE'))
    INTO v_func_pub;

  IF v_anon IS NOT NULL OR v_anon_col IS NOT NULL OR v_auth_tm IS NOT NULL
     OR v_perdidos IS NOT NULL OR v_defacl IS NOT NULL OR NOT v_func_pub THEN
    RAISE EXCEPTION 'guarda: anon conserva [%]; anon por columna [%]; authenticated TRUNCATE/MAINTAIN [%]; perdidos [%]; default privileges [%]; EXECUTE global de PUBLIC quitado: %',
      coalesce(v_anon, ''), coalesce(v_anon_col, ''), coalesce(v_auth_tm, ''),
      coalesce(v_perdidos, ''), coalesce(v_defacl, ''), v_func_pub;
  END IF;
END $$;

DROP TABLE _priv_antes;
