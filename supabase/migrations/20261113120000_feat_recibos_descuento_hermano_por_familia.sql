-- =============================================================================
-- FEAT — Recibos, PR-8: el descuento por hermano, fijo o porcentaje POR FAMILIA
-- -----------------------------------------------------------------------------
-- Hasta ahora el descuento era de un tipo u otro para todas las familias: el del concepto. Una
-- asignación solo podía cambiar el importe (PR-6), y solo en un concepto fijo.
--
-- Decisión del responsable: en cada familia se elige el tipo y el valor (en la García 30 €, en
-- la Pérez el 15 % de la escolaridad del segundo hermano). El porcentaje se calcula SOBRE LA
-- ESCOLARIDAD solamente (la base del concepto, `concepto_base_id`), no sobre todo lo que se le
-- cobra a ese hermano. La estructura se queda: el que más paga, completo; los demás, con el
-- descuento.
--   · `asignacion_concepto.porcentaje_override_bp`: el porcentaje propio de la asignación, en
--     puntos básicos (15 % = 1500). Nunca junto al importe propio (CHECK): uno hace el
--     descuento fijo, el otro porcentual, y sin ninguno manda el concepto.
--   · Un porcentaje propio solo en un descuento con base (trigger, 23514), y a un concepto con
--     porcentajes propios no se le quita la base ni deja de ser descuento (trigger, 23514).
--   · `conceptos_cobro_modelo_valor`: se relaja la regla que ligaba la base al porcentaje. Un
--     descuento FIJO puede llevar base, para que una familia pueda elegir porcentaje. Un
--     descuento porcentual la sigue exigiendo, y un cobro no la lleva.
--   · `generar_recibos_mes`: definición VIVA con un único cambio. El tipo y el porcentaje del
--     descuento salen de la asignación si los tiene; si no, del concepto.
--   · `export_datos_sujeto` (art. 15): definición VIVA con un único cambio. Cada asignación
--     lleva su porcentaje propio, junto al importe propio que ya llevaba.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor, DESPUÉS de
-- `20261112120000`. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_n integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.asignacion_concepto'::regclass
              AND attname = 'porcentaje_override_bp' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'ya aplicada: existe asignacion_concepto.porcentaje_override_bp';
  END IF;
  -- (md5 normalizado: sin retornos de carro, sin comentarios, espacios colapsados).
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.generar_recibos_mes(uuid,integer,integer)');
  IF v_md5 IS DISTINCT FROM 'e38d7f15b485cd87bc13b8714cec402f' THEN
    RAISE EXCEPTION 'generar_recibos_mes no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.export_datos_sujeto(text,uuid)');
  IF v_md5 IS DISTINCT FROM 'd9a2b7686c060f02bacfc49e3b53e220' THEN
    RAISE EXCEPTION 'export_datos_sujeto no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT md5(pg_get_constraintdef(oid)) INTO v_md5 FROM pg_constraint
   WHERE conrelid = 'public.conceptos_cobro'::regclass AND conname = 'conceptos_cobro_modelo_valor';
  IF v_md5 IS DISTINCT FROM 'ea81cc85c671fa0415649831c83709c4' THEN
    RAISE EXCEPTION 'conceptos_cobro_modelo_valor no es el leído en producción: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT count(*) INTO v_n FROM public.conceptos_cobro WHERE signo = -1 AND deleted_at IS NULL;
  RAISE NOTICE 'descuentos en el catálogo: %', v_n;
  SELECT count(*) INTO v_n FROM public.conceptos_cobro WHERE concepto_base_id IS NOT NULL;
  RAISE NOTICE 'conceptos con base: %', v_n;
  -- Un importe propio en un concepto porcentual no lo leía el motor; desde ahora lo hace fijo.
  SELECT count(*) INTO v_n FROM public.asignacion_concepto a
    JOIN public.conceptos_cobro c ON c.id = a.concepto_id
   WHERE a.deleted_at IS NULL AND a.importe_override_centimos IS NOT NULL AND c.tipo_valor = 'porcentaje';
  RAISE NOTICE 'asignaciones vivas con importe propio en un concepto porcentual (cambiarán): %', v_n;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'hay % asignaciones con importe propio en un concepto porcentual: decidir antes de aplicar', v_n;
  END IF;
END
$guarda$;

-- ---- El tipo y el valor del descuento, en la asignación ----
ALTER TABLE public.asignacion_concepto
  ADD COLUMN porcentaje_override_bp integer
    CONSTRAINT asignacion_concepto_porcentaje_override_bp_check
      CHECK (porcentaje_override_bp IS NULL OR porcentaje_override_bp BETWEEN 0 AND 10000),
  ADD CONSTRAINT asignacion_concepto_un_valor_propio
    CHECK (num_nonnulls(importe_override_centimos, porcentaje_override_bp) <= 1);

COMMENT ON COLUMN public.asignacion_concepto.porcentaje_override_bp IS
  'PR-8: porcentaje propio de la asignación, en puntos básicos (15 % = 1500). Hace el descuento porcentual sobre la base del concepto (concepto_base_id), para esta familia o este niño. Nunca junto a importe_override_centimos, que lo hace fijo; sin ninguno de los dos manda el concepto.';

-- La base que relaja PR-8: un descuento (fijo o porcentual) puede llevarla; el porcentual la
-- exige; un cobro no la lleva. El resto del CHECK, igual.
ALTER TABLE public.conceptos_cobro DROP CONSTRAINT conceptos_cobro_modelo_valor;
ALTER TABLE public.conceptos_cobro ADD CONSTRAINT conceptos_cobro_modelo_valor CHECK (
  ((tipo_valor = 'fijo' AND importe_centimos IS NOT NULL AND porcentaje_bp IS NULL)
    OR (tipo_valor = 'porcentaje' AND porcentaje_bp IS NOT NULL AND importe_centimos IS NULL))
  AND ((tipo_concepto = 'diario' AND servicio IS NOT NULL)
    OR (tipo_concepto = 'mensual' AND (servicio IS NULL OR (signo = 1 AND tipo_valor = 'fijo' AND ambito = 'nino')))
    OR (tipo_concepto = 'esporadico' AND servicio IS NULL))
  AND ((concepto_base_id IS NOT NULL AND signo = -1)
    OR (concepto_base_id IS NULL AND NOT (signo = -1 AND tipo_valor = 'porcentaje')))
);

-- Un porcentaje propio solo en un descuento con base: sin base, el motor no tendría sobre qué
-- calcularlo y el descuento desaparecería sin avisar.
CREATE FUNCTION public.asignacion_porcentaje_con_base()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.porcentaje_override_bp IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.conceptos_cobro c
        WHERE c.id = NEW.concepto_id AND c.signo = -1 AND c.concepto_base_id IS NOT NULL) THEN
    RAISE EXCEPTION 'un porcentaje propio solo vale en un descuento con base'
      USING ERRCODE = '23514', HINT = 'porcentaje_sin_base';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.asignacion_porcentaje_con_base() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER asignacion_porcentaje_con_base
  BEFORE INSERT OR UPDATE OF porcentaje_override_bp, concepto_id ON public.asignacion_concepto
  FOR EACH ROW EXECUTE FUNCTION public.asignacion_porcentaje_con_base();

-- Y al revés: a un concepto con porcentajes propios vivos no se le quita la base ni deja de ser
-- descuento (mira la transición, no el estado: sin porcentajes propios, se cambia libremente).
CREATE FUNCTION public.concepto_base_de_porcentajes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (NEW.concepto_base_id IS NULL OR NEW.signo <> -1)
     AND (OLD.concepto_base_id IS NOT NULL AND OLD.signo = -1)
     AND EXISTS (SELECT 1 FROM public.asignacion_concepto a
                  WHERE a.concepto_id = NEW.id AND a.deleted_at IS NULL
                    AND a.porcentaje_override_bp IS NOT NULL) THEN
    RAISE EXCEPTION 'hay familias con un porcentaje propio sobre la base de este descuento'
      USING ERRCODE = '23514', HINT = 'concepto_con_porcentajes_propios';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.concepto_base_de_porcentajes() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER concepto_base_de_porcentajes
  BEFORE UPDATE OF concepto_base_id, signo ON public.conceptos_cobro
  FOR EACH ROW EXECUTE FUNCTION public.concepto_base_de_porcentajes();

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

    -- PR-7: el método es el de la FICHA de la familia (familias.metodo_pago, que nunca es NULL),
    -- salvo que ese mes tenga una EXCEPCIÓN (metodo_pago_familia: el selector de la lista de
    -- recibos). Se congela en el recibo al generar, como antes.
    v_metodo := NULL;
    SELECT metodo INTO v_metodo FROM public.metodo_pago_familia
      WHERE familia_id = r_fam.familia_id AND anio = p_anio AND mes = p_mes AND deleted_at IS NULL
      LIMIT 1;
    IF v_metodo IS NULL THEN
      SELECT f.metodo_pago INTO v_metodo FROM public.familias f WHERE f.id = r_fam.familia_id;
    END IF;

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
      -- PR-8: el tipo y el valor del descuento se eligen en la ASIGNACIÓN (por familia o por
      -- niño). Un porcentaje propio lo hace porcentual sobre la base del concepto; un importe
      -- propio, fijo; sin ninguno de los dos (nunca van juntos, CHECK), manda el catálogo.
      SELECT a.nino_id AS asig_nino, a.importe_override_centimos,
             c.id AS concepto_id, c.nombre, c.ambito,
             CASE WHEN a.porcentaje_override_bp IS NOT NULL THEN 'porcentaje'
                  WHEN a.importe_override_centimos IS NOT NULL THEN 'fijo'
                  ELSE c.tipo_valor END AS tipo_valor,
             COALESCE(a.porcentaje_override_bp, c.porcentaje_bp) AS porcentaje_bp,
             c.importe_centimos, c.concepto_base_id
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
                            'anio', d.anio, 'mes', d.mes,
                            'cuota_total_centimos', d.cuota_total_centimos,
                            'beca_total_centimos', d.beca_total_centimos,
                            'exceso_centimos', d.exceso_centimos,
                            'estado', d.estado, 'via', d.via, 'resuelto_en', d.resuelto_at)
                          ORDER BY d.anio, d.mes)
                     FROM public.beca_comedor_desborde d
                    WHERE d.familia_id = f.id), '[]'::jsonb),
                 'beca_comedor_transferencias', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'anio', bt.anio, 'mes', bt.mes,
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

      'becas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'tipo_beca', tb.nombre, 'importe_centimos', b.importe_centimos,
                 'fecha_desde', b.fecha_desde, 'fecha_hasta', b.fecha_hasta)
               ORDER BY b.fecha_desde)
          FROM public.becas b
          JOIN public.tipos_beca tb ON tb.id = b.tipo_beca_id
         WHERE b.nino_id = p_sujeto_id AND b.deleted_at IS NULL), '[]'::jsonb),

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
  v_md5 text;
BEGIN
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.generar_recibos_mes(uuid,integer,integer)');
  IF v_md5 IS DISTINCT FROM '7667d37ac98d54b5920b2ae4d7aff350' THEN
    RAISE EXCEPTION 'generar_recibos_mes no quedó como este fichero: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.export_datos_sujeto(text,uuid)');
  IF v_md5 IS DISTINCT FROM 'b0a2b7088da6f33fa59e0de13111e03a' THEN
    RAISE EXCEPTION 'export_datos_sujeto no quedó como este fichero: %', coalesce(v_md5, 'falta');
  END IF;
  IF NOT (SELECT bool_and(prosecdef) FROM pg_proc WHERE oid IN (
            'public.generar_recibos_mes(uuid,integer,integer)'::regprocedure,
            'public.export_datos_sujeto(text,uuid)'::regprocedure,
            'public.asignacion_porcentaje_con_base()'::regprocedure,
            'public.concepto_base_de_porcentajes()'::regprocedure)) THEN
    RAISE EXCEPTION 'el motor, el export y los dos triggers tienen que ser SECURITY DEFINER';
  END IF;
  -- CREATE OR REPLACE conserva los permisos: authenticated llama al motor y al export, anon no;
  -- los triggers no los ejecuta nadie por RPC.
  IF has_function_privilege('anon', 'public.generar_recibos_mes(uuid,integer,integer)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('anon', 'public.export_datos_sujeto(text,uuid)'::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.generar_recibos_mes(uuid,integer,integer)'::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.export_datos_sujeto(text,uuid)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.asignacion_porcentaje_con_base()'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.concepto_base_de_porcentajes()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'permisos de las funciones distintos de los esperados';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.asignacion_concepto'::regclass
                  AND attname = 'porcentaje_override_bp' AND atttypid = 'integer'::regtype AND NOT attnotnull)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.asignacion_concepto'::regclass
                     AND conname = 'asignacion_concepto_un_valor_propio')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.asignacion_concepto'::regclass
                     AND conname = 'asignacion_concepto_porcentaje_override_bp_check') THEN
    RAISE EXCEPTION 'asignacion_concepto.porcentaje_override_bp no quedó con sus dos CHECK';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
        ('asignacion_porcentaje_con_base', 'concepto_base_de_porcentajes')) <> 2 THEN
    RAISE EXCEPTION 'faltan los triggers de la base';
  END IF;
  -- El CHECK nuevo deja un descuento fijo con base, y sigue exigiendo base al porcentual.
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'public.conceptos_cobro'::regclass
        AND conname = 'conceptos_cobro_modelo_valor'))
     NOT LIKE '%((concepto_base_id IS NOT NULL) AND (signo = ''-1''::integer)) OR%' THEN
    RAISE EXCEPTION 'conceptos_cobro_modelo_valor no quedó como este fichero';
  END IF;
  IF col_description('public.asignacion_concepto'::regclass,
       (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.asignacion_concepto'::regclass
          AND attname = 'porcentaje_override_bp')) NOT LIKE 'PR-8: porcentaje propio%' THEN
    RAISE EXCEPTION 'el comentario de porcentaje_override_bp no quedó como este fichero';
  END IF;
  RAISE NOTICE 'guarda posterior: porcentaje propio, CHECK de la base, triggers, motor y export';
END
$guarda$;
