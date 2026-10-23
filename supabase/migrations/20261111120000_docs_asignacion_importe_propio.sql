-- =============================================================================
-- DOCS — Recibos, PR-6: el importe propio vive en la asignación
-- -----------------------------------------------------------------------------
-- PR-6 da pantalla a `asignacion_concepto.importe_override_centimos`, que el motor ya usaba y nadie
-- podía tocar: el importe propio de un niño (o de una familia, p. ej. su descuento por hermano) se
-- fija en su ASIGNACIÓN y se arrastra mes tras mes hasta que la directora lo cambie. Retocar la
-- línea del recibo sigue siendo la corrección de UN mes.
--
-- El comentario de la tabla decía lo contrario («la edición del mes es un override sobre el recibo
-- borrador, no sobre esta fila»), y la columna no tenía comentario. Solo se cambian comentarios:
-- ni esquema, ni datos, ni funciones.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor, DESPUÉS de
-- `20261110120000`. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_n integer;
BEGIN
  -- El comentario que se sustituye es el leído en producción.
  IF md5(obj_description('public.asignacion_concepto'::regclass, 'pg_class'))
     IS DISTINCT FROM '2042d6e12c00c908d822a09fa831835c' THEN
    RAISE EXCEPTION 'el comentario de asignacion_concepto no es el leído en producción';
  END IF;
  SELECT count(*) INTO v_n FROM public.asignacion_concepto WHERE importe_override_centimos IS NOT NULL;
  RAISE NOTICE 'asignaciones con importe propio antes de aplicar: %', v_n;
END
$guarda$;

COMMENT ON TABLE public.asignacion_concepto IS
  'F-4-2: asignación PERMANENTE (sin mes) de un concepto a un niño XOR familia. Sustituye a asignacion_cuota (que llevaba mes+modalidad). La periodicidad no vive aquí: sale de conceptos_cobro.tipo_concepto. origen=automatico lo siembra proponer_asignaciones(); manual lo añade la directora. El motor F-4-3 la materializa en líneas de recibo cada mes. El importe propio del niño o de la familia (importe_override_centimos) vive en ESTA fila y se arrastra cada mes (PR-6); retocar una línea del borrador corrige solo ese mes.';

COMMENT ON COLUMN public.asignacion_concepto.importe_override_centimos IS
  'PR-6: importe propio de esta asignación, en céntimos (por día en un concepto diario). El motor lo usa en lugar del precio del concepto, y de la tarifa por año, cada mes hasta que se cambie. Solo en conceptos de importe fijo: en uno porcentual el motor no lo usa. NULL = el precio del concepto.';

-- ---- Guarda posterior ----
DO $guarda$
BEGIN
  IF obj_description('public.asignacion_concepto'::regclass, 'pg_class') NOT LIKE '%vive en ESTA fila y se arrastra cada mes (PR-6)%'
     OR col_description('public.asignacion_concepto'::regclass,
          (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.asignacion_concepto'::regclass
             AND attname = 'importe_override_centimos')) NOT LIKE 'PR-6: importe propio%' THEN
    RAISE EXCEPTION 'los comentarios de asignacion_concepto no quedaron como este fichero';
  END IF;
  RAISE NOTICE 'guarda posterior: comentarios de asignacion_concepto';
END
$guarda$;
