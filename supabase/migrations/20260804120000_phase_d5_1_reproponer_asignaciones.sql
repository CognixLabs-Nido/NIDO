-- =============================================================================
-- D-5 (punto 1) · reproponer_asignaciones — revivir las auto borradas por error
-- -----------------------------------------------------------------------------
-- ADITIVA: crea UNA función nueva. NO toca proponer_asignaciones (F-4-2), que sigue
-- siendo el "Proponer" aditivo de siempre (solo rellena huecos, jamás resucita).
--
-- PROBLEMA: proponer_asignaciones no revive una asignación origen='automatico'
-- soft-borrada — su guard es NOT EXISTS(cualquier fila, viva NI muerta) para
-- (concepto, destino), así que una auto borrada cuenta como "ya existe" y no se
-- resiembra. Fue deliberado (respetar la edición de la directora), pero deja sin
-- salida el borrado accidental.
--
-- SOLUCIÓN: "Re-proponer desde cero". Por cada concepto aplicacion='automatico',
-- por cada DESTINO que HOY cumple la regla de ámbito/umbral (nino → matriculado
-- activo; familia → ≥1 hijo activo, y ≥2 para el descuento hermanos signo=-1), en
-- DOS pasos y en este orden:
--   A. REVIVE una auto soft-borrada (deleted_at → NULL) SOLO si NO hay ya una fila
--      VIVA de ese par. `DISTINCT ON (destino)` garantiza ≤1 resurrección por
--      destino (si hubiera varias muertas del mismo par, revive una sola → nunca
--      crea dos vivas → nunca viola el UNIQUE parcial (concepto, destino) WHERE
--      deleted_at IS NULL). Restaura el ÚLTIMO estado de la fila (cantidad/importe/
--      vigencia tal cual quedaron): es "resucitar", no "resetear".
--   B. SIEMBRA las que falten con guard NOT EXISTS(fila VIVA) — como el paso A ya
--      corrió en la misma transacción, sus filas revividas cuentan como vivas → B
--      no las duplica. Un destino cuyo único rastro es una MANUAL soft-borrada SÍ
--      recibe una auto nueva (la manual borrada es otra cosa; se siembra según las
--      reglas del concepto — decisión de producto cerrada).
--
-- INVARIANTE INNEGOCIABLE: NUNCA toca las asignaciones MANUALES (origen='manual':
-- becas, descuentos, todo lo añadido a mano). El paso A solo hace UPDATE de filas
-- origen='automatico'; nada las borra ni altera. NO borra nada en ningún paso.
--
-- CASO CRÍTICO (auto borrada + manual VIVA del mismo par): el guard NOT EXISTS(fila
-- viva) en AMBOS pasos hace que ni A revive (hay manual viva) ni B siembra → la
-- MANUAL gana, sin duplicado ni violación de UNIQUE.
--
-- Auditoría: automática (el UPDATE del revive y el INSERT de la siembra disparan
-- audit_asignacion_concepto sin código nuevo). Devuelve { revividas, sembradas }.
--
-- Aplicar por SQL Editor / db push (rol postgres). Regenerar database.ts DESPUÉS.
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.reproponer_asignaciones(p_centro_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r_concepto  record;
  v_revividas integer := 0;
  v_sembradas integer := 0;
  v_n         integer;
BEGIN
  IF NOT public.es_admin(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  FOR r_concepto IN
    SELECT id, ambito, signo
    FROM public.conceptos_cobro
    WHERE centro_id = p_centro_id
      AND aplicacion = 'automatico'
      AND activo = true
      AND deleted_at IS NULL
  LOOP
    IF r_concepto.ambito = 'nino' THEN
      -- A. REVIVE (≤1 por niño; solo si no hay fila viva del par).
      WITH candidatas AS (
        SELECT DISTINCT ON (a.nino_id) a.id
        FROM public.asignacion_concepto a
        JOIN public.ninos n      ON n.id = a.nino_id
        JOIN public.matriculas m ON m.nino_id = n.id
        WHERE a.concepto_id = r_concepto.id
          AND a.origen = 'automatico'
          AND a.deleted_at IS NOT NULL
          AND n.centro_id = p_centro_id
          AND m.estado = 'activa' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.asignacion_concepto b
            WHERE b.concepto_id = r_concepto.id AND b.nino_id = a.nino_id
              AND b.deleted_at IS NULL
          )
        ORDER BY a.nino_id, a.created_at DESC
      )
      UPDATE public.asignacion_concepto ac
         SET deleted_at = NULL
       WHERE ac.id IN (SELECT id FROM candidatas);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_revividas := v_revividas + v_n;

      -- B. SIEMBRA lo que falte (guard = NOT EXISTS fila VIVA).
      INSERT INTO public.asignacion_concepto (concepto_id, nino_id, origen)
      SELECT r_concepto.id, n.id, 'automatico'
      FROM public.ninos n
      JOIN public.matriculas m ON m.nino_id = n.id
      WHERE n.centro_id = p_centro_id
        AND m.estado = 'activa' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.asignacion_concepto a
          WHERE a.concepto_id = r_concepto.id AND a.nino_id = n.id
            AND a.deleted_at IS NULL
        );
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_sembradas := v_sembradas + v_n;

    ELSE  -- ambito = 'familia'
      -- A. REVIVE (≤1 por familia; umbral por signo; solo si no hay fila viva).
      WITH candidatas AS (
        SELECT DISTINCT ON (a.familia_id) a.id
        FROM public.asignacion_concepto a
        JOIN public.familias f ON f.id = a.familia_id
        WHERE a.concepto_id = r_concepto.id
          AND a.origen = 'automatico'
          AND a.deleted_at IS NOT NULL
          AND f.centro_id = p_centro_id
          AND (
            SELECT count(*) FROM public.ninos n
            JOIN public.matriculas m ON m.nino_id = n.id
            WHERE n.familia_id = f.id
              AND m.estado = 'activa' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
          ) >= CASE WHEN r_concepto.signo = -1 THEN 2 ELSE 1 END
          AND NOT EXISTS (
            SELECT 1 FROM public.asignacion_concepto b
            WHERE b.concepto_id = r_concepto.id AND b.familia_id = a.familia_id
              AND b.deleted_at IS NULL
          )
        ORDER BY a.familia_id, a.created_at DESC
      )
      UPDATE public.asignacion_concepto ac
         SET deleted_at = NULL
       WHERE ac.id IN (SELECT id FROM candidatas);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_revividas := v_revividas + v_n;

      -- B. SIEMBRA lo que falte (guard = NOT EXISTS fila VIVA).
      INSERT INTO public.asignacion_concepto (concepto_id, familia_id, origen)
      SELECT r_concepto.id, f.id, 'automatico'
      FROM public.familias f
      WHERE f.centro_id = p_centro_id
        AND (
          SELECT count(*) FROM public.ninos n
          JOIN public.matriculas m ON m.nino_id = n.id
          WHERE n.familia_id = f.id
            AND m.estado = 'activa' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
        ) >= CASE WHEN r_concepto.signo = -1 THEN 2 ELSE 1 END
        AND NOT EXISTS (
          SELECT 1 FROM public.asignacion_concepto a
          WHERE a.concepto_id = r_concepto.id AND a.familia_id = f.id
            AND a.deleted_at IS NULL
        );
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_sembradas := v_sembradas + v_n;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('revividas', v_revividas, 'sembradas', v_sembradas);
END $$;
GRANT EXECUTE ON FUNCTION public.reproponer_asignaciones(uuid) TO authenticated;

COMMIT;
