-- =============================================================================
-- FEAT — el idioma de la cuenta llega a los correos de Auth (invitación y recuperación)
-- -----------------------------------------------------------------------------
-- Las plantillas de correo de Supabase Auth solo leen los metadatos del usuario
-- (`auth.users.raw_user_meta_data`, `.Data` en la plantilla), no `public.usuarios`. La fuente
-- de verdad del idioma es `public.usuarios.idioma_preferido` (CHECK es/en/va); hoy solo 6 de
-- 24 cuentas lo tienen copiado en los metadatos (`idioma_preferido`).
--
--   1. Trigger `usuarios_sincronizar_idioma_auth` (AFTER UPDATE OF idioma_preferido): copia el
--      idioma a `raw_user_meta_data.idioma_preferido` cada vez que cambia en `usuarios`
--      (hoy lo puede cambiar el propio usuario con `usuarios_self_update`, y lo cambia la app al
--      aceptar una invitación). La función es SECURITY DEFINER: escribe en `auth.users` aunque
--      el cambio lo haga el usuario con su sesión. Solo toca esa clave (merge con `||`).
--      Al INSERTAR no hace falta: `handle_new_user` crea `usuarios` DESDE los metadatos.
--
--   2. Backfill: copia el `idioma_preferido` actual de `usuarios` a los metadatos de las
--      cuentas que no lo tienen o lo tienen distinto.
--
-- Estado verificado en producción el 2026-10-10: 24 cuentas, todas con `usuarios` = 'es'; las 6
-- que tienen la clave en los metadatos también 'es' (ninguna discrepancia). `postgres` tiene
-- UPDATE sobre `auth.users`; el único trigger de `auth.users` es `on_auth_user_created`
-- (AFTER INSERT → handle_new_user), así que el trigger nuevo no puede entrar en bucle.
--
-- Guardas: aborta si hay alguna cuenta cuyos metadatos dicen un idioma DISTINTO del de
-- `usuarios` (el backfill lo pisaría: hay que decidir antes cuál vale); comprueba al final que
-- no queda ninguna cuenta con `usuarios` y sin el idioma en los metadatos.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor (CLI SIGILL
-- en ARM). Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_discrepancias integer;
BEGIN
  SELECT count(*)
    INTO v_discrepancias
    FROM auth.users u
    JOIN public.usuarios us ON us.id = u.id
   WHERE u.raw_user_meta_data ? 'idioma_preferido'
     AND u.raw_user_meta_data->>'idioma_preferido' IS DISTINCT FROM us.idioma_preferido;

  IF v_discrepancias > 0 THEN
    RAISE EXCEPTION '% cuenta(s) con idioma distinto en metadatos y en usuarios: decidir antes cuál vale',
      v_discrepancias;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc
     WHERE pronamespace = 'public'::regnamespace AND proname = 'sincronizar_idioma_auth'
  ) THEN
    RAISE EXCEPTION 'public.sincronizar_idioma_auth ya existe';
  END IF;
END
$guarda$;

-- ---- 1. Sincronización usuarios → metadatos de Auth ----
CREATE FUNCTION public.sincronizar_idioma_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE auth.users
     SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
                              || jsonb_build_object('idioma_preferido', NEW.idioma_preferido)
   WHERE id = NEW.id
     AND (raw_user_meta_data->>'idioma_preferido') IS DISTINCT FROM NEW.idioma_preferido;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.sincronizar_idioma_auth() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER usuarios_sincronizar_idioma_auth
  AFTER UPDATE OF idioma_preferido ON public.usuarios
  FOR EACH ROW
  WHEN (OLD.idioma_preferido IS DISTINCT FROM NEW.idioma_preferido)
  EXECUTE FUNCTION public.sincronizar_idioma_auth();

-- ---- 2. Backfill de las cuentas existentes ----
UPDATE auth.users u
   SET raw_user_meta_data = COALESCE(u.raw_user_meta_data, '{}'::jsonb)
                            || jsonb_build_object('idioma_preferido', us.idioma_preferido)
  FROM public.usuarios us
 WHERE us.id = u.id
   AND (u.raw_user_meta_data->>'idioma_preferido') IS DISTINCT FROM us.idioma_preferido;

-- ---- Guarda posterior ----
DO $comprobacion$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM auth.users u
      JOIN public.usuarios us ON us.id = u.id
     WHERE (u.raw_user_meta_data->>'idioma_preferido') IS DISTINCT FROM us.idioma_preferido
  ) THEN
    RAISE EXCEPTION 'queda alguna cuenta sin el idioma de usuarios en sus metadatos';
  END IF;
END
$comprobacion$;
