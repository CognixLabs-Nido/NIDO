-- =============================================================================
-- FIX — Un recibo nace por defecto en borrador, no en pendiente de cobrar
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/altas-serie.md, «Las puertas del recibo» (decisión del responsable del
-- 2026-11-03: el estado por defecto tiene que ser el inocuo).
--
--   · El DEFAULT de `recibos.estado` era `pendiente_procesar`: un INSERT que no decía su estado
--     nacía «pendiente de cobrar», lo contrario de lo inocuo. Desde 20261223120000 (D) un recibo
--     nace en borrador, y ese INSERT lo rechazaba `recibo_nace_en_borrador`; el DEFAULT era un valor
--     que nadie puede insertar. Ahora es `borrador`, y un INSERT sin estado nace en borrador.
--   · Ninguna función ni la app dependen del DEFAULT: todas las que crean recibos dicen su estado
--     (medido en producción el 2026-11-03: crear_recibo_esporadico, anadir_cargo_puntual,
--     generar_recibos_mes, resolver_devolucion, resolver_sobrante_cheque y la acción de la línea
--     manual). Solo cambia el valor por defecto: ninguna fila existente se toca.
--
-- La aplica el responsable por SQL Editor, después de 20261223120000. Sin BEGIN ni COMMIT. Tras
-- aplicar: registrar en supabase_migrations.schema_migrations. La app no cambia: el orden de aplicar
-- y mergear da igual.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_default text;
BEGIN
  SELECT column_default INTO v_default
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'recibos' AND column_name = 'estado';
  RAISE NOTICE 'DEFAULT de recibos.estado antes: %', v_default;
  IF v_default IS DISTINCT FROM '''pendiente_procesar''::estado_recibo' THEN
    RAISE EXCEPTION 'el DEFAULT de recibos.estado no es el esperado (ya aplicada?): %', v_default;
  END IF;
  IF to_regprocedure('public.recibos_dinero_solo_por_funcion()') IS NULL THEN
    RAISE EXCEPTION 'falta 20261223120000 (recibos_dinero_solo_por_funcion)';
  END IF;
END
$guarda$;

ALTER TABLE public.recibos ALTER COLUMN estado SET DEFAULT 'borrador';

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_default text;
BEGIN
  SELECT column_default INTO v_default
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'recibos' AND column_name = 'estado';
  RAISE NOTICE 'DEFAULT de recibos.estado después: %', v_default;
  IF v_default IS DISTINCT FROM '''borrador''::estado_recibo' THEN
    RAISE EXCEPTION 'el DEFAULT de recibos.estado no quedó en borrador: %', v_default;
  END IF;
END
$guarda$;
