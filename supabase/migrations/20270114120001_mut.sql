-- MUTACIÓN (rama mut/, no se mergea): reescribe la función viva.
DO $m$ DECLARE d text; BEGIN d := pg_get_functiondef('public.marcar_matricula_lista(uuid)'::regprocedure);
IF position('IF v_pendiente AND EXISTS (
       SELECT 1 FROM public.ninos n
        WHERE n.id = p_nino_id
          AND (n.apellidos IS NULL' in d) = 0 THEN RAISE EXCEPTION 'MUTACION INVALIDA: no encuentro el ancla'; END IF;
EXECUTE replace(d, 'IF v_pendiente AND EXISTS (
       SELECT 1 FROM public.ninos n
        WHERE n.id = p_nino_id
          AND (n.apellidos IS NULL', 'IF false AND EXISTS (
       SELECT 1 FROM public.ninos n
        WHERE n.id = p_nino_id
          AND (n.apellidos IS NULL'); END $m$;
