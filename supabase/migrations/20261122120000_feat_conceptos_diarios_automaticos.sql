-- =============================================================================
-- FEAT — Recibos, los conceptos diarios son automáticos: el día suelto lo tienen todos
-- -----------------------------------------------------------------------------
-- Decisión del responsable: «el niño va a comedor y no paga cuota mensual, se le cobra el día
-- suelto». El motor solo cobra los días del parte con el concepto diario ASIGNADO, así que el día
-- suelto lo tiene que tener todo el mundo: el parte manda, y a quien tiene la cuota mensual del
-- mismo servicio no se le cobra el día (PR-4). Un diario manual no lo tenía nadie y los días
-- apuntados en el parte no se cobraban.
--
--   · Los diarios que había pasan a `aplicacion = 'automatico'` (también los desactivados o
--     borrados: la regla vale para todas las filas).
--   · Se siembran ya a los niños, como `proponer_asignaciones` (la misma consulta, solo con los
--     diarios): sin esperar al siguiente «Recalcular el mes». Un niño que ya tuvo fila de ese
--     concepto, viva o borrada, no se toca (una baja manual se respeta, como en `proponer`).
--   · CHECK `conceptos_cobro_diario_automatico`: un diario no puede ser manual, para nadie. Así
--     no tiene botón de elegir niños (`fijar_asignaciones_concepto` solo acepta manuales) ni sale
--     en Asignación permanente, que solo ofrece manuales.
--
-- Operación sobre datos productivos → la aplica el responsable por SQL Editor, DESPUÉS de
-- `20261121120000`. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_n integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conceptos_cobro_diario_automatico') THEN
    RAISE EXCEPTION 'ya aplicada: existe conceptos_cobro_diario_automatico';
  END IF;
  -- La siembra copia la consulta de proponer_asignaciones: tiene que ser la leída en producción
  -- (md5 normalizado: sin \r, sin comentarios, espacios colapsados).
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.proponer_asignaciones(uuid)');
  IF v_md5 IS DISTINCT FROM '754fa64613e8cd17d2b451bd64fafd6f' THEN
    RAISE EXCEPTION 'proponer_asignaciones no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  -- Las filas sembradas no llevan centro: lo pone este trigger, como en proponer.
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.derivar_centro_id_nino_o_familia()');
  IF v_md5 IS DISTINCT FROM '5461ca1dac40487e8e0e24620117d9a9' THEN
    RAISE EXCEPTION 'derivar_centro_id_nino_o_familia no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT count(*) INTO v_n FROM public.conceptos_cobro WHERE tipo_concepto = 'diario' AND aplicacion <> 'automatico';
  RAISE NOTICE 'guarda previa: % conceptos diarios no automáticos', v_n;
END
$guarda$;

-- ---- Los diarios, automáticos ----
DO $diarios$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.conceptos_cobro
     SET aplicacion = 'automatico'
   WHERE tipo_concepto = 'diario' AND aplicacion <> 'automatico';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'diarios pasados a automático: %', v_n;
END
$diarios$;

-- ---- La siembra: la consulta de proponer_asignaciones, solo con los diarios ----
DO $siembra$
DECLARE
  r_concepto record;
  v_total integer := 0;
  v_n integer;
BEGIN
  FOR r_concepto IN
    SELECT id, centro_id, ambito, signo
    FROM public.conceptos_cobro
    WHERE tipo_concepto = 'diario'
      AND aplicacion = 'automatico'
      AND activo = true
      AND deleted_at IS NULL
  LOOP
    IF r_concepto.ambito = 'nino' THEN
      INSERT INTO public.asignacion_concepto (concepto_id, nino_id, origen)
      SELECT r_concepto.id, n.id, 'automatico'
      FROM public.ninos n
      JOIN public.matriculas m ON m.nino_id = n.id
      WHERE n.centro_id = r_concepto.centro_id
        AND m.estado = 'activa' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.asignacion_concepto a
          WHERE a.concepto_id = r_concepto.id AND a.nino_id = n.id
        );
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_total := v_total + v_n;

    ELSE  -- ambito = 'familia'
      INSERT INTO public.asignacion_concepto (concepto_id, familia_id, origen)
      SELECT r_concepto.id, f.id, 'automatico'
      FROM public.familias f
      WHERE f.centro_id = r_concepto.centro_id
        AND (
          SELECT count(*) FROM public.ninos n
          JOIN public.matriculas m ON m.nino_id = n.id
          WHERE n.familia_id = f.id
            AND m.estado = 'activa' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
        ) >= CASE WHEN r_concepto.signo = -1 THEN 2 ELSE 1 END
        AND NOT EXISTS (
          SELECT 1 FROM public.asignacion_concepto a
          WHERE a.concepto_id = r_concepto.id AND a.familia_id = f.id
        );
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_total := v_total + v_n;
    END IF;
  END LOOP;
  RAISE NOTICE 'asignaciones de diarios sembradas: %', v_total;
END
$siembra$;

-- ---- Un diario no puede ser manual ----
ALTER TABLE public.conceptos_cobro
  ADD CONSTRAINT conceptos_cobro_diario_automatico
  CHECK (tipo_concepto <> 'diario' OR aplicacion = 'automatico');

COMMENT ON CONSTRAINT conceptos_cobro_diario_automatico ON public.conceptos_cobro IS
  'El día suelto lo tienen todos: un concepto diario es automático, el parte decide qué días se cobran y a quien tiene el mensual del mismo servicio no se le cobran (PR-4; 20261122120000).';

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_n integer;
BEGIN
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'conceptos_cobro_diario_automatico')
     IS DISTINCT FROM 'CHECK (((tipo_concepto <> ''diario''::tipo_concepto) OR (aplicacion = ''automatico''::text)))' THEN
    RAISE EXCEPTION 'conceptos_cobro_diario_automatico no quedó como este fichero: %',
      (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'conceptos_cobro_diario_automatico');
  END IF;
  SELECT count(*) INTO v_n FROM public.conceptos_cobro WHERE tipo_concepto = 'diario' AND aplicacion <> 'automatico';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'quedan % diarios no automáticos', v_n;
  END IF;
  SELECT count(*) INTO v_n
    FROM public.asignacion_concepto a
    JOIN public.conceptos_cobro c ON c.id = a.concepto_id
   WHERE c.tipo_concepto = 'diario' AND a.deleted_at IS NULL;
  RAISE NOTICE 'guarda posterior: ningún diario manual; % asignaciones vivas de diarios', v_n;
END
$guarda$;
