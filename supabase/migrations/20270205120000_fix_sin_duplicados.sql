-- C (2026-11-23): dos a la vez no crean un duplicado. Decisiones del responsable, en la spec
-- `fallos-leidos-c.md` (2026-11-23, «la lista de espera» y «la imagen»).
--
-- 1. Lista de espera. `posicion` la calculaba la app como «la última + 1» (dos altas a la vez salían
--    con la misma) y la reordenación mandaba un UPDATE por fila, en paralelo, numerando 1..N solo las
--    no descartadas: una descartada conserva la suya y choca, sin concurrencia ninguna (medido
--    abierto en `lista-espera-orden.rls.test.ts`; en producción, el 2026-11-24, el único curso con
--    lista tiene descartados en 2 y 3 e invitados en 1, 4 y 5: un arrastre los pisaba). Ahora: la posición la pone la base al crear, la
--    reordenación es UNA sentencia que numera el curso entero, y una restricción única lo garantiza.
--    DEFERRABLE (inicialmente inmediata): un UPDATE que permuta posiciones se comprueba al final de la
--    sentencia, no fila a fila.
-- 2. Imagen: una instancia publicada por niño y versión del texto. Cinco clics de la misma versión
--    no son cinco consentimientos; una versión nueva sí es algo nuevo que firmar.

-- Sin duplicados de partida (leído en prod el 2026-11-23: 0 en lista y 0 en imagen). Si los hubiera,
-- la restricción no se crearía a mitad: se aborta antes, diciendo cuántos.
DO $$
DECLARE n_lista int; n_imagen int;
BEGIN
  SELECT count(*) INTO n_lista FROM (
    SELECT 1 FROM public.lista_espera GROUP BY curso_academico_id, posicion HAVING count(*) > 1) x;
  SELECT count(*) INTO n_imagen FROM (
    SELECT 1 FROM public.autorizaciones
     WHERE tipo = 'autorizacion_imagenes' AND es_plantilla = false AND estado = 'publicada'
       AND nino_id IS NOT NULL
     GROUP BY nino_id, texto_version HAVING count(*) > 1) x;
  IF n_lista > 0 OR n_imagen > 0 THEN
    RAISE EXCEPTION 'duplicados de partida: lista_espera % grupos, imagen % grupos', n_lista, n_imagen;
  END IF;
END $$;

-- ---------------------------------------------------------------- lista de espera
-- El cerrojo del curso lo toman la creación y la reordenación, así no se cruzan. La MISMA clave en
-- las dos (el ensayo de esta migración lo comprueba sobre sus cuerpos):
--   pg_advisory_xact_lock(hashtextextended('lista_espera:' || <curso>::text, 0))

-- Al crear, la posición es la última del curso + 1, con el cerrojo puesto. Lo que mande la app se
-- ignora. SECURITY DEFINER para ver TODAS las filas del curso, también las que la RLS no le
-- enseñaría a quien inserta: si no, «la última» podría no ser la última.
CREATE FUNCTION privado.lista_espera_posicion_al_crear() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('lista_espera:' || NEW.curso_academico_id::text, 0));
  SELECT coalesce(max(l.posicion), 0) + 1 INTO NEW.posicion
    FROM public.lista_espera l WHERE l.curso_academico_id = NEW.curso_academico_id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION privado.lista_espera_posicion_al_crear() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER lista_espera_posicion_al_crear
  BEFORE INSERT ON public.lista_espera
  FOR EACH ROW EXECUTE FUNCTION privado.lista_espera_posicion_al_crear();

-- Reordenar: p_orden son los ids NO descartados del curso en el orden nuevo (lo que pinta el panel).
-- Tienen que ser exactamente esos: si el panel está desfasado (alguien añadió o descartó entre
-- tanto), se rechaza con hint `orden_desfasado` y el panel recarga, en vez de numerar sobre lo que no
-- vio. Los descartados van detrás, en su orden de antes. Una sola sentencia: todo o nada.
-- SECURITY INVOKER: la RLS de `lista_espera` (admin del centro) decide; un curso ajeno no tiene filas
-- visibles y el conjunto no casa.
CREATE FUNCTION public.reordenar_lista_espera(p_curso uuid, p_orden uuid[]) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('lista_espera:' || p_curso::text, 0));
  IF p_orden IS NULL OR cardinality(p_orden) <> (SELECT count(DISTINCT x) FROM unnest(p_orden) x)
     OR (SELECT array_agg(id ORDER BY id) FROM public.lista_espera
          WHERE curso_academico_id = p_curso AND estado <> 'descartado')
        IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(p_orden) x) THEN
    RAISE EXCEPTION 'el orden no es el de la lista del curso' USING ERRCODE = 'P0001', HINT = 'orden_desfasado';
  END IF;
  WITH nuevo AS (
    SELECT l.id, row_number() OVER (
             ORDER BY (o.k IS NULL), o.k, l.posicion, l.id) AS pos
      FROM public.lista_espera l
      LEFT JOIN unnest(p_orden) WITH ORDINALITY AS o(id, k) ON o.id = l.id
     WHERE l.curso_academico_id = p_curso)
  UPDATE public.lista_espera l SET posicion = nuevo.pos
    FROM nuevo WHERE nuevo.id = l.id AND l.posicion IS DISTINCT FROM nuevo.pos;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.reordenar_lista_espera(uuid, uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reordenar_lista_espera(uuid, uuid[]) TO authenticated;

ALTER TABLE public.lista_espera
  ADD CONSTRAINT lista_espera_curso_posicion_unica UNIQUE (curso_academico_id, posicion)
  DEFERRABLE INITIALLY IMMEDIATE;

-- ---------------------------------------------------------------- imagen
CREATE UNIQUE INDEX autorizaciones_imagen_una_por_nino_y_version
  ON public.autorizaciones (nino_id, texto_version) NULLS NOT DISTINCT
  WHERE tipo = 'autorizacion_imagenes' AND es_plantilla = false AND estado = 'publicada'
    AND nino_id IS NOT NULL;
