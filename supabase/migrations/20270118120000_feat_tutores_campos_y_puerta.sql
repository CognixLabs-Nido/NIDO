-- =============================================================================
-- FEAT — Los datos del tutor y su puerta (serie de altas, fase 6, paso 2; 2026-11-13)
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/altas-serie.md, «Fase 6: campos de tutores». Requiere `20270117120000` aplicada
-- (`familia_tutores` por columnas): las cinco columnas nuevas nacen cerradas a la sesión.
--
-- Decidido por el responsable (2026-11-12 y 2026-11-13):
--   · Cinco datos nuevos del tutor: teléfono, fecha de nacimiento, número del DNI (obligatorios),
--     estudios y empresa (voluntarios). Teléfono internacional; DNI con su letra solo si tiene forma
--     española; fecha en el pasado y de hace menos de 120 años, sin mayoría de edad.
--   · UNA REGLA: mientras el tutor 2 no tiene cuenta, sus datos los gestiona el tutor 1 (los escribe
--     y los lee); en cuanto tiene cuenta, el tutor 1 deja de ver sus datos personales salvo el
--     teléfono, y cada uno ve los suyos. El teléfono lo ven además la Dirección y la profe del aula;
--     el autorizado, nada. El bucket `dni-tutores` se cierra con la misma regla.
--   · La cola de cambios del tutor, en la BASE y POR FAMILIA. Medido abierto el 2026-11-13 (ensayo
--     terminado en RAISE): con el alta validada, un tutor escribía directo su nombre, su dirección
--     o su DNI, y los del OTRO tutor aunque tuviera cuenta; y por el alta de un hermano sin validar,
--     la app tampoco encolaba. La cola solo existía en la app. Aquí la escritura del tutor pasa por
--     `guardar_tutor` / `fijar_dni_tutor`, que aplican la regla y la cola (las 15 columnas de antes
--     y las cinco nuevas); las políticas de escritura del tutor se van.
--   · `marcar_matricula_lista` exige los datos de los tutores al cerrar un alta pendiente. Nada es
--     retroactivo.
--   · El export art. 15 lleva los cinco datos a la fila de su tutor, y la Dirección exporta a un
--     tutor sin cuenta (sujeto `tutor`), que antes no podía exportarse por ningún camino.
--
-- Las funciones que cambian se generan con un guion desde su cuerpo VIVO, con la guarda de md5.
-- ORDEN: aplicar y desplegar seguidos. Con la migración aplicada y la app de antes, un tutor que
-- guarda sus datos recibe «no autorizado» sin escribir nada (la puerta cerrada antes que la app
-- nueva); la app nueva necesita las funciones de aquí. La aplica el responsable por SQL Editor,
-- copiando el fichero de la rama. Sin COMMIT ni BEGIN. Tras aplicar: registrar en
-- supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_esperado text;
  v_firma text;
  v text;
BEGIN
  FOR v_firma, v_esperado IN VALUES
    ('public.marcar_matricula_lista(uuid)', 'a6b60df77f72753c9af867c273f15418'),
    ('public.purgar_sujeto_db(uuid)', '316ae102783d9680fa6e3f674d254474'),
    ('public.export_datos_sujeto(text,uuid)', '618073f010e1350dba868e3b0a7c3b42'),
    ('public.es_tutor_de_familia(uuid)', '3b67b913ada5eca51c25a519aed25e29'),
    ('public.es_profe_de_nino(uuid)', 'ba3d64df31679c8cf1408b7446b69798'),
    ('privado.dni_nie_valido(text)', '0a0f319bd0177ade3984a25a311100f5')
  LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_firma);
    IF v_md5 IS DISTINCT FROM v_esperado THEN
      RAISE EXCEPTION '% no es la de antes: %', v_firma, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;

  -- El paso 1 aplicado: la sesión sin SELECT de tabla, y las 15 columnas de antes.
  IF has_table_privilege('authenticated', 'public.familia_tutores', 'SELECT') THEN
    RAISE EXCEPTION 'falta 20270117120000: la sesión aún tiene el SELECT de tabla de familia_tutores';
  END IF;
  SELECT string_agg(attname, ',' ORDER BY attname) INTO v
    FROM pg_attribute
   WHERE attrelid = 'public.familia_tutores'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v IS DISTINCT FROM 'centro_id,created_at,deleted_at,direccion_calle,direccion_ciudad,direccion_cp,direccion_numero,dni_documento_path,email,familia_id,id,nombre_completo,rol_familia,updated_at,usuario_id' THEN
    RAISE EXCEPTION 'familia_tutores no tiene las columnas esperadas: %', v;
  END IF;

  -- Las políticas de escritura, tal como están vivas: las del tutor se van, las de admin se quedan.
  SELECT string_agg(policyname || '=' || cmd || ':' || coalesce(qual, '-') || '|' || coalesce(with_check, '-'), E'\n' ORDER BY policyname)
    INTO v FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'familia_tutores' AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL');
  IF v IS DISTINCT FROM
       'familia_tutores_insert=INSERT:-|es_admin(privado.centro_de_familia(familia_id))' || E'\n' ||
       'familia_tutores_insert_tutor=INSERT:-|(es_tutor_de_familia(familia_id) AND (usuario_id IS NULL) AND (rol_familia = ''segundo_tutor''::text))' || E'\n' ||
       'familia_tutores_update=UPDATE:es_admin(privado.centro_de_familia(familia_id))|es_admin(privado.centro_de_familia(familia_id))' || E'\n' ||
       'familia_tutores_update_tutor=UPDATE:(es_tutor_de_familia(familia_id) AND (deleted_at IS NULL))|(es_tutor_de_familia(familia_id) AND (deleted_at IS NULL))' THEN
    RAISE EXCEPTION 'las políticas de escritura de familia_tutores no son las esperadas: %', v;
  END IF;

  -- Las dos políticas del bucket que se rehacen, tal como están vivas.
  IF (SELECT qual FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'dni_tutores_select')
       IS DISTINCT FROM '((bucket_id = ''dni-tutores''::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_legal_de(((storage.foldername(name))[2])::uuid)) AND privado.ruta_coherente(bucket_id, name))'
  OR (SELECT qual || '|' || with_check FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'dni_tutores_update')
       IS DISTINCT FROM '((bucket_id = ''dni-tutores''::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_legal_de(((storage.foldername(name))[2])::uuid)) AND privado.ruta_coherente(bucket_id, name))|((bucket_id = ''dni-tutores''::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_legal_de(((storage.foldername(name))[2])::uuid)) AND privado.ruta_coherente(bucket_id, name))' THEN
    RAISE EXCEPTION 'las políticas de lectura del bucket dni-tutores no son las esperadas';
  END IF;

  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid = 'public.export_log'::regclass AND conname = 'export_log_sujeto_tipo_check')
     IS DISTINCT FROM 'CHECK ((sujeto_tipo = ANY (ARRAY[''usuario''::text, ''nino''::text])))' THEN
    RAISE EXCEPTION 'export_log_sujeto_tipo_check no es el esperado';
  END IF;

  RAISE NOTICE 'guarda previa: 6 funciones, columnas, políticas de escritura, bucket y export_log como antes';
END;
$guarda$;

-- ---- 1. Las cinco columnas, cerradas a la sesión ----
-- El número del DNI admite cualquier documento (un pasaporte, uno extranjero); la letra solo se
-- comprueba cuando tiene forma de DNI o NIE, como en el titular del mandato SEPA.
CREATE FUNCTION privado.documento_tutor_valido(p_doc text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT char_length(btrim(p_doc)) BETWEEN 1 AND 40
     AND CASE
           WHEN upper(regexp_replace(p_doc, '[\s.-]', '', 'g')) ~ '^([0-9]{8}|[XYZ][0-9]{7})[A-Z]$'
             THEN privado.dni_nie_valido(upper(regexp_replace(p_doc, '[\s.-]', '', 'g')))
           ELSE true
         END;
$function$;
REVOKE ALL ON FUNCTION privado.documento_tutor_valido(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION privado.documento_tutor_valido(text) TO authenticated, service_role;

-- Sin espacios, puntos, guiones ni paréntesis, y el 00 de delante como +. Vacío → NULL.
CREATE FUNCTION privado.normalizar_telefono(p_tel text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT NULLIF(regexp_replace(regexp_replace(p_tel, '[\s.()-]', '', 'g'), '^00', '+'), '');
$function$;
REVOKE ALL ON FUNCTION privado.normalizar_telefono(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION privado.normalizar_telefono(text) TO authenticated, service_role;

ALTER TABLE public.familia_tutores
  ADD COLUMN telefono text,
  ADD COLUMN fecha_nacimiento date,
  ADD COLUMN dni_numero text,
  ADD COLUMN estudios text,
  ADD COLUMN empresa text,
  -- De 6 a 15 cifras con o sin +: un número de cualquier país (el máximo internacional es 15).
  ADD CONSTRAINT familia_tutores_telefono_formato CHECK (telefono ~ '^\+?[0-9]{6,15}$'),
  -- El tope fijo; el de 120 años y el «en el pasado» los aplica `guardar_tutor` con la fecha de hoy.
  ADD CONSTRAINT familia_tutores_fecha_nacimiento_rango CHECK (fecha_nacimiento >= DATE '1900-01-01'),
  ADD CONSTRAINT familia_tutores_dni_numero_valido CHECK (privado.documento_tutor_valido(dni_numero)),
  ADD CONSTRAINT familia_tutores_estudios_largo CHECK (char_length(estudios) BETWEEN 1 AND 200),
  ADD CONSTRAINT familia_tutores_empresa_largo CHECK (char_length(empresa) BETWEEN 1 AND 200);

COMMENT ON COLUMN public.familia_tutores.telefono IS
  'Fase 6. Sin GRANT a la sesión: lo leen la Dirección, los dos tutores y la profe del aula, por tutores_de_familia / telefonos_familia_de_nino.';
COMMENT ON COLUMN public.familia_tutores.fecha_nacimiento IS
  'Fase 6. Sin GRANT: la Dirección y el propio tutor (o el tutor 1 mientras el 2 no tiene cuenta), por tutores_de_familia.';
COMMENT ON COLUMN public.familia_tutores.dni_numero IS
  'Fase 6. Sin GRANT: la Dirección y el propio tutor (o el tutor 1 mientras el 2 no tiene cuenta), por tutores_de_familia.';
COMMENT ON COLUMN public.familia_tutores.estudios IS
  'Fase 6, voluntario. Sin GRANT: la Dirección y el propio tutor (o el tutor 1 mientras el 2 no tiene cuenta).';
COMMENT ON COLUMN public.familia_tutores.empresa IS
  'Fase 6, voluntario. Sin GRANT: la Dirección y el propio tutor (o el tutor 1 mientras el 2 no tiene cuenta).';

-- ---- 2. La regla, en una función ----
-- ¿Gestiona quien llama los datos personales de esta fila? La Dirección del centro, el propio tutor,
-- y el otro tutor de la familia mientras la fila no tiene cuenta (solo puede ser el tutor 1: el 2 sin
-- cuenta no entra en la app).
CREATE FUNCTION privado.gestiona_tutor(p_familia_id uuid, p_usuario_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
       public.es_admin(privado.centro_de_familia(p_familia_id))
    OR p_usuario_id = auth.uid()
    OR (p_usuario_id IS NULL AND public.es_tutor_de_familia(p_familia_id)));
$function$;
REVOKE ALL ON FUNCTION privado.gestiona_tutor(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION privado.gestiona_tutor(uuid, uuid) TO authenticated, service_role;

-- ¿Tiene la familia algún niño con el alta validada? La cola del tutor es POR FAMILIA: sus datos son
-- de la familia, y por niño se colaba por el alta de un hermano sin validar.
CREATE FUNCTION privado.familia_alta_validada(p_familia_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.ninos n
      JOIN public.matriculas m ON m.nino_id = n.id
     WHERE n.familia_id = p_familia_id
       AND m.estado = 'activa' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL);
$function$;
REVOKE ALL ON FUNCTION privado.familia_alta_validada(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION privado.familia_alta_validada(uuid) TO authenticated, service_role;

-- Lo que el alta exige de un tutor (D12, D14, D15 y el número del DNI). El número de la calle no
-- («s/n»), ni los estudios ni la empresa.
CREATE FUNCTION privado.tutor_completo(t public.familia_tutores)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT NULLIF(btrim(t.nombre_completo), '') IS NOT NULL
     AND NULLIF(btrim(t.email), '') IS NOT NULL
     AND t.telefono IS NOT NULL
     AND t.fecha_nacimiento IS NOT NULL
     AND NULLIF(btrim(t.dni_numero), '') IS NOT NULL
     AND t.dni_documento_path IS NOT NULL
     AND NULLIF(btrim(t.direccion_calle), '') IS NOT NULL
     AND NULLIF(btrim(t.direccion_cp), '') IS NOT NULL
     AND NULLIF(btrim(t.direccion_ciudad), '') IS NOT NULL;
$function$;
REVOKE ALL ON FUNCTION privado.tutor_completo(public.familia_tutores) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION privado.tutor_completo(public.familia_tutores) TO authenticated, service_role;

-- ---- 3. La escritura: guardar_tutor y fijar_dni_tutor ----
-- Lo que la puerta comprueba, en este orden: quién (la regla), qué (las claves y su forma) y cuándo
-- (con el alta de la familia validada, un CAMBIO de un tutor va a la cola: 42501 HINT cola_validacion;
-- mandar lo mismo no es un cambio). La Dirección escribe siempre: es quien aprueba la cola.
CREATE FUNCTION public.guardar_tutor(p_familia_id uuid, p_rol_familia text, p_datos jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_admin  boolean;
  v_fila   public.familia_tutores%ROWTYPE;
  v_nueva  public.familia_tutores%ROWTYPE;
  v_existe boolean;
  v_clave  text;
  v_id     uuid;
BEGIN
  IF auth.uid() IS NULL OR p_familia_id IS NULL OR p_rol_familia IS NULL
     OR p_rol_familia NOT IN ('titular', 'segundo_tutor')
     OR jsonb_typeof(p_datos) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'no autorizado a guardar los datos de este tutor'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT k INTO v_clave FROM jsonb_object_keys(p_datos) k
   WHERE k <> ALL (ARRAY['nombre_completo', 'email', 'direccion_calle', 'direccion_numero',
                         'direccion_cp', 'direccion_ciudad', 'telefono', 'fecha_nacimiento',
                         'dni_numero', 'estudios', 'empresa'])
   LIMIT 1;
  IF v_clave IS NOT NULL THEN
    RAISE EXCEPTION 'campo de tutor desconocido: %', v_clave USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_admin := public.es_admin(privado.centro_de_familia(p_familia_id));
  SELECT * INTO v_fila FROM public.familia_tutores
   WHERE familia_id = p_familia_id AND rol_familia = p_rol_familia AND deleted_at IS NULL
   FOR UPDATE;
  v_existe := FOUND;

  -- Quién: la Dirección; un tutor de la familia sobre su fila, o sobre la del otro mientras no tiene
  -- cuenta (o aún no existe: el segundo tutor lo da de alta el tutor 1).
  IF NOT v_admin AND NOT (
       public.es_tutor_de_familia(p_familia_id)
       AND CASE WHEN v_existe THEN privado.gestiona_tutor(p_familia_id, v_fila.usuario_id)
                ELSE p_rol_familia = 'segundo_tutor' END) THEN
    RAISE EXCEPTION 'no autorizado a guardar los datos de este tutor'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT v_existe AND p_rol_familia = 'titular' THEN
    -- La fila del titular la crea el alta; sin ella, la familia está en un estado que no se arregla aquí.
    RAISE EXCEPTION 'la familia no tiene titular' USING ERRCODE = 'no_data_found', HINT = 'titular_sin_fila';
  END IF;

  -- Qué: cada clave presente se escribe, normalizada; vacío es NULL. Las ausentes no se tocan.
  v_nueva := v_fila;
  IF p_datos ? 'nombre_completo'  THEN v_nueva.nombre_completo  := NULLIF(btrim(p_datos->>'nombre_completo'), ''); END IF;
  IF p_datos ? 'email'            THEN v_nueva.email            := NULLIF(lower(btrim(p_datos->>'email')), ''); END IF;
  IF p_datos ? 'direccion_calle'  THEN v_nueva.direccion_calle  := NULLIF(btrim(p_datos->>'direccion_calle'), ''); END IF;
  IF p_datos ? 'direccion_numero' THEN v_nueva.direccion_numero := NULLIF(btrim(p_datos->>'direccion_numero'), ''); END IF;
  IF p_datos ? 'direccion_cp'     THEN v_nueva.direccion_cp     := NULLIF(btrim(p_datos->>'direccion_cp'), ''); END IF;
  IF p_datos ? 'direccion_ciudad' THEN v_nueva.direccion_ciudad := NULLIF(btrim(p_datos->>'direccion_ciudad'), ''); END IF;
  IF p_datos ? 'telefono'         THEN v_nueva.telefono         := privado.normalizar_telefono(p_datos->>'telefono'); END IF;
  IF p_datos ? 'dni_numero'       THEN v_nueva.dni_numero       := NULLIF(upper(btrim(p_datos->>'dni_numero')), ''); END IF;
  IF p_datos ? 'estudios'         THEN v_nueva.estudios         := NULLIF(btrim(p_datos->>'estudios'), ''); END IF;
  IF p_datos ? 'empresa'          THEN v_nueva.empresa          := NULLIF(btrim(p_datos->>'empresa'), ''); END IF;
  IF p_datos ? 'fecha_nacimiento' THEN
    v_nueva.fecha_nacimiento := NULLIF(p_datos->>'fecha_nacimiento', '')::date;
    -- En el pasado y de hace menos de 120 años. Sin mayoría de edad: un padre menor existe.
    IF v_nueva.fecha_nacimiento >= CURRENT_DATE
       OR v_nueva.fecha_nacimiento < CURRENT_DATE - interval '120 years' THEN
      RAISE EXCEPTION 'fecha de nacimiento del tutor fuera de rango'
        USING ERRCODE = 'check_violation', HINT = 'fecha_nacimiento_fuera_de_rango';
    END IF;
  END IF;

  IF (v_nueva.nombre_completo, v_nueva.email, v_nueva.direccion_calle, v_nueva.direccion_numero,
      v_nueva.direccion_cp, v_nueva.direccion_ciudad, v_nueva.telefono, v_nueva.fecha_nacimiento,
      v_nueva.dni_numero, v_nueva.estudios, v_nueva.empresa)
     IS NOT DISTINCT FROM
     (v_fila.nombre_completo, v_fila.email, v_fila.direccion_calle, v_fila.direccion_numero,
      v_fila.direccion_cp, v_fila.direccion_ciudad, v_fila.telefono, v_fila.fecha_nacimiento,
      v_fila.dni_numero, v_fila.estudios, v_fila.empresa) THEN
    RETURN v_fila.id;  -- nada cambia (NULL si la fila no existe y no trae nada)
  END IF;

  -- Cuándo: con el alta de la familia validada, el cambio de un tutor va a la cola.
  IF NOT v_admin AND privado.familia_alta_validada(p_familia_id) THEN
    RAISE EXCEPTION 'alta validada: el cambio de datos del tutor va a la cola de validacion'
      USING ERRCODE = 'insufficient_privilege', HINT = 'cola_validacion';
  END IF;

  IF v_existe THEN
    UPDATE public.familia_tutores SET
      nombre_completo  = v_nueva.nombre_completo,
      email            = v_nueva.email,
      direccion_calle  = v_nueva.direccion_calle,
      direccion_numero = v_nueva.direccion_numero,
      direccion_cp     = v_nueva.direccion_cp,
      direccion_ciudad = v_nueva.direccion_ciudad,
      telefono         = v_nueva.telefono,
      fecha_nacimiento = v_nueva.fecha_nacimiento,
      dni_numero       = v_nueva.dni_numero,
      estudios         = v_nueva.estudios,
      empresa          = v_nueva.empresa
     WHERE id = v_fila.id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.familia_tutores
      (familia_id, rol_familia, usuario_id, nombre_completo, email, direccion_calle, direccion_numero,
       direccion_cp, direccion_ciudad, telefono, fecha_nacimiento, dni_numero, estudios, empresa)
    VALUES
      (p_familia_id, 'segundo_tutor', NULL, v_nueva.nombre_completo, v_nueva.email,
       v_nueva.direccion_calle, v_nueva.direccion_numero, v_nueva.direccion_cp,
       v_nueva.direccion_ciudad, v_nueva.telefono, v_nueva.fecha_nacimiento, v_nueva.dni_numero,
       v_nueva.estudios, v_nueva.empresa)
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END
$function$;
REVOKE ALL ON FUNCTION public.guardar_tutor(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_tutor(uuid, text, jsonb) TO authenticated, service_role;

-- La ruta del PDF del DNI, con la misma puerta. Devuelve la ruta de antes (para borrar el objeto).
-- La ruta la valida el trigger de siempre (`familia_tutores_validar_ruta_dni`).
CREATE FUNCTION public.fijar_dni_tutor(p_familia_id uuid, p_rol_familia text, p_path text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_admin  boolean;
  v_fila   public.familia_tutores%ROWTYPE;
  v_existe boolean;
BEGIN
  IF auth.uid() IS NULL OR p_familia_id IS NULL OR p_path IS NULL
     OR p_rol_familia IS NULL OR p_rol_familia NOT IN ('titular', 'segundo_tutor') THEN
    RAISE EXCEPTION 'no autorizado a guardar el DNI de este tutor'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_admin := public.es_admin(privado.centro_de_familia(p_familia_id));
  SELECT * INTO v_fila FROM public.familia_tutores
   WHERE familia_id = p_familia_id AND rol_familia = p_rol_familia AND deleted_at IS NULL
   FOR UPDATE;
  v_existe := FOUND;

  IF NOT v_admin AND NOT (
       public.es_tutor_de_familia(p_familia_id)
       AND CASE WHEN v_existe THEN privado.gestiona_tutor(p_familia_id, v_fila.usuario_id)
                ELSE p_rol_familia = 'segundo_tutor' END) THEN
    RAISE EXCEPTION 'no autorizado a guardar el DNI de este tutor'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT v_existe AND p_rol_familia = 'titular' THEN
    RAISE EXCEPTION 'la familia no tiene titular' USING ERRCODE = 'no_data_found', HINT = 'titular_sin_fila';
  END IF;

  IF v_existe AND v_fila.dni_documento_path IS NOT DISTINCT FROM p_path THEN
    RETURN v_fila.dni_documento_path;
  END IF;
  IF NOT v_admin AND privado.familia_alta_validada(p_familia_id) THEN
    RAISE EXCEPTION 'alta validada: el DNI del tutor va a la cola de validacion'
      USING ERRCODE = 'insufficient_privilege', HINT = 'cola_validacion';
  END IF;

  IF v_existe THEN
    UPDATE public.familia_tutores SET dni_documento_path = p_path WHERE id = v_fila.id;
  ELSE
    INSERT INTO public.familia_tutores (familia_id, rol_familia, usuario_id, dni_documento_path)
    VALUES (p_familia_id, 'segundo_tutor', NULL, p_path);
  END IF;
  RETURN v_fila.dni_documento_path;
END
$function$;
REVOKE ALL ON FUNCTION public.fijar_dni_tutor(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fijar_dni_tutor(uuid, text, text) TO authenticated, service_role;

-- El tutor ya no escribe la tabla directamente: todo pasa por las dos funciones de arriba. La
-- Dirección conserva sus políticas (la cola aplica con su sesión; el alta en papel).
DROP POLICY familia_tutores_update_tutor ON public.familia_tutores;
DROP POLICY familia_tutores_insert_tutor ON public.familia_tutores;

-- ---- 4. La lectura ----
-- Las filas que la RLS ya deja ver (la Dirección y los tutores de la familia), con las 15 columnas de
-- siempre, más los datos nuevos según la regla. `ve_personales` / `ve_telefono` dicen si el dato se
-- PUEDE leer: una pantalla que no puede leerlo lo dice y no ofrece guardar, en vez de pintar un
-- campo vacío que parezca «sin dato».
CREATE FUNCTION public.tutores_de_familia(p_familia_id uuid)
 RETURNS TABLE (
   id uuid, rol_familia text, tiene_cuenta boolean, es_yo boolean,
   nombre_completo text, email text, direccion_calle text, direccion_numero text,
   direccion_cp text, direccion_ciudad text, dni_documento_path text,
   telefono text, fecha_nacimiento date, dni_numero text, estudios text, empresa text,
   ve_telefono boolean, ve_personales boolean)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ft.id, ft.rol_familia, ft.usuario_id IS NOT NULL, ft.usuario_id = auth.uid(),
         ft.nombre_completo, ft.email, ft.direccion_calle, ft.direccion_numero,
         ft.direccion_cp, ft.direccion_ciudad, ft.dni_documento_path,
         CASE WHEN p.telefono THEN ft.telefono END,
         CASE WHEN p.personales THEN ft.fecha_nacimiento END,
         CASE WHEN p.personales THEN ft.dni_numero END,
         CASE WHEN p.personales THEN ft.estudios END,
         CASE WHEN p.personales THEN ft.empresa END,
         p.telefono, p.personales
    FROM public.familia_tutores ft
   CROSS JOIN LATERAL (
     SELECT true AS telefono, privado.gestiona_tutor(ft.familia_id, ft.usuario_id) AS personales
   ) p
   WHERE ft.familia_id = p_familia_id
     AND ft.deleted_at IS NULL
     AND auth.uid() IS NOT NULL
     AND (public.es_admin(privado.centro_de_familia(ft.familia_id))
          OR public.es_tutor_de_familia(ft.familia_id))
   ORDER BY ft.rol_familia = 'titular' DESC;
$function$;
REVOKE ALL ON FUNCTION public.tutores_de_familia(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tutores_de_familia(uuid) TO authenticated, service_role;

-- El teléfono de la familia desde el niño: para la profe de su aula (el botón «Llamar a la
-- familia»), la Dirección y los tutores. El nombre va con él: hay que saber a quién se llama. El
-- autorizado no lo ve.
CREATE FUNCTION public.telefonos_familia_de_nino(p_nino_id uuid)
 RETURNS TABLE (rol_familia text, nombre_completo text, telefono text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ft.rol_familia, ft.nombre_completo, ft.telefono
    FROM public.ninos n
    JOIN public.familia_tutores ft ON ft.familia_id = n.familia_id AND ft.deleted_at IS NULL
   WHERE n.id = p_nino_id
     AND n.deleted_at IS NULL
     AND auth.uid() IS NOT NULL
     AND (public.es_profe_de_nino(p_nino_id)
          OR public.es_admin(privado.centro_de_nino(p_nino_id))
          OR public.es_tutor_de_familia(n.familia_id))
   ORDER BY ft.rol_familia = 'titular' DESC;
$function$;
REVOKE ALL ON FUNCTION public.telefonos_familia_de_nino(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telefonos_familia_de_nino(uuid) TO authenticated, service_role;

-- ---- 5. El bucket dni-tutores, con la misma regla ----
-- Un tutor abre el PDF de una fila que gestiona, o el que él mismo dejó en la cola mientras la fila
-- de destino siga siendo suya de gestionar. Antes bastaba con ser tutor legal del niño de la ruta:
-- el tutor 2 abría el DNI del tutor 1 (medido el 2026-11-13).
CREATE FUNCTION privado.puede_ver_dni_tutor(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.familia_tutores ft
       WHERE ft.dni_documento_path = p_name AND ft.deleted_at IS NULL
         AND (ft.usuario_id = auth.uid()
              OR (ft.usuario_id IS NULL AND public.es_tutor_de_familia(ft.familia_id))))
    OR EXISTS (
      SELECT 1 FROM public.cambios_pendientes cp
        JOIN public.ninos n ON n.id = cp.nino_id
       WHERE cp.entidad = 'datos_tutor_dni' AND cp.estado = 'pendiente'
         AND cp.solicitado_por = auth.uid()
         AND cp.payload->>'path' = p_name
         AND NOT EXISTS (
           SELECT 1 FROM public.familia_tutores ft
            WHERE ft.familia_id = n.familia_id AND ft.deleted_at IS NULL
              AND ft.rol_familia = CASE cp.payload->>'tipo_vinculo'
                                     WHEN 'tutor_legal_principal' THEN 'titular'
                                     ELSE 'segundo_tutor' END
              AND ft.usuario_id IS NOT NULL AND ft.usuario_id <> auth.uid())));
$function$;
REVOKE ALL ON FUNCTION privado.puede_ver_dni_tutor(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION privado.puede_ver_dni_tutor(text) TO authenticated, service_role;

DROP POLICY dni_tutores_select ON storage.objects;
CREATE POLICY dni_tutores_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'dni-tutores'
         AND (public.es_admin(((storage.foldername(name))[1])::uuid)
              OR privado.puede_ver_dni_tutor(name))
         AND privado.ruta_coherente(bucket_id, name));

DROP POLICY dni_tutores_update ON storage.objects;
CREATE POLICY dni_tutores_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'dni-tutores'
         AND (public.es_admin(((storage.foldername(name))[1])::uuid)
              OR privado.puede_ver_dni_tutor(name))
         AND privado.ruta_coherente(bucket_id, name))
  WITH CHECK (bucket_id = 'dni-tutores'
              AND (public.es_admin(((storage.foldername(name))[1])::uuid)
                   OR privado.puede_ver_dni_tutor(name))
              AND privado.ruta_coherente(bucket_id, name));

-- ---- 6. El registro del export admite el sujeto 'tutor' ----
ALTER TABLE public.export_log DROP CONSTRAINT export_log_sujeto_tipo_check;
ALTER TABLE public.export_log ADD CONSTRAINT export_log_sujeto_tipo_check
  CHECK (sujeto_tipo IN ('usuario', 'nino', 'tutor'));

-- ---- 7. Las tres funciones vivas que cambian (generadas desde su cuerpo vivo) ----

CREATE OR REPLACE FUNCTION public.marcar_matricula_lista(p_nino_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_pendiente boolean;
BEGIN
  -- Gate AMPLIADO: admin del centro del niño O tutor legal (el tutor pasa igual).
  IF NOT (public.es_admin(privado.centro_de_nino(p_nino_id))
          OR public.es_tutor_legal_de(p_nino_id)) THEN
    RAISE EXCEPTION 'no autorizado a finalizar el alta de este nino'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.matriculas
     WHERE nino_id = p_nino_id
       AND estado = 'pendiente'
       AND fecha_baja IS NULL
       AND deleted_at IS NULL
  ) INTO v_pendiente;

  -- Acuse de confidencialidad de datos médicos obligatorio para cerrar el alta
  -- (backstop F11-F, CONSERVADO). auth.uid() = quien finaliza (admin o tutor), y el acuse es de
  -- ESTE niño (U-3, corregido en la base en 20270103120000).
  IF v_pendiente AND NOT EXISTS (
       SELECT 1 FROM public.consentimientos c
        WHERE c.usuario_id = auth.uid()
          AND c.tipo = 'datos_medicos'
          AND c.nino_id = p_nino_id
          AND c.revocado_en IS NULL) THEN
    RAISE EXCEPTION 'falta el acuse de confidencialidad de datos medicos'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Fase 4 (4b-2): los documentos del centro obligatorios que el niño tiene por firmar. El que el
  -- centro todavía no ha subido (`falta_documento`) no frena (P-6), ni el opcional.
  IF v_pendiente AND EXISTS (
       SELECT 1 FROM privado.documentos_del_nino(p_nino_id) d
        WHERE d.obligatorio AND d.estado = 'por_firmar') THEN
    RAISE EXCEPTION 'faltan documentos del centro por firmar'
      USING HINT = 'documentos_por_firmar';
  END IF;

  -- Fase 5b (20270114120000): los datos del niño que el alta exige. Apellidos y fecha ya se exigían,
  -- pero en silencio (el UPDATE de abajo tocaba 0 filas y devolvía NULL); ahora frenan con su motivo,
  -- junto con los tres obligatorios de la fase 5 (decididos por el responsable el 2026-11-10): lugar
  -- de nacimiento, nacionalidad y hermanos. Solo al cerrar un alta pendiente: no toca a los niños ya
  -- validados. Dirección, que cierra el alta en papel, los escribe con su sesión antes de llegar aquí.
  IF v_pendiente AND EXISTS (
       SELECT 1 FROM public.ninos n
        WHERE n.id = p_nino_id
          AND (n.apellidos IS NULL
               OR n.fecha_nacimiento IS NULL
               OR NULLIF(btrim(n.lugar_nacimiento), '') IS NULL
               OR NULLIF(btrim(n.nacionalidad), '') IS NULL
               OR n.hermanos_total IS NULL)) THEN
    RAISE EXCEPTION 'faltan datos del nino por completar'
      USING HINT = 'datos_nino_por_completar';
  END IF;

  -- Fase 6 (20270118120000): los datos de los tutores que el alta exige (decididos por el
  -- responsable el 2026-11-12/13: D12, D14, D15 y el número del DNI; `privado.tutor_completo`). El
  -- titular siempre; el segundo tutor si la familia lo tiene (sin fila = «no hay segundo tutor»). Solo
  -- al cerrar un alta pendiente: no toca a las familias ya validadas.
  IF v_pendiente AND (
       NOT EXISTS (
         SELECT 1 FROM public.ninos n
           JOIN public.familia_tutores t
             ON t.familia_id = n.familia_id AND t.rol_familia = 'titular' AND t.deleted_at IS NULL
          WHERE n.id = p_nino_id AND privado.tutor_completo(t))
    OR EXISTS (
         SELECT 1 FROM public.ninos n
           JOIN public.familia_tutores t
             ON t.familia_id = n.familia_id AND t.rol_familia = 'segundo_tutor' AND t.deleted_at IS NULL
          WHERE n.id = p_nino_id AND NOT privado.tutor_completo(t))) THEN
    RAISE EXCEPTION 'faltan datos de los tutores por completar'
      USING HINT = 'datos_tutor_por_completar';
  END IF;

  UPDATE public.matriculas
     SET estado = 'lista'
   WHERE nino_id = p_nino_id
     AND estado = 'pendiente'
     AND fecha_baja IS NULL
     AND deleted_at IS NULL
     AND EXISTS (
       SELECT 1 FROM public.ninos n
        WHERE n.id = p_nino_id
          AND n.apellidos IS NOT NULL
          AND n.fecha_nacimiento IS NOT NULL
     )
   RETURNING id INTO v_id;

  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.purgar_sujeto_db(p_solicitud_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s        public.olvido_solicitudes%ROWTYPE;
  v_nombre text;
  v_lista  uuid[];
  v_ft     uuid[];
  v_bloqueos jsonb;
  k_nino  text[] := ARRAY['nombre','apellidos','fecha_nacimiento','sexo','nacionalidad',
                          'foto_url','notas_admin'];
  k_med   text[] := ARRAY['alergias_graves','notas_emergencia','medicacion_habitual',
                          'alergias_leves','medico_familia','telefono_emergencia'];
  k_user  text[] := ARRAY['nombre_completo','foto_url'];
  k_ft    text[] := ARRAY['nombre_completo','email','direccion_calle','direccion_numero',
                          'direccion_cp','direccion_ciudad','dni_documento_path',
                          -- Fase 6 (20270118120000): los cinco datos nuevos del tutor.
                          'telefono','fecha_nacimiento','dni_numero','estudios','empresa'];
  k_extra text[] := ARRAY['ip_address','user_agent','descripcion_parentesco',
                          'nombre_externo','observaciones','observaciones_generales',
                          'contenido','nombre_tecleado','comentario'];
BEGIN
  -- [CRIT-ANON] Sin uid solo entra el servicio: service_role o sesión directa sin JWT
  -- (SQL Editor / psql). anon, o un JWT sin sub, ya no se cuela por la rama "uid NULL". Patrón #284.
  IF auth.uid() IS NULL
     AND NOT (COALESCE(auth.role(), '') = 'service_role'
              OR (session_user <> 'authenticator'
                  AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                  AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
    RAISE EXCEPTION 'no autorizado: sin sesión solo el servicio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- [/CRIT-ANON]
  SELECT * INTO s FROM public.olvido_solicitudes WHERE id = p_solicitud_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'solicitud de olvido no encontrada: %', p_solicitud_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT privado.es_responsable(s.centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF s.purgado_en IS NOT NULL THEN
    RETURN;
  END IF;

  -- Retención (PR-8): el sujeto retenido por un procedimiento abierto espera, también con la
  -- petición ya confirmada (olvido_pendientes ya no la lista; esto cubre cualquier otro camino).
  IF privado.retenido(s.centro_id, s.sujeto_tipo::text, s.sujeto_id) THEN
    RAISE EXCEPTION 'el sujeto está retenido por un procedimiento abierto'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'retenido';
  END IF;

  -- Retención (PR-8, pieza 2): la petición por plazo vuelve a mirar que la cuenta siga purgable
  -- (todos sus hijos de baja y ningún otro rol vivo): entre abrirla y purgarla le pudieron dar un
  -- rol, o un hijo pudo volver. Sin la fecha: el plazo, una vez cumplido, no deja de estarlo.
  IF s.por_plazo AND NOT privado.cuenta_purgable(s.sujeto_id, s.centro_id) THEN
    RAISE EXCEPTION 'la cuenta ya no se purga por plazo'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'plazo';
  END IF;

  -- Retención (PR-7): ningún tutor se olvida con un hijo matriculado. Lo que impide confirmar
  -- impide purgar (olvido_pendientes ya no la lista; esto cubre cualquier otro camino).
  -- Retención (PR-8, pieza 3): la petición por plazo no mira cualquier recibo sin cerrar, sino el
  -- dinero vivo de sus familias (privado.bloqueos_por_plazo): un borrador sin deuda dentro no frena.
  IF s.sujeto_tipo = 'usuario' THEN
    v_bloqueos := CASE WHEN s.por_plazo
                       THEN privado.bloqueos_por_plazo(s.sujeto_id, s.centro_id)
                       ELSE privado.olvido_bloqueos(s.sujeto_tipo, s.sujeto_id, s.centro_id) -> 'bloqueos'
                  END;
    IF jsonb_array_length(v_bloqueos) > 0 THEN
      RAISE EXCEPTION 'todavía falta algo para purgar'
        USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'hay_bloqueos',
              DETAIL = v_bloqueos::text;
    END IF;
  END IF;

  -- Grupo 1 (PR B): las filas de auditoría que escribe la purga llevan su etiqueta.
  PERFORM set_config('app.audit_actor', 'system:purgar_sujeto_db', true);

  IF s.sujeto_tipo = 'nino' THEN
    -- Retención (F11-B, punto 6, PR-6): la purga del niño, la misma para el olvido y para el
    -- plazo del expediente (20261204120000).
    PERFORM privado.purgar_nino(s.sujeto_id);

  ELSE  -- usuario
    SELECT nombre_completo INTO v_nombre FROM public.usuarios WHERE id = s.sujeto_id;

    IF public.olvido_es_ultimo_centro(s.id) THEN
      -- Último centro: la cuenta entera y todo lo que quede, también lo de los centros sin
      -- solicitud. Es literal la rama del usuario de 20261019120000.
      IF v_nombre IS NOT NULL AND length(trim(v_nombre)) > 0 THEN
        UPDATE public.mensajes
          SET contenido = replace(contenido, v_nombre, '[borrado]')
          WHERE contenido LIKE '%' || v_nombre || '%';

        -- Grupo 1 (PR B): el nombre tampoco se queda en la auditoría de los mensajes: ni en la
        -- fila que acaba de escribir el UPDATE de arriba ni en las anteriores, de cualquier autor.
        UPDATE public.audit_log SET
          valores_antes = CASE WHEN strpos(valores_antes->>'contenido', v_nombre) > 0
            THEN jsonb_set(valores_antes, '{contenido}',
                           to_jsonb(replace(valores_antes->>'contenido', v_nombre, '[borrado]')))
            ELSE valores_antes END,
          valores_despues = CASE WHEN strpos(valores_despues->>'contenido', v_nombre) > 0
            THEN jsonb_set(valores_despues, '{contenido}',
                           to_jsonb(replace(valores_despues->>'contenido', v_nombre, '[borrado]')))
            ELSE valores_despues END
        WHERE tabla = 'mensajes'
          AND (strpos(valores_antes->>'contenido', v_nombre) > 0
               OR strpos(valores_despues->>'contenido', v_nombre) > 0);
      END IF;

      -- Cierre de la purga: también la foto de perfil (el objeto lo borra antes el manifiesto).
      UPDATE public.usuarios SET
        nombre_completo = '[borrado]',
        foto_url        = NULL,
        deleted_at      = COALESCE(deleted_at, now())
      WHERE id = s.sujeto_id;

      UPDATE public.consentimientos SET ip_address = NULL, user_agent = NULL
        WHERE usuario_id = s.sujeto_id;
      DELETE FROM public.push_subscriptions WHERE usuario_id = s.sujeto_id;
      -- Cierre de la purga: preferencias y lecturas, igual que los dispositivos.
      DELETE FROM public.preferencias_usuario WHERE usuario_id = s.sujeto_id;
      DELETE FROM public.lectura_conversacion WHERE usuario_id = s.sujeto_id;
      DELETE FROM public.lectura_anuncio      WHERE usuario_id = s.sujeto_id;

      -- Cierre de la purga: su perfil de tutor en familia_tutores. Se anonimiza y se da de baja;
      -- usuario_id, familia_id y rol_familia se quedan (seudónimos; el trigger los congela). No se
      -- asciende al otro tutor: lo decide la directora (promover_a_titular). Su copia en
      -- audit_log se redacta por registro_id, que alcanza también las filas de antes de tener
      -- cuenta. El DNI en Storage lo borra antes el manifiesto, por su ruta exacta.
      WITH anonimizados AS (
        UPDATE public.familia_tutores SET
          nombre_completo    = NULL,
          email              = NULL,
          direccion_calle    = NULL,
          direccion_numero   = NULL,
          direccion_cp       = NULL,
          direccion_ciudad   = NULL,
          dni_documento_path = NULL,
          telefono           = NULL,
          fecha_nacimiento   = NULL,
          dni_numero         = NULL,
          estudios           = NULL,
          empresa            = NULL,
          deleted_at         = COALESCE(deleted_at, now())
        WHERE usuario_id = s.sujeto_id RETURNING id
      )
      SELECT array_agg(id) INTO v_ft FROM anonimizados;
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   k_ft),
        valores_despues = public._redactar_jsonb(valores_despues, k_ft)
      WHERE tabla = 'familia_tutores' AND registro_id = ANY (v_ft);

      -- Cierre de la purga: los cambios que pidió sobre sus propios datos de tutor (email,
      -- dirección, ruta de su DNI en el payload). Los que pidió sobre el niño son del niño.
      DELETE FROM public.cambios_pendientes
       WHERE solicitado_por = s.sujeto_id AND entidad IN ('datos_tutor', 'datos_tutor_dni');

      -- Cierre de la purga: su texto al responder a una cita (la auditoría la redacta k_extra).
      UPDATE public.cita_invitados SET comentario = NULL
       WHERE usuario_id = s.sujeto_id AND comentario IS NOT NULL;

      -- Purga de lista_espera: el teléfono y el email que el tutor dejó en sus prospectos. El
      -- prospecto es del niño y se queda; su copia en audit_log pierde esas dos claves.
      WITH limpiados AS (
        UPDATE public.lista_espera SET telefono_tutor = NULL, email_tutor = NULL
        WHERE tutor_usuario_id = s.sujeto_id RETURNING id
      )
      SELECT array_agg(id) INTO v_lista FROM limpiados;
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY['telefono_tutor', 'email_tutor']),
        valores_despues = public._redactar_jsonb(valores_despues, ARRAY['telefono_tutor', 'email_tutor'])
      WHERE tabla = 'lista_espera' AND registro_id = ANY (v_lista);

      -- D-5: motivo 'purga_rgpd' → la reactivación de familia NUNCA revive estas filas.
      UPDATE public.roles_usuario SET
        deleted_reason = 'purga_rgpd',
        deleted_at     = COALESCE(deleted_at, now())
        WHERE usuario_id = s.sujeto_id;
      UPDATE public.vinculos_familiares SET
        descripcion_parentesco = NULL,
        deleted_reason         = 'purga_rgpd',
        deleted_at             = COALESCE(deleted_at, now())
      WHERE usuario_id = s.sujeto_id;

      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   k_user || k_extra),
        valores_despues = public._redactar_jsonb(valores_despues, k_user || k_extra)
      WHERE registro_id = s.sujeto_id OR usuario_id = s.sujeto_id
         -- Grupo 1 (PR B): también las filas que LLEVAN al sujeto (vínculos, roles…), como su
         -- vínculo con descripcion_parentesco, escritas por otros o por esta misma purga.
         OR valores_antes->>'usuario_id'   = s.sujeto_id::text
         OR valores_despues->>'usuario_id' = s.sujeto_id::text;

      -- Grupo 1 (PR B): invitaciones. El paso 4 de la purga (purgar-vencidos.ts) ya marcó con
      -- '[borrado]' el email y el nombre de sus invitaciones; aquí se redactan sus copias en
      -- audit_log (la fila de ese UPDATE y las anteriores). Idempotente.
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY['email', 'nombre_completo']),
        valores_despues = public._redactar_jsonb(valores_despues, ARRAY['email', 'nombre_completo'])
      WHERE tabla = 'invitaciones'
        AND registro_id IN (SELECT i.id FROM public.invitaciones i WHERE i.email = '[borrado]');
    ELSE
      -- Multicentro (Fase 2 · PR B): le queda otro centro. Cada sentencia es la de la rama de
      -- arriba acotada a ESTE centro (s.centro_id). No se tocan usuarios, push, preferencias ni
      -- los consentimientos sin niño: son de la cuenta y se van con el último centro.

      -- Su nombre en los mensajes de las conversaciones de este centro, y en su auditoría.
      IF v_nombre IS NOT NULL AND length(trim(v_nombre)) > 0 THEN
        UPDATE public.mensajes
          SET contenido = replace(contenido, v_nombre, '[borrado]')
          WHERE contenido LIKE '%' || v_nombre || '%'
            AND conversacion_id IN (SELECT c.id FROM public.conversaciones c
                                     WHERE c.centro_id = s.centro_id);

        UPDATE public.audit_log SET
          valores_antes = CASE WHEN strpos(valores_antes->>'contenido', v_nombre) > 0
            THEN jsonb_set(valores_antes, '{contenido}',
                           to_jsonb(replace(valores_antes->>'contenido', v_nombre, '[borrado]')))
            ELSE valores_antes END,
          valores_despues = CASE WHEN strpos(valores_despues->>'contenido', v_nombre) > 0
            THEN jsonb_set(valores_despues, '{contenido}',
                           to_jsonb(replace(valores_despues->>'contenido', v_nombre, '[borrado]')))
            ELSE valores_despues END
        WHERE tabla = 'mensajes' AND centro_id = s.centro_id
          AND (strpos(valores_antes->>'contenido', v_nombre) > 0
               OR strpos(valores_despues->>'contenido', v_nombre) > 0);
      END IF;

      -- Los consentimientos ligados a un niño de este centro.
      UPDATE public.consentimientos SET ip_address = NULL, user_agent = NULL
        WHERE usuario_id = s.sujeto_id
          AND nino_id IN (SELECT n.id FROM public.ninos n WHERE n.centro_id = s.centro_id);
      -- Las lecturas de conversaciones y anuncios de este centro.
      DELETE FROM public.lectura_conversacion
        WHERE usuario_id = s.sujeto_id
          AND conversacion_id IN (SELECT c.id FROM public.conversaciones c
                                   WHERE c.centro_id = s.centro_id);
      DELETE FROM public.lectura_anuncio
        WHERE usuario_id = s.sujeto_id
          AND anuncio_id IN (SELECT a.id FROM public.anuncios a WHERE a.centro_id = s.centro_id);

      -- Su perfil de tutor en la familia de este centro (el DNI de esa familia lo borra antes el
      -- manifiesto, solo el de este centro).
      WITH anonimizados AS (
        UPDATE public.familia_tutores SET
          nombre_completo    = NULL,
          email              = NULL,
          direccion_calle    = NULL,
          direccion_numero   = NULL,
          direccion_cp       = NULL,
          direccion_ciudad   = NULL,
          dni_documento_path = NULL,
          telefono           = NULL,
          fecha_nacimiento   = NULL,
          dni_numero         = NULL,
          estudios           = NULL,
          empresa            = NULL,
          deleted_at         = COALESCE(deleted_at, now())
        WHERE usuario_id = s.sujeto_id AND centro_id = s.centro_id RETURNING id
      )
      SELECT array_agg(id) INTO v_ft FROM anonimizados;
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   k_ft),
        valores_despues = public._redactar_jsonb(valores_despues, k_ft)
      WHERE tabla = 'familia_tutores' AND registro_id = ANY (v_ft);

      -- Los cambios que pidió sobre sus datos de tutor en este centro.
      DELETE FROM public.cambios_pendientes
       WHERE solicitado_por = s.sujeto_id AND entidad IN ('datos_tutor', 'datos_tutor_dni')
         AND centro_id = s.centro_id;

      -- Su texto al responder a las citas de este centro.
      UPDATE public.cita_invitados SET comentario = NULL
       WHERE usuario_id = s.sujeto_id AND comentario IS NOT NULL AND centro_id = s.centro_id;

      -- El teléfono y el email de sus prospectos de este centro.
      WITH limpiados AS (
        UPDATE public.lista_espera SET telefono_tutor = NULL, email_tutor = NULL
        WHERE tutor_usuario_id = s.sujeto_id AND centro_id = s.centro_id RETURNING id
      )
      SELECT array_agg(id) INTO v_lista FROM limpiados;
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY['telefono_tutor', 'email_tutor']),
        valores_despues = public._redactar_jsonb(valores_despues, ARRAY['telefono_tutor', 'email_tutor'])
      WHERE tabla = 'lista_espera' AND registro_id = ANY (v_lista);

      -- Sus roles en este centro y sus vínculos con niños de este centro.
      UPDATE public.roles_usuario SET
        deleted_reason = 'purga_rgpd',
        deleted_at     = COALESCE(deleted_at, now())
        WHERE usuario_id = s.sujeto_id AND centro_id = s.centro_id;
      UPDATE public.vinculos_familiares SET
        descripcion_parentesco = NULL,
        deleted_reason         = 'purga_rgpd',
        deleted_at             = COALESCE(deleted_at, now())
      WHERE usuario_id = s.sujeto_id
        AND nino_id IN (SELECT n.id FROM public.ninos n WHERE n.centro_id = s.centro_id);

      -- Su auditoría en este centro. Las filas sin centro (las de usuarios) son de la cuenta.
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   k_user || k_extra),
        valores_despues = public._redactar_jsonb(valores_despues, k_user || k_extra)
      WHERE centro_id = s.centro_id
        AND (registro_id = s.sujeto_id OR usuario_id = s.sujeto_id
             OR valores_antes->>'usuario_id'   = s.sujeto_id::text
             OR valores_despues->>'usuario_id' = s.sujeto_id::text);

      -- Sus invitaciones de este centro (purgar-vencidos.ts las marca antes, solo las de este
      -- centro), y su auditoría.
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY['email', 'nombre_completo']),
        valores_despues = public._redactar_jsonb(valores_despues, ARRAY['email', 'nombre_completo'])
      WHERE tabla = 'invitaciones' AND centro_id = s.centro_id
        AND registro_id IN (SELECT i.id FROM public.invitaciones i
                             WHERE i.email = '[borrado]' AND i.centro_id = s.centro_id);
    END IF;
  END IF;

  UPDATE public.olvido_solicitudes SET purgado_en = now() WHERE id = p_solicitud_id;
  PERFORM set_config('app.audit_actor', '', true);
END $function$;

CREATE OR REPLACE FUNCTION public.export_datos_sujeto(p_sujeto_tipo text, p_sujeto_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_self   boolean;
  v_admin  boolean;
  v_centro uuid;
  v_email  text;
  v_bloq   boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no autorizado a exportar este sujeto'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ---------------------------------------------------------------- USUARIO
  IF p_sujeto_tipo = 'usuario' THEN
    v_self := v_uid = p_sujeto_id;
    IF NOT v_self AND NOT EXISTS (
      SELECT 1 FROM public.roles_usuario ru
       WHERE ru.usuario_id = p_sujeto_id
         AND ru.deleted_at IS NULL
         AND privado.es_responsable(ru.centro_id)
    ) THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = p_sujeto_id;

    -- Cada fila con centro pasa si es el propio usuario o si quien exporta es admin de ese
    -- centro (centro NULL nunca: es_responsable(NULL) es FALSE).
    RETURN jsonb_build_object(
      'preferencias', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'clave', p.clave, 'valor', p.valor, 'actualizado_en', p.updated_at)
               ORDER BY p.clave)
          FROM public.preferencias_usuario p
         WHERE p.usuario_id = p_sujeto_id), '[]'::jsonb),

      'dispositivos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'actualizado_en', s.updated_at,
                 'navegador', s.user_agent, 'registrado_en', s.created_at,
                 'ultima_actividad', s.last_active_at)
               ORDER BY s.created_at)
          FROM public.push_subscriptions s
         WHERE s.usuario_id = p_sujeto_id), '[]'::jsonb),

      'lecturas_conversaciones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'conversacion_id', l.conversacion_id, 'leido_hasta', l.last_read_at)
               ORDER BY l.last_read_at)
          FROM public.lectura_conversacion l
          JOIN public.conversaciones c ON c.id = l.conversacion_id
         WHERE l.usuario_id = p_sujeto_id
           AND (v_self OR (c.centro_id IS NOT NULL AND privado.es_responsable(c.centro_id)))), '[]'::jsonb),

      'lecturas_anuncios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'anuncio_id', l.anuncio_id, 'anuncio', a.titulo, 'leido_en', l.leido_at)
               ORDER BY l.leido_at)
          FROM public.lectura_anuncio l
          JOIN public.anuncios a ON a.id = l.anuncio_id
         WHERE l.usuario_id = p_sujeto_id
           AND (v_self OR (a.centro_id IS NOT NULL AND privado.es_responsable(a.centro_id)))), '[]'::jsonb),

      'invitaciones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'email', i.email, 'nombre_completo', i.nombre_completo,
                 'rol_objetivo', i.rol_objetivo, 'tipo_vinculo', i.tipo_vinculo,
                 -- 2c (2026-11-02, columnas-export.ts)
                 'tipo_personal_aula', i.tipo_personal_aula,
                 'enviada_en', i.created_at, 'expira_en', i.expires_at,
                 'aceptada_en', i.accepted_at, 'rechazada_en', i.rejected_at)
               ORDER BY i.created_at)
          FROM public.invitaciones i
         WHERE v_email IS NOT NULL
           AND lower(i.email) = lower(v_email)
           AND (v_self OR privado.es_responsable(i.centro_id))), '[]'::jsonb),

      'lista_espera_contacto', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', le.created_at, 'actualizado_en', le.updated_at,
                 'telefono_tutor', le.telefono_tutor, 'email_tutor', le.email_tutor,
                 -- 2c (2026-11-02, columnas-export.ts): el prospecto entero, nota incluida
                 'nombre_nino', le.nombre_nino, 'apellidos_nino', le.apellidos_nino,
                 'fecha_nacimiento', le.fecha_nacimiento, 'nota', le.nota,
                 'posicion', le.posicion, 'estado', le.estado, 'curso', ca.nombre,
                 'descartado_en', le.descartado_at)
               ORDER BY le.created_at)
          FROM public.lista_espera le
          LEFT JOIN public.cursos_academicos ca ON ca.id = le.curso_academico_id
         WHERE le.tutor_usuario_id = p_sujeto_id
           AND (v_self OR privado.es_responsable(le.centro_id))), '[]'::jsonb),

      'exportaciones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'exportado_en', e.created_at,
                 'solicitado_por_ti', e.solicitado_por = p_sujeto_id)
               ORDER BY e.created_at)
          FROM public.export_log e
         WHERE e.sujeto_tipo = 'usuario' AND e.sujeto_id = p_sujeto_id
           AND (v_self OR privado.es_responsable(e.centro_id))), '[]'::jsonb),

      'solicitudes_olvido', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', o.created_at,
                 -- 2c (2026-11-02, columnas-export.ts)
                 'por_plazo', o.por_plazo,
                 'solicitado_en', o.solicitado_en, 'estado', o.estado,
                 'pedida_por_centro', o.pedida_por_centro, 'inmediato', o.inmediato,
                 'confirmada_en', o.confirmada_en, 'gracia_hasta', o.gracia_hasta,
                 'rechazada_en', o.rechazada_en, 'motivo_rechazo', o.motivo_rechazo,
                 'retirada_en', o.retirada_en, 'nota_centro', o.nota_centro,
                 'purgado_en', o.purgado_en)
               ORDER BY o.solicitado_en)
          FROM public.olvido_solicitudes o
         WHERE o.sujeto_tipo = 'usuario' AND o.sujeto_id = p_sujeto_id
           AND (v_self OR privado.es_responsable(o.centro_id))), '[]'::jsonb),

      -- Su perfil de tutor en cada familia (solo su fila, no la del otro tutor).
      'perfiles_familia', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', ft.created_at, 'actualizado_en', ft.updated_at, 'borrado_en', ft.deleted_at,
                 'familia_id', ft.familia_id, 'rol_familia', ft.rol_familia,
                 'nombre_completo', ft.nombre_completo, 'email', ft.email,
                 'direccion_calle', ft.direccion_calle, 'direccion_numero', ft.direccion_numero,
                 'direccion_cp', ft.direccion_cp, 'direccion_ciudad', ft.direccion_ciudad,
                 'dni_documento_path', ft.dni_documento_path,
                 -- Fase 6 (20270118120000): los cinco datos nuevos, de SU fila.
                 'telefono', ft.telefono, 'fecha_nacimiento', ft.fecha_nacimiento,
                 'dni_numero', ft.dni_numero, 'estudios', ft.estudios, 'empresa', ft.empresa)
               ORDER BY ft.created_at)
          FROM public.familia_tutores ft
          JOIN public.familias f ON f.id = ft.familia_id
         WHERE ft.usuario_id = p_sujeto_id AND ft.deleted_at IS NULL
           AND (v_self OR privado.es_responsable(f.centro_id))), '[]'::jsonb),

      -- Los mandatos que firmó él. Del IBAN, solo los 4 últimos dígitos.
      'mandatos_sepa', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'texto_hash', m.texto_hash, 'creado_en', m.created_at, 'actualizado_en', m.updated_at, 'borrado_en', m.deleted_at, 'familia_id', m.familia_id,
                 'identificador_mandato', m.identificador_mandato, 'titular', m.titular,
                 'iban_ultimos4', m.iban_ultimos4, 'estado', m.estado,
                 'metodo_firma', m.metodo_firma, 'fecha_firma', m.fecha_firma,
                 'nombre_tecleado', m.nombre_tecleado, 'firma_imagen', m.firma_imagen,
                 'ip_firma', host(m.ip_address), 'navegador_firma', m.user_agent,
                 'documento_path', m.documento_path,
                 -- 0c-1 (20261229120000): el texto canónico v2 y sus datos
                 'version_canonico', m.version_canonico,
                 'titular_documento', m.titular_documento, 'titular_direccion', m.titular_direccion,
                 'acreedor_cid', m.acreedor_cid, 'acreedor_nombre', m.acreedor_nombre)
               ORDER BY m.created_at)
          FROM public.mandatos_sepa m
         WHERE m.usuario_id = p_sujeto_id AND m.deleted_at IS NULL
           AND (v_self OR privado.es_responsable(m.centro_id))), '[]'::jsonb),

      -- Cobros de cada familia de la que es tutor (los dos tutores reciben lo mismo).
      'cobros_familia', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'id', f.id, 'creado_en', f.created_at, 'actualizado_en', f.updated_at, 'borrado_en', f.deleted_at, 'motivo_borrado', f.deleted_reason,
                 'familia', f.etiqueta, 'metodo_pago', f.metodo_pago,
                 -- 2c (2026-11-02, columnas-export.ts)
                 'metodo_pago_manual', f.metodo_pago_manual,
                 'recibos', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', r.created_at, 'actualizado_en', r.updated_at, 'borrado_en', r.deleted_at,
                            'id', r.id,
                            'anio', r.anio, 'mes', r.mes, 'estado', r.estado, 'metodo', r.metodo,
                            'total_centimos', r.total_centimos, 'es_esporadico', r.es_esporadico,
                            'concepto_esporadico', r.concepto_esporadico,
                            'fecha_envio_banco', r.fecha_envio_banco,
                            'fecha_devolucion', r.fecha_devolucion,
                            'cobro_forma', r.cobro_forma, 'cobro_fecha', r.cobro_fecha,
                            'cobro_nota', r.cobro_nota,
                            'cobro_importe_centimos', r.cobro_importe_centimos,
                            'devolucion_gastos_centimos', r.devolucion_gastos_centimos,
                            'devolucion_salida', r.devolucion_salida,
                            -- 20261215120000: la red del export (columnas-export.ts).
                            'regiro_de', r.devuelto_de_recibo_id,
                            'diferencia_de', r.diferencia_de_recibo_id,
                            'fecha_cobro_banco', r.fecha_cobro_banco,
                            'lineas', COALESCE((
                              SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', lr.created_at, 'arrastre_de_recibo_id', lr.arrastre_de_recibo_id, 'sobrante_de_desborde_id', lr.sobrante_de_desborde_id,
                                       'descripcion', lr.descripcion, 'cantidad', lr.cantidad,
                                       'precio_unitario_centimos', lr.precio_unitario_centimos,
                 -- 2c (2026-11-02, columnas-export.ts)
                 'origen', lr.origen,
                                       'importe_centimos', lr.importe_centimos)
                                     ORDER BY lr.created_at, lr.id)
                                FROM public.lineas_recibo lr
                               WHERE lr.recibo_id = r.id), '[]'::jsonb))
                          ORDER BY r.anio, r.mes, r.created_at)
                     FROM public.recibos r
                    WHERE r.familia_id = f.id AND r.deleted_at IS NULL), '[]'::jsonb),
                 'metodos_pago', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', mp.created_at, 'actualizado_en', mp.updated_at, 'borrado_en', mp.deleted_at,
                            'anio', mp.anio, 'mes', mp.mes, 'metodo', mp.metodo)
                          ORDER BY mp.anio, mp.mes)
                     FROM public.metodo_pago_familia mp
                    WHERE mp.familia_id = f.id AND mp.deleted_at IS NULL), '[]'::jsonb),
                 'conceptos_asignados', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', ac.created_at, 'actualizado_en', ac.updated_at, 'borrado_en', ac.deleted_at,
                 -- 2c (2026-11-02, columnas-export.ts)
                            'origen', ac.origen,
                            'concepto', cc.nombre, 'cantidad', ac.cantidad_default,
                            'importe_especial_centimos', ac.importe_override_centimos,
                            'porcentaje_especial_bp', ac.porcentaje_override_bp,
                            'vigencia_desde', ac.vigencia_desde,
                            'vigencia_hasta', ac.vigencia_hasta)
                          ORDER BY ac.created_at)
                     FROM public.asignacion_concepto ac
                     JOIN public.conceptos_cobro cc ON cc.id = ac.concepto_id
                    WHERE ac.familia_id = f.id AND ac.deleted_at IS NULL), '[]'::jsonb),
                 'beca_comedor_excesos', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'id', d.id, 'recibo_id', d.recibo_id, 'creado_en', d.created_at, 'actualizado_en', d.updated_at,
                            'anio', d.anio, 'mes', d.mes, 'origen', d.origen,
                            'cuota_total_centimos', d.cuota_total_centimos,
                            'beca_total_centimos', d.beca_total_centimos,
                            'exceso_centimos', d.exceso_centimos,
                            'estado', d.estado, 'via', d.via, 'resuelto_en', d.resuelto_at)
                          ORDER BY d.anio, d.mes)
                     FROM public.beca_comedor_desborde d
                    WHERE d.familia_id = f.id), '[]'::jsonb),
                 'beca_comedor_transferencias', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'recibo_id', bt.recibo_id, 'creado_en', bt.created_at, 'actualizado_en', bt.updated_at,
                            'anio', bt.anio, 'mes', bt.mes, 'origen', bt.origen,
                            'importe_centimos', bt.importe_centimos,
                            'estado', bt.estado, 'realizada_en', bt.realizada_at)
                          ORDER BY bt.anio, bt.mes)
                     FROM public.beca_comedor_transferencia bt
                    WHERE bt.familia_id = f.id), '[]'::jsonb))
               ORDER BY f.created_at)
          FROM public.familias f
         WHERE f.id IN (SELECT ft.familia_id FROM public.familia_tutores ft
                         WHERE ft.usuario_id = p_sujeto_id AND ft.deleted_at IS NULL)
           AND (v_self OR privado.es_responsable(f.centro_id))), '[]'::jsonb),

      -- Retención (PR-7): lo que se conserva por obligación legal y está bloqueado. No sale, y
      -- no se calla: qué es, cuánto y desde cuándo.
      'datos_bloqueados', privado.datos_bloqueados('usuario', p_sujeto_id, v_self),
      'consultas_datos_bloqueados', privado.consultas_datos_bloqueados('usuario', p_sujeto_id, v_self)
    );
  END IF;

  -- ---------------------------------------------------------------- NIÑO
  IF p_sujeto_tipo = 'nino' THEN
    v_centro := privado.centro_de_nino(p_sujeto_id);
    IF v_centro IS NULL THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_admin := privado.es_responsable(v_centro);
    v_bloq  := privado.nino_bloqueado(p_sujeto_id);
    IF NOT v_admin AND NOT public.es_tutor_legal_de(p_sujeto_id) THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN jsonb_build_object(
      -- Su prospecto entero.
      'lista_espera', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'actualizado_en', le.updated_at,
                 'nombre_nino', le.nombre_nino, 'apellidos_nino', le.apellidos_nino,
                 'fecha_nacimiento', le.fecha_nacimiento, 'telefono_tutor', le.telefono_tutor,
                 'email_tutor', le.email_tutor, 'nota', le.nota, 'posicion', le.posicion,
                 'estado', le.estado, 'curso', ca.nombre, 'apuntado_en', le.created_at,
                 -- 2d (2026-11-02, columnas-export.ts)
                 'descartado_en', le.descartado_at)
               ORDER BY le.created_at)
          FROM public.lista_espera le
          LEFT JOIN public.cursos_academicos ca ON ca.id = le.curso_academico_id
         WHERE le.nino_id = p_sujeto_id), '[]'::jsonb),

      -- Sin motivo_baja. La familia, solo activa/baja (como get_recorrido_nino_familia).
      'matriculas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', m.created_at, 'borrado_en', m.deleted_at,
                 'id', m.id, 'aula', a.nombre, 'curso', ca.nombre, 'estado', m.estado,
                 'fecha_alta', m.fecha_alta, 'fecha_baja', m.fecha_baja,
                 'activada_en', m.activada_at)
               ORDER BY ca.fecha_inicio, m.fecha_alta, m.id)
          FROM public.matriculas m
          JOIN public.aulas a ON a.id = m.aula_id
          JOIN public.cursos_academicos ca ON ca.id = m.curso_academico_id
         WHERE m.nino_id = p_sujeto_id AND m.deleted_at IS NULL
           AND (v_admin OR m.estado IN ('activa', 'baja'))), '[]'::jsonb),

      -- Por sujeto, no por quién firmó: sale también el que dio el otro tutor.
      'consentimientos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', c.created_at,
                 'tipo', c.tipo, 'version_texto', c.version, 'aceptado_en', c.aceptado_en,
                 'revocado_en', c.revocado_en, 'metodo_firma', c.metodo_firma,
                 'otorgado_por', u.nombre_completo)
               ORDER BY c.aceptado_en)
          FROM public.consentimientos c
          LEFT JOIN public.usuarios u ON u.id = c.usuario_id
         WHERE c.nino_id = p_sujeto_id AND NOT v_bloq
           AND NOT privado.usuario_olvidado_en(c.usuario_id, v_centro)), '[]'::jsonb),

      'acuses_alta', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'tipo', aa.tipo, 'metodo', aa.metodo, 'aceptado_en', aa.aceptado_en)
               ORDER BY aa.aceptado_en)
          FROM public.acuses_alta aa
         WHERE aa.nino_id = p_sujeto_id AND NOT v_bloq
           AND NOT (aa.firmante_id IS NOT NULL
                    AND privado.usuario_olvidado_en(aa.firmante_id, aa.centro_id))), '[]'::jsonb),

      'cambios_solicitados', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'entidad', cp.entidad, 'campo', cp.campo,
                 'valor_propuesto', cp.valor_propuesto, 'detalle', cp.payload,
                 'estado', cp.estado, 'solicitado_en', cp.created_at,
                 'decidido_en', cp.decided_at)
               ORDER BY cp.created_at)
          FROM public.cambios_pendientes cp
         WHERE cp.nino_id = p_sujeto_id), '[]'::jsonb),

      'fin_de_curso', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('curso', ca.nombre, 'registrado_en', rf.created_at)
               ORDER BY rf.created_at)
          FROM public.rollover_finaliza rf
          JOIN public.cursos_academicos ca ON ca.id = rf.curso_academico_id
         WHERE rf.nino_id = p_sujeto_id), '[]'::jsonb),

      'citas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', ci.created_at, 'actualizado_en', ci.updated_at,
                 'titulo', ci.titulo, 'tipo', ci.tipo, 'fecha', ci.fecha,
                 'hora_inicio', ci.hora_inicio, 'hora_fin', ci.hora_fin, 'lugar', ci.lugar,
                 'descripcion', ci.descripcion, 'estado', ci.estado)
               ORDER BY ci.fecha, ci.hora_inicio)
          FROM public.citas ci
         WHERE ci.nino_id = p_sujeto_id), '[]'::jsonb),

      'eventos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'id', e.id, 'creado_en', e.created_at, 'actualizado_en', e.updated_at,
                 'titulo', e.titulo, 'tipo', e.tipo, 'fecha', e.fecha, 'fecha_fin', e.fecha_fin,
                 'hora_inicio', e.hora_inicio, 'hora_fin', e.hora_fin, 'lugar', e.lugar,
                 'descripcion', e.descripcion, 'estado', e.estado,
                 -- 2d (2026-11-02, columnas-export.ts)
                 'requiere_confirmacion', e.requiere_confirmacion)
               ORDER BY e.fecha, e.hora_inicio)
          FROM public.eventos e
         WHERE e.nino_id = p_sujeto_id), '[]'::jsonb),

      'confirmaciones_eventos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'evento_id', ce.evento_id, 'creado_en', ce.created_at, 'actualizado_en', ce.updated_at,
                 'evento', e.titulo, 'fecha_evento', e.fecha, 'estado', ce.estado,
                 'comentario', ce.comentario, 'confirmado_at', ce.confirmado_at)
               ORDER BY e.fecha)
          FROM public.confirmaciones_evento ce
          JOIN public.eventos e ON e.id = ce.evento_id
         WHERE ce.nino_id = p_sujeto_id), '[]'::jsonb),

      -- Los dirigidos a la familia sobre el niño; los del personal son trabajo del centro.
      'recordatorios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', r.created_at, 'actualizado_en', r.updated_at,
                 'titulo', r.titulo, 'descripcion', r.descripcion,
                 'vencimiento', r.vencimiento, 'completado_en', r.completado_en,
                 -- 2d (2026-11-02, columnas-export.ts)
                 'erroneo', r.erroneo)
               ORDER BY r.created_at)
          FROM public.recordatorios r
         WHERE r.nino_id = p_sujeto_id AND r.destinatario = 'familia_individual'), '[]'::jsonb),

      'conceptos_asignados', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', ac.created_at, 'actualizado_en', ac.updated_at, 'borrado_en', ac.deleted_at,
                 -- 2c (2026-11-02, columnas-export.ts)
                 'origen', ac.origen,
                 'concepto', cc.nombre, 'cantidad', ac.cantidad_default,
                 'importe_especial_centimos', ac.importe_override_centimos,
                            'porcentaje_especial_bp', ac.porcentaje_override_bp,
                 'vigencia_desde', ac.vigencia_desde, 'vigencia_hasta', ac.vigencia_hasta)
               ORDER BY ac.created_at)
          FROM public.asignacion_concepto ac
          JOIN public.conceptos_cobro cc ON cc.id = ac.concepto_id
         WHERE ac.nino_id = p_sujeto_id AND ac.deleted_at IS NULL), '[]'::jsonb),

      'lineas_recibo', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', lr.created_at, 'beca_tramo_id', lr.beca_tramo_id,
                 'anio', r.anio, 'mes', r.mes, 'descripcion', lr.descripcion,
                 'cantidad', lr.cantidad, 'importe_centimos', lr.importe_centimos,
                 -- 2c (2026-11-02, columnas-export.ts)
                 'precio_unitario_centimos', lr.precio_unitario_centimos, 'origen', lr.origen)
               ORDER BY r.anio, r.mes, lr.created_at)
          FROM public.lineas_recibo lr
          JOIN public.recibos r ON r.id = lr.recibo_id
         WHERE lr.nino_id = p_sujeto_id AND r.deleted_at IS NULL), '[]'::jsonb),

      'servicios_diarios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', ps.created_at, 'actualizado_en', ps.updated_at,
                 'fecha', ps.fecha, 'servicio', ps.servicio, 'presente', ps.presente)
               ORDER BY ps.fecha, ps.servicio)
          FROM public.parte_servicio_diario ps
         WHERE ps.nino_id = p_sujeto_id), '[]'::jsonb),

      'beca_comedor_elegibilidad', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', be.created_at, 'actualizado_en', be.updated_at,
                 'curso', ca.nombre, 'fecha_alta', be.fecha_alta,
                 'fecha_baja', be.fecha_baja, 'activa', be.activa)
               ORDER BY be.fecha_alta)
          FROM public.beca_comedor_elegibilidad be
          JOIN public.cursos_academicos ca ON ca.id = be.curso_academico_id
         WHERE be.nino_id = p_sujeto_id), '[]'::jsonb),

      'beca_comedor_tramos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'id', bt.id, 'tramo_padre_id', bt.tramo_padre_id, 'creado_en', bt.created_at, 'actualizado_en', bt.updated_at,
                 'anio_correspondiente', bt.anio_correspondiente,
                 'mes_correspondiente', bt.mes_correspondiente,
                 'anio_aplicacion', bt.anio_aplicacion, 'mes_aplicacion', bt.mes_aplicacion,
                 'importe_centimos', bt.importe_centimos, 'estado', bt.estado,
                 'origen', bt.origen)
               ORDER BY bt.anio_correspondiente, bt.mes_correspondiente, bt.created_at)
          FROM public.beca_comedor_tramo bt
         WHERE bt.nino_id = p_sujeto_id), '[]'::jsonb),

      -- Sus peticiones de olvido, con su estado (las mismas columnas que en el usuario).
      'solicitudes_olvido', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', o.created_at,
                 'solicitado_en', o.solicitado_en, 'estado', o.estado,
                 'pedida_por_centro', o.pedida_por_centro, 'inmediato', o.inmediato,
                 'confirmada_en', o.confirmada_en, 'gracia_hasta', o.gracia_hasta,
                 'rechazada_en', o.rechazada_en, 'motivo_rechazo', o.motivo_rechazo,
                 'retirada_en', o.retirada_en, 'nota_centro', o.nota_centro,
                 'purgado_en', o.purgado_en,
                 -- 2d (2026-11-02, columnas-export.ts)
                 'por_plazo', o.por_plazo)
               ORDER BY o.solicitado_en)
          FROM public.olvido_solicitudes o
         WHERE o.sujeto_tipo = 'nino' AND o.sujeto_id = p_sujeto_id), '[]'::jsonb),

      -- Quién ha leído su ficha médica (20261128120000). El nombre, solo si es de la familia del
      -- niño; del personal del centro y del soporte, solo el rol (R4, 2026-11-01).
      'lecturas_ficha_medica', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'leida_en', l.leida_en, 'lector', u.nombre_completo, 'rol_lector', l.rol_lector,
                 'origen', l.origen, 'campos', l.campos)
               ORDER BY l.leida_en)
          FROM public.lecturas_ficha_medica l
          LEFT JOIN public.usuarios u ON u.id = l.lector_id
                                     AND l.rol_lector IN ('tutor_legal', 'autorizado')
         WHERE l.nino_id = p_sujeto_id AND NOT v_bloq), '[]'::jsonb),

      -- Retención (PR-7): lo que se conserva por obligación legal y está bloqueado.
      'datos_bloqueados', privado.datos_bloqueados('nino', p_sujeto_id, v_admin),
      'consultas_datos_bloqueados', privado.consultas_datos_bloqueados('nino', p_sujeto_id, true)
    );
  END IF;

  -- ------------------------------------------------------------------ TUTOR
  -- Fase 6 (20270118120000): un tutor SIN cuenta (el segundo, antes de aceptar la invitación) no es
  -- un usuario y no podía exportarse por ningún camino (medido el 2026-11-13). Lo exporta la
  -- Dirección de su centro, por el id de su fila en `familia_tutores`: su fila entera, y nada del otro
  -- tutor ni del niño (eso va por sus propios sujetos).
  IF p_sujeto_tipo = 'tutor' THEN
    SELECT f.centro_id INTO v_centro
      FROM public.familia_tutores ft JOIN public.familias f ON f.id = ft.familia_id
     WHERE ft.id = p_sujeto_id;
    IF v_centro IS NULL OR NOT privado.es_responsable(v_centro) THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN jsonb_build_object(
      'perfiles_familia', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'creado_en', ft.created_at, 'actualizado_en', ft.updated_at, 'borrado_en', ft.deleted_at,
                 'familia_id', ft.familia_id, 'rol_familia', ft.rol_familia,
                 'nombre_completo', ft.nombre_completo, 'email', ft.email,
                 'direccion_calle', ft.direccion_calle, 'direccion_numero', ft.direccion_numero,
                 'direccion_cp', ft.direccion_cp, 'direccion_ciudad', ft.direccion_ciudad,
                 'dni_documento_path', ft.dni_documento_path,
                 'telefono', ft.telefono, 'fecha_nacimiento', ft.fecha_nacimiento,
                 'dni_numero', ft.dni_numero, 'estudios', ft.estudios, 'empresa', ft.empresa))
          FROM public.familia_tutores ft
         WHERE ft.id = p_sujeto_id), '[]'::jsonb)
    );
  END IF;

  RAISE EXCEPTION 'tipo de sujeto inválido: %', p_sujeto_tipo
    USING ERRCODE = 'invalid_parameter_value';
END
$function$;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_cerradas int;
  v text;
BEGIN
  -- Las cinco nuevas, cerradas a la sesión; las 15 de antes, abiertas.
  SELECT count(*) INTO v_cerradas FROM unnest(ARRAY['telefono', 'fecha_nacimiento', 'dni_numero', 'estudios', 'empresa']) c
   WHERE NOT has_column_privilege('authenticated', 'public.familia_tutores', c, 'SELECT')
     AND NOT has_column_privilege('anon', 'public.familia_tutores', c, 'SELECT');
  IF v_cerradas <> 5 THEN
    RAISE EXCEPTION 'de las 5 columnas nuevas, % cerradas a la sesión', v_cerradas;
  END IF;
  IF (SELECT count(*) FROM pg_attribute
       WHERE attrelid = 'public.familia_tutores'::regclass AND attnum > 0 AND NOT attisdropped
         AND has_column_privilege('authenticated', 'public.familia_tutores', attname, 'SELECT')) <> 15 THEN
    RAISE EXCEPTION 'familia_tutores: las 15 columnas de antes ya no están abiertas';
  END IF;

  -- La escritura del tutor, solo por las funciones: quedan las dos políticas de admin.
  SELECT string_agg(policyname, ',' ORDER BY policyname) INTO v FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'familia_tutores' AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL');
  IF v IS DISTINCT FROM 'familia_tutores_insert,familia_tutores_update' THEN
    RAISE EXCEPTION 'políticas de escritura de familia_tutores: %', v;
  END IF;

  -- Las funciones nuevas, sin EXECUTE para anon ni PUBLIC.
  IF EXISTS (SELECT 1 FROM unnest(ARRAY[
                'public.guardar_tutor(uuid,text,jsonb)', 'public.fijar_dni_tutor(uuid,text,text)',
                'public.tutores_de_familia(uuid)', 'public.telefonos_familia_de_nino(uuid)',
                'privado.gestiona_tutor(uuid,uuid)', 'privado.familia_alta_validada(uuid)',
                'privado.puede_ver_dni_tutor(text)', 'privado.tutor_completo(public.familia_tutores)',
                'privado.documento_tutor_valido(text)', 'privado.normalizar_telefono(text)']) f
              WHERE has_function_privilege('anon', f::regprocedure, 'EXECUTE')) THEN
    RAISE EXCEPTION 'alguna función nueva se puede ejecutar como anon';
  END IF;

  -- Las tres funciones regeneradas llevan lo nuevo.
  IF position('datos_tutor_por_completar' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.marcar_matricula_lista(uuid)'::regprocedure)) = 0
  OR (SELECT count(*) FROM regexp_matches((SELECT prosrc FROM pg_proc WHERE oid = 'public.purgar_sujeto_db(uuid)'::regprocedure), 'dni_numero\s+= NULL', 'g')) <> 2
  OR position('''tutor''' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.export_datos_sujeto(text,uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'alguna función regenerada no lleva lo nuevo';
  END IF;

  -- Nada retroactivo: cuántas familias con el alta validada no cumplirían hoy (no se las toca).
  RAISE NOTICE 'guarda posterior: 5 columnas cerradas, 15 abiertas, escritura del tutor por función; filas vivas: %; titulares incompletos (no retroactivo): %',
    (SELECT count(*) FROM public.familia_tutores WHERE deleted_at IS NULL),
    (SELECT count(*) FROM public.familia_tutores t WHERE t.deleted_at IS NULL AND t.rol_familia = 'titular' AND NOT privado.tutor_completo(t));
END;
$guarda$;
