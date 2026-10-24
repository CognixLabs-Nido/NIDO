-- =============================================================================
-- FEAT — Recibos, PR-13: cargo puntual a varios niños de golpe
-- -----------------------------------------------------------------------------
-- Las excursiones y similares son cargos puntuales que Dirección añade a todos o a algunos niños
-- cuando toca. Hasta ahora había que ir recibo por recibo, línea a línea: si la excursión era de un
-- aula entera, veinte veces lo mismo.
--
-- No son los «proyectos y materiales»: esos son conceptos normales, mensuales y fijos, como la
-- escolaridad, y los pone el motor. Esto es lo puntual.
--
--   · `anadir_cargo_puntual(centro, año, mes, niños, descripción, importe, concepto?)`: por cada
--     niño, una línea MANUAL (`origen = 'manual'`, que el motor respeta al regenerar, R-2) en el
--     recibo regular del mes de su familia, colgada del niño. El concepto, si viene, es un
--     esporádico del catálogo del centro (el motor no los genera: son justo lo puntual).
--       - Familia con el recibo en BORRADOR: la línea entra en él.
--       - Familia sin recibo ese mes: se le crea la carcasa en borrador (con el método congelado
--         igual que el motor: la excepción del mes o el de la ficha) y la línea entra en ella.
--       - Familia con el recibo ya VALIDADO: no se toca; sale «no incluida», con su estado.
--       - El niño que ya tiene esa misma línea manual (misma descripción e importe) en el
--         borrador sale «ya incluido» y no se duplica: repetir el envío no cobra dos veces.
--     Todo en una transacción: o entran todos los que pueden, o ninguno. Recalcula el total de
--     cada recibo tocado.
--   · `SECURITY INVOKER`: la RLS de `recibos` y `lineas_recibo` (solo Dirección) y el congelado por
--     estado siguen actuando. Puerta propia: `es_admin` del centro pedido, si no 42501; con centro
--     NULL también 42501 (`es_admin(NULL)` da TRUE a cualquier persona de Dirección). Un niño de
--     otro centro (o de baja en la ficha) hace fallar TODO el cargo con 42501. Un mes cerrado no
--     admite cargos (P0001, «mes cerrado»).
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor, DESPUÉS de
-- `20261115120000`. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_n integer;
BEGIN
  IF to_regprocedure('public.anadir_cargo_puntual(uuid, integer, integer, uuid[], text, integer, uuid)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'anadir_cargo_puntual') THEN
    RAISE EXCEPTION 'ya aplicada: existe anadir_cargo_puntual';
  END IF;
  -- Los helpers y triggers de los que depende son los leídos en producción (md5 normalizado: sin
  -- \r, sin comentarios, espacios colapsados).
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.es_admin(uuid)');
  IF v_md5 IS DISTINCT FROM 'da96f192cef9402cf0618ea2cbd82902' THEN
    RAISE EXCEPTION 'es_admin no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.mes_cerrado(uuid, integer, integer)');
  IF v_md5 IS DISTINCT FROM 'd11fd48ea47d8ca2dfbf2617ba0186e8' THEN
    RAISE EXCEPTION 'mes_cerrado no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.congelar_si_mes_cerrado()');
  IF v_md5 IS DISTINCT FROM '2e4c101653c8456a89a04fed2e5245f6' THEN
    RAISE EXCEPTION 'congelar_si_mes_cerrado no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.derivar_centro_id_de_recibo_familia()');
  IF v_md5 IS DISTINCT FROM '07913fae9fd9456bf26aa385698ab102' THEN
    RAISE EXCEPTION 'derivar_centro_id_de_recibo_familia no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  -- «El recibo regular del mes de la familia» es inequívoco por este índice único.
  IF (SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_recibos_regular_familia_unico')
     IS DISTINCT FROM 'CREATE UNIQUE INDEX idx_recibos_regular_familia_unico ON public.recibos USING btree (familia_id, anio, mes) WHERE ((NOT es_esporadico) AND (devuelto_de_recibo_id IS NULL) AND (deleted_at IS NULL))' THEN
    RAISE EXCEPTION 'idx_recibos_regular_familia_unico no es el leído en producción';
  END IF;
  -- Todo niño tiene familia.
  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'ninos' AND column_name = 'familia_id') IS DISTINCT FROM 'NO' THEN
    RAISE EXCEPTION 'ninos.familia_id admite NULL';
  END IF;
  SELECT count(*) INTO v_n FROM public.recibos
   WHERE NOT es_esporadico AND devuelto_de_recibo_id IS NULL AND deleted_at IS NULL AND estado = 'borrador';
  RAISE NOTICE 'guarda previa: % recibos regulares en borrador', v_n;
END
$guarda$;

CREATE FUNCTION public.anadir_cargo_puntual(
  p_centro_id uuid,
  p_anio integer,
  p_mes integer,
  p_nino_ids uuid[],
  p_descripcion text,
  p_importe_centimos integer,
  p_concepto_id uuid DEFAULT NULL
)
RETURNS TABLE (
  nino_id uuid,
  familia_id uuid,
  familia_etiqueta text,
  recibo_id uuid,
  resultado text,
  estado text
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $function$
#variable_conflict use_column
DECLARE
  v_desc text := btrim(p_descripcion);
  v_n integer;
  v_recibo uuid;
  v_estado public.estado_recibo;
  v_metodo public.metodo_pago;
  v_nuevo boolean;
  r_fam record;
  r_nino record;
BEGIN
  IF p_centro_id IS NULL OR NOT public.es_admin(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado: solo Dirección del centro' USING ERRCODE = '42501';
  END IF;
  IF p_anio IS NULL OR p_anio NOT BETWEEN 2024 AND 2100 OR p_mes IS NULL OR p_mes NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'cargo puntual: mes no válido' USING ERRCODE = '22023';
  END IF;
  IF v_desc IS NULL OR char_length(v_desc) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'cargo puntual: descripción vacía o de más de 200 caracteres' USING ERRCODE = '22023';
  END IF;
  IF p_importe_centimos IS NULL OR p_importe_centimos NOT BETWEEN 1 AND 10000000 THEN
    RAISE EXCEPTION 'cargo puntual: importe fuera de rango' USING ERRCODE = '22023';
  END IF;
  IF p_nino_ids IS NULL OR cardinality(p_nino_ids) NOT BETWEEN 1 AND 1000
     OR array_position(p_nino_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'cargo puntual: lista de niños vacía o no válida' USING ERRCODE = '22023';
  END IF;
  IF public.mes_cerrado(p_centro_id, p_anio, p_mes) THEN
    RAISE EXCEPTION 'mes cerrado: % no admite cargos', to_char(make_date(p_anio, p_mes, 1), 'YYYY-MM')
      USING ERRCODE = 'P0001';
  END IF;
  IF p_concepto_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.conceptos_cobro c
     WHERE c.id = p_concepto_id AND c.centro_id = p_centro_id AND c.deleted_at IS NULL
       AND c.tipo_concepto = 'esporadico'
  ) THEN
    RAISE EXCEPTION 'cargo puntual: el concepto no es un esporádico de este centro' USING ERRCODE = '22023';
  END IF;

  -- Todos los niños son de este centro, y su familia también. Uno solo de fuera tumba el cargo.
  SELECT count(*) INTO v_n
    FROM public.ninos n JOIN public.familias f ON f.id = n.familia_id
   WHERE n.id = ANY (p_nino_ids) AND n.centro_id = p_centro_id AND n.deleted_at IS NULL
     AND f.centro_id = p_centro_id AND f.deleted_at IS NULL;
  IF v_n <> (SELECT count(DISTINCT x.id) FROM unnest(p_nino_ids) AS x(id)) THEN
    RAISE EXCEPTION 'no autorizado: hay niños que no son de este centro' USING ERRCODE = '42501';
  END IF;

  -- Por familia, en orden de id (los bloqueos siempre en el mismo orden).
  FOR r_fam IN
    SELECT f.id, f.etiqueta, f.metodo_pago
      FROM public.familias f
     WHERE f.id IN (SELECT n.familia_id FROM public.ninos n WHERE n.id = ANY (p_nino_ids))
     ORDER BY f.id
  LOOP
    v_nuevo := false;
    v_recibo := NULL;
    v_estado := NULL;
    SELECT r.id, r.estado INTO v_recibo, v_estado
      FROM public.recibos r
     WHERE r.familia_id = r_fam.id AND r.anio = p_anio AND r.mes = p_mes
       AND NOT r.es_esporadico AND r.devuelto_de_recibo_id IS NULL AND r.deleted_at IS NULL
       FOR UPDATE;

    IF v_recibo IS NULL THEN
      -- La carcasa, como la crea el motor: método congelado, la excepción del mes si la hay; si
      -- no, el de la ficha de la familia (PR-7).
      v_metodo := NULL;
      SELECT mp.metodo INTO v_metodo FROM public.metodo_pago_familia mp
       WHERE mp.familia_id = r_fam.id AND mp.anio = p_anio AND mp.mes = p_mes AND mp.deleted_at IS NULL
       LIMIT 1;
      IF v_metodo IS NULL THEN
        v_metodo := r_fam.metodo_pago;
      END IF;
      INSERT INTO public.recibos
        (centro_id, familia_id, nino_id, anio, mes, metodo, estado, total_centimos, es_esporadico)
        VALUES (p_centro_id, r_fam.id, NULL, p_anio, p_mes, v_metodo, 'borrador', 0, false)
        RETURNING id INTO v_recibo;
      v_estado := 'borrador';
      v_nuevo := true;
    END IF;

    FOR r_nino IN
      SELECT n.id FROM public.ninos n
       WHERE n.id = ANY (p_nino_ids) AND n.familia_id = r_fam.id
       ORDER BY n.id
    LOOP
      nino_id := r_nino.id;
      familia_id := r_fam.id;
      familia_etiqueta := r_fam.etiqueta;
      recibo_id := v_recibo;
      estado := v_estado::text;
      IF v_estado <> 'borrador' THEN
        resultado := 'no_incluido';
      ELSIF EXISTS (
        SELECT 1 FROM public.lineas_recibo l
         WHERE l.recibo_id = v_recibo AND l.nino_id = r_nino.id AND l.origen = 'manual'
           AND l.descripcion = v_desc AND l.importe_centimos = p_importe_centimos
      ) THEN
        resultado := 'ya_incluido';
      ELSE
        INSERT INTO public.lineas_recibo
          (centro_id, recibo_id, nino_id, concepto_id, descripcion, cantidad,
           precio_unitario_centimos, importe_centimos, origen)
          VALUES (p_centro_id, v_recibo, r_nino.id, p_concepto_id, v_desc, 1,
           p_importe_centimos, p_importe_centimos, 'manual');
        resultado := CASE WHEN v_nuevo THEN 'recibo_nuevo' ELSE 'incluido' END;
      END IF;
      RETURN NEXT;
    END LOOP;

    IF v_estado = 'borrador' THEN
      UPDATE public.recibos r
         SET total_centimos = (SELECT COALESCE(SUM(l.importe_centimos), 0)
                                 FROM public.lineas_recibo l WHERE l.recibo_id = v_recibo)
       WHERE r.id = v_recibo;
    END IF;
  END LOOP;
END
$function$;

REVOKE ALL ON FUNCTION public.anadir_cargo_puntual(uuid, integer, integer, uuid[], text, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anadir_cargo_puntual(uuid, integer, integer, uuid[], text, integer, uuid) TO authenticated;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_f constant regprocedure := 'public.anadir_cargo_puntual(uuid, integer, integer, uuid[], text, integer, uuid)'::regprocedure;
  v_md5 text;
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'anadir_cargo_puntual') <> 1 THEN
    RAISE EXCEPTION 'anadir_cargo_puntual tiene más de una firma';
  END IF;
  -- La lógica de la función (md5 normalizado), calculada en Postgres sobre el cuerpo creado.
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = v_f;
  IF v_md5 IS DISTINCT FROM 'edff020ad5723ddf64e76dcbd9662852' THEN
    RAISE EXCEPTION 'anadir_cargo_puntual no quedó como este fichero: %', v_md5;
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_f) THEN
    RAISE EXCEPTION 'anadir_cargo_puntual es SECURITY DEFINER: debe ser INVOKER (la RLS manda)';
  END IF;
  IF (SELECT proconfig FROM pg_proc WHERE oid = v_f) IS DISTINCT FROM ARRAY['search_path=public'] THEN
    RAISE EXCEPTION 'anadir_cargo_puntual sin search_path = public';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = v_f) <> 'v' THEN
    RAISE EXCEPTION 'anadir_cargo_puntual no es VOLATILE';
  END IF;
  IF has_function_privilege('anon', v_f, 'EXECUTE') OR has_function_privilege('public', v_f, 'EXECUTE') THEN
    RAISE EXCEPTION 'anadir_cargo_puntual abierta a anon o a PUBLIC';
  END IF;
  IF NOT has_function_privilege('authenticated', v_f, 'EXECUTE') THEN
    RAISE EXCEPTION 'anadir_cargo_puntual no la puede ejecutar authenticated';
  END IF;
  IF (SELECT proargnames FROM pg_proc WHERE oid = v_f) IS DISTINCT FROM
     ARRAY['p_centro_id', 'p_anio', 'p_mes', 'p_nino_ids', 'p_descripcion', 'p_importe_centimos',
           'p_concepto_id', 'nino_id', 'familia_id', 'familia_etiqueta', 'recibo_id', 'resultado', 'estado'] THEN
    RAISE EXCEPTION 'anadir_cargo_puntual no tiene los argumentos de este fichero';
  END IF;
  RAISE NOTICE 'guarda posterior: anadir_cargo_puntual INVOKER, solo para authenticated';
END
$guarda$;
