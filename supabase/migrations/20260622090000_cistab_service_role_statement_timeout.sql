-- CI-stability (Ola 1) — sube el statement_timeout de `service_role` a 60s.
--
-- Problema: el job de test corre la suite RLS/audit (~150 ficheros) contra la BD
-- remota COMPARTIDA vía `service_role` (PostgREST). `service_role` no tenía
-- statement_timeout propio → heredaba los 8s del rol `authenticator` del login.
-- Bajo contención (varios runs de CI golpeando la misma BD a la vez) los RPC
-- pesados (`purgar_sujeto_db`) y los INSERT con triggers de audit pesados rebasan
-- esos 8s → `57014 canceling statement due to statement timeout`. Es un flake
-- ALEATORIO 1/150 que tumbaba CI en cualquier rama (cayó hasta en un PR de docs),
-- distinto al de los `Hook timed out` (ya resuelto subiendo hookTimeout).
--
-- Paliativo análogo al bump de hookTimeout: damos 60s a `service_role` (server-side,
-- usado por Edge Functions / server actions / la suite de test). Mecanismo canónico
-- de Supabase para el timeout de API por rol (ALTER ROLE + reload de PostgREST).
--
-- NO toca `anon` (3s) ni `authenticated` (8s): los timeouts de cara al usuario final
-- NO cambian. NO resuelve la PERF real de `purgar_sujeto_db` con volumen (eso es la
-- nota de Ola 2): solo desbloquea la suite quitando la guillotina de los 8s.

ALTER ROLE service_role SET statement_timeout = '60s';

-- PostgREST cachea la config de roles; recargar para que aplique sin reinicio.
NOTIFY pgrst, 'reload config';
