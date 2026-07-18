-- =============================================================================
-- D-5 (fix del blindaje) · solicitar_olvido_nino estampa el motivo del soft-delete
-- -----------------------------------------------------------------------------
-- CREATE OR REPLACE de solicitar_olvido_nino (F-11-A-4). ÚNICO cambio funcional: el
-- soft-delete del niño al solicitar el olvido ahora estampa `deleted_reason` para
-- respetar el CHECK `ninos_deleted_reason_coherente` (mig 20260805120000). El resto es
-- IDÉNTICO a 20260614130000.
--
-- Motivo = 'solicitud_olvido' (valor añadido en 20260806120000). Si el niño YA estaba
-- purgado ('purga_rgpd'), se preserva ese motivo (no se degrada) — orden monótono
-- baja_nino → solicitud_olvido → purga_rgpd. En cualquier caso el motivo ≠ 'baja_nino'
-- → desarchivar_nino hace RAISE: un niño con solicitud de olvido NO es reincorporable.
--
-- Barrido COMPLETO de writers de deleted_at sobre las 4 tablas con CHECK (pg_proc del
-- esquema vivo, alias-aware): archivar_nino, revocar_acceso_familia, purgar_sujeto_db,
-- desarchivar_nino, crear_o_anadir_a_familia y solicitar_olvido_nino. Los 5 primeros ya
-- estampan/limpian motivo (mig 20260805); esta migración cierra el 6.º (el único gap).
--
-- Aplicar por SQL Editor / db push (rol postgres). Regenerar database.ts DESPUÉS.
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
  UPDATE public.ninos
     SET deleted_at = COALESCE(deleted_at, now()),
         deleted_reason = CASE WHEN deleted_reason = 'purga_rgpd'
                               THEN 'purga_rgpd' ELSE 'solicitud_olvido' END
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
