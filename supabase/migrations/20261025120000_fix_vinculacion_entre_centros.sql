-- =============================================================================
-- FIX — Entre centros no se vincula a nadie sin que acepte (PR 1, Fase 4)
-- -----------------------------------------------------------------------------
-- Cierra en la BD los dos caminos por los que una directora podía meter en su centro, sin
-- preguntarle, a una cuenta que no es de él (ADR-0053, apartado 9, y el diagnóstico de la Fase 4):
--
--   1. `crear_o_anadir_a_familia` (SECURITY DEFINER, ejecutable con sesión) aceptaba cualquier
--      `p_usuario_id`: le creaba en el centro una familia, el rol `tutor_legal` y el vínculo con
--      el niño. Ahora solo acepta una cuenta que YA tiene perfil en `familia_tutores` en una
--      familia de este centro (el 2.º hijo), o una que no ha operado nunca en ninguno (la recién
--      creada de «Completar en Dirección»: sin roles, ni superusuario, ni perfil). Lo demás da
--      42501: esa cuenta se invita y acepta.
--   2. `lista_espera.tutor_usuario_id`: la directora lo escribía con su sesión
--      (`lista_espera_admin_all`), y al promover el prospecto la app vinculaba a esa cuenta. Un
--      trigger BEFORE exige lo mismo que la RPC (perfil en el centro del prospecto), para
--      cualquiera, también service role. Solo mira la columna cuando cambia: un prospecto viejo
--      no impide tocar las demás.
--
-- Demostrado contra la BD efímera del CI: `vinculacion-entre-centros.rls.test.ts` (control
-- positivo en el commit f7733f4).
--
-- Estado verificado en producción el 2026-10-20 (lectura read_only): 1 centro, 1 prospecto con
-- `tutor_usuario_id` y 0 sin perfil en su centro. La guarda previa lo cuenta y lo imprime.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor. Tras aplicar:
-- registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_sin_perfil int;
BEGIN
  -- El cuerpo vivo de la RPC tiene que ser el de 20261002130000 (lógica normalizada: sin \r, sin
  -- comentarios `--` y con los espacios colapsados, como lo deja el SQL Editor).
  SELECT md5(regexp_replace(regexp_replace(replace(prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5
    FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'crear_o_anadir_a_familia';
  IF v_md5 IS DISTINCT FROM 'a907cd35fa7aedb87d20f5ddf07cdb06' THEN
    RAISE EXCEPTION 'crear_o_anadir_a_familia no es la de 20261002130000 (md5 normalizado %)', v_md5;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc
              WHERE pronamespace = 'public'::regnamespace AND proname = 'lista_espera_validar_tutor') THEN
    RAISE EXCEPTION 'lista_espera_validar_tutor ya existe';
  END IF;

  -- Prospectos cuyo tutor no tiene perfil en su centro: el trigger no los toca (solo mira cuando
  -- cambia la columna) y la app ya no se fía de ellos al promover. Se imprimen para verlos.
  SELECT count(*) INTO v_sin_perfil
    FROM public.lista_espera le
   WHERE le.tutor_usuario_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.familia_tutores ft
         JOIN public.familias f ON f.id = ft.familia_id
        WHERE ft.usuario_id = le.tutor_usuario_id AND ft.deleted_at IS NULL
          AND f.centro_id = le.centro_id);
  RAISE NOTICE 'crear_o_anadir_a_familia: cuerpo de 20261002130000 (md5 %); prospectos con tutor sin perfil en su centro: %',
    v_md5, v_sin_perfil;
END
$guarda$;

-- ---- 1. La RPC de alta solo vincula a quien ya es de este centro ----
CREATE OR REPLACE FUNCTION public.crear_o_anadir_a_familia(
  p_nombre_nino            text,
  p_apellidos_nino         text,
  p_fecha_nacimiento       date,
  p_centro_id              uuid,
  p_aula_id                uuid,
  p_tutor_email            text,
  p_tutor_nombre_completo  text,
  p_parentesco             text,
  p_descripcion_parentesco text,
  p_usuario_id             uuid,
  p_permisos               jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
      UPDATE public.roles_usuario ru
         SET deleted_at = NULL, deleted_reason = NULL
       WHERE ru.centro_id = p_centro_id
         AND ru.rol = 'tutor_legal'
         AND ru.deleted_at IS NOT NULL
         AND ru.deleted_reason = 'revocacion_familia'
         AND ru.usuario_id IN (
           SELECT ft.usuario_id
             FROM public.familia_tutores ft
            WHERE ft.familia_id = v_familia_id
              AND ft.usuario_id IS NOT NULL
              AND ft.deleted_at IS NULL
         );
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
    INSERT INTO public.vinculos_familiares
      (nino_id, usuario_id, tipo_vinculo, parentesco, descripcion_parentesco, permisos)
    VALUES
      -- [ALTA-HERMANO C2] El tipo sale de su papel en la familia: el segundo_tutor queda
      -- secundario también con el hermano (antes se forzaba principal).
      (v_nino_id, p_usuario_id,
       CASE WHEN v_perfil.rol_familia = 'segundo_tutor'
            THEN 'tutor_legal_secundario'::public.tipo_vinculo
            ELSE 'tutor_legal_principal'::public.tipo_vinculo END,
       p_parentesco::public.parentesco, p_descripcion_parentesco, COALESCE(p_permisos, '{}'::jsonb))
    ON CONFLICT (nino_id, usuario_id) DO NOTHING;

    INSERT INTO public.roles_usuario (usuario_id, centro_id, rol)
    SELECT p_usuario_id, p_centro_id, 'tutor_legal'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.roles_usuario
      WHERE usuario_id = p_usuario_id AND centro_id = p_centro_id
        AND rol = 'tutor_legal' AND deleted_at IS NULL
    );
  END IF;

  -- [ALTA-HERMANO C3] Hermano en una familia que YA existía: el niño nuevo queda vinculado
  -- también a los DEMÁS tutores legales de la familia que ya tienen cuenta, con su mismo papel
  -- (titular → principal, segundo_tutor → secundario) y copiando parentesco y permisos de su
  -- vínculo ACTIVO con otro hijo de la familia. Solo tutores con rol tutor_legal activo en el
  -- centro (no se devuelve acceso a quien se le quitó). Un tutor sin cuenta (usuario_id NULL)
  -- no se toca: se vincula al aceptar su invitación. Familia nueva (1.er hijo) → no aplica.
  IF NOT v_familia_nueva THEN
    INSERT INTO public.vinculos_familiares
      (nino_id, usuario_id, tipo_vinculo, parentesco, descripcion_parentesco, permisos)
    SELECT v_nino_id, ft.usuario_id,
           CASE WHEN ft.rol_familia = 'segundo_tutor'
                THEN 'tutor_legal_secundario'::public.tipo_vinculo
                ELSE 'tutor_legal_principal'::public.tipo_vinculo END,
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
    ON CONFLICT (nino_id, usuario_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'resultado',    CASE WHEN v_familia_nueva THEN 'familia_creada' ELSE 'nino_anadido' END,
    'familia_id',   v_familia_id,
    'nino_id',      v_nino_id,
    'matricula_id', v_matricula_id,
    'colision_info', NULL
  );
END;
$$;

-- ---- 2. lista_espera.tutor_usuario_id, contra el centro del prospecto ----
CREATE FUNCTION public.lista_espera_validar_tutor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.tutor_usuario_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.tutor_usuario_id IS NOT DISTINCT FROM OLD.tutor_usuario_id
     AND NEW.centro_id IS NOT DISTINCT FROM OLD.centro_id THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.familia_tutores ft
      JOIN public.familias f ON f.id = ft.familia_id
     WHERE ft.usuario_id = NEW.tutor_usuario_id AND ft.deleted_at IS NULL
       AND f.centro_id = NEW.centro_id
  ) THEN
    RAISE EXCEPTION 'el tutor del prospecto no tiene familia en este centro'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.lista_espera_validar_tutor() FROM PUBLIC, anon, authenticated;

-- Después de `lista_espera_set_centro_id` (los BEFORE van por orden alfabético): mira el centro
-- ya derivado del curso.
CREATE TRIGGER lista_espera_validar_tutor_trg
  BEFORE INSERT OR UPDATE OF tutor_usuario_id, centro_id ON public.lista_espera
  FOR EACH ROW EXECUTE FUNCTION public.lista_espera_validar_tutor();

-- ---- Guarda posterior ----
DO $comprueba$
DECLARE
  v_trigger int;
  v_md5 text;
BEGIN
  SELECT count(*) INTO v_trigger
    FROM pg_trigger
   WHERE tgrelid = 'public.lista_espera'::regclass
     AND tgname = 'lista_espera_validar_tutor_trg'
     AND NOT tgisinternal AND tgenabled <> 'D';
  IF v_trigger <> 1 THEN
    RAISE EXCEPTION 'se esperaba 1 trigger lista_espera_validar_tutor_trg activo; hay %', v_trigger;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc
                  WHERE pronamespace = 'public'::regnamespace AND proname = 'crear_o_anadir_a_familia'
                    AND prosrc LIKE '%se invita, no se vincula%') THEN
    RAISE EXCEPTION 'crear_o_anadir_a_familia no lleva la guarda de la cuenta de otro centro';
  END IF;
  IF has_function_privilege('anon',
       'public.crear_o_anadir_a_familia(text, text, date, uuid, uuid, text, text, text, text, uuid, jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated',
       'public.crear_o_anadir_a_familia(text, text, date, uuid, uuid, text, text, text, text, uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'crear_o_anadir_a_familia: los permisos no son los de antes (authenticated sí, anon no)';
  END IF;
  IF has_function_privilege('authenticated', 'public.lista_espera_validar_tutor()', 'EXECUTE') THEN
    RAISE EXCEPTION 'lista_espera_validar_tutor no puede ser ejecutable con sesión';
  END IF;

  SELECT md5(regexp_replace(regexp_replace(replace(prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5
    FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'crear_o_anadir_a_familia';
  RAISE NOTICE 'vinculación entre centros: RPC con la guarda (md5 normalizado %), % trigger en lista_espera',
    v_md5, v_trigger;
END
$comprueba$;
