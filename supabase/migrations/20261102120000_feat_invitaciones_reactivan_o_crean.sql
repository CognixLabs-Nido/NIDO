-- =============================================================================
-- FEAT — Lo que hace una invitación (o un alta) con una fila retirada
-- -----------------------------------------------------------------------------
-- `UNIQUE (usuario_id, centro_id, rol)` de `roles_usuario` y `UNIQUE (nino_id, usuario_id)` de
-- `vinculos_familiares` contaban también las filas retiradas. Con una retirada, el INSERT de una
-- invitación daba 23505 y, según el sitio, la persona entraba sin rol, sin vínculo y sin aviso
-- (`crearVinculoAutomatico` con `ignoreDuplicates`), o el alta reventaba. Decisión del responsable:
--
--   · la unicidad cuenta solo las filas VIVAS (índices parciales);
--   · qué se hace con la última fila retirada lo decide su motivo, en UN SOLO SITIO
--     (`privado.decision_ante_retirada`), para roles y vínculos:
--       - reactivar: revocacion_familia, baja_direccion, traspaso_admin, paso_a_superusuario,
--         baja_nino;
--       - fila nueva, la vieja intacta: purga_rgpd, salida_centro;
--       - fallar con mensaje: solicitud_olvido, baja_temporal (55000, HINT = el motivo).
--   · `privado.dar_rol` y `privado.dar_vinculo` aplican esa tabla, y son los ÚNICOS que insertan
--     en esas dos tablas desde la BD (guarda posterior). Los usan `traspasar_admin`,
--     `crear_o_anadir_a_familia` (alta de hermano incluida) y, por RPC, la aceptación de una
--     invitación (solo `service_role`) y el vínculo que crea Dirección (`crear_vinculo`).
--   · Las reactivaciones propias (`desarchivar_nino`, la familia revocada de
--     `crear_o_anadir_a_familia`, `reactivar_profe`) miran solo la última fila retirada y se la
--     saltan si ya hay una viva.
--
-- Al reactivar, la fila vuelve tal cual (como en `desarchivar_nino`): un vínculo conserva su tipo,
-- parentesco y permisos.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor, DESPUÉS de
-- `20261101130000`. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_esperado constant jsonb := '{
    "public.traspasar_admin(uuid,uuid)": "adf153826e51e879c248af290417e519",
    "public.crear_o_anadir_a_familia(text,text,date,uuid,uuid,text,text,text,text,uuid,jsonb)": "af627a961e9a1a57b10f48c0245f360e",
    "public.desarchivar_nino(uuid,uuid)": "13a3782385b7083fb7c026ba7bc1af47",
    "public.reactivar_profe(uuid,uuid)": "feaef15798396da254060ef248b4acc8"
  }'::jsonb;
  v_mal text;
  v_otros text;
BEGIN
  IF to_regprocedure('public.reactivar_profe(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'falta reactivar_profe: aplica antes 20261101130000';
  END IF;
  IF to_regprocedure('privado.dar_rol(uuid, uuid, public.user_role, boolean)') IS NOT NULL
     OR to_regprocedure('public.crear_vinculo(uuid, uuid, public.tipo_vinculo, public.parentesco, text, jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'las funciones de esta migración ya existen';
  END IF;
  IF (SELECT count(*) FROM pg_constraint
       WHERE conname IN ('roles_usuario_usuario_id_centro_id_rol_key',
                         'vinculos_familiares_nino_id_usuario_id_key')
         AND contype = 'u') <> 2 THEN
    RAISE EXCEPTION 'no están las dos restricciones UNIQUE totales de partida';
  END IF;

  -- Los 4 cuerpos que se reescriben, con la lógica que se leyó en producción (md5 normalizado:
  -- sin \r, sin comentarios, espacios colapsados).
  SELECT string_agg(e.key || '=' || coalesce(a.md5, 'falta'), ', ')
    INTO v_mal
    FROM jsonb_each_text(v_esperado) e
    LEFT JOIN (
      SELECT 'public.' || p.proname || substr(p.oid::regprocedure::text, strpos(p.oid::regprocedure::text, '(')) AS sig,
             md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) AS md5
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
    ) a ON a.sig = e.key
   WHERE a.md5 IS DISTINCT FROM e.value;
  IF v_mal IS NOT NULL THEN
    RAISE EXCEPTION 'los cuerpos no son los esperados: %', v_mal;
  END IF;

  -- Nadie más escribe esas dos tablas con ON CONFLICT o reactivándolas: si apareciera otro, se
  -- quedaría con la unicidad vieja.
  SELECT string_agg(DISTINCT n.nspname || '.' || p.proname, ', ')
    INTO v_otros
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'privado')
     AND p.proname NOT IN ('traspasar_admin', 'crear_o_anadir_a_familia', 'desarchivar_nino', 'reactivar_profe')
     AND p.prosrc ~* '(roles_usuario|vinculos_familiares)'
     AND (p.prosrc ~* 'insert\s+into\s+(public\.)?(roles_usuario|vinculos_familiares)'
          OR p.prosrc ~* 'deleted_at\s*=\s*NULL');
  IF v_otros IS NOT NULL THEN
    RAISE EXCEPTION 'hay otras funciones que insertan o reactivan roles o vínculos: %', v_otros;
  END IF;

  RAISE NOTICE 'filas retiradas de partida: roles %, vínculos %',
    (SELECT count(*) FROM public.roles_usuario WHERE deleted_at IS NOT NULL),
    (SELECT count(*) FROM public.vinculos_familiares WHERE deleted_at IS NOT NULL);
END
$guarda$;

-- ---- La unicidad cuenta solo las filas vivas ----
-- El índice total se queda, sin UNIQUE, para las lecturas de filas retiradas por la clave.
ALTER TABLE public.roles_usuario DROP CONSTRAINT roles_usuario_usuario_id_centro_id_rol_key;
CREATE UNIQUE INDEX roles_usuario_viva_key
  ON public.roles_usuario (usuario_id, centro_id, rol) WHERE deleted_at IS NULL;
CREATE INDEX roles_usuario_clave_idx ON public.roles_usuario (usuario_id, centro_id, rol);

ALTER TABLE public.vinculos_familiares DROP CONSTRAINT vinculos_familiares_nino_id_usuario_id_key;
CREATE UNIQUE INDEX vinculos_familiares_vivo_key
  ON public.vinculos_familiares (nino_id, usuario_id) WHERE deleted_at IS NULL;
CREATE INDEX vinculos_familiares_clave_idx ON public.vinculos_familiares (nino_id, usuario_id);

-- ---- La tabla de motivos: UN SOLO SITIO ----
-- Sin ELSE: un motivo nuevo sin clasificar devuelve NULL, `dar_rol`/`dar_vinculo` fallan con él, y
-- la guarda posterior (y su test) lo cazan antes.
CREATE FUNCTION privado.decision_ante_retirada(p_motivo public.motivo_borrado)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path = ''
AS $function$
  SELECT CASE p_motivo
    -- Se reactiva: un cambio de puesto o una baja que se deshace, no una sanción.
    WHEN 'revocacion_familia'  THEN 'reactivar'
    WHEN 'baja_direccion'      THEN 'reactivar'
    WHEN 'traspaso_admin'      THEN 'reactivar'
    WHEN 'paso_a_superusuario' THEN 'reactivar'
    WHEN 'baja_nino'           THEN 'reactivar'
    -- Fila nueva, la vieja intacta: lo de antes fue otra relación (purgada o terminada).
    WHEN 'purga_rgpd'          THEN 'nueva'
    WHEN 'salida_centro'       THEN 'nueva'
    -- Falla con mensaje: por aquí no se vuelve (el olvido no se deshace; la baja temporal se
    -- reactiva desde Personal).
    WHEN 'solicitud_olvido'    THEN 'falla'
    WHEN 'baja_temporal'       THEN 'falla'
  END
$function$;

-- Da un rol: con una fila viva no hace nada; si no, la última retirada decide por su motivo.
-- Devuelve 'viva' | 'reactivada' | 'creada'; con `p_solo_comprobar` no escribe y devuelve
-- 'viva' | 'reactivar' | 'crear' (lo que haría), o falla igual.
CREATE FUNCTION privado.dar_rol(
  p_usuario_id uuid, p_centro_id uuid, p_rol public.user_role,
  p_solo_comprobar boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
DECLARE
  v_fila     uuid;
  v_motivo   public.motivo_borrado;
  v_decision text;
BEGIN
  IF p_usuario_id IS NULL OR p_centro_id IS NULL OR p_rol IS NULL THEN
    RAISE EXCEPTION 'faltan datos para dar el rol' USING ERRCODE = '22023';
  END IF;
  -- Dos altas a la vez de la misma persona y rol no se cruzan.
  PERFORM pg_advisory_xact_lock(
    hashtext('roles_usuario:' || p_usuario_id || ':' || p_centro_id || ':' || p_rol));

  IF EXISTS (SELECT 1 FROM public.roles_usuario
              WHERE usuario_id = p_usuario_id AND centro_id = p_centro_id
                AND rol = p_rol AND deleted_at IS NULL) THEN
    RETURN 'viva';
  END IF;

  SELECT id, deleted_reason INTO v_fila, v_motivo
    FROM public.roles_usuario
   WHERE usuario_id = p_usuario_id AND centro_id = p_centro_id
     AND rol = p_rol AND deleted_at IS NOT NULL
   ORDER BY deleted_at DESC, id DESC
   LIMIT 1;

  v_decision := CASE WHEN v_fila IS NULL THEN 'nueva'
                     ELSE privado.decision_ante_retirada(v_motivo) END;
  IF v_decision IS NULL THEN
    RAISE EXCEPTION 'motivo % sin clasificar en privado.decision_ante_retirada', v_motivo
      USING ERRCODE = 'P0001';
  END IF;
  IF v_decision = 'falla' THEN
    RAISE EXCEPTION 'su fila de este rol está retirada por %: no vuelve por aquí', v_motivo
      USING ERRCODE = '55000', HINT = v_motivo::text;
  END IF;

  IF p_solo_comprobar THEN
    RETURN CASE v_decision WHEN 'reactivar' THEN 'reactivar' ELSE 'crear' END;
  END IF;
  IF v_decision = 'reactivar' THEN
    UPDATE public.roles_usuario SET deleted_at = NULL, deleted_reason = NULL WHERE id = v_fila;
    RETURN 'reactivada';
  END IF;
  INSERT INTO public.roles_usuario (usuario_id, centro_id, rol)
  VALUES (p_usuario_id, p_centro_id, p_rol);
  RETURN 'creada';
END
$function$;

-- Lo mismo para un vínculo. Al reactivar, la fila vuelve tal cual (tipo, parentesco, permisos).
CREATE FUNCTION privado.dar_vinculo(
  p_nino_id uuid, p_usuario_id uuid, p_tipo public.tipo_vinculo,
  p_parentesco public.parentesco, p_descripcion_parentesco text, p_permisos jsonb,
  p_solo_comprobar boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
DECLARE
  v_fila     uuid;
  v_motivo   public.motivo_borrado;
  v_decision text;
BEGIN
  IF p_nino_id IS NULL OR p_usuario_id IS NULL THEN
    RAISE EXCEPTION 'faltan datos para dar el vínculo' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtext('vinculos_familiares:' || p_nino_id || ':' || p_usuario_id));

  IF EXISTS (SELECT 1 FROM public.vinculos_familiares
              WHERE nino_id = p_nino_id AND usuario_id = p_usuario_id
                AND deleted_at IS NULL) THEN
    RETURN 'viva';
  END IF;

  SELECT id, deleted_reason INTO v_fila, v_motivo
    FROM public.vinculos_familiares
   WHERE nino_id = p_nino_id AND usuario_id = p_usuario_id AND deleted_at IS NOT NULL
   ORDER BY deleted_at DESC, id DESC
   LIMIT 1;

  v_decision := CASE WHEN v_fila IS NULL THEN 'nueva'
                     ELSE privado.decision_ante_retirada(v_motivo) END;
  IF v_decision IS NULL THEN
    RAISE EXCEPTION 'motivo % sin clasificar en privado.decision_ante_retirada', v_motivo
      USING ERRCODE = 'P0001';
  END IF;
  IF v_decision = 'falla' THEN
    RAISE EXCEPTION 'su vínculo con este niño está retirado por %: no vuelve por aquí', v_motivo
      USING ERRCODE = '55000', HINT = v_motivo::text;
  END IF;

  IF p_solo_comprobar THEN
    RETURN CASE v_decision WHEN 'reactivar' THEN 'reactivar' ELSE 'crear' END;
  END IF;
  IF v_decision = 'reactivar' THEN
    UPDATE public.vinculos_familiares SET deleted_at = NULL, deleted_reason = NULL WHERE id = v_fila;
    RETURN 'reactivada';
  END IF;
  INSERT INTO public.vinculos_familiares
    (nino_id, usuario_id, tipo_vinculo, parentesco, descripcion_parentesco, permisos)
  VALUES (p_nino_id, p_usuario_id, p_tipo, p_parentesco, p_descripcion_parentesco, p_permisos);
  RETURN 'creada';
END
$function$;

-- Ni la API ni nadie más: solo las funciones SECURITY DEFINER de abajo (dueño postgres).
REVOKE ALL ON FUNCTION privado.decision_ante_retirada(public.motivo_borrado) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION privado.dar_rol(uuid, uuid, public.user_role, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION privado.dar_vinculo(uuid, uuid, public.tipo_vinculo, public.parentesco, text, jsonb, boolean) FROM PUBLIC, anon, authenticated, service_role;

-- ---- Las puertas ----
-- La aceptación de una invitación (server-side, service role): el rol.
CREATE FUNCTION public.dar_rol_de_invitacion(
  p_usuario_id uuid, p_centro_id uuid, p_rol public.user_role,
  p_solo_comprobar boolean DEFAULT false)
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path = public
AS $function$
  SELECT privado.dar_rol(p_usuario_id, p_centro_id, p_rol, p_solo_comprobar);
$function$;

-- La aceptación de una invitación: los vínculos con los niños de la familia, todos o ninguno.
CREATE FUNCTION public.dar_vinculos_de_invitacion(
  p_usuario_id uuid, p_nino_ids uuid[], p_tipo public.tipo_vinculo,
  p_parentesco public.parentesco, p_descripcion_parentesco text, p_permisos jsonb,
  p_solo_comprobar boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_nino uuid;
BEGIN
  FOREACH v_nino IN ARRAY coalesce(p_nino_ids, '{}') LOOP
    PERFORM privado.dar_vinculo(v_nino, p_usuario_id, p_tipo, p_parentesco,
      p_descripcion_parentesco, p_permisos, p_solo_comprobar);
  END LOOP;
END
$function$;

REVOKE ALL ON FUNCTION public.dar_rol_de_invitacion(uuid, uuid, public.user_role, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dar_rol_de_invitacion(uuid, uuid, public.user_role, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.dar_vinculos_de_invitacion(uuid, uuid[], public.tipo_vinculo, public.parentesco, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dar_vinculos_de_invitacion(uuid, uuid[], public.tipo_vinculo, public.parentesco, text, jsonb, boolean) TO service_role;

-- Dirección crea un vínculo (`crearVinculo`): el mismo permiso que su política (`es_admin` del
-- centro del niño), y la misma tabla de motivos. Un vínculo vivo sigue siendo un duplicado.
CREATE FUNCTION public.crear_vinculo(
  p_nino_id uuid, p_usuario_id uuid, p_tipo public.tipo_vinculo,
  p_parentesco public.parentesco, p_descripcion_parentesco text, p_permisos jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'sin sesión' USING ERRCODE = '42501';
  END IF;
  IF p_nino_id IS NULL OR NOT public.es_admin(privado.centro_de_nino(p_nino_id)) THEN
    RAISE EXCEPTION 'solo Dirección crea vínculos de los niños del centro' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.vinculos_familiares
              WHERE nino_id = p_nino_id AND usuario_id = p_usuario_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'ya tiene un vínculo con este niño' USING ERRCODE = '23505';
  END IF;

  PERFORM privado.dar_vinculo(p_nino_id, p_usuario_id, p_tipo, p_parentesco,
    p_descripcion_parentesco, p_permisos);

  SELECT id INTO v_id FROM public.vinculos_familiares
   WHERE nino_id = p_nino_id AND usuario_id = p_usuario_id AND deleted_at IS NULL;
  RETURN v_id;
END
$function$;

REVOKE ALL ON FUNCTION public.crear_vinculo(uuid, uuid, public.tipo_vinculo, public.parentesco, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_vinculo(uuid, uuid, public.tipo_vinculo, public.parentesco, text, jsonb) TO authenticated;

-- ---- Los cuatro cuerpos que pasan por la tabla de motivos o miran solo la última retirada ----
CREATE OR REPLACE FUNCTION public.traspasar_admin(p_centro_id uuid, p_nueva_admin uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_yo uuid := auth.uid();
  v_fila_admin uuid;
  v_fila_directora uuid;
BEGIN
  IF v_yo IS NULL THEN
    RAISE EXCEPTION 'sin sesión' USING ERRCODE = '42501';
  END IF;

  -- La fila admin viva de quien llama, bloqueada: dos traspasos a la vez no se cruzan.
  SELECT id INTO v_fila_admin
    FROM public.roles_usuario
   WHERE centro_id = p_centro_id AND usuario_id = v_yo
     AND rol = 'admin' AND deleted_at IS NULL
   FOR UPDATE;
  IF v_fila_admin IS NULL THEN
    RAISE EXCEPTION 'solo la admin del centro traspasa la administración' USING ERRCODE = '42501';
  END IF;

  IF p_nueva_admin IS NULL OR p_nueva_admin = v_yo THEN
    RAISE EXCEPTION 'la nueva admin tiene que ser otra persona' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_fila_directora
    FROM public.roles_usuario
   WHERE centro_id = p_centro_id AND usuario_id = p_nueva_admin
     AND rol = 'directora' AND deleted_at IS NULL
   FOR UPDATE;
  IF v_fila_directora IS NULL THEN
    RAISE EXCEPTION 'solo se traspasa a una directora del centro' USING ERRCODE = '23514';
  END IF;

  -- Primero se retira la saliente: el índice admite una admin viva por centro.
  UPDATE public.roles_usuario
     SET deleted_at = now(), deleted_reason = 'traspaso_admin'
   WHERE id IN (v_fila_admin, v_fila_directora);

  -- [INVITACIONES] La tabla de motivos decide, como en una invitación: reactiva la fila de un
  -- traspaso anterior, o crea una nueva.
  PERFORM privado.dar_rol(p_nueva_admin, p_centro_id, 'admin');
  PERFORM privado.dar_rol(v_yo, p_centro_id, 'directora');
END
$function$;
CREATE OR REPLACE FUNCTION public.crear_o_anadir_a_familia(p_nombre_nino text, p_apellidos_nino text, p_fecha_nacimiento date, p_centro_id uuid, p_aula_id uuid, p_tutor_email text, p_tutor_nombre_completo text, p_parentesco text, p_descripcion_parentesco text, p_usuario_id uuid, p_permisos jsonb)
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
      left(NULLIF(trim(COALESCE(p_nombre_nino,'') || ' ' || COALESCE(p_apellidos_nino,'')), ''), 200)
    )
    RETURNING id INTO v_familia_id;
    v_familia_nueva := true;

    INSERT INTO public.familia_tutores (familia_id, usuario_id, rol_familia, email, nombre_completo)
    VALUES (v_familia_id, p_usuario_id, 'titular', p_tutor_email, p_tutor_nombre_completo);
  END IF;

  INSERT INTO public.ninos (centro_id, nombre, apellidos, fecha_nacimiento, familia_id)
  VALUES (p_centro_id, p_nombre_nino, p_apellidos_nino, p_fecha_nacimiento, v_familia_id)
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
CREATE OR REPLACE FUNCTION public.desarchivar_nino(p_nino_id uuid, p_aula_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro_id     uuid;
  v_familia_id    uuid;
  v_archivado     boolean;
  v_motivo        public.motivo_borrado;
  v_curso_id      uuid;
  v_familia_react boolean := false;
  v_roles         integer := 0;
  v_matricula_id  uuid;
BEGIN
  SELECT centro_id, familia_id, (deleted_at IS NOT NULL), deleted_reason
    INTO v_centro_id, v_familia_id, v_archivado, v_motivo
    FROM public.ninos
    WHERE id = p_nino_id;
  IF v_centro_id IS NULL THEN
    RAISE EXCEPTION 'nino % no existe', p_nino_id USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT (public.es_admin(v_centro_id) OR (SELECT auth.role()) = 'service_role') THEN
    RAISE EXCEPTION 'no autorizado a reincorporar a este nino';
  END IF;

  IF NOT v_archivado THEN
    RETURN jsonb_build_object('nino_id', p_nino_id, 'ya_activo', true);
  END IF;

  -- D-5: solo se reincorpora lo que archivó una BAJA. Un niño purgado por RGPD
  -- (deleted_reason='purga_rgpd') NO es reincorporable: su PII ya se anonimizó.
  IF v_motivo IS DISTINCT FROM 'baja_nino' THEN
    RAISE EXCEPTION 'no se puede reincorporar a un sujeto purgado' USING ERRCODE = 'raise_exception';
  END IF;

  v_curso_id := public.curso_activo_de_centro(v_centro_id);
  IF v_curso_id IS NULL THEN
    RAISE EXCEPTION 'el centro no tiene curso academico activo' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.aulas_curso
    WHERE aula_id = p_aula_id AND curso_academico_id = v_curso_id
  ) THEN
    RAISE EXCEPTION 'el aula no pertenece al curso activo del centro' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- 5a. Desarchiva el niño (ya validado que fue una baja) y limpia el motivo.
  UPDATE public.ninos SET deleted_at = NULL, deleted_reason = NULL WHERE id = p_nino_id;

  -- 5b. D-5: revive SOLO los vínculos que borró la BAJA ('baja_nino'), no los de una
  --     purga RGPD u otra vía. Al revivir, limpia el motivo (coherencia con el CHECK).
  --     [INVITACIONES] Solo la última fila retirada de cada persona, y solo si no tiene ya una
  --     viva: la unicidad cuenta solo las vivas, y puede haber varias retiradas.
  UPDATE public.vinculos_familiares vf
     SET deleted_at = NULL, deleted_reason = NULL
   WHERE vf.id IN (
       SELECT DISTINCT ON (x.usuario_id) x.id
         FROM public.vinculos_familiares x
        WHERE x.nino_id = p_nino_id AND x.deleted_at IS NOT NULL
        ORDER BY x.usuario_id, x.deleted_at DESC, x.id DESC)
     AND vf.deleted_reason = 'baja_nino'
     AND NOT EXISTS (
       SELECT 1 FROM public.vinculos_familiares v
        WHERE v.nino_id = vf.nino_id AND v.usuario_id = vf.usuario_id AND v.deleted_at IS NULL);

  -- 5c. D-5: reactiva la familia SOLO si la archivó una revocación de baja.
  UPDATE public.familias
     SET deleted_at = NULL, deleted_reason = NULL
   WHERE id = v_familia_id
     AND deleted_at IS NOT NULL
     AND deleted_reason = 'revocacion_familia';
  v_familia_react := FOUND;

  -- 5d. D-5: reactiva el rol tutor_legal SOLO de los revocados por baja ('revocacion_familia').
  --     [INVITACIONES] La última retirada de cada tutor, y solo si no tiene ya una viva.
  WITH react AS (
    UPDATE public.roles_usuario ru
       SET deleted_at = NULL, deleted_reason = NULL
     WHERE ru.id IN (
         SELECT DISTINCT ON (r.usuario_id) r.id
           FROM public.roles_usuario r
          WHERE r.centro_id = v_centro_id
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
            AND v.rol = ru.rol AND v.deleted_at IS NULL)
    RETURNING 1
  )
  SELECT count(*) INTO v_roles FROM react;

  INSERT INTO public.matriculas (nino_id, aula_id, curso_academico_id, fecha_alta, estado)
  VALUES (p_nino_id, p_aula_id, v_curso_id, public.hoy_madrid(), 'activa')
  RETURNING id INTO v_matricula_id;

  RETURN jsonb_build_object(
    'nino_id',            p_nino_id,
    'desarchivado',       true,
    'matricula_id',       v_matricula_id,
    'familia_reactivada', v_familia_react,
    'roles_reactivados',  v_roles
  );
END $function$;
CREATE OR REPLACE FUNCTION public.reactivar_profe(p_centro_id uuid, p_usuario_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_fila   uuid;
  v_motivo text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'sin sesión' USING ERRCODE = '42501';
  END IF;
  IF p_centro_id IS NULL OR NOT public.es_admin(p_centro_id) THEN
    RAISE EXCEPTION 'solo Dirección reactiva al personal del centro' USING ERRCODE = '42501';
  END IF;

  -- [INVITACIONES] Con la unicidad solo de las vivas puede haber varias filas: si ya hay una viva
  -- no está de baja, y si no, manda la última retirada.
  IF EXISTS (SELECT 1 FROM public.roles_usuario
              WHERE centro_id = p_centro_id AND usuario_id = p_usuario_id
                AND rol = 'profe' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'no está de baja temporal en este centro' USING ERRCODE = 'P0002';
  END IF;

  SELECT id, deleted_reason::text INTO v_fila, v_motivo
    FROM public.roles_usuario
   WHERE centro_id = p_centro_id AND usuario_id = p_usuario_id
     AND rol = 'profe' AND deleted_at IS NOT NULL
   ORDER BY deleted_at DESC, id DESC
   LIMIT 1
   FOR UPDATE;

  IF v_motivo = 'salida_centro' THEN
    RAISE EXCEPTION 'salió del centro: vuelve con una invitación' USING ERRCODE = '55000';
  END IF;
  IF v_motivo IS DISTINCT FROM 'baja_temporal' THEN
    RAISE EXCEPTION 'no está de baja temporal en este centro' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.roles_usuario
     SET deleted_at = NULL, deleted_reason = NULL
   WHERE id = v_fila;
END
$function$;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_esperado constant jsonb := '{
    "privado.decision_ante_retirada(motivo_borrado)": "8afcf283fdfbf5c1674a951e9a891726",
    "privado.dar_rol(uuid,uuid,user_role,boolean)": "89e36502ccdb07365067fcfa97e67715",
    "privado.dar_vinculo(uuid,uuid,tipo_vinculo,parentesco,text,jsonb,boolean)": "1ce4bc2f4436c098cae536f5a25460b7",
    "public.dar_rol_de_invitacion(uuid,uuid,user_role,boolean)": "23dca810305fb48e945af08af1971712",
    "public.dar_vinculos_de_invitacion(uuid,uuid[],tipo_vinculo,parentesco,text,jsonb,boolean)": "12323d2dfdaca7f9704cce941245bf21",
    "public.crear_vinculo(uuid,uuid,tipo_vinculo,parentesco,text,jsonb)": "37918c41d7f8113e02a634979243cbce",
    "public.traspasar_admin(uuid,uuid)": "06f39bf367d960716c92c9a620c94b65",
    "public.crear_o_anadir_a_familia(text,text,date,uuid,uuid,text,text,text,text,uuid,jsonb)": "49d3986421a0c3144502fab3d672ddc8",
    "public.desarchivar_nino(uuid,uuid)": "097ba7b5f19ec14dd77571da7001e74b",
    "public.reactivar_profe(uuid,uuid)": "511d4b91cef122112295f51123d15057"
  }'::jsonb;
  v_mal text;
  v_n int;
BEGIN
  -- La unicidad: solo las vivas, y las totales ya no están.
  IF (SELECT count(*) FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
       WHERE i.relname IN ('roles_usuario_viva_key', 'vinculos_familiares_vivo_key')
         AND x.indisunique
         AND pg_get_expr(x.indpred, x.indrelid) = '(deleted_at IS NULL)') <> 2 THEN
    RAISE EXCEPTION 'faltan los índices únicos de filas vivas';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_index x
              WHERE x.indrelid IN ('public.roles_usuario'::regclass, 'public.vinculos_familiares'::regclass)
                AND x.indisunique AND x.indpred IS NULL AND NOT x.indisprimary) THEN
    RAISE EXCEPTION 'queda un índice único total en roles o vínculos';
  END IF;

  -- Todo el enum clasificado: copiar del catálogo, no de una lista escrita a mano.
  SELECT string_agg(e.enumlabel, ', '), count(*)
    INTO v_mal, v_n
    FROM pg_enum e
   WHERE e.enumtypid = 'public.motivo_borrado'::regtype
     AND privado.decision_ante_retirada(e.enumlabel::public.motivo_borrado) IS NULL;
  IF v_mal IS NOT NULL THEN
    RAISE EXCEPTION 'motivos sin clasificar en privado.decision_ante_retirada: %', v_mal;
  END IF;
  RAISE NOTICE 'motivos clasificados: todos los % del enum',
    (SELECT count(*) FROM pg_enum WHERE enumtypid = 'public.motivo_borrado'::regtype);

  -- Los cuerpos, con la lógica de este fichero.
  SELECT string_agg(e.key || '=' || coalesce(a.md5, 'falta'), ', ')
    INTO v_mal
    FROM jsonb_each_text(v_esperado) e
    LEFT JOIN (
      SELECT n.nspname || '.' || p.proname || '(' ||
               regexp_replace(regexp_replace(pg_get_function_identity_arguments(p.oid), 'p_[a-z_]+ ', '', 'g'), ', ', ',', 'g')
               || ')' AS sig,
             md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) AS md5
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname IN ('public', 'privado')
    ) a ON a.sig = e.key
   WHERE a.md5 IS DISTINCT FROM e.value;
  IF v_mal IS NOT NULL THEN
    RAISE EXCEPTION 'los cuerpos no quedan como en el fichero: %', v_mal;
  END IF;

  -- Solo `privado.dar_rol` inserta en roles y solo `privado.dar_vinculo` en vínculos, y nadie usa
  -- ON CONFLICT con ellas (no casaría con un índice parcial).
  SELECT string_agg(n.nspname || '.' || p.proname, ', ')
    INTO v_mal
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'privado')
     AND ((p.prosrc ~* 'insert\s+into\s+(public\.)?roles_usuario' AND p.oid <> 'privado.dar_rol(uuid,uuid,public.user_role,boolean)'::regprocedure)
       OR (p.prosrc ~* 'insert\s+into\s+(public\.)?vinculos_familiares' AND p.oid <> 'privado.dar_vinculo(uuid,uuid,public.tipo_vinculo,public.parentesco,text,jsonb,boolean)'::regprocedure)
       OR p.prosrc ~* 'insert\s+into\s+(public\.)?(roles_usuario|vinculos_familiares)[^;]*on\s+conflict');
  IF v_mal IS NOT NULL THEN
    RAISE EXCEPTION 'otras funciones insertan en roles o vínculos: %', v_mal;
  END IF;

  -- Permisos: lo de privado no lo ejecuta nadie más que su dueño; las invitaciones, solo el
  -- servicio; crear_vinculo, quien tiene sesión.
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.pronamespace = 'privado'::regnamespace
                AND p.proname IN ('decision_ante_retirada', 'dar_rol', 'dar_vinculo')
                AND (has_function_privilege('anon', p.oid, 'EXECUTE')
                  OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
                  OR has_function_privilege('service_role', p.oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'una función de privado se puede ejecutar desde fuera';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace
                AND p.proname IN ('dar_rol_de_invitacion', 'dar_vinculos_de_invitacion', 'crear_vinculo')
                AND (NOT p.prosecdef
                  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']
                  OR has_function_privilege('anon', p.oid, 'EXECUTE')
                  OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
                  OR has_function_privilege('authenticated', p.oid, 'EXECUTE') <> (p.proname = 'crear_vinculo')
                  OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'las puertas nuevas no tienen los permisos esperados';
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('dar_rol_de_invitacion', 'dar_vinculos_de_invitacion', 'crear_vinculo');
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'se esperaban 3 puertas, hay %', v_n;
  END IF;
END
$guarda$;
