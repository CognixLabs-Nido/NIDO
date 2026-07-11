-- =============================================================================
-- F-3-C-3 · Primitivo reutilizable: revocar_acceso_familia (RPC transaccional)
-- -----------------------------------------------------------------------------
-- ADITIVA: crea UNA función nueva. NO cablea invocadores (el cierre de curso es
-- F-3-C-2 y la baja intra-curso F-3-D los que la llamarán cuando una familia quede
-- sin niños activos). Aquí solo el ladrillo base + sus tests.
--
-- Cuando una familia se queda SIN niños activos, la familia pasa a inactiva y sus
-- tutores pierden acceso. En UNA transacción (todo-o-nada):
--   1. GUARD: si aún hay algún niño ACTIVO (ninos.deleted_at IS NULL) vinculado por
--      un vínculo VIVO a un tutor de la familia → no-op (no revoca).
--   2. roles_usuario.deleted_at = now() del rol 'tutor_legal' de todos los tutores de
--      la familia CON cuenta (familia_tutores.usuario_id no nulo), en el centro de la
--      familia. Se acota a rol='tutor_legal' para NO tocar un eventual rol de staff
--      (admin/profe) del mismo usuario en el centro. Los tutores con usuario_id NULL
--      (invitación no aceptada) no tienen rol → se saltan solos por el filtro.
--   3. familias.deleted_at = now().
--
-- La cuenta auth.users NO se toca (solo el rol) → el desarchivar de F-3-F revierte con
-- deleted_at → NULL sobre las MISMAS filas (soft-delete): reversible y limpio (el
-- UNIQUE(usuario_id, centro_id, rol) de roles_usuario es total, no colisiona al reactivar
-- la misma fila).
--
-- Autorización: SECURITY DEFINER + gate `es_admin(centro de la familia) OR service_role`
-- como PRIMERA sentencia (tras validar existencia). Camino admin funciona SIN la rama
-- service_role (es_admin lee auth.uid() del JWT, invariante bajo SECURITY DEFINER).
--
-- Idempotente: familia ya inactiva (deleted_at IS NOT NULL) → no-op limpio, sin excepción.
--
-- Auditoría: automática. familias y roles_usuario ya están auditadas → los UPDATE disparan
-- los triggers AFTER (sin código nuevo). roles_usuario NO tiene trigger de congelado.
--
-- Aplicar por SQL Editor (rol postgres). NO por CLI.
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.revocar_acceso_familia(p_familia_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_centro_id   uuid;
  v_ya_inactiva boolean;
  v_roles       integer := 0;
BEGIN
  -- 0. Existencia + centro + estado, en una sola lectura.
  SELECT centro_id, (deleted_at IS NOT NULL)
    INTO v_centro_id, v_ya_inactiva
    FROM public.familias
    WHERE id = p_familia_id;
  IF v_centro_id IS NULL THEN
    RAISE EXCEPTION 'familia % no existe', p_familia_id USING ERRCODE = 'no_data_found';
  END IF;

  -- 1. AUTORIZACIÓN (primera sentencia con efecto; definer bypassa RLS → el gate ES la
  --    autorización real). Camino admin: es_admin(v_centro_id) sobre auth.uid().
  IF NOT (public.es_admin(v_centro_id) OR (SELECT auth.role()) = 'service_role') THEN
    RAISE EXCEPTION 'no autorizado a revocar el acceso de esta familia';
  END IF;

  -- 2. IDEMPOTENCIA: familia ya inactiva → no-op limpio.
  IF v_ya_inactiva THEN
    RETURN jsonb_build_object(
      'familia_id', p_familia_id, 'revocado', false,
      'ya_inactiva', true, 'motivo', 'ya_inactiva', 'roles_revocados', 0
    );
  END IF;

  -- 3. GUARD: ¿queda algún niño ACTIVO vinculado por un vínculo VIVO a un tutor de la
  --    familia? Si sí → no se revoca nada (la familia sigue operativa).
  IF EXISTS (
    SELECT 1
    FROM public.familia_tutores ft
    JOIN public.vinculos_familiares v
      ON v.usuario_id = ft.usuario_id AND v.deleted_at IS NULL
    JOIN public.ninos n
      ON n.id = v.nino_id AND n.deleted_at IS NULL
    WHERE ft.familia_id = p_familia_id
      AND ft.usuario_id IS NOT NULL
      AND ft.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object(
      'familia_id', p_familia_id, 'revocado', false,
      'ya_inactiva', false, 'motivo', 'tiene_ninos_activos', 'roles_revocados', 0
    );
  END IF;

  -- 4. Revoca el rol tutor_legal de todos los tutores CON cuenta, en el centro de la
  --    familia. Los familia_tutores con usuario_id NULL quedan fuera por el subselect.
  WITH revocados AS (
    UPDATE public.roles_usuario ru
       SET deleted_at = now()
     WHERE ru.centro_id = v_centro_id
       AND ru.rol = 'tutor_legal'
       AND ru.deleted_at IS NULL
       AND ru.usuario_id IN (
         SELECT ft.usuario_id
           FROM public.familia_tutores ft
          WHERE ft.familia_id = p_familia_id
            AND ft.usuario_id IS NOT NULL
            AND ft.deleted_at IS NULL
       )
    RETURNING 1
  )
  SELECT count(*) INTO v_roles FROM revocados;

  -- 5. Marca la familia inactiva.
  UPDATE public.familias SET deleted_at = now() WHERE id = p_familia_id;

  RETURN jsonb_build_object(
    'familia_id', p_familia_id, 'revocado', true,
    'ya_inactiva', false, 'roles_revocados', v_roles
  );
END $$;

GRANT EXECUTE ON FUNCTION public.revocar_acceso_familia(uuid) TO authenticated, service_role;

COMMIT;
