-- =============================================================================
-- FEAT — Recibos, PR-14: la devolución arrastrada al siguiente recibo
-- -----------------------------------------------------------------------------
-- La cuarta salida de una devolución, la que el PR-2 dejó fuera. Las otras tres (banco, efectivo,
-- transferencia) siguen igual. Decisiones del responsable:
--
--   · Una LÍNEA en el siguiente recibo de la familia, por total + gastos, con referencia a su
--     recibo de origen (`lineas_recibo.arrastre_de_recibo_id`). El original se queda `devuelto`
--     con su salida (`siguiente_recibo`), como con el banco.
--   · El «siguiente recibo» es el recibo regular de la familia en BORRADOR del primer mes posterior
--     al del recibo devuelto. Si la familia no tiene ninguno, esta salida no se ofrece (P0001,
--     `sin_recibo_siguiente`).
--   · El cierre es atómico, en `resolver_devolucion`: la línea, el total del recibo de destino y la
--     salida del original, en la misma transacción.
--   · Si se BORRA la línea (a mano, o porque se borra su recibo), la devolución vuelve a quedar SIN
--     RESOLVER: si no, la deuda desaparecería sin rastro. Lo hace un trigger AFTER DELETE, también
--     para service_role. La línea no se puede editar (el importe es la deuda) ni crear por otro
--     camino.
--   · El motor no la borra al regenerar: es `origen = 'manual'` (R-2).
--   · Si el recibo de destino también se devuelve, su total ya incluye la línea: se trata igual,
--     con las cuatro salidas. Dos arrastres al mismo recibo son dos líneas, cada una con su origen.
--
-- `recibos_validar_devolucion` y `resolver_devolucion` se recrean desde el texto de
-- `20261107120000` (el vivo en producción el 2026-10-24: md5 normalizado en la guarda previa).
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor, DESPUÉS de
-- `20261116120000`. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_firma text;
  v_md5 text;
  v_n integer;
  v_leido jsonb := jsonb_build_object(
    'public.recibos_validar_devolucion()', '689b8a3bd25ae1dea5881b958bd7ff78',
    'public.resolver_devolucion(uuid,text,date,text)', '4c4d6d22bdc6a579394e4a5d9b01d245',
    -- No se recrean, pero las cruza la salida nueva: tienen que ser las que se leyeron.
    'public.congelar_si_mes_cerrado()', '2e4c101653c8456a89a04fed2e5245f6',
    'public.derivar_centro_id_de_recibo()', '1e9919f97c5d6281597170a439011332',
    'public.es_admin(uuid)', 'da96f192cef9402cf0618ea2cbd82902',
    'public.hoy_madrid()', '6f6d1655f787361bfdc6638a484318cb');
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'lineas_recibo'
                AND column_name = 'arrastre_de_recibo_id')
     OR to_regprocedure('public.lineas_recibo_validar_arrastre()') IS NOT NULL
     OR to_regprocedure('public.lineas_recibo_reabrir_devolucion()') IS NOT NULL THEN
    RAISE EXCEPTION 'ya aplicada: existe la columna del arrastre o sus funciones';
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
  -- El CHECK de la salida que se sustituye es el leído.
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid = 'public.recibos'::regclass AND conname = 'recibos_devolucion_salida')
     IS DISTINCT FROM 'CHECK ((((devolucion_salida IS NULL) OR ((fecha_devolucion IS NOT NULL) AND (((devolucion_salida = ''banco''::text) AND (estado = ''devuelto''::estado_recibo)) OR ((devolucion_salida = ANY (ARRAY[''efectivo''::text, ''transferencia''::text])) AND (estado = ''cobrado_manual''::estado_recibo) AND ((cobro_forma)::text = devolucion_salida))))) AND (NOT ((estado = ''cobrado_manual''::estado_recibo) AND (fecha_devolucion IS NOT NULL) AND (devolucion_salida IS NULL)))))' THEN
    RAISE EXCEPTION 'recibos_devolucion_salida no es el leído en producción';
  END IF;
  -- Los triggers de lineas_recibo son los leídos: el nuevo se suma a estos tres.
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE tgrelid = 'public.lineas_recibo'::regclass AND NOT tgisinternal;
  IF v_n <> 3 OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.lineas_recibo'::regclass
                                AND tgname = 'lineas_recibo_congelar') THEN
    RAISE EXCEPTION 'lineas_recibo tiene % triggers, se esperaban los 3 leídos', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.recibos WHERE fecha_devolucion IS NOT NULL;
  RAISE NOTICE 'guarda previa: % recibos con devolución', v_n;
END
$guarda$;

-- ---- La línea del arrastre ----
-- NO ACTION (no RESTRICT): al borrar un centro, la cascada borra el recibo de origen y la línea en
-- la misma sentencia, y NO ACTION mira al final de ella.
ALTER TABLE public.lineas_recibo
  ADD COLUMN arrastre_de_recibo_id uuid REFERENCES public.recibos(id);

COMMENT ON COLUMN public.lineas_recibo.arrastre_de_recibo_id IS
  'PR-14: la devolución que arrastra esta línea (el recibo devuelto). Total + gastos, línea familiar y manual. La crea solo resolver_devolucion; borrarla deja la devolución sin resolver.';

-- Una línea por devolución.
CREATE UNIQUE INDEX idx_lineas_recibo_arrastre_unico
  ON public.lineas_recibo (arrastre_de_recibo_id)
  WHERE arrastre_de_recibo_id IS NOT NULL;

ALTER TABLE public.lineas_recibo
  ADD CONSTRAINT lineas_recibo_arrastre_forma CHECK (
    arrastre_de_recibo_id IS NULL
    OR (origen = 'manual' AND nino_id IS NULL AND cantidad = 1 AND importe_centimos > 0
        AND precio_unitario_centimos = importe_centimos)
  );

-- ---- La salida nueva en el CHECK ----
-- Banco y siguiente recibo dejan el original devuelto; efectivo o transferencia lo dejan cobrado
-- con esa forma. Y un devuelto cobrado siempre dice por dónde salió.
ALTER TABLE public.recibos DROP CONSTRAINT recibos_devolucion_salida;
ALTER TABLE public.recibos
  ADD CONSTRAINT recibos_devolucion_salida CHECK (
    (devolucion_salida IS NULL
       OR (fecha_devolucion IS NOT NULL
           AND ((devolucion_salida IN ('banco', 'siguiente_recibo') AND estado = 'devuelto')
             OR (devolucion_salida IN ('efectivo', 'transferencia')
                 AND estado = 'cobrado_manual' AND cobro_forma::text = devolucion_salida))))
    AND NOT (estado = 'cobrado_manual' AND fecha_devolucion IS NOT NULL AND devolucion_salida IS NULL)
  );

COMMENT ON COLUMN public.recibos.devolucion_salida IS
  'PR-2 y PR-14: cómo se resolvió la devolución, una sola vez (resolver_devolucion): banco (re-giro), efectivo, transferencia o siguiente_recibo (una línea en el siguiente borrador de la familia; si se borra, vuelve a NULL).';

-- ---- La devolución solo se resuelve, y se reabre, por sus funciones ----
CREATE OR REPLACE FUNCTION public.recibos_validar_devolucion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_marca text := COALESCE(current_setting('app.resolver_devolucion', true), '');
  v_reabre boolean;
BEGIN
  -- Vale para todos, también para service_role: un re-giro es la salida «banco» de una devolución.
  IF TG_OP = 'INSERT' THEN
    IF NEW.devuelto_de_recibo_id IS NOT NULL
       AND v_marca IS DISTINCT FROM NEW.devuelto_de_recibo_id::text THEN
      RAISE EXCEPTION 'un re-giro se crea con resolver_devolucion'
        USING ERRCODE = 'P0001', HINT = 'devolucion_por_funcion';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.devuelto_de_recibo_id IS DISTINCT FROM OLD.devuelto_de_recibo_id THEN
    RAISE EXCEPTION 'un re-giro se crea con resolver_devolucion'
      USING ERRCODE = 'P0001', HINT = 'devolucion_por_funcion';
  END IF;
  -- PR-14: la única vuelta atrás. Al borrar la línea de un arrastre, su devolución queda sin
  -- resolver (lineas_recibo_reabrir_devolucion), y solo eso: el estado, los gastos y la fecha no
  -- cambian.
  v_reabre := OLD.devolucion_salida = 'siguiente_recibo'
              AND NEW.devolucion_salida IS NULL
              AND NEW.estado = OLD.estado
              AND NEW.devolucion_gastos_centimos IS NOT DISTINCT FROM OLD.devolucion_gastos_centimos
              AND NEW.fecha_devolucion IS NOT DISTINCT FROM OLD.fecha_devolucion
              AND v_marca = 'reabrir:' || NEW.id::text;
  -- Una devolución resuelta no cambia: ni su salida, ni sus gastos, ni su fecha.
  IF NOT v_reabre AND OLD.devolucion_salida IS NOT NULL
     AND (NEW.devolucion_salida IS DISTINCT FROM OLD.devolucion_salida
          OR NEW.devolucion_gastos_centimos IS DISTINCT FROM OLD.devolucion_gastos_centimos
          OR NEW.fecha_devolucion IS DISTINCT FROM OLD.fecha_devolucion) THEN
    RAISE EXCEPTION 'esta devolución ya está resuelta (%)', OLD.devolucion_salida
      USING ERRCODE = 'P0001', HINT = 'devolucion_ya_resuelta';
  END IF;
  -- Poner la salida, o sacar el recibo de `devuelto`, solo lo hace resolver_devolucion.
  IF NOT v_reabre
     AND (NEW.devolucion_salida IS DISTINCT FROM OLD.devolucion_salida
          OR (OLD.estado = 'devuelto' AND NEW.estado IS DISTINCT FROM 'devuelto'))
     AND v_marca IS DISTINCT FROM NEW.id::text THEN
    RAISE EXCEPTION 'una devolución se resuelve con resolver_devolucion'
      USING ERRCODE = 'P0001', HINT = 'devolucion_por_funcion';
  END IF;
  -- La fecha de la devolución no puede ser futura (la del banco, no la de mañana).
  IF NEW.fecha_devolucion IS DISTINCT FROM OLD.fecha_devolucion
     AND NEW.fecha_devolucion > public.hoy_madrid() THEN
    RAISE EXCEPTION 'la fecha de la devolución no puede ser futura'
      USING ERRCODE = '22023', HINT = 'fecha_devolucion_invalida';
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.recibos_validar_devolucion() FROM PUBLIC, anon, authenticated;

-- ---- La línea del arrastre: solo la crea resolver_devolucion, y no se edita ----
CREATE FUNCTION public.lineas_recibo_validar_arrastre()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_marca text := COALESCE(current_setting('app.resolver_devolucion', true), '');
BEGIN
  -- Vale para todos, también para service_role (como el re-giro).
  IF TG_OP = 'INSERT' THEN
    IF NEW.arrastre_de_recibo_id IS NOT NULL
       AND v_marca IS DISTINCT FROM NEW.arrastre_de_recibo_id::text THEN
      RAISE EXCEPTION 'la línea de una devolución arrastrada se crea con resolver_devolucion'
        USING ERRCODE = 'P0001', HINT = 'arrastre_por_funcion';
    END IF;
    RETURN NEW;
  END IF;
  -- Su importe es la deuda: ni se edita ni se mueve. Se puede borrar, y la devolución se reabre.
  IF (OLD.arrastre_de_recibo_id IS NOT NULL OR NEW.arrastre_de_recibo_id IS NOT NULL)
     AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'la línea de una devolución arrastrada no se edita: se quita, y la devolución vuelve a quedar sin resolver'
      USING ERRCODE = 'P0001', HINT = 'linea_arrastre';
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.lineas_recibo_validar_arrastre() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER lineas_recibo_validar_arrastre
  BEFORE INSERT OR UPDATE ON public.lineas_recibo
  FOR EACH ROW EXECUTE FUNCTION public.lineas_recibo_validar_arrastre();

-- ---- Borrar la línea deja la devolución sin resolver ----
-- SECURITY DEFINER: la vuelta atrás no puede depender de la RLS de quien borra (un UPDATE que la
-- RLS deja en 0 filas no da error, y la deuda desaparecería). Si el recibo de origen existe y no
-- se pudo reabrir, el borrado falla. Si ya no existe (la cascada al borrar un centro), no hay nada
-- que reabrir.
CREATE FUNCTION public.lineas_recibo_reabrir_devolucion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_filas integer;
BEGIN
  IF OLD.arrastre_de_recibo_id IS NULL THEN
    RETURN OLD;
  END IF;
  PERFORM set_config('app.resolver_devolucion', 'reabrir:' || OLD.arrastre_de_recibo_id::text, true);
  UPDATE public.recibos
     SET devolucion_salida = NULL
   WHERE id = OLD.arrastre_de_recibo_id AND devolucion_salida = 'siguiente_recibo';
  -- Antes de quitar el marcador: PERFORM también pone FOUND.
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  PERFORM set_config('app.resolver_devolucion', '', true);
  IF v_filas = 0 AND EXISTS (SELECT 1 FROM public.recibos WHERE id = OLD.arrastre_de_recibo_id) THEN
    RAISE EXCEPTION 'no se pudo dejar sin resolver la devolución de esta línea'
      USING ERRCODE = 'P0001', HINT = 'arrastre_sin_reabrir';
  END IF;
  RETURN OLD;
END $function$;

REVOKE ALL ON FUNCTION public.lineas_recibo_reabrir_devolucion() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER lineas_recibo_reabrir_devolucion
  AFTER DELETE ON public.lineas_recibo
  FOR EACH ROW EXECUTE FUNCTION public.lineas_recibo_reabrir_devolucion();

-- ---- resolver_devolucion: la cuarta salida ----
-- De invocador: lee y escribe con la sesión (RLS de Dirección; el actor de audit_log es quien
-- resuelve). Devuelve el id del recibo nuevo o tocado: el re-giro (banco) o el recibo al que se
-- arrastra (siguiente_recibo); NULL con efectivo o transferencia.
CREATE OR REPLACE FUNCTION public.resolver_devolucion(
  p_recibo_id uuid,
  p_salida text,
  p_fecha date,
  p_nota text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_r public.recibos%ROWTYPE;
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
  -- Primero la salida: un devuelto cobrado en efectivo ya no está `devuelto`, y lo que hay que
  -- decir es que ya se resolvió.
  IF v_r.devolucion_salida IS NOT NULL THEN
    RAISE EXCEPTION 'esta devolución ya está resuelta (%)', v_r.devolucion_salida
      USING ERRCODE = 'P0001', HINT = 'devolucion_ya_resuelta';
  END IF;
  IF v_r.estado <> 'devuelto' THEN
    RAISE EXCEPTION 'solo se resuelve un recibo devuelto (este está en %)', v_r.estado
      USING ERRCODE = 'P0001', HINT = 'no_devuelto';
  END IF;
  IF p_salida IS NULL OR p_salida NOT IN ('banco', 'efectivo', 'transferencia', 'siguiente_recibo') THEN
    RAISE EXCEPTION 'salida no válida' USING ERRCODE = '22023', HINT = 'salida_invalida';
  END IF;
  IF p_salida = 'banco' THEN
    IF NOT EXISTS (
         SELECT 1 FROM public.mandatos_sepa m
          WHERE m.familia_id = v_r.familia_id AND m.estado = 'activo' AND m.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'la familia no tiene mandato SEPA activo' USING ERRCODE = 'P0001', HINT = 'sin_mandato';
    END IF;
  ELSIF p_salida = 'siguiente_recibo' THEN
    -- El recibo regular de la familia en borrador del primer mes posterior al del devuelto.
    SELECT r.id INTO v_nuevo FROM public.recibos r
     WHERE r.familia_id = v_r.familia_id
       AND NOT r.es_esporadico AND r.devuelto_de_recibo_id IS NULL AND r.deleted_at IS NULL
       AND r.estado = 'borrador'
       AND (r.anio, r.mes) > (v_r.anio, v_r.mes)
     ORDER BY r.anio, r.mes
     LIMIT 1
     FOR UPDATE;
    IF v_nuevo IS NULL THEN
      RAISE EXCEPTION 'la familia no tiene un recibo en borrador de un mes posterior'
        USING ERRCODE = 'P0001', HINT = 'sin_recibo_siguiente';
    END IF;
  ELSIF p_fecha IS NULL OR p_fecha > public.hoy_madrid() OR p_fecha < v_r.fecha_devolucion THEN
    RAISE EXCEPTION 'fecha de cobro inválida' USING ERRCODE = '22023', HINT = 'fecha_cobro_invalida';
  END IF;

  PERFORM set_config('app.resolver_devolucion', p_recibo_id::text, true);
  IF p_salida = 'banco' THEN
    INSERT INTO public.recibos
      (centro_id, familia_id, nino_id, anio, mes, metodo, estado, total_centimos, es_esporadico,
       devuelto_de_recibo_id)
      VALUES (v_r.centro_id, v_r.familia_id, v_r.nino_id, v_r.anio, v_r.mes, 'sepa',
              'pendiente_procesar', v_r.total_centimos + v_r.devolucion_gastos_centimos, false,
              v_r.id)
      RETURNING id INTO v_nuevo;
    INSERT INTO public.lineas_recibo
      (centro_id, recibo_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos)
      VALUES (v_r.centro_id, v_nuevo, 'Re-giro de recibo devuelto', 1, v_r.total_centimos,
              v_r.total_centimos);
    IF v_r.devolucion_gastos_centimos > 0 THEN
      INSERT INTO public.lineas_recibo
        (centro_id, recibo_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos)
        VALUES (v_r.centro_id, v_nuevo, 'Gastos de devolución', 1, v_r.devolucion_gastos_centimos,
                v_r.devolucion_gastos_centimos);
    END IF;
    UPDATE public.recibos
       SET devolucion_salida = 'banco'
     WHERE id = p_recibo_id AND estado = 'devuelto' AND devolucion_salida IS NULL;
  ELSIF p_salida = 'siguiente_recibo' THEN
    -- Una línea familiar y manual (el motor la respeta) por total + gastos, con su origen.
    INSERT INTO public.lineas_recibo
      (centro_id, recibo_id, nino_id, concepto_id, descripcion, cantidad, precio_unitario_centimos,
       importe_centimos, origen, arrastre_de_recibo_id)
      VALUES (v_r.centro_id, v_nuevo, NULL, NULL,
              'Recibo devuelto de '
                || (ARRAY['enero','febrero','marzo','abril','mayo','junio','julio','agosto',
                          'septiembre','octubre','noviembre','diciembre'])[v_r.mes]
                || ' de ' || v_r.anio
                || CASE WHEN v_r.devolucion_gastos_centimos > 0
                        THEN ' (con los gastos de la devolución)' ELSE '' END,
              1, v_r.total_centimos + v_r.devolucion_gastos_centimos,
              v_r.total_centimos + v_r.devolucion_gastos_centimos, 'manual', v_r.id);
    UPDATE public.recibos
       SET total_centimos = (SELECT COALESCE(SUM(l.importe_centimos), 0)
                               FROM public.lineas_recibo l WHERE l.recibo_id = v_nuevo)
     WHERE id = v_nuevo;
    UPDATE public.recibos
       SET devolucion_salida = 'siguiente_recibo'
     WHERE id = p_recibo_id AND estado = 'devuelto' AND devolucion_salida IS NULL;
  ELSE
    UPDATE public.recibos
       SET estado = 'cobrado_manual',
           cobro_forma = p_salida::public.metodo_pago,
           cobro_fecha = p_fecha,
           cobro_nota = NULLIF(btrim(p_nota), ''),
           devolucion_salida = p_salida
     WHERE id = p_recibo_id AND estado = 'devuelto' AND devolucion_salida IS NULL;
  END IF;
  -- Antes de quitar el marcador: PERFORM también pone FOUND.
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  PERFORM set_config('app.resolver_devolucion', '', true);
  IF v_filas = 0 THEN
    RAISE EXCEPTION 'esta devolución ya está resuelta' USING ERRCODE = 'P0001', HINT = 'devolucion_ya_resuelta';
  END IF;
  RETURN v_nuevo;
END $function$;

REVOKE ALL ON FUNCTION public.resolver_devolucion(uuid,text,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver_devolucion(uuid,text,date,text) TO authenticated;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_firma text;
  v_md5 text;
  v_esperado jsonb := jsonb_build_object(
    'public.recibos_validar_devolucion()', 'c178a774f826391c05e4ce575e209c08',
    'public.resolver_devolucion(uuid,text,date,text)', '9f9bc1ae51b84136fb3fa8c6f496d73d',
    'public.lineas_recibo_validar_arrastre()', '47f4146a8e303faef259f0e1d5d88a8b',
    'public.lineas_recibo_reabrir_devolucion()', 'a4ec170dd7254f0de70abe5b28542b83');
BEGIN
  FOR v_firma IN SELECT jsonb_object_keys(v_esperado) LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_firma);
    IF v_md5 IS DISTINCT FROM v_esperado ->> v_firma THEN
      RAISE EXCEPTION '% no quedó como este fichero: %', v_firma, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;
  -- resolver_devolucion: de invocador, solo para authenticated.
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.resolver_devolucion(uuid,text,date,text)'::regprocedure) THEN
    RAISE EXCEPTION 'resolver_devolucion no debe ser SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', 'public.resolver_devolucion(uuid,text,date,text)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('public', 'public.resolver_devolucion(uuid,text,date,text)'::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.resolver_devolucion(uuid,text,date,text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'resolver_devolucion: permisos distintos de los de este fichero';
  END IF;
  -- La vuelta atrás no depende de la RLS de quien borra.
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.lineas_recibo_reabrir_devolucion()'::regprocedure)
     OR (SELECT proconfig FROM pg_proc WHERE oid = 'public.lineas_recibo_reabrir_devolucion()'::regprocedure)
        IS DISTINCT FROM ARRAY['search_path=public'] THEN
    RAISE EXCEPTION 'lineas_recibo_reabrir_devolucion tiene que ser SECURITY DEFINER con search_path = public';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.lineas_recibo'::regclass AND tgname = 'lineas_recibo_validar_arrastre'
                    AND tgenabled = 'O'
                    AND pg_get_triggerdef(oid) LIKE '%BEFORE INSERT OR UPDATE ON public.lineas_recibo FOR EACH ROW%')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.lineas_recibo'::regclass AND tgname = 'lineas_recibo_reabrir_devolucion'
                    AND tgenabled = 'O'
                    AND pg_get_triggerdef(oid) LIKE '%AFTER DELETE ON public.lineas_recibo FOR EACH ROW%') THEN
    RAISE EXCEPTION 'faltan los triggers de la línea del arrastre';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.recibos'::regclass AND tgname = 'recibos_validar_devolucion'
                    AND tgenabled = 'O'
                    AND pg_get_triggerdef(oid) LIKE '%BEFORE INSERT OR UPDATE OF estado, devolucion_salida, devolucion_gastos_centimos, fecha_devolucion, devuelto_de_recibo_id ON%') THEN
    RAISE EXCEPTION 'el trigger recibos_validar_devolucion no vigila el alta y las columnas de la devolución';
  END IF;
  IF (SELECT count(*) FROM pg_constraint
       WHERE (conrelid = 'public.recibos'::regclass AND conname = 'recibos_devolucion_salida'
              AND pg_get_constraintdef(oid) LIKE '%''siguiente_recibo''%')
          OR (conrelid = 'public.lineas_recibo'::regclass AND conname = 'lineas_recibo_arrastre_forma')) <> 2 THEN
    RAISE EXCEPTION 'faltan los CHECK del arrastre';
  END IF;
  IF to_regclass('public.idx_lineas_recibo_arrastre_unico') IS NULL THEN
    RAISE EXCEPTION 'falta el índice de una línea por devolución';
  END IF;
  RAISE NOTICE 'guarda posterior: columna, CHECK, índice, triggers y resolver_devolucion con la cuarta salida';
END
$guarda$;
