-- =============================================================================
-- FEAT — Campos del niño, la base (serie de altas, fase 5, 5a; 2026-11-07)
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/altas-serie.md, «Fase 5». Lo que pide la ficha de solicitud de plaza de ANAIA y
-- la app no tenía (decidido por el responsable el 2026-10-29 y el 2026-11-07). En la base, sin
-- pantalla: la 5b la pone.
--
--   · Dos apellidos (P5-1, opción B). `ninos.apellidos` deja de escribirse: la DERIVA la base de
--     `primer_apellido` y `segundo_apellido` (columna generada). Lo que la base puede derivar, no lo
--     acepta del cliente (#507). Los que solo LEEN el nombre (la app, el concepto del adeudo, las
--     listas, el export y cinco funciones) siguen recibiendo «García López» igual que antes, y
--     escribir `apellidos` pasa a ser un error: un escritor que se escape lo caza el CI.
--   · Lo mismo en el prospecto (opción a): `lista_espera.apellidos_nino` se deriva de
--     `primer_apellido_nino` y `segundo_apellido_nino`. Dirección escribe las dos casillas.
--   · La conversión: niño a niño y prospecto a prospecto, con su valor escrito aquí. Todos son de una
--     sola palabra (medido el 2026-11-07): van enteros al primer apellido. Nadie parte nada, ni por
--     el primer espacio ni de ninguna forma: una fila que no esté en la lista, o que haya cambiado,
--     PARA la migración, y se pregunta.
--   · Campos nuevos de la ficha: lugar de nacimiento, DNI o NIE (con la letra comprobada), hermanos
--     (total contando al niño y lugar, 1 = el mayor), provincia, observaciones de la familia y «¿cómo
--     nos has conocido?» (lista cerrada con «otro» y su texto). Todos opcionales en la base: lo
--     obligatorio para cerrar el alta lo pone la 5b, que es la que los pregunta. Nada es retroactivo.
--   · Quién los escribe: `actualizar_identidad_nino_tutor` (firma nueva: los dos apellidos en pareja y
--     los campos nuevos), `actualizar_familia_nino` (la provincia, con la dirección) y
--     `crear_o_anadir_a_familia` (firma nueva: los dos apellidos del prospecto).
--   · La purga los borra (`privado.purgar_nino`) y la redacción de `audit_log` los conoce
--     (`_claves_pii_nino`). `purgar_sujeto_db` no se toca: no escribe `apellidos` (su `k_nino` no se
--     usa en el cuerpo); va en la guarda para que eso siga siendo verdad.
--
-- Generada con un guion desde las definiciones vivas (sin CR: copiar del `prosrc` vivo los trae).
-- ORDEN: APLICAR Y MERGEAR SEGUIDOS. Con la migración aplicada, la app de antes no puede escribir los
-- apellidos (las dos firmas cambian y `apellidos` es generada): el paso de identidad del alta, crear o
-- editar un prospecto y crear el niño fallan con error, sin escribir nada, hasta que se despliega la
-- app nueva; y la app nueva no funciona sin la migración. No hay orden sin ventana que no adivine.
-- La aplica el responsable por SQL Editor, copiando el fichero de la rama. Tras aplicar: registrar en
-- supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_esperado text;
  v_firma text;
  v_n integer;
  v_presentes integer;
  v_fuera integer;
BEGIN
  FOR v_firma, v_esperado IN VALUES
    ('privado.purgar_nino(uuid)', '53730ba72640c24f65ff81bf7ace7103'),
    ('public._claves_pii_nino(text)', '4d357e7219175ee7a3bd5dafb6b5b5df'),
    ('public.actualizar_identidad_nino_tutor(uuid,text,date,public.nino_sexo,text,text,text)', '85fa925386446ffdf0fe0f629a6a7cad'),
    ('public.crear_o_anadir_a_familia(text,text,date,uuid,uuid,text,text,text,text,uuid,jsonb)', '49d3986421a0c3144502fab3d672ddc8'),
    ('public.purgar_sujeto_db(uuid)', '316ae102783d9680fa6e3f674d254474'),
    ('public.actualizar_familia_nino(uuid,jsonb)', '6bd1975abff295a649a1abc99b26b3f2')
  LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_firma);
    IF v_md5 IS DISTINCT FROM v_esperado THEN
      RAISE EXCEPTION '% no es la de antes: %', v_firma, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.ninos'::regclass AND a.attname = 'apellidos'
              AND NOT a.attisdropped AND a.attgenerated <> '') THEN
    RAISE EXCEPTION 'ninos.apellidos ya es generada';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.lista_espera'::regclass AND a.attname = 'apellidos_nino'
              AND NOT a.attisdropped AND a.attgenerated <> '') THEN
    RAISE EXCEPTION 'lista_espera.apellidos_nino ya es generada';
  END IF;
  SELECT count(*) INTO v_n FROM pg_attribute a
   WHERE NOT a.attisdropped AND (
     (a.attrelid = 'public.ninos'::regclass AND a.attname IN ('primer_apellido', 'segundo_apellido', 'lugar_nacimiento',
        'dni', 'hermanos_total', 'hermanos_lugar', 'direccion_provincia', 'observaciones_familia', 'como_nos_conocio',
        'como_nos_conocio_otro'))
     OR (a.attrelid = 'public.lista_espera'::regclass AND a.attname IN ('primer_apellido_nino', 'segundo_apellido_nino')));
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'ya hay % columnas de la 5a', v_n;
  END IF;
  IF to_regprocedure('privado.dni_nie_valido(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'privado.dni_nie_valido ya existe';
  END IF;

  -- La conversión: cada fila de la lista, con exactamente su valor; ninguna fila fuera de la lista.
  SELECT count(*) INTO v_n FROM public.ninos n
    JOIN (VALUES
    ('205c70e9-245e-4853-9f0c-b5bc71ccde9e'::uuid, 'Garrido'),
    ('5024411e-47b5-425b-92b3-9de1f7dc0dac'::uuid, 'Garcia'),
    ('8aad8325-21c8-4e42-891e-595b7fe2c651'::uuid, 'Gonzalez'),
    ('9cf32e3d-3c1e-494e-a268-90cd0e1e3dc4'::uuid, 'GArcia')) AS e(id, v) ON e.id = n.id
   WHERE n.apellidos IS DISTINCT FROM e.v;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% niños de la lista han cambiado de apellidos: no se parte a ciegas, hay que preguntar', v_n;
  END IF;
  SELECT count(*) INTO v_presentes FROM public.ninos n WHERE n.id IN (
    '205c70e9-245e-4853-9f0c-b5bc71ccde9e', '5024411e-47b5-425b-92b3-9de1f7dc0dac', '8aad8325-21c8-4e42-891e-595b7fe2c651', '9cf32e3d-3c1e-494e-a268-90cd0e1e3dc4');
  SELECT count(*) INTO v_fuera FROM public.ninos n WHERE n.apellidos IS NOT NULL AND n.id NOT IN (
    '205c70e9-245e-4853-9f0c-b5bc71ccde9e', '5024411e-47b5-425b-92b3-9de1f7dc0dac', '8aad8325-21c8-4e42-891e-595b7fe2c651', '9cf32e3d-3c1e-494e-a268-90cd0e1e3dc4');
  IF v_fuera <> 0 THEN
    RAISE EXCEPTION '% niños con apellidos fuera de la lista: no se parte a ciegas, hay que preguntar', v_fuera;
  END IF;
  RAISE NOTICE '5a: niños a convertir: % de % en la lista (0 en una base vacía); fuera de la lista: %',
    v_presentes, 4, v_fuera;

  SELECT count(*) INTO v_n FROM public.lista_espera l
    JOIN (VALUES
    ('249d8e99-190a-4dae-9e67-02fcf264eff6'::uuid, 'Gonzalez'),
    ('41b65733-c0df-4aad-ba5c-98d68b562352'::uuid, 'Garrido'),
    ('5e031eae-bfb8-4942-b678-d454ebd3f759'::uuid, 'Martines'),
    ('6b9d3d42-2f09-45e5-90a3-58bb85c84cce'::uuid, 'GArcia'),
    ('9e091e67-f2e8-4c2f-a1d9-5d02dcd393fb'::uuid, 'Garcia')) AS e(id, v) ON e.id = l.id
   WHERE l.apellidos_nino IS DISTINCT FROM e.v;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% prospectos de la lista han cambiado de apellidos: no se parte a ciegas, hay que preguntar', v_n;
  END IF;
  SELECT count(*) INTO v_presentes FROM public.lista_espera l WHERE l.id IN (
    '249d8e99-190a-4dae-9e67-02fcf264eff6', '41b65733-c0df-4aad-ba5c-98d68b562352', '5e031eae-bfb8-4942-b678-d454ebd3f759', '6b9d3d42-2f09-45e5-90a3-58bb85c84cce', '9e091e67-f2e8-4c2f-a1d9-5d02dcd393fb');
  SELECT count(*) INTO v_fuera FROM public.lista_espera l WHERE l.apellidos_nino IS NOT NULL AND l.id NOT IN (
    '249d8e99-190a-4dae-9e67-02fcf264eff6', '41b65733-c0df-4aad-ba5c-98d68b562352', '5e031eae-bfb8-4942-b678-d454ebd3f759', '6b9d3d42-2f09-45e5-90a3-58bb85c84cce', '9e091e67-f2e8-4c2f-a1d9-5d02dcd393fb');
  IF v_fuera <> 0 THEN
    RAISE EXCEPTION '% prospectos con apellidos fuera de la lista: no se parte a ciegas, hay que preguntar', v_fuera;
  END IF;
  RAISE NOTICE '5a: prospectos a convertir: % de % en la lista (0 en una base vacía); fuera de la lista: %',
    v_presentes, 5, v_fuera;
END
$guarda$;

-- ---- 1. El DNI o NIE, con su letra ----
CREATE FUNCTION privado.dni_nie_valido(p_dni text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- 5a: DNI (8 cifras y letra) o NIE (X, Y o Z, 7 cifras y letra), ya normalizado, con la letra de
  -- control de la cifra módulo 23. En el NIE, X, Y y Z valen 0, 1 y 2.
  SELECT CASE
    WHEN p_dni ~ '^[0-9]{8}[A-Z]$' THEN
      substr('TRWAGMYFPDXBNJZSQVHLCKE', (substr(p_dni, 1, 8)::bigint % 23)::int + 1, 1) = substr(p_dni, 9, 1)
    WHEN p_dni ~ '^[XYZ][0-9]{7}[A-Z]$' THEN
      substr('TRWAGMYFPDXBNJZSQVHLCKE',
             ((translate(substr(p_dni, 1, 1), 'XYZ', '012') || substr(p_dni, 2, 7))::bigint % 23)::int + 1, 1)
        = substr(p_dni, 9, 1)
    ELSE false
  END;
$function$;

REVOKE ALL ON FUNCTION privado.dni_nie_valido(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION privado.dni_nie_valido(text) TO authenticated, service_role;

-- ---- 2. Las columnas nuevas ----
ALTER TABLE public.ninos
  ADD COLUMN primer_apellido text,
  ADD COLUMN segundo_apellido text,
  ADD COLUMN lugar_nacimiento text,
  ADD COLUMN dni text,
  ADD COLUMN hermanos_total smallint,
  ADD COLUMN hermanos_lugar smallint,
  ADD COLUMN direccion_provincia text,
  ADD COLUMN observaciones_familia text,
  ADD COLUMN como_nos_conocio text,
  ADD COLUMN como_nos_conocio_otro text;

ALTER TABLE public.lista_espera
  ADD COLUMN primer_apellido_nino text,
  ADD COLUMN segundo_apellido_nino text;

-- ---- 3. La conversión, fila a fila (la guarda previa ya miró cada valor) ----
UPDATE public.ninos n SET primer_apellido = e.v
  FROM (VALUES
    ('205c70e9-245e-4853-9f0c-b5bc71ccde9e'::uuid, 'Garrido'),
    ('5024411e-47b5-425b-92b3-9de1f7dc0dac'::uuid, 'Garcia'),
    ('8aad8325-21c8-4e42-891e-595b7fe2c651'::uuid, 'Gonzalez'),
    ('9cf32e3d-3c1e-494e-a268-90cd0e1e3dc4'::uuid, 'GArcia')) AS e(id, v)
 WHERE n.id = e.id AND n.apellidos = e.v;

UPDATE public.lista_espera l SET primer_apellido_nino = e.v
  FROM (VALUES
    ('249d8e99-190a-4dae-9e67-02fcf264eff6'::uuid, 'Gonzalez'),
    ('41b65733-c0df-4aad-ba5c-98d68b562352'::uuid, 'Garrido'),
    ('5e031eae-bfb8-4942-b678-d454ebd3f759'::uuid, 'Martines'),
    ('6b9d3d42-2f09-45e5-90a3-58bb85c84cce'::uuid, 'GArcia'),
    ('9e091e67-f2e8-4c2f-a1d9-5d02dcd393fb'::uuid, 'Garcia')) AS e(id, v)
 WHERE l.id = e.id AND l.apellidos_nino = e.v;

-- ---- 4. `apellidos` y `apellidos_nino`, derivadas por la base ----
ALTER TABLE public.ninos DROP COLUMN apellidos;
ALTER TABLE public.ninos ADD COLUMN apellidos text GENERATED ALWAYS AS (
  NULLIF(btrim(COALESCE(primer_apellido, '') || ' ' || COALESCE(segundo_apellido, '')), '')
) STORED;
COMMENT ON COLUMN public.ninos.apellidos IS
  'La deriva la base de primer_apellido y segundo_apellido (5a, 20270112120000): no se escribe. Lo que la base puede derivar, no lo acepta del cliente (#507).';

ALTER TABLE public.lista_espera DROP COLUMN apellidos_nino;
ALTER TABLE public.lista_espera ADD COLUMN apellidos_nino text GENERATED ALWAYS AS (
  NULLIF(btrim(COALESCE(primer_apellido_nino, '') || ' ' || COALESCE(segundo_apellido_nino, '')), '')
) STORED;
COMMENT ON COLUMN public.lista_espera.apellidos_nino IS
  'La deriva la base de primer_apellido_nino y segundo_apellido_nino (5a, 20270112120000): no se escribe (#507).';

-- ---- 5. Las reglas de cada campo ----
ALTER TABLE public.ninos
  ADD CONSTRAINT ninos_apellidos_en_pareja CHECK (segundo_apellido IS NULL OR primer_apellido IS NOT NULL),
  ADD CONSTRAINT ninos_apellidos_longitudes CHECK (
    (primer_apellido IS NULL OR char_length(btrim(primer_apellido)) BETWEEN 1 AND 80)
    AND (segundo_apellido IS NULL OR char_length(btrim(segundo_apellido)) BETWEEN 1 AND 80)),
  ADD CONSTRAINT ninos_dni_valido CHECK (dni IS NULL OR privado.dni_nie_valido(dni)),
  ADD CONSTRAINT ninos_hermanos CHECK (
    (hermanos_total IS NULL AND hermanos_lugar IS NULL)
    -- IS NOT NULL a la vista: un CHECK que da NULL deja pasar la fila (medido en el ensayo).
    OR (hermanos_total IS NOT NULL AND hermanos_lugar IS NOT NULL
        AND hermanos_total BETWEEN 1 AND 20 AND hermanos_lugar BETWEEN 1 AND hermanos_total)),
  ADD CONSTRAINT ninos_como_nos_conocio CHECK (
    (como_nos_conocio IS NULL AND como_nos_conocio_otro IS NULL)
    OR (como_nos_conocio IN ('internet', 'redes_sociales', 'recomendacion', 'paso_por_delante')
        AND como_nos_conocio_otro IS NULL)
    OR (como_nos_conocio = 'otro' AND como_nos_conocio_otro IS NOT NULL
        AND char_length(btrim(como_nos_conocio_otro)) BETWEEN 1 AND 200)),
  ADD CONSTRAINT ninos_campos_ficha_longitudes CHECK (
    (lugar_nacimiento IS NULL OR char_length(btrim(lugar_nacimiento)) BETWEEN 1 AND 120)
    AND (direccion_provincia IS NULL OR char_length(direccion_provincia) <= 60)
    AND (observaciones_familia IS NULL OR char_length(btrim(observaciones_familia)) BETWEEN 1 AND 1000));

ALTER TABLE public.lista_espera
  ADD CONSTRAINT lista_espera_apellidos_nino_en_pareja CHECK (segundo_apellido_nino IS NULL OR primer_apellido_nino IS NOT NULL),
  ADD CONSTRAINT lista_espera_apellidos_nino_longitudes CHECK (
    (primer_apellido_nino IS NULL OR char_length(btrim(primer_apellido_nino)) BETWEEN 1 AND 80)
    AND (segundo_apellido_nino IS NULL OR char_length(btrim(segundo_apellido_nino)) BETWEEN 1 AND 80));

COMMENT ON COLUMN public.ninos.hermanos_total IS 'Hijos de la familia contando al niño (5a). Lucía, con Pablo y Ana: 3.';
COMMENT ON COLUMN public.ninos.hermanos_lugar IS 'Lugar que ocupa entre ellos; 1 es el mayor (5a). Lucía, con Pablo mayor y Ana menor: 2.';
COMMENT ON COLUMN public.ninos.observaciones_familia IS
  'Lo que la familia quiere que el centro sepa (5a). Los datos de salud van en la ficha médica, no aquí: la pantalla lo avisa.';

-- ---- 6. Quién los escribe ----
DROP FUNCTION public.actualizar_identidad_nino_tutor(uuid, text, date, public.nino_sexo, text, text, text);
CREATE FUNCTION public.actualizar_identidad_nino_tutor(
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

REVOKE ALL ON FUNCTION public.actualizar_identidad_nino_tutor(uuid, text, text, date, public.nino_sexo, text, text, text, text, text, integer, integer, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.actualizar_identidad_nino_tutor(uuid, text, text, date, public.nino_sexo, text, text, text, text, text, integer, integer, text, text, text) TO authenticated, service_role;

DROP FUNCTION public.crear_o_anadir_a_familia(text, text, date, uuid, uuid, text, text, text, text, uuid, jsonb);
CREATE FUNCTION public.crear_o_anadir_a_familia(p_nombre_nino text, p_primer_apellido_nino text, p_segundo_apellido_nino text, p_fecha_nacimiento date, p_centro_id uuid, p_aula_id uuid, p_tutor_email text, p_tutor_nombre_completo text, p_parentesco text, p_descripcion_parentesco text, p_usuario_id uuid, p_permisos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_email_norm    text := lower(trim(p_tutor_email));
  v_nombre_norm   text := lower(trim(p_tutor_nombre_completo));
  v_curso_id      uuid;
  v_familia_id    uuid;
  v_familia_nueva boolean := false;
  v_familia_estaba_archivada boolean := false;
  v_perfil        public.familia_tutores%ROWTYPE;
  v_nino_id       uuid;
  v_matricula_id  uuid;
  v_otro          record;
BEGIN
  IF NOT public.es_admin(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado a registrar altas en este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- [PR 1 Fase 4] Una cuenta solo entra en el centro por aquí si ya tiene perfil en él (2.º hijo
  -- de una familia de este centro) o si nunca ha operado en ninguno: la cuenta recién creada de
  -- «Completar en Dirección». La de otro centro, el personal o el superusuario se INVITAN y
  -- aceptan; nunca se vinculan sin preguntarles.
  IF p_usuario_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.familia_tutores ft
         JOIN public.familias f ON f.id = ft.familia_id
        WHERE ft.usuario_id = p_usuario_id AND ft.deleted_at IS NULL
          AND f.centro_id = p_centro_id)
     AND (EXISTS (SELECT 1 FROM public.roles_usuario ru WHERE ru.usuario_id = p_usuario_id)
          OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.usuario_id = p_usuario_id)
          OR EXISTS (SELECT 1 FROM public.familia_tutores ft WHERE ft.usuario_id = p_usuario_id)) THEN
    RAISE EXCEPTION 'esa cuenta no tiene perfil en este centro: se invita, no se vincula'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_curso_id := public.curso_activo_de_centro(p_centro_id);
  IF v_curso_id IS NULL THEN
    RAISE EXCEPTION 'el centro no tiene curso academico activo' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.aulas_curso
    WHERE aula_id = p_aula_id AND curso_academico_id = v_curso_id
  ) THEN
    RAISE EXCEPTION 'el aula no pertenece al curso activo del centro' USING ERRCODE = 'foreign_key_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_centro_id::text || ':' || COALESCE(p_usuario_id::text, v_email_norm))
  );

  IF p_usuario_id IS NOT NULL THEN
    SELECT ft.* INTO v_perfil
    FROM public.familia_tutores ft
    JOIN public.familias f ON f.id = ft.familia_id
    WHERE ft.usuario_id = p_usuario_id AND ft.deleted_at IS NULL
      AND f.centro_id = p_centro_id
    LIMIT 1;
  END IF;

  IF v_perfil.id IS NULL THEN
    SELECT ft.* INTO v_perfil
    FROM public.familia_tutores ft
    JOIN public.familias f ON f.id = ft.familia_id
    WHERE lower(trim(ft.email)) = v_email_norm AND ft.deleted_at IS NULL
      AND f.centro_id = p_centro_id
    LIMIT 1;
  END IF;

  IF v_perfil.id IS NOT NULL THEN
    -- [ALTA-HERMANO C1] Sin nombre con el que comparar (Invitar no lo tiene: p_tutor_nombre_completo
    -- = '') no hay colisión posible: antes, '' <> nombre guardado daba una falsa 'colision'.
    IF v_perfil.nombre_completo IS NOT NULL
       AND v_nombre_norm <> ''
       AND lower(trim(v_perfil.nombre_completo)) <> v_nombre_norm THEN
      RETURN jsonb_build_object(
        'resultado',    'colision',
        'familia_id',   v_perfil.familia_id,
        'nino_id',      NULL,
        'colision_info', jsonb_build_object(
          'motivo',           'nombre',
          'nombre_existente', v_perfil.nombre_completo
        )
      );
    END IF;
    v_familia_id := v_perfil.familia_id;

    SELECT (f.deleted_at IS NOT NULL) INTO v_familia_estaba_archivada
    FROM public.familias f
    WHERE f.id = v_familia_id;

    IF v_familia_estaba_archivada THEN
      -- D-5: reactiva la familia SOLO si la archivó una revocación de baja; limpia el motivo.
      UPDATE public.familias
         SET deleted_at = NULL, deleted_reason = NULL
       WHERE id = v_familia_id
         AND deleted_at IS NOT NULL
         AND deleted_reason = 'revocacion_familia';

      -- D-5: reactiva el rol tutor_legal SOLO de los revocados por baja; limpia el motivo.
      -- [INVITACIONES] Solo la última fila retirada de cada tutor, y solo si no tiene ya una viva:
      -- la unicidad cuenta solo las vivas, y puede haber varias retiradas.
      UPDATE public.roles_usuario ru
         SET deleted_at = NULL, deleted_reason = NULL
       WHERE ru.id IN (
           SELECT DISTINCT ON (r.usuario_id) r.id
             FROM public.roles_usuario r
            WHERE r.centro_id = p_centro_id
              AND r.rol = 'tutor_legal'
              AND r.deleted_at IS NOT NULL
              AND r.usuario_id IN (
                SELECT ft.usuario_id
                  FROM public.familia_tutores ft
                 WHERE ft.familia_id = v_familia_id
                   AND ft.usuario_id IS NOT NULL
                   AND ft.deleted_at IS NULL
              )
            ORDER BY r.usuario_id, r.deleted_at DESC, r.id DESC)
         AND ru.deleted_reason = 'revocacion_familia'
         AND NOT EXISTS (
           SELECT 1 FROM public.roles_usuario v
            WHERE v.usuario_id = ru.usuario_id AND v.centro_id = ru.centro_id
              AND v.rol = ru.rol AND v.deleted_at IS NULL);
    END IF;
  ELSE
    INSERT INTO public.familias (centro_id, etiqueta)
    VALUES (
      p_centro_id,
      left(NULLIF(trim(COALESCE(p_nombre_nino,'') || ' ' || COALESCE(p_primer_apellido_nino,'') || ' ' || COALESCE(p_segundo_apellido_nino,'')), ''), 200)
    )
    RETURNING id INTO v_familia_id;
    v_familia_nueva := true;

    INSERT INTO public.familia_tutores (familia_id, usuario_id, rol_familia, email, nombre_completo)
    VALUES (v_familia_id, p_usuario_id, 'titular', p_tutor_email, p_tutor_nombre_completo);
  END IF;

  -- 5a: los dos apellidos, tal como llegan; `apellidos` la deriva la base. Nadie los parte.
  INSERT INTO public.ninos (centro_id, nombre, primer_apellido, segundo_apellido, fecha_nacimiento, familia_id)
  VALUES (p_centro_id, p_nombre_nino, NULLIF(btrim(p_primer_apellido_nino), ''),
          NULLIF(btrim(p_segundo_apellido_nino), ''), p_fecha_nacimiento, v_familia_id)
  RETURNING id INTO v_nino_id;

  INSERT INTO public.matriculas (nino_id, aula_id, curso_academico_id, estado)
  VALUES (v_nino_id, p_aula_id, v_curso_id, 'pendiente')
  RETURNING id INTO v_matricula_id;

  IF p_usuario_id IS NOT NULL THEN
    -- [INVITACIONES] El vínculo y el rol, por la tabla de motivos (`privado.dar_vinculo`,
    -- `privado.dar_rol`), la misma que una invitación: una cuenta que pidió el olvido no vuelve
    -- a entrar por un alta de hermano.
    PERFORM privado.dar_vinculo(
      v_nino_id, p_usuario_id,
      -- [ALTA-HERMANO C2] El tipo sale de su papel en la familia: el segundo_tutor queda
      -- secundario también con el hermano (antes se forzaba principal).
      CASE WHEN v_perfil.rol_familia = 'segundo_tutor'
           THEN 'tutor_legal_secundario'::public.tipo_vinculo
           ELSE 'tutor_legal_principal'::public.tipo_vinculo END,
      p_parentesco::public.parentesco, p_descripcion_parentesco, COALESCE(p_permisos, '{}'::jsonb));

    PERFORM privado.dar_rol(p_usuario_id, p_centro_id, 'tutor_legal');
  END IF;

  -- [ALTA-HERMANO C3] Hermano en una familia que YA existía: el niño nuevo queda vinculado
  -- también a los DEMÁS tutores legales de la familia que ya tienen cuenta, con su mismo papel
  -- (titular → principal, segundo_tutor → secundario) y copiando parentesco y permisos de su
  -- vínculo ACTIVO con otro hijo de la familia. Solo tutores con rol tutor_legal activo en el
  -- centro (no se devuelve acceso a quien se le quitó). Un tutor sin cuenta (usuario_id NULL)
  -- no se toca: se vincula al aceptar su invitación. Familia nueva (1.er hijo) → no aplica.
  IF NOT v_familia_nueva THEN
    FOR v_otro IN
    SELECT v_nino_id AS nino_id, ft.usuario_id,
           CASE WHEN ft.rol_familia = 'segundo_tutor'
                THEN 'tutor_legal_secundario'::public.tipo_vinculo
                ELSE 'tutor_legal_principal'::public.tipo_vinculo END AS tipo_vinculo,
           ref.parentesco, ref.descripcion_parentesco, ref.permisos
      FROM public.familia_tutores ft
      CROSS JOIN LATERAL (
        SELECT vf.parentesco, vf.descripcion_parentesco, vf.permisos
          FROM public.vinculos_familiares vf
          JOIN public.ninos n ON n.id = vf.nino_id
         WHERE vf.usuario_id = ft.usuario_id
           AND n.familia_id = v_familia_id
           AND vf.nino_id <> v_nino_id
           AND vf.deleted_at IS NULL
           AND vf.tipo_vinculo IN ('tutor_legal_principal', 'tutor_legal_secundario')
         ORDER BY vf.created_at DESC
         LIMIT 1
      ) ref
     WHERE ft.familia_id = v_familia_id
       AND ft.deleted_at IS NULL
       AND ft.usuario_id IS NOT NULL
       AND ft.usuario_id IS DISTINCT FROM p_usuario_id
       AND EXISTS (SELECT 1 FROM public.roles_usuario ru
                    WHERE ru.usuario_id = ft.usuario_id AND ru.centro_id = p_centro_id
                      AND ru.rol = 'tutor_legal' AND ru.deleted_at IS NULL)
    LOOP
      PERFORM privado.dar_vinculo(v_otro.nino_id, v_otro.usuario_id, v_otro.tipo_vinculo,
        v_otro.parentesco, v_otro.descripcion_parentesco, v_otro.permisos);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'resultado',    CASE WHEN v_familia_nueva THEN 'familia_creada' ELSE 'nino_anadido' END,
    'familia_id',   v_familia_id,
    'nino_id',      v_nino_id,
    'matricula_id', v_matricula_id,
    'colision_info', NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.crear_o_anadir_a_familia(text, text, text, date, uuid, uuid, text, text, text, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_o_anadir_a_familia(text, text, text, date, uuid, uuid, text, text, text, text, uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.actualizar_familia_nino(p_nino_id uuid, p_patch jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro uuid;
  v_admin boolean;
  v_clave text;
BEGIN
  SELECT centro_id INTO v_centro
    FROM public.ninos
   WHERE id = p_nino_id AND deleted_at IS NULL;
  IF v_centro IS NULL THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_admin := public.es_admin(v_centro);
  IF NOT (v_admin OR public.es_tutor_legal_de(p_nino_id)) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'patch invalido' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR v_clave IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_clave NOT IN ('direccion_calle', 'direccion_numero', 'direccion_cp',
                       'direccion_ciudad', 'direccion_provincia', 'estado_civil_familia') THEN
      RAISE EXCEPTION 'columna no permitida: %', v_clave USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF jsonb_typeof(p_patch -> v_clave) NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'valor no permitido: %', v_clave USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END LOOP;

  IF p_patch = '{}'::jsonb THEN
    RETURN p_nino_id;
  END IF;

  IF NOT v_admin AND public.alta_validada_de_nino(p_nino_id) THEN
    RAISE EXCEPTION 'alta validada: el cambio va a la cola de validacion'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.ninos SET
    direccion_calle  = CASE WHEN p_patch ? 'direccion_calle'  THEN p_patch ->> 'direccion_calle'  ELSE direccion_calle  END,
    direccion_numero = CASE WHEN p_patch ? 'direccion_numero' THEN p_patch ->> 'direccion_numero' ELSE direccion_numero END,
    direccion_cp     = CASE WHEN p_patch ? 'direccion_cp'     THEN p_patch ->> 'direccion_cp'     ELSE direccion_cp     END,
    direccion_ciudad = CASE WHEN p_patch ? 'direccion_ciudad' THEN p_patch ->> 'direccion_ciudad' ELSE direccion_ciudad END,
    -- 5a: la provincia, junto a la ciudad.
    direccion_provincia = CASE WHEN p_patch ? 'direccion_provincia' THEN p_patch ->> 'direccion_provincia' ELSE direccion_provincia END,
    estado_civil_familia = CASE WHEN p_patch ? 'estado_civil_familia'
                                THEN (p_patch ->> 'estado_civil_familia')::public.estado_civil
                                ELSE estado_civil_familia END
  WHERE id = p_nino_id AND deleted_at IS NULL;

  RETURN p_nino_id;
END;
$function$;

-- ---- 7. La purga y la redacción de audit_log ----
CREATE OR REPLACE FUNCTION privado.purgar_nino(p_nino_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lista uuid[];
BEGIN
  -- D-5: motivo 'purga_rgpd' → desarchivar_nino RAISE (no reincorpora un sujeto purgado).
  UPDATE public.ninos SET
    nombre           = '[borrado]',
    -- 5a: `apellidos` la deriva la base de los dos; se borran los dos.
    primer_apellido  = '[borrado]',
    segundo_apellido = NULL,
    fecha_nacimiento = DATE '1900-01-01',
    sexo             = NULL,
    nacionalidad     = NULL,
    foto_url         = NULL,
    notas_admin      = NULL,
    -- Purga RGPD del niño: el resto de columnas personales de la ficha. idioma_principal
    -- es NOT NULL: 'zz' (no es un idioma, como en idiomas_casa) en vez de inventar 'es'. El
    -- CHECK solo admite 'zz' con deleted_reason = 'purga_rgpd', que pone este mismo UPDATE.
    idioma_principal     = 'zz',
    direccion_calle      = NULL,
    direccion_numero     = NULL,
    direccion_cp         = NULL,
    direccion_ciudad     = NULL,
    libro_familia_path   = NULL,
    estado_civil_familia = NULL,
    -- 5a: los campos nuevos de la ficha.
    lugar_nacimiento      = NULL,
    dni                   = NULL,
    hermanos_total        = NULL,
    hermanos_lugar        = NULL,
    direccion_provincia   = NULL,
    observaciones_familia = NULL,
    como_nos_conocio      = NULL,
    como_nos_conocio_otro = NULL,
    deleted_reason   = 'purga_rgpd',
    deleted_at       = COALESCE(deleted_at, now()),
    -- Retención (PR-7): desde cuándo está bloqueado lo que se conserva.
    purgado_en       = COALESCE(purgado_en, now())
  WHERE id = p_nino_id;

  UPDATE public.info_medica_emergencia SET
    alergias_graves     = NULL,
    notas_emergencia    = NULL,
    medicacion_habitual = NULL,
    alergias_leves      = NULL,
    medico_familia      = NULL,
    telefono_emergencia = NULL
  WHERE nino_id = p_nino_id;

  UPDATE public.datos_pedagogicos_nino SET
    lactancia_observaciones          = NULL,
    control_esfinteres_observaciones = NULL,
    siesta_horario_habitual          = NULL,
    siesta_observaciones             = NULL,
    alimentacion_observaciones       = CASE WHEN tipo_alimentacion = 'otra'
                                            THEN '[borrado]' ELSE NULL END,
    -- Purga RGPD del niño: el CHECK exige de 1 a 8 códigos de 2 letras; 'zz' no es un idioma.
    idiomas_casa                     = ARRAY['zz'],
    deleted_at                       = COALESCE(deleted_at, now())
  WHERE nino_id = p_nino_id;

  -- Purga RGPD del niño: el motivo de baja es texto libre del centro sobre el niño.
  UPDATE public.matriculas SET motivo_baja = NULL
  WHERE nino_id = p_nino_id AND motivo_baja IS NOT NULL;

  -- D-5: motivo 'purga_rgpd' → desarchivar_nino NUNCA revive un vínculo purgado.
  UPDATE public.vinculos_familiares SET
    descripcion_parentesco = NULL,
    deleted_reason         = 'purga_rgpd',
    deleted_at             = COALESCE(deleted_at, now())
  WHERE nino_id = p_nino_id;

  DELETE FROM public.media m
  WHERE EXISTS (
          SELECT 1 FROM public.media_etiquetas e
          WHERE e.media_id = m.id AND e.nino_id = p_nino_id)
    AND NOT EXISTS (
          SELECT 1 FROM public.media_etiquetas e2
          WHERE e2.media_id = m.id AND e2.nino_id <> p_nino_id);
  DELETE FROM public.media_etiquetas WHERE nino_id = p_nino_id;

  -- Cierre de la purga: los cambios pendientes del niño (su dirección, su libro de familia,
  -- los datos de sus tutores) se borran; el payload no entra en audit_log, solo la tabla lo
  -- guarda. Los documentos en Storage los borra antes el manifiesto de adjuntos.
  DELETE FROM public.cambios_pendientes WHERE nino_id = p_nino_id;

  -- Retención (F11-B, punto 6, PR-4): su operativa (agenda, asistencia, mensajes, informes,
  -- citas, recordatorios, respuestas a eventos) se borra, con sus copias en audit_log.
  PERFORM privado.olvido_borrar_operativa_nino(p_nino_id);

  -- Purga RGPD del niño: la copia en audit_log, con la lista de claves personales por tabla
  -- (_claves_pii_nino).
  PERFORM public._redactar_auditoria_nino(p_nino_id);

  -- Purga de lista_espera: el prospecto del niño se borra entero (la plaza no tiene sentido
  -- sin el niño). Su copia en audit_log se redacta por registro_id: así se alcanza también el
  -- INSERT, que nace con nino_id NULL, y el DELETE que acaba de escribir esta purga.
  WITH borrados AS (
    DELETE FROM public.lista_espera WHERE nino_id = p_nino_id RETURNING id
  )
  SELECT array_agg(id) INTO v_lista FROM borrados;
  UPDATE public.audit_log SET
    valores_antes   = public._redactar_jsonb(valores_antes,   public._claves_pii_nino('lista_espera')),
    valores_despues = public._redactar_jsonb(valores_despues, public._claves_pii_nino('lista_espera'))
  WHERE tabla = 'lista_espera' AND registro_id = ANY (v_lista);

END;
$function$;

CREATE OR REPLACE FUNCTION public._claves_pii_nino(p_tabla text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT ARRAY[
    'nombre', 'apellidos', 'fecha_nacimiento', 'sexo', 'nacionalidad', 'foto_url', 'notas_admin',
    'alergias_graves', 'notas_emergencia', 'medicacion_habitual', 'alergias_leves',
    'medico_familia', 'telefono_emergencia',
    'ip_address', 'user_agent', 'descripcion_parentesco', 'nombre_externo', 'observaciones',
    'observaciones_generales', 'contenido', 'nombre_tecleado'
  ]::text[] || CASE p_tabla
    WHEN 'ninos' THEN ARRAY['idioma_principal', 'direccion_calle', 'direccion_numero', 'direccion_cp',
                            'direccion_ciudad', 'libro_familia_path', 'estado_civil_familia',
                            'primer_apellido', 'segundo_apellido', 'lugar_nacimiento', 'dni',
                            'hermanos_total', 'hermanos_lugar', 'direccion_provincia',
                            'observaciones_familia', 'como_nos_conocio', 'como_nos_conocio_otro']
    WHEN 'datos_pedagogicos_nino' THEN ARRAY['lactancia_observaciones', 'control_esfinteres_observaciones',
                            'siesta_horario_habitual', 'siesta_observaciones',
                            'alimentacion_observaciones', 'idiomas_casa']
    WHEN 'matriculas' THEN ARRAY['motivo_baja']
    WHEN 'firmas_autorizacion' THEN ARRAY['firma_imagen', 'comentario', 'datos']
    WHEN 'firmas_documentos_centro' THEN ARRAY['firma_imagen']
    WHEN 'autorizaciones' THEN ARRAY['titulo', 'texto', 'datos']
    WHEN 'cita_invitados' THEN ARRAY['comentario']
    WHEN 'lista_espera' THEN ARRAY['nombre_nino', 'apellidos_nino', 'primer_apellido_nino',
                                   'segundo_apellido_nino', 'telefono_tutor', 'email_tutor', 'nota']
    ELSE ARRAY[]::text[]
  END;
$function$;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_n integer;
  v_src text;
  v_acl text;
  v_lista text;
BEGIN
  -- Las dos columnas, generadas; y la conversión, hecha (en una base vacía no hay filas).
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.ninos'::regclass AND a.attname = 'apellidos'
                  AND NOT a.attisdropped AND a.attgenerated = 's') THEN
    RAISE EXCEPTION 'ninos.apellidos no es generada';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.lista_espera'::regclass AND a.attname = 'apellidos_nino'
                  AND NOT a.attisdropped AND a.attgenerated = 's') THEN
    RAISE EXCEPTION 'lista_espera.apellidos_nino no es generada';
  END IF;
  SELECT count(*) INTO v_n FROM public.ninos n
    JOIN (VALUES
    ('205c70e9-245e-4853-9f0c-b5bc71ccde9e'::uuid, 'Garrido'),
    ('5024411e-47b5-425b-92b3-9de1f7dc0dac'::uuid, 'Garcia'),
    ('8aad8325-21c8-4e42-891e-595b7fe2c651'::uuid, 'Gonzalez'),
    ('9cf32e3d-3c1e-494e-a268-90cd0e1e3dc4'::uuid, 'GArcia')) AS e(id, v) ON e.id = n.id
   WHERE n.primer_apellido IS DISTINCT FROM e.v OR n.segundo_apellido IS NOT NULL OR n.apellidos IS DISTINCT FROM e.v;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% niños mal convertidos', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.lista_espera l
    JOIN (VALUES
    ('249d8e99-190a-4dae-9e67-02fcf264eff6'::uuid, 'Gonzalez'),
    ('41b65733-c0df-4aad-ba5c-98d68b562352'::uuid, 'Garrido'),
    ('5e031eae-bfb8-4942-b678-d454ebd3f759'::uuid, 'Martines'),
    ('6b9d3d42-2f09-45e5-90a3-58bb85c84cce'::uuid, 'GArcia'),
    ('9e091e67-f2e8-4c2f-a1d9-5d02dcd393fb'::uuid, 'Garcia')) AS e(id, v) ON e.id = l.id
   WHERE l.primer_apellido_nino IS DISTINCT FROM e.v OR l.segundo_apellido_nino IS NOT NULL OR l.apellidos_nino IS DISTINCT FROM e.v;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% prospectos mal convertidos', v_n;
  END IF;
  RAISE NOTICE '5a: convertidos: % niños y % prospectos',
    (SELECT count(*) FROM public.ninos WHERE primer_apellido IS NOT NULL),
    (SELECT count(*) FROM public.lista_espera WHERE primer_apellido_nino IS NOT NULL);

  -- Ninguna función de public ni de privado escribe `apellidos` ni `apellidos_nino`: ni en un SET
  -- ni en la lista de columnas de un INSERT. Se mira el cuerpo sin comentarios.
  SELECT count(*), string_agg(n.nspname || '.' || p.proname, ', ') INTO v_n, v_lista
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'privado')
     AND regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g')
         ~* '(\mapellidos(_nino)?\s*=[^=]|\(\s*[^)]*\mapellidos(_nino)?\M[^)]*\)\s*VALUES)';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'funciones que escriben apellidos: %', v_lista;
  END IF;
  RAISE NOTICE '5a: funciones que escriben apellidos o apellidos_nino: %', v_n;

  -- Las firmas: las viejas no están, las nuevas sí, y solo para authenticated y service_role.
  IF to_regprocedure('public.actualizar_identidad_nino_tutor(uuid,text,date,public.nino_sexo,text,text,text)') IS NOT NULL
     OR to_regprocedure('public.crear_o_anadir_a_familia(text,text,date,uuid,uuid,text,text,text,text,uuid,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'queda una firma vieja';
  END IF;
  FOR v_src IN VALUES
    ('public.actualizar_identidad_nino_tutor(uuid,text,text,date,public.nino_sexo,text,text,text,text,text,integer,integer,text,text,text)'),
    ('public.crear_o_anadir_a_familia(text,text,text,date,uuid,uuid,text,text,text,text,uuid,jsonb)')
  LOOP
    SELECT array_to_string(ARRAY(SELECT x FROM unnest(p.proacl::text[]) x WHERE x NOT LIKE 'postgres=%' ORDER BY x), ',')
      INTO v_acl FROM pg_proc p WHERE p.oid = to_regprocedure(v_src);
    IF v_acl IS DISTINCT FROM 'authenticated=X/postgres,service_role=X/postgres' THEN
      RAISE EXCEPTION '% tiene la ACL %', v_src, coalesce(v_acl, 'falta la función');
    END IF;
  END LOOP;

  -- Lo que cada cuerpo tiene que decir.
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'privado.purgar_nino(uuid)'::regprocedure;
  IF v_src NOT LIKE '%primer_apellido  = ''[borrado]''%' OR v_src NOT LIKE '%segundo_apellido = NULL%'
     OR v_src NOT LIKE '%dni                   = NULL%' OR v_src NOT LIKE '%observaciones_familia = NULL%'
     OR v_src NOT LIKE '%como_nos_conocio_otro = NULL%' OR v_src NOT LIKE '%hermanos_lugar        = NULL%' THEN
    RAISE EXCEPTION 'privado.purgar_nino no borra los campos de la 5a';
  END IF;
  IF NOT (public._claves_pii_nino('ninos') @> ARRAY['primer_apellido', 'segundo_apellido', 'lugar_nacimiento', 'dni',
            'hermanos_total', 'hermanos_lugar', 'direccion_provincia', 'observaciones_familia', 'como_nos_conocio',
            'como_nos_conocio_otro']
          AND public._claves_pii_nino('lista_espera') @> ARRAY['primer_apellido_nino', 'segundo_apellido_nino']) THEN
    RAISE EXCEPTION '_claves_pii_nino no conoce los campos de la 5a';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.actualizar_familia_nino(uuid,jsonb)'::regprocedure;
  IF v_src NOT LIKE '%''direccion_ciudad'', ''direccion_provincia'', ''estado_civil_familia''%'
     OR v_src NOT LIKE '%direccion_provincia = CASE WHEN p_patch ? ''direccion_provincia''%' THEN
    RAISE EXCEPTION 'actualizar_familia_nino no escribe la provincia';
  END IF;

  -- La letra del DNI y del NIE (12345678 % 23 = 14, la Z; 01234567 % 23 = 19, la L).
  IF NOT (privado.dni_nie_valido('12345678Z') AND privado.dni_nie_valido('X1234567L')
          AND NOT privado.dni_nie_valido('12345678A') AND NOT privado.dni_nie_valido('X1234567A')
          AND NOT privado.dni_nie_valido('1234567Z')) THEN
    RAISE EXCEPTION 'privado.dni_nie_valido no comprueba la letra';
  END IF;

  -- `privado` sigue fuera de la API.
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'privado' AND has_schema_privilege('anon', oid, 'USAGE')) THEN
    RAISE EXCEPTION 'anon tiene USAGE en privado';
  END IF;
END
$guarda$;
