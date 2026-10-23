-- =============================================================================
-- FEAT — Recibos, PR-5: una beca descontada pasa a «aplicada»
-- -----------------------------------------------------------------------------
-- El agujero: `beca_comedor_tramo.estado` tiene el valor `aplicada` y la columna
-- `aplicada_en_recibo_id`, pero nadie los escribía nunca. No había forma de saber qué becas se
-- habían descontado ya y cuáles seguían pendientes.
--
-- Decisión del responsable: al VALIDAR un recibo, los tramos de beca descontados en él pasan a
-- `aplicada` y guardan en qué recibo. Al devolverlo a borrador, vuelven a `pendiente`.
--
--   · «Descontados en él» tiene que ser exacto: una carga creada entre generar el borrador y
--     validarlo NO está en el recibo, y marcarla aplicada perdería esa beca. Así que la línea de
--     beca guarda qué tramo descuenta (`lineas_recibo.beca_tramo_id`), y la escribe el motor.
--     `generar_recibos_mes` es la definición VIVA leída en producción con ese único cambio.
--   · Trigger `recibos_aplicar_becas` (AFTER UPDATE OF estado): borrador → validado marca
--     `aplicada` los tramos de sus líneas; validado → borrador los devuelve a `pendiente`. Vale
--     para `confirmar_recibo`, `desconfirmar_recibo` (que no se tocan) y cualquier otro camino.
--     Si una línea descuenta un tramo que ya no está pendiente (descontado en otro recibo), no
--     se valida: sería descontar la misma beca dos veces.
--   · Trigger `beca_tramo_proteger`: el estado y el recibo de un tramo solo los cambia esa
--     validación (marcador local `app.aplicar_beca`, el patrón de `app.resolver_devolucion`),
--     también para service_role; un tramo nace `pendiente`. Y un tramo `aplicada` no se
--     modifica ni se borra: la misma regla, y la misma exención de service_role, que el
--     congelado del recibo validado (`congelar_si_mes_cerrado`).
--   · CHECK `beca_tramo_aplicada_coherente`: `aplicada` si y solo si hay recibo.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor, DESPUÉS de
-- `20261109120000`. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_n integer;
BEGIN
  IF to_regprocedure('public.recibos_aplicar_becas()') IS NOT NULL
     OR to_regprocedure('public.beca_tramo_proteger()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.lineas_recibo'::regclass
                 AND attname = 'beca_tramo_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'ya aplicada: existen recibos_aplicar_becas, beca_tramo_proteger o lineas_recibo.beca_tramo_id';
  END IF;
  -- El motor tiene que ser el leído en producción (md5 normalizado: sin \r, sin comentarios,
  -- espacios colapsados): este fichero lo reescribe entero.
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.generar_recibos_mes(uuid,integer,integer)');
  IF v_md5 IS DISTINCT FROM '71eb135689f9e94bebe802f8a065e3b7' THEN
    RAISE EXCEPTION 'generar_recibos_mes no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  -- La validación y la vuelta a borrador pasan por el UPDATE de estas dos: las leídas.
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.confirmar_recibo(uuid)');
  IF v_md5 IS DISTINCT FROM '532d31c18d0f88c2ff00cd156fa8e632' THEN
    RAISE EXCEPTION 'confirmar_recibo no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.desconfirmar_recibo(uuid)');
  IF v_md5 IS DISTINCT FROM 'c8772170326a5421b4bd790785d0312c' THEN
    RAISE EXCEPTION 'desconfirmar_recibo no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  -- Nadie ha escrito nunca 'aplicada': cualquier tramo que no esté pendiente es una sorpresa.
  SELECT count(*) INTO v_n FROM public.beca_comedor_tramo WHERE estado <> 'pendiente' OR aplicada_en_recibo_id IS NOT NULL;
  RAISE NOTICE 'tramos de beca que no están pendientes antes de aplicar: %', v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'hay % tramos de beca que no están pendientes: se revisan antes', v_n;
  END IF;
  -- Líneas de beca de ANTES de este PR: no llevan su tramo. En un recibo validado, su beca se
  -- quedaría `pendiente` para siempre aunque se descontó; en un borrador, se validaría sin
  -- marcar nada (hasta regenerarlo). Hay que verlas antes de aplicar.
  SELECT count(*) INTO v_n FROM public.lineas_recibo l
   WHERE l.concepto_id IS NULL AND l.descripcion LIKE 'Beca comedor %';
  RAISE NOTICE 'líneas de beca comedor antes de aplicar: %', v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'hay % líneas de beca comedor sin su tramo: se revisan antes', v_n;
  END IF;
END
$guarda$;

-- ---- La línea de beca dice qué tramo descuenta ----
ALTER TABLE public.lineas_recibo
  ADD COLUMN beca_tramo_id uuid REFERENCES public.beca_comedor_tramo(id) ON DELETE SET NULL;
CREATE INDEX lineas_recibo_beca_tramo_id_idx ON public.lineas_recibo (beca_tramo_id)
  WHERE beca_tramo_id IS NOT NULL;

ALTER TABLE public.beca_comedor_tramo
  ADD CONSTRAINT beca_tramo_aplicada_coherente CHECK ((estado = 'aplicada') = (aplicada_en_recibo_id IS NOT NULL));

-- ---- El motor: la línea de beca lleva su tramo ----
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
  r_tramo record;
  v_base_total integer;
  v_beca_total integer;
  v_exceso integer;
  v_via_resuelta public.beca_desborde_via;
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

  -- RESET idempotente (R-2). Antes se borraba el BORRADOR ENTERO y se recreaba con id
  -- nuevo; eso mataba por CASCADE cualquier línea escrita a mano. Ahora se vacían SOLO
  -- las líneas origen='automatico' y la CARCASA del recibo se conserva (mismo id), asi
  -- que las líneas origen='manual' sobreviven POR CONSTRUCCIÓN: el motor no las toca en
  -- ningún punto. Respeta confirmados igual que antes (R8): el filtro sigue siendo
  -- estado='borrador'.
  DELETE FROM public.lineas_recibo l
    USING public.recibos r
    WHERE l.recibo_id = r.id
      AND r.centro_id = p_centro_id AND r.anio = p_anio AND r.mes = p_mes
      AND NOT r.es_esporadico AND r.devuelto_de_recibo_id IS NULL
      AND r.deleted_at IS NULL AND r.estado = 'borrador'
      AND l.origen = 'automatico';

  -- COLATERAL (a), OBLIGATORIO: el desborde de beca comedor se limpiaba solo porque
  -- colgaba del recibo con ON DELETE CASCADE. Al dejar de borrarse el recibo hay que
  -- borrarlo a mano, y no es higiene: beca_comedor_desborde tiene UNIQUE(recibo_id), asi
  -- que sin esto la SEGUNDA regeneración falla con 23505 y aborta la generación entera.
  -- B2-3: ...pero SOLO los PENDIENTES. Un desborde RESUELTO (transferencia hecha, o exceso
  -- diferido al mes siguiente) esta CERRADO: el dinero ya se movio. Borrarlo y recrearlo
  -- pendiente -lo que se hacia hasta aqui- destruia el registro de la resolucion mientras
  -- su efecto (la transferencia, los tramos 'resto') seguia vivo, e invitaba a resolverlo
  -- por segunda vez. Cerrado es cerrado: no se recalcula nunca mas.
  DELETE FROM public.beca_comedor_desborde d
    USING public.recibos r
    WHERE d.recibo_id = r.id
      AND r.centro_id = p_centro_id AND r.anio = p_anio AND r.mes = p_mes
      AND NOT r.es_esporadico AND r.devuelto_de_recibo_id IS NULL
      AND r.deleted_at IS NULL AND r.estado = 'borrador'
      AND d.estado = 'pendiente';

  FOR r_fam IN
    SELECT DISTINCT n.familia_id
    FROM public.ninos n
    JOIN public.matriculas m ON m.nino_id = n.id
    WHERE n.centro_id = p_centro_id
      AND m.estado = 'activa' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
  LOOP
    -- NUNCA se regenera un CONFIRMADO (R8). Antes bastaba con "existe un recibo regular",
    -- porque los borradores se acababan de borrar; ahora el borrador SOBREVIVE al reset,
    -- así que hay que acotar el guard a estado<>'borrador' o el CONTINUE se dispararía
    -- para toda familia ya generada y no se recalcularía nada.
    IF EXISTS (
      SELECT 1 FROM public.recibos
      WHERE familia_id = r_fam.familia_id AND anio = p_anio AND mes = p_mes
        AND NOT es_esporadico AND devuelto_de_recibo_id IS NULL AND deleted_at IS NULL
        AND estado <> 'borrador'
    ) THEN
      CONTINUE;
    END IF;

    -- Método CONGELADO de la FAMILIA (NULL si no se fijó → recibo sin método, fuera de remesa).
    v_metodo := NULL;
    SELECT metodo INTO v_metodo FROM public.metodo_pago_familia
      WHERE familia_id = r_fam.familia_id AND anio = p_anio AND mes = p_mes AND deleted_at IS NULL
      LIMIT 1;

    -- R-2: REUTILIZA la carcasa del borrador si ya existe (mismo id), y solo la crea la
    -- primera vez. Conservar el id es lo que permite que las líneas manuales sigan
    -- colgando del mismo recibo entre regeneraciones. Hay UNIQUE(familia_id, anio, mes)
    -- para regulares, así que "el borrador de esta familia" es inequívoco.
    v_recibo := NULL;
    SELECT id INTO v_recibo FROM public.recibos
      WHERE familia_id = r_fam.familia_id AND anio = p_anio AND mes = p_mes
        AND NOT es_esporadico AND devuelto_de_recibo_id IS NULL AND deleted_at IS NULL
        AND estado = 'borrador'
      LIMIT 1;

    IF v_recibo IS NULL THEN
      INSERT INTO public.recibos
        (centro_id, familia_id, nino_id, anio, mes, metodo, estado, total_centimos, es_esporadico)
        VALUES (p_centro_id, r_fam.familia_id, NULL, p_anio, p_mes, v_metodo, 'borrador', 0, false)
        RETURNING id INTO v_recibo;
    ELSE
      -- El método pudo cambiar desde la generación anterior. Antes se recogía solo porque
      -- el recibo nacía de cero en cada pasada; al reutilizar hay que refrescarlo.
      UPDATE public.recibos SET metodo = v_metodo WHERE id = v_recibo;
    END IF;

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
          -- PR-4: quien tiene la cuota MENSUAL de este servicio no paga sus días, aunque tenga
          -- también el diario asignado por error. Los filtros son los del PASE 1, para que
          -- excluya justo cuando el mensual se cobra.
          IF EXISTS (
            SELECT 1
            FROM public.asignacion_concepto a2
            JOIN public.conceptos_cobro c2 ON c2.id = a2.concepto_id
            WHERE a2.nino_id = r_nino.id AND a2.deleted_at IS NULL
              AND c2.deleted_at IS NULL AND c2.activo = true
              AND c2.signo = 1 AND c2.tipo_valor = 'fijo'
              AND c2.tipo_concepto = 'mensual' AND c2.servicio = r_asig.servicio
              AND (a2.vigencia_desde IS NULL OR a2.vigencia_desde <= v_last)
              AND (a2.vigencia_hasta IS NULL OR a2.vigencia_hasta >= v_first)
          ) THEN
            CONTINUE;
          END IF;
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
          -- R-2 (decisión A): la base que DERIVA el descuento se calcula sobre el CATÁLOGO,
          -- es decir solo líneas automáticas. Un cargo escrito a mano no debe inflar un
          -- descuento porcentual. (El TOPE de la beca comedor sí mide sobre el total real,
          -- manuales incluidas: es otra base, ver PASE 2-bis.)
          SELECT COALESCE(SUM(importe_centimos), 0) INTO v_base FROM public.lineas_recibo
            WHERE recibo_id = v_recibo AND nino_id = r_desc.asig_nino
              AND concepto_id = r_desc.concepto_base_id
              AND origen = 'automatico';
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
            -- R-2 (decisión A): el ranking de hermanos se ordena por lo que dice el
            -- catálogo. Sin este filtro, un cargo manual a un hijo podría cambiar QUIÉN
            -- queda primero y mover el descuento a otro hermano sin que nadie lo pida.
            LEFT JOIN public.lineas_recibo l ON l.recibo_id = v_recibo AND l.nino_id = n.id
                 AND l.origen = 'automatico'
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
              -- R-2 (decisión A): mismo criterio que el ranking porcentual.
              LEFT JOIN public.lineas_recibo l ON l.recibo_id = v_recibo AND l.nino_id = n.id
                   AND l.origen = 'automatico'
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

    -- PASE 2-bis (v2, B2-1): BECA COMEDOR por MES DE APLICACIÓN, a NIVEL FAMILIA, con
    -- capado a >=0 (PRESERVANDO saldo a favor) y registro de desborde. Reubicado tras
    -- PASE 4 porque el capado se mide contra el TOTAL del recibo FAMILIAR (D-P4/D-P5).
    -- Sustituye al PASE 2-bis viejo (leia beca_comedor_mes del mismo mes por nino).
    -- base_total = total del recibo antes de beca comedor (PASE 1/1b/2/3/4); PUEDE ser
    -- negativo (saldo a favor arrastrado por PASE 4). El motor NO muta los tramos
    -- (idempotencia: al regenerar siguen 'pendiente' y se reaplican; cada tramo solo
    -- matchea su mes de aplicacion).
    -- COLATERAL (c) / decisión C1: esta base mide el TOPE de lo descontable, y suma el
    -- recibo ENTERO — líneas manuales incluidas, deliberadamente y sin filtro por origen.
    -- Un cargo escrito a mano es cuota que la beca puede descontar. Contrasta con las
    -- bases del PASE 3 (decisión A), que sí se acotan a origen='automatico'.
    SELECT COALESCE(SUM(importe_centimos), 0) INTO v_base_total
      FROM public.lineas_recibo WHERE recibo_id = v_recibo;

    v_beca_total := 0;
    FOR r_tramo IN
      SELECT t.id, t.nino_id, t.importe_centimos, t.mes_correspondiente
      FROM public.beca_comedor_tramo t
      WHERE t.centro_id = p_centro_id
        AND t.anio_aplicacion = p_anio AND t.mes_aplicacion = p_mes
        AND t.estado = 'pendiente'
        -- D-P3: se aplica por EXISTENCIA del tramo + hijo con matricula activa; NO se
        -- consulta beca_comedor_elegibilidad (un tramo previo a una baja SE aplica).
        AND EXISTS (
          SELECT 1 FROM public.ninos n
          JOIN public.matriculas m ON m.nino_id = n.id
          WHERE n.id = t.nino_id AND n.familia_id = r_fam.familia_id
            AND m.estado = 'activa' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL)
      ORDER BY t.anio_correspondiente, t.mes_correspondiente, t.nino_id
    LOOP
      -- Linea NEGATIVA colgada del nino; descripcion por el MES CORRESPONDIENTE (no el de
      -- aplicacion), sin nombre embebido (coherente con B3).
      -- PR-5: la linea guarda QUÉ tramo descuenta (beca_tramo_id). Al validar el recibo, esos
      -- tramos, y solo esos, pasan a 'aplicada' (trigger recibos_aplicar_becas).
      INSERT INTO public.lineas_recibo
        (recibo_id, concepto_id, nino_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos,
         beca_tramo_id)
        VALUES (v_recibo, NULL, r_tramo.nino_id,
          left('Beca comedor ' || (ARRAY['enero','febrero','marzo','abril','mayo','junio',
            'julio','agosto','septiembre','octubre','noviembre','diciembre'])[r_tramo.mes_correspondiente], 200),
          1, -r_tramo.importe_centimos, -r_tramo.importe_centimos,
          r_tramo.id);
      v_beca_total := v_beca_total + r_tramo.importe_centimos;
    END LOOP;

    -- Capado con PRESERVACION DE SALDO: la beca solo descuenta CUOTA POSITIVA. La
    -- capacidad de descuento es GREATEST(base_total, 0): si hay saldo a favor
    -- (base_total<0) la beca no descuenta nada y todo es exceso; el saldo queda intacto.
    IF v_beca_total > GREATEST(v_base_total, 0) THEN
      v_exceso := v_beca_total - GREATEST(v_base_total, 0);
      -- Linea FAMILIAR de ajuste (+exceso): deja el total en MIN(base_total,0) -> 0 si
      -- habia cuota, o el saldo a favor intacto si base_total<0. La beca NUNCA anade
      -- negatividad al recibo ni destruye saldo a favor.
      -- B2-3: ¿este recibo ya tiene el desborde RESUELTO? Sobrevivio al reset de arriba, asi
      -- que aqui se lee su via: decide la etiqueta de la linea y si hay que registrar algo.
      -- Sin fila, SELECT INTO deja NULL -> el caso normal (pendiente) sigue igual que antes.
      SELECT d.via INTO v_via_resuelta
        FROM public.beca_comedor_desborde d
        WHERE d.recibo_id = v_recibo AND d.estado = 'resuelto';
      -- La etiqueta dice la VERDAD: poner "(pendiente)" sobre un exceso ya transferido a la
      -- familia es mentirle a quien lee el recibo. El importe no cambia -la linea sigue
      -- dejando el total en 0-; lo que cambia es lo que la linea declara.
      INSERT INTO public.lineas_recibo
        (recibo_id, concepto_id, nino_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos)
        VALUES (v_recibo, NULL, NULL,
          CASE v_via_resuelta
            WHEN 'transferencia' THEN 'Ajuste beca comedor (resuelto por transferencia)'
            WHEN 'reducir'       THEN 'Ajuste beca comedor (resuelto: diferido al mes siguiente)'
            WHEN 'resto'         THEN 'Ajuste beca comedor (resuelto)'
            ELSE 'Ajuste beca comedor (pendiente)'
          END,
          1, v_exceso, v_exceso);
      -- Registrar el desborde PENDIENTE (su resolucion -las 3 vias- es V2-4). Solo si NO hay
      -- uno resuelto: con el reset ya sin tocarlos, insertar aqui reventaria contra
      -- UNIQUE(recibo_id) con 23505 (el mismo 23505 que R-2 cerro). Este guard es lo que
      -- mantiene la invariante "como mucho UNA fila por recibo" sin volver a borrar nada.
      IF v_via_resuelta IS NULL THEN
        INSERT INTO public.beca_comedor_desborde
          (centro_id, recibo_id, familia_id, anio, mes, cuota_total_centimos, beca_total_centimos, exceso_centimos)
          VALUES (p_centro_id, v_recibo, r_fam.familia_id, p_anio, p_mes,
            GREATEST(v_base_total, 0), v_beca_total, v_exceso);
      END IF;
    END IF;
    -- COLATERAL (b): descarte si 0 líneas. El conteo no filtra por origen, así que un
    -- recibo cuyas únicas líneas sean MANUALES sobrevive: al no borrarse ya las manuales
    -- en el reset, aquí sigue habiendo >=1 y no se autodestruye.
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

  -- R-2 · BARRIDO FINAL. El bucle solo visita familias CON hijos activos. Antes, el
  -- borrador de una familia que se quedaba sin ninguno desaparecía en el DELETE del
  -- reset; ahora sobrevive, así que hay que (1) refrescar su total, que quedó obsoleto
  -- al vaciarle las líneas automáticas, y (2) borrarlo si se quedó SIN NINGUNA línea.
  -- Si conserva líneas manuales se respeta y se queda (B1), con su total recalculado.
  UPDATE public.recibos r
     SET total_centimos = COALESCE(
           (SELECT SUM(l.importe_centimos) FROM public.lineas_recibo l WHERE l.recibo_id = r.id), 0)
   WHERE r.centro_id = p_centro_id AND r.anio = p_anio AND r.mes = p_mes
     AND NOT r.es_esporadico AND r.devuelto_de_recibo_id IS NULL
     AND r.deleted_at IS NULL AND r.estado = 'borrador';

  DELETE FROM public.recibos r
   WHERE r.centro_id = p_centro_id AND r.anio = p_anio AND r.mes = p_mes
     AND NOT r.es_esporadico AND r.devuelto_de_recibo_id IS NULL
     AND r.deleted_at IS NULL AND r.estado = 'borrador'
     AND NOT EXISTS (SELECT 1 FROM public.lineas_recibo l WHERE l.recibo_id = r.id);

  RETURN v_count;
END $function$;

-- ---- Al validar, aplicada; al volver a borrador, pendiente ----
CREATE FUNCTION public.recibos_aplicar_becas()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tramos integer;
  v_filas integer;
BEGIN
  IF OLD.estado = 'borrador' AND NEW.estado IS DISTINCT FROM 'borrador' THEN
    SELECT count(DISTINCT l.beca_tramo_id) INTO v_tramos
      FROM public.lineas_recibo l
     WHERE l.recibo_id = NEW.id AND l.beca_tramo_id IS NOT NULL;
    IF v_tramos = 0 THEN
      RETURN NULL;
    END IF;
    PERFORM set_config('app.aplicar_beca', NEW.id::text, true);
    UPDATE public.beca_comedor_tramo t
       SET estado = 'aplicada', aplicada_en_recibo_id = NEW.id
     WHERE t.estado = 'pendiente'
       AND t.id IN (SELECT l.beca_tramo_id FROM public.lineas_recibo l WHERE l.recibo_id = NEW.id);
    -- Antes de quitar el marcador: PERFORM también pone FOUND.
    GET DIAGNOSTICS v_filas = ROW_COUNT;
    PERFORM set_config('app.aplicar_beca', '', true);
    IF v_filas <> v_tramos THEN
      RAISE EXCEPTION 'el recibo descuenta % becas y solo % siguen pendientes: alguna ya está descontada en otro recibo', v_tramos, v_filas
        USING ERRCODE = 'P0001', HINT = 'beca_ya_aplicada';
    END IF;
  ELSIF NEW.estado = 'borrador' AND OLD.estado IS DISTINCT FROM 'borrador' THEN
    PERFORM set_config('app.aplicar_beca', NEW.id::text, true);
    UPDATE public.beca_comedor_tramo
       SET estado = 'pendiente', aplicada_en_recibo_id = NULL
     WHERE aplicada_en_recibo_id = NEW.id;
    PERFORM set_config('app.aplicar_beca', '', true);
  END IF;
  RETURN NULL;
END $function$;

REVOKE ALL ON FUNCTION public.recibos_aplicar_becas() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER recibos_aplicar_becas
  AFTER UPDATE OF estado ON public.recibos
  FOR EACH ROW EXECUTE FUNCTION public.recibos_aplicar_becas();

-- ---- El estado de un tramo solo lo cambia la validación; uno aplicado no se toca ----
CREATE FUNCTION public.beca_tramo_proteger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_marca text := COALESCE(current_setting('app.aplicar_beca', true), '');
BEGIN
  -- Vale para todos, también para service_role: 'aplicada' significa «descontada en un recibo
  -- validado», y eso solo lo sabe la validación del recibo.
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'pendiente' OR NEW.aplicada_en_recibo_id IS NOT NULL THEN
      RAISE EXCEPTION 'una beca nace pendiente: la marca aplicada la validación del recibo'
        USING ERRCODE = 'P0001', HINT = 'beca_estado_por_recibo';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND (NEW.estado IS DISTINCT FROM OLD.estado
          OR NEW.aplicada_en_recibo_id IS DISTINCT FROM OLD.aplicada_en_recibo_id)
     AND v_marca IS DISTINCT FROM COALESCE(NEW.aplicada_en_recibo_id, OLD.aplicada_en_recibo_id)::text THEN
    RAISE EXCEPTION 'el estado de una beca lo cambia la validación del recibo'
      USING ERRCODE = 'P0001', HINT = 'beca_estado_por_recibo';
  END IF;
  -- Una beca descontada en un recibo validado es parte de ese recibo: no se modifica ni se
  -- borra. Como el congelado del recibo, exime a service_role (limpieza y arreglos de servidor).
  IF OLD.estado = 'aplicada' AND auth.role() IS DISTINCT FROM 'service_role' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'la beca ya está descontada en un recibo validado: no se borra'
        USING ERRCODE = 'P0001', HINT = 'beca_aplicada';
    END IF;
    IF NEW.estado = 'aplicada'
       AND (NEW.importe_centimos, NEW.nino_id, NEW.centro_id, NEW.curso_academico_id, NEW.origen,
            NEW.anio_correspondiente, NEW.mes_correspondiente, NEW.anio_aplicacion, NEW.mes_aplicacion)
           IS DISTINCT FROM
           (OLD.importe_centimos, OLD.nino_id, OLD.centro_id, OLD.curso_academico_id, OLD.origen,
            OLD.anio_correspondiente, OLD.mes_correspondiente, OLD.anio_aplicacion, OLD.mes_aplicacion) THEN
      RAISE EXCEPTION 'la beca ya está descontada en un recibo validado: no se modifica'
        USING ERRCODE = 'P0001', HINT = 'beca_aplicada';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.beca_tramo_proteger() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER beca_tramo_proteger
  BEFORE INSERT OR UPDATE OR DELETE ON public.beca_comedor_tramo
  FOR EACH ROW EXECUTE FUNCTION public.beca_tramo_proteger();

COMMENT ON COLUMN public.lineas_recibo.beca_tramo_id IS
  'PR-5: el tramo de beca comedor que descuenta esta línea. Lo escribe el motor; al validar el recibo, esos tramos pasan a aplicada (trigger recibos_aplicar_becas).';
COMMENT ON COLUMN public.beca_comedor_tramo.estado IS
  'pendiente: aún no descontada en un recibo validado. aplicada: descontada en el recibo validado aplicada_en_recibo_id (la escribe la validación; vuelve a pendiente si el recibo vuelve a borrador). anulada: sin uso.';
COMMENT ON COLUMN public.beca_comedor_tramo.aplicada_en_recibo_id IS
  'PR-5: recibo validado en el que se descontó. Solo con estado aplicada (CHECK beca_tramo_aplicada_coherente).';

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.generar_recibos_mes(uuid,integer,integer)');
  IF v_md5 IS DISTINCT FROM '20f5d5eb56220245cd490cfa0d1ed425' THEN
    RAISE EXCEPTION 'generar_recibos_mes no quedó como este fichero: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.recibos_aplicar_becas()');
  IF v_md5 IS DISTINCT FROM 'c7487551fdea585664241635db8a260b' THEN
    RAISE EXCEPTION 'recibos_aplicar_becas no quedó como este fichero: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.beca_tramo_proteger()');
  IF v_md5 IS DISTINCT FROM '82975299dbc6ae6a7640a10cbdfe7534' THEN
    RAISE EXCEPTION 'beca_tramo_proteger no quedó como este fichero: %', coalesce(v_md5, 'falta');
  END IF;
  IF NOT (SELECT bool_and(prosecdef) FROM pg_proc WHERE oid IN (
            'public.generar_recibos_mes(uuid,integer,integer)'::regprocedure,
            'public.recibos_aplicar_becas()'::regprocedure,
            'public.beca_tramo_proteger()'::regprocedure)) THEN
    RAISE EXCEPTION 'el motor y los dos triggers tienen que ser SECURITY DEFINER';
  END IF;
  -- CREATE OR REPLACE conserva los permisos del motor: Dirección la llama, anon no.
  IF has_function_privilege('anon', 'public.generar_recibos_mes(uuid,integer,integer)'::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.generar_recibos_mes(uuid,integer,integer)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'generar_recibos_mes con permisos distintos de los leídos';
  END IF;
  IF has_function_privilege('anon', 'public.recibos_aplicar_becas()'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.recibos_aplicar_becas()'::regprocedure, 'EXECUTE')
     OR has_function_privilege('public', 'public.recibos_aplicar_becas()'::regprocedure, 'EXECUTE')
     OR has_function_privilege('anon', 'public.beca_tramo_proteger()'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.beca_tramo_proteger()'::regprocedure, 'EXECUTE')
     OR has_function_privilege('public', 'public.beca_tramo_proteger()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'un trigger de este fichero abierto a anon, authenticated o PUBLIC';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.recibos'::regclass
                    AND tgname = 'recibos_aplicar_becas' AND tgenabled = 'O'
                    AND pg_get_triggerdef(oid) LIKE '%AFTER UPDATE OF estado ON public.recibos%')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.beca_comedor_tramo'::regclass
                    AND tgname = 'beca_tramo_proteger' AND tgenabled = 'O'
                    AND pg_get_triggerdef(oid) LIKE '%BEFORE INSERT OR DELETE OR UPDATE ON public.beca_comedor_tramo%') THEN
    RAISE EXCEPTION 'los triggers recibos_aplicar_becas o beca_tramo_proteger no quedaron como este fichero';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.lineas_recibo'::regclass
                    AND contype = 'f' AND confrelid = 'public.beca_comedor_tramo'::regclass
                    AND confdeltype = 'n')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.beca_comedor_tramo'::regclass
                    AND conname = 'beca_tramo_aplicada_coherente') THEN
    RAISE EXCEPTION 'falta la FK de lineas_recibo.beca_tramo_id o el CHECK beca_tramo_aplicada_coherente';
  END IF;
  -- confirmar y desconfirmar siguen siendo las leídas (no se recrean).
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.confirmar_recibo(uuid)');
  IF v_md5 IS DISTINCT FROM '532d31c18d0f88c2ff00cd156fa8e632' THEN
    RAISE EXCEPTION 'confirmar_recibo cambió: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.desconfirmar_recibo(uuid)');
  IF v_md5 IS DISTINCT FROM 'c8772170326a5421b4bd790785d0312c' THEN
    RAISE EXCEPTION 'desconfirmar_recibo cambió: %', coalesce(v_md5, 'falta');
  END IF;
  RAISE NOTICE 'guarda posterior: motor, recibos_aplicar_becas, beca_tramo_proteger, FK y CHECK';
END
$guarda$;
