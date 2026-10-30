-- =============================================================================
-- FEAT — Cada pasada del cron de retención deja su fila (F11-B)
-- -----------------------------------------------------------------------------
-- Hasta ahora no había forma de saber desde la base si el cron de retención corre ni en qué modo:
-- `retencion_ejecuciones` solo recibe una fila por cada cosa vencida que encuentra
-- `barrerRetencion` (uno de los doce barridos), los otros once no dejan nada, y el resultado de la
-- pasada iba a `logger.info`, que en producción no escribe. Medido el 2026-10-30: el cron corre a
-- las 03:00 UTC, `RETENCION_DRY_RUN` no existe en Vercel (así que simula siempre) y la tabla estaba
-- vacía porque no había nada vencido.
--
--   · `retencion_pasadas`: una fila por pasada, encuentre algo o no. Cuándo (`ejecutada_en`), en
--     qué modo (`modo`: `simulado` o `purgado`, el mismo tipo que `retencion_ejecuciones`) y el
--     recuento de cada uno de los doce barridos (`recuentos`, con las doce claves obligatorias).
--     Solo recuentos: ni ids ni datos personales, así que no tiene centro, no se audita y no
--     caduca.
--   · Solo la escribe y la lee `service_role` (la ruta del cron). Las sesiones no tienen ningún
--     privilegio, y `service_role` no puede cambiar ni borrar una pasada: el registro solo crece.
--
-- La aplica el responsable por SQL Editor. Tras aplicar: registrar en
-- supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
BEGIN
  IF to_regclass('public.retencion_pasadas') IS NOT NULL THEN
    RAISE EXCEPTION 'ya aplicada: existe retencion_pasadas';
  END IF;
  -- El modo reusa el tipo de `retencion_ejecuciones`, con sus dos valores.
  IF to_regtype('public.retencion_accion') IS NULL
     OR (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) FROM pg_enum e
          WHERE e.enumtypid = 'public.retencion_accion'::regtype)
        IS DISTINCT FROM ARRAY['simulado', 'purgado'] THEN
    RAISE EXCEPTION 'retencion_accion no es (simulado, purgado)';
  END IF;
  RAISE NOTICE 'guarda previa: % filas en retencion_ejecuciones',
    (SELECT count(*) FROM public.retencion_ejecuciones);
END
$guarda$;

-- ---- 1. El registro de pasadas ----
CREATE TABLE public.retencion_pasadas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ejecutada_en timestamptz NOT NULL DEFAULT now(),
  modo         public.retencion_accion NOT NULL,
  recuentos    jsonb NOT NULL CONSTRAINT retencion_pasadas_recuentos_check
                 CHECK (jsonb_typeof(recuentos) = 'object'
                        AND recuentos ?& ARRAY['olvido', 'retencion', 'lecturasFichaMedica',
                                               'auditLog', 'exportLog', 'listaEspera', 'operativa',
                                               'expediente', 'firmas', 'cuentas', 'fiscal',
                                               'cuentasOlvidadas'])
);
CREATE INDEX retencion_pasadas_ejecutada_idx ON public.retencion_pasadas (ejecutada_en DESC);

-- Sin políticas: la escribe y la lee solo service_role, que no puede cambiarla ni borrarla.
ALTER TABLE public.retencion_pasadas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retencion_pasadas FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.retencion_pasadas TO service_role;

COMMENT ON TABLE public.retencion_pasadas IS
  'Una fila por pasada del cron de retención (api/cron/retencion), encuentre algo o no: cuándo, en qué modo (simulado o purgado) y el recuento de cada uno de los doce barridos. Solo recuentos, sin datos personales: no se audita ni caduca. Solo service_role inserta y lee; nadie la cambia ni la borra (20261213120000).';

-- ---- Guarda posterior ----
DO $guarda$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.retencion_pasadas'::regclass) THEN
    RAISE EXCEPTION 'retencion_pasadas sin RLS';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.retencion_pasadas'::regclass) THEN
    RAISE EXCEPTION 'retencion_pasadas tiene políticas';
  END IF;
  -- service_role inserta y lee, y nada más.
  IF NOT has_table_privilege('service_role', 'public.retencion_pasadas', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.retencion_pasadas', 'SELECT')
     OR has_table_privilege('service_role', 'public.retencion_pasadas', 'UPDATE')
     OR has_table_privilege('service_role', 'public.retencion_pasadas', 'DELETE')
     OR has_table_privilege('service_role', 'public.retencion_pasadas', 'TRUNCATE') THEN
    RAISE EXCEPTION 'service_role no tiene solo SELECT e INSERT en retencion_pasadas';
  END IF;
  -- Las sesiones y PUBLIC, ninguno.
  IF EXISTS (SELECT 1 FROM (VALUES ('anon'), ('authenticated')) r(rol)
              CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
                                 ('REFERENCES'), ('TRIGGER')) p(priv)
              WHERE has_table_privilege(r.rol, 'public.retencion_pasadas', p.priv))
     OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
                 WHERE c.oid = 'public.retencion_pasadas'::regclass AND a.grantee = 0) THEN
    RAISE EXCEPTION 'una sesión o PUBLIC tiene privilegios en retencion_pasadas';
  END IF;
  -- Sin trigger de auditoría: lo que no tiene datos personales no entra en audit_log.
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.retencion_pasadas'::regclass
               AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'retencion_pasadas tiene triggers';
  END IF;

  RAISE NOTICE 'guarda posterior: retencion_pasadas creada, % filas',
    (SELECT count(*) FROM public.retencion_pasadas);
END
$guarda$;
