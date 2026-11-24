-- C (2026-11-23/24): un niño sin datos pedagógicos no come sólidos «por defecto» ni deja de comerlos.
-- Spec: docs/specs/fallos-leidos-c.md, «los niños sin datos pedagógicos: ni TRUE ni FALSE», «el
-- registro borrado también se cierra en el PR C», «el formulario … en blanco» y «C, desde main».
--
-- Dos defectos distintos en `nino_toma_comida_solida`, medidos abiertos cada uno por su lado:
--   1. SIN registro, devolvía TRUE («COALESCE de seguridad»): el pase de comidas le ofrecía el
--      primer plato a un bebé cuya lactancia nadie apuntó.
--   2. No miraba `deleted_at`: un registro BORRADO seguía decidiendo. «Un niño al que le borraron los
--      datos pedagógicos no es un niño con datos antiguos, es un niño sin datos.»
-- Desde aquí devuelve NULL («no se sabe») cuando no hay registro vivo o la lactancia está vacía, y
-- ninguna pantalla lo convierte en sí o en no: el pase lo pinta «sin datos pedagógicos».
--
-- Y las tres columnas que el formulario preseleccionaba (lactancia, esfínteres, alimentación) dejan
-- de ser NOT NULL: siguen siendo OPCIONALES (Jose, opción B) y el formulario sale en blanco; si nadie
-- las toca, no se guarda nada en ellas. Quién las lee en la base se midió antes (2026-11-24): cuatro
-- funciones y ninguna vista, política ni índice; la guarda exige ese mismo conjunto.
--
-- La función se reescribe desde su definición VIVA (leída el 2026-11-24): solo cambia el RETURN.

DO $guarda$
DECLARE
  v_md5 text;
  v_lectores text;
BEGIN
  -- La función es la leída (md5 normalizado: sin CR, sin comentarios, espacios colapsados).
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.nino_toma_comida_solida(uuid)');
  IF v_md5 IS DISTINCT FROM '9d650b1a704a6f0dc02627935b653def' THEN
    RAISE EXCEPTION 'C: nino_toma_comida_solida no es la leída el 2026-11-24: no se reescribe a ciegas';
  END IF;
  -- Las tres columnas son NOT NULL todavía: la migración no está aplicada, ni a medias.
  IF (SELECT count(*) FROM pg_attribute
       WHERE attrelid = 'public.datos_pedagogicos_nino'::regclass AND attnotnull
         AND attname IN ('lactancia_estado', 'control_esfinteres', 'tipo_alimentacion')) <> 3 THEN
    RAISE EXCEPTION 'C: las tres columnas ya no son NOT NULL (¿aplicada, o a medias?)';
  END IF;
  -- Quién las lee es lo medido: si aparece otro lector, se mira antes de quitar el NOT NULL.
  SELECT string_agg(p.oid::regprocedure::text, ' ; ' ORDER BY p.oid::regprocedure::text)
    INTO v_lectores
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND n.nspname !~ '^pg_(toast_)?temp'  -- lo temporal de una sesión no es un lector de la tabla
     AND p.prosrc ~ '(lactancia_estado|control_esfinteres|tipo_alimentacion)';
  IF v_lectores IS DISTINCT FROM
     '_claves_pii_nino(text) ; nino_toma_comida_solida(uuid) ; privado.ficha_canonica(uuid,integer) ; privado.purgar_nino(uuid)' THEN
    RAISE EXCEPTION 'C: las funciones que leen las tres columnas no son las cuatro medidas: %', v_lectores;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
              AND definition ~ '(datos_pedagogicos|lactancia_estado|control_esfinteres|tipo_alimentacion)')
     OR EXISTS (SELECT 1 FROM pg_matviews
              WHERE definition ~ '(datos_pedagogicos|lactancia_estado|control_esfinteres|tipo_alimentacion)')
     OR EXISTS (SELECT 1 FROM pg_policies
              WHERE coalesce(qual, '') || coalesce(with_check, '') ~ '(lactancia_estado|control_esfinteres|tipo_alimentacion)') THEN
    RAISE EXCEPTION 'C: una vista o una política lee las tres columnas, y no estaba medida';
  END IF;
END
$guarda$;

-- ============================================================================ 1 · la función
CREATE OR REPLACE FUNCTION public.nino_toma_comida_solida(p_nino_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro uuid := privado.centro_de_nino(p_nino_id);
BEGIN
  -- [PR 2a] Solo quien es del centro del niño.
  IF auth.uid() IS NULL THEN
    IF NOT (COALESCE(auth.role(), '') = 'service_role'
            OR (session_user <> 'authenticator'
                AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
      RAISE EXCEPTION 'no autorizado: sin sesión solo el servicio'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NOT (public.pertenece_a_centro(v_centro)
             OR (v_centro IS NOT NULL AND public.es_admin(v_centro))) THEN
    RAISE EXCEPTION 'no autorizado: no es de este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- NULL = no se sabe: sin registro vivo, o con la lactancia vacía (`NULL NOT IN (…)` es NULL). Ni
  -- TRUE ni FALSE: el pase lo pinta «sin datos pedagógicos» (C, 2026-11-23 y 2026-11-24).
  RETURN (
    SELECT lactancia_estado NOT IN (
      'materna'::public.lactancia_estado,
      'biberon'::public.lactancia_estado
    )
    FROM public.datos_pedagogicos_nino
    WHERE nino_id = p_nino_id
      AND deleted_at IS NULL
  );
END;
$function$;

COMMENT ON FUNCTION public.nino_toma_comida_solida(uuid) IS
  'TRUE come sólidos, FALSE no (materna o biberón), NULL no se sabe (sin registro vivo o lactancia vacía). '
  'El NULL no se convierte en sí ni en no: el pase lo pinta «sin datos pedagógicos» (C, 2026-11-24).';

-- ============================================================================ 2 · las tres columnas
-- Opcionales (Jose, opción B): un registro puede existir sin ellas (se guardó la siesta y nada más).
ALTER TABLE public.datos_pedagogicos_nino
  ALTER COLUMN lactancia_estado DROP NOT NULL,
  ALTER COLUMN control_esfinteres DROP NOT NULL,
  ALTER COLUMN tipo_alimentacion DROP NOT NULL;

-- ============================================================================ guarda posterior
DO $despues$
BEGIN
  IF (SELECT count(*) FROM pg_attribute
       WHERE attrelid = 'public.datos_pedagogicos_nino'::regclass AND attnotnull
         AND attname IN ('lactancia_estado', 'control_esfinteres', 'tipo_alimentacion')) <> 0 THEN
    RAISE EXCEPTION 'C después: alguna de las tres columnas sigue NOT NULL';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.nino_toma_comida_solida(uuid)'::regprocedure)
       !~ 'deleted_at IS NULL'
     OR regexp_replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.nino_toma_comida_solida(uuid)'::regprocedure),
                       '--[^\n]*', '', 'g') ~ 'TRUE' THEN
    RAISE EXCEPTION 'C después: la función no filtra los borrados o sigue suponiendo TRUE';
  END IF;
  -- Los permisos no cambian con CREATE OR REPLACE: los de 20261010130000.
  IF has_function_privilege('anon', 'public.nino_toma_comida_solida(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.nino_toma_comida_solida(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'C después: los permisos de nino_toma_comida_solida cambiaron';
  END IF;
END
$despues$;
