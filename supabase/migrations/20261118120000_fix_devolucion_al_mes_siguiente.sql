-- =============================================================================
-- FIX — Recibos, PR-14 bis: la devolución va al recibo del MES SIGUIENTE, exista o no
-- -----------------------------------------------------------------------------
-- `20261117120000` llevaba la devolución al primer borrador de la familia de un mes posterior: si
-- noviembre no tenía recibo, saltaba a diciembre, y sin ningún borrador la salida no se ofrecía.
-- Decisión del responsable (2026-10-25): se pasa al mes siguiente, sin saltos. Si el niño se da de
-- baja la deuda sigue existiendo, y con el salto una familia que se va se quedaba sin recibo y la
-- deuda sin sitio.
--
--   · El mes de destino es el siguiente al del recibo devuelto (diciembre → enero del año
--     siguiente), también si cae en otro curso.
--   · La familia tiene recibo regular ese mes, en borrador: la línea entra en él (como antes).
--   · No tiene recibo ese mes: se crea, en borrador, con la línea. El método, como lo congela el
--     motor (PR-7): la excepción del mes si la hay, si no el de la ficha. Con el mandato SEPA
--     revocado se crea igual, y lo caza el aviso que ya existe al validar.
--   · Lo tiene ya validado o en remesa: se rechaza (P0001 `recibo_siguiente_cerrado`); no se crea
--     un segundo recibo del mismo mes. La directora elige otra salida o devuelve ese recibo a
--     borrador si está a tiempo.
--   · No tiene recibo y el mes ya está cerrado (`cierre_mensual`): se rechaza (P0001
--     `mes_siguiente_cerrado`). Un borrador en un mes cerrado no se podría validar desde el panel.
--   · El recibo creado lo reutiliza el motor al generar el mes (misma carcasa, R-2), y si la
--     familia ya no tiene niños activos el barrido final lo conserva porque tiene una línea manual.
--
-- Solo cambia la rama `siguiente_recibo` de `resolver_devolucion`; el resto de su texto es el de
-- `20261117120000` (md5 normalizado en la guarda previa). La línea, sus triggers, el CHECK y la
-- vuelta atrás al borrarla no cambian.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor, DESPUÉS de
-- `20261117120000`. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_firma text;
  v_md5 text;
  v_n integer;
  v_leido jsonb := jsonb_build_object(
    'public.resolver_devolucion(uuid,text,date,text)', '9f9bc1ae51b84136fb3fa8c6f496d73d',
    -- No se recrean, pero las cruza la salida nueva: tienen que ser las que se leyeron.
    'public.recibos_validar_devolucion()', 'c178a774f826391c05e4ce575e209c08',
    'public.lineas_recibo_validar_arrastre()', '47f4146a8e303faef259f0e1d5d88a8b',
    'public.lineas_recibo_reabrir_devolucion()', 'a4ec170dd7254f0de70abe5b28542b83',
    'public.congelar_si_mes_cerrado()', '2e4c101653c8456a89a04fed2e5245f6',
    'public.mes_cerrado(uuid,integer,integer)', 'd11fd48ea47d8ca2dfbf2617ba0186e8',
    'public.derivar_centro_id_de_recibo_familia()', '07913fae9fd9456bf26aa385698ab102',
    'public.generar_recibos_mes(uuid,integer,integer)', '18a92bc32a164c1689a3650ba10872ae',
    'public.es_admin(uuid)', 'da96f192cef9402cf0618ea2cbd82902',
    'public.hoy_madrid()', '6f6d1655f787361bfdc6638a484318cb');
BEGIN
  FOR v_firma IN SELECT jsonb_object_keys(v_leido) LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_firma);
    IF v_md5 IS DISTINCT FROM v_leido ->> v_firma THEN
      RAISE EXCEPTION '% no es la leída en producción: %', v_firma, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;
  -- «El recibo de la familia ese mes» es inequívoco: un regular por familia y mes.
  IF pg_get_indexdef(to_regclass('public.idx_recibos_regular_familia_unico'))
     IS DISTINCT FROM 'CREATE UNIQUE INDEX idx_recibos_regular_familia_unico ON public.recibos USING btree (familia_id, anio, mes) WHERE ((NOT es_esporadico) AND (devuelto_de_recibo_id IS NULL) AND (deleted_at IS NULL))' THEN
    RAISE EXCEPTION 'idx_recibos_regular_familia_unico no es el leído en producción';
  END IF;
  SELECT count(*) INTO v_n FROM public.recibos WHERE devolucion_salida = 'siguiente_recibo';
  RAISE NOTICE 'guarda previa: % devoluciones ya llevadas al siguiente recibo (no se tocan)', v_n;
END
$guarda$;

-- ---- resolver_devolucion: la cuarta salida, al mes siguiente ----
-- De invocador: lee y escribe con la sesión (RLS de Dirección; el actor de audit_log es quien
-- resuelve). Devuelve el id del recibo nuevo o tocado: el re-giro (banco) o el recibo del mes
-- siguiente (siguiente_recibo); NULL con efectivo o transferencia.
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
  v_anio integer;
  v_mes integer;
  v_estado public.estado_recibo;
  v_metodo public.metodo_pago;
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
    -- El mes siguiente al del devuelto, sin saltos. Su recibo regular, si lo tiene, solo si está en
    -- borrador; si no lo tiene, se crea, salvo con el mes ya cerrado.
    v_anio := v_r.anio + v_r.mes / 12;
    v_mes := v_r.mes % 12 + 1;
    SELECT r.id, r.estado INTO v_nuevo, v_estado FROM public.recibos r
     WHERE r.familia_id = v_r.familia_id AND r.anio = v_anio AND r.mes = v_mes
       AND NOT r.es_esporadico AND r.devuelto_de_recibo_id IS NULL AND r.deleted_at IS NULL
     FOR UPDATE;
    IF v_nuevo IS NOT NULL AND v_estado <> 'borrador' THEN
      RAISE EXCEPTION 'el recibo de la familia del mes siguiente ya está validado (%)', v_estado
        USING ERRCODE = 'P0001', HINT = 'recibo_siguiente_cerrado';
    END IF;
    IF v_nuevo IS NULL AND public.mes_cerrado(v_r.centro_id, v_anio, v_mes) THEN
      RAISE EXCEPTION 'el mes siguiente ya está cerrado y la familia no tiene recibo en él'
        USING ERRCODE = 'P0001', HINT = 'mes_siguiente_cerrado';
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
    IF v_nuevo IS NULL THEN
      -- La carcasa, como la crea el motor: método congelado, la excepción del mes si la hay; si
      -- no, el de la ficha de la familia (PR-7).
      SELECT mp.metodo INTO v_metodo FROM public.metodo_pago_familia mp
       WHERE mp.familia_id = v_r.familia_id AND mp.anio = v_anio AND mp.mes = v_mes
         AND mp.deleted_at IS NULL
       LIMIT 1;
      IF v_metodo IS NULL THEN
        SELECT f.metodo_pago INTO v_metodo FROM public.familias f WHERE f.id = v_r.familia_id;
      END IF;
      INSERT INTO public.recibos
        (centro_id, familia_id, nino_id, anio, mes, metodo, estado, total_centimos, es_esporadico)
        VALUES (v_r.centro_id, v_r.familia_id, NULL, v_anio, v_mes, v_metodo, 'borrador', 0, false)
        RETURNING id INTO v_nuevo;
    END IF;
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
  v_md5 text;
BEGIN
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.resolver_devolucion(uuid,text,date,text)');
  IF v_md5 IS DISTINCT FROM '9525d2274cf5ef22a57be44399cac567' THEN
    RAISE EXCEPTION 'resolver_devolucion no quedó como este fichero: %', coalesce(v_md5, 'falta');
  END IF;
  -- De invocador, solo para authenticated.
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.resolver_devolucion(uuid,text,date,text)'::regprocedure) THEN
    RAISE EXCEPTION 'resolver_devolucion no debe ser SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', 'public.resolver_devolucion(uuid,text,date,text)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('public', 'public.resolver_devolucion(uuid,text,date,text)'::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.resolver_devolucion(uuid,text,date,text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'resolver_devolucion: permisos distintos de los de este fichero';
  END IF;
  RAISE NOTICE 'guarda posterior: resolver_devolucion lleva la devolución al mes siguiente';
END
$guarda$;
