-- =============================================================================
-- F8 — Cierra la forma legacy de autorizaciones_tipo_coherencia.
--
-- El rework de catálogo (20260607120000_phase8_rw0_catalogo) dejó en el CHECK una 5.ª forma,
-- la instancia por niño del modelo viejo (es_plantilla=false, plantilla_id y ambito NULL,
-- nino_id puesto), para no romper las filas de #56 hasta migrarlas
-- (20260608130000_phase8_migrar_reglas_56). En producción no queda ninguna fila en
-- autorizaciones, y ningún código crea ya esa forma: todas las instancias llevan plantilla y
-- ámbito (A y B2) o evento (salida). Decisión del responsable (2026-10-15): cerrar la puerta
-- ahora, que es barato. 20260608130000 queda como historia: sin la forma legacy no tiene
-- filas que enganchar.
--
-- Las otras cuatro formas no cambian. La 5.ª se quita entera, sin NOT VALID: si hubiera una
-- fila legacy, la guarda de entrada aborta antes con su número.
-- =============================================================================

-- 0. Guarda de entrada: el CHECK es exactamente el de RW-0 y no hay filas con la forma legacy.
DO $guarda$
DECLARE
  v_def    text;
  v_legacy int;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.autorizaciones'::regclass AND conname = 'autorizaciones_tipo_coherencia';
  IF md5(v_def) IS DISTINCT FROM '908308f6190f090768a905050da2ef0b' THEN
    RAISE EXCEPTION 'guarda de entrada: autorizaciones_tipo_coherencia no es el de RW-0 (md5 %)', md5(v_def);
  END IF;

  SELECT count(*) INTO v_legacy FROM public.autorizaciones
   WHERE es_plantilla = false AND plantilla_id IS NULL AND ambito IS NULL
     AND evento_id IS NULL AND nino_id IS NOT NULL AND aula_id IS NULL;
  IF v_legacy > 0 THEN
    RAISE EXCEPTION 'guarda de entrada: % fila(s) con la forma legacy; el CHECK nuevo no las admite', v_legacy;
  END IF;
  RAISE NOTICE 'guarda de entrada OK: CHECK de RW-0, % filas con la forma legacy', v_legacy;
END
$guarda$;

-- 1. El CHECK sin la forma legacy.
ALTER TABLE public.autorizaciones DROP CONSTRAINT autorizaciones_tipo_coherencia;
ALTER TABLE public.autorizaciones
  ADD CONSTRAINT autorizaciones_tipo_coherencia CHECK (
    -- (1) PLANTILLA durable de catálogo (formato estándar, no firmable)
    (es_plantilla = true
       AND tipo IN ('reglas_regimen_interno', 'autorizacion_imagenes', 'recogida', 'medicacion')
       AND evento_id IS NULL AND nino_id IS NULL AND aula_id IS NULL
       AND plantilla_id IS NULL AND ambito IS NULL)
    -- (2) INSTANCIA salida (bespoke por evento; la audiencia viene del evento)
    OR (es_plantilla = false AND tipo = 'salida'
       AND evento_id IS NOT NULL AND nino_id IS NULL AND aula_id IS NULL
       AND plantilla_id IS NULL AND ambito IS NULL)
    -- (3) INSTANCIA patrón A (reglas/imagenes enviadas a una audiencia)
    OR (es_plantilla = false AND tipo IN ('reglas_regimen_interno', 'autorizacion_imagenes')
       AND plantilla_id IS NOT NULL AND evento_id IS NULL AND ambito IS NOT NULL
       AND (
            (ambito = 'nino'   AND nino_id IS NOT NULL AND aula_id IS NULL)
         OR (ambito = 'aula'   AND aula_id IS NOT NULL AND nino_id IS NULL)
         OR (ambito = 'centro' AND nino_id IS NULL     AND aula_id IS NULL)
       ))
    -- (4) INSTANCIA patrón B2 (recogida/medicacion creada por el tutor desde la plantilla)
    OR (es_plantilla = false AND tipo IN ('recogida', 'medicacion')
       AND plantilla_id IS NOT NULL AND ambito = 'nino'
       AND nino_id IS NOT NULL AND evento_id IS NULL AND aula_id IS NULL)
  );

-- 2. Guarda de salida: las cuatro formas siguen y la legacy no.
DO $guarda$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.autorizaciones'::regclass AND conname = 'autorizaciones_tipo_coherencia'
     AND convalidated;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'guarda de salida: autorizaciones_tipo_coherencia no existe o no está validado';
  END IF;
  -- La forma legacy era la única con plantilla_id y ambito NULL junto a nino_id puesto.
  IF v_def LIKE '%(plantilla_id IS NULL) AND (ambito IS NULL) AND (evento_id IS NULL) AND (nino_id IS NOT NULL)%' THEN
    RAISE EXCEPTION 'guarda de salida: el CHECK sigue admitiendo la forma legacy';
  END IF;
  IF v_def NOT LIKE '%(es_plantilla = true)%'
     OR v_def NOT LIKE '%''salida''::tipo_autorizacion%'
     OR v_def NOT LIKE '%''centro''::autorizacion_ambito%'
     OR v_def NOT LIKE '%(ambito = ''nino''::autorizacion_ambito) AND (nino_id IS NOT NULL) AND (evento_id IS NULL)%' THEN
    RAISE EXCEPTION 'guarda de salida: falta alguna de las cuatro formas: %', v_def;
  END IF;
  RAISE NOTICE 'guarda de salida OK: CHECK sin forma legacy (md5 %)', md5(v_def);
END
$guarda$;
