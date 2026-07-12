-- =============================================================================
-- F-4-0 · Reconciliar conceptos_cobro a un MODELO ÚNICO de valor
-- -----------------------------------------------------------------------------
-- PRERREQUISITO de esquema de F-4 (NO construye el motor de recibos familiar).
--
-- Hoy conceptos_cobro arrastra DOS modelos de valor solapados y mutuamente
-- excluyentes: el "vivo" (precio_mensual_centimos/precio_diario_centimos) y el
-- "genérico F-1" (signo/tipo_valor/porcentaje_bp/importe_centimos, inerte). El
-- CHECK conceptos_cobro_precio_por_tipo exige importe base a TODO concepto
-- ignorando tipo_valor → un porcentaje puro (p.ej. "−10% por hermano") NO era
-- insertable.
--
-- Esta migración deja UN modelo canónico (el genérico pasa a ser EL modelo):
--   · signo (+1 cobro / −1 descuento)
--   · tipo_valor ('fijo' → importe_centimos ; 'porcentaje' → porcentaje_bp)
--   · tipo_concepto (mensual/diario/esporadico = periodicidad; ENUM se mantiene)
--   · ambito (nino/familia) ; servicio (solo si diario)
--   · concepto_base_id → conceptos_cobro(id) : el concepto base de un descuento
--     PORCENTUAL (1:1); solo (y siempre) cuando signo=-1 AND tipo_valor='porcentaje'.
-- Se ELIMINAN precio_mensual_centimos/precio_diario_centimos (el importe fijo vive
-- SOLO en importe_centimos).
--
-- 0 filas en conceptos_cobro/aplicaciones_concepto (sin seed) → reconciliación
-- LIBRE, sin migración de datos. aplicaciones_concepto y becas NO se tocan.
--
-- Adapta el LECTOR CRÍTICO cerrar_mes_cobros (motor de cierre F12-B-4) al modelo
-- único: misma semántica de cálculo (mensual/esporadico → importe una vez;
-- diario → importe × días del parte), solo cambia DE DÓNDE lee el precio
-- (importe_centimos en vez de precio_*). NO añade descuentos/porcentaje/familia
-- (eso es F-4). asignacion_cuota se mantiene igual (no se migra a aplicaciones_concepto).
--
-- Aplicar por SQL Editor (rol postgres). NO por CLI. Regenerar database.ts DESPUÉS.
-- =============================================================================
BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Retirar los CHECK del modelo dual (nombrados) antes de tocar columnas. Los
--    tres referencian precio_mensual/diario; se sustituyen por un CHECK único.
-- -----------------------------------------------------------------------------
ALTER TABLE public.conceptos_cobro
  DROP CONSTRAINT IF EXISTS conceptos_cobro_precio_por_tipo,
  DROP CONSTRAINT IF EXISTS conceptos_cobro_valor_coherente,
  DROP CONSTRAINT IF EXISTS conceptos_cobro_precios_no_negativos;

-- -----------------------------------------------------------------------------
-- 2. Eliminar las columnas del modelo viejo (tabla vacía → sin pérdida de datos).
-- -----------------------------------------------------------------------------
ALTER TABLE public.conceptos_cobro
  DROP COLUMN IF EXISTS precio_mensual_centimos,
  DROP COLUMN IF EXISTS precio_diario_centimos;

-- -----------------------------------------------------------------------------
-- 3. Descuento porcentual → su concepto base (1:1). Self-FK; RESTRICT (no se
--    borra un concepto base mientras un descuento lo referencie).
-- -----------------------------------------------------------------------------
ALTER TABLE public.conceptos_cobro
  ADD COLUMN concepto_base_id uuid
    REFERENCES public.conceptos_cobro(id) ON DELETE RESTRICT;

-- -----------------------------------------------------------------------------
-- 4. CHECK único del modelo de valor. Tres invariantes AND:
--    (a) valor: fijo ⇒ importe_centimos ∧ ¬porcentaje_bp ; porcentaje ⇒ porcentaje_bp ∧ ¬importe.
--    (b) periodicidad: diario ⇒ servicio ; mensual/esporadico ⇒ sin servicio.
--    (c) base: concepto_base_id ⟺ (signo=-1 ∧ tipo_valor='porcentaje').
--        (un cobro, o un descuento fijo, NO llevan concepto base).
-- -----------------------------------------------------------------------------
ALTER TABLE public.conceptos_cobro
  ADD CONSTRAINT conceptos_cobro_modelo_valor CHECK (
    (
      (tipo_valor = 'fijo'       AND importe_centimos IS NOT NULL AND porcentaje_bp    IS NULL)
      OR
      (tipo_valor = 'porcentaje' AND porcentaje_bp    IS NOT NULL AND importe_centimos IS NULL)
    )
    AND (
      (tipo_concepto = 'diario'                  AND servicio IS NOT NULL)
      OR
      (tipo_concepto IN ('mensual', 'esporadico') AND servicio IS NULL)
    )
    AND (
      (concepto_base_id IS NOT NULL AND signo = -1 AND tipo_valor = 'porcentaje')
      OR
      (concepto_base_id IS NULL     AND NOT (signo = -1 AND tipo_valor = 'porcentaje'))
    )
  );

-- -----------------------------------------------------------------------------
-- 5. Motor de cierre (F12-B-4) adaptado al modelo único. IDÉNTICO al original
--    salvo la sección 5a: lee c.importe_centimos (no precio_mensual/diario). La
--    semántica se conserva: mensual → importe una vez; diario → importe × días
--    presentes del servicio en el parte. Sin descuentos/porcentaje/familia (F-4);
--    un concepto porcentual (importe_centimos NULL) simplemente no genera línea aquí.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cerrar_mes_cobros(p_centro_id uuid, p_anio integer, p_mes integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cierre_id uuid;
  v_prev_anio integer;
  v_prev_mes integer;
  v_first date;
  v_last date;
  r_nino record;
  r_asig record;
  r_beca record;
  v_recibo_id uuid;
  v_metodo public.metodo_pago;
  v_dias integer;
  v_saldo_prev integer;
  v_n_lineas integer;
BEGIN
  IF NOT public.es_admin(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_anio < 2024 OR p_anio > 2100 OR p_mes < 1 OR p_mes > 12 THEN
    RAISE EXCEPTION 'periodo invalido' USING ERRCODE = '22023';
  END IF;

  -- Idempotencia: si el mes ya está cerrado, no-op (devuelve el cierre existente).
  SELECT id INTO v_cierre_id FROM public.cierre_mensual
    WHERE centro_id = p_centro_id AND anio = p_anio AND mes = p_mes;
  IF FOUND THEN
    RETURN v_cierre_id;
  END IF;

  IF p_mes = 1 THEN v_prev_anio := p_anio - 1; v_prev_mes := 12;
  ELSE v_prev_anio := p_anio; v_prev_mes := p_mes - 1; END IF;

  v_first := make_date(p_anio, p_mes, 1);
  v_last  := (v_first + interval '1 month - 1 day')::date;

  FOR r_nino IN
    SELECT DISTINCT n.id AS nino_id
    FROM public.ninos n
    JOIN public.matriculas m ON m.nino_id = n.id
    WHERE n.centro_id = p_centro_id
      AND m.estado = 'activa'
      AND m.fecha_baja IS NULL
      AND m.deleted_at IS NULL
  LOOP
    -- Método congelado (NULL si la directora no lo marcó este mes).
    v_metodo := NULL;
    SELECT metodo INTO v_metodo FROM public.metodo_pago_familia
      WHERE nino_id = r_nino.nino_id AND anio = p_anio AND mes = p_mes AND deleted_at IS NULL
      LIMIT 1;

    INSERT INTO public.recibos
      (centro_id, nino_id, anio, mes, metodo, estado, total_centimos, es_esporadico)
      VALUES (p_centro_id, r_nino.nino_id, p_anio, p_mes, v_metodo, 'pendiente_procesar', 0, false)
      RETURNING id INTO v_recibo_id;

    -- 5a. Cuotas por asignación (mensual o diario), importe CONGELADO. Modelo único:
    --     el precio sale de conceptos_cobro.importe_centimos (fijo). Un concepto
    --     porcentual (importe_centimos NULL) no produce línea aquí (los descuentos
    --     porcentuales/familia los aplica F-4, no este motor).
    FOR r_asig IN
      SELECT a.concepto_id, a.modalidad, c.nombre,
             c.importe_centimos, c.servicio
      FROM public.asignacion_cuota a
      JOIN public.conceptos_cobro c ON c.id = a.concepto_id
      WHERE a.nino_id = r_nino.nino_id AND a.anio = p_anio AND a.mes = p_mes AND a.deleted_at IS NULL
    LOOP
      IF r_asig.modalidad = 'mensual' THEN
        IF r_asig.importe_centimos IS NOT NULL THEN
          INSERT INTO public.lineas_recibo
            (recibo_id, concepto_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos)
            VALUES (v_recibo_id, r_asig.concepto_id, r_asig.nombre, 1,
                    r_asig.importe_centimos, r_asig.importe_centimos);
        END IF;
      ELSIF r_asig.modalidad = 'diario' THEN
        IF r_asig.importe_centimos IS NOT NULL AND r_asig.servicio IS NOT NULL THEN
          SELECT count(*) INTO v_dias FROM public.parte_servicio_diario p
            WHERE p.nino_id = r_nino.nino_id AND p.servicio = r_asig.servicio
              AND p.presente = true AND p.fecha BETWEEN v_first AND v_last;
          IF v_dias >= 1 THEN
            INSERT INTO public.lineas_recibo
              (recibo_id, concepto_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos)
              VALUES (v_recibo_id, r_asig.concepto_id,
                      r_asig.nombre || ' (' || v_dias || ' días)', v_dias,
                      r_asig.importe_centimos, v_dias * r_asig.importe_centimos);
          END IF;
        END IF;
      END IF;
    END LOOP;

    -- 5b. Becas activas en el mes → líneas NEGATIVAS (restan del total).
    FOR r_beca IN
      SELECT b.importe_centimos, tb.nombre
      FROM public.becas b
      JOIN public.tipos_beca tb ON tb.id = b.tipo_beca_id
      WHERE b.nino_id = r_nino.nino_id AND b.deleted_at IS NULL
        AND b.fecha_desde <= v_last
        AND (b.fecha_hasta IS NULL OR b.fecha_hasta >= v_first)
    LOOP
      INSERT INTO public.lineas_recibo
        (recibo_id, concepto_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos)
        VALUES (v_recibo_id, NULL, 'Beca: ' || r_beca.nombre, 1,
                -r_beca.importe_centimos, -r_beca.importe_centimos);
    END LOOP;

    -- 5c. Saldo a favor arrastrado del mes anterior (recibo regular con total < 0).
    v_saldo_prev := NULL;
    SELECT total_centimos INTO v_saldo_prev FROM public.recibos
      WHERE nino_id = r_nino.nino_id AND anio = v_prev_anio AND mes = v_prev_mes
        AND es_esporadico = false AND devuelto_de_recibo_id IS NULL AND deleted_at IS NULL
      LIMIT 1;
    IF v_saldo_prev IS NOT NULL AND v_saldo_prev < 0 THEN
      INSERT INTO public.lineas_recibo
        (recibo_id, concepto_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos)
        VALUES (v_recibo_id, NULL, 'Saldo mes anterior', 1, v_saldo_prev, v_saldo_prev);
    END IF;

    -- 5d. recibo solo si ≥1 línea; si no, se descarta (no se cobra nada al niño).
    SELECT count(*) INTO v_n_lineas FROM public.lineas_recibo WHERE recibo_id = v_recibo_id;
    IF v_n_lineas = 0 THEN
      DELETE FROM public.recibos WHERE id = v_recibo_id;
    ELSE
      UPDATE public.recibos
        SET total_centimos = (
          SELECT COALESCE(sum(importe_centimos), 0) FROM public.lineas_recibo WHERE recibo_id = v_recibo_id
        )
        WHERE id = v_recibo_id;
    END IF;
  END LOOP;

  -- Ancla del cierre AL FINAL (idempotencia + arranca el congelado del periodo).
  INSERT INTO public.cierre_mensual (centro_id, anio, mes, cerrado_por)
    VALUES (p_centro_id, p_anio, p_mes, v_uid)
    RETURNING id INTO v_cierre_id;

  RETURN v_cierre_id;
END $$;
GRANT EXECUTE ON FUNCTION public.cerrar_mes_cobros(uuid, integer, integer) TO authenticated;

COMMIT;
