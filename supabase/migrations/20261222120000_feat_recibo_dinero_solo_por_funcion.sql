-- =============================================================================
-- FEAT — Un recibo solo entra en enviado_banco por marcar_remesa_enviada, y un hecho de dinero no
-- se deshace por fuera
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/altas-serie.md, «Reabrir una remesa» (las puertas del recibo, decisiones A y B
-- del responsable del 2026-11-02).
--
--   · A. `recibos.estado = 'enviado_banco'` solo lo pone `marcar_remesa_enviada` (20261221120000),
--     a los recibos del fichero de su remesa. Hasta aquí una sesión de Dirección podía ponerlo con
--     un UPDATE directo desde borrador, pendiente o cobrado a mano, o con un INSERT en ese estado
--     (la RLS de `recibos` deja UPDATE e INSERT de cualquier columna), y lo mismo service_role y
--     postgres. Un recibo «enviado» que no está en ningún fichero le dice al centro que ha cobrado
--     algo que el banco no ha recibido. Ahora un trigger lo rechaza en INSERT y UPDATE, para todos,
--     también service_role, salvo con el marcador local `app.marcar_recibo_enviado` = el id del
--     recibo (el patrón de `app.marcar_remesa_enviada`). Solo lo pone marcar enviada, que ahora pasa
--     los recibos del fichero uno a uno, cada uno con su marcador, y lo limpia después.
--   · B. Un hecho de dinero no se deshace por fuera. Un recibo cobrado a mano no sale de
--     `cobrado_manual`, y uno enviado al banco solo sale a `devuelto` (la devolución que anota
--     Dirección). Hasta aquí un UPDATE directo devolvía `enviado_banco` a pendiente (también con la
--     remesa enviada) o a borrador, y `cobrado_manual` a pendiente, enviado, devuelto o borrador
--     (con un cheque, dejando huérfanos la diferencia y el sobrante). Ninguna función hace esas
--     vueltas atrás; reabrir traerá la suya, con su marcador.
--   · Mismo trigger para las dos, en INSERT y UPDATE OF estado, con su HINT para la app:
--     `enviado_solo_por_marcar` y `hecho_de_dinero`. Es de invocador, como los de 20261221120000.
--     No toca la salida de `devuelto` (la vigila `recibos_validar_devolucion`) ni las entradas en
--     `devuelto` o `cobrado_manual` (las decisiones C y D, el PR siguiente).
--
-- La aplica el responsable por SQL Editor, después de 20261221120000. Sin BEGIN ni COMMIT. Tras
-- aplicar: registrar en supabase_migrations.schema_migrations. La app no cambia: ningún camino
-- suyo hace lo que se cierra, así que el orden de aplicar y mergear da igual.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF to_regprocedure('public.recibos_dinero_solo_por_funcion()') IS NOT NULL THEN
    RAISE EXCEPTION 'ya aplicada: existe recibos_dinero_solo_por_funcion';
  END IF;
  -- Lo que se reescribe es lo que hay, tal como quedó (20261221120000).
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.marcar_remesa_enviada(uuid)');
  IF v_md5 IS DISTINCT FROM 'f161b6cd2f699f9ac9c05a3881aa3615' THEN
    RAISE EXCEPTION 'marcar_remesa_enviada no es la de 20261221120000: %', coalesce(v_md5, 'falta');
  END IF;
  -- Los recibos que hay en cada estado no se tocan: el trigger mira las transiciones, no el estado.
  RAISE NOTICE 'guarda previa: recibos vivos en enviado_banco %, de ellos fuera de una remesa enviada %; cobrado_manual %; devuelto %',
    (SELECT count(*) FROM public.recibos WHERE deleted_at IS NULL AND estado = 'enviado_banco'),
    (SELECT count(*) FROM public.recibos r
      WHERE r.deleted_at IS NULL AND r.estado = 'enviado_banco'
        AND NOT EXISTS (SELECT 1 FROM public.recibos_remesa rr
                          JOIN public.remesas m ON m.id = rr.remesa_id
                         WHERE rr.recibo_id = r.id AND m.estado = 'enviada')),
    (SELECT count(*) FROM public.recibos WHERE deleted_at IS NULL AND estado = 'cobrado_manual'),
    (SELECT count(*) FROM public.recibos WHERE deleted_at IS NULL AND estado = 'devuelto');
END
$guarda$;

-- ---- 1. El trigger ----
CREATE FUNCTION public.recibos_dinero_solo_por_funcion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Vale para todos, también para service_role y postgres.
  -- A. Entrar en enviado_banco: solo marcar_remesa_enviada, con el marcador de ese recibo.
  IF NEW.estado = 'enviado_banco'
     AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'enviado_banco')
     AND (TG_OP = 'INSERT'
          OR COALESCE(current_setting('app.marcar_recibo_enviado', true), '') IS DISTINCT FROM OLD.id::text) THEN
    RAISE EXCEPTION 'un recibo solo pasa a enviado al banco al marcar enviada su remesa'
      USING ERRCODE = 'P0001', HINT = 'enviado_solo_por_marcar';
  END IF;
  -- B. Salir de un hecho de dinero: de cobrado_manual, nunca; de enviado_banco, solo a devuelto.
  IF TG_OP = 'UPDATE' AND NEW.estado IS DISTINCT FROM OLD.estado
     AND (OLD.estado = 'cobrado_manual'
          OR (OLD.estado = 'enviado_banco' AND NEW.estado <> 'devuelto')) THEN
    RAISE EXCEPTION 'un recibo % no vuelve a % por fuera', OLD.estado, NEW.estado
      USING ERRCODE = 'P0001', HINT = 'hecho_de_dinero';
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.recibos_dinero_solo_por_funcion() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER recibos_dinero_solo_por_funcion
  BEFORE INSERT OR UPDATE OF estado ON public.recibos
  FOR EACH ROW EXECUTE FUNCTION public.recibos_dinero_solo_por_funcion();

-- ---- 2. Marcar enviada pasa los recibos uno a uno, cada uno con su marcador ----
-- Igual que en 20261221120000, salvo el UPDATE de los recibos, que va recibo a recibo.
CREATE OR REPLACE FUNCTION public.marcar_remesa_enviada(p_remesa_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_remesa  public.remesas%ROWTYPE;
  v_fichero public.remesa_ficheros%ROWTYPE;
  v_hoy     date := public.hoy_madrid();
  v_malos   integer;
  v_n       integer := 0;
  v_una     integer;
  v_recibo  uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- La remesa, bloqueada: el registro de su fichero y otro marcar enviada esperan.
  SELECT * INTO v_remesa FROM public.remesas WHERE id = p_remesa_id FOR UPDATE;
  IF NOT FOUND OR v_remesa.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'remesa no encontrada' USING ERRCODE = 'P0001', HINT = 'no_encontrada';
  END IF;
  IF NOT public.es_admin(v_remesa.centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_remesa.estado <> 'borrador' THEN
    RAISE EXCEPTION 'la remesa ya está enviada' USING ERRCODE = 'P0001', HINT = 'ya_enviada';
  END IF;

  -- El fichero de la versión vigente: sin él, no hay nada que el banco pueda tener.
  SELECT * INTO v_fichero FROM public.remesa_ficheros
   WHERE remesa_id = p_remesa_id AND generado_at = v_remesa.fichero_generado_at;
  IF v_remesa.fichero_generado_at IS NULL OR NOT FOUND THEN
    RAISE EXCEPTION 'falta descargar el fichero' USING ERRCODE = 'P0001', HINT = 'sin_fichero';
  END IF;

  -- Sus recibos, bloqueados: un cobro o un cambio de importe a la vez espera, y después ve la
  -- remesa enviada.
  PERFORM 1 FROM public.recibos r
    JOIN public.recibos_remesa rr ON rr.recibo_id = r.id
   WHERE rr.remesa_id = p_remesa_id
     FOR UPDATE OF r;
  -- Los cobrables de la remesa (el filtro de registrar_fichero_remesa) son los del fichero, con
  -- el mismo importe.
  WITH cobrables AS (
    SELECT r.id, r.total_centimos
      FROM public.recibos_remesa rr
      JOIN public.recibos r ON r.id = rr.recibo_id
     WHERE rr.remesa_id = p_remesa_id AND r.metodo = 'sepa'
       AND r.estado IN ('pendiente_procesar', 'enviado_banco')
       AND r.deleted_at IS NULL AND r.total_centimos > 0
  ), a AS (
    SELECT recibo_id, importe_centimos FROM public.remesa_fichero_adeudos
     WHERE fichero_id = v_fichero.id
  )
  SELECT count(*) INTO v_malos
    FROM cobrables c
    FULL JOIN a ON a.recibo_id = c.id
   WHERE c.id IS NULL OR a.recibo_id IS NULL
      OR a.importe_centimos IS DISTINCT FROM c.total_centimos;
  IF v_malos > 0 THEN
    RAISE EXCEPTION 'la remesa cambió después de descargar su fichero (% recibos)', v_malos
      USING ERRCODE = 'P0001', HINT = 'fichero_no_coincide';
  END IF;

  -- El único sitio que la pasa a enviada (remesas_enviada_solo_por_marcar).
  PERFORM set_config('app.marcar_remesa_enviada', p_remesa_id::text, true);
  UPDATE public.remesas SET estado = 'enviada', fecha_envio_banco = v_hoy WHERE id = p_remesa_id;
  PERFORM set_config('app.marcar_remesa_enviada', '', true);
  -- Solo los del fichero: es lo que el banco recibió. Y el único sitio que pasa un recibo a
  -- enviado_banco (recibos_dinero_solo_por_funcion, 20261222120000), cada uno con su marcador.
  FOR v_recibo IN SELECT a.recibo_id FROM public.remesa_fichero_adeudos a
                   WHERE a.fichero_id = v_fichero.id LOOP
    PERFORM set_config('app.marcar_recibo_enviado', v_recibo::text, true);
    UPDATE public.recibos SET estado = 'enviado_banco', fecha_envio_banco = v_hoy WHERE id = v_recibo;
    GET DIAGNOSTICS v_una = ROW_COUNT;
    v_n := v_n + v_una;
  END LOOP;
  PERFORM set_config('app.marcar_recibo_enviado', '', true);
  UPDATE public.remesa_ficheros SET enviada_at = now() WHERE id = v_fichero.id;
  RETURN v_n;
END;
$function$;

-- CREATE OR REPLACE conserva los privilegios y el comentario de 20261221120000.

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_src text;
BEGIN
  IF (SELECT count(*) FROM pg_trigger t
       WHERE t.tgrelid = 'public.recibos'::regclass AND t.tgname = 'recibos_dinero_solo_por_funcion'
         AND NOT t.tgisinternal AND t.tgenabled = 'O'
         AND pg_get_triggerdef(t.oid) LIKE '%BEFORE INSERT OR UPDATE OF estado ON public.recibos FOR EACH ROW%') <> 1 THEN
    RAISE EXCEPTION 'falta el trigger recibos_dinero_solo_por_funcion';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.recibos_dinero_solo_por_funcion()'::regprocedure)
     OR (SELECT bool_or(has_function_privilege(r, 'public.recibos_dinero_solo_por_funcion()', 'EXECUTE'))
           FROM unnest(ARRAY['public', 'anon', 'authenticated']) r) THEN
    RAISE EXCEPTION 'el trigger del dinero es de invocador y no se ejecuta por RPC';
  END IF;
  -- Cada recibo pasa con su marcador, que se limpia después; y la remesa, con el suyo.
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v_src FROM pg_proc
   WHERE oid = 'public.marcar_remesa_enviada(uuid)'::regprocedure;
  IF v_src !~ 'set_config\(''app\.marcar_recibo_enviado'', v_recibo::text, true\);\s*UPDATE public\.recibos SET estado = ''enviado_banco'', fecha_envio_banco = v_hoy WHERE id = v_recibo;'
     OR v_src !~ 'END LOOP;\s*PERFORM set_config\(''app\.marcar_recibo_enviado'', '''', true\);'
     OR v_src !~ 'set_config\(''app\.marcar_remesa_enviada'', p_remesa_id::text, true\);\s*UPDATE public\.remesas SET estado = ''enviada''' THEN
    RAISE EXCEPTION 'marcar_remesa_enviada no pasa cada recibo con su marcador';
  END IF;
  IF NOT (SELECT prosecdef AND proconfig = ARRAY['search_path=public'] FROM pg_proc
           WHERE oid = 'public.marcar_remesa_enviada(uuid)'::regprocedure)
     OR NOT has_function_privilege('authenticated', 'public.marcar_remesa_enviada(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.marcar_remesa_enviada(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.marcar_remesa_enviada(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'marcar_remesa_enviada no es SECURITY DEFINER solo para authenticated';
  END IF;
  RAISE NOTICE 'guarda posterior: enviado_banco solo por marcar_remesa_enviada; sin vuelta atrás de cobrado_manual ni de enviado_banco salvo a devuelto';
END
$guarda$;
