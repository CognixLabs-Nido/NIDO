-- =============================================================================
-- FIX — Un cambio de la cola no sale de ella si no se aplicó
-- -----------------------------------------------------------------------------
-- Censo C, PR B2. Decisiones de Jose del 2026-11-27 (docs/specs/fallos-leidos-c.md, «B2, y luego el
-- grupo 1», «B2: los dos diseños…», «B2: aprobado, y las 4 columnas» y «B2: el booleano…»):
-- «un cambio NUNCA sale de la cola si no se aplicó».
--
--   · Hasta aquí `aprobarCambio` marcaba la fila 'aprobado' ANTES de aplicar y, si aplicar fallaba, la
--     devolvía a 'pendiente' con otra escritura. Si esa segunda escritura fallaba también, el cambio
--     quedaba aprobado sin aplicar y fuera de la lista de Dirección (medido abierto en el censo C).
--   · Ahora la fila sigue 'pendiente' mientras se aplica: Dirección la RESERVA (`aplicando_desde`) con
--     `reclamar_cambio_pendiente`, y solo pasa a 'aprobado' cuando se aplicó. Si aplicar falla, una sola
--     escritura deja «falló al aplicar» con su motivo (`fallo_aplicar_at`, `fallo_aplicar_motivo`: un
--     código, sin datos personales) y quita la reserva (`marcar_fallo_cambio_pendiente`). Si esa
--     escritura falla también, la fila sigue pendiente y reservada: a los 2 minutos se puede volver a
--     aprobar. En ningún caso sale de la cola.
--   · La reserva vale 2 minutos, comparados con el `now()` de la base (nunca con el reloj de la app):
--     60 s de `maxDuration` explícito en la página de pendientes, más 8 s del `statement_timeout` de
--     `authenticated` (leído en producción el 2026-11-27), más margen. Pasado ese tiempo, otra
--     aprobación la vuelve a reservar y reaplica: reaplicar cada entidad es inofensivo (medido,
--     `aplicar-cambio-dos-veces.rls.test.ts`).
--   · `invita_tutor2`: la DECISIÓN de invitar al segundo tutor, tomada la primera vez que se reserva un
--     cambio de sus datos (su email nuevo frente al de antes). Vacío mientras no se ha decidido. Un
--     reintento la lee y no la recalcula: recalcularla tras aplicar compararía el email nuevo consigo
--     mismo y no invitaría a nadie. Es un booleano y no el email de antes: «Guardar un dato personal para
--     resolver algo que resuelve un booleano es exactamente lo que no hacemos» (Jose).
--   · Las cuatro columnas nacen vacías, inserte quien inserte (`privado.cambios_pendientes_nace_limpio`):
--     el tutor legal inserta su fila y la política de INSERT no mira columnas; sin esto podría crearla
--     reservada (bloqueada) o con `invita_tutor2 = false` (sin invitación).
--   · Las dos funciones son SECURITY INVOKER: la sesión de Dirección, con la RLS de siempre
--     (`cambios_pendientes_update`, `es_admin`). A una fila que no ve le contestan como a una que no
--     está pendiente.
--   · `decidir_mandato_propuesto` (20270201120000) no cambia: cierra la entrada `WHERE estado =
--     'pendiente'`, y una reservada lo sigue estando.
--
-- La aplica el responsable por SQL Editor. Sin BEGIN ni COMMIT. Tras aplicar: registrar en
-- supabase_migrations.schema_migrations. Orden con la app: ANTES del despliegue (la app nueva llama a
-- las funciones). La app de antes no las llama y no lee las columnas: sigue igual.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'cambios_pendientes'
       AND column_name IN ('aplicando_desde', 'fallo_aplicar_at', 'fallo_aplicar_motivo', 'invita_tutor2')
  ) THEN
    RAISE EXCEPTION 'cambios_pendientes ya tiene alguna de las columnas de 20270209120000';
  END IF;
  IF to_regprocedure('public.reclamar_cambio_pendiente(uuid)') IS NOT NULL
     OR to_regprocedure('public.marcar_fallo_cambio_pendiente(uuid, timestamptz, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'las funciones de 20270209120000 ya existen';
  END IF;
  -- Ninguna fila tiene que cumplir nada nuevo: las columnas nacen NULL. Informativo.
  RAISE NOTICE 'guarda previa: cambios pendientes vivos %',
    (SELECT count(*) FROM public.cambios_pendientes WHERE estado = 'pendiente');
END
$guarda$;

-- ---- Las columnas ----
ALTER TABLE public.cambios_pendientes
  ADD COLUMN aplicando_desde timestamptz NULL,
  ADD COLUMN fallo_aplicar_at timestamptz NULL,
  ADD COLUMN fallo_aplicar_motivo text NULL,
  ADD COLUMN invita_tutor2 boolean NULL,
  ADD CONSTRAINT cambios_pendientes_fallo_coherente
    CHECK ((fallo_aplicar_at IS NULL) = (fallo_aplicar_motivo IS NULL)),
  ADD CONSTRAINT cambios_pendientes_fallo_motivo_codigo
    CHECK (fallo_aplicar_motivo IS NULL OR fallo_aplicar_motivo ~ '^[a-z_]{1,60}$');

COMMENT ON COLUMN public.cambios_pendientes.aplicando_desde IS
  'B2 (2026-11-27): Dirección lo está aplicando desde entonces; la fila sigue pendiente. Vale 2 minutos contra el now() de la base (reclamar_cambio_pendiente).';
COMMENT ON COLUMN public.cambios_pendientes.fallo_aplicar_at IS
  'B2 (2026-11-27): el último intento de aplicarlo falló; la fila sigue pendiente para reintentar.';
COMMENT ON COLUMN public.cambios_pendientes.fallo_aplicar_motivo IS
  'B2 (2026-11-27): el motivo del fallo, un código (sin datos personales).';
COMMENT ON COLUMN public.cambios_pendientes.invita_tutor2 IS
  'B2 (2026-11-27): la decisión de invitar al segundo tutor, tomada al reservar por primera vez un cambio de sus datos; NULL mientras no se ha decidido. Un booleano, no el email de antes (Jose).';

-- ---- Nacen vacías ----
CREATE FUNCTION privado.cambios_pendientes_nace_limpio()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.aplicando_desde := NULL;
  NEW.fallo_aplicar_at := NULL;
  NEW.fallo_aplicar_motivo := NULL;
  NEW.invita_tutor2 := NULL;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION privado.cambios_pendientes_nace_limpio() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER cambios_pendientes_nace_limpio
  BEFORE INSERT ON public.cambios_pendientes
  FOR EACH ROW EXECUTE FUNCTION privado.cambios_pendientes_nace_limpio();

-- ---- Reservar ----
-- Devuelve {"estado": "reservado", "fila": {...}} | {"estado": "aplicandose", "desde": ...} |
-- {"estado": "no_pendiente"}. El UPDATE lee y escribe en una sola sentencia: dos aprobaciones a la vez
-- no reservan las dos (la segunda espera el cerrojo de la fila y ya no cumple el WHERE).
CREATE FUNCTION public.reclamar_cambio_pendiente(p_cambio uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  f public.cambios_pendientes%ROWTYPE;
  v_desde timestamptz;
BEGIN
  UPDATE public.cambios_pendientes
     SET aplicando_desde = now()
   WHERE id = p_cambio
     AND estado = 'pendiente'
     AND (aplicando_desde IS NULL OR aplicando_desde < now() - interval '2 minutes')
  RETURNING * INTO f;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'estado', 'reservado',
      'fila', jsonb_build_object(
        'id', f.id, 'entidad', f.entidad, 'centro_id', f.centro_id, 'nino_id', f.nino_id,
        'payload', f.payload, 'aplicando_desde', f.aplicando_desde, 'invita_tutor2', f.invita_tutor2));
  END IF;
  SELECT aplicando_desde INTO v_desde
    FROM public.cambios_pendientes WHERE id = p_cambio AND estado = 'pendiente';
  IF FOUND AND v_desde IS NOT NULL THEN
    RETURN jsonb_build_object('estado', 'aplicandose', 'desde', v_desde);
  END IF;
  RETURN jsonb_build_object('estado', 'no_pendiente');
END
$function$;
REVOKE ALL ON FUNCTION public.reclamar_cambio_pendiente(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reclamar_cambio_pendiente(uuid) TO authenticated;

-- ---- Falló al aplicar ----
-- Una sola escritura: el fallo con su motivo y la reserva quitada. Solo sobre la reserva propia
-- (`p_desde`): si otra aprobación la cogió tras los 2 minutos, no se pisa. Devuelve si escribió.
CREATE FUNCTION public.marcar_fallo_cambio_pendiente(p_cambio uuid, p_desde timestamptz, p_motivo text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
BEGIN
  UPDATE public.cambios_pendientes
     SET aplicando_desde = NULL, fallo_aplicar_at = now(), fallo_aplicar_motivo = p_motivo
   WHERE id = p_cambio AND estado = 'pendiente' AND aplicando_desde = p_desde;
  RETURN FOUND;
END
$function$;
REVOKE ALL ON FUNCTION public.marcar_fallo_cambio_pendiente(uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_fallo_cambio_pendiente(uuid, timestamptz, text) TO authenticated;

-- ---- Guarda posterior ----
DO $posterior$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'cambios_pendientes'
     AND column_name IN ('aplicando_desde', 'fallo_aplicar_at', 'fallo_aplicar_motivo', 'invita_tutor2')
     AND is_nullable = 'YES';
  IF n <> 4 THEN RAISE EXCEPTION 'guarda posterior: columnas nuevas %, esperadas 4', n; END IF;

  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'public.cambios_pendientes'::regclass AND tgname = 'cambios_pendientes_nace_limpio'
     AND NOT tgisinternal AND tgenabled = 'O';
  IF n <> 1 THEN RAISE EXCEPTION 'guarda posterior: falta el trigger nace_limpio'; END IF;

  -- Las dos funciones: INVOKER (la RLS de quien llama), solo authenticated, nada para anon ni PUBLIC.
  SELECT count(*) INTO n FROM pg_proc
   WHERE oid IN (to_regprocedure('public.reclamar_cambio_pendiente(uuid)'),
                 to_regprocedure('public.marcar_fallo_cambio_pendiente(uuid, timestamptz, text)'))
     AND NOT prosecdef
     AND has_function_privilege('authenticated', oid, 'EXECUTE')
     AND NOT has_function_privilege('anon', oid, 'EXECUTE');
  IF n <> 2 THEN RAISE EXCEPTION 'guarda posterior: funciones con la forma esperada %, de 2', n; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid IN (to_regprocedure('public.reclamar_cambio_pendiente(uuid)'),
                     to_regprocedure('public.marcar_fallo_cambio_pendiente(uuid, timestamptz, text)'))
       AND a.grantee = 0
  ) THEN
    RAISE EXCEPTION 'guarda posterior: una función queda para PUBLIC';
  END IF;
  -- El trigger no lo ejecuta nadie a mano.
  IF has_function_privilege('authenticated', 'privado.cambios_pendientes_nace_limpio()', 'EXECUTE') THEN
    RAISE EXCEPTION 'guarda posterior: authenticated ejecuta nace_limpio';
  END IF;
END
$posterior$;
