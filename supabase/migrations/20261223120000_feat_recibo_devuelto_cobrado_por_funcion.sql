-- =============================================================================
-- FEAT — La devolución y el cobro a mano tienen dueño en la base, y confirmar, desconfirmar y crear
-- un recibo en pendiente solo van por sus funciones
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/altas-serie.md, «Las puertas del recibo» (decisiones C y D del responsable del
-- 2026-11-02; del 2026-11-03, que valen para todos, también service_role).
--
--   · C. `marcarReciboDevuelto` y `marcarCobradoManual` eran UPDATE directos desde la app: esos dos
--     hechos de dinero no tenían dueño en la base. Ahora los tienen:
--       - `marcar_recibo_devuelto(recibo, fecha, gastos)`: un recibo enviado al banco pasa a
--         devuelto, con la fecha que dice el banco y sus gastos;
--       - `marcar_cobrado_manual(recibo, forma, fecha, nota)`: un recibo pendiente que no es SEPA
--         queda cobrado en efectivo o por transferencia.
--     Las dos son de invocador, como resolver_devolucion y cobrar_recibo_con_cheque, con el recibo
--     bloqueado, `es_admin` del centro del recibo y los mismos rechazos que hacía la app, cada uno con
--     su HINT. Ponen su marcador (`app.marcar_recibo_devuelto`, `app.marcar_cobrado_manual` = el id
--     del recibo) alrededor de su UPDATE.
--   · D. `confirmar_recibo` y `desconfirmar_recibo` ponen su marcador (`app.confirmar_recibo`,
--     `app.desconfirmar_recibo`), y `crear_recibo_esporadico` genera el id antes del INSERT para
--     poner el suyo (`app.crear_recibo_esporadico`). Hasta aquí un UPDATE directo pasaba un recibo de
--     borrador a pendiente sin el ancla de `cierre_mensual`, o lo devolvía a borrador sin quitarla:
--     con el mes cerrado, el mes quedaba cerrado con un borrador dentro.
--   · El trigger `recibos_dinero_solo_por_funcion` (20261222120000) se amplía, para todos:
--       - entrar en devuelto, solo con el marcador de marcar_recibo_devuelto (`devuelto_por_funcion`);
--       - entrar en cobrado_manual, solo con el de marcar_cobrado_manual, cobrar_recibo_con_cheque
--         (`app.cobro_cheque`) o resolver_devolucion (`app.resolver_devolucion`)
--         (`cobrado_por_funcion`);
--       - de borrador a pendiente, solo confirmar_recibo (`confirmar_por_funcion`); de pendiente a
--         borrador, solo desconfirmar_recibo (`desconfirmar_por_funcion`);
--       - un recibo nace en borrador; en pendiente solo el esporádico de crear_recibo_esporadico y el
--         re-giro de resolver_devolucion; en devuelto o cobrado, nunca (`recibo_nace_en_borrador`).
--     A y B no cambian.
--
-- La aplica el responsable por SQL Editor, después de 20261222120000. Sin BEGIN ni COMMIT. Tras
-- aplicar: registrar en supabase_migrations.schema_migrations. ORDEN: aplicar y mergear seguidos.
-- Con la migración aplicada, la devolución y el cobro a mano de la app de ahora (UPDATE directos)
-- fallan, sin escribir nada, hasta que se despliega la de este PR; y la app de este PR, sin la
-- migración, no encuentra las funciones.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_fn  text;
  v_md5 text;
  v_esperado text;
BEGIN
  IF to_regprocedure('public.marcar_recibo_devuelto(uuid,date,integer)') IS NOT NULL
     OR to_regprocedure('public.marcar_cobrado_manual(uuid,public.metodo_pago,date,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'ya aplicada: existe marcar_recibo_devuelto o marcar_cobrado_manual';
  END IF;
  -- Lo que se reescribe es lo que hay, tal como quedó.
  FOR v_fn, v_esperado IN VALUES
    ('public.recibos_dinero_solo_por_funcion()', '9983fa9182926577e19886c8bc030ba8'),
    ('public.confirmar_recibo(uuid)', '532d31c18d0f88c2ff00cd156fa8e632'),
    ('public.desconfirmar_recibo(uuid)', 'c8772170326a5421b4bd790785d0312c'),
    ('public.crear_recibo_esporadico(uuid,uuid,uuid,integer,integer,text,text,jsonb)', 'b8d86d20e4280e1c2acc7561e4bdfead')
  LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn);
    IF v_md5 IS DISTINCT FROM v_esperado THEN
      RAISE EXCEPTION '% no es la que se reescribe: %', v_fn, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;
  -- El trigger mira las transiciones: los recibos que hay en cada estado no se tocan.
  RAISE NOTICE 'guarda previa: recibos vivos por estado %; meses cerrados con un borrador regular dentro %',
    (SELECT json_object_agg(estado, n) FROM (SELECT estado, count(*) n FROM public.recibos
      WHERE deleted_at IS NULL GROUP BY estado) x),
    (SELECT count(*) FROM public.cierre_mensual c
      WHERE EXISTS (SELECT 1 FROM public.recibos r
                     WHERE r.centro_id = c.centro_id AND r.anio = c.anio AND r.mes = c.mes
                       AND r.estado = 'borrador' AND NOT r.es_esporadico
                       AND r.devuelto_de_recibo_id IS NULL AND r.deleted_at IS NULL));
END
$guarda$;

-- ---- 1. La devolución ----
CREATE FUNCTION public.marcar_recibo_devuelto(p_recibo_id uuid, p_fecha date, p_gastos_centimos integer)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_r public.recibos%ROWTYPE;
BEGIN
  IF p_fecha IS NULL OR p_gastos_centimos IS NULL THEN
    RAISE EXCEPTION 'faltan la fecha o los gastos' USING ERRCODE = '22023', HINT = 'datos_no_validos';
  END IF;
  -- La fecha que dice el banco: nunca futura.
  IF p_fecha > public.hoy_madrid() THEN
    RAISE EXCEPTION 'la fecha de la devolución no puede ser futura'
      USING ERRCODE = '22023', HINT = 'fecha_devolucion_invalida';
  END IF;
  IF p_gastos_centimos < 0 THEN
    RAISE EXCEPTION 'los gastos no pueden ser negativos' USING ERRCODE = '22023', HINT = 'gastos_invalidos';
  END IF;
  SELECT * INTO v_r FROM public.recibos
   WHERE id = p_recibo_id AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recibo no encontrado' USING ERRCODE = 'P0002', HINT = 'no_encontrado';
  END IF;
  IF NOT public.es_admin(v_r.centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF v_r.estado <> 'enviado_banco' THEN
    RAISE EXCEPTION 'solo se devuelve un recibo enviado al banco (este está en %)', v_r.estado
      USING ERRCODE = 'P0001', HINT = 'no_devolvible';
  END IF;
  IF p_fecha < v_r.fecha_envio_banco THEN
    RAISE EXCEPTION 'la devolución no puede ser anterior al envío (%)', v_r.fecha_envio_banco
      USING ERRCODE = 'P0001', HINT = 'devolucion_antes_del_envio';
  END IF;

  -- El único sitio que pasa un recibo a devuelto (recibos_dinero_solo_por_funcion).
  PERFORM set_config('app.marcar_recibo_devuelto', p_recibo_id::text, true);
  UPDATE public.recibos
     SET estado = 'devuelto', fecha_devolucion = p_fecha, devolucion_gastos_centimos = p_gastos_centimos
   WHERE id = p_recibo_id;
  PERFORM set_config('app.marcar_recibo_devuelto', '', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.marcar_recibo_devuelto(uuid, date, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.marcar_recibo_devuelto(uuid, date, integer) TO authenticated;

COMMENT ON FUNCTION public.marcar_recibo_devuelto(uuid, date, integer) IS
  'C: un recibo enviado al banco pasa a devuelto, con la fecha del banco (no futura ni anterior al envío) y sus gastos. Conserva fecha_envio_banco. De invocador, es_admin.';

-- ---- 2. El cobro a mano ----
CREATE FUNCTION public.marcar_cobrado_manual(p_recibo_id uuid, p_forma public.metodo_pago, p_fecha date, p_nota text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_r    public.recibos%ROWTYPE;
  v_nota text := NULLIF(btrim(p_nota), '');
BEGIN
  -- Efectivo o transferencia: el cheque pide su importe y va por cobrar_recibo_con_cheque.
  IF p_forma IS NULL OR p_forma NOT IN ('efectivo', 'transferencia') THEN
    RAISE EXCEPTION 'forma de cobro no válida (%)', p_forma USING ERRCODE = '22023', HINT = 'forma_no_valida';
  END IF;
  IF p_fecha IS NULL THEN
    RAISE EXCEPTION 'falta la fecha del cobro' USING ERRCODE = '22023', HINT = 'datos_no_validos';
  END IF;
  IF p_fecha > public.hoy_madrid() THEN
    RAISE EXCEPTION 'la fecha del cobro no puede ser futura' USING ERRCODE = '22023', HINT = 'fecha_cobro_futura';
  END IF;
  IF char_length(v_nota) > 500 THEN
    RAISE EXCEPTION 'la nota pasa de 500 caracteres' USING ERRCODE = '22023', HINT = 'nota_cobro_larga';
  END IF;
  SELECT * INTO v_r FROM public.recibos
   WHERE id = p_recibo_id AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recibo no encontrado' USING ERRCODE = 'P0002', HINT = 'no_encontrado';
  END IF;
  IF NOT public.es_admin(v_r.centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF v_r.estado = 'pendiente_procesar' AND v_r.metodo = 'sepa' THEN
    RAISE EXCEPTION 'un recibo SEPA pendiente se cobra por remesa' USING ERRCODE = 'P0001', HINT = 'sepa_por_remesa';
  END IF;
  -- Un devuelto tiene una sola salida, y va por resolver_devolucion.
  IF v_r.estado = 'devuelto' THEN
    RAISE EXCEPTION 'una devolución se resuelve con resolver_devolucion'
      USING ERRCODE = 'P0001', HINT = 'devolucion_por_resolver';
  END IF;
  IF v_r.estado <> 'pendiente_procesar' THEN
    RAISE EXCEPTION 'solo se cobra a mano un recibo pendiente (este está en %)', v_r.estado
      USING ERRCODE = 'P0001', HINT = 'no_cobrable_manual';
  END IF;

  -- El único sitio que cobra a mano un pendiente sin cheque (recibos_dinero_solo_por_funcion).
  PERFORM set_config('app.marcar_cobrado_manual', p_recibo_id::text, true);
  UPDATE public.recibos
     SET estado = 'cobrado_manual', cobro_forma = p_forma, cobro_fecha = p_fecha, cobro_nota = v_nota
   WHERE id = p_recibo_id;
  PERFORM set_config('app.marcar_cobrado_manual', '', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.marcar_cobrado_manual(uuid, public.metodo_pago, date, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.marcar_cobrado_manual(uuid, public.metodo_pago, date, text) TO authenticated;

COMMENT ON FUNCTION public.marcar_cobrado_manual(uuid, public.metodo_pago, date, text) IS
  'C: un recibo pendiente que no es SEPA queda cobrado en efectivo o por transferencia, con la fecha (no futura) y una nota opcional. De invocador, es_admin.';

-- ---- 3. Confirmar, desconfirmar y el esporádico, con su marcador ----
-- Iguales que las vivas, salvo el marcador alrededor de su escritura del estado.
CREATE OR REPLACE FUNCTION public.confirmar_recibo(p_recibo_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_borradores integer;
BEGIN
  SELECT centro_id, anio, mes, estado, es_esporadico, devuelto_de_recibo_id, deleted_at
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

CREATE OR REPLACE FUNCTION public.desconfirmar_recibo(p_recibo_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
  SELECT centro_id, anio, mes, estado, es_esporadico, devuelto_de_recibo_id, deleted_at
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

  -- Idempotente: ya es borrador. No se re-abre el mes (si está cerrado con un borrador
  -- dentro, el desajuste no lo ha creado esta llamada y no es asunto suyo arreglarlo).
  IF r.estado = 'borrador' THEN
    RETURN false;
  END IF;

  IF r.estado <> 'pendiente_procesar' THEN
    RAISE EXCEPTION 'recibo en el circuito de cobro (%): ya no vuelve a borrador', r.estado
      USING ERRCODE = 'P0001';
  END IF;

  IF public.recibo_en_remesa(p_recibo_id) THEN
    RAISE EXCEPTION 'recibo en remesa: no se puede modificar' USING ERRCODE = 'P0001';
  END IF;

  -- El único sitio que lo devuelve a borrador (recibos_dinero_solo_por_funcion, 20261223120000).
  PERFORM set_config('app.desconfirmar_recibo', p_recibo_id::text, true);
  UPDATE public.recibos SET estado = 'borrador' WHERE id = p_recibo_id;
  PERFORM set_config('app.desconfirmar_recibo', '', true);

  -- Retirar el ancla del cierre: con este borrador dentro, el mes ya no está "íntegramente
  -- procesado". Sin esto el panel seguiría bloqueado y "Modificar" no serviría de nada.
  DELETE FROM public.cierre_mensual
    WHERE centro_id = r.centro_id AND anio = r.anio AND mes = r.mes;

  RETURN FOUND;
END $function$;

CREATE OR REPLACE FUNCTION public.crear_recibo_esporadico(p_centro_id uuid, p_familia_id uuid, p_nino_id uuid, p_anio integer, p_mes integer, p_concepto text, p_metodo text, p_lineas jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_recibo_id uuid;
  v_metodo public.metodo_pago;
  r_linea jsonb;
  v_desc text;
  v_cant integer;
  v_unit integer;
  v_linea_nino uuid;
  v_total integer := 0;
BEGIN
  IF NOT public.es_admin(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_anio < 2024 OR p_anio > 2100 OR p_mes < 1 OR p_mes > 12 THEN
    RAISE EXCEPTION 'periodo invalido' USING ERRCODE = '22023';
  END IF;
  IF privado.centro_de_familia(p_familia_id) IS DISTINCT FROM p_centro_id THEN
    RAISE EXCEPTION 'familia fuera del centro' USING ERRCODE = '42501';
  END IF;
  IF p_nino_id IS NOT NULL AND public.familia_de_nino(p_nino_id) IS DISTINCT FROM p_familia_id THEN
    RAISE EXCEPTION 'nino fuera de la familia' USING ERRCODE = '42501';
  END IF;
  IF p_concepto IS NULL OR char_length(p_concepto) < 1 OR char_length(p_concepto) > 200 THEN
    RAISE EXCEPTION 'concepto invalido' USING ERRCODE = '22023';
  END IF;
  IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) < 1 THEN
    RAISE EXCEPTION 'sin lineas' USING ERRCODE = '22023';
  END IF;

  v_metodo := CASE WHEN p_metodo IS NULL OR p_metodo = '' THEN NULL ELSE p_metodo::public.metodo_pago END;

  -- El único sitio que crea un recibo ya en pendiente, con el re-giro de resolver_devolucion
  -- (recibos_dinero_solo_por_funcion, 20261223120000): el id antes, para el marcador.
  v_recibo_id := gen_random_uuid();
  PERFORM set_config('app.crear_recibo_esporadico', v_recibo_id::text, true);
  INSERT INTO public.recibos
    (id, centro_id, familia_id, nino_id, anio, mes, metodo, estado, total_centimos, es_esporadico, concepto_esporadico)
    VALUES (v_recibo_id, p_centro_id, p_familia_id, p_nino_id, p_anio, p_mes, v_metodo,
            'pendiente_procesar', 0, true, p_concepto);
  PERFORM set_config('app.crear_recibo_esporadico', '', true);

  FOR r_linea IN SELECT * FROM jsonb_array_elements(p_lineas)
  LOOP
    v_desc := COALESCE(r_linea->>'descripcion', '');
    v_cant := COALESCE((r_linea->>'cantidad')::integer, 0);
    v_unit := COALESCE((r_linea->>'precio_unitario_centimos')::integer, 0);
    v_linea_nino := COALESCE((r_linea->>'nino_id')::uuid, p_nino_id);
    IF v_linea_nino IS NOT NULL AND public.familia_de_nino(v_linea_nino) IS DISTINCT FROM p_familia_id THEN
      RAISE EXCEPTION 'linea con nino fuera de la familia' USING ERRCODE = '42501';
    END IF;
    IF char_length(v_desc) < 1 OR char_length(v_desc) > 200 THEN
      RAISE EXCEPTION 'descripcion de linea invalida' USING ERRCODE = '22023';
    END IF;
    IF v_cant < 1 THEN
      RAISE EXCEPTION 'cantidad de linea invalida' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.lineas_recibo
      (recibo_id, concepto_id, nino_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos)
      VALUES (v_recibo_id, NULL, v_linea_nino, v_desc, v_cant, v_unit, v_cant * v_unit);
    v_total := v_total + v_cant * v_unit;
  END LOOP;

  UPDATE public.recibos SET total_centimos = v_total WHERE id = v_recibo_id;
  RETURN v_recibo_id;
END $function$;

-- ---- 4. El trigger, ampliado ----
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
  -- B. Salir de un hecho de dinero: de cobrado_manual, nunca; de enviado_banco, solo a devuelto.
  IF OLD.estado = 'cobrado_manual'
     OR (OLD.estado = 'enviado_banco' AND NEW.estado <> 'devuelto') THEN
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

-- CREATE OR REPLACE conserva los privilegios (REVOKE de 20261222120000) y el trigger.

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_fn  text;
  v_pat text;
  v_src text;
BEGIN
  IF (SELECT count(*) FROM pg_trigger t
       WHERE t.tgrelid = 'public.recibos'::regclass AND t.tgname = 'recibos_dinero_solo_por_funcion'
         AND NOT t.tgisinternal AND t.tgenabled = 'O'
         AND pg_get_triggerdef(t.oid) LIKE '%BEFORE INSERT OR UPDATE OF estado ON public.recibos FOR EACH ROW%') <> 1 THEN
    RAISE EXCEPTION 'falta el trigger recibos_dinero_solo_por_funcion';
  END IF;
  -- Cada función pone su marcador alrededor de su escritura, y el trigger mira los cinco.
  FOR v_fn, v_pat IN VALUES
    ('public.marcar_recibo_devuelto(uuid,date,integer)',
     'set_config\(''app\.marcar_recibo_devuelto'', p_recibo_id::text, true\);\s*UPDATE public\.recibos\s+SET estado = ''devuelto''[^;]*;\s*PERFORM set_config\(''app\.marcar_recibo_devuelto'', '''', true\);'),
    ('public.marcar_cobrado_manual(uuid,public.metodo_pago,date,text)',
     'set_config\(''app\.marcar_cobrado_manual'', p_recibo_id::text, true\);\s*UPDATE public\.recibos\s+SET estado = ''cobrado_manual''[^;]*;\s*PERFORM set_config\(''app\.marcar_cobrado_manual'', '''', true\);'),
    ('public.confirmar_recibo(uuid)',
     'set_config\(''app\.confirmar_recibo'', p_recibo_id::text, true\);\s*UPDATE public\.recibos SET estado = ''pendiente_procesar'' WHERE id = p_recibo_id;\s*PERFORM set_config\(''app\.confirmar_recibo'', '''', true\);'),
    ('public.desconfirmar_recibo(uuid)',
     'set_config\(''app\.desconfirmar_recibo'', p_recibo_id::text, true\);\s*UPDATE public\.recibos SET estado = ''borrador'' WHERE id = p_recibo_id;\s*PERFORM set_config\(''app\.desconfirmar_recibo'', '''', true\);'),
    ('public.crear_recibo_esporadico(uuid,uuid,uuid,integer,integer,text,text,jsonb)',
     'v_recibo_id := gen_random_uuid\(\);\s*PERFORM set_config\(''app\.crear_recibo_esporadico'', v_recibo_id::text, true\);\s*INSERT INTO public\.recibos[^;]*;\s*PERFORM set_config\(''app\.crear_recibo_esporadico'', '''', true\);'),
    ('public.recibos_dinero_solo_por_funcion()',
     'app\.marcar_recibo_enviado.*app\.marcar_recibo_devuelto.*app\.marcar_cobrado_manual.*app\.cobro_cheque.*app\.resolver_devolucion.*app\.confirmar_recibo.*app\.desconfirmar_recibo')
  LOOP
    SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v_src FROM pg_proc WHERE oid = v_fn::regprocedure;
    IF v_src IS NULL OR v_src !~ v_pat THEN
      RAISE EXCEPTION '% no pone o no mira su marcador como este fichero', v_fn;
    END IF;
  END LOOP;
  -- Las dos de C, de invocador y solo para las sesiones; el trigger, de invocador y sin RPC.
  IF (SELECT bool_or(prosecdef) FROM pg_proc WHERE oid IN
        ('public.marcar_recibo_devuelto(uuid,date,integer)'::regprocedure,
         'public.marcar_cobrado_manual(uuid,public.metodo_pago,date,text)'::regprocedure,
         'public.recibos_dinero_solo_por_funcion()'::regprocedure))
     OR (SELECT bool_or(has_function_privilege(r, f, 'EXECUTE'))
           FROM unnest(ARRAY['public', 'anon', 'service_role']) r,
                unnest(ARRAY['public.marcar_recibo_devuelto(uuid,date,integer)',
                             'public.marcar_cobrado_manual(uuid,public.metodo_pago,date,text)']) f)
     OR NOT has_function_privilege('authenticated', 'public.marcar_recibo_devuelto(uuid,date,integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.marcar_cobrado_manual(uuid,public.metodo_pago,date,text)', 'EXECUTE')
     OR (SELECT bool_or(has_function_privilege(r, 'public.recibos_dinero_solo_por_funcion()', 'EXECUTE'))
           FROM unnest(ARRAY['public', 'anon', 'authenticated']) r) THEN
    RAISE EXCEPTION 'las funciones de C son de invocador y solo de authenticated; el trigger no se ejecuta por RPC';
  END IF;
  -- Las de D siguen siendo SECURITY DEFINER, con su search_path.
  IF NOT (SELECT bool_and(prosecdef AND proconfig = ARRAY['search_path=public']) FROM pg_proc WHERE oid IN
        ('public.confirmar_recibo(uuid)'::regprocedure, 'public.desconfirmar_recibo(uuid)'::regprocedure,
         'public.crear_recibo_esporadico(uuid,uuid,uuid,integer,integer,text,text,jsonb)'::regprocedure)) THEN
    RAISE EXCEPTION 'confirmar, desconfirmar o crear_recibo_esporadico perdieron SECURITY DEFINER';
  END IF;
  RAISE NOTICE 'guarda posterior: devuelto y cobrado por función; confirmar, desconfirmar y nacer en pendiente, solo por las suyas';
END
$guarda$;
