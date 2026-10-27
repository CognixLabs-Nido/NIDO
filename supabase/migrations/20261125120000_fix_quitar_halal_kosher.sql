-- =============================================================================
-- FIX — `tipo_alimentacion` sin `religiosa_halal` ni `religiosa_kosher`
-- -----------------------------------------------------------------------------
-- Decisión del responsable (F11-B, punto 7, opción B): se quitan. Revelan convicciones religiosas
-- (categoría especial, art. 9 RGPD) y nadie los necesita: en producción, a 2026-10-26, ninguna
-- ficha los usa, ni hay rastro de ellos en `audit_log` ni en `cambios_pendientes`. El comedor,
-- los menús y la agenda no leen `tipo_alimentacion`. Lo que el niño puede comer lo dicen `otra`
-- (que exige observaciones) y `alimentacion_observaciones`.
--
-- Postgres no quita valores de un enum: se crea el tipo sin ellos, se pasa la columna (la única
-- que lo usa, `datos_pedagogicos_nino.tipo_alimentacion`) y se borra el viejo. El CHECK
-- `alimentacion_otra_requiere_obs` compara con `'otra'::tipo_alimentacion`, así que se quita
-- antes del cambio de tipo y se vuelve a crear igual después.
--
-- La aplica el responsable por SQL Editor, DESPUÉS de `20261124120000`. Tras aplicar:
-- registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_n integer;
  v_md5 text;
BEGIN
  IF (SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) FROM pg_enum
       WHERE enumtypid = 'public.tipo_alimentacion'::regtype)
     = 'omnivora,vegetariana,vegana,sin_lactosa,sin_gluten,otra' THEN
    RAISE EXCEPTION 'ya aplicada: tipo_alimentacion no tiene halal ni kosher';
  END IF;
  IF (SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) FROM pg_enum
       WHERE enumtypid = 'public.tipo_alimentacion'::regtype)
     IS DISTINCT FROM 'omnivora,vegetariana,vegana,sin_lactosa,sin_gluten,religiosa_halal,religiosa_kosher,otra' THEN
    RAISE EXCEPTION 'tipo_alimentacion no es el leído en producción';
  END IF;

  -- Lo único que usa el tipo: una columna, sin funciones ni arrays.
  SELECT count(*) INTO v_n FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
   WHERE a.atttypid IN ('public.tipo_alimentacion'::regtype, 'public._tipo_alimentacion'::regtype)
     AND NOT a.attisdropped;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'tipo_alimentacion lo usan % columnas (esperaba 1)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc
   WHERE prorettype = 'public.tipo_alimentacion'::regtype
      OR 'public.tipo_alimentacion'::regtype = ANY(proargtypes);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'tipo_alimentacion aparece en la firma de % funciones', v_n;
  END IF;

  -- El CHECK que se recrea tiene que ser el leído en producción.
  SELECT md5(pg_get_constraintdef(c.oid)) INTO v_md5 FROM pg_constraint c
   WHERE c.conrelid = 'public.datos_pedagogicos_nino'::regclass
     AND c.conname = 'alimentacion_otra_requiere_obs';
  IF v_md5 IS DISTINCT FROM '56ceee3496cf7ebe3c95309bacc5e35b' THEN
    RAISE EXCEPTION 'alimentacion_otra_requiere_obs no es el leído en producción: %', coalesce(v_md5, 'falta');
  END IF;

  -- Los dos valores siguen sin usarse en ningún sitio (si alguno aparece, no se decide aquí).
  SELECT count(*) INTO v_n FROM public.datos_pedagogicos_nino
   WHERE tipo_alimentacion::text IN ('religiosa_halal', 'religiosa_kosher');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% fichas usan halal o kosher', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.audit_log
   WHERE tabla = 'datos_pedagogicos_nino'
     AND (coalesce(valores_antes ->> 'tipo_alimentacion', '') IN ('religiosa_halal', 'religiosa_kosher')
       OR coalesce(valores_despues ->> 'tipo_alimentacion', '') IN ('religiosa_halal', 'religiosa_kosher'));
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% filas de audit_log con halal o kosher', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.cambios_pendientes
   WHERE payload::text ~ 'religiosa_(halal|kosher)'
      OR coalesce(valor_propuesto::text, '') ~ 'religiosa_(halal|kosher)';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% cambios pendientes con halal o kosher', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.datos_pedagogicos_nino;
  RAISE NOTICE 'guarda previa: 0 fichas, 0 filas de audit_log y 0 cambios pendientes con halal o kosher; % fichas en total', v_n;
END
$guarda$;

-- ---- El tipo sin los dos valores ----
ALTER TYPE public.tipo_alimentacion RENAME TO tipo_alimentacion_old;

CREATE TYPE public.tipo_alimentacion AS ENUM (
  'omnivora', 'vegetariana', 'vegana', 'sin_lactosa', 'sin_gluten', 'otra'
);

ALTER TABLE public.datos_pedagogicos_nino DROP CONSTRAINT alimentacion_otra_requiere_obs;

ALTER TABLE public.datos_pedagogicos_nino
  ALTER COLUMN tipo_alimentacion TYPE public.tipo_alimentacion
  USING tipo_alimentacion::text::public.tipo_alimentacion;

ALTER TABLE public.datos_pedagogicos_nino
  ADD CONSTRAINT alimentacion_otra_requiere_obs CHECK (
    tipo_alimentacion <> 'otra'
    OR (alimentacion_observaciones IS NOT NULL AND length(trim(alimentacion_observaciones)) > 0)
  );

DROP TYPE public.tipo_alimentacion_old;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_n integer;
  v_md5 text;
  v_reparto text;
BEGIN
  IF (SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) FROM pg_enum
       WHERE enumtypid = 'public.tipo_alimentacion'::regtype)
     IS DISTINCT FROM 'omnivora,vegetariana,vegana,sin_lactosa,sin_gluten,otra' THEN
    RAISE EXCEPTION 'tipo_alimentacion no quedó con los seis valores';
  END IF;
  IF to_regtype('public.tipo_alimentacion_old') IS NOT NULL THEN
    RAISE EXCEPTION 'queda el tipo viejo tipo_alimentacion_old';
  END IF;
  IF (SELECT a.atttypid FROM pg_attribute a
       WHERE a.attrelid = 'public.datos_pedagogicos_nino'::regclass
         AND a.attname = 'tipo_alimentacion')
     IS DISTINCT FROM 'public.tipo_alimentacion'::regtype THEN
    RAISE EXCEPTION 'datos_pedagogicos_nino.tipo_alimentacion no usa el tipo nuevo';
  END IF;
  IF NOT (SELECT a.attnotnull FROM pg_attribute a
           WHERE a.attrelid = 'public.datos_pedagogicos_nino'::regclass
             AND a.attname = 'tipo_alimentacion') THEN
    RAISE EXCEPTION 'datos_pedagogicos_nino.tipo_alimentacion perdió el NOT NULL';
  END IF;

  SELECT md5(pg_get_constraintdef(c.oid)) INTO v_md5 FROM pg_constraint c
   WHERE c.conrelid = 'public.datos_pedagogicos_nino'::regclass
     AND c.conname = 'alimentacion_otra_requiere_obs';
  IF v_md5 IS DISTINCT FROM '56ceee3496cf7ebe3c95309bacc5e35b' THEN
    RAISE EXCEPTION 'alimentacion_otra_requiere_obs no quedó igual: %', coalesce(v_md5, 'falta');
  END IF;

  SELECT coalesce(sum(n), 0), coalesce(string_agg(t || '=' || n, ', '), 'ninguna') INTO v_n, v_reparto
    FROM (SELECT tipo_alimentacion::text t, count(*) n FROM public.datos_pedagogicos_nino
           GROUP BY 1 ORDER BY 1) x;
  RAISE NOTICE 'guarda posterior: tipo_alimentacion con 6 valores, CHECK igual; % fichas: %', v_n, v_reparto;
END
$guarda$;
