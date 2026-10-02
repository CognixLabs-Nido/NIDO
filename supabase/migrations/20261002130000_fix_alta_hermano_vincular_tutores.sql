-- =============================================================================
-- Alta del 2.º hijo (hermano) — crear_o_anadir_a_familia
-- =============================================================================
-- CREATE OR REPLACE sobre la definición viva (= 20260805120000_phase_d5_2, verificada contra el
-- remoto). Tres cambios marcados [ALTA-HERMANO Cn]; el resto, verbatim:
--   C1  sin nombre con el que comparar (Invitar), no hay colisión por nombre.
--   C2  el tutor que recibe la RPC queda con el tipo de su papel en la familia.
--   C3  hermano en familia existente → vincula también a los demás tutores con cuenta.
-- La detección de familia NO cambia: primero por usuario_id, después por email (el fallback lo
-- necesitan Invitar y Completar en Dirección cuando la cuenta del tutor es un stub).
--
-- Primer hijo y familia nueva: sin efecto (C3 no corre; C2 da principal como hoy). El ACL no
-- cambia (CREATE OR REPLACE conserva el de d5_2). Ensayado contra el remoto con ROLLBACK.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor (CLI SIGILL
-- en ARM). Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

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

