-- MUTACIÓN (rama mut/, no se mergea): reescribe la función viva.
DO $m$ DECLARE d text; BEGIN d := pg_get_functiondef('public.marcar_matricula_lista(uuid)'::regprocedure);
IF position('IS NULL
               OR n.hermanos_total IS NULL)) THEN' in d) = 0 THEN RAISE EXCEPTION 'MUTACION INVALIDA: no encuentro el ancla'; END IF;
EXECUTE replace(d, 'IS NULL
               OR n.hermanos_total IS NULL)) THEN', 'IS NULL)) THEN'); END $m$;
