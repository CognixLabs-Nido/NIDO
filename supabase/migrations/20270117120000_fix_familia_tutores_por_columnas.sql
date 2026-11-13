-- =============================================================================
-- FIX — `familia_tutores` por columnas (serie de altas, fase 6, paso 1; 2026-11-13)
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/altas-serie.md, «Fase 6: campos de tutores». Antes de añadir datos personales
-- nuevos del tutor (teléfono, fecha de nacimiento, número del DNI, estudios, empresa), la tabla deja de
-- abrirse entera a la sesión: hoy una columna nueva la leería cualquiera que lea la fila.
--
-- Medido ABIERTO en producción el 2026-11-13 (ensayo terminado en RAISE): la fila del tutor la leen
-- la Dirección del centro y los DOS tutores de la familia (`es_tutor_de_familia`), cada uno la del
-- otro entera; ni el autorizado ni la profe la leen. Con una columna nueva simulada, la leían los
-- mismos, los dos tutores incluida la del otro.
--
-- Lo que hace, con el mecanismo de `ninos` (`20270115130000`) y `matriculas.motivo_baja`
-- (ADR-0053): quita a la sesión el SELECT de tabla y le da el de las 15 columnas que hay. Hoy no
-- cambia quién ve qué (las políticas no se tocan). Cambia que **cada columna nueva nace cerrada**:
-- necesita su GRANT SELECT (columna) o su sitio en una función que decida quién la ve.
--
-- La app lee siempre columnas nombradas (medido: ningún `select('*')` sobre la tabla), así que se
-- puede aplicar antes o después del despliegue. Sin COMMIT ni BEGIN: el SQL Editor la envuelve en su
-- transacción. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v text;
BEGIN
  SELECT string_agg(attname, ',' ORDER BY attname) INTO v
    FROM pg_attribute
   WHERE attrelid = 'public.familia_tutores'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v IS DISTINCT FROM 'centro_id,created_at,deleted_at,direccion_calle,direccion_ciudad,direccion_cp,direccion_numero,dni_documento_path,email,familia_id,id,nombre_completo,rol_familia,updated_at,usuario_id' THEN
    RAISE EXCEPTION 'familia_tutores no tiene las columnas esperadas: %', v;
  END IF;

  -- Con el SELECT de tabla y sin permisos por columna: lo que se mide aquí.
  IF NOT has_table_privilege('authenticated', 'public.familia_tutores', 'SELECT')
     OR has_table_privilege('anon', 'public.familia_tutores', 'SELECT')
     OR EXISTS (SELECT 1 FROM pg_attribute
                 WHERE attrelid = 'public.familia_tutores'::regclass AND attacl IS NOT NULL) THEN
    RAISE EXCEPTION 'familia_tutores no tiene los privilegios esperados';
  END IF;

  -- Las dos políticas de lectura, tal como están vivas: quién lee la fila no cambia aquí.
  IF (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'familia_tutores'
         AND policyname = 'familia_tutores_select')
       IS DISTINCT FROM 'es_admin(privado.centro_de_familia(familia_id))'
  OR (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'familia_tutores'
         AND policyname = 'familia_tutores_select_tutor')
       IS DISTINCT FROM 'es_tutor_de_familia(familia_id)'
  OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'familia_tutores'
         AND cmd IN ('SELECT', 'ALL')) <> 2 THEN
    RAISE EXCEPTION 'alguna política de lectura de familia_tutores no es la esperada';
  END IF;

  RAISE NOTICE 'guarda previa: familia_tutores con sus 15 columnas, SELECT de tabla y las dos políticas de lectura';
END;
$guarda$;

REVOKE SELECT ON public.familia_tutores FROM PUBLIC, anon, authenticated;

-- Las columnas que ya había: las lee la sesión, con la RLS de siempre (la Dirección del centro y los
-- tutores de la familia). Cada columna nueva de `familia_tutores` necesita su GRANT SELECT (columna),
-- o su sitio en una función que decida quién la ve.
GRANT SELECT (
  id,
  familia_id,
  centro_id,
  usuario_id,
  rol_familia,
  email,
  nombre_completo,
  dni_documento_path,
  direccion_calle,
  direccion_numero,
  direccion_cp,
  direccion_ciudad,
  created_at,
  updated_at,
  deleted_at
) ON public.familia_tutores TO authenticated;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_abiertas int;
  v_total int;
BEGIN
  IF has_table_privilege('authenticated', 'public.familia_tutores', 'SELECT')
     OR has_table_privilege('anon', 'public.familia_tutores', 'SELECT') THEN
    RAISE EXCEPTION 'la sesión sigue con el SELECT de tabla de familia_tutores';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.familia_tutores', 'SELECT') THEN
    RAISE EXCEPTION 'service_role ha perdido el SELECT de familia_tutores';
  END IF;

  SELECT count(*) FILTER (WHERE has_column_privilege('authenticated', 'public.familia_tutores', attname, 'SELECT')),
         count(*)
    INTO v_abiertas, v_total
    FROM pg_attribute
   WHERE attrelid = 'public.familia_tutores'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v_abiertas <> 15 OR v_total <> 15 THEN
    RAISE EXCEPTION 'familia_tutores: % columnas abiertas de %, se esperaban 15 de 15', v_abiertas, v_total;
  END IF;

  RAISE NOTICE 'guarda posterior: familia_tutores sin SELECT de tabla para la sesión, 15 columnas abiertas; filas vivas: %',
    (SELECT count(*) FROM public.familia_tutores WHERE deleted_at IS NULL);
END;
$guarda$;
