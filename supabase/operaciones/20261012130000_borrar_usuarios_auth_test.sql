-- =============================================================================
-- OPERACIÓN 20261012130000 · Borrar los 16 usuarios @nido.test de Auth
--
-- Una sola vez, en producción. NO es una migración (convención en supabase/operaciones/README.md).
--
-- Contexto: la nocturna antigua del 11-10-2026 (08:21–09:08 UTC) dejó 16 usuarios de la suite RLS
-- en auth.users (email rls-<uuid>@nido.test), sin roles, sin vínculos, sin objetos en Storage y
-- sin filas en audit_log. 20261012120000 los dejó fuera a propósito porque tocan auth.users.
-- Diagnóstico: docs/operations/limpieza-basura-test-2026-10.md.
--
-- Por qué SQL y no la admin API de Auth: auth.users cascadea a public.usuarios, y el trigger
-- audit_usuarios graba una fila en audit_log por cada DELETE (centro NULL, con el nombre en
-- valores_antes). Aquí se borran por xmin en la misma transacción; la admin API las dejaría,
-- una transacción por usuario y sin guarda de recuento.
--
-- Lo que cascadea desde auth.users: auth.identities (16), auth.sessions (20, y con ellas sus
-- auth.refresh_tokens) y public.usuarios (16). Ninguna tabla con RESTRICT/NO ACTION los referencia.
--
-- Todo es UN bloque DO: una sola sentencia, una sola transacción. Cualquier guarda que falle
-- lanza una excepción y no queda NADA hecho.
--
-- ENSAYO: anteponer `SET nido.ensayo = 'on';` al fichero. Corre todo, comprueba todas las
-- guardas y termina en RAISE EXCEPTION con los 16 (id y email) y los recuentos: no confirma nada.
-- Sin esa línea, el fichero tal cual borra de verdad.
--
-- No toca ANAIA (33c79b50-13b5-4962-b849-d88dd6a21366) ni a ninguno de sus 9 usuarios.
-- =============================================================================

DO $operacion$
DECLARE
  c_anaia     constant uuid := '33c79b50-13b5-4962-b849-d88dd6a21366';
  -- Los 16 usuarios de test (lista explícita; diagnóstico del 12-10-2026).
  c_usuarios  constant uuid[] := ARRAY[
    'b57f5dca-841d-45a4-9b67-d10cacc775b5',
    '00e3bb08-f5c9-4587-aa69-51b95e496852',
    '3ca9124f-a52a-43c9-8658-05c58717ad86',
    '3a522204-32de-4293-a812-ef49bb0ca977',
    '302f9ac2-6693-49fd-ad5f-a71a81acc462',
    '191168ba-8bb2-411a-8671-8a2dd0bb98a5',
    '873dc184-bdca-4ee7-956b-90ddb930affa',
    '083695b8-1b01-423f-b371-324cc8cffbbe',
    '20c38cf2-47e9-4f30-9074-3d8d23691135',
    'e3dfcd67-5566-4858-856b-d6cb5d9619bc',
    '3fbe5d95-61c3-4b53-8afb-e452ce390c67',
    'aa7f2bb3-550a-4c7f-be38-a5ef6c40eb33',
    '7a788bad-d39b-4eb6-b367-19490bbd2023',
    '55c5e611-ce37-4bac-91fc-af09ce202431',
    '4a8a6577-0efb-4149-8bac-1040668614bb',
    'bf67e6d6-ed7b-43c0-8077-c94b5a7e69ee'
  ]::uuid[];

  -- RECUENTOS APROBADOS. Si algo da otro número, rollback total.
  e_usuarios    constant bigint := 16;   -- auth.users borrados
  e_identities  constant bigint := 16;   -- auth.identities en cascada
  e_sessions    constant bigint := 20;   -- auth.sessions en cascada
  e_perfiles    constant bigint := 16;   -- public.usuarios en cascada
  e_audit_trig  constant bigint := 16;   -- filas que escribe audit_usuarios en esta transacción
  e_audit_final constant bigint := 164;  -- audit_log al terminar: solo ANAIA

  v_xid        xid;
  v_lista      text;
  v_n          bigint;
  r_identities bigint;
  r_sessions   bigint;
  r_refresh    bigint;
  r_perfiles   bigint;
  r_usuarios   bigint;
  r_audit      bigint;
  f            text[] := '{}';
BEGIN
  -- Las filas de auditoría que genere esta operación llevan este xmin. Sin bloques EXCEPTION
  -- dentro: no hay subtransacciones.
  v_xid := pg_current_xact_id()::xid;

  -- ── GUARDA ANAIA AL PRINCIPIO ──────────────────────────────────────────────────────────
  IF (SELECT count(*) FROM public.audit_log WHERE centro_id = c_anaia) <> 164
     OR (SELECT count(*) FROM public.ninos WHERE centro_id = c_anaia) <> 4
     OR (SELECT count(*) FROM public.roles_usuario WHERE centro_id = c_anaia) <> 9 THEN
    RAISE EXCEPTION 'guarda ANAIA (inicio): esperaba 164/4/9 y hay %/%/%',
      (SELECT count(*) FROM public.audit_log WHERE centro_id = c_anaia),
      (SELECT count(*) FROM public.ninos WHERE centro_id = c_anaia),
      (SELECT count(*) FROM public.roles_usuario WHERE centro_id = c_anaia);
  END IF;
  -- Sus 9 usuarios: presentes en Auth, ninguno @nido.test, ninguno en la lista.
  IF (SELECT count(DISTINCT u.id) FROM public.roles_usuario r JOIN auth.users u ON u.id = r.usuario_id
       WHERE r.centro_id = c_anaia AND u.email NOT ILIKE '%@nido.test' AND u.id <> ALL (c_usuarios)) <> 9 THEN
    RAISE EXCEPTION 'guarda ANAIA (inicio): no están sus 9 usuarios reales fuera de la lista';
  END IF;

  -- ── GUARDA DE ENTRADA: los 16 existen, son @nido.test y no tienen ningún rol ───────────
  IF cardinality(c_usuarios) <> e_usuarios
     OR (SELECT count(DISTINCT x) FROM unnest(c_usuarios) x) <> e_usuarios THEN
    RAISE EXCEPTION 'guarda de entrada: la lista no tiene 16 ids distintos';
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE id = ANY (c_usuarios) AND email ILIKE '%@nido.test') <> e_usuarios THEN
    RAISE EXCEPTION 'guarda de entrada: no están los 16 usuarios con email @nido.test';
  END IF;
  IF EXISTS (SELECT 1 FROM public.roles_usuario WHERE usuario_id = ANY (c_usuarios)) THEN
    RAISE EXCEPTION 'guarda de entrada: alguno de los 16 tiene un rol';
  END IF;

  -- Lo que va a caer en cascada, contado antes de borrar.
  SELECT count(*) INTO r_identities FROM auth.identities WHERE user_id = ANY (c_usuarios);
  SELECT count(*) INTO r_sessions   FROM auth.sessions   WHERE user_id = ANY (c_usuarios);
  SELECT count(*) INTO r_refresh    FROM auth.refresh_tokens
   WHERE session_id IN (SELECT id FROM auth.sessions WHERE user_id = ANY (c_usuarios));
  SELECT count(*) INTO r_perfiles   FROM public.usuarios WHERE id = ANY (c_usuarios);
  SELECT string_agg(id || ' ' || email, ', ' ORDER BY created_at, email) INTO v_lista
    FROM auth.users WHERE id = ANY (c_usuarios);

  -- ── BORRADO ────────────────────────────────────────────────────────────────────────────
  DELETE FROM auth.users WHERE id = ANY (c_usuarios);
  GET DIAGNOSTICS r_usuarios = ROW_COUNT;

  -- ── Lo que ha escrito audit_usuarios en esta misma transacción (xmin) ──────────────────
  SELECT count(*) INTO v_n FROM public.audit_log
   WHERE xmin = v_xid AND NOT (tabla = 'usuarios' AND accion = 'DELETE' AND registro_id = ANY (c_usuarios));
  IF v_n > 0 THEN f := f || format('audit_log: %s filas de esta transacción que no son el DELETE de los 16', v_n); END IF;
  DELETE FROM public.audit_log WHERE xmin = v_xid;
  GET DIAGNOSTICS r_audit = ROW_COUNT;

  -- ── GUARDA DE RECUENTO Y CASCADA ───────────────────────────────────────────────────────
  IF r_usuarios   <> e_usuarios   THEN f := f || format('auth.users: %s (esperado %s)', r_usuarios, e_usuarios); END IF;
  IF r_identities <> e_identities THEN f := f || format('auth.identities: %s (esperado %s)', r_identities, e_identities); END IF;
  IF r_sessions   <> e_sessions   THEN f := f || format('auth.sessions: %s (esperado %s)', r_sessions, e_sessions); END IF;
  IF r_perfiles   <> e_perfiles   THEN f := f || format('public.usuarios: %s (esperado %s)', r_perfiles, e_perfiles); END IF;
  IF r_audit      <> e_audit_trig THEN f := f || format('audit_log de esta transacción: %s (esperado %s)', r_audit, e_audit_trig); END IF;
  -- La cascada se ha llevado todo lo que colgaba de los 16.
  IF EXISTS (SELECT 1 FROM auth.identities WHERE user_id = ANY (c_usuarios))
     OR EXISTS (SELECT 1 FROM auth.sessions WHERE user_id = ANY (c_usuarios))
     OR EXISTS (SELECT 1 FROM public.usuarios WHERE id = ANY (c_usuarios)) THEN
    f := f || 'queda algo de los 16 tras la cascada'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE email ILIKE '%@nido.test') THEN
    f := f || 'queda algún usuario @nido.test en Auth'::text;
  END IF;

  -- ── GUARDA FINAL: audit_log y ANAIA ────────────────────────────────────────────────────
  IF (SELECT count(*) FROM public.audit_log) <> e_audit_final
     OR EXISTS (SELECT 1 FROM public.audit_log WHERE centro_id IS NULL) THEN
    f := f || format('audit_log (final): %s filas, %s con centro NULL; esperaba %s y 0',
      (SELECT count(*) FROM public.audit_log),
      (SELECT count(*) FROM public.audit_log WHERE centro_id IS NULL), e_audit_final);
  END IF;
  IF (SELECT count(*) FROM public.audit_log WHERE centro_id = c_anaia) <> 164
     OR (SELECT count(*) FROM public.ninos WHERE centro_id = c_anaia) <> 4
     OR (SELECT count(*) FROM public.roles_usuario WHERE centro_id = c_anaia) <> 9 THEN
    f := f || format('ANAIA (final): %s/%s/%s, esperaba 164/4/9',
      (SELECT count(*) FROM public.audit_log WHERE centro_id = c_anaia),
      (SELECT count(*) FROM public.ninos WHERE centro_id = c_anaia),
      (SELECT count(*) FROM public.roles_usuario WHERE centro_id = c_anaia));
  END IF;
  IF (SELECT count(DISTINCT u.id) FROM public.roles_usuario r JOIN auth.users u ON u.id = r.usuario_id
       WHERE r.centro_id = c_anaia AND u.email NOT ILIKE '%@nido.test') <> 9 THEN
    f := f || 'ANAIA (final): no están sus 9 usuarios'::text;
  END IF;

  IF cardinality(f) > 0 THEN
    RAISE EXCEPTION 'GUARDA: rollback total | %', array_to_string(f, ' | ');
  END IF;

  IF current_setting('nido.ensayo', true) = 'on' THEN
    RAISE EXCEPTION 'ENSAYO OK, nada confirmado | auth.users: % | identities: % | sessions: % (refresh_tokens: %) | usuarios: % | audit_log de la operación borrado: % | audit_log final: % | ANAIA final 164/4/9 y sus 9 usuarios | los 16: %',
      r_usuarios, r_identities, r_sessions, r_refresh, r_perfiles, r_audit, e_audit_final, v_lista;
  END IF;

  RAISE NOTICE 'Usuarios de test borrados | auth.users: % | identities: % | sessions: % | usuarios: % | audit_log de la operación borrado: %',
    r_usuarios, r_identities, r_sessions, r_perfiles, r_audit;
END $operacion$;
