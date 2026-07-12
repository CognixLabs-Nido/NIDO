-- =============================================================================
-- F-3-F · Reincorporar (desarchivar): orquestadora desarchivar_nino (RPC transaccional)
-- -----------------------------------------------------------------------------
-- Acción de Dirección para REINCORPORAR a un niño dado de baja. Es el INVERSO de
-- baja_nino (F-3-D): revierte los deleted_at en cadena y abre una matrícula NUEVA
-- en el curso ACTIVO. En UNA transacción (todo-o-nada). Mismo patrón que los
-- primitivos de F-3-C: SECURITY DEFINER, gate como primera sentencia con efecto,
-- sin bloque EXCEPTION, atómico, idempotente.
--
--   0. Carga centro_id + familia_id + deleted_at del niño (valida existencia).
--   1. AUTORIZACIÓN: es_admin(centro del niño) OR service_role (primera sentencia
--      con efecto). RAISE si no.
--   2. IDEMPOTENCIA: niño ya ACTIVO (deleted_at IS NULL) → no-op { ya_activo:true }.
--   3. Curso activo del centro (curso_activo_de_centro). Sin curso activo → RAISE.
--   4. Valida que el aula pertenece al curso activo (aulas_curso) → RAISE si no
--      (mismo patrón que el alta crear_o_anadir_a_familia).
--   5. REVERT EN CADENA (todos idempotentes por el WHERE):
--        - ninos.deleted_at = NULL.
--        - vinculos_familiares.deleted_at = NULL para los vínculos del niño que
--          estaban soft-borrados (revive el acceso por-niño de sus tutores).
--        - familias.deleted_at = NULL SOLO si estaba archivada (WHERE ... IS NOT NULL).
--        - roles_usuario: reactiva el rol tutor_legal SOLO de los que estaban
--          REVOCADOS (deleted_at IS NOT NULL) y pertenecen a la familia (via
--          familia_tutores, que la baja NUNCA tocó → el roster de adultos sigue vivo).
--        - matrícula NUEVA (nino, aula, curso activo, fecha_alta = hoy_madrid(),
--          estado='activa'). El índice parcial único (nino_id, curso) WHERE
--          fecha_baja IS NULL NO colisiona: las viejas quedan con fecha_baja seteada.
--   6. Devuelve el resumen.
--
-- REACTIVACIÓN SELECTIVA DEL ROL (arista crítica): el UPDATE de roles_usuario lleva
-- `deleted_at IS NOT NULL` en el WHERE. En el caso "familia activa con hermano" el rol
-- NUNCA se revocó (deleted_at IS NULL) → queda FUERA del UPDATE → no se toca ni cambia
-- su updated_at. Solo se "revive" lo que estaba revocado. Idéntico criterio para
-- familias (WHERE id = ... AND deleted_at IS NOT NULL) y para los vínculos.
--
-- ATOMICIDAD TODO-O-NADA (CRÍTICO): esta función NO lleva NINGÚN bloque `EXCEPTION`.
-- Un `RAISE` (sin curso activo, aula inválida, etc.) propaga hasta el cliente y revierte
-- TODO — el niño NO queda desarchivado ni a medias. Las validaciones (3, 4) van ANTES de
-- cualquier escritura, así que un fallo por aula inválida ni siquiera llega a escribir.
--
-- NO refactoriza baja_nino / archivar_nino / revocar_acceso_familia. NO cablea el
-- flujo F-2b-4-caso2 (cuenta existente con familia archivada añade hijo → reactiva):
-- eso es otra subfase que se apoyará en este primitivo.
--
-- Actor de auditoría: sin GUC. Corre bajo la sesión del admin (su JWT) → dentro de los
-- UPDATE/INSERT auth.uid() YA es el admin → el trigger audita al admin.
--
-- Aplicar por SQL Editor (rol postgres). NO por CLI.
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.desarchivar_nino(p_nino_id uuid, p_aula_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_centro_id     uuid;
  v_familia_id    uuid;
  v_archivado     boolean;
  v_curso_id      uuid;
  v_familia_react boolean := false;
  v_roles         integer := 0;
  v_matricula_id  uuid;
BEGIN
  -- 0. Existencia + centro + familia + estado, en una sola lectura.
  SELECT centro_id, familia_id, (deleted_at IS NOT NULL)
    INTO v_centro_id, v_familia_id, v_archivado
    FROM public.ninos
    WHERE id = p_nino_id;
  IF v_centro_id IS NULL THEN
    RAISE EXCEPTION 'nino % no existe', p_nino_id USING ERRCODE = 'no_data_found';
  END IF;

  -- 1. AUTORIZACIÓN (definer bypassa RLS → el gate ES la autorización real).
  IF NOT (public.es_admin(v_centro_id) OR (SELECT auth.role()) = 'service_role') THEN
    RAISE EXCEPTION 'no autorizado a reincorporar a este nino';
  END IF;

  -- 2. IDEMPOTENCIA: ya activo → no-op limpio.
  IF NOT v_archivado THEN
    RETURN jsonb_build_object('nino_id', p_nino_id, 'ya_activo', true);
  END IF;

  -- 3. Curso ACTIVO del centro (obligatorio: no hay reincorporación sin curso).
  v_curso_id := public.curso_activo_de_centro(v_centro_id);
  IF v_curso_id IS NULL THEN
    RAISE EXCEPTION 'el centro no tiene curso academico activo' USING ERRCODE = 'no_data_found';
  END IF;

  -- 4. El aula elegida debe pertenecer al curso activo (aulas_curso).
  IF NOT EXISTS (
    SELECT 1 FROM public.aulas_curso
    WHERE aula_id = p_aula_id AND curso_academico_id = v_curso_id
  ) THEN
    RAISE EXCEPTION 'el aula no pertenece al curso activo del centro' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- 5. REVERT EN CADENA.
  -- 5a. Desarchiva el niño.
  UPDATE public.ninos SET deleted_at = NULL WHERE id = p_nino_id;

  -- 5b. Revive los vínculos del niño que estaban soft-borrados (acceso por-niño).
  UPDATE public.vinculos_familiares
     SET deleted_at = NULL
   WHERE nino_id = p_nino_id
     AND deleted_at IS NOT NULL;

  -- 5c. Reactiva la familia SOLO si estaba archivada (hijo único). Si seguía activa
  --     (había hermano), el WHERE no afecta filas y FOUND queda en false.
  UPDATE public.familias
     SET deleted_at = NULL
   WHERE id = v_familia_id
     AND deleted_at IS NOT NULL;
  v_familia_react := FOUND;

  -- 5d. Reactiva el rol tutor_legal SOLO de los que estaban REVOCADOS (deleted_at
  --     IS NOT NULL) y son adultos de la familia (familia_tutores, intacto tras la
  --     baja). En el caso "hermano activo" el rol nunca se revocó → queda fuera del
  --     UPDATE (no se toca su updated_at). No duplica roles vivos.
  WITH react AS (
    UPDATE public.roles_usuario ru
       SET deleted_at = NULL
     WHERE ru.centro_id = v_centro_id
       AND ru.rol = 'tutor_legal'
       AND ru.deleted_at IS NOT NULL
       AND ru.usuario_id IN (
         SELECT ft.usuario_id
           FROM public.familia_tutores ft
          WHERE ft.familia_id = v_familia_id
            AND ft.usuario_id IS NOT NULL
            AND ft.deleted_at IS NULL
       )
    RETURNING 1
  )
  SELECT count(*) INTO v_roles FROM react;

  -- 5e. Matrícula NUEVA en el curso activo (estado 'activa', fecha_alta hoy Madrid).
  --     Las matrículas viejas quedan intactas en estado='baja' (historial preservado).
  INSERT INTO public.matriculas (nino_id, aula_id, curso_academico_id, fecha_alta, estado)
  VALUES (p_nino_id, p_aula_id, v_curso_id, public.hoy_madrid(), 'activa')
  RETURNING id INTO v_matricula_id;

  RETURN jsonb_build_object(
    'nino_id',            p_nino_id,
    'desarchivado',       true,
    'matricula_id',       v_matricula_id,
    'familia_reactivada', v_familia_react,
    'roles_reactivados',  v_roles
  );
END $$;

GRANT EXECUTE ON FUNCTION public.desarchivar_nino(uuid, uuid) TO authenticated, service_role;

COMMIT;
