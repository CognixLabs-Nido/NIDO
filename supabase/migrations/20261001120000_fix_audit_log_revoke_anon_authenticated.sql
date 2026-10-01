-- =============================================================================
-- FIX — audit_log append-only también por GRANT (anon/authenticated)
-- -----------------------------------------------------------------------------
-- PROBLEMA. Los default privileges de Supabase dieron a anon y authenticated TODO sobre
-- audit_log (arwdDxtm). El append-only descansaba solo en RLS (una única policy, SELECT
-- para admin; sin policy de INSERT/UPDATE/DELETE → denegados). Pero TRUNCATE y MAINTAIN
-- (PG17: LOCK TABLE, VACUUM, REINDEX…) NO pasan por RLS: con un camino SQL directo como
-- authenticated se podría vaciar la tabla o bloquearla (ACCESS EXCLUSIVE congela toda
-- escritura auditada). Hoy no explotable (PostgREST no expone TRUNCATE ni LOCK); agujero
-- latente.
--
-- QUIÉN ESCRIBE DE VERDAD (verificado en el remoto, 1-oct-2026):
--   · audit_trigger_function → todos los INSERT. SECURITY DEFINER, dueña postgres.
--   · purgar_sujeto_db       → único UPDATE/DELETE. SECURITY DEFINER, dueña postgres.
--   · wipe/teardowns de tests y purga documentada → service_role / postgres.
--   · la app solo LEE (admin/audit/page.tsx, como authenticated).
-- Ninguno usa privilegios de escritura de anon/authenticated → revocarlos no rompe nada.
--
-- CAMBIO. A anon y authenticated se les revoca TRUNCATE, MAINTAIN, UPDATE, DELETE,
-- INSERT, REFERENCES y TRIGGER. A anon además SELECT (la policy ya le daba 0 filas).
-- authenticated CONSERVA SELECT (página de auditoría del admin, filtrada por RLS).
-- postgres y service_role NO se tocan (siguen con arwdDxtm).
--
-- Efecto visible: UPDATE/DELETE de un usuario por PostgREST pasa de "0 filas, sin error"
-- (RLS) a error 42501 (permission denied). audit-log.rls.test.ts se ajusta a eso.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor (CLI SIGILL
-- en ARM). Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

REVOKE TRUNCATE, MAINTAIN, UPDATE, DELETE, INSERT, REFERENCES, TRIGGER
  ON public.audit_log FROM anon, authenticated;

REVOKE SELECT ON public.audit_log FROM anon;
