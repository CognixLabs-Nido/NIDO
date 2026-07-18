-- =============================================================================
-- D-5 (fix del fix) · solicitar_olvido_nino: cast explícito del CASE al ENUM
-- -----------------------------------------------------------------------------
-- BUG (42804 datatype_mismatch): en 20260807120000 el soft-delete del niño estampa
-- el motivo con un CASE de literales:
--     deleted_reason = CASE WHEN deleted_reason = 'purga_rgpd'
--                           THEN 'purga_rgpd' ELSE 'solicitud_olvido' END
-- Los literales de las ramas son de tipo `unknown`; cuando TODAS las ramas de un CASE
-- son `unknown`, PostgreSQL resuelve el tipo del CASE a `text`. Asignar `text` a una
-- columna `motivo_borrado` (ENUM) NO tiene cast implícito → ERROR 42804. (Los otros 5
-- writers estampan el motivo con un literal PELADO —`deleted_reason = 'baja_nino'`—,
-- que sí se coacciona unknown→enum por el tipo de la columna destino; solo el CASE
-- fuerza `text` primero. Barrido pg_proc: `solicitar_olvido_nino` es la ÚNICA con CASE.)
--
-- Rompía el olvido RGPD: al solicitar el olvido de un niño la RPC abortaba (×7 en la
-- suite: olvido-funcional o01..o10 + d5-blindar-desarchivar). 20260807 ya está APLICADA
-- (inmutable) → se corrige con esta migración nueva.
--
-- FIX: cast explícito de cada rama a `public.motivo_borrado`. Único cambio respecto a
-- 20260807120000. Probado contra el remoto en transacción con ROLLBACK: cadena completa
-- archivar→desarchivar y solicitar→purgar→re-solicitar(monótono)→desarchivar(RAISE de
-- negocio) sin error de tipos; solicitar deja reason='solicitud_olvido' y, sobre un
-- niño ya purgado, preserva 'purga_rgpd'.
--
-- Aplicar por SQL Editor / db push (rol postgres). No cambia firma ni tipos → database.ts
-- no requiere regeneración.
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.solicitar_olvido_nino(
  p_nino_id   uuid,
  p_inmediato boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_centro uuid;
  v_gracia timestamptz;
  v_id     uuid;
BEGIN
  SELECT centro_id INTO v_centro FROM public.ninos WHERE id = p_nino_id;
  IF v_centro IS NULL THEN
    RAISE EXCEPTION 'niño no encontrado: %', p_nino_id USING ERRCODE = 'no_data_found';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.es_admin(v_centro) THEN
    RAISE EXCEPTION 'no autorizado a ejercer el olvido en este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_gracia := CASE WHEN p_inmediato THEN now() ELSE now() + interval '30 days' END;

  -- D-5: estampa el motivo del soft-delete (respeta el CHECK). Preserva 'purga_rgpd'
  -- si el niño ya estaba purgado; en el resto de casos marca 'solicitud_olvido'.
  -- Cast EXPLÍCITO de cada rama al ENUM: un CASE de literales `unknown` resuelve a `text`
  -- y `text`→`motivo_borrado` no tiene cast implícito (42804). Ver cabecera.
  UPDATE public.ninos
     SET deleted_at = COALESCE(deleted_at, now()),
         deleted_reason = CASE WHEN deleted_reason = 'purga_rgpd'
                               THEN 'purga_rgpd'::public.motivo_borrado
                               ELSE 'solicitud_olvido'::public.motivo_borrado END
   WHERE id = p_nino_id;

  INSERT INTO public.olvido_solicitudes
    (sujeto_tipo, sujeto_id, centro_id, solicitado_por, gracia_hasta, inmediato)
  VALUES ('nino', p_nino_id, v_centro, auth.uid(), v_gracia, p_inmediato)
  ON CONFLICT (sujeto_tipo, sujeto_id) WHERE purgado_en IS NULL
  DO UPDATE SET
    gracia_hasta = LEAST(public.olvido_solicitudes.gracia_hasta, EXCLUDED.gracia_hasta),
    inmediato    = public.olvido_solicitudes.inmediato OR EXCLUDED.inmediato
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.solicitar_olvido_nino(uuid, boolean)
  TO authenticated, service_role;

COMMIT;
