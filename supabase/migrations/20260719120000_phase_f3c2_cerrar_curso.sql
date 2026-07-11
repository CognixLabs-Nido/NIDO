-- =============================================================================
-- F-3-C-2 · Cierre de curso: orquestadora cerrar_curso (RPC transaccional)
-- -----------------------------------------------------------------------------
-- Consume las decisiones del rollover (F-3-A) y arregla la fuga de matrícula
-- vieja del modelo multicurso. TODO en UNA transacción (todo-o-nada):
--
--   FINALIZAN (filas `rollover_finaliza` del curso destino):
--     1. Se archivan TODOS con `archivar_nino(nino, motivo, fecha_baja=fin de curso)`
--        ANTES de evaluar revocación (el guard de revocar cuenta niños activos →
--        deben estar ya archivados para que la familia pueda quedar "vacía").
--     2. Para cada familia afectada (dedupe): `revocar_acceso_familia(familia)`.
--        El guard interno solo revoca si la familia quedó SIN niños activos → un
--        hermano que CONTINÚA la protege automáticamente.
--     3. Se borran las filas `rollover_finaliza` consumidas (el soft-delete del
--        niño NO las cascadea; hay que borrarlas explícitamente).
--
--   CONTINÚAN:
--     4. Flip `pendiente → activa` de las matrículas del curso destino.
--     5. Cierre de la matrícula VIEJA del curso saliente (`estado='baja'`,
--        `fecha_baja = fin de curso`), acotado por `curso_academico_id = saliente`
--        → NUNCA toca la nueva del destino. Las de los finalizadores ya están
--        'baja' por `archivar_nino`, así que el filtro `estado='activa'` deja
--        exactamente a los que continúan.
--     6. Cierre de las `profes_aulas` VIEJAS del saliente (`fecha_fin = fin de
--        curso`) → dejan de contar en el aula vieja (fuga de audiencia/permiso).
--
--   7. Activar el curso destino / cerrar el saliente (lo que hacía `activarCurso`).
--
-- ATOMICIDAD TODO-O-NADA (CRÍTICO): esta función NO lleva NINGÚN bloque
-- `EXCEPTION`. Un `RAISE` en cualquier primitivo (o un CHECK violado) propaga
-- hasta el cliente y revierte TODO — el curso NO queda cerrado, nada archivado.
-- El error crudo (con su contexto) ES el reporte; la directora corrige y
-- reintenta. NO se envuelve en `EXCEPTION WHEN OTHERS` para "reportar el niño
-- que falló": eso convertiría el todo-o-nada en best-effort silencioso y, además,
-- el savepoint implícito del handler rompería el rollback total.
--
-- Los primitivos `archivar_nino` / `revocar_acceso_familia` se llaman TAL CUAL:
-- una función que invoca otra comparte la MISMA transacción (sin autocommit ni
-- subtransacción), y `SECURITY DEFINER` no altera la frontera transaccional ni
-- `auth.uid()`/`auth.role()` (leen el JWT del invocador). No se refactorizan a
-- funciones internas.
--
-- IDEMPOTENTE: destino ya 'activo' → no-op (ya_activo). Un reintento tras un
-- fallo corregido no duplica: los primitivos son idempotentes y todos los UPDATE
-- llevan su `WHERE ... IS NULL`/estado, así que una 2.ª pasada afecta 0 filas.
--
-- ACTOR DE AUDITORÍA: sin GUC ni p_actor. La función corre bajo la sesión del
-- admin (su JWT) → dentro de los primitivos `auth.uid()` YA es el admin → el
-- trigger `audit_trigger_function` registra al admin automáticamente.
--
-- DEPENDENCIA: requiere `revocar_acceso_familia` (F-3-C-3, migración
-- 20260718120000) aplicada ANTES de invocar esta RPC en runtime.
--
-- Aplicar por SQL Editor (rol postgres). NO por CLI.
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.cerrar_curso(p_curso_destino_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_centro_id            uuid;
  v_destino_estado       public.curso_estado;
  v_saliente_id          uuid;
  v_saliente_fin         date;
  v_fecha_baja           date;
  v_finalizados          integer := 0;
  v_familias_revocadas   integer := 0;
  v_matriculas_cerradas  integer := 0;
  v_profes_cerrados      integer := 0;
  r_fin                  record;
BEGIN
  -- 0. Existencia + centro + estado del curso destino.
  SELECT centro_id, estado
    INTO v_centro_id, v_destino_estado
    FROM public.cursos_academicos
    WHERE id = p_curso_destino_id AND deleted_at IS NULL;
  IF v_centro_id IS NULL THEN
    RAISE EXCEPTION 'curso destino % no existe', p_curso_destino_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- 1. AUTORIZACIÓN (primera sentencia con efecto; definer bypassa RLS → el gate
  --    ES la autorización real). Camino admin: es_admin(v_centro_id) sobre auth.uid().
  IF NOT (public.es_admin(v_centro_id) OR (SELECT auth.role()) = 'service_role') THEN
    RAISE EXCEPTION 'no autorizado a cerrar el curso de este centro';
  END IF;

  -- 2. IDEMPOTENCIA: destino ya activo → el cierre ya se hizo, no-op limpio.
  IF v_destino_estado = 'activo' THEN
    RETURN jsonb_build_object(
      'curso_destino_id', p_curso_destino_id, 'cerrado', false,
      'ya_activo', true, 'motivo', 'ya_activo'
    );
  END IF;
  IF v_destino_estado <> 'planificado' THEN
    RAISE EXCEPTION 'curso destino % no está planificado (estado=%)',
      p_curso_destino_id, v_destino_estado USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 3. Curso SALIENTE = el ACTIVO del centro (de donde salen los niños). Puede no
  --    existir (primera activación del centro): entonces no hay finalizadores ni
  --    matrículas viejas que cerrar; solo se activa el destino.
  SELECT id, fecha_fin
    INTO v_saliente_id, v_saliente_fin
    FROM public.cursos_academicos
    WHERE centro_id = v_centro_id AND estado = 'activo' AND deleted_at IS NULL;

  v_fecha_baja := COALESCE(v_saliente_fin, public.hoy_madrid());

  -- 4. FINALIZAN: archivar TODOS los finalizadores del destino. Se hace ANTES de
  --    revocar (paso 5) para que el guard de revocar vea el estado final.
  FOR r_fin IN
    SELECT rf.nino_id
      FROM public.rollover_finaliza rf
     WHERE rf.curso_academico_id = p_curso_destino_id
  LOOP
    PERFORM public.archivar_nino(r_fin.nino_id, 'fin de etapa (no continúa)', v_fecha_baja);
    v_finalizados := v_finalizados + 1;
  END LOOP;

  -- 5. Revocar acceso de las familias afectadas (dedupe por familia). El guard
  --    interno solo revoca si la familia quedó SIN niños activos: un hermano que
  --    continúa (nunca archivado, vínculos vivos) la protege.
  FOR r_fin IN
    SELECT DISTINCT n.familia_id
      FROM public.rollover_finaliza rf
      JOIN public.ninos n ON n.id = rf.nino_id
     WHERE rf.curso_academico_id = p_curso_destino_id
       AND n.familia_id IS NOT NULL
  LOOP
    IF (public.revocar_acceso_familia(r_fin.familia_id) ->> 'revocado')::boolean THEN
      v_familias_revocadas := v_familias_revocadas + 1;
    END IF;
  END LOOP;

  -- 6. Borrar las filas rollover_finaliza consumidas (el soft-delete del niño NO
  --    las cascadea → borrado explícito).
  DELETE FROM public.rollover_finaliza WHERE curso_academico_id = p_curso_destino_id;

  -- 7. CONTINÚAN: flip pendiente → activa en el destino.
  UPDATE public.matriculas
     SET estado = 'activa'
   WHERE curso_academico_id = p_curso_destino_id
     AND estado = 'pendiente'
     AND deleted_at IS NULL;

  -- 8+9. Cierre de matrículas viejas y profes_aulas del saliente (si hay saliente).
  IF v_saliente_id IS NOT NULL THEN
    -- 8. Matrícula VIEJA de los que continúan (los finalizadores ya están 'baja').
    --    Acotada por curso_academico_id = saliente → NUNCA la nueva del destino.
    WITH cerradas AS (
      UPDATE public.matriculas
         SET estado = 'baja', fecha_baja = v_saliente_fin, motivo_baja = 'pasa de curso'
       WHERE curso_academico_id = v_saliente_id
         AND estado = 'activa'
         AND fecha_baja IS NULL
         AND deleted_at IS NULL
      RETURNING 1
    )
    SELECT count(*) INTO v_matriculas_cerradas FROM cerradas;

    -- 9. profes_aulas VIEJAS del saliente → fecha_fin = fin de curso.
    WITH profes AS (
      UPDATE public.profes_aulas
         SET fecha_fin = v_saliente_fin
       WHERE curso_academico_id = v_saliente_id
         AND fecha_fin IS NULL
         AND deleted_at IS NULL
      RETURNING 1
    )
    SELECT count(*) INTO v_profes_cerrados FROM profes;

    -- 10a. Cerrar el curso saliente.
    UPDATE public.cursos_academicos SET estado = 'cerrado' WHERE id = v_saliente_id;
  END IF;

  -- 10b. Activar el curso destino.
  UPDATE public.cursos_academicos SET estado = 'activo' WHERE id = p_curso_destino_id;

  RETURN jsonb_build_object(
    'curso_destino_id', p_curso_destino_id,
    'curso_saliente_id', v_saliente_id,
    'cerrado', true,
    'ya_activo', false,
    'fecha_fin', v_saliente_fin,
    'finalizados', v_finalizados,
    'familias_revocadas', v_familias_revocadas,
    'matriculas_continuan_cerradas', v_matriculas_cerradas,
    'profes_aulas_cerrados', v_profes_cerrados
  );
END $$;

GRANT EXECUTE ON FUNCTION public.cerrar_curso(uuid) TO authenticated, service_role;

COMMIT;
