-- =============================================================================
-- F-3-D · Endurecimiento del guard de revocar_acceso_familia
-- -----------------------------------------------------------------------------
-- CREATE OR REPLACE de revocar_acceso_familia. ÚNICO cambio respecto a
-- 20260718120000 (F-3-C-3): el GUARD del paso 3 pasa de contar "niño activo unido
-- por un vínculo VIVO a un tutor CON cuenta" a contar "niño activo de la familia
-- por `ninos.familia_id`".
--
-- MOTIVO: el guard por vínculo era un proxy que fallaba en la ventana de invitación
-- pendiente: un tutor con `usuario_id` NULL (invitado sin aceptar) no tiene vínculo
-- vivo, así que un niño invitado quedaba "invisible" para el guard. Dar de baja a un
-- hermano en esa ventana revocaba una familia que AÚN tenía un niño activo. El
-- invariante correcto es "la familia tiene niños activos" = `ninos.familia_id`.
--
-- El resto de la función es IDÉNTICO: gate `es_admin OR service_role`, idempotencia
-- (ya inactiva), paso 4 (revoca rol tutor_legal de los tutores CON cuenta de la
-- familia), paso 5 (marca la familia inactiva), mismo jsonb de retorno con las
-- mismas claves. Sin bloque EXCEPTION.
--
-- Reutilizada por baja_nino (F-3-D) y cerrar_curso (F-3-C-2): ambos mejoran con el
-- guard más estricto (protegen a la familia mientras le quede cualquier niño activo).
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

  -- 3. GUARD: ¿queda algún niño ACTIVO en la familia? Se cuenta por `ninos.familia_id`
  --    (invariante real "la familia tiene niños activos"), no por vínculo vivo a un
  --    tutor con cuenta: así un niño en invitación pendiente (tutor usuario_id NULL,
  --    sin vínculo) sigue protegiendo a la familia. Si queda alguno → no se revoca.
  IF EXISTS (
    SELECT 1
    FROM public.ninos n
    WHERE n.familia_id = p_familia_id
      AND n.deleted_at IS NULL
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
