-- =============================================================================
-- Fase 12-B-4 — Motor de cierre + recibos · esquema (doble precio + servicio +
-- ajuste de método) + trigger de congelado + RPC de cierre e idempotencia.
-- =============================================================================
-- ADITIVA salvo: (a) parte el precio único de conceptos_cobro en dos columnas,
-- (b) quita 'cheque_guarderia' del ENUM metodo_pago (pasa a ser un tipo_beca =
-- descuento), (c) hace recibos.metodo NULLABLE. No hay datos reales (pre-piloto).
--
-- ORDEN DE DEPENDENCIAS (verificado): los tipos servicio_diario / metodo_pago y
-- todas las tablas (conceptos_cobro, metodo_pago_familia, recibos, lineas_recibo,
-- parte_servicio_diario, cierre_mensual, asignacion_cuota, becas, tipos_beca,
-- ninos, matriculas) ya existen desde B-0/F2. Secuencia: (1) doble precio +
-- servicio en conceptos_cobro → (2) swap del ENUM metodo_pago + recibos.metodo
-- nullable → (3) helper mes_cerrado → (4) trigger de congelado (usa centro_de_nino
-- [G-0] + mes_cerrado) → (5) RPC cerrar_mes_cobros → (6) RPC crear_recibo_esporadico.
-- Las funciones plpgsql difieren la validación de su cuerpo; las columnas/tipos que
-- referencian existen igualmente cuando se crean.
--
-- DECISIONES (cerradas por el responsable, 2026-06-30):
--  1. conceptos_cobro.servicio (servicio_diario): qué servicio del parte factura un
--     concepto DIARIO (obligatorio en diario; NULL en mensual/esporadico). Sin él el
--     motor no sabe qué días de parte_servicio_diario contar.
--  2. Precio en DOS columnas: precio_mensual_centimos / precio_diario_centimos.
--     Esporádico reusa precio_mensual_centimos como su precio único.
--  3. Motor = RPC plpgsql cerrar_mes_cobros (SECURITY DEFINER, chequea es_admin),
--     atómica + idempotente; la invoca una server action fina.
--  4. recibo solo si ≥1 línea (solo-beca / saldo negativo SÍ se crea); días=0 → sin
--     línea; beca activa = su rango solapa el mes; el congelado bloquea el parte y los
--     recibos REGULARES del periodo, exentos esporádicos y devoluciones.
--  5. MÉTODO: la directora marca explícitamente el giro. Sin metodo_pago_familia →
--     recibo.metodo NULL, estado pendiente_procesar, fuera de remesa (recibos.metodo
--     pasa a NULLABLE). Nada de default inteligente.
--  6. cheque_guarderia NO es método: es un descuento → se modela como tipo_beca (línea
--     negativa). Se elimina del ENUM metodo_pago (sin datos reales).
-- =============================================================================
BEGIN;

-- ─── 1. conceptos_cobro: doble precio (mensual/diario) + servicio ─────────────
ALTER TABLE public.conceptos_cobro ADD COLUMN precio_mensual_centimos integer;
ALTER TABLE public.conceptos_cobro ADD COLUMN precio_diario_centimos  integer;
ALTER TABLE public.conceptos_cobro ADD COLUMN servicio public.servicio_diario;

-- Migra el precio único actual a precio_mensual (no hay datos reales).
UPDATE public.conceptos_cobro SET precio_mensual_centimos = precio_centimos;

-- Filas de test de tipo 'diario' se normalizan a 'mensual' para satisfacer el nuevo
-- CHECK (no hay datos reales; mapeo conservador a mensual indicado por el responsable).
UPDATE public.conceptos_cobro SET tipo_concepto = 'mensual' WHERE tipo_concepto = 'diario';

-- Elimina el precio único (su CHECK conceptos_cobro_precio_no_negativo cae con la columna).
ALTER TABLE public.conceptos_cobro DROP COLUMN precio_centimos;

ALTER TABLE public.conceptos_cobro ADD CONSTRAINT conceptos_cobro_precios_no_negativos CHECK (
  (precio_mensual_centimos IS NULL OR precio_mensual_centimos >= 0) AND
  (precio_diario_centimos  IS NULL OR precio_diario_centimos  >= 0)
);

-- Coherencia precio/servicio por tipo:
--  mensual    → precio_mensual NOT NULL; sin precio_diario; sin servicio.
--  diario     → precio_diario NOT NULL y servicio NOT NULL; precio_mensual opcional
--               (solo se usa si el niño se asigna en modalidad mensual ese mes).
--  esporadico → precio_mensual NOT NULL (precio único reutilizado); sin diario; sin servicio.
ALTER TABLE public.conceptos_cobro ADD CONSTRAINT conceptos_cobro_precio_por_tipo CHECK (
  (tipo_concepto = 'mensual'    AND precio_mensual_centimos IS NOT NULL AND precio_diario_centimos IS NULL AND servicio IS NULL) OR
  (tipo_concepto = 'diario'     AND precio_diario_centimos  IS NOT NULL AND servicio IS NOT NULL) OR
  (tipo_concepto = 'esporadico' AND precio_mensual_centimos IS NOT NULL AND precio_diario_centimos IS NULL AND servicio IS NULL)
);

COMMENT ON COLUMN public.conceptos_cobro.precio_mensual_centimos IS
  'Precio por mes / unidad. Lo usan los conceptos mensual y esporadico, y un diario si el niño se asigna en modalidad mensual ese mes.';
COMMENT ON COLUMN public.conceptos_cobro.precio_diario_centimos IS
  'Precio por día (× días marcados presente en parte_servicio_diario). Solo conceptos diario en modalidad diaria.';
COMMENT ON COLUMN public.conceptos_cobro.servicio IS
  'F12-B-4: servicio del parte (comedor/matinera/vespertina) que factura un concepto DIARIO. Obligatorio en diario, NULL en mensual/esporadico.';

-- ─── 2. metodo_pago: cheque_guarderia deja de ser método (es un descuento =
-- tipo_beca). Se elimina del ENUM. recibos.metodo pasa a NULLABLE (decisión 5). ──
UPDATE public.metodo_pago_familia SET metodo = 'efectivo' WHERE metodo = 'cheque_guarderia';

ALTER TYPE public.metodo_pago RENAME TO metodo_pago_old;
CREATE TYPE public.metodo_pago AS ENUM ('sepa', 'efectivo', 'transferencia');
ALTER TABLE public.metodo_pago_familia
  ALTER COLUMN metodo TYPE public.metodo_pago USING metodo::text::public.metodo_pago;
ALTER TABLE public.recibos ALTER COLUMN metodo DROP NOT NULL;
ALTER TABLE public.recibos
  ALTER COLUMN metodo TYPE public.metodo_pago USING metodo::text::public.metodo_pago;
DROP TYPE public.metodo_pago_old;

COMMENT ON COLUMN public.recibos.metodo IS
  'Método de giro CONGELADO al cerrar. NULL = la directora aún no lo ha marcado → recibo pendiente_procesar fuera de remesa hasta que lo marque (decisión 5). Solo sepa entra al XML pain.008.';

-- ─── 3. Helper: ¿el (centro, anio, mes) ya está cerrado? ──────────────────────
CREATE OR REPLACE FUNCTION public.mes_cerrado(p_centro_id uuid, p_anio integer, p_mes integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cierre_mensual
    WHERE centro_id = p_centro_id AND anio = p_anio AND mes = p_mes
  );
$$;
GRANT EXECUTE ON FUNCTION public.mes_cerrado(uuid, integer, integer) TO authenticated;

-- ─── 4. Trigger de congelado (decisión F + requisito de B-4): con cierre_mensual del
-- periodo se bloquea modificar el parte y los recibos/líneas REGULARES de ese mes.
-- Exentos: recibos esporádicos y devoluciones (las correcciones van por ahí). Patrón
-- bloquea_texto_tras_firma de F8. Deriva centro/periodo de la propia fila → no depende
-- del orden de los otros triggers BEFORE. ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.congelar_si_mes_cerrado()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_centro uuid;
  v_anio integer;
  v_mes integer;
  r_recibo record;
BEGIN
  IF TG_TABLE_NAME = 'parte_servicio_diario' THEN
    v_centro := public.centro_de_nino(COALESCE(NEW.nino_id, OLD.nino_id));
    v_anio := EXTRACT(YEAR  FROM COALESCE(NEW.fecha, OLD.fecha))::integer;
    v_mes  := EXTRACT(MONTH FROM COALESCE(NEW.fecha, OLD.fecha))::integer;
    IF public.mes_cerrado(v_centro, v_anio, v_mes) THEN
      RAISE EXCEPTION 'mes cerrado: el parte de servicio de % no es editable',
        to_char(COALESCE(NEW.fecha, OLD.fecha), 'YYYY-MM') USING ERRCODE = 'P0001';
    END IF;

  ELSIF TG_TABLE_NAME = 'recibos' THEN
    -- Solo recibos REGULARES (no esporádicos, no devoluciones).
    IF COALESCE(NEW.es_esporadico, OLD.es_esporadico) = false
       AND COALESCE(NEW.devuelto_de_recibo_id, OLD.devuelto_de_recibo_id) IS NULL THEN
      v_centro := public.centro_de_nino(COALESCE(NEW.nino_id, OLD.nino_id));
      v_anio := COALESCE(NEW.anio, OLD.anio);
      v_mes  := COALESCE(NEW.mes, OLD.mes);
      IF public.mes_cerrado(v_centro, v_anio, v_mes) THEN
        RAISE EXCEPTION 'mes cerrado: el recibo regular de % no es editable',
          to_char(make_date(v_anio, v_mes, 1), 'YYYY-MM') USING ERRCODE = 'P0001';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'lineas_recibo' THEN
    SELECT centro_id, anio, mes, es_esporadico, devuelto_de_recibo_id
      INTO r_recibo
      FROM public.recibos WHERE id = COALESCE(NEW.recibo_id, OLD.recibo_id);
    IF FOUND AND r_recibo.es_esporadico = false AND r_recibo.devuelto_de_recibo_id IS NULL THEN
      IF public.mes_cerrado(r_recibo.centro_id, r_recibo.anio, r_recibo.mes) THEN
        RAISE EXCEPTION 'mes cerrado: las líneas del recibo regular de % no son editables',
          to_char(make_date(r_recibo.anio, r_recibo.mes, 1), 'YYYY-MM') USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER parte_servicio_diario_congelar
  BEFORE INSERT OR UPDATE OR DELETE ON public.parte_servicio_diario
  FOR EACH ROW EXECUTE FUNCTION public.congelar_si_mes_cerrado();
CREATE TRIGGER recibos_congelar
  BEFORE INSERT OR UPDATE OR DELETE ON public.recibos
  FOR EACH ROW EXECUTE FUNCTION public.congelar_si_mes_cerrado();
CREATE TRIGGER lineas_recibo_congelar
  BEFORE INSERT OR UPDATE OR DELETE ON public.lineas_recibo
  FOR EACH ROW EXECUTE FUNCTION public.congelar_si_mes_cerrado();

-- ─── 5. Motor de cierre: RPC atómica e idempotente (decisión 3) ───────────────
-- Inserta cierre_mensual AL FINAL: durante el cálculo el mes aún no está cerrado, así
-- los inserts/updates de recibos/líneas pasan el trigger de congelado; tras el cierre,
-- todo queda inmutable. Una segunda llamada al mismo mes es no-op (idempotente).
-- SECURITY DEFINER ⇒ bypassa RLS, pero comprueba es_admin explícitamente.
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

    -- 5a. Cuotas por asignación (mensual o diario), precio CONGELADO.
    FOR r_asig IN
      SELECT a.concepto_id, a.modalidad, c.nombre,
             c.precio_mensual_centimos, c.precio_diario_centimos, c.servicio
      FROM public.asignacion_cuota a
      JOIN public.conceptos_cobro c ON c.id = a.concepto_id
      WHERE a.nino_id = r_nino.nino_id AND a.anio = p_anio AND a.mes = p_mes AND a.deleted_at IS NULL
    LOOP
      IF r_asig.modalidad = 'mensual' THEN
        IF r_asig.precio_mensual_centimos IS NOT NULL THEN
          INSERT INTO public.lineas_recibo
            (recibo_id, concepto_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos)
            VALUES (v_recibo_id, r_asig.concepto_id, r_asig.nombre, 1,
                    r_asig.precio_mensual_centimos, r_asig.precio_mensual_centimos);
        END IF;
      ELSIF r_asig.modalidad = 'diario' THEN
        IF r_asig.precio_diario_centimos IS NOT NULL AND r_asig.servicio IS NOT NULL THEN
          SELECT count(*) INTO v_dias FROM public.parte_servicio_diario p
            WHERE p.nino_id = r_nino.nino_id AND p.servicio = r_asig.servicio
              AND p.presente = true AND p.fecha BETWEEN v_first AND v_last;
          IF v_dias >= 1 THEN
            INSERT INTO public.lineas_recibo
              (recibo_id, concepto_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos)
              VALUES (v_recibo_id, r_asig.concepto_id,
                      r_asig.nombre || ' (' || v_dias || ' días)', v_dias,
                      r_asig.precio_diario_centimos, v_dias * r_asig.precio_diario_centimos);
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

-- ─── 6. Recibo esporádico manual (uniforme, excursión…), fuera del cierre.
-- es_esporadico ⇒ exento del congelado: se puede crear aunque el mes esté cerrado.
-- p_lineas: jsonb array de { descripcion, cantidad, precio_unitario_centimos }. ──
CREATE OR REPLACE FUNCTION public.crear_recibo_esporadico(
  p_centro_id uuid, p_nino_id uuid, p_anio integer, p_mes integer,
  p_concepto text, p_metodo text, p_lineas jsonb
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_recibo_id uuid;
  v_metodo public.metodo_pago;
  r_linea jsonb;
  v_desc text;
  v_cant integer;
  v_unit integer;
  v_total integer := 0;
BEGIN
  IF NOT public.es_admin(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_anio < 2024 OR p_anio > 2100 OR p_mes < 1 OR p_mes > 12 THEN
    RAISE EXCEPTION 'periodo invalido' USING ERRCODE = '22023';
  END IF;
  IF public.centro_de_nino(p_nino_id) IS DISTINCT FROM p_centro_id THEN
    RAISE EXCEPTION 'nino fuera del centro' USING ERRCODE = '42501';
  END IF;
  IF p_concepto IS NULL OR char_length(p_concepto) < 1 OR char_length(p_concepto) > 200 THEN
    RAISE EXCEPTION 'concepto invalido' USING ERRCODE = '22023';
  END IF;
  IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) < 1 THEN
    RAISE EXCEPTION 'sin lineas' USING ERRCODE = '22023';
  END IF;

  v_metodo := CASE WHEN p_metodo IS NULL OR p_metodo = '' THEN NULL ELSE p_metodo::public.metodo_pago END;

  INSERT INTO public.recibos
    (centro_id, nino_id, anio, mes, metodo, estado, total_centimos, es_esporadico, concepto_esporadico)
    VALUES (p_centro_id, p_nino_id, p_anio, p_mes, v_metodo, 'pendiente_procesar', 0, true, p_concepto)
    RETURNING id INTO v_recibo_id;

  FOR r_linea IN SELECT * FROM jsonb_array_elements(p_lineas)
  LOOP
    v_desc := COALESCE(r_linea->>'descripcion', '');
    v_cant := COALESCE((r_linea->>'cantidad')::integer, 0);
    v_unit := COALESCE((r_linea->>'precio_unitario_centimos')::integer, 0);
    IF char_length(v_desc) < 1 OR char_length(v_desc) > 200 THEN
      RAISE EXCEPTION 'descripcion de linea invalida' USING ERRCODE = '22023';
    END IF;
    IF v_cant < 1 THEN
      RAISE EXCEPTION 'cantidad de linea invalida' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.lineas_recibo
      (recibo_id, concepto_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos)
      VALUES (v_recibo_id, NULL, v_desc, v_cant, v_unit, v_cant * v_unit);
    v_total := v_total + v_cant * v_unit;
  END LOOP;

  UPDATE public.recibos SET total_centimos = v_total WHERE id = v_recibo_id;
  RETURN v_recibo_id;
END $$;
GRANT EXECUTE ON FUNCTION public.crear_recibo_esporadico(uuid, uuid, integer, integer, text, text, jsonb) TO authenticated;

COMMIT;
