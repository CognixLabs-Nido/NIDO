-- =============================================================================
-- FIX B (bug "alta del 2º hijo de un tutor existente") — detección EXACTA del
--        tutor por email, sin paginación.
-- -----------------------------------------------------------------------------
-- Los flujos de alta (crearTutorDirecto, invitarAlAlta, acceptInvitation) detectan
-- si el email ya tiene cuenta con `service.auth.admin.listUsers()` SIN paginar, que
-- solo devuelve la 1.ª página (perPage=50). Con >50 usuarios en `auth.users` la
-- detección es ERRÁTICA: un tutor que cae más allá de la página 1 "no existe" para el
-- flujo → o bien `createUser` falla con 422 (email exists) o bien la RPC de familia
-- entra en COLISIÓN. Esta función lo sustituye por una búsqueda directa por email:
-- exacta, O(1) por índice, robusta con cualquier número de usuarios.
--
-- SEGURIDAD (SECURITY DEFINER que lee `auth.users` = sensible):
--   * Devuelve SOLO lo mínimo: `id` (uuid) y `email` (text). NUNCA el hash de
--     contraseña, metadata, teléfono, tokens ni ninguna otra columna de auth.users.
--   * `search_path` fijo y `auth.users` cualificado por schema (no secuestrable).
--   * EXECUTE **revocado a PUBLIC** (anon/authenticated NO pueden invocarla → no es un
--     oráculo de enumeración de cuentas para usuarios finales) y **concedido solo a
--     `service_role`**: la usan exclusivamente los flujos de alta server-side, que ya
--     corren con la service key (createServiceRoleClient). El gate de autorización de
--     negocio (es_admin del centro) lo aplican esas actions ANTES de llamar aquí.
--   * Filtra `deleted_at IS NULL` para espejar el comportamiento de `listUsers`
--     (no considera cuentas borradas). Comparación case-insensitive (GoTrue guarda el
--     email normalizado, pero `lower()` en ambos lados lo blinda). LIMIT 1 determinista.
--
-- ALCANCE: esto SOLO mejora la DETECCIÓN. NO cambia qué se hace al detectar al tutor
-- existente (los flujos lo siguen rechazando: email_already_registered /
-- tutor_ya_registrado_usar_anadir_hijo). El camino feliz de vinculación es el FIX A
-- (PR posterior). Aquí el terreno queda listo para A.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.buscar_auth_user_por_email(p_email text)
 RETURNS TABLE (id uuid, email text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = ''
AS $function$
  SELECT u.id, u.email::text
    FROM auth.users u
   WHERE lower(u.email) = lower(p_email)
     AND u.deleted_at IS NULL
   ORDER BY u.created_at
   LIMIT 1;
$function$;

-- EXECUTE: cerrar el acceso a todos salvo service_role. OJO gotcha Supabase: el rol creador
-- (postgres) tiene `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon,
-- authenticated, service_role`, así que cada función nueva de `public` nace con EXECUTE
-- concedido DIRECTAMENTE a anon/authenticated (no vía PUBLIC). Revocar solo de PUBLIC NO basta;
-- hay que revocar EXPLÍCITAMENTE de anon y authenticated para que no sean un oráculo de
-- enumeración de cuentas. Solo service_role (flujos de alta server-side) puede invocarla.
REVOKE ALL ON FUNCTION public.buscar_auth_user_por_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_auth_user_por_email(text) TO service_role;

COMMIT;
