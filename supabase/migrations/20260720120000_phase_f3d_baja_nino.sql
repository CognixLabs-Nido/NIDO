-- =============================================================================
-- F-3-D · Baja intra-curso: orquestadora baja_nino (RPC transaccional)
-- -----------------------------------------------------------------------------
-- Acción de Dirección para dar de baja a UN niño en mitad de curso. Reutiliza los
-- primitivos de F-3-C (archivar_nino + revocar_acceso_familia) en UNA transacción
-- (todo-o-nada). Mismo patrón que cerrar_curso pero para un solo niño y con
-- fecha_baja = HOY (baja "en el acto"), no el fin de curso.
--
--   0. Carga centro_id + familia_id + deleted_at del niño (valida existencia).
--   1. AUTORIZACIÓN: es_admin(centro del niño) OR service_role (primera sentencia
--      con efecto). RAISE si no.
--   2. IDEMPOTENCIA: niño ya archivado (deleted_at IS NOT NULL) → no-op limpio.
--   3. archivar_nino(nino, motivo, fecha_baja = hoy_madrid()) → cierra matrícula(s)
--      + soft-borra vínculos + ninos.deleted_at.
--   4. revocar_acceso_familia(familia) → el GUARD interno decide: solo revoca si la
--      familia quedó SIN niños activos (un hermano que sigue activo la protege).
--   5. Devuelve el resumen (familia_revocada leído del jsonb del primitivo).
--
-- ATOMICIDAD TODO-O-NADA (CRÍTICO): esta función NO lleva NINGÚN bloque `EXCEPTION`.
-- Un `RAISE` en cualquier primitivo (o un CHECK violado, p. ej. fecha_baja < fecha_
-- alta) propaga hasta el cliente y revierte TODO — el niño NO queda archivado ni la
-- familia revocada. Los primitivos se llaman TAL CUAL (comparten la misma
-- transacción; SECURITY DEFINER no altera la frontera transaccional ni auth.uid()).
-- No se envuelve en EXCEPTION WHEN OTHERS (el savepoint implícito rompería el
-- rollback total). NO se refactoriza cerrar_curso.
--
-- Actor de auditoría: sin GUC. Corre bajo la sesión del admin (su JWT) → dentro de
-- los primitivos auth.uid() YA es el admin → el trigger audita al admin.
--
-- Aplicar por SQL Editor (rol postgres). NO por CLI.
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.baja_nino(p_nino_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_centro_id     uuid;
  v_familia_id    uuid;
  v_ya_archivado  boolean;
  v_rev           jsonb;
BEGIN
  -- 0. Existencia + centro + familia + estado, en una sola lectura.
  SELECT centro_id, familia_id, (deleted_at IS NOT NULL)
    INTO v_centro_id, v_familia_id, v_ya_archivado
    FROM public.ninos
    WHERE id = p_nino_id;
  IF v_centro_id IS NULL THEN
    RAISE EXCEPTION 'nino % no existe', p_nino_id USING ERRCODE = 'no_data_found';
  END IF;

  -- 1. AUTORIZACIÓN (definer bypassa RLS → el gate ES la autorización real).
  IF NOT (public.es_admin(v_centro_id) OR (SELECT auth.role()) = 'service_role') THEN
    RAISE EXCEPTION 'no autorizado a dar de baja a este nino';
  END IF;

  -- 2. IDEMPOTENCIA: ya archivado → no-op limpio.
  IF v_ya_archivado THEN
    RETURN jsonb_build_object(
      'nino_id', p_nino_id, 'archivado', false,
      'ya_archivado', true, 'familia_revocada', false
    );
  END IF;

  -- 3. Archivar el niño con fecha de baja = HOY (huso Madrid).
  PERFORM public.archivar_nino(p_nino_id, p_motivo, public.hoy_madrid());

  -- 4. Revocar el acceso de la familia si quedó sin niños activos (guard interno).
  v_rev := public.revocar_acceso_familia(v_familia_id);

  RETURN jsonb_build_object(
    'nino_id', p_nino_id, 'archivado', true,
    'ya_archivado', false,
    'familia_revocada', COALESCE((v_rev ->> 'revocado')::boolean, false)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.baja_nino(uuid, text) TO authenticated, service_role;

COMMIT;
