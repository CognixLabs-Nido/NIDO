-- =============================================================================
-- F-4-3 · MOTOR de recibos a grano FAMILIA
-- -----------------------------------------------------------------------------
-- Reescribe el cierre de cobros al modelo familiar (F-4-1) sobre la asignación
-- permanente (F-4-2) y el modelo de valor único (F-4-0). Piezas:
--   1. metodo_pago_familia → grano FAMILIA (deja de ser por-niño).
--   2. congelar_si_mes_cerrado → congelado POR ESTADO en recibos/líneas (el
--      recibo deja de ser editable al salir de 'borrador'); el parte sigue
--      congelándose POR MES cerrado.
--   3. generar_recibos_mes(centro,anio,mes): (re)genera BORRADORES familiares
--      (1 recibo por familia, líneas de todos los hijos). Re-ejecutable: respeta
--      los recibos ya CONFIRMADOS y regenera solo borradores/faltantes. Advisory
--      lock por (centro,mes).
--   4. confirmar_recibo(recibo_id): borrador→pendiente_procesar de UN recibo;
--      ancla cierre_mensual cuando NO queda ningún borrador regular del mes.
--   5. crear_recibo_esporadico → grano FAMILIA (p_familia_id obligatorio,
--      p_nino_id opcional; líneas con nino_id opcional).
--   · Se DROPEA el motor viejo cerrar_mes_cobros (grano niño, inerte tras F-4-1).
--
-- DECISIÓN R8 (confirmación POR RECIBO) — dónde se ancla cierre_mensual:
--   El "cierre del mes" NO es la generación ni la primera confirmación, sino el
--   momento en que TODOS los recibos regulares del mes han salido de borrador
--   (confirmar_recibo detecta que no quedan borradores → inserta cierre_mensual).
--   Se elige este punto (y NO "al generar el fichero del banco") porque no todos
--   los recibos van a SEPA (efectivo/cheque_guarderia/transferencia no generan
--   fichero); anclar en el banco dejaría meses no-SEPA sin cerrar nunca. El cierre
--   pasa a significar "mes íntegramente procesado" y bloquea el parte de ese mes.
--   Antes de ese punto, cada recibo se congela individualmente por su estado.
--
-- FUERA DE ALCANCE (no se inventa): la "beca comedor variable por días" NO está
--   modelada (becas es importe fijo mensual con rango de fechas). Queda pendiente
--   de una fase propia (beca ligada a servicio + tarifa/día, aplicada como el
--   cargo diario pero en negativo). El motor solo aplica becas fijas.
--
-- Aplicar por SQL Editor (rol postgres). NO por CLI. Regenerar database.ts DESPUÉS.
-- =============================================================================
BEGIN;

-- -----------------------------------------------------------------------------
-- 1. metodo_pago_familia → grano FAMILIA (R10). El método de pago es de la
--    FAMILIA, no del niño (el recibo es familiar). 0 datos reales → migración
--    libre; backfill defensivo por si hubiera fixtures.
-- -----------------------------------------------------------------------------
ALTER TABLE public.metodo_pago_familia
  ADD COLUMN familia_id uuid REFERENCES public.familias(id) ON DELETE CASCADE;

UPDATE public.metodo_pago_familia
  SET familia_id = public.familia_de_nino(nino_id)
  WHERE familia_id IS NULL AND nino_id IS NOT NULL;

ALTER TABLE public.metodo_pago_familia ALTER COLUMN familia_id SET NOT NULL;

-- Trigger de centro por FAMILIA (el viejo derivaba por nino_id, que desaparece).
CREATE OR REPLACE FUNCTION public.derivar_centro_id_de_familia()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.centro_id IS NULL THEN
    NEW.centro_id := public.centro_de_familia(NEW.familia_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER metodo_pago_familia_set_centro_id ON public.metodo_pago_familia;
CREATE TRIGGER metodo_pago_familia_set_centro_id
  BEFORE INSERT ON public.metodo_pago_familia
  FOR EACH ROW EXECUTE FUNCTION public.derivar_centro_id_de_familia();

DROP INDEX public.idx_metodo_pago_familia_unico;        -- (nino_id, anio, mes)
ALTER TABLE public.metodo_pago_familia DROP COLUMN nino_id;
CREATE UNIQUE INDEX idx_metodo_pago_familia_unico
  ON public.metodo_pago_familia (familia_id, anio, mes) WHERE deleted_at IS NULL;

COMMENT ON TABLE public.metodo_pago_familia IS
  'F-4-3: forma de pago (sepa|efectivo|cheque_guarderia|transferencia) por FAMILIA y mes. Un recibo familiar toma este método. Solo `sepa` entra al XML pain.008. Soft-delete.';

-- -----------------------------------------------------------------------------
-- 2. Congelado POR ESTADO (R8). Redefine congelar_si_mes_cerrado:
--    · parte_servicio_diario → por MES cerrado (igual que B-4/B-5).
--    · recibos REGULARES → por ESTADO: 'borrador' editable; al salir de borrador
--      queda inmutable salvo el avance de estado/fecha_envio_banco (ciclo cobro).
--      Arreglado el bug de centro_de_nino con nino_id NULL (ya no se re-deriva
--      centro aquí; el estado basta). familia_id añadido a inmutables.
--    · lineas_recibo → editable sii el recibo padre está en 'borrador'.
--    NO hay choque con el congelado por mes: recibos/líneas dejan de mirar el mes
--    (miran el estado); el parte sigue mirando el mes. Son tablas distintas.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.congelar_si_mes_cerrado()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_centro uuid;
  v_anio integer;
  v_mes integer;
  r_recibo record;
BEGIN
  -- Exención de service_role (backend de confianza, NUNCA expuesto al cliente): permite la
  -- limpieza/teardown, el CASCADE de borrado de centros y las correcciones server-side. El
  -- congelado protege frente a ediciones de ADMIN (authenticated), no frente al backend. El
  -- motor (SECURITY DEFINER llamado por admin) corre con auth.role()='authenticated' → NO se
  -- exime, pero solo toca borradores. auth.role() lee el claim del JWT (nivel request), no el
  -- rol de ejecución del DEFINER, así que distingue correctamente al llamante.
  IF auth.role() = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'parte_servicio_diario' THEN
    -- Congelado POR MES: el parte de un mes cerrado (cierre_mensual) es inmutable.
    v_centro := public.centro_de_nino(COALESCE(NEW.nino_id, OLD.nino_id));
    v_anio := EXTRACT(YEAR  FROM COALESCE(NEW.fecha, OLD.fecha))::integer;
    v_mes  := EXTRACT(MONTH FROM COALESCE(NEW.fecha, OLD.fecha))::integer;
    IF public.mes_cerrado(v_centro, v_anio, v_mes) THEN
      RAISE EXCEPTION 'mes cerrado: el parte de servicio de % no es editable',
        to_char(COALESCE(NEW.fecha, OLD.fecha), 'YYYY-MM') USING ERRCODE = 'P0001';
    END IF;

  ELSIF TG_TABLE_NAME = 'recibos' THEN
    -- Congelado POR ESTADO. Solo recibos REGULARES (esporádicos y devoluciones fuera).
    IF COALESCE(NEW.es_esporadico, OLD.es_esporadico) = false
       AND COALESCE(NEW.devuelto_de_recibo_id, OLD.devuelto_de_recibo_id) IS NULL THEN
      IF TG_OP = 'DELETE' THEN
        -- Solo se borra un borrador (regeneración). Un confirmado no se borra.
        IF OLD.estado <> 'borrador' THEN
          RAISE EXCEPTION 'recibo confirmado: % no se borra',
            to_char(make_date(OLD.anio, OLD.mes, 1), 'YYYY-MM') USING ERRCODE = 'P0001';
        END IF;
      ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.estado <> 'borrador' THEN
          -- Confirmado: inmutable salvo avance de estado/fecha de cobro; sin retroceso.
          IF NEW.estado = 'borrador' THEN
            RAISE EXCEPTION 'recibo confirmado: no puede volver a borrador'
              USING ERRCODE = 'P0001';
          END IF;
          IF NOT (
                NEW.total_centimos        IS NOT DISTINCT FROM OLD.total_centimos
            AND NEW.metodo                IS NOT DISTINCT FROM OLD.metodo
            AND NEW.familia_id            IS NOT DISTINCT FROM OLD.familia_id
            AND NEW.nino_id               IS NOT DISTINCT FROM OLD.nino_id
            AND NEW.anio                  IS NOT DISTINCT FROM OLD.anio
            AND NEW.mes                   IS NOT DISTINCT FROM OLD.mes
            AND NEW.es_esporadico         IS NOT DISTINCT FROM OLD.es_esporadico
            AND NEW.concepto_esporadico   IS NOT DISTINCT FROM OLD.concepto_esporadico
            AND NEW.devuelto_de_recibo_id IS NOT DISTINCT FROM OLD.devuelto_de_recibo_id
          ) THEN
            RAISE EXCEPTION 'recibo confirmado: inmutable salvo estado/fecha de cobro'
              USING ERRCODE = 'P0001';
          END IF;
        END IF;
        -- OLD.estado='borrador': edición libre, incluye la transición a pendiente_procesar.
      END IF;
      -- TG_OP='INSERT': permitido (el recibo regular nace en borrador).
    END IF;

  ELSIF TG_TABLE_NAME = 'lineas_recibo' THEN
    -- Congelado POR ESTADO del recibo padre.
    SELECT estado, es_esporadico, devuelto_de_recibo_id, anio, mes
      INTO r_recibo
      FROM public.recibos WHERE id = COALESCE(NEW.recibo_id, OLD.recibo_id);
    IF FOUND
       AND r_recibo.es_esporadico = false
       AND r_recibo.devuelto_de_recibo_id IS NULL
       AND r_recibo.estado <> 'borrador' THEN
      RAISE EXCEPTION 'recibo confirmado: las líneas de % no son editables',
        to_char(make_date(r_recibo.anio, r_recibo.mes, 1), 'YYYY-MM') USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;

-- -----------------------------------------------------------------------------
-- 3. generar_recibos_mes: (re)genera los BORRADORES familiares del mes.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generar_recibos_mes(p_centro_id uuid, p_anio integer, p_mes integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_first date;
  v_last  date;
  v_prev_anio integer;
  v_prev_mes  integer;
  r_fam  record;
  r_nino record;
  r_asig record;
  r_beca record;
  r_desc record;
  v_recibo uuid;
  v_metodo public.metodo_pago;
  v_unit integer;
  v_cant integer;
  v_dias integer;
  v_base integer;
  v_imp  integer;
  v_saldo integer;
  v_n integer;
  v_count integer := 0;
BEGIN
  IF NOT public.es_admin(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_anio < 2024 OR p_anio > 2100 OR p_mes < 1 OR p_mes > 12 THEN
    RAISE EXCEPTION 'periodo invalido' USING ERRCODE = '22023';
  END IF;
  -- Un mes CERRADO (todos confirmados) no se regenera; las altas tardías van por esporádico.
  IF public.mes_cerrado(p_centro_id, p_anio, p_mes) THEN
    RAISE EXCEPTION 'mes cerrado: no se regenera' USING ERRCODE = 'P0001';
  END IF;

  -- R13: serializa la (re)generación concurrente del mismo (centro, mes).
  PERFORM pg_advisory_xact_lock(
    hashtext('recibos:' || p_centro_id::text || ':' || p_anio::text || ':' || p_mes::text)::bigint);

  IF p_mes = 1 THEN v_prev_anio := p_anio - 1; v_prev_mes := 12;
  ELSE v_prev_anio := p_anio; v_prev_mes := p_mes - 1; END IF;
  v_first := make_date(p_anio, p_mes, 1);
  v_last  := (v_first + interval '1 month - 1 day')::date;

  -- RESET idempotente: borra SOLO borradores regulares del mes (respeta confirmados, R8).
  DELETE FROM public.recibos
    WHERE centro_id = p_centro_id AND anio = p_anio AND mes = p_mes
      AND NOT es_esporadico AND devuelto_de_recibo_id IS NULL
      AND deleted_at IS NULL AND estado = 'borrador';

  FOR r_fam IN
    SELECT DISTINCT n.familia_id
    FROM public.ninos n
    JOIN public.matriculas m ON m.nino_id = n.id
    WHERE n.centro_id = p_centro_id
      AND m.estado = 'activa' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
  LOOP
    -- Respeta un recibo regular ya existente (solo puede ser CONFIRMADO: los borradores
    -- se acaban de borrar). NUNCA se regenera un confirmado (R8).
    IF EXISTS (
      SELECT 1 FROM public.recibos
      WHERE familia_id = r_fam.familia_id AND anio = p_anio AND mes = p_mes
        AND NOT es_esporadico AND devuelto_de_recibo_id IS NULL AND deleted_at IS NULL
    ) THEN
      CONTINUE;
    END IF;

    -- Método CONGELADO de la FAMILIA (NULL si no se fijó → recibo sin método, fuera de remesa).
    v_metodo := NULL;
    SELECT metodo INTO v_metodo FROM public.metodo_pago_familia
      WHERE familia_id = r_fam.familia_id AND anio = p_anio AND mes = p_mes AND deleted_at IS NULL
      LIMIT 1;

    INSERT INTO public.recibos
      (centro_id, familia_id, nino_id, anio, mes, metodo, estado, total_centimos, es_esporadico)
      VALUES (p_centro_id, r_fam.familia_id, NULL, p_anio, p_mes, v_metodo, 'borrador', 0, false)
      RETURNING id INTO v_recibo;

    -- PASE 1 (cargos positivos) + PASE 2 (becas) por cada hijo activo.
    FOR r_nino IN
      SELECT n.id, n.nombre
      FROM public.ninos n
      JOIN public.matriculas m ON m.nino_id = n.id
      WHERE n.familia_id = r_fam.familia_id
        AND m.estado = 'activa' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
    LOOP
      -- PASE 1: asignaciones niño, signo=+1, fijo, vigentes en el mes (§4).
      FOR r_asig IN
        SELECT a.cantidad_default, a.importe_override_centimos,
               c.id AS concepto_id, c.nombre, c.tipo_concepto, c.importe_centimos, c.servicio
        FROM public.asignacion_concepto a
        JOIN public.conceptos_cobro c ON c.id = a.concepto_id
        WHERE a.nino_id = r_nino.id AND a.deleted_at IS NULL
          AND c.deleted_at IS NULL AND c.activo = true
          AND c.signo = 1 AND c.tipo_valor = 'fijo'
          AND (a.vigencia_desde IS NULL OR a.vigencia_desde <= v_last)
          AND (a.vigencia_hasta IS NULL OR a.vigencia_hasta >= v_first)
      LOOP
        v_unit := COALESCE(r_asig.importe_override_centimos, r_asig.importe_centimos);
        IF v_unit IS NULL THEN CONTINUE; END IF;

        IF r_asig.tipo_concepto = 'mensual' THEN
          v_cant := GREATEST(r_asig.cantidad_default, 1);          -- cantidad_default multiplica
          INSERT INTO public.lineas_recibo
            (recibo_id, concepto_id, nino_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos)
            VALUES (v_recibo, r_asig.concepto_id, r_nino.id,
              left(r_asig.nombre || ' · ' || r_nino.nombre, 200), v_cant, v_unit, v_unit * v_cant);

        ELSIF r_asig.tipo_concepto = 'diario' THEN
          IF r_asig.servicio IS NULL THEN CONTINUE; END IF;
          SELECT count(*) INTO v_dias FROM public.parte_servicio_diario p
            WHERE p.nino_id = r_nino.id AND p.servicio = r_asig.servicio
              AND p.presente = true AND p.fecha BETWEEN v_first AND v_last;
          IF v_dias >= 1 THEN
            -- cantidad_default IGNORADO en diario (R4): la cantidad son los días del parte.
            INSERT INTO public.lineas_recibo
              (recibo_id, concepto_id, nino_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos)
              VALUES (v_recibo, r_asig.concepto_id, r_nino.id,
                left(r_asig.nombre || ' · ' || r_nino.nombre || ' (' || v_dias || ' días)', 200),
                v_dias, v_unit, v_unit * v_dias);
          END IF;
        END IF;
        -- tipo_concepto='esporadico': fuera del motor recurrente.
      END LOOP;

      -- PASE 2: becas activas del niño → línea NEGATIVA (colgada del hijo).
      FOR r_beca IN
        SELECT b.importe_centimos, tb.nombre
        FROM public.becas b
        JOIN public.tipos_beca tb ON tb.id = b.tipo_beca_id
        WHERE b.nino_id = r_nino.id AND b.deleted_at IS NULL
          AND b.fecha_desde <= v_last AND (b.fecha_hasta IS NULL OR b.fecha_hasta >= v_first)
      LOOP
        INSERT INTO public.lineas_recibo
          (recibo_id, concepto_id, nino_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos)
          VALUES (v_recibo, NULL, r_nino.id,
            left('Beca: ' || r_beca.nombre || ' · ' || r_nino.nombre, 200), 1,
            -r_beca.importe_centimos, -r_beca.importe_centimos);
      END LOOP;
    END LOOP;

    -- PASE 3: DESCUENTOS (signo=-1), 2ª pasada sobre las líneas ya persistidas (§2, R1/R2/R3/R12).
    FOR r_desc IN
      SELECT a.nino_id AS asig_nino, a.importe_override_centimos,
             c.id AS concepto_id, c.nombre, c.ambito, c.tipo_valor,
             c.porcentaje_bp, c.importe_centimos, c.concepto_base_id
      FROM public.asignacion_concepto a
      JOIN public.conceptos_cobro c ON c.id = a.concepto_id
      WHERE c.signo = -1 AND c.activo = true AND c.deleted_at IS NULL AND a.deleted_at IS NULL
        AND (a.vigencia_desde IS NULL OR a.vigencia_desde <= v_last)
        AND (a.vigencia_hasta IS NULL OR a.vigencia_hasta >= v_first)
        AND (
          (c.ambito = 'familia' AND a.familia_id = r_fam.familia_id)
          OR (c.ambito = 'nino' AND a.nino_id IN (
                SELECT n.id FROM public.ninos n
                JOIN public.matriculas m ON m.nino_id = n.id
                WHERE n.familia_id = r_fam.familia_id
                  AND m.estado = 'activa' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL))
        )
    LOOP
      IF r_desc.ambito = 'nino' THEN
        -- R12: descuento individual del hijo asig_nino.
        IF r_desc.tipo_valor = 'fijo' THEN
          v_imp := -COALESCE(r_desc.importe_override_centimos, r_desc.importe_centimos);
          IF v_imp IS NOT NULL AND v_imp <> 0 THEN
            INSERT INTO public.lineas_recibo
              (recibo_id, concepto_id, nino_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos)
              VALUES (v_recibo, r_desc.concepto_id, r_desc.asig_nino,
                left(r_desc.nombre || ' · ' || (SELECT nombre FROM public.ninos WHERE id = r_desc.asig_nino), 200),
                1, v_imp, v_imp);
          END IF;
        ELSE  -- porcentaje sobre la base de ESE hijo
          SELECT COALESCE(SUM(importe_centimos), 0) INTO v_base FROM public.lineas_recibo
            WHERE recibo_id = v_recibo AND nino_id = r_desc.asig_nino
              AND concepto_id = r_desc.concepto_base_id;
          IF v_base > 0 THEN
            v_imp := (-ROUND(v_base * r_desc.porcentaje_bp / 10000.0))::integer;   -- R11 half-up
            IF v_imp <> 0 THEN
              INSERT INTO public.lineas_recibo
                (recibo_id, concepto_id, nino_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos)
                VALUES (v_recibo, r_desc.concepto_id, r_desc.asig_nino,
                  left(r_desc.nombre || ' · ' || (SELECT nombre FROM public.ninos WHERE id = r_desc.asig_nino), 200),
                  1, v_imp, v_imp);
            END IF;
          END IF;
        END IF;

      ELSE
        -- ambito='familia': DESCUENTO HERMANOS. "El que MÁS PAGA es el 1º (rk=1, sin
        -- descuento); los hermanos de cuota menor lo reciben." Empate → determinista por
        -- nino_id ASC (el total familiar es idéntico se elija a quién). R2: ranking por la
        -- base del concepto_base_id (porcentual) o por la suma de cargos positivos (fijo).
        IF r_desc.tipo_valor = 'porcentaje' THEN
          INSERT INTO public.lineas_recibo
            (recibo_id, concepto_id, nino_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos)
          SELECT v_recibo, r_desc.concepto_id, x.nino_id,
                 left(r_desc.nombre || ' · ' || x.nombre, 200), 1,
                 (-ROUND(x.base * r_desc.porcentaje_bp / 10000.0))::integer,
                 (-ROUND(x.base * r_desc.porcentaje_bp / 10000.0))::integer
          FROM (
            SELECT n.id AS nino_id, n.nombre,
                   COALESCE(SUM(l.importe_centimos) FILTER (WHERE l.concepto_id = r_desc.concepto_base_id), 0) AS base,
                   ROW_NUMBER() OVER (
                     ORDER BY COALESCE(SUM(l.importe_centimos) FILTER (WHERE l.concepto_id = r_desc.concepto_base_id), 0) DESC,
                              n.id ASC) AS rk
            FROM public.ninos n
            JOIN public.matriculas m ON m.nino_id = n.id
            LEFT JOIN public.lineas_recibo l ON l.recibo_id = v_recibo AND l.nino_id = n.id
            WHERE n.familia_id = r_fam.familia_id
              AND m.estado = 'activa' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
            GROUP BY n.id, n.nombre
          ) x
          WHERE x.rk > 1 AND x.base > 0
            AND (-ROUND(x.base * r_desc.porcentaje_bp / 10000.0))::integer <> 0;

        ELSE  -- fijo: R3 = por HERMANO ADICIONAL (una línea -importe por cada no-primero).
          v_unit := COALESCE(r_desc.importe_override_centimos, r_desc.importe_centimos);
          IF v_unit IS NOT NULL AND v_unit > 0 THEN
            INSERT INTO public.lineas_recibo
              (recibo_id, concepto_id, nino_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos)
            SELECT v_recibo, r_desc.concepto_id, x.nino_id,
                   left(r_desc.nombre || ' · ' || x.nombre, 200), 1, -v_unit, -v_unit
            FROM (
              SELECT n.id AS nino_id, n.nombre,
                     ROW_NUMBER() OVER (
                       ORDER BY COALESCE(SUM(l.importe_centimos) FILTER (WHERE l.importe_centimos > 0), 0) DESC,
                                n.id ASC) AS rk
              FROM public.ninos n
              JOIN public.matriculas m ON m.nino_id = n.id
              LEFT JOIN public.lineas_recibo l ON l.recibo_id = v_recibo AND l.nino_id = n.id
              WHERE n.familia_id = r_fam.familia_id
                AND m.estado = 'activa' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
              GROUP BY n.id, n.nombre
            ) x
            WHERE x.rk > 1;
          END IF;
        END IF;
      END IF;
    END LOOP;

    -- PASE 4: saldo a favor arrastrado del recibo FAMILIAR regular del mes anterior.
    v_saldo := NULL;
    SELECT total_centimos INTO v_saldo FROM public.recibos
      WHERE familia_id = r_fam.familia_id AND anio = v_prev_anio AND mes = v_prev_mes
        AND es_esporadico = false AND devuelto_de_recibo_id IS NULL AND deleted_at IS NULL
      LIMIT 1;
    IF v_saldo IS NOT NULL AND v_saldo < 0 THEN
      INSERT INTO public.lineas_recibo
        (recibo_id, concepto_id, nino_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos)
        VALUES (v_recibo, NULL, NULL, 'Saldo mes anterior', 1, v_saldo, v_saldo);  -- línea familiar
    END IF;

    -- Descarte si 0 líneas; si no, congelar total.
    SELECT count(*) INTO v_n FROM public.lineas_recibo WHERE recibo_id = v_recibo;
    IF v_n = 0 THEN
      DELETE FROM public.recibos WHERE id = v_recibo;
    ELSE
      UPDATE public.recibos
        SET total_centimos = (SELECT COALESCE(SUM(importe_centimos), 0) FROM public.lineas_recibo WHERE recibo_id = v_recibo)
        WHERE id = v_recibo;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END $$;
GRANT EXECUTE ON FUNCTION public.generar_recibos_mes(uuid, integer, integer) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. confirmar_recibo: confirma UN recibo (borrador→pendiente_procesar). Ancla
--    cierre_mensual cuando ya no queda ningún borrador regular del mes (R8).
--    Devuelve TRUE si el mes ha quedado cerrado con esta confirmación.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirmar_recibo(p_recibo_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  UPDATE public.recibos SET estado = 'pendiente_procesar' WHERE id = p_recibo_id;

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
END $$;
GRANT EXECUTE ON FUNCTION public.confirmar_recibo(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. crear_recibo_esporadico → grano FAMILIA (§6). Reemplaza la firma por-niño.
--    p_familia_id obligatorio; p_nino_id opcional (informativo); cada línea puede
--    llevar `nino_id` opcional para atribuirla a un hijo. Nace directo (no borrador).
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.crear_recibo_esporadico(uuid, uuid, integer, integer, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.crear_recibo_esporadico(
  p_centro_id uuid, p_familia_id uuid, p_nino_id uuid, p_anio integer, p_mes integer,
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
  v_linea_nino uuid;
  v_total integer := 0;
BEGIN
  IF NOT public.es_admin(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_anio < 2024 OR p_anio > 2100 OR p_mes < 1 OR p_mes > 12 THEN
    RAISE EXCEPTION 'periodo invalido' USING ERRCODE = '22023';
  END IF;
  IF public.centro_de_familia(p_familia_id) IS DISTINCT FROM p_centro_id THEN
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

  INSERT INTO public.recibos
    (centro_id, familia_id, nino_id, anio, mes, metodo, estado, total_centimos, es_esporadico, concepto_esporadico)
    VALUES (p_centro_id, p_familia_id, p_nino_id, p_anio, p_mes, v_metodo,
            'pendiente_procesar', 0, true, p_concepto)
    RETURNING id INTO v_recibo_id;

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
END $$;
GRANT EXECUTE ON FUNCTION public.crear_recibo_esporadico(uuid, uuid, uuid, integer, integer, text, text, jsonb) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. DROP del motor viejo (grano niño, inerte tras F-4-1).
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cerrar_mes_cobros(uuid, integer, integer);

COMMIT;
