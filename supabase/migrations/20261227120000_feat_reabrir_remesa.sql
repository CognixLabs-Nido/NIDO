-- =============================================================================
-- FEAT — Reabrir una remesa (PR 1 de 2: la base de datos)
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/altas-serie.md, «Reabrir una remesa» (decisiones del responsable del 2026-10-31
-- y del 2026-11-03).
--
--   · `reabrir_remesa(remesa, n_recibos, total_centimos)`: la admin del centro
--     (`privado.es_titular`: ni la directora ni el superusuario) reabre cualquier remesa que tenga
--     algo que reabrir, también la que consta como enviada al banco. La app no sabe si el fichero
--     llegó al banco: avisa con las familias y el importe delante (PR 2), no lo impide.
--       - Sus recibos en `enviado_banco` vuelven a `pendiente_procesar`, sin `fecha_envio_banco`.
--         Los devueltos y los cobrados a mano no se tocan: su historia es real, y prueban que el
--         banco recibió ese fichero.
--       - La remesa vuelve a `borrador`, sin `fecha_envio_banco` y sin la marca del fichero, para
--         poder quitar y añadir recibos. La siguiente descarga crea una versión nueva, con su MsgId
--         y su fichero.
--       - El fichero guardado de la versión NO se borra: es la prueba de lo que se envió. Se le pone
--         `reabierta_at`.
--       - Recibe el número de recibos y el importe que vio la persona, y falla si han cambiado
--         (HINT `remesa_cambiada`), como `dar_deuda_por_perdida` con su importe.
--       - Una fila directa en `audit_log` (`remesa_reabierta`): quién, cuándo, cuántos recibos, de
--         cuántas familias, qué importe y cuántos devueltos y cobrados. Sin nombres ni IBAN.
--       - Una remesa en borrador sin fichero generado no se reabre (HINT `nada_que_reabrir`): nunca
--         salió un fichero, y en borrador ya se pueden quitar y añadir recibos.
--   · `resumen_reabrir_remesa(remesa)`: lo que el aviso enseña. Sale de la misma consulta que mira
--     `reabrir_remesa` (`privado.resumen_reabrir_remesa`): el aviso y la comprobación no pueden
--     decir importes distintos.
--   · Una remesa enviada no vuelve a borrador, PARA TODOS, también service_role, salvo con el
--     marcador local `app.reabrir_remesa` = su id. Hasta aquí `remesas_proteger` dejaba pasar a
--     service_role antes de mirarlo. Y la marca del fichero solo la quita reabrir, con el mismo
--     marcador.
--   · La vuelta de un recibo de `enviado_banco` a `pendiente_procesar` solo la da reabrir, con el
--     marcador `app.reabrir_recibo` = el id del recibo (`recibos_dinero_solo_por_funcion`, B).
--   · Un recibo devuelto o cobrado a mano no se desvincula de su remesa (HINT `recibo_con_historia`):
--     si se pudiera quitar de una remesa reabierta se perdería la prueba de que el banco recibió
--     ese fichero, que es justo lo que se guarda el fichero para demostrar. Para las sesiones:
--     service_role conserva la excepción que este trigger ya tenía en el DELETE, porque la
--     destrucción por plazo de lo fiscal (`destruir_fiscal_familia`) borra los enlaces de la
--     familia, en cualquier estado.
--
-- La aplica el responsable por SQL Editor, después de 20261226120000. Sin BEGIN ni COMMIT. Tras
-- aplicar: registrar en supabase_migrations.schema_migrations. La app de hoy no la llama: aplicar
-- ANTES de mergear el PR 2, que trae el botón.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_fn       text;
  v_esperado text;
  v_md5      text;
BEGIN
  IF to_regprocedure('public.reabrir_remesa(uuid,integer,bigint)') IS NOT NULL
     OR to_regprocedure('public.resumen_reabrir_remesa(uuid)') IS NOT NULL
     OR to_regprocedure('privado.resumen_reabrir_remesa(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'ya aplicada: existe reabrir_remesa o su resumen';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'remesa_ficheros'
                    AND column_name = 'reabierta_at') THEN
    RAISE EXCEPTION 'falta 20261220120000: remesa_ficheros sin reabierta_at';
  END IF;
  IF to_regprocedure('privado.es_titular(uuid)') IS NULL THEN
    RAISE EXCEPTION 'falta privado.es_titular';
  END IF;
  -- Lo que se reescribe es lo que hay, tal como quedó (md5 de la lógica, sin \r ni comentarios).
  FOR v_fn, v_esperado IN VALUES
    ('public.remesas_proteger()', '3032f20c7994c4aad78dcfaaa52db9be'),
    ('public.recibos_dinero_solo_por_funcion()', '62f4badc8aa687d21add5d9299a2b53e'),
    ('public.recibos_remesa_validar()', '9960f37d762a9c1d34e3d2893d4612f1')
  LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn);
    IF v_md5 IS DISTINCT FROM v_esperado THEN
      RAISE EXCEPTION '% no es la que se reescribe: %', v_fn, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;
  -- Las remesas y sus recibos no se tocan: se imprime lo que hay, también cuando no hay nada.
  RAISE NOTICE 'guarda previa: remesas vivas por estado y marca %; enviadas sin marca %; recibos devueltos o cobrados en una remesa en borrador %',
    (SELECT coalesce(json_object_agg(k, n), '{}') FROM (
       SELECT estado || CASE WHEN fichero_generado_at IS NULL THEN '_sin_marca' ELSE '_con_marca' END k,
              count(*) n
         FROM public.remesas WHERE deleted_at IS NULL GROUP BY 1) x),
    (SELECT count(*) FROM public.remesas
      WHERE deleted_at IS NULL AND estado = 'enviada' AND fichero_generado_at IS NULL),
    (SELECT count(*) FROM public.recibos_remesa rr
       JOIN public.remesas m ON m.id = rr.remesa_id
       JOIN public.recibos r ON r.id = rr.recibo_id
      WHERE m.deleted_at IS NULL AND m.estado = 'borrador'
        AND r.estado IN ('devuelto', 'cobrado_manual'));
END
$guarda$;

-- ---- La remesa: la enviada no vuelve, para nadie, y la marca no se quita, salvo reabrir ----
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
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;
  -- Borrarla soltaría sus recibos para otra remesa, y el banco ya puede tener el fichero.
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    IF OLD.estado = 'enviada' THEN
      RAISE EXCEPTION 'una remesa enviada no se borra' USING ERRCODE = 'P0001', HINT = 'remesa_cerrada';
    END IF;
    IF OLD.fichero_generado_at IS NOT NULL THEN
      RAISE EXCEPTION 'una remesa con el fichero generado no se borra' USING ERRCODE = 'P0001', HINT = 'remesa_con_fichero';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- ---- El recibo: de enviado_banco solo se sale a devuelto, o a pendiente al reabrir ----
CREATE OR REPLACE FUNCTION public.recibos_dinero_solo_por_funcion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Vale para todos, también para service_role y postgres.
  IF TG_OP = 'INSERT' THEN
    -- A. Nadie crea un recibo ya enviado.
    IF NEW.estado = 'enviado_banco' THEN
      RAISE EXCEPTION 'un recibo solo pasa a enviado al banco al marcar enviada su remesa'
        USING ERRCODE = 'P0001', HINT = 'enviado_solo_por_marcar';
    END IF;
    -- D. Un recibo nace en borrador. En pendiente, solo el esporádico de crear_recibo_esporadico y
    -- el re-giro de resolver_devolucion; en devuelto o cobrado, nunca.
    IF NEW.estado <> 'borrador'
       AND NOT (NEW.estado = 'pendiente_procesar'
                AND (COALESCE(current_setting('app.crear_recibo_esporadico', true), '') = NEW.id::text
                     OR (NEW.devuelto_de_recibo_id IS NOT NULL
                         AND COALESCE(current_setting('app.resolver_devolucion', true), '') = NEW.devuelto_de_recibo_id::text))) THEN
      RAISE EXCEPTION 'un recibo nace en borrador (este, en %)', NEW.estado
        USING ERRCODE = 'P0001', HINT = 'recibo_nace_en_borrador';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;
  -- A. Entrar en enviado_banco: solo marcar_remesa_enviada, con el marcador de ese recibo.
  IF NEW.estado = 'enviado_banco'
     AND COALESCE(current_setting('app.marcar_recibo_enviado', true), '') IS DISTINCT FROM OLD.id::text THEN
    RAISE EXCEPTION 'un recibo solo pasa a enviado al banco al marcar enviada su remesa'
      USING ERRCODE = 'P0001', HINT = 'enviado_solo_por_marcar';
  END IF;
  -- B. Salir de un hecho de dinero: de cobrado_manual, nunca; de enviado_banco, a devuelto, o a
  -- pendiente al reabrir su remesa (reabrir_remesa, con el marcador de ese recibo; 20261227120000).
  IF OLD.estado = 'cobrado_manual'
     OR (OLD.estado = 'enviado_banco' AND NEW.estado <> 'devuelto'
         AND NOT (NEW.estado = 'pendiente_procesar'
                  AND COALESCE(current_setting('app.reabrir_recibo', true), '') = OLD.id::text)) THEN
    RAISE EXCEPTION 'un recibo % no vuelve a % por fuera', OLD.estado, NEW.estado
      USING ERRCODE = 'P0001', HINT = 'hecho_de_dinero';
  END IF;
  -- C. Entrar en devuelto: solo marcar_recibo_devuelto.
  IF NEW.estado = 'devuelto'
     AND COALESCE(current_setting('app.marcar_recibo_devuelto', true), '') IS DISTINCT FROM OLD.id::text THEN
    RAISE EXCEPTION 'un recibo solo pasa a devuelto con marcar_recibo_devuelto'
      USING ERRCODE = 'P0001', HINT = 'devuelto_por_funcion';
  END IF;
  -- C. Entrar en cobrado_manual: solo sus tres funciones.
  IF NEW.estado = 'cobrado_manual'
     AND OLD.id::text NOT IN (COALESCE(current_setting('app.marcar_cobrado_manual', true), ''),
                              COALESCE(current_setting('app.cobro_cheque', true), ''),
                              COALESCE(current_setting('app.resolver_devolucion', true), '')) THEN
    RAISE EXCEPTION 'un recibo solo se cobra a mano con su función'
      USING ERRCODE = 'P0001', HINT = 'cobrado_por_funcion';
  END IF;
  -- D. Confirmar y desconfirmar: solo sus funciones, que ponen y quitan el ancla del cierre.
  IF OLD.estado = 'borrador' AND NEW.estado = 'pendiente_procesar'
     AND COALESCE(current_setting('app.confirmar_recibo', true), '') IS DISTINCT FROM OLD.id::text THEN
    RAISE EXCEPTION 'un recibo se confirma con confirmar_recibo'
      USING ERRCODE = 'P0001', HINT = 'confirmar_por_funcion';
  END IF;
  IF OLD.estado = 'pendiente_procesar' AND NEW.estado = 'borrador'
     AND COALESCE(current_setting('app.desconfirmar_recibo', true), '') IS DISTINCT FROM OLD.id::text THEN
    RAISE EXCEPTION 'un recibo vuelve a borrador con desconfirmar_recibo'
      USING ERRCODE = 'P0001', HINT = 'desconfirmar_por_funcion';
  END IF;
  RETURN NEW;
END $function$;

-- ---- El enlace: un recibo devuelto o cobrado no sale de su remesa ----
CREATE OR REPLACE FUNCTION public.recibos_remesa_validar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_servicio boolean := COALESCE(auth.role(), '') = 'service_role';
  v_remesa record;
  v_recibo record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.remesa_id IS DISTINCT FROM OLD.remesa_id OR NEW.recibo_id IS DISTINCT FROM OLD.recibo_id THEN
      RAISE EXCEPTION 'un enlace no cambia de remesa ni de recibo' USING ERRCODE = 'P0001', HINT = 'enlace_fijo';
    END IF;
    RETURN NEW;
  END IF;

  -- La remesa, bloqueada: el envío, la marca del fichero y el borrado esperan a este enlace.
  SELECT id, centro_id, estado, fichero_generado_at, deleted_at INTO v_remesa
    FROM public.remesas
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.remesa_id ELSE NEW.remesa_id END
     FOR UPDATE;

  IF TG_OP = 'DELETE' THEN
    -- Sin remesa: cae en cascada con ella. Con service_role: la limpieza de un centro y la
    -- destrucción por plazo de lo fiscal, que borra los enlaces de la familia en cualquier estado.
    IF v_servicio OR NOT FOUND THEN
      RETURN OLD;
    END IF;
    IF v_remesa.estado <> 'borrador' OR v_remesa.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'de una remesa enviada no sale ningún recibo' USING ERRCODE = 'P0001', HINT = 'remesa_cerrada';
    END IF;
    IF v_remesa.fichero_generado_at IS NOT NULL THEN
      RAISE EXCEPTION 'de una remesa con el fichero generado no sale ningún recibo' USING ERRCODE = 'P0001', HINT = 'remesa_con_fichero';
    END IF;
    -- Un devuelto o un cobrado a mano solo pudo llegar ahí con un fichero que el banco recibió:
    -- quitarlo de la remesa (reabierta) borraría la prueba que se guarda el fichero para dar
    -- (20261227120000).
    IF EXISTS (SELECT 1 FROM public.recibos r
                WHERE r.id = OLD.recibo_id AND r.estado IN ('devuelto', 'cobrado_manual')) THEN
      RAISE EXCEPTION 'un recibo devuelto o cobrado no sale de su remesa: prueba que el banco recibió ese fichero'
        USING ERRCODE = 'P0001', HINT = 'recibo_con_historia';
    END IF;
    RETURN OLD;
  END IF;

  IF NOT FOUND OR v_remesa.estado <> 'borrador' OR v_remesa.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'a una remesa enviada o borrada no se le añaden recibos' USING ERRCODE = 'P0001', HINT = 'remesa_cerrada';
  END IF;
  IF v_remesa.fichero_generado_at IS NOT NULL THEN
    RAISE EXCEPTION 'a una remesa con el fichero generado no se le añaden recibos' USING ERRCODE = 'P0001', HINT = 'remesa_con_fichero';
  END IF;

  -- El recibo, bloqueado: otra remesa con el mismo recibo espera, y después ve este enlace.
  SELECT id, centro_id, estado, metodo, total_centimos, deleted_at INTO v_recibo
    FROM public.recibos WHERE id = NEW.recibo_id FOR UPDATE;
  IF NOT FOUND OR v_recibo.deleted_at IS NOT NULL OR v_recibo.centro_id IS DISTINCT FROM v_remesa.centro_id THEN
    RAISE EXCEPTION 'el recibo no es de esta remesa' USING ERRCODE = 'P0001', HINT = 'recibo_no_remesable';
  END IF;
  IF NOT v_servicio
     AND (v_recibo.metodo IS DISTINCT FROM 'sepa' OR v_recibo.estado <> 'pendiente_procesar'
          OR v_recibo.total_centimos <= 0) THEN
    RAISE EXCEPTION 'solo entran recibos por banco, confirmados y con importe' USING ERRCODE = 'P0001', HINT = 'recibo_no_remesable';
  END IF;
  IF EXISTS (SELECT 1 FROM public.recibos_remesa rr
               JOIN public.remesas rm ON rm.id = rr.remesa_id
              WHERE rr.recibo_id = NEW.recibo_id AND rm.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'el recibo ya está en una remesa' USING ERRCODE = 'P0001', HINT = 'recibo_en_otra_remesa';
  END IF;
  RETURN NEW;
END $function$;

-- CREATE OR REPLACE conserva los privilegios (REVOKE de 20261120120000 y 20261222120000) y los
-- triggers.

-- ---- La consulta del aviso y de la comprobación: una sola ----
CREATE FUNCTION privado.resumen_reabrir_remesa(p_remesa_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- Los cobrables son el filtro de registrar_fichero_remesa y marcar_remesa_enviada: los recibos
  -- que el banco cobraría si tuviera el fichero, y los que irán en la versión nueva.
  WITH m AS (
    SELECT id, estado, fecha_envio_banco, fichero_generado_at FROM public.remesas WHERE id = p_remesa_id
  ), r AS (
    SELECT rc.id, rc.familia_id, rc.estado, rc.total_centimos, rc.metodo, rc.deleted_at
      FROM public.recibos_remesa rr
      JOIN public.recibos rc ON rc.id = rr.recibo_id
     WHERE rr.remesa_id = p_remesa_id
  ), c AS (
    SELECT * FROM r
     WHERE metodo = 'sepa' AND estado IN ('pendiente_procesar', 'enviado_banco')
       AND deleted_at IS NULL AND total_centimos > 0
  )
  SELECT jsonb_build_object(
    'estado', m.estado,
    'fecha_envio_banco', m.fecha_envio_banco,
    'fichero_generado_at', m.fichero_generado_at,
    'fichero_guardado', EXISTS (SELECT 1 FROM public.remesa_ficheros f
                                 WHERE f.remesa_id = m.id AND f.generado_at = m.fichero_generado_at),
    'n_recibos', (SELECT count(*) FROM c),
    'n_familias', (SELECT count(DISTINCT familia_id) FROM c),
    'total_centimos', (SELECT coalesce(sum(total_centimos), 0) FROM c),
    'n_enviados', (SELECT count(*) FROM r WHERE estado = 'enviado_banco'),
    'n_devueltos', (SELECT count(*) FROM r WHERE estado = 'devuelto'),
    'n_cobrados', (SELECT count(*) FROM r WHERE estado = 'cobrado_manual'))
    FROM m;
$function$;

REVOKE ALL ON FUNCTION privado.resumen_reabrir_remesa(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---- Lo que enseña el aviso ----
CREATE FUNCTION public.resumen_reabrir_remesa(p_remesa_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_remesa public.remesas%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_remesa FROM public.remesas WHERE id = p_remesa_id;
  IF NOT FOUND OR v_remesa.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'remesa no encontrada' USING ERRCODE = 'P0001', HINT = 'no_encontrada';
  END IF;
  IF NOT privado.es_titular(v_remesa.centro_id) THEN
    RAISE EXCEPTION 'solo la admin del centro reabre una remesa' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN privado.resumen_reabrir_remesa(p_remesa_id);
END $function$;

REVOKE ALL ON FUNCTION public.resumen_reabrir_remesa(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.resumen_reabrir_remesa(uuid) TO authenticated;

COMMENT ON FUNCTION public.resumen_reabrir_remesa(uuid) IS
  'Lo que enseña el aviso de reabrir una remesa: su estado y fecha de envío, si tiene marca y fichero guardado, y sus recibos cobrables (número, familias, importe), enviados, devueltos y cobrados. La misma consulta que comprueba reabrir_remesa. Solo la admin del centro (privado.es_titular).';

-- ---- Reabrir ----
CREATE FUNCTION public.reabrir_remesa(p_remesa_id uuid, p_n_recibos integer, p_total_centimos bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_remesa  public.remesas%ROWTYPE;
  v_resumen jsonb;
  v_recibo  uuid;
  v_n       integer := 0;
  v_una     integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- La remesa, bloqueada: una descarga, un marcar enviada u otro reabrir esperan.
  SELECT * INTO v_remesa FROM public.remesas WHERE id = p_remesa_id FOR UPDATE;
  IF NOT FOUND OR v_remesa.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'remesa no encontrada' USING ERRCODE = 'P0001', HINT = 'no_encontrada';
  END IF;
  IF NOT privado.es_titular(v_remesa.centro_id) THEN
    RAISE EXCEPTION 'solo la admin del centro reabre una remesa' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_remesa.estado = 'borrador' AND v_remesa.fichero_generado_at IS NULL THEN
    RAISE EXCEPTION 'no hay nada que reabrir: el fichero de esta remesa no se ha generado nunca, y en borrador ya se pueden quitar y añadir recibos'
      USING ERRCODE = 'P0001', HINT = 'nada_que_reabrir';
  END IF;

  -- Sus recibos, bloqueados: un cobro, una devolución o un cambio de importe a la vez esperan.
  PERFORM 1 FROM public.recibos r
    JOIN public.recibos_remesa rr ON rr.recibo_id = r.id
   WHERE rr.remesa_id = p_remesa_id
     FOR UPDATE OF r;
  -- Lo mismo que enseñó el aviso: si cambió entre medias, la persona no ha visto esto.
  v_resumen := privado.resumen_reabrir_remesa(p_remesa_id);
  IF p_n_recibos IS DISTINCT FROM (v_resumen ->> 'n_recibos')::integer
     OR p_total_centimos IS DISTINCT FROM (v_resumen ->> 'total_centimos')::bigint THEN
    RAISE EXCEPTION 'la remesa ha cambiado: ahora son % recibos y % céntimos',
      v_resumen ->> 'n_recibos', v_resumen ->> 'total_centimos'
      USING ERRCODE = 'serialization_failure', HINT = 'remesa_cambiada';
  END IF;

  -- El único sitio que devuelve una remesa enviada a borrador y le quita la marca
  -- (remesas_proteger).
  PERFORM set_config('app.reabrir_remesa', p_remesa_id::text, true);
  UPDATE public.remesas
     SET estado = 'borrador', fecha_envio_banco = NULL, fichero_generado_at = NULL
   WHERE id = p_remesa_id;
  PERFORM set_config('app.reabrir_remesa', '', true);
  -- Y el único que devuelve un recibo enviado a pendiente (recibos_dinero_solo_por_funcion), cada
  -- uno con su marcador. Los devueltos y los cobrados no se tocan.
  FOR v_recibo IN SELECT r.id FROM public.recibos r
                    JOIN public.recibos_remesa rr ON rr.recibo_id = r.id
                   WHERE rr.remesa_id = p_remesa_id AND r.estado = 'enviado_banco' LOOP
    PERFORM set_config('app.reabrir_recibo', v_recibo::text, true);
    UPDATE public.recibos SET estado = 'pendiente_procesar', fecha_envio_banco = NULL
     WHERE id = v_recibo;
    GET DIAGNOSTICS v_una = ROW_COUNT;
    v_n := v_n + v_una;
  END LOOP;
  PERFORM set_config('app.reabrir_recibo', '', true);
  IF v_n <> (v_resumen ->> 'n_enviados')::integer THEN
    RAISE EXCEPTION 'esperaba devolver a pendiente % recibos y fueron %', v_resumen ->> 'n_enviados', v_n;
  END IF;

  -- El fichero de la versión se queda: es la prueba de lo que se envió.
  UPDATE public.remesa_ficheros SET reabierta_at = now()
   WHERE remesa_id = p_remesa_id AND generado_at = v_remesa.fichero_generado_at;

  -- Quién, cuándo, cuántos y cuánto. Sin nombres ni IBAN: la purga no tiene nada que redactar.
  INSERT INTO public.audit_log (tabla, registro_id, accion, usuario_id, centro_id, valores_antes, valores_despues)
  VALUES ('remesa_reabierta', p_remesa_id, 'UPDATE', v_uid, v_remesa.centro_id,
          jsonb_build_object('estado', v_remesa.estado,
                             'fecha_envio_banco', v_remesa.fecha_envio_banco,
                             'fichero_generado_at', v_remesa.fichero_generado_at),
          jsonb_build_object('n_recibos', (v_resumen ->> 'n_recibos')::integer,
                             'n_familias', (v_resumen ->> 'n_familias')::integer,
                             'total_centimos', (v_resumen ->> 'total_centimos')::bigint,
                             'n_a_pendiente', v_n,
                             'n_devueltos', (v_resumen ->> 'n_devueltos')::integer,
                             'n_cobrados', (v_resumen ->> 'n_cobrados')::integer));

  RETURN v_resumen || jsonb_build_object('n_a_pendiente', v_n);
END $function$;

REVOKE ALL ON FUNCTION public.reabrir_remesa(uuid, integer, bigint) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reabrir_remesa(uuid, integer, bigint) TO authenticated;

COMMENT ON FUNCTION public.reabrir_remesa(uuid, integer, bigint) IS
  'Reabre una remesa enviada o con fichero: sus recibos enviados vuelven a pendiente, la remesa a borrador sin fecha de envío ni marca; el fichero guardado se queda, con reabierta_at. Los devueltos y los cobrados no se tocan. Exige el número de recibos y el importe que vio la persona (remesa_cambiada). Fila remesa_reabierta en audit_log. Solo la admin del centro (privado.es_titular).';

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_fn  text;
  v_pat text;
  v_src text;
BEGIN
  -- Cada trigger mira su marcador.
  FOR v_fn, v_pat IN VALUES
    ('public.remesas_proteger()', 'app\.reabrir_remesa'),
    ('public.recibos_dinero_solo_por_funcion()', 'app\.reabrir_recibo'),
    ('public.recibos_remesa_validar()', 'recibo_con_historia')
  LOOP
    SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v_src FROM pg_proc WHERE oid = v_fn::regprocedure;
    IF v_src IS NULL OR v_src !~ v_pat THEN
      RAISE EXCEPTION '% no mira % como este fichero', v_fn, v_pat;
    END IF;
  END LOOP;
  -- La remesa enviada se mira ANTES de la excepción de service_role: es lo que la cierra para todos.
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v_src
    FROM pg_proc WHERE oid = 'public.remesas_proteger()'::regprocedure;
  IF strpos(v_src, 'una remesa enviada no vuelve a borrador') = 0
     OR strpos(v_src, 'una remesa enviada no vuelve a borrador') > strpos(v_src, '''service_role''') THEN
    RAISE EXCEPTION 'remesas_proteger mira la remesa enviada después de dejar pasar a service_role';
  END IF;
  -- Las dos públicas: SECURITY DEFINER, solo para authenticated. La de privado, para nadie.
  IF NOT (SELECT bool_and(prosecdef) FROM pg_proc WHERE oid IN
            ('public.reabrir_remesa(uuid,integer,bigint)'::regprocedure,
             'public.resumen_reabrir_remesa(uuid)'::regprocedure)) THEN
    RAISE EXCEPTION 'reabrir_remesa y su resumen tienen que ser SECURITY DEFINER';
  END IF;
  IF (SELECT bool_or(has_function_privilege(r, f, 'EXECUTE'))
        FROM unnest(ARRAY['public', 'anon', 'service_role']) r,
             unnest(ARRAY['public.reabrir_remesa(uuid,integer,bigint)',
                          'public.resumen_reabrir_remesa(uuid)']) f)
     OR NOT (SELECT bool_and(has_function_privilege('authenticated', f, 'EXECUTE'))
               FROM unnest(ARRAY['public.reabrir_remesa(uuid,integer,bigint)',
                                 'public.resumen_reabrir_remesa(uuid)']) f)
     OR (SELECT bool_or(has_function_privilege(r, 'privado.resumen_reabrir_remesa(uuid)', 'EXECUTE'))
           FROM unnest(ARRAY['public', 'anon', 'authenticated', 'service_role']) r) THEN
    RAISE EXCEPTION 'privilegios de reabrir_remesa o de su resumen no esperados';
  END IF;
  RAISE NOTICE 'guarda posterior: reabrir_remesa, su resumen y los tres triggers, como este fichero';
END
$guarda$;
