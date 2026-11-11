-- =============================================================================
-- FIX — La puerta de identidad del niño (serie de altas, entre la 5a y la 5b; 2026-11-08)
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/altas-serie.md, «La puerta de identidad». Con el alta validada, el tutor legal
-- cambiaba la identidad del niño sin pasar por Dirección: `actualizar_identidad_nino_tutor` no
-- miraba el alta (medido abierto en el ensayo de la 5a, antes y después). La cola de cambios
-- pendientes (decisión J, #153) cubría la dirección, el libro de familia y los datos y el DNI del
-- TUTOR, pero nunca la identidad del niño.
--
--   · Decidido por el responsable (2026-11-07): los OCHO campos que identifican al niño (nombre, los
--     dos apellidos, fecha y lugar de nacimiento, sexo, nacionalidad y DNI) van a la cola; los otros
--     seis (idioma, hermanos, observaciones, cómo nos conoció) siguen directos. Meter los catorce
--     convertiría la cola en un trámite que se aprueba sin mirar.
--   · Aquí, la base: la función rechaza (42501, HINT cola_validacion) un CAMBIO en cualquiera de los
--     ocho con el alta validada. Mandar el mismo valor no es un cambio. La app encola antes de
--     llegar aquí; esto es el respaldo para quien llame a la función directamente.
--   · La purga del niño ya borra TODAS sus entradas de la cola (`privado.purgar_nino`, cualquier
--     entidad), y el trigger de auditoría deja fuera el payload: la guarda posterior lo comprueba,
--     porque una entrada de identidad pendiente lleva el DNI dentro.
--
-- Generada con un guion desde el cuerpo vivo (la 5a, mismo md5 normalizado que producción).
-- ORDEN: da igual. La app de antes no encola la identidad: con la migración aplicada y la app de
-- antes, un cambio de identidad con el alta validada falla con «no autorizado» sin escribir nada (la
-- puerta queda cerrada antes que la cola abierta); la app nueva funciona con o sin la migración.
-- La aplica el responsable por SQL Editor, copiando el fichero de la rama. Tras aplicar: registrar en
-- supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_esperado text;
  v_firma text;
BEGIN
  FOR v_firma, v_esperado IN VALUES
    ('public.actualizar_identidad_nino_tutor(uuid,text,text,date,public.nino_sexo,text,text,text,text,text,integer,integer,text,text,text)', '780877b94a175cfce830a78c2a6a157c'),
    ('privado.purgar_nino(uuid)', '0e3a8bf6a477d0c236b1ab3c35566cfd'),
    ('public.audit_trigger_function()', '1586db5ca71338478b8be55dfe320115'),
    ('public.alta_validada_de_nino(uuid)', 'e1732db04f2faaa08d526b6d4cdc7cf5')
  LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_firma);
    IF v_md5 IS DISTINCT FROM v_esperado THEN
      RAISE EXCEPTION '% no es la de antes: %', v_firma, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;
  RAISE NOTICE 'guarda previa: las 4 funciones son las de antes';
END;
$guarda$;

CREATE OR REPLACE FUNCTION public.actualizar_identidad_nino_tutor(
  p_nino_id uuid,
  p_primer_apellido text,
  p_segundo_apellido text,
  p_fecha_nacimiento date,
  p_sexo public.nino_sexo,
  p_nacionalidad text,
  p_idioma_principal text,
  p_nombre text DEFAULT NULL,
  p_lugar_nacimiento text DEFAULT NULL,
  p_dni text DEFAULT NULL,
  p_hermanos_total integer DEFAULT NULL,
  p_hermanos_lugar integer DEFAULT NULL,
  p_observaciones_familia text DEFAULT NULL,
  p_como_nos_conocio text DEFAULT NULL,
  p_como_nos_conocio_otro text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_actual public.ninos%ROWTYPE;
BEGIN
  IF NOT public.es_tutor_legal_de(p_nino_id) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 5a: los apellidos van en pareja. Si llega el primero, llega el segundo con él, y vacío es «no
  -- tiene»: así se puede quitar un segundo apellido. El primero no puede llegar vacío, y el segundo
  -- no llega solo. `apellidos` la deriva la base de los dos.
  IF p_primer_apellido IS NOT NULL AND btrim(p_primer_apellido) = '' THEN
    RAISE EXCEPTION 'falta el primer apellido'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'primer_apellido';
  END IF;
  IF p_primer_apellido IS NULL AND p_segundo_apellido IS NOT NULL THEN
    RAISE EXCEPTION 'el segundo apellido llega con el primero'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'apellidos_en_pareja';
  END IF;
  -- Los hermanos, también en pareja: el total (contando al niño) y el lugar que ocupa (1, el mayor).
  IF (p_hermanos_total IS NULL) <> (p_hermanos_lugar IS NULL) THEN
    RAISE EXCEPTION 'el total de hermanos y el lugar van juntos'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'hermanos';
  END IF;
  IF p_como_nos_conocio IS NULL AND p_como_nos_conocio_otro IS NOT NULL THEN
    RAISE EXCEPTION 'el texto de «otro» llega con la respuesta'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'como_nos_conocio';
  END IF;

  -- La puerta (20270113120000): con el alta validada, los ocho campos que IDENTIFICAN al niño no se
  -- cambian aquí, van a la cola de Dirección (cambios_pendientes, entidad 'ninos_identidad'). Se
  -- compara con lo guardado usando las MISMAS expresiones que el UPDATE de abajo: mandar el mismo
  -- valor no es un cambio, así que guardar el paso sin tocar nada no falla. Los otros seis (idioma,
  -- hermanos, observaciones, cómo nos conoció) siguen directos. Decidido por el responsable el
  -- 2026-11-07: cambiar el nombre o el DNI necesita a Dirección; el número de hermanos, no.
  IF public.alta_validada_de_nino(p_nino_id) THEN
    SELECT n.* INTO v_actual FROM public.ninos n WHERE n.id = p_nino_id;
    IF (p_nombre IS NOT NULL AND p_nombre IS DISTINCT FROM v_actual.nombre)
       OR (p_primer_apellido IS NOT NULL
           AND (btrim(p_primer_apellido) IS DISTINCT FROM v_actual.primer_apellido
                OR NULLIF(btrim(p_segundo_apellido), '') IS DISTINCT FROM v_actual.segundo_apellido))
       OR (p_fecha_nacimiento IS NOT NULL AND p_fecha_nacimiento IS DISTINCT FROM v_actual.fecha_nacimiento)
       OR (p_sexo IS NOT NULL AND p_sexo IS DISTINCT FROM v_actual.sexo)
       OR (p_nacionalidad IS NOT NULL AND p_nacionalidad IS DISTINCT FROM v_actual.nacionalidad)
       OR (p_lugar_nacimiento IS NOT NULL
           AND NULLIF(btrim(p_lugar_nacimiento), '') IS DISTINCT FROM v_actual.lugar_nacimiento)
       OR (p_dni IS NOT NULL
           AND NULLIF(upper(regexp_replace(p_dni, '[[:space:].-]', '', 'g')), '') IS DISTINCT FROM v_actual.dni) THEN
      RAISE EXCEPTION 'alta validada: el cambio de identidad va a la cola de validacion'
        USING ERRCODE = 'insufficient_privilege', HINT = 'cola_validacion';
    END IF;
  END IF;

  -- Los campos nuevos (5a), con el contrato del setter médico: NULL deja lo que hay y vacío lo
  -- borra. El DNI se guarda sin espacios, puntos ni guiones, en mayúsculas; el CHECK mira la letra.
  UPDATE public.ninos SET
    nombre           = COALESCE(p_nombre, nombre),
    primer_apellido  = CASE WHEN p_primer_apellido IS NULL THEN primer_apellido ELSE btrim(p_primer_apellido) END,
    segundo_apellido = CASE WHEN p_primer_apellido IS NULL THEN segundo_apellido
                            ELSE NULLIF(btrim(p_segundo_apellido), '') END,
    fecha_nacimiento = COALESCE(p_fecha_nacimiento, fecha_nacimiento),
    sexo             = COALESCE(p_sexo, sexo),
    nacionalidad     = COALESCE(p_nacionalidad, nacionalidad),
    idioma_principal = COALESCE(p_idioma_principal, idioma_principal),
    lugar_nacimiento = CASE WHEN p_lugar_nacimiento IS NULL THEN lugar_nacimiento
                            ELSE NULLIF(btrim(p_lugar_nacimiento), '') END,
    dni              = CASE WHEN p_dni IS NULL THEN dni
                            ELSE NULLIF(upper(regexp_replace(p_dni, '[[:space:].-]', '', 'g')), '') END,
    hermanos_total   = COALESCE(p_hermanos_total, hermanos_total),
    hermanos_lugar   = COALESCE(p_hermanos_lugar, hermanos_lugar),
    observaciones_familia = CASE WHEN p_observaciones_familia IS NULL THEN observaciones_familia
                                 ELSE NULLIF(btrim(p_observaciones_familia), '') END,
    como_nos_conocio = CASE WHEN p_como_nos_conocio IS NULL THEN como_nos_conocio
                            ELSE NULLIF(btrim(p_como_nos_conocio), '') END,
    como_nos_conocio_otro = CASE WHEN p_como_nos_conocio IS NULL THEN como_nos_conocio_otro
                                 WHEN btrim(p_como_nos_conocio) = 'otro' THEN NULLIF(btrim(p_como_nos_conocio_otro), '')
                                 ELSE NULL END
  WHERE id = p_nino_id
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- La firma no cambia (CREATE OR REPLACE): los permisos se conservan; la guarda posterior los mira.

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_src text;
  v_acl text;
BEGIN
  SELECT p.prosrc, array_to_string(ARRAY(SELECT a FROM unnest(p.proacl::text[]) a WHERE a NOT LIKE 'postgres=%' ORDER BY a), ',')
    INTO v_src, v_acl FROM pg_proc p WHERE p.oid = 'public.actualizar_identidad_nino_tutor(uuid,text,text,date,public.nino_sexo,text,text,text,text,text,integer,integer,text,text,text)'::regprocedure;
  IF v_src NOT LIKE '%IF public.alta_validada_de_nino(p_nino_id) THEN%'
     OR v_src NOT LIKE '%HINT = ''cola_validacion''%' THEN
    RAISE EXCEPTION 'actualizar_identidad_nino_tutor no cierra la puerta';
  END IF;
  IF v_acl IS DISTINCT FROM 'authenticated=X/postgres,service_role=X/postgres' THEN
    RAISE EXCEPTION 'actualizar_identidad_nino_tutor tiene la ACL %', coalesce(v_acl, 'ninguna');
  END IF;
  -- La cola pendiente es un sitio más donde vive el DNI: la purga borra las entradas del niño y la
  -- auditoría no copia el payload.
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'privado.purgar_nino(uuid)'::regprocedure;
  IF v_src NOT LIKE '%DELETE FROM public.cambios_pendientes WHERE nino_id = p_nino_id;%' THEN
    RAISE EXCEPTION 'privado.purgar_nino no borra la cola del niño';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.audit_trigger_function()'::regprocedure;
  IF v_src NOT LIKE '%v_despues := v_despues - ARRAY[''payload'', ''valor_propuesto''];%' THEN
    RAISE EXCEPTION 'audit_trigger_function copia el payload de la cola';
  END IF;
  RAISE NOTICE 'guarda posterior: puerta cerrada, ACL %, purga y auditoría de la cola en su sitio', v_acl;
END;
$guarda$;
