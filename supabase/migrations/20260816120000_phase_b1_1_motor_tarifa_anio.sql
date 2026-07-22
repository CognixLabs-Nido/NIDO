-- B1-1 — Motor: tarifa de concepto por AÑO DE NACIMIENTO en el importe unitario.
--
-- CREATE OR REPLACE de generar_recibos_mes desde la definición VIVA del remoto. ÚNICO
-- cambio funcional: la resolución del importe unitario de los cargos POSITIVOS por niño
-- (PASE 1, cargos con nino_id) intercala la tarifa por año entre el override manual y la
-- base. Precedencia (cerrada por Jose): override manual del niño > tarifa por año > base.
--
-- Se alimenta con:
--   (b) EXTRACT(YEAR FROM n.fecha_nacimiento) añadido al bucle r_nino (anio_nac).
--   (c) c.tarifa_por_anio_nacimiento añadido al SELECT de r_asig (el concepto).
--   (a) v_unit := COALESCE(override, tarifa_del_año_si_flag, base) en el punto único de
--       resolución (servía ya a mensual y a diario: en diario el unitario es precio/día y
--       se multiplica por los días del parte, sin tocar esa lógica).
--
-- Fallback cerrado por Jose: si el concepto no tiene el flag, o el niño no tiene
-- fecha_nacimiento, o no existe fila (concepto_id, año) en tarifa_concepto_anio → el
-- candidato "tarifa del año" es NULL y el COALESCE cae a la base. Nunca error, nunca se
-- omite la línea. La UNIQUE (concepto_id, anio_nacimiento) garantiza ≤1 fila (subconsulta
-- escalar segura).
--
-- NO se toca: cargo de ámbito FAMILIA (nino_id NULL, sin año → base), descuentos (signo -1),
-- becas, PASE 2/2-bis/3/4, firma, GRANT ni flujo.
CREATE OR REPLACE FUNCTION public.generar_recibos_mes(p_centro_id uuid, p_anio integer, p_mes integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_beca_com numeric;
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
      SELECT n.id, n.nombre, EXTRACT(YEAR FROM n.fecha_nacimiento)::int AS anio_nac
      FROM public.ninos n
      JOIN public.matriculas m ON m.nino_id = n.id
      WHERE n.familia_id = r_fam.familia_id
        AND m.estado = 'activa' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
    LOOP
      -- PASE 1: asignaciones niño, signo=+1, fijo, vigentes en el mes (§4).
      FOR r_asig IN
        SELECT a.cantidad_default, a.importe_override_centimos,
               c.id AS concepto_id, c.nombre, c.tipo_concepto, c.importe_centimos, c.servicio,
               c.tarifa_por_anio_nacimiento
        FROM public.asignacion_concepto a
        JOIN public.conceptos_cobro c ON c.id = a.concepto_id
        WHERE a.nino_id = r_nino.id AND a.deleted_at IS NULL
          AND c.deleted_at IS NULL AND c.activo = true
          AND c.signo = 1 AND c.tipo_valor = 'fijo'
          AND (a.vigencia_desde IS NULL OR a.vigencia_desde <= v_last)
          AND (a.vigencia_hasta IS NULL OR a.vigencia_hasta >= v_first)
      LOOP
        -- Precedencia: override manual del niño > tarifa por año (si flag) > base.
        v_unit := COALESCE(
          r_asig.importe_override_centimos,
          CASE WHEN r_asig.tarifa_por_anio_nacimiento AND r_nino.anio_nac IS NOT NULL
               THEN (SELECT t.importe_centimos FROM public.tarifa_concepto_anio t
                       WHERE t.concepto_id = r_asig.concepto_id
                         AND t.anio_nacimiento = r_nino.anio_nac)
               ELSE NULL END,
          r_asig.importe_centimos);
        IF v_unit IS NULL THEN CONTINUE; END IF;

        IF r_asig.tipo_concepto = 'mensual' THEN
          v_cant := GREATEST(r_asig.cantidad_default, 1);          -- cantidad_default multiplica
          INSERT INTO public.lineas_recibo
            (recibo_id, concepto_id, nino_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos)
            VALUES (v_recibo, r_asig.concepto_id, r_nino.id,
              left(r_asig.nombre, 200), v_cant, v_unit, v_unit * v_cant);

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
                left(r_asig.nombre || ' (' || v_dias || ' días)', 200),
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
            left('Beca: ' || r_beca.nombre, 200), 1,
            -r_beca.importe_centimos, -r_beca.importe_centimos);
      END LOOP;

      -- PASE 2-bis: beca comedor variable del mes (beca_comedor_mes) → línea NEGATIVA independiente.
      SELECT importe INTO v_beca_com FROM public.beca_comedor_mes
        WHERE nino_id = r_nino.id AND anio = p_anio AND mes = p_mes;
      IF v_beca_com IS NOT NULL AND v_beca_com > 0 THEN
        INSERT INTO public.lineas_recibo
          (recibo_id, concepto_id, nino_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos)
          VALUES (v_recibo, NULL, r_nino.id,
            'Beca comedor', 1,
            -round(v_beca_com * 100)::integer, -round(v_beca_com * 100)::integer);
      END IF;
    END LOOP;

    -- PASE 1b: cargos POSITIVOS de ámbito FAMILIA (signo=+1, fijo), asignados a la familia
    -- (a.familia_id, NO a un hijo). Genera línea FAMILIAR (nino_id=NULL): es un cargo de la
    -- familia, no de un hijo, y su descripción NO lleva "· hijo". Cierra el hueco por el que
    -- proponer_asignaciones (F-4-2) siembra estos conceptos pero el motor no los facturaba.
    FOR r_asig IN
      SELECT a.cantidad_default, a.importe_override_centimos,
             c.id AS concepto_id, c.nombre, c.tipo_concepto, c.importe_centimos
      FROM public.asignacion_concepto a
      JOIN public.conceptos_cobro c ON c.id = a.concepto_id
      WHERE a.familia_id = r_fam.familia_id AND a.deleted_at IS NULL
        AND c.deleted_at IS NULL AND c.activo = true
        AND c.signo = 1 AND c.tipo_valor = 'fijo'
        AND (a.vigencia_desde IS NULL OR a.vigencia_desde <= v_last)
        AND (a.vigencia_hasta IS NULL OR a.vigencia_hasta >= v_first)
    LOOP
      v_unit := COALESCE(r_asig.importe_override_centimos, r_asig.importe_centimos);
      IF v_unit IS NULL THEN CONTINUE; END IF;

      IF r_asig.tipo_concepto = 'mensual' THEN
        v_cant := GREATEST(r_asig.cantidad_default, 1);          -- cantidad_default multiplica (= PASE 1)
        INSERT INTO public.lineas_recibo
          (recibo_id, concepto_id, nino_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos)
          VALUES (v_recibo, r_asig.concepto_id, NULL,
            left(r_asig.nombre, 200), v_cant, v_unit, v_unit * v_cant);   -- línea familiar (sin "· hijo")
      END IF;
      -- tipo_concepto='diario': SKIP. El parte de servicio (parte_servicio_diario) es POR NIÑO;
      --   un cargo diario a nivel familia no tiene contador de días bien definido (¿la unión de
      --   los partes de todos los hijos? ¿el máximo? no hay semántica clara) → no se inventa.
      -- tipo_concepto='esporadico': SKIP (fuera del motor recurrente, igual que en PASE 1).
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
                left(r_desc.nombre, 200),
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
                  left(r_desc.nombre, 200),
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
                 left(r_desc.nombre, 200), 1,
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
                   left(r_desc.nombre, 200), 1, -v_unit, -v_unit
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
END $function$
