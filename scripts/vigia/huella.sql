-- Huella del catálogo para el job vigía (.github/workflows/nocturna.yml).
--
-- Se ejecuta IGUAL en producción y en la BD efímera construida desde main, las dos veces como el
-- rol vigia_catalogo (migración 20261012120000): mismo rol, misma visibilidad. Solo lee el
-- catálogo y las funciones del esquema vigia; ningún dato de negocio.
--
-- Una fila por aspecto de cada objeto: «tipo<TAB>objeto<TAB>md5». El comparador
-- (scripts/vigia/comparar-huellas.mjs) dice qué tipo y qué objeto difieren; las definiciones no
-- salen nunca del runner, solo su md5.
--
-- Alcance: lo que crean las migraciones del repo. Los esquemas de la plataforma (auth, storage,
-- realtime…) cambian con la versión de Supabase y meterían ruido, así que de ellos solo entra lo
-- que tocan nuestras migraciones: policies de storage, buckets y triggers sobre auth.users.
--
-- Los cuerpos de función se comparan NORMALIZADOS (sin \r, sin comentarios `--`, espacios
-- colapsados): el SQL Editor guarda CRLF y a veces se come comentarios (regla de CLAUDE.md).
WITH
esquemas AS (
  SELECT oid, nspname FROM pg_namespace WHERE nspname IN ('public', 'vigia')
),
-- Objetos que pertenecen a una extensión: no son nuestros.
de_extension AS (
  SELECT objid FROM pg_depend WHERE deptype = 'e'
),
-- Las ACL se normalizan a «rol:privilegio[*]» ordenado; una ACL NULL es la de por defecto.
funciones AS (
  SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS ident, p.*
    FROM pg_proc p JOIN esquemas n ON n.oid = p.pronamespace
   WHERE p.oid NOT IN (SELECT objid FROM de_extension)
),
tablas AS (
  SELECT n.nspname || '.' || c.relname AS ident, c.*
    FROM pg_class c JOIN esquemas n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
     AND c.oid NOT IN (SELECT objid FROM de_extension)
),
filas AS (
  -- Funciones: cuerpo normalizado, firma y comportamiento, permisos.
  SELECT 'funcion.cuerpo' AS tipo, f.ident AS objeto,
         md5(btrim(regexp_replace(regexp_replace(replace(f.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))) AS h
    FROM funciones f
  UNION ALL
  SELECT 'funcion.definicion', f.ident,
         md5(concat_ws('|', pg_get_function_result(f.oid), (SELECT lanname FROM pg_language WHERE oid = f.prolang),
                       f.prokind, f.provolatile, f.proisstrict, f.proleakproof, f.proparallel))
    FROM funciones f
  UNION ALL
  SELECT 'funcion.security_definer', f.ident, md5(concat_ws('|', f.prosecdef, pg_get_userbyid(f.proowner)))
    FROM funciones f
  UNION ALL
  SELECT 'funcion.config', f.ident, md5(coalesce(array_to_string(ARRAY(SELECT unnest(f.proconfig) ORDER BY 1), ','), ''))
    FROM funciones f
  UNION ALL
  SELECT 'funcion.permisos', f.ident,
         md5(coalesce((SELECT string_agg(coalesce(nullif(pg_get_userbyid(a.grantee), '-'), 'PUBLIC') || ':' || a.privilege_type
                                         || CASE WHEN a.is_grantable THEN '*' ELSE '' END, ',' ORDER BY 1)
                         FROM aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a), ''))
    FROM funciones f
  UNION ALL
  -- Tablas, vistas y secuencias: existencia y RLS; permisos de tabla y de columna.
  SELECT 'tabla', t.ident, md5(concat_ws('|', t.relkind, t.relrowsecurity, t.relforcerowsecurity, pg_get_userbyid(t.relowner)))
    FROM tablas t
  UNION ALL
  SELECT 'tabla.permisos', t.ident,
         md5(coalesce((SELECT string_agg(coalesce(nullif(pg_get_userbyid(a.grantee), '-'), 'PUBLIC') || ':' || a.privilege_type
                                         || CASE WHEN a.is_grantable THEN '*' ELSE '' END, ',' ORDER BY 1)
                         FROM aclexplode(coalesce(t.relacl, acldefault((CASE WHEN t.relkind = 'S' THEN 's' ELSE 'r' END)::"char", t.relowner))) a), ''))
    FROM tablas t
  UNION ALL
  SELECT 'columna', t.ident || '.' || a.attname,
         md5(concat_ws('|', format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attidentity, a.attgenerated,
                       pg_get_expr(d.adbin, d.adrelid),
                       (SELECT string_agg(coalesce(nullif(pg_get_userbyid(x.grantee), '-'), 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY 1)
                          FROM aclexplode(a.attacl) x)))
    FROM tablas t
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE t.relkind IN ('r', 'p', 'v', 'm', 'f')
  UNION ALL
  -- Constraints e índices.
  SELECT 'constraint', t.ident || '.' || co.conname, md5(pg_get_constraintdef(co.oid))
    FROM tablas t JOIN pg_constraint co ON co.conrelid = t.oid
  UNION ALL
  SELECT 'indice', t.ident || '.' || i.relname, md5(pg_get_indexdef(i.oid))
    FROM tablas t JOIN pg_index x ON x.indrelid = t.oid JOIN pg_class i ON i.oid = x.indexrelid
  UNION ALL
  -- Tipos enumerados: sus valores en orden.
  SELECT 'enum', n.nspname || '.' || ty.typname,
         md5((SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = ty.oid))
    FROM pg_type ty JOIN esquemas n ON n.oid = ty.typnamespace
   WHERE ty.typtype = 'e' AND ty.oid NOT IN (SELECT objid FROM de_extension)
  UNION ALL
  -- Triggers de nuestras tablas y los que nuestras migraciones ponen en auth.users y storage.
  SELECT 'trigger', cn.nspname || '.' || c.relname || '.' || tg.tgname,
         md5(concat_ws('|', pg_get_triggerdef(tg.oid), tg.tgenabled))
    FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_namespace cn ON cn.oid = c.relnamespace
    JOIN pg_proc tp ON tp.oid = tg.tgfoid JOIN pg_namespace tpn ON tpn.oid = tp.pronamespace
   WHERE NOT tg.tgisinternal
     AND (cn.nspname IN ('public', 'vigia') OR tpn.nspname IN ('public', 'vigia'))
  UNION ALL
  -- Policies de nuestras tablas y de storage (objects y buckets).
  SELECT 'policy', pn.nspname || '.' || pc.relname || '.' || po.polname,
         md5(concat_ws('|', po.polcmd, po.polpermissive,
                       (SELECT string_agg(CASE WHEN r = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END, ',' ORDER BY 1) FROM unnest(po.polroles) r),
                       regexp_replace(coalesce(pg_get_expr(po.polqual, po.polrelid), ''), '\s+', ' ', 'g'),
                       regexp_replace(coalesce(pg_get_expr(po.polwithcheck, po.polrelid), ''), '\s+', ' ', 'g')))
    FROM pg_policy po JOIN pg_class pc ON pc.oid = po.polrelid JOIN pg_namespace pn ON pn.oid = pc.relnamespace
   WHERE pn.nspname IN ('public', 'vigia', 'storage')
  UNION ALL
  -- Privilegios por defecto de los roles que crean objetos en nuestras migraciones.
  SELECT 'default_privileges', pg_get_userbyid(da.defaclrole) || '.' || coalesce(dn.nspname, '*') || '.' || da.defaclobjtype::text,
         md5(coalesce((SELECT string_agg(coalesce(nullif(pg_get_userbyid(a.grantee), '-'), 'PUBLIC') || ':' || a.privilege_type
                                         || CASE WHEN a.is_grantable THEN '*' ELSE '' END, ',' ORDER BY 1)
                         FROM aclexplode(da.defaclacl) a), ''))
    FROM pg_default_acl da LEFT JOIN pg_namespace dn ON dn.oid = da.defaclnamespace
   WHERE pg_get_userbyid(da.defaclrole) = 'postgres'
  UNION ALL
  -- Buckets de Storage (configuración, nunca objetos), a través de la función del rol.
  SELECT 'bucket', b.id, md5(concat_ws('|', b.name, b.publico, b.file_size_limit, array_to_string(b.allowed_mime_types, ',')))
    FROM vigia.buckets() b
)
SELECT tipo || E'\t' || objeto || E'\t' || h FROM filas ORDER BY tipo, objeto;
