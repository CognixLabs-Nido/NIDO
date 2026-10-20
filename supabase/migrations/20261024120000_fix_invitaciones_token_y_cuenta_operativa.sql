-- =============================================================================
-- FIX — Una invitación no fija la contraseña de una cuenta que ya operó (PR 0a, Fase 4)
-- -----------------------------------------------------------------------------
-- El enlace de una invitación (`/invitation/{token}`) completa el «alta a medias» de su email:
-- si la cuenta existe y no tiene roles vivos, `acceptInvitationCore` le fija la contraseña. El
-- token es lo único que protege ese paso, y la directora podía conseguirlo:
--
--   - leerlo con su sesión (`invitaciones_admin` es FOR ALL y `authenticated` tenía SELECT);
--   - crear con su sesión una invitación con el token que ella eligiera (INSERT);
--   - o invitar a un email suyo, recibir el token y cambiar después el email de esa
--     invitación por el de otra persona (UPDATE).
--
-- Y «sin roles vivos» no era solo el alta a medias: también quien perdió su rol y el
-- superusuario, que no tiene roles de centro desde el relevo (ADR-0061). Con un segundo centro,
-- cualquier directora podía fijar una contraseña nueva en la cuenta con permisos totales.
-- Demostrado contra la BD efímera del CI: `invitacion-toma-de-cuenta.rls.test.ts`.
--
-- Esta migración:
--   1. Quita a `authenticated` el INSERT y el UPDATE de `invitaciones` y la lectura de `token`.
--      La app escribe las invitaciones con service role (sendInvitation, invitarProfe y la
--      aceptación), así que no cambia nada para ella. El DELETE y la lectura de las demás
--      columnas se quedan como estaban (las policies de filas no cambian).
--      ⚠️ Cada columna nueva de `invitaciones` necesitará su `GRANT SELECT (columna)` explícito.
--   2. `cuenta_ha_operado(usuario)`: TRUE si la cuenta tuvo alguna vez un rol (vivo o retirado)
--      o es superusuario. Solo `service_role`. La aceptación y la página de la invitación no
--      completan como alta nueva una cuenta así: va por B8 y entra con su contraseña.
--
-- Estado verificado en producción el 2026-10-20 (lectura read_only): `invitaciones` tiene una
-- sola policy (`invitaciones_admin ALL`), ninguna escritura de la app va con sesión y ninguna
-- lectura con sesión pide `token`.
--
-- Guardas: aborta si `invitaciones` no tiene exactamente las columnas esperadas (una columna
-- nueva se quedaría sin GRANT) o si la función ya existe. Comprueba el resultado al final e
-- imprime su recuento también cuando pasa.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor. Tras aplicar:
-- registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(attname, ',' ORDER BY attname)
    INTO v_cols
    FROM pg_attribute
   WHERE attrelid = 'public.invitaciones'::regclass
     AND attnum > 0
     AND NOT attisdropped;

  IF v_cols IS DISTINCT FROM
     'accepted_at,aula_id,centro_id,created_at,email,expires_at,id,invitado_por,nino_id,nombre_completo,rejected_at,rol_objetivo,tipo_personal_aula,tipo_vinculo,token' THEN
    RAISE EXCEPTION 'invitaciones no tiene las columnas esperadas: %', v_cols;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc
     WHERE pronamespace = 'public'::regnamespace
       AND proname = 'cuenta_ha_operado'
  ) THEN
    RAISE EXCEPTION 'cuenta_ha_operado ya existe';
  END IF;
END
$guarda$;

-- ---- 1. Permisos de invitaciones ----
-- CONTROL NEGATIVO N2: sin REVOKE

-- Todas MENOS token. Columna nueva en invitaciones ⇒ añadirla aquí en su migración.
GRANT SELECT (
  id,
  email,
  rol_objetivo,
  centro_id,
  nino_id,
  aula_id,
  invitado_por,
  expires_at,
  accepted_at,
  rejected_at,
  created_at,
  tipo_vinculo,
  nombre_completo,
  tipo_personal_aula
) ON public.invitaciones TO authenticated;

-- ---- 2. ¿La cuenta ha operado alguna vez? ----
CREATE FUNCTION public.cuenta_ha_operado(p_usuario_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.roles_usuario WHERE usuario_id = p_usuario_id)
      OR EXISTS (SELECT 1 FROM public.platform_admins WHERE usuario_id = p_usuario_id);
$function$;

REVOKE ALL ON FUNCTION public.cuenta_ha_operado(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cuenta_ha_operado(uuid) TO service_role;

-- CONTROL NEGATIVO N2: sin guarda posterior
