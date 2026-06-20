-- =============================================================================
-- F11-A6 — Esqueleto huérfano: barrido de retención que purga altas abandonadas.
--
-- Añade la categoría 'esqueleto_huerfano' al manifiesto de retención y RPC de
-- BORRADO PERMANENTE (service-role), con re-validación TOCTOU del predicado dentro
-- de la transacción y backstop defensivo (aborta el huérfano CONCRETO si aparece
-- actividad real; atómico, no arrastra la tanda):
--   · niño-arm: purga el niño abandonado (matrícula 'pendiente' + sin vínculos +
--     invitación vencida tras gracia, ninguna abierta-válida). FK-safe.
--   · stub-arm: lista/valida el stub de auth.users dejado por inviteUserByEmail
--     (sin rol, sin vínculos, sin confirmar, con invitación pero todas vencidas).
--     El DELETE de auth.users NO se hace por SQL (lo hace la app por Admin API);
--     aquí solo va la lógica autoritativa de selección/validación.
-- Inerte hasta que el barrido se ejecute con dryRun=false (hoy hay 0 candidatos).
-- =============================================================================

-- 1) Nueva categoría del manifiesto (no destructivo). Fuera de txn explícita.
ALTER TYPE public.retencion_categoria ADD VALUE IF NOT EXISTS 'esqueleto_huerfano';

-- 2) niño-arm: borrado atómico FK-safe del esqueleto huérfano.
CREATE OR REPLACE FUNCTION public.purgar_esqueleto_huerfano_nino(
  p_nino_id uuid,
  p_cutoff  timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ok        boolean;
  v_actividad boolean;
BEGIN
  -- Re-validación autoritativa del predicado (TOCTOU: el estado pudo cambiar
  -- entre listar() y limpiarDb() — p. ej. el tutor acaba de aceptar).
  SELECT
        EXISTS (SELECT 1 FROM matriculas m WHERE m.nino_id = p_nino_id
                  AND m.estado = 'pendiente' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM vinculos_familiares v WHERE v.nino_id = p_nino_id
                  AND v.deleted_at IS NULL)
    AND EXISTS (SELECT 1 FROM invitaciones i WHERE i.nino_id = p_nino_id
                  AND i.accepted_at IS NULL AND i.rejected_at IS NULL AND i.expires_at < p_cutoff)
    AND NOT EXISTS (SELECT 1 FROM invitaciones i WHERE i.nino_id = p_nino_id
                  AND i.accepted_at IS NULL AND i.rejected_at IS NULL AND i.expires_at >= p_cutoff)
    INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'no es esqueleto huerfano (predicado no se cumple)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Backstop: si el niño tiene CUALQUIER actividad real, abortar (rollback atómico).
  -- Un huérfano real no tiene nada de esto (verificado en la BD).
  SELECT
        EXISTS (SELECT 1 FROM asistencias WHERE nino_id = p_nino_id)
     OR EXISTS (SELECT 1 FROM ausencias WHERE nino_id = p_nino_id)
     OR EXISTS (SELECT 1 FROM agendas_diarias WHERE nino_id = p_nino_id)
     OR EXISTS (SELECT 1 FROM conversaciones WHERE nino_id = p_nino_id)
     OR EXISTS (SELECT 1 FROM administraciones_medicacion WHERE nino_id = p_nino_id)
     OR EXISTS (SELECT 1 FROM informes_evolucion WHERE nino_id = p_nino_id)
    INTO v_actividad;

  IF v_actividad THEN
    RAISE EXCEPTION 'el nino tiene actividad real; huerfano abortado'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Borrado FK-safe (atómico). Primero los RESTRICT 1:1, luego matrícula, luego
  -- el niño (CASCADE: vinculos, invitaciones, autorizaciones, firmas, media_etiquetas).
  DELETE FROM info_medica_emergencia WHERE nino_id = p_nino_id;
  DELETE FROM datos_pedagogicos_nino WHERE nino_id = p_nino_id;
  DELETE FROM matriculas            WHERE nino_id = p_nino_id;
  DELETE FROM ninos                 WHERE id      = p_nino_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.purgar_esqueleto_huerfano_nino(uuid, timestamptz) TO service_role;

-- 3) stub-arm: listado de stubs huérfanos de auth.users (PostgREST no llega a
--    auth.*, por eso va como RPC). El DELETE de auth.users lo hace la app por
--    Admin API tras re-validar; aquí solo selección + validación autoritativa.
CREATE OR REPLACE FUNCTION public.listar_esqueletos_huerfanos_stub(p_cutoff timestamptz)
RETURNS TABLE(usuario_id uuid, centro_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT au.id, (SELECT i.centro_id FROM invitaciones i WHERE i.email = au.email
                  ORDER BY i.created_at DESC LIMIT 1)
  FROM auth.users au
  WHERE au.email_confirmed_at IS NULL                                  -- nunca completó (excluye fixtures: confirmadas)
    AND NOT EXISTS (SELECT 1 FROM roles_usuario r WHERE r.usuario_id = au.id)
    AND NOT EXISTS (SELECT 1 FROM vinculos_familiares v WHERE v.usuario_id = au.id AND v.deleted_at IS NULL)
    AND EXISTS (SELECT 1 FROM invitaciones i WHERE i.email = au.email)  -- realmente invitado (excluye fixtures: sin invitación)
    AND NOT EXISTS (SELECT 1 FROM invitaciones i WHERE i.email = au.email
                      AND i.accepted_at IS NULL AND i.rejected_at IS NULL AND i.expires_at >= p_cutoff);  -- ninguna abierta-válida
$function$;

CREATE OR REPLACE FUNCTION public.es_esqueleto_stub_purgable(p_usuario_id uuid, p_cutoff timestamptz)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM auth.users au
    WHERE au.id = p_usuario_id
      AND au.email_confirmed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM roles_usuario r WHERE r.usuario_id = au.id)
      AND NOT EXISTS (SELECT 1 FROM vinculos_familiares v WHERE v.usuario_id = au.id AND v.deleted_at IS NULL)
      AND EXISTS (SELECT 1 FROM invitaciones i WHERE i.email = au.email)
      AND NOT EXISTS (SELECT 1 FROM invitaciones i WHERE i.email = au.email
                        AND i.accepted_at IS NULL AND i.rejected_at IS NULL AND i.expires_at >= p_cutoff)
  );
$function$;

GRANT EXECUTE ON FUNCTION public.listar_esqueletos_huerfanos_stub(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.es_esqueleto_stub_purgable(uuid, timestamptz) TO service_role;
