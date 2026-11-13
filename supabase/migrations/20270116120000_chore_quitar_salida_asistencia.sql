-- =============================================================================
-- CHORE — Fuera la hora de salida del pase de lista (2026-11-13)
-- -----------------------------------------------------------------------------
-- El responsable no pidió nunca la hora de salida ni el estado «salida temprana», y no los quiere: se
-- quitan enteros, no se esconden. Revoca la parte de ADR-0014 y ADR-0015 que los afirmaba (los dos
-- quedan marcados como revocados en eso, no borrados).
--
--   · `asistencias.hora_salida` y su CHECK `asistencias_salida_posterior`, fuera.
--   · `estado_asistencia` sin `salida_temprana`. Postgres no quita un valor de un enum: se rehace el
--     tipo (el viejo se renombra, se crea el nuevo, la columna pasa al nuevo y el viejo se borra).
--     Lo único que usa el tipo es `asistencias.estado` (medido en producción: ni funciones, ni
--     vistas, ni políticas, ni otra columna).
--
-- No se pierde ningún dato: en producción hay 0 filas de asistencia (medido el 2026-11-13). Si al
-- aplicar hubiera alguna con salida, la guarda previa para y no toca nada.
--
-- ORDEN: mergear, esperar el despliegue, aplicar. La app de antes pide `hora_salida` al pintar el pase
-- de lista: con la columna quitada y esa app viva, el pase no sale. La app nueva no la nombra, y con la
-- columna todavía puesta funciona igual. La aplica el responsable por SQL Editor, copiando el fichero
-- de la rama. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_labels text;
  v_md5 text;
  v_cols int;
  v_fns int;
  v_con_salida int;
BEGIN
  SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) INTO v_labels
    FROM pg_enum WHERE enumtypid = to_regtype('public.estado_asistencia');
  IF v_labels IS DISTINCT FROM 'presente,ausente,llegada_tarde,salida_temprana' THEN
    RAISE EXCEPTION 'estado_asistencia no es el de antes: %', coalesce(v_labels, 'falta');
  END IF;

  SELECT md5(pg_get_constraintdef(oid)) INTO v_md5
    FROM pg_constraint
   WHERE conrelid = 'public.asistencias'::regclass AND conname = 'asistencias_salida_posterior';
  IF v_md5 IS DISTINCT FROM '29e529d4722303d704e63053ba162d36' THEN
    RAISE EXCEPTION 'asistencias_salida_posterior no es el de antes: %', coalesce(v_md5, 'falta');
  END IF;

  -- Lo único que usa el tipo es asistencias.estado.
  SELECT count(*) INTO v_cols
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
   WHERE a.atttypid = 'public.estado_asistencia'::regtype AND a.attnum > 0 AND NOT a.attisdropped
     AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND NOT (c.oid = 'public.asistencias'::regclass AND a.attname = 'estado');
  IF v_cols <> 0 THEN
    RAISE EXCEPTION 'estado_asistencia lo usa otra columna además de asistencias.estado: %', v_cols;
  END IF;
  SELECT count(*) INTO v_fns
    FROM pg_proc p
   WHERE p.prorettype = 'public.estado_asistencia'::regtype
      OR 'public.estado_asistencia'::regtype = ANY (p.proargtypes::oid[])
      OR p.prosrc ILIKE '%salida_temprana%'
      OR p.prosrc ILIKE '%hora_salida%';
  IF v_fns <> 0 THEN
    RAISE EXCEPTION 'hay % funciones que nombran la salida o el tipo', v_fns;
  END IF;

  -- No se borra ningún dato: ninguna fila con salida.
  SELECT count(*) INTO v_con_salida
    FROM public.asistencias
   WHERE estado::text = 'salida_temprana' OR hora_salida IS NOT NULL;
  IF v_con_salida <> 0 THEN
    RAISE EXCEPTION 'hay % asistencias con salida: no se quita nada', v_con_salida;
  END IF;

  RAISE NOTICE 'guarda previa: el enum y el CHECK son los de antes, solo los usa asistencias, 0 filas con salida';
END;
$guarda$;

ALTER TABLE public.asistencias DROP CONSTRAINT asistencias_salida_posterior;
ALTER TABLE public.asistencias DROP COLUMN hora_salida;

ALTER TYPE public.estado_asistencia RENAME TO estado_asistencia_con_salida;
CREATE TYPE public.estado_asistencia AS ENUM ('presente', 'ausente', 'llegada_tarde');
ALTER TABLE public.asistencias
  ALTER COLUMN estado TYPE public.estado_asistencia USING estado::text::public.estado_asistencia;
DROP TYPE public.estado_asistencia_con_salida;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_labels text;
  v_filas bigint;
BEGIN
  SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) INTO v_labels
    FROM pg_enum WHERE enumtypid = to_regtype('public.estado_asistencia');
  IF v_labels IS DISTINCT FROM 'presente,ausente,llegada_tarde' THEN
    RAISE EXCEPTION 'estado_asistencia no quedó en tres valores: %', coalesce(v_labels, 'falta');
  END IF;
  IF to_regtype('public.estado_asistencia_con_salida') IS NOT NULL THEN
    RAISE EXCEPTION 'el tipo viejo sigue ahí';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'public.asistencias'::regclass AND attname = 'hora_salida'
                AND NOT attisdropped) THEN
    RAISE EXCEPTION 'asistencias.hora_salida sigue ahí';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.asistencias'::regclass
                AND conname = 'asistencias_salida_posterior') THEN
    RAISE EXCEPTION 'asistencias_salida_posterior sigue ahí';
  END IF;
  IF (SELECT atttypid FROM pg_attribute
       WHERE attrelid = 'public.asistencias'::regclass AND attname = 'estado')
     IS DISTINCT FROM 'public.estado_asistencia'::regtype THEN
    RAISE EXCEPTION 'asistencias.estado no usa el tipo nuevo';
  END IF;
  SELECT count(*) INTO v_filas FROM public.asistencias;
  RAISE NOTICE 'guarda posterior: estado_asistencia = %, sin hora_salida ni su CHECK; asistencias: % filas', v_labels, v_filas;
END;
$guarda$;
