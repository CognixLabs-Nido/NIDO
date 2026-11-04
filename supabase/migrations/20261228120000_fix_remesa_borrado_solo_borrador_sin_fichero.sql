-- Una remesa solo se borra (soft delete) si es un borrador que nunca tuvo fichero registrado. Para
-- todos, también service_role: remesas_proteger se queda sin ninguna excepción. El DELETE no se toca.
--
-- Lo medido antes (2026-11-04, producción en solo lectura y ensayo terminado en RAISE):
--   - No hay ficheros de remesa huérfanos, ni puede haberlos por borrar una remesa: el barrido de
--     retención (ficheros_remesa_vencidos y destruir_fichero_remesa) encuentra cada fichero por su
--     fecha en remesa_ficheros, no por su remesa, y con la remesa borrada lo sigue listando y
--     destruyendo a su plazo. Y la FK RESTRICT de remesa_ficheros impide el DELETE de una remesa con
--     fichero. Hoy: 0 ficheros, 0 objetos en el bucket, ninguna remesa borrada nunca.
--   - Lo que se cierra es más pequeño: que una remesa con historia desaparezca de la app. Lo
--     permitían dos caminos: service_role borraba cualquier remesa, también una enviada
--     (remesas_proteger le dejaba pasar antes de mirar el borrado), y una sesión borraba una remesa
--     reabierta, que vuelve a borrador sin la marca pero conserva el fichero de su versión anterior.
--
-- Los caminos legítimos que borran remesas hoy, y que siguen pasando:
--   1. crearRemesa (con sesión) borra la remesa que acaba de crear si no se pudieron enlazar sus
--      recibos: un borrador que nunca tuvo fichero.
--   2. destruir_fiscal_familia (service_role) borra con DELETE la remesa que se queda vacía.
--   3. Borrar un centro (la limpieza de los tests, service_role): DELETE en cascada.
-- Los dos últimos son DELETE y no pasan por este trigger (BEFORE UPDATE).
--
-- Se aplica por el SQL Editor copiando este fichero.

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF to_regprocedure('privado.remesa_tuvo_fichero(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'privado.remesa_tuvo_fichero ya existe: ¿aplicada dos veces?';
  END IF;
  -- El cuerpo vivo, el de 20261227120000 (lógica normalizada: sin \r, sin comentarios, espacios).
  SELECT md5(regexp_replace(regexp_replace(replace(prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc WHERE oid = 'public.remesas_proteger()'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'ecc168eeeb95ca0a56bb685148921772' THEN
    RAISE EXCEPTION 'remesas_proteger no es el de 20261227120000 (md5 %)', v_md5;
  END IF;
  RAISE NOTICE 'antes: % remesas borradas; % de ellas con fichero registrado; % ficheros en total',
    (SELECT count(*) FROM public.remesas WHERE deleted_at IS NOT NULL),
    (SELECT count(*) FROM public.remesas r
      WHERE r.deleted_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.remesa_ficheros f WHERE f.remesa_id = r.id)),
    (SELECT count(*) FROM public.remesa_ficheros);
END
$guarda$;

-- ---- ¿Tuvo la remesa algún fichero registrado? ----
-- remesa_ficheros no tiene privilegios para nadie, tampoco service_role, y remesas_proteger es de
-- invocador: la pregunta va en una función SECURITY DEFINER que solo contesta sí o no. Vive en
-- privado, que la API no expone; authenticated y service_role la ejecutan porque el trigger corre
-- con su rol.
CREATE FUNCTION privado.remesa_tuvo_fichero(p_remesa_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.remesa_ficheros f WHERE f.remesa_id = p_remesa_id);
$function$;
REVOKE ALL ON FUNCTION privado.remesa_tuvo_fichero(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION privado.remesa_tuvo_fichero(uuid) TO authenticated, service_role;

-- ---- remesas_proteger: el borrado, para todos ----
CREATE OR REPLACE FUNCTION public.remesas_proteger()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reabrir boolean := COALESCE(current_setting('app.reabrir_remesa', true), '') = OLD.id::text;
BEGIN
  -- La marca del fichero solo la quita reabrir_remesa (y la deja en NULL: la siguiente descarga
  -- pone la de la versión nueva). Para todos.
  IF OLD.fichero_generado_at IS NOT NULL
     AND NEW.fichero_generado_at IS DISTINCT FROM OLD.fichero_generado_at
     AND NOT (v_reabrir AND NEW.fichero_generado_at IS NULL) THEN
    RAISE EXCEPTION 'la marca del fichero generado no se quita' USING ERRCODE = 'P0001', HINT = 'fichero_generado';
  END IF;
  -- Una remesa enviada no vuelve a borrador: solo reabrir_remesa. Para todos, también service_role
  -- (20261227120000; hasta aquí la excepción de abajo la dejaba pasar).
  IF OLD.estado = 'enviada' AND NEW.estado <> 'enviada' AND NOT v_reabrir THEN
    RAISE EXCEPTION 'una remesa enviada no vuelve a borrador' USING ERRCODE = 'P0001', HINT = 'remesa_cerrada';
  END IF;
  -- Solo se borra un borrador que nunca tuvo fichero: el que crearRemesa deshace si no pudo
  -- enlazar sus recibos. Una remesa con historia no desaparece de la app. Para todos, también
  -- service_role (20261228120000; hasta aquí, solo con sesión). El DELETE no pasa por aquí.
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    IF OLD.estado = 'enviada' THEN
      RAISE EXCEPTION 'una remesa enviada no se borra' USING ERRCODE = 'P0001', HINT = 'remesa_cerrada';
    END IF;
    IF OLD.fichero_generado_at IS NOT NULL THEN
      RAISE EXCEPTION 'una remesa con el fichero generado no se borra' USING ERRCODE = 'P0001', HINT = 'remesa_con_fichero';
    END IF;
    -- La reabierta: vuelve a borrador sin la marca, pero el fichero de su versión anterior se queda.
    IF privado.remesa_tuvo_fichero(OLD.id) THEN
      RAISE EXCEPTION 'una remesa que tuvo fichero no se borra: es la de lo que se envió al banco'
        USING ERRCODE = 'P0001', HINT = 'remesa_con_historia';
    END IF;
  END IF;
  -- Ya no queda excepción de service_role: todo lo de arriba vale para todos.
  RETURN NEW;
END $function$;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_src text;
BEGIN
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v_src
    FROM pg_proc WHERE oid = 'public.remesas_proteger()'::regprocedure;
  -- Los tres rechazos del borrado están, y ya no queda ninguna excepción de service_role.
  IF strpos(v_src, 'una remesa enviada no se borra') = 0
     OR strpos(v_src, 'una remesa con el fichero generado no se borra') = 0
     OR strpos(v_src, 'privado.remesa_tuvo_fichero(OLD.id)') = 0 THEN
    RAISE EXCEPTION 'remesas_proteger no mira los tres casos del borrado';
  END IF;
  IF strpos(v_src, '''service_role''') > 0 THEN
    RAISE EXCEPTION 'remesas_proteger todavía deja pasar a service_role';
  END IF;
  -- Y lo que ya cerraba sigue (20261227120000): la marca y la vuelta de la enviada.
  IF v_src !~ 'app\.reabrir_remesa' OR strpos(v_src, 'una remesa enviada no vuelve a borrador') = 0 THEN
    RAISE EXCEPTION 'remesas_proteger perdió lo de 20261227120000';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'privado.remesa_tuvo_fichero(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'privado.remesa_tuvo_fichero tiene que ser SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', 'privado.remesa_tuvo_fichero(uuid)', 'EXECUTE')
     OR has_function_privilege('public', 'privado.remesa_tuvo_fichero(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'privado.remesa_tuvo_fichero(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'privado.remesa_tuvo_fichero(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilegios de privado.remesa_tuvo_fichero no esperados';
  END IF;
  RAISE NOTICE 'guarda posterior: el borrado de una remesa, solo de un borrador sin fichero, para todos';
END
$guarda$;
