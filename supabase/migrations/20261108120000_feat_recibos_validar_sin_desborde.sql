-- =============================================================================
-- FEAT — Recibos, PR-3: no se valida un recibo con el desborde de beca pendiente
-- -----------------------------------------------------------------------------
-- El agujero: se podía validar (borrador → pendiente_procesar) un recibo con un desborde de beca
-- de comedor sin resolver. Ese exceso es dinero de la familia y, con el recibo validado, no iba a
-- ningún sitio: ni se difería al mes siguiente ni se devolvía por transferencia. Se perdía.
--
-- Decisión del responsable: NO se valida con el desborde pendiente. La directora ve el aviso con
-- el importe, comprueba si es correcto (puede que la beca esté mal puesta) y, si lo es, elige una
-- de las dos salidas que ya existen: diferirlo al mes siguiente o la transferencia a la familia.
-- En la validación en lote esos recibos se saltan y se listan aparte (la app).
--
--   · La regla es de la TRANSICIÓN (salir de borrador), no del estado: un trigger, no un CHECK.
--     Vale para todos, también service_role, y para cualquier camino: `confirmar_recibo` (que no
--     se toca; el error sale de su UPDATE) y un UPDATE directo, que la RLS de Dirección y el
--     congelado permiten sobre un borrador.
--   · SECURITY DEFINER: el desborde lo lee siempre, aunque la RLS de quien valida no lo viera.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor, DESPUÉS de
-- `20261107120000`. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_n integer;
BEGIN
  IF to_regprocedure('public.recibos_validar_sin_desborde()') IS NOT NULL THEN
    RAISE EXCEPTION 'la función recibos_validar_sin_desborde ya existe';
  END IF;
  -- La validación pasa por el UPDATE de confirmar_recibo: tiene que ser la que se leyó en
  -- producción (md5 normalizado: sin \r, sin comentarios, espacios colapsados).
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.confirmar_recibo(uuid)');
  IF v_md5 IS DISTINCT FROM '532d31c18d0f88c2ff00cd156fa8e632' THEN
    RAISE EXCEPTION 'confirmar_recibo no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  -- Lo que este PR impide de aquí en adelante, ¿ya ha pasado? Un recibo validado con su desborde
  -- pendiente: dinero de una familia perdido, que habría que resolver a mano antes de aplicar.
  SELECT count(*) INTO v_n
    FROM public.beca_comedor_desborde d
    JOIN public.recibos r ON r.id = d.recibo_id
   WHERE d.estado = 'pendiente' AND r.estado <> 'borrador';
  RAISE NOTICE 'recibos validados con el desborde pendiente antes de aplicar: %', v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'hay % recibos validados con el desborde de beca pendiente', v_n;
  END IF;
END
$guarda$;

-- ---- No se sale de borrador con el desborde pendiente ----
CREATE FUNCTION public.recibos_validar_sin_desborde()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_exceso integer;
BEGIN
  IF OLD.estado = 'borrador' AND NEW.estado IS DISTINCT FROM 'borrador' THEN
    SELECT d.exceso_centimos INTO v_exceso
      FROM public.beca_comedor_desborde d
     WHERE d.recibo_id = NEW.id AND d.estado = 'pendiente';
    IF FOUND THEN
      RAISE EXCEPTION 'el recibo tiene un desborde de beca pendiente de % céntimos: se resuelve antes de validarlo', v_exceso
        USING ERRCODE = 'P0001', HINT = 'desborde_pendiente';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.recibos_validar_sin_desborde() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER recibos_validar_sin_desborde
  BEFORE UPDATE OF estado ON public.recibos
  FOR EACH ROW EXECUTE FUNCTION public.recibos_validar_sin_desborde();

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.recibos_validar_sin_desborde()');
  IF v_md5 IS DISTINCT FROM 'afab67acc019ea7ebbd428ede76d5f27' THEN
    RAISE EXCEPTION 'recibos_validar_sin_desborde no quedó como este fichero: %', coalesce(v_md5, 'falta');
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.recibos_validar_sin_desborde()'::regprocedure) THEN
    RAISE EXCEPTION 'recibos_validar_sin_desborde tiene que ser SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', 'public.recibos_validar_sin_desborde()'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.recibos_validar_sin_desborde()'::regprocedure, 'EXECUTE')
     OR has_function_privilege('public', 'public.recibos_validar_sin_desborde()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'recibos_validar_sin_desborde abierta a anon, authenticated o PUBLIC';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.recibos'::regclass AND tgname = 'recibos_validar_sin_desborde'
                    AND tgenabled = 'O'
                    AND pg_get_triggerdef(oid) LIKE '%BEFORE UPDATE OF estado ON public.recibos%') THEN
    RAISE EXCEPTION 'el trigger recibos_validar_sin_desborde no vigila el estado';
  END IF;
  -- confirmar_recibo sigue siendo la leída (no se recrea).
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.confirmar_recibo(uuid)');
  IF v_md5 IS DISTINCT FROM '532d31c18d0f88c2ff00cd156fa8e632' THEN
    RAISE EXCEPTION 'confirmar_recibo cambió: %', coalesce(v_md5, 'falta');
  END IF;
  RAISE NOTICE 'guarda posterior: trigger recibos_validar_sin_desborde';
END
$guarda$;
