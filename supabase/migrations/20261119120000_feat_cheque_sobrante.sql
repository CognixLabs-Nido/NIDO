-- =============================================================================
-- FEAT — Recibos, PR-1c: el sobrante cuando el cheque supera el recibo
-- -----------------------------------------------------------------------------
-- El PR-1b dejó fuera el cheque guardería / ticket restaurant MAYOR que el recibo: el CHECK no lo
-- admitía y la app lo decía. Decisión del responsable: el mismo trato que el desborde de beca. La
-- directora elige entre diferir el sobrante al mes siguiente o devolverlo por transferencia.
--
--   · Cobrar con un cheque mayor deja el recibo cobrado (`cobro_importe_centimos` = el cheque) y el
--     sobrante PENDIENTE: una fila de `beca_comedor_desborde` con `origen = 'cheque'` (recibo =
--     `cuota_total_centimos`, cheque = `beca_total_centimos`, sobrante = `exceso_centimos`), en la
--     misma transacción, por `cobrar_recibo_con_cheque`. Un recibo sin importe no se cobra con
--     cheque.
--   · La tabla distingue de dónde viene el sobrante: `origen` (`beca` o `cheque`) y una fila por
--     recibo Y origen. Lo mismo en `beca_comedor_transferencia`.
--   · Se resuelve una vez, por `resolver_sobrante_cheque` (de invocador, como `resolver_devolucion`):
--       - diferir: una LÍNEA de saldo a favor (negativa) en el recibo de la familia del MES
--         SIGUIENTE, con las reglas de la devolución llevada al siguiente recibo (20261118120000):
--         en su borrador; si no lo tiene, se crea; con ese recibo ya validado, o el mes cerrado sin
--         recibo, se rechaza. Como el desborde de beca, solo con hijos activos: si la familia ya no
--         los tiene, el sobrante va por transferencia. No reparte entre hermanos: no hay beca que
--         repartir. La línea lleva su sobrante (`lineas_recibo.sobrante_de_desborde_id`), solo la
--         crea la función, no se edita y, si se borra (a mano o con su recibo), el sobrante vuelve
--         a quedar pendiente: es dinero de la familia.
--       - transferencia: una fila pendiente de `beca_comedor_transferencia` (`origen = 'cheque'`),
--         que sale en la lista de transferencias de Remesas y se marca realizada como las de beca.
--   · El sobrante de un cheque y su transferencia solo los escriben esas funciones (marcador local
--     `app.sobrante_cheque`), y no se borran salvo con service_role.
--   · El motor no cambia: solo mira desbordes de recibos en borrador, y el sobrante de un cheque
--     cuelga de un recibo cobrado, que no vuelve a borrador. Si el saldo a favor deja negativo el
--     recibo del mes siguiente, el motor ya lo arrastra (PASE 4, «Saldo mes anterior»).
--   · El export del art. 15 (`export_datos_sujeto`) dice el origen de cada exceso y transferencia.
--
-- `cobrar_recibo_con_cheque` se recrea desde el texto de `20261106120000` y `export_datos_sujeto`
-- desde el de `20261114120000` (los vivos en producción el 2026-10-25: md5 normalizado en la
-- guarda previa).
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor, DESPUÉS de
-- `20261118120000`. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_firma text;
  v_md5 text;
  v_n integer;
  v_leido jsonb := jsonb_build_object(
    'public.cobrar_recibo_con_cheque(uuid,integer,date,text,text)', '5de20f074a56d611b1117c1ee5ea36ff',
    'public.export_datos_sujeto(text,uuid)', '35f6b4b7c787e5a2131b39929bf9a607',
    -- No se recrean, pero las cruza el sobrante: tienen que ser las que se leyeron.
    'public.recibos_validar_cobro_manual()', 'a8bfcbac585f2787552967f4da12f38c',
    'public.recibos_validar_sin_desborde()', 'afab67acc019ea7ebbd428ede76d5f27',
    'public.crear_recibo_esporadico(uuid,uuid,uuid,integer,integer,text,text,jsonb)', 'b8d86d20e4280e1c2acc7561e4bdfead',
    'public.generar_recibos_mes(uuid,integer,integer)', '18a92bc32a164c1689a3650ba10872ae',
    'public.congelar_si_mes_cerrado()', '2e4c101653c8456a89a04fed2e5245f6',
    'public.mes_cerrado(uuid,integer,integer)', 'd11fd48ea47d8ca2dfbf2617ba0186e8',
    'public.derivar_centro_id_de_recibo_familia()', '07913fae9fd9456bf26aa385698ab102',
    'public.es_admin(uuid)', 'da96f192cef9402cf0618ea2cbd82902');
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public'
                AND ((table_name IN ('beca_comedor_desborde', 'beca_comedor_transferencia')
                      AND column_name = 'origen')
                  OR (table_name = 'lineas_recibo' AND column_name = 'sobrante_de_desborde_id')))
     OR to_regprocedure('public.resolver_sobrante_cheque(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'ya aplicada: existen las columnas del sobrante o su función';
  END IF;
  -- Las funciones que se recrean o se cruzan, con la lógica que se leyó en producción (md5
  -- normalizado: sin \r, sin comentarios, espacios colapsados).
  FOR v_firma IN SELECT jsonb_object_keys(v_leido) LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_firma);
    IF v_md5 IS DISTINCT FROM v_leido ->> v_firma THEN
      RAISE EXCEPTION '% no es la leída en producción: %', v_firma, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;
  -- El CHECK del importe del cheque que se sustituye, y las dos unicidades por recibo.
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid = 'public.recibos'::regclass AND conname = 'recibos_cobro_importe_cheque')
     IS DISTINCT FROM 'CHECK ((((NOT (cobro_forma IS DISTINCT FROM ''cheque_guarderia''::metodo_pago)) = (cobro_importe_centimos IS NOT NULL)) AND ((cobro_importe_centimos IS NULL) OR ((cobro_importe_centimos > 0) AND (cobro_importe_centimos <= total_centimos)))))' THEN
    RAISE EXCEPTION 'recibos_cobro_importe_cheque no es el leído en producción';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid = 'public.beca_comedor_desborde'::regclass AND conname = 'beca_comedor_desborde_recibo_id_key')
     IS DISTINCT FROM 'UNIQUE (recibo_id)'
     OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint
          WHERE conrelid = 'public.beca_comedor_transferencia'::regclass AND conname = 'beca_comedor_transferencia_recibo_id_key')
     IS DISTINCT FROM 'UNIQUE (recibo_id)' THEN
    RAISE EXCEPTION 'las unicidades por recibo del desborde y la transferencia no son las leídas';
  END IF;
  -- Los triggers de las tres tablas son los leídos: los nuevos se suman a estos.
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.lineas_recibo'::regclass AND NOT tgisinternal) <> 5
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.beca_comedor_desborde'::regclass AND NOT tgisinternal) <> 2
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.beca_comedor_transferencia'::regclass AND NOT tgisinternal) <> 2 THEN
    RAISE EXCEPTION 'los triggers de lineas_recibo, del desborde o de la transferencia no son los leídos';
  END IF;
  SELECT count(*) INTO v_n FROM public.recibos WHERE cobro_forma = 'cheque_guarderia';
  RAISE NOTICE 'guarda previa: % recibos cobrados con cheque, % desbordes, % transferencias', v_n,
    (SELECT count(*) FROM public.beca_comedor_desborde),
    (SELECT count(*) FROM public.beca_comedor_transferencia);
END
$guarda$;

-- ---- De dónde viene el sobrante ----
-- Las filas que ya existen son de beca (el DEFAULT). Una por recibo y origen: el desborde de beca de
-- un recibo y el sobrante de su cheque no chocan.
ALTER TABLE public.beca_comedor_desborde
  ADD COLUMN origen text NOT NULL DEFAULT 'beca',
  ADD CONSTRAINT beca_comedor_desborde_origen_check CHECK (origen IN ('beca', 'cheque')),
  -- El de un cheque se difiere (`reducir`) o se transfiere; el sobrante es el cheque menos el recibo.
  ADD CONSTRAINT beca_comedor_desborde_cheque_forma CHECK (
    origen <> 'cheque'
    OR ((via IS NULL OR via IN ('reducir', 'transferencia'))
        AND exceso_centimos = beca_total_centimos - cuota_total_centimos)
  ),
  DROP CONSTRAINT beca_comedor_desborde_recibo_id_key,
  ADD CONSTRAINT beca_comedor_desborde_recibo_origen_key UNIQUE (recibo_id, origen);

COMMENT ON COLUMN public.beca_comedor_desborde.origen IS
  'PR-1c: de dónde viene el exceso. beca: la beca supera la cuota (el motor). cheque: el cheque guardería / ticket restaurant supera el recibo (cobrar_recibo_con_cheque); entonces cuota_total_centimos es el recibo y beca_total_centimos el cheque.';

ALTER TABLE public.beca_comedor_transferencia
  ADD COLUMN origen text NOT NULL DEFAULT 'beca',
  ADD CONSTRAINT beca_comedor_transferencia_origen_check CHECK (origen IN ('beca', 'cheque')),
  DROP CONSTRAINT beca_comedor_transferencia_recibo_id_key,
  ADD CONSTRAINT beca_comedor_transferencia_recibo_origen_key UNIQUE (recibo_id, origen);

COMMENT ON COLUMN public.beca_comedor_transferencia.origen IS
  'PR-1c: la devolución del exceso de una beca o del sobrante de un cheque (resolver_sobrante_cheque).';

-- ---- El cheque puede superar el recibo ----
ALTER TABLE public.recibos DROP CONSTRAINT recibos_cobro_importe_cheque;
ALTER TABLE public.recibos
  ADD CONSTRAINT recibos_cobro_importe_cheque CHECK (
    (cobro_forma IS NOT DISTINCT FROM 'cheque_guarderia') = (cobro_importe_centimos IS NOT NULL)
    AND (cobro_importe_centimos IS NULL OR cobro_importe_centimos > 0)
  );

-- ---- La línea del saldo a favor ----
-- NO ACTION (no RESTRICT): al borrar un centro, la cascada borra el recibo del cheque (y con él su
-- sobrante) y la línea en la misma sentencia, y NO ACTION mira al final de ella.
ALTER TABLE public.lineas_recibo
  ADD COLUMN sobrante_de_desborde_id uuid REFERENCES public.beca_comedor_desborde(id);

COMMENT ON COLUMN public.lineas_recibo.sobrante_de_desborde_id IS
  'PR-1c: el sobrante de cheque que esta línea devuelve como saldo a favor. Línea familiar, manual y negativa. La crea solo resolver_sobrante_cheque; borrarla deja el sobrante pendiente.';

-- Una línea por sobrante.
CREATE UNIQUE INDEX idx_lineas_recibo_sobrante_unico
  ON public.lineas_recibo (sobrante_de_desborde_id)
  WHERE sobrante_de_desborde_id IS NOT NULL;

ALTER TABLE public.lineas_recibo
  ADD CONSTRAINT lineas_recibo_sobrante_forma CHECK (
    sobrante_de_desborde_id IS NULL
    OR (origen = 'manual' AND nino_id IS NULL AND cantidad = 1 AND importe_centimos < 0
        AND precio_unitario_centimos = importe_centimos)
  );

-- ---- El sobrante de un cheque solo lo escriben sus funciones ----
CREATE FUNCTION public.beca_comedor_desborde_validar_cheque()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_marca text := COALESCE(current_setting('app.sobrante_cheque', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.origen = 'cheque' AND v_marca IS DISTINCT FROM 'cobro:' || NEW.recibo_id::text THEN
      RAISE EXCEPTION 'el sobrante de un cheque lo crea cobrar_recibo_con_cheque'
        USING ERRCODE = 'P0001', HINT = 'sobrante_por_funcion';
    END IF;
    RETURN NEW;
  END IF;
  -- Es dinero de la familia: no desaparece. Solo con service_role (la limpieza de un centro).
  IF TG_OP = 'DELETE' THEN
    IF OLD.origen = 'cheque' AND COALESCE(auth.role(), '') <> 'service_role' THEN
      RAISE EXCEPTION 'el sobrante de un cheque no se borra'
        USING ERRCODE = 'P0001', HINT = 'sobrante_no_se_borra';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.origen IS DISTINCT FROM OLD.origen THEN
    RAISE EXCEPTION 'el origen de un exceso no cambia' USING ERRCODE = 'P0001', HINT = 'sobrante_por_funcion';
  END IF;
  -- Se resuelve con resolver_sobrante_cheque y vuelve a pendiente al borrar su línea, y nada más.
  IF OLD.origen = 'cheque'
     AND v_marca IS DISTINCT FROM 'resolver:' || OLD.id::text
     AND v_marca IS DISTINCT FROM 'reabrir:' || OLD.id::text THEN
    RAISE EXCEPTION 'el sobrante de un cheque se resuelve con resolver_sobrante_cheque'
      USING ERRCODE = 'P0001', HINT = 'sobrante_por_funcion';
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.beca_comedor_desborde_validar_cheque() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER beca_comedor_desborde_validar_cheque
  BEFORE INSERT OR UPDATE OR DELETE ON public.beca_comedor_desborde
  FOR EACH ROW EXECUTE FUNCTION public.beca_comedor_desborde_validar_cheque();

CREATE FUNCTION public.beca_comedor_transferencia_validar_cheque()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_marca text := COALESCE(current_setting('app.sobrante_cheque', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.origen = 'cheque' AND v_marca IS DISTINCT FROM 'resolver:' || (
         SELECT d.id::text FROM public.beca_comedor_desborde d
          WHERE d.recibo_id = NEW.recibo_id AND d.origen = 'cheque') THEN
      RAISE EXCEPTION 'la transferencia del sobrante de un cheque la crea resolver_sobrante_cheque'
        USING ERRCODE = 'P0001', HINT = 'sobrante_por_funcion';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.origen = 'cheque' AND COALESCE(auth.role(), '') <> 'service_role' THEN
      RAISE EXCEPTION 'la transferencia del sobrante de un cheque no se borra'
        USING ERRCODE = 'P0001', HINT = 'sobrante_no_se_borra';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.origen IS DISTINCT FROM OLD.origen THEN
    RAISE EXCEPTION 'el origen de una transferencia no cambia' USING ERRCODE = 'P0001', HINT = 'sobrante_por_funcion';
  END IF;
  -- Solo se marca realizada (y pierde su recibo si este se borra): el importe es el sobrante.
  IF OLD.origen = 'cheque'
     AND (NEW.centro_id IS DISTINCT FROM OLD.centro_id
          OR NEW.familia_id IS DISTINCT FROM OLD.familia_id
          OR NEW.anio IS DISTINCT FROM OLD.anio
          OR NEW.mes IS DISTINCT FROM OLD.mes
          OR NEW.importe_centimos IS DISTINCT FROM OLD.importe_centimos
          OR (NEW.recibo_id IS DISTINCT FROM OLD.recibo_id AND NEW.recibo_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'la transferencia del sobrante de un cheque solo se marca realizada'
      USING ERRCODE = 'P0001', HINT = 'sobrante_por_funcion';
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.beca_comedor_transferencia_validar_cheque() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER beca_comedor_transferencia_validar_cheque
  BEFORE INSERT OR UPDATE OR DELETE ON public.beca_comedor_transferencia
  FOR EACH ROW EXECUTE FUNCTION public.beca_comedor_transferencia_validar_cheque();

-- ---- La línea del saldo a favor: solo la crea resolver_sobrante_cheque, y no se edita ----
CREATE FUNCTION public.lineas_recibo_validar_sobrante()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_marca text := COALESCE(current_setting('app.sobrante_cheque', true), '');
BEGIN
  -- Vale para todos, también para service_role (como la línea de una devolución arrastrada).
  IF TG_OP = 'INSERT' THEN
    IF NEW.sobrante_de_desborde_id IS NOT NULL
       AND v_marca IS DISTINCT FROM 'resolver:' || NEW.sobrante_de_desborde_id::text THEN
      RAISE EXCEPTION 'la línea del saldo a favor de un cheque se crea con resolver_sobrante_cheque'
        USING ERRCODE = 'P0001', HINT = 'sobrante_por_funcion';
    END IF;
    RETURN NEW;
  END IF;
  -- Su importe es el sobrante: ni se edita ni se mueve. Se puede borrar, y el sobrante se reabre.
  IF (OLD.sobrante_de_desborde_id IS NOT NULL OR NEW.sobrante_de_desborde_id IS NOT NULL)
     AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'la línea del saldo a favor de un cheque no se edita: se quita, y el sobrante vuelve a quedar pendiente'
      USING ERRCODE = 'P0001', HINT = 'linea_sobrante';
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.lineas_recibo_validar_sobrante() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER lineas_recibo_validar_sobrante
  BEFORE INSERT OR UPDATE ON public.lineas_recibo
  FOR EACH ROW EXECUTE FUNCTION public.lineas_recibo_validar_sobrante();

-- ---- Borrar la línea deja el sobrante pendiente ----
-- SECURITY DEFINER: la vuelta atrás no puede depender de la RLS de quien borra (un UPDATE que la
-- RLS deja en 0 filas no da error, y el saldo de la familia desaparecería). Si el sobrante existe
-- y no se pudo reabrir, el borrado falla. Si ya no existe (la cascada al borrar un centro), no hay
-- nada que reabrir.
CREATE FUNCTION public.lineas_recibo_reabrir_sobrante()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_filas integer;
BEGIN
  IF OLD.sobrante_de_desborde_id IS NULL THEN
    RETURN OLD;
  END IF;
  PERFORM set_config('app.sobrante_cheque', 'reabrir:' || OLD.sobrante_de_desborde_id::text, true);
  UPDATE public.beca_comedor_desborde
     SET estado = 'pendiente', via = NULL, resuelto_por = NULL, resuelto_at = NULL
   WHERE id = OLD.sobrante_de_desborde_id AND origen = 'cheque'
     AND estado = 'resuelto' AND via = 'reducir';
  -- Antes de quitar el marcador: PERFORM también pone FOUND.
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  PERFORM set_config('app.sobrante_cheque', '', true);
  IF v_filas = 0 AND EXISTS (SELECT 1 FROM public.beca_comedor_desborde WHERE id = OLD.sobrante_de_desborde_id) THEN
    RAISE EXCEPTION 'no se pudo dejar pendiente el sobrante de esta línea'
      USING ERRCODE = 'P0001', HINT = 'sobrante_sin_reabrir';
  END IF;
  RETURN OLD;
END $function$;

REVOKE ALL ON FUNCTION public.lineas_recibo_reabrir_sobrante() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER lineas_recibo_reabrir_sobrante
  AFTER DELETE ON public.lineas_recibo
  FOR EACH ROW EXECUTE FUNCTION public.lineas_recibo_reabrir_sobrante();

-- ---- cobrar_recibo_con_cheque: el cheque mayor deja el sobrante pendiente ----
-- De invocador: lee y escribe con la sesión (RLS de Dirección; el actor de audit_log es quien
-- cobra). Devuelve el id del recibo de la diferencia, o NULL si el cheque cubre el recibo (con o
-- sin sobrante).
CREATE OR REPLACE FUNCTION public.cobrar_recibo_con_cheque(
  p_recibo_id uuid,
  p_importe_centimos integer,
  p_fecha date,
  p_nota text,
  p_metodo_diferencia text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_r public.recibos%ROWTYPE;
  v_diferencia integer;
  v_metodo text;
  v_nuevo uuid;
  v_filas integer;
BEGIN
  SELECT * INTO v_r FROM public.recibos
   WHERE id = p_recibo_id AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recibo no encontrado' USING ERRCODE = 'P0002', HINT = 'no_encontrado';
  END IF;
  IF NOT public.es_admin(v_r.centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_fecha IS NULL OR p_fecha > public.hoy_madrid() THEN
    RAISE EXCEPTION 'fecha de cobro inválida' USING ERRCODE = '22023', HINT = 'fecha_cobro_invalida';
  END IF;
  IF p_importe_centimos IS NULL OR p_importe_centimos <= 0 THEN
    RAISE EXCEPTION 'importe del cheque inválido' USING ERRCODE = '22023', HINT = 'importe_cheque_invalido';
  END IF;
  -- PR-1c: el cheque puede superar el recibo (el sobrante queda pendiente), pero un recibo sin
  -- importe no se cobra con cheque: todo él sería sobrante.
  IF v_r.total_centimos <= 0 THEN
    RAISE EXCEPTION 'un recibo sin importe no se cobra con cheque' USING ERRCODE = 'P0001', HINT = 'recibo_sin_importe';
  END IF;

  v_diferencia := v_r.total_centimos - p_importe_centimos;
  v_metodo := NULLIF(p_metodo_diferencia, '');
  IF v_diferencia > 0 THEN
    IF v_metodo IS NULL OR v_metodo NOT IN ('sepa', 'efectivo', 'transferencia') THEN
      RAISE EXCEPTION 'falta cómo se cobra la diferencia' USING ERRCODE = '22023', HINT = 'falta_metodo_diferencia';
    END IF;
    IF v_metodo = 'sepa' AND NOT EXISTS (
         SELECT 1 FROM public.mandatos_sepa m
          WHERE m.familia_id = v_r.familia_id AND m.estado = 'activo' AND m.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'la familia no tiene mandato SEPA activo' USING ERRCODE = 'P0001', HINT = 'sin_mandato';
    END IF;
  END IF;

  PERFORM set_config('app.cobro_cheque', p_recibo_id::text, true);
  UPDATE public.recibos
     SET estado = 'cobrado_manual',
         cobro_forma = 'cheque_guarderia',
         cobro_fecha = p_fecha,
         cobro_nota = NULLIF(btrim(p_nota), ''),
         cobro_importe_centimos = p_importe_centimos
   WHERE id = p_recibo_id AND estado IN ('pendiente_procesar', 'devuelto');
  -- Antes de quitar el marcador: PERFORM también pone FOUND.
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  PERFORM set_config('app.cobro_cheque', '', true);
  IF v_filas = 0 THEN
    RAISE EXCEPTION 'solo se cobra a mano un recibo pendiente o devuelto (este está en %)', v_r.estado
      USING ERRCODE = 'P0001', HINT = 'no_cobrable_manual';
  END IF;

  IF v_diferencia > 0 THEN
    v_nuevo := public.crear_recibo_esporadico(
      v_r.centro_id, v_r.familia_id, v_r.nino_id, v_r.anio, v_r.mes,
      'Diferencia cheque guardería / Ticket restaurant', v_metodo,
      jsonb_build_array(jsonb_build_object(
        'descripcion', 'Diferencia cheque guardería / Ticket restaurant',
        'cantidad', 1,
        'precio_unitario_centimos', v_diferencia)));
    UPDATE public.recibos SET diferencia_de_recibo_id = p_recibo_id WHERE id = v_nuevo;
  ELSIF v_diferencia < 0 THEN
    -- PR-1c: el sobrante, pendiente. La directora elige diferirlo o devolverlo por transferencia
    -- (resolver_sobrante_cheque).
    PERFORM set_config('app.sobrante_cheque', 'cobro:' || p_recibo_id::text, true);
    INSERT INTO public.beca_comedor_desborde
      (centro_id, recibo_id, familia_id, anio, mes, cuota_total_centimos, beca_total_centimos,
       exceso_centimos, origen)
      VALUES (v_r.centro_id, p_recibo_id, v_r.familia_id, v_r.anio, v_r.mes, v_r.total_centimos,
              p_importe_centimos, -v_diferencia, 'cheque');
    PERFORM set_config('app.sobrante_cheque', '', true);
  END IF;
  RETURN v_nuevo;
END $function$;

REVOKE ALL ON FUNCTION public.cobrar_recibo_con_cheque(uuid,integer,date,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cobrar_recibo_con_cheque(uuid,integer,date,text,text) TO authenticated;

-- ---- resolver_sobrante_cheque: diferir o transferir, una vez ----
-- De invocador: lee y escribe con la sesión (RLS de Dirección; el actor de audit_log es quien
-- resuelve). Devuelve el recibo del mes siguiente (diferir) o la transferencia (transferencia).
CREATE FUNCTION public.resolver_sobrante_cheque(
  p_recibo_id uuid,
  p_via text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_d public.beca_comedor_desborde%ROWTYPE;
  v_destino uuid;
  v_estado public.estado_recibo;
  v_anio integer;
  v_mes integer;
  v_metodo public.metodo_pago;
  v_filas integer;
BEGIN
  SELECT * INTO v_d FROM public.beca_comedor_desborde
   WHERE recibo_id = p_recibo_id AND origen = 'cheque'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'este recibo no tiene sobrante de cheque' USING ERRCODE = 'P0002', HINT = 'no_existe';
  END IF;
  IF NOT public.es_admin(v_d.centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF v_d.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'este sobrante ya está resuelto' USING ERRCODE = 'P0001', HINT = 'ya_resuelto';
  END IF;
  IF p_via IS NULL OR p_via NOT IN ('diferir', 'transferencia') THEN
    RAISE EXCEPTION 'vía no válida' USING ERRCODE = '22023', HINT = 'via_invalida';
  END IF;

  IF p_via = 'diferir' THEN
    -- Como el desborde de beca: solo con hijos activos. Si la familia ya no los tiene, por
    -- transferencia.
    IF NOT EXISTS (
         SELECT 1 FROM public.ninos n
           JOIN public.matriculas m ON m.nino_id = n.id
          WHERE n.familia_id = v_d.familia_id AND n.deleted_at IS NULL
            AND m.estado = 'activa' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'la familia no tiene hijos activos: el sobrante se devuelve por transferencia'
        USING ERRCODE = 'P0001', HINT = 'sin_hijos';
    END IF;
    -- El mes siguiente al del recibo del cheque, sin saltos (como la devolución, 20261118120000).
    v_anio := v_d.anio + v_d.mes / 12;
    v_mes := v_d.mes % 12 + 1;
    SELECT r.id, r.estado INTO v_destino, v_estado FROM public.recibos r
     WHERE r.familia_id = v_d.familia_id AND r.anio = v_anio AND r.mes = v_mes
       AND NOT r.es_esporadico AND r.devuelto_de_recibo_id IS NULL AND r.deleted_at IS NULL
     FOR UPDATE;
    IF v_destino IS NOT NULL AND v_estado <> 'borrador' THEN
      RAISE EXCEPTION 'el recibo de la familia del mes siguiente ya está validado (%)', v_estado
        USING ERRCODE = 'P0001', HINT = 'recibo_siguiente_cerrado';
    END IF;
    IF v_destino IS NULL AND public.mes_cerrado(v_d.centro_id, v_anio, v_mes) THEN
      RAISE EXCEPTION 'el mes siguiente ya está cerrado y la familia no tiene recibo en él'
        USING ERRCODE = 'P0001', HINT = 'mes_siguiente_cerrado';
    END IF;
    IF v_destino IS NULL THEN
      -- La carcasa, como la crea el motor: método congelado, la excepción del mes si la hay; si
      -- no, el de la ficha de la familia (PR-7).
      SELECT mp.metodo INTO v_metodo FROM public.metodo_pago_familia mp
       WHERE mp.familia_id = v_d.familia_id AND mp.anio = v_anio AND mp.mes = v_mes
         AND mp.deleted_at IS NULL
       LIMIT 1;
      IF v_metodo IS NULL THEN
        SELECT f.metodo_pago INTO v_metodo FROM public.familias f WHERE f.id = v_d.familia_id;
      END IF;
      INSERT INTO public.recibos
        (centro_id, familia_id, nino_id, anio, mes, metodo, estado, total_centimos, es_esporadico)
        VALUES (v_d.centro_id, v_d.familia_id, NULL, v_anio, v_mes, v_metodo, 'borrador', 0, false)
        RETURNING id INTO v_destino;
    END IF;

    PERFORM set_config('app.sobrante_cheque', 'resolver:' || v_d.id::text, true);
    -- Una línea familiar y manual (el motor la respeta) por el sobrante, en negativo, con su origen.
    INSERT INTO public.lineas_recibo
      (centro_id, recibo_id, nino_id, concepto_id, descripcion, cantidad, precio_unitario_centimos,
       importe_centimos, origen, sobrante_de_desborde_id)
      VALUES (v_d.centro_id, v_destino, NULL, NULL,
              'Saldo a favor del cheque guardería / Ticket restaurant de '
                || (ARRAY['enero','febrero','marzo','abril','mayo','junio','julio','agosto',
                          'septiembre','octubre','noviembre','diciembre'])[v_d.mes]
                || ' de ' || v_d.anio,
              1, -v_d.exceso_centimos, -v_d.exceso_centimos, 'manual', v_d.id);
    UPDATE public.recibos
       SET total_centimos = (SELECT COALESCE(SUM(l.importe_centimos), 0)
                               FROM public.lineas_recibo l WHERE l.recibo_id = v_destino)
     WHERE id = v_destino;
    UPDATE public.beca_comedor_desborde
       SET estado = 'resuelto', via = 'reducir', resuelto_por = auth.uid(), resuelto_at = now()
     WHERE id = v_d.id AND estado = 'pendiente';
  ELSE
    PERFORM set_config('app.sobrante_cheque', 'resolver:' || v_d.id::text, true);
    INSERT INTO public.beca_comedor_transferencia
      (centro_id, recibo_id, familia_id, anio, mes, importe_centimos, estado, origen)
      VALUES (v_d.centro_id, v_d.recibo_id, v_d.familia_id, v_d.anio, v_d.mes, v_d.exceso_centimos,
              'pendiente', 'cheque')
      RETURNING id INTO v_destino;
    UPDATE public.beca_comedor_desborde
       SET estado = 'resuelto', via = 'transferencia', resuelto_por = auth.uid(), resuelto_at = now()
     WHERE id = v_d.id AND estado = 'pendiente';
  END IF;
  -- Antes de quitar el marcador: PERFORM también pone FOUND.
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  PERFORM set_config('app.sobrante_cheque', '', true);
  IF v_filas = 0 THEN
    RAISE EXCEPTION 'este sobrante ya está resuelto' USING ERRCODE = 'P0001', HINT = 'ya_resuelto';
  END IF;
  RETURN v_destino;
END $function$;

REVOKE ALL ON FUNCTION public.resolver_sobrante_cheque(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver_sobrante_cheque(uuid,text) TO authenticated;

-- ---- export_datos_sujeto: el origen de cada exceso y transferencia ----
CREATE OR REPLACE FUNCTION public.export_datos_sujeto(p_sujeto_tipo text, p_sujeto_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_self   boolean;
  v_admin  boolean;
  v_centro uuid;
  v_email  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no autorizado a exportar este sujeto'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ---------------------------------------------------------------- USUARIO
  IF p_sujeto_tipo = 'usuario' THEN
    v_self := v_uid = p_sujeto_id;
    IF NOT v_self AND NOT EXISTS (
      SELECT 1 FROM public.roles_usuario ru
       WHERE ru.usuario_id = p_sujeto_id
         AND ru.deleted_at IS NULL
         AND privado.es_responsable(ru.centro_id)
    ) THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = p_sujeto_id;

    -- Cada fila con centro pasa si es el propio usuario o si quien exporta es admin de ese
    -- centro (centro NULL nunca: es_responsable(NULL) es FALSE).
    RETURN jsonb_build_object(
      'preferencias', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'clave', p.clave, 'valor', p.valor, 'actualizado_en', p.updated_at)
               ORDER BY p.clave)
          FROM public.preferencias_usuario p
         WHERE p.usuario_id = p_sujeto_id), '[]'::jsonb),

      'dispositivos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'navegador', s.user_agent, 'registrado_en', s.created_at,
                 'ultima_actividad', s.last_active_at)
               ORDER BY s.created_at)
          FROM public.push_subscriptions s
         WHERE s.usuario_id = p_sujeto_id), '[]'::jsonb),

      'lecturas_conversaciones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'conversacion_id', l.conversacion_id, 'leido_hasta', l.last_read_at)
               ORDER BY l.last_read_at)
          FROM public.lectura_conversacion l
          JOIN public.conversaciones c ON c.id = l.conversacion_id
         WHERE l.usuario_id = p_sujeto_id
           AND (v_self OR (c.centro_id IS NOT NULL AND privado.es_responsable(c.centro_id)))), '[]'::jsonb),

      'lecturas_anuncios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'anuncio_id', l.anuncio_id, 'anuncio', a.titulo, 'leido_en', l.leido_at)
               ORDER BY l.leido_at)
          FROM public.lectura_anuncio l
          JOIN public.anuncios a ON a.id = l.anuncio_id
         WHERE l.usuario_id = p_sujeto_id
           AND (v_self OR (a.centro_id IS NOT NULL AND privado.es_responsable(a.centro_id)))), '[]'::jsonb),

      'invitaciones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'email', i.email, 'nombre_completo', i.nombre_completo,
                 'rol_objetivo', i.rol_objetivo, 'tipo_vinculo', i.tipo_vinculo,
                 'enviada_en', i.created_at, 'expira_en', i.expires_at,
                 'aceptada_en', i.accepted_at, 'rechazada_en', i.rejected_at)
               ORDER BY i.created_at)
          FROM public.invitaciones i
         WHERE v_email IS NOT NULL
           AND lower(i.email) = lower(v_email)
           AND (v_self OR privado.es_responsable(i.centro_id))), '[]'::jsonb),

      'lista_espera_contacto', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'telefono_tutor', le.telefono_tutor, 'email_tutor', le.email_tutor)
               ORDER BY le.created_at)
          FROM public.lista_espera le
         WHERE le.tutor_usuario_id = p_sujeto_id
           AND (v_self OR privado.es_responsable(le.centro_id))), '[]'::jsonb),

      'exportaciones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'exportado_en', e.created_at,
                 'solicitado_por_ti', e.solicitado_por = p_sujeto_id)
               ORDER BY e.created_at)
          FROM public.export_log e
         WHERE e.sujeto_tipo = 'usuario' AND e.sujeto_id = p_sujeto_id
           AND (v_self OR privado.es_responsable(e.centro_id))), '[]'::jsonb),

      'solicitudes_olvido', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'solicitado_en', o.solicitado_en, 'gracia_hasta', o.gracia_hasta,
                 'inmediato', o.inmediato, 'purgado_en', o.purgado_en)
               ORDER BY o.solicitado_en)
          FROM public.olvido_solicitudes o
         WHERE o.sujeto_tipo = 'usuario' AND o.sujeto_id = p_sujeto_id
           AND (v_self OR privado.es_responsable(o.centro_id))), '[]'::jsonb),

      -- Su perfil de tutor en cada familia (solo su fila, no la del otro tutor).
      'perfiles_familia', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'familia_id', ft.familia_id, 'rol_familia', ft.rol_familia,
                 'nombre_completo', ft.nombre_completo, 'email', ft.email,
                 'direccion_calle', ft.direccion_calle, 'direccion_numero', ft.direccion_numero,
                 'direccion_cp', ft.direccion_cp, 'direccion_ciudad', ft.direccion_ciudad,
                 'dni_documento_path', ft.dni_documento_path)
               ORDER BY ft.created_at)
          FROM public.familia_tutores ft
          JOIN public.familias f ON f.id = ft.familia_id
         WHERE ft.usuario_id = p_sujeto_id AND ft.deleted_at IS NULL
           AND (v_self OR privado.es_responsable(f.centro_id))), '[]'::jsonb),

      -- Los mandatos que firmó él. Del IBAN, solo los 4 últimos dígitos.
      'mandatos_sepa', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'identificador_mandato', m.identificador_mandato, 'titular', m.titular,
                 'iban_ultimos4', m.iban_ultimos4, 'estado', m.estado,
                 'metodo_firma', m.metodo_firma, 'fecha_firma', m.fecha_firma,
                 'nombre_tecleado', m.nombre_tecleado, 'firma_imagen', m.firma_imagen,
                 'ip_firma', host(m.ip_address), 'navegador_firma', m.user_agent,
                 'documento_path', m.documento_path)
               ORDER BY m.created_at)
          FROM public.mandatos_sepa m
         WHERE m.usuario_id = p_sujeto_id AND m.deleted_at IS NULL
           AND (v_self OR privado.es_responsable(m.centro_id))), '[]'::jsonb),

      -- Cobros de cada familia de la que es tutor (los dos tutores reciben lo mismo).
      'cobros_familia', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'familia', f.etiqueta, 'metodo_pago', f.metodo_pago,
                 'recibos', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'anio', r.anio, 'mes', r.mes, 'estado', r.estado, 'metodo', r.metodo,
                            'total_centimos', r.total_centimos, 'es_esporadico', r.es_esporadico,
                            'concepto_esporadico', r.concepto_esporadico,
                            'fecha_envio_banco', r.fecha_envio_banco,
                            'fecha_devolucion', r.fecha_devolucion,
                            'cobro_forma', r.cobro_forma, 'cobro_fecha', r.cobro_fecha,
                            'cobro_nota', r.cobro_nota,
                            'cobro_importe_centimos', r.cobro_importe_centimos,
                            'devolucion_gastos_centimos', r.devolucion_gastos_centimos,
                            'devolucion_salida', r.devolucion_salida,
                            'lineas', COALESCE((
                              SELECT jsonb_agg(jsonb_build_object(
                                       'descripcion', lr.descripcion, 'cantidad', lr.cantidad,
                                       'precio_unitario_centimos', lr.precio_unitario_centimos,
                                       'importe_centimos', lr.importe_centimos)
                                     ORDER BY lr.created_at, lr.id)
                                FROM public.lineas_recibo lr
                               WHERE lr.recibo_id = r.id), '[]'::jsonb))
                          ORDER BY r.anio, r.mes, r.created_at)
                     FROM public.recibos r
                    WHERE r.familia_id = f.id AND r.deleted_at IS NULL), '[]'::jsonb),
                 'metodos_pago', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'anio', mp.anio, 'mes', mp.mes, 'metodo', mp.metodo)
                          ORDER BY mp.anio, mp.mes)
                     FROM public.metodo_pago_familia mp
                    WHERE mp.familia_id = f.id AND mp.deleted_at IS NULL), '[]'::jsonb),
                 'conceptos_asignados', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'concepto', cc.nombre, 'cantidad', ac.cantidad_default,
                            'importe_especial_centimos', ac.importe_override_centimos,
                            'porcentaje_especial_bp', ac.porcentaje_override_bp,
                            'vigencia_desde', ac.vigencia_desde,
                            'vigencia_hasta', ac.vigencia_hasta)
                          ORDER BY ac.created_at)
                     FROM public.asignacion_concepto ac
                     JOIN public.conceptos_cobro cc ON cc.id = ac.concepto_id
                    WHERE ac.familia_id = f.id AND ac.deleted_at IS NULL), '[]'::jsonb),
                 'beca_comedor_excesos', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'anio', d.anio, 'mes', d.mes, 'origen', d.origen,
                            'cuota_total_centimos', d.cuota_total_centimos,
                            'beca_total_centimos', d.beca_total_centimos,
                            'exceso_centimos', d.exceso_centimos,
                            'estado', d.estado, 'via', d.via, 'resuelto_en', d.resuelto_at)
                          ORDER BY d.anio, d.mes)
                     FROM public.beca_comedor_desborde d
                    WHERE d.familia_id = f.id), '[]'::jsonb),
                 'beca_comedor_transferencias', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'anio', bt.anio, 'mes', bt.mes, 'origen', bt.origen,
                            'importe_centimos', bt.importe_centimos,
                            'estado', bt.estado, 'realizada_en', bt.realizada_at)
                          ORDER BY bt.anio, bt.mes)
                     FROM public.beca_comedor_transferencia bt
                    WHERE bt.familia_id = f.id), '[]'::jsonb))
               ORDER BY f.created_at)
          FROM public.familias f
         WHERE f.id IN (SELECT ft.familia_id FROM public.familia_tutores ft
                         WHERE ft.usuario_id = p_sujeto_id AND ft.deleted_at IS NULL)
           AND (v_self OR privado.es_responsable(f.centro_id))), '[]'::jsonb)
    );
  END IF;

  -- ---------------------------------------------------------------- NIÑO
  IF p_sujeto_tipo = 'nino' THEN
    v_centro := privado.centro_de_nino(p_sujeto_id);
    IF v_centro IS NULL THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_admin := privado.es_responsable(v_centro);
    IF NOT v_admin AND NOT public.es_tutor_legal_de(p_sujeto_id) THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN jsonb_build_object(
      -- Su prospecto entero.
      'lista_espera', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'nombre_nino', le.nombre_nino, 'apellidos_nino', le.apellidos_nino,
                 'fecha_nacimiento', le.fecha_nacimiento, 'telefono_tutor', le.telefono_tutor,
                 'email_tutor', le.email_tutor, 'nota', le.nota, 'posicion', le.posicion,
                 'estado', le.estado, 'curso', ca.nombre, 'apuntado_en', le.created_at)
               ORDER BY le.created_at)
          FROM public.lista_espera le
          LEFT JOIN public.cursos_academicos ca ON ca.id = le.curso_academico_id
         WHERE le.nino_id = p_sujeto_id), '[]'::jsonb),

      -- Sin motivo_baja. La familia, solo activa/baja (como get_recorrido_nino_familia).
      'matriculas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', m.id, 'aula', a.nombre, 'curso', ca.nombre, 'estado', m.estado,
                 'fecha_alta', m.fecha_alta, 'fecha_baja', m.fecha_baja,
                 'activada_en', m.activada_at)
               ORDER BY ca.fecha_inicio, m.fecha_alta, m.id)
          FROM public.matriculas m
          JOIN public.aulas a ON a.id = m.aula_id
          JOIN public.cursos_academicos ca ON ca.id = m.curso_academico_id
         WHERE m.nino_id = p_sujeto_id AND m.deleted_at IS NULL
           AND (v_admin OR m.estado IN ('activa', 'baja'))), '[]'::jsonb),

      -- Por sujeto, no por quién firmó: sale también el que dio el otro tutor.
      'consentimientos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'tipo', c.tipo, 'version_texto', c.version, 'aceptado_en', c.aceptado_en,
                 'revocado_en', c.revocado_en, 'metodo_firma', c.metodo_firma,
                 'otorgado_por', u.nombre_completo)
               ORDER BY c.aceptado_en)
          FROM public.consentimientos c
          LEFT JOIN public.usuarios u ON u.id = c.usuario_id
         WHERE c.nino_id = p_sujeto_id), '[]'::jsonb),

      'acuses_alta', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'tipo', aa.tipo, 'metodo', aa.metodo, 'aceptado_en', aa.aceptado_en)
               ORDER BY aa.aceptado_en)
          FROM public.acuses_alta aa
         WHERE aa.nino_id = p_sujeto_id), '[]'::jsonb),

      'cambios_solicitados', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'entidad', cp.entidad, 'campo', cp.campo,
                 'valor_propuesto', cp.valor_propuesto, 'detalle', cp.payload,
                 'estado', cp.estado, 'solicitado_en', cp.created_at,
                 'decidido_en', cp.decided_at)
               ORDER BY cp.created_at)
          FROM public.cambios_pendientes cp
         WHERE cp.nino_id = p_sujeto_id), '[]'::jsonb),

      'fin_de_curso', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('curso', ca.nombre, 'registrado_en', rf.created_at)
               ORDER BY rf.created_at)
          FROM public.rollover_finaliza rf
          JOIN public.cursos_academicos ca ON ca.id = rf.curso_academico_id
         WHERE rf.nino_id = p_sujeto_id), '[]'::jsonb),

      'citas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'titulo', ci.titulo, 'tipo', ci.tipo, 'fecha', ci.fecha,
                 'hora_inicio', ci.hora_inicio, 'hora_fin', ci.hora_fin, 'lugar', ci.lugar,
                 'descripcion', ci.descripcion, 'estado', ci.estado)
               ORDER BY ci.fecha, ci.hora_inicio)
          FROM public.citas ci
         WHERE ci.nino_id = p_sujeto_id), '[]'::jsonb),

      'eventos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'titulo', e.titulo, 'tipo', e.tipo, 'fecha', e.fecha, 'fecha_fin', e.fecha_fin,
                 'hora_inicio', e.hora_inicio, 'hora_fin', e.hora_fin, 'lugar', e.lugar,
                 'descripcion', e.descripcion, 'estado', e.estado)
               ORDER BY e.fecha, e.hora_inicio)
          FROM public.eventos e
         WHERE e.nino_id = p_sujeto_id), '[]'::jsonb),

      'confirmaciones_eventos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'evento', e.titulo, 'fecha_evento', e.fecha, 'estado', ce.estado,
                 'comentario', ce.comentario, 'confirmado_at', ce.confirmado_at)
               ORDER BY e.fecha)
          FROM public.confirmaciones_evento ce
          JOIN public.eventos e ON e.id = ce.evento_id
         WHERE ce.nino_id = p_sujeto_id), '[]'::jsonb),

      -- Los dirigidos a la familia sobre el niño; los del personal son trabajo del centro.
      'recordatorios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'titulo', r.titulo, 'descripcion', r.descripcion,
                 'vencimiento', r.vencimiento, 'completado_en', r.completado_en)
               ORDER BY r.created_at)
          FROM public.recordatorios r
         WHERE r.nino_id = p_sujeto_id AND r.destinatario = 'familia_individual'), '[]'::jsonb),

      'conceptos_asignados', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'concepto', cc.nombre, 'cantidad', ac.cantidad_default,
                 'importe_especial_centimos', ac.importe_override_centimos,
                            'porcentaje_especial_bp', ac.porcentaje_override_bp,
                 'vigencia_desde', ac.vigencia_desde, 'vigencia_hasta', ac.vigencia_hasta)
               ORDER BY ac.created_at)
          FROM public.asignacion_concepto ac
          JOIN public.conceptos_cobro cc ON cc.id = ac.concepto_id
         WHERE ac.nino_id = p_sujeto_id AND ac.deleted_at IS NULL), '[]'::jsonb),

      'lineas_recibo', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'anio', r.anio, 'mes', r.mes, 'descripcion', lr.descripcion,
                 'cantidad', lr.cantidad, 'importe_centimos', lr.importe_centimos)
               ORDER BY r.anio, r.mes, lr.created_at)
          FROM public.lineas_recibo lr
          JOIN public.recibos r ON r.id = lr.recibo_id
         WHERE lr.nino_id = p_sujeto_id AND r.deleted_at IS NULL), '[]'::jsonb),

      'servicios_diarios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'fecha', ps.fecha, 'servicio', ps.servicio, 'presente', ps.presente)
               ORDER BY ps.fecha, ps.servicio)
          FROM public.parte_servicio_diario ps
         WHERE ps.nino_id = p_sujeto_id), '[]'::jsonb),

      'beca_comedor_elegibilidad', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'curso', ca.nombre, 'fecha_alta', be.fecha_alta,
                 'fecha_baja', be.fecha_baja, 'activa', be.activa)
               ORDER BY be.fecha_alta)
          FROM public.beca_comedor_elegibilidad be
          JOIN public.cursos_academicos ca ON ca.id = be.curso_academico_id
         WHERE be.nino_id = p_sujeto_id), '[]'::jsonb),

      'beca_comedor_tramos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'anio_correspondiente', bt.anio_correspondiente,
                 'mes_correspondiente', bt.mes_correspondiente,
                 'anio_aplicacion', bt.anio_aplicacion, 'mes_aplicacion', bt.mes_aplicacion,
                 'importe_centimos', bt.importe_centimos, 'estado', bt.estado,
                 'origen', bt.origen)
               ORDER BY bt.anio_correspondiente, bt.mes_correspondiente, bt.created_at)
          FROM public.beca_comedor_tramo bt
         WHERE bt.nino_id = p_sujeto_id), '[]'::jsonb)
    );
  END IF;

  RAISE EXCEPTION 'tipo de sujeto inválido: %', p_sujeto_tipo
    USING ERRCODE = 'invalid_parameter_value';
END
$function$;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_firma text;
  v_md5 text;
  v_esperado jsonb := jsonb_build_object(
    'public.cobrar_recibo_con_cheque(uuid,integer,date,text,text)', '5c68cbbfa3d5bf46e45664966de59077',
    'public.resolver_sobrante_cheque(uuid,text)', '7fd3be4ece774e7d5383d0228e2e185e',
    'public.export_datos_sujeto(text,uuid)', '2f67be36dd5530ff76e9d2d18d28edc1',
    'public.beca_comedor_desborde_validar_cheque()', '9ccc017b44c2aa5fc8c915505055985e',
    'public.beca_comedor_transferencia_validar_cheque()', '67eda3ffbe79e7af58228a75b9965288',
    'public.lineas_recibo_validar_sobrante()', 'd3251aa714e5c8d08318d775e725862f',
    'public.lineas_recibo_reabrir_sobrante()', 'a7fa94b518ea26ab9b2f1e3284cb56c1');
BEGIN
  FOR v_firma IN SELECT jsonb_object_keys(v_esperado) LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_firma);
    IF v_md5 IS DISTINCT FROM v_esperado ->> v_firma THEN
      RAISE EXCEPTION '% no quedó como este fichero: %', v_firma, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;
  -- Las dos de la app, de invocador y solo para authenticated; el export, SECURITY DEFINER como era.
  IF (SELECT bool_or(prosecdef) FROM pg_proc WHERE oid IN (
        'public.cobrar_recibo_con_cheque(uuid,integer,date,text,text)'::regprocedure,
        'public.resolver_sobrante_cheque(uuid,text)'::regprocedure))
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.export_datos_sujeto(text,uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'cobrar y resolver son de invocador; el export, SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', 'public.cobrar_recibo_con_cheque(uuid,integer,date,text,text)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('public', 'public.cobrar_recibo_con_cheque(uuid,integer,date,text,text)'::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.cobrar_recibo_con_cheque(uuid,integer,date,text,text)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('anon', 'public.resolver_sobrante_cheque(uuid,text)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('public', 'public.resolver_sobrante_cheque(uuid,text)'::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.resolver_sobrante_cheque(uuid,text)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('anon', 'public.export_datos_sujeto(text,uuid)'::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.export_datos_sujeto(text,uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'permisos de cobrar, resolver o el export distintos de los de este fichero';
  END IF;
  -- La vuelta atrás no depende de la RLS de quien borra.
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.lineas_recibo_reabrir_sobrante()'::regprocedure)
     OR (SELECT proconfig FROM pg_proc WHERE oid = 'public.lineas_recibo_reabrir_sobrante()'::regprocedure)
        IS DISTINCT FROM ARRAY['search_path=public'] THEN
    RAISE EXCEPTION 'lineas_recibo_reabrir_sobrante tiene que ser SECURITY DEFINER con search_path = public';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t
       WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
         AND ((t.tgrelid = 'public.lineas_recibo'::regclass AND t.tgname = 'lineas_recibo_validar_sobrante'
               AND pg_get_triggerdef(t.oid) LIKE '%BEFORE INSERT OR UPDATE ON public.lineas_recibo FOR EACH ROW%')
           OR (t.tgrelid = 'public.lineas_recibo'::regclass AND t.tgname = 'lineas_recibo_reabrir_sobrante'
               AND pg_get_triggerdef(t.oid) LIKE '%AFTER DELETE ON public.lineas_recibo FOR EACH ROW%')
           OR (t.tgrelid = 'public.beca_comedor_desborde'::regclass AND t.tgname = 'beca_comedor_desborde_validar_cheque'
               AND pg_get_triggerdef(t.oid) LIKE '%BEFORE INSERT OR DELETE OR UPDATE ON public.beca_comedor_desborde FOR EACH ROW%')
           OR (t.tgrelid = 'public.beca_comedor_transferencia'::regclass AND t.tgname = 'beca_comedor_transferencia_validar_cheque'
               AND pg_get_triggerdef(t.oid) LIKE '%BEFORE INSERT OR DELETE OR UPDATE ON public.beca_comedor_transferencia FOR EACH ROW%'))) <> 4 THEN
    RAISE EXCEPTION 'faltan los triggers del sobrante';
  END IF;
  IF (SELECT count(*) FROM pg_constraint
       WHERE (conrelid = 'public.beca_comedor_desborde'::regclass
              AND conname IN ('beca_comedor_desborde_origen_check', 'beca_comedor_desborde_cheque_forma',
                              'beca_comedor_desborde_recibo_origen_key'))
          OR (conrelid = 'public.beca_comedor_transferencia'::regclass
              AND conname IN ('beca_comedor_transferencia_origen_check', 'beca_comedor_transferencia_recibo_origen_key'))
          OR (conrelid = 'public.lineas_recibo'::regclass AND conname = 'lineas_recibo_sobrante_forma')
          OR (conrelid = 'public.recibos'::regclass AND conname = 'recibos_cobro_importe_cheque'
              AND pg_get_constraintdef(oid) NOT LIKE '%<= total_centimos%')) <> 7 THEN
    RAISE EXCEPTION 'faltan las restricciones del sobrante';
  END IF;
  IF to_regclass('public.idx_lineas_recibo_sobrante_unico') IS NULL THEN
    RAISE EXCEPTION 'falta el índice de una línea por sobrante';
  END IF;
  RAISE NOTICE 'guarda posterior: origen, sobrante pendiente, su resolución, su línea y el export';
END
$guarda$;
