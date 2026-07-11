-- =============================================================================
-- F-3-C-1 · Primitivo reutilizable: archivar_nino (RPC transaccional)
-- -----------------------------------------------------------------------------
-- ADITIVA: crea UNA función nueva. NO cablea invocadores (el cierre de curso es
-- F-3-C-2, la baja intra-curso F-3-D, el desarchivar F-3-F). Aquí solo el ladrillo
-- base + sus tests.
--
-- Archivar = soft-delete, nada se borra. En UNA transacción (todo-o-nada):
--   1. cierra TODAS las matrículas abiertas del niño (fecha_baja IS NULL, incluye
--      pendiente/lista/activa): estado='baja', fecha_baja, motivo_baja.
--   2. soft-delete de TODOS los vínculos del niño (vinculos_familiares.deleted_at)
--      → el niño desaparece de la vista del tutor (family/page filtra deleted_at).
--   3. ninos.deleted_at = now().
--
-- NO toca: roles_usuario (el tutor conserva acceso → F-3-C-3), familias.deleted_at
-- (F-3-C-3), ni la matrícula del niño que CONTINÚA de curso (arreglo rollover, F-3-C-2).
--
-- Autorización: SECURITY DEFINER + gate `es_admin(centro del niño) OR service_role`
-- como PRIMERA sentencia (tras validar existencia), antes de cualquier escritura.
-- El centro se obtiene del propio SELECT del niño (equivale a es_admin(centro_de_nino),
-- una lectura menos y de paso valida existencia). El camino admin funciona SIN la rama
-- service_role: es_admin lee auth.uid() del JWT (no lo altera SECURITY DEFINER).
--
-- Idempotente: si el niño ya está archivado (deleted_at IS NOT NULL) → no-op limpio
-- (ya_archivado:true, 0 cambios, sin excepción). Los UPDATE llevan `... IS NULL` en el
-- WHERE, así que una 2.ª pasada afectaría 0 filas de todos modos.
--
-- Auditoría: automática. ninos, matriculas y vinculos_familiares ya están en
-- audit_trigger_function → los UPDATE disparan los triggers AFTER (sin código nuevo).
--
-- Aplicar por SQL Editor (rol postgres). NO por CLI.
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.archivar_nino(
  p_nino_id    uuid,
  p_motivo     text DEFAULT NULL,
  p_fecha_baja date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_centro_id    uuid;
  v_ya_archivado boolean;
  v_matriculas   integer := 0;
  v_vinculos     integer := 0;
BEGIN
  -- 0. Existencia + centro + estado de archivado, en una sola lectura.
  SELECT centro_id, (deleted_at IS NOT NULL)
    INTO v_centro_id, v_ya_archivado
    FROM public.ninos
    WHERE id = p_nino_id;
  IF v_centro_id IS NULL THEN
    RAISE EXCEPTION 'nino % no existe', p_nino_id USING ERRCODE = 'no_data_found';
  END IF;

  -- 1. AUTORIZACIÓN (primera sentencia con efecto; definer bypassa RLS → el gate ES
  --    la autorización real). Camino admin: es_admin(v_centro_id) sobre auth.uid().
  --    Camino cierre de curso vía service_role: rama auth.role().
  IF NOT (public.es_admin(v_centro_id) OR (SELECT auth.role()) = 'service_role') THEN
    RAISE EXCEPTION 'no autorizado a archivar este nino';
  END IF;

  -- 2. IDEMPOTENCIA: ya archivado → no-op limpio.
  IF v_ya_archivado THEN
    RETURN jsonb_build_object(
      'nino_id', p_nino_id, 'ya_archivado', true,
      'matriculas_cerradas', 0, 'vinculos_borrados', 0
    );
  END IF;

  -- 3. Cierra TODAS las matrículas abiertas (pendiente/lista/activa) del niño.
  WITH cerradas AS (
    UPDATE public.matriculas
       SET estado = 'baja', fecha_baja = p_fecha_baja, motivo_baja = p_motivo
     WHERE nino_id = p_nino_id
       AND fecha_baja IS NULL
       AND deleted_at IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_matriculas FROM cerradas;

  -- 4. Soft-delete de TODOS los vínculos del niño (lo oculta a toda su red familiar).
  WITH borrados AS (
    UPDATE public.vinculos_familiares
       SET deleted_at = now()
     WHERE nino_id = p_nino_id
       AND deleted_at IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_vinculos FROM borrados;

  -- 5. Archiva el niño.
  UPDATE public.ninos SET deleted_at = now() WHERE id = p_nino_id;

  RETURN jsonb_build_object(
    'nino_id', p_nino_id, 'ya_archivado', false,
    'matriculas_cerradas', v_matriculas, 'vinculos_borrados', v_vinculos
  );
END $$;

GRANT EXECUTE ON FUNCTION public.archivar_nino(uuid, text, date) TO authenticated, service_role;

COMMIT;
