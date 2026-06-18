-- F11 P3c — RPC marcar_matricula_lista: el TUTOR LEGAL finaliza el alta de su hijo
-- (pendiente → lista). La RLS de matriculas deja UPDATE solo al admin, así que el
-- tutor pasa por esta RPC SECURITY DEFINER. Gate es_tutor_legal_de (principal/
-- secundario; NO es_tutor_de, que incluiría 'autorizado'): finalizar es acto de
-- guardián legal. Backstop de identidad (nombre+fecha) para llamadas directas por
-- PostgREST; la action finalizarAlta valida identidad primero con mensaje claro.
-- Idempotente: si no hay matrícula 'pendiente', devuelve null.
CREATE OR REPLACE FUNCTION public.marcar_matricula_lista(p_nino_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.es_tutor_legal_de(p_nino_id) THEN
    RAISE EXCEPTION 'no autorizado a finalizar el alta de este nino'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.matriculas
     SET estado = 'lista'
   WHERE nino_id = p_nino_id
     AND estado = 'pendiente'
     AND fecha_baja IS NULL
     AND deleted_at IS NULL
     AND EXISTS (
       SELECT 1 FROM public.ninos n
        WHERE n.id = p_nino_id
          AND n.apellidos IS NOT NULL
          AND n.fecha_nacimiento IS NOT NULL
     )
   RETURNING id INTO v_id;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.marcar_matricula_lista(uuid) TO authenticated;
