-- =============================================================================
-- FIX — Un recibo con el total desfasado no se confirma
-- -----------------------------------------------------------------------------
-- Censo C, PR B1. Decisión de Jose del 2026-11-26 (docs/specs/fallos-leidos-c.md, «El bloqueo de
-- confirmar_recibo, en B1»): «un recibo con el total desfasado no se confirma y lo dice con el HINT».
--
--   · El total de un borrador regular lo escribe la app después de cada línea (`recalcularTotal`, en
--     lineas-recibo.ts). Si no puede releer las líneas, desde este PR no escribe nada y lo dice: el
--     total se queda como estaba. Hasta este PR escribía 0.
--   · Confirmar no miraba las líneas: el recibo pasaba a `pendiente_procesar` con ese total, salía entre
--     los remesables, entraba en la remesa, y `get_mandatos_remesa` y el fichero cobraban ese importe.
--     Medido abierto en la base efímera (confirmar-total-desfasado.rls.test.ts, antes de esta migración).
--   · Ahora `confirmar_recibo` rechaza el borrador cuyo `total_centimos` no es la suma de sus líneas:
--     P0001, HINT `total_desfasado`. La app lo traduce a un aviso que dice cómo ponerlo al día (volver a
--     guardar una línea o «Recalcular el mes»). Un borrador sin líneas y con total 0 sigue confirmándose.
--   · El idempotente (el recibo ya confirmado) no cambia: no se vuelve a mirar nada de un confirmado.
--   · El resto del cuerpo es el vivo de 20261223120000 (guarda de md5 normalizado), sin tocar.
--
-- Lo que esto no arregla, y la solución buena para después (no ahora): que la base mantenga el total con
-- un trigger sobre `lineas_recibo` (spec, «La solución buena, para después»).
--
-- Medido en producción el 2026-11-26 (solo lectura): 4 recibos regulares vivos, ninguno en borrador y
-- ninguno con el total distinto de la suma de sus líneas. Esta migración no deja bloqueado ninguno que
-- exista hoy.
--
-- La aplica el responsable por SQL Editor. Sin BEGIN ni COMMIT. Tras aplicar: registrar en
-- supabase_migrations.schema_migrations. Orden con la app: da igual. La app de antes, ante el HINT,
-- dice «No se pudo confirmar» (el error genérico); la de después, el aviso con los dos caminos.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  -- Lo que se reescribe es lo que hay, tal como quedó (20261223120000).
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.confirmar_recibo(uuid)');
  IF v_md5 IS DISTINCT FROM 'bdda1a6a0b4c0c0d7550682923d661b6' THEN
    RAISE EXCEPTION 'confirmar_recibo no es la de 20261223120000: %', coalesce(v_md5, 'falta');
  END IF;
  -- Los borradores que hoy quedarían bloqueados (en el CI, 0 por construcción: es solo informativo).
  RAISE NOTICE 'guarda previa: borradores regulares vivos %, de ellos con el total distinto de la suma de sus líneas %',
    (SELECT count(*) FROM public.recibos r
      WHERE r.deleted_at IS NULL AND r.estado = 'borrador'
        AND NOT r.es_esporadico AND r.devuelto_de_recibo_id IS NULL),
    (SELECT count(*) FROM public.recibos r
      WHERE r.deleted_at IS NULL AND r.estado = 'borrador'
        AND NOT r.es_esporadico AND r.devuelto_de_recibo_id IS NULL
        AND r.total_centimos IS DISTINCT FROM
            (SELECT coalesce(sum(l.importe_centimos), 0) FROM public.lineas_recibo l WHERE l.recibo_id = r.id));
END
$guarda$;

-- ---- La función ----
CREATE OR REPLACE FUNCTION public.confirmar_recibo(p_recibo_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_borradores integer;
  v_suma bigint;
BEGIN
  SELECT centro_id, anio, mes, estado, es_esporadico, devuelto_de_recibo_id, deleted_at, total_centimos
    INTO r FROM public.recibos WHERE id = p_recibo_id;
  IF NOT FOUND OR r.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'recibo no encontrado' USING ERRCODE = '22023';
  END IF;
  IF NOT public.es_admin(r.centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF r.es_esporadico OR r.devuelto_de_recibo_id IS NOT NULL THEN
    RAISE EXCEPTION 'no es un recibo regular' USING ERRCODE = '22023';
  END IF;

  IF r.estado <> 'borrador' THEN
    -- Idempotente: ya confirmado. Devuelve si el mes está cerrado.
    RETURN public.mes_cerrado(r.centro_id, r.anio, r.mes);
  END IF;

  -- Censo C (2026-11-26): un total que no es la suma de sus líneas no se confirma; llegaría a la remesa.
  SELECT coalesce(sum(importe_centimos), 0) INTO v_suma
    FROM public.lineas_recibo WHERE recibo_id = p_recibo_id;
  IF r.total_centimos IS DISTINCT FROM v_suma THEN
    RAISE EXCEPTION 'el total del recibo no es la suma de sus líneas'
      USING ERRCODE = 'P0001', HINT = 'total_desfasado';
  END IF;

  -- El único sitio que confirma un recibo (recibos_dinero_solo_por_funcion, 20261223120000).
  PERFORM set_config('app.confirmar_recibo', p_recibo_id::text, true);
  UPDATE public.recibos SET estado = 'pendiente_procesar' WHERE id = p_recibo_id;
  PERFORM set_config('app.confirmar_recibo', '', true);

  SELECT count(*) INTO v_borradores FROM public.recibos
    WHERE centro_id = r.centro_id AND anio = r.anio AND mes = r.mes
      AND NOT es_esporadico AND devuelto_de_recibo_id IS NULL AND deleted_at IS NULL
      AND estado = 'borrador';

  IF v_borradores = 0 THEN
    INSERT INTO public.cierre_mensual (centro_id, anio, mes, cerrado_por)
      VALUES (r.centro_id, r.anio, r.mes, auth.uid())
      ON CONFLICT (centro_id, anio, mes) DO NOTHING;
    RETURN true;
  END IF;

  RETURN false;
END $function$;

-- ---- Guarda posterior ----
DO $post$
DECLARE
  v_src text;
  v_acl text;
BEGIN
  -- Sin comentarios: que la comprobación no la cumpla un comentario que nombre el HINT.
  SELECT regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), p.proacl::text
    INTO v_src, v_acl FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.confirmar_recibo(uuid)');
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'guarda posterior: falta confirmar_recibo(uuid)';
  END IF;
  IF position('HINT = ''total_desfasado''' IN v_src) = 0
     OR position('r.total_centimos IS DISTINCT FROM v_suma' IN v_src) = 0 THEN
    RAISE EXCEPTION 'guarda posterior: confirmar_recibo no compara el total con sus líneas';
  END IF;
  -- La comprobación va ANTES de confirmar: después ya no serviría.
  IF position('total_desfasado' IN v_src) > position('SET estado = ''pendiente_procesar''' IN v_src) THEN
    RAISE EXCEPTION 'guarda posterior: la comprobación del total va después del UPDATE';
  END IF;
  -- CREATE OR REPLACE conserva los permisos: la sesión y el servicio, nada para anon ni PUBLIC (una entrada de
  -- PUBLIC en el ACL empieza por «=»).
  IF NOT has_function_privilege('authenticated', 'public.confirmar_recibo(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.confirmar_recibo(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.confirmar_recibo(uuid)', 'EXECUTE')
     OR v_acl ~ '[{,]=' THEN
    RAISE EXCEPTION 'guarda posterior: los permisos de confirmar_recibo cambiaron: %', v_acl;
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'confirmar_recibo') <> 1 THEN
    RAISE EXCEPTION 'guarda posterior: hay más de un confirmar_recibo';
  END IF;
END
$post$;
