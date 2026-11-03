-- =============================================================================
-- FIX — Un parte de servicio no da por hecho que el niño estaba
-- -----------------------------------------------------------------------------
-- ADR-0066 (decisión del responsable del 2026-11-03: un DEFAULT no afirma un hecho que nadie ha
-- comprobado).
--
--   · `parte_servicio_diario.presente` tenía DEFAULT `true`: una fila creada sin decirlo afirmaba
--     que el niño usó el servicio, y el motor cobra los días presentes. Medido en producción el
--     2026-11-03 (ensayo terminado en RAISE): una profe por la API con su sesión, y service_role,
--     insertaban un parte sin `presente` y quedaba `true`.
--   · Ahora no hay DEFAULT y la columna sigue NOT NULL: quien apunta un parte dice si estaba, o el
--     INSERT falla (23502). «No consta» ya tiene su forma: que no haya fila.
--   · Quién lo dice hoy: la acción `guardarPaseServicios` siempre (su esquema exige el booleano).
--     Ninguna función de la base inserta partes (solo los lee el motor y el export, y los borra el
--     olvido). Solo cambia el valor por defecto: ninguna fila existente se toca.
--
-- La aplica el responsable por SQL Editor. Sin BEGIN ni COMMIT. Tras aplicar: registrar en
-- supabase_migrations.schema_migrations. Orden: mergear y esperar el despliegue, después aplicar
-- (la app ya envía `presente`; el orden importa solo para un cliente viejo que no lo enviara).
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_default text;
  v_nullable text;
BEGIN
  SELECT column_default, is_nullable INTO v_default, v_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'parte_servicio_diario' AND column_name = 'presente';
  RAISE NOTICE 'parte_servicio_diario.presente antes: DEFAULT %, nullable %', v_default, v_nullable;
  IF v_default IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'el DEFAULT de parte_servicio_diario.presente no es el esperado (ya aplicada?): %',
      v_default;
  END IF;
  IF v_nullable IS DISTINCT FROM 'NO' THEN
    RAISE EXCEPTION 'parte_servicio_diario.presente admite NULL: sin DEFAULT no obligaría a decirlo';
  END IF;
END
$guarda$;

ALTER TABLE public.parte_servicio_diario ALTER COLUMN presente DROP DEFAULT;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_default text;
BEGIN
  SELECT column_default INTO v_default
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'parte_servicio_diario' AND column_name = 'presente';
  RAISE NOTICE 'parte_servicio_diario.presente después: DEFAULT %', coalesce(v_default, '(ninguno)');
  IF v_default IS NOT NULL THEN
    RAISE EXCEPTION 'parte_servicio_diario.presente sigue con DEFAULT: %', v_default;
  END IF;
END
$guarda$;
