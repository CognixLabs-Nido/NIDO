-- =============================================================================
-- F-2b-1 · RPC transaccional de alta sobre familia: crear_o_anadir_a_familia
-- -----------------------------------------------------------------------------
-- ADITIVA: crea UNA función nueva. NO cablea el alta (eso es F-2b-4) ni toca las
-- acciones/funciones actuales. Escribe SOLO en familia_tutores (perfil único del
-- tutor) — NO toca datos_tutor (se migra/dropea en F-2b-5/6). En UNA transacción:
-- detecta/crea familia, perfil en familia_tutores, niño con familia_id SIEMPRE,
-- matrícula pendiente y vínculo por-niño. Todo-o-nada sobre BD.
--
-- Escribir solo familia_tutores ELIMINA los NOT NULL de datos_tutor (centro_id/
-- nino_id/tipo_vinculo): familia_tutores solo exige familia_id + rol_familia.
--
-- LÍMITE de atomicidad: la cuenta GoTrue NO es SQL (regla de la casa: auth.users
-- solo por Admin API). La app crea la cuenta ANTES y pasa p_usuario_id; si la RPC
-- falla/colisiona, la app compensa borrando la cuenta. En modo Invitar p_usuario_id
-- es NULL (sin cuenta) → sin vínculo/rol (los crea accept-invitation, F-2b-4).
--
-- usuario_id NUNCA se hace UPDATE aquí (solo INSERT): el trigger de congelado de
-- F-2a bloquearía un UPDATE fuera de service_role. El backfill tecleado→cuenta es F-2b-4.
--
-- Autorización: SECURITY DEFINER + gate es_admin(p_centro_id) sobre auth.uid()
-- como PRIMERA sentencia, antes de cualquier escritura (patrón de marcar_matricula_lista).
-- Atómica (una transacción, sin commit intermedio). Advisory lock transaccional (xact):
-- se libera siempre al cerrar la transacción, incluso ante excepción.
-- Aplicar por SQL Editor (rol postgres). NO por CLI.
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.crear_o_anadir_a_familia(
  -- niño
  p_nombre_nino            text,
  p_apellidos_nino         text,
  p_fecha_nacimiento       date,
  -- centro + matrícula
  p_centro_id              uuid,
  p_aula_id                uuid,
  -- tutor (perfil del alta; dirección/DNI llegan en el wizard, F-2b-2)
  p_tutor_email            text,
  p_tutor_nombre_completo  text,
  p_parentesco             text,
  p_descripcion_parentesco text,
  p_usuario_id             uuid,   -- NULL en modo Invitar (aún sin cuenta)
  p_permisos               jsonb   -- permisosDefault(...) calculado en la app
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email_norm    text := lower(trim(p_tutor_email));
  v_nombre_norm   text := lower(trim(p_tutor_nombre_completo));
  v_curso_id      uuid;
  v_familia_id    uuid;
  v_familia_nueva boolean := false;
  v_perfil        public.familia_tutores%ROWTYPE;
  v_nino_id       uuid;
  v_matricula_id  uuid;
BEGIN
  -- 1. AUTORIZACIÓN (definer bypassa RLS → el gate es la autorización real).
  --    PRIMERA sentencia, antes de cualquier escritura.
  IF NOT public.es_admin(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado a registrar altas en este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2. Curso activo + aula del curso (validación dentro de la transacción).
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

  -- 3. LOCK transaccional: serializa altas de HERMANOS del mismo tutor+centro
  --    (no bloquea el centro entero). Se libera al COMMIT/ROLLBACK.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_centro_id::text || ':' || COALESCE(p_usuario_id::text, v_email_norm))
  );

  -- 4. DETECTAR familia: (a) por usuario_id si hay cuenta; (b) por email normalizado.
  IF p_usuario_id IS NOT NULL THEN
    SELECT ft.* INTO v_perfil
    FROM public.familia_tutores ft
    JOIN public.familias f ON f.id = ft.familia_id
    WHERE ft.usuario_id = p_usuario_id AND ft.deleted_at IS NULL
      AND f.centro_id = p_centro_id AND f.deleted_at IS NULL
    LIMIT 1;
  END IF;

  IF v_perfil.id IS NULL THEN
    SELECT ft.* INTO v_perfil
    FROM public.familia_tutores ft
    JOIN public.familias f ON f.id = ft.familia_id
    WHERE lower(trim(ft.email)) = v_email_norm AND ft.deleted_at IS NULL
      AND f.centro_id = p_centro_id AND f.deleted_at IS NULL
    LIMIT 1;
  END IF;

  -- 5. COLISIÓN: perfil hallado con NOMBRE distinto. El DNI NO se compara aquí: en el
  --    alta no hay DNI entrante (se sube en el wizard) → "si un DNI está ausente, no se
  --    usa para decidir" (decisión 4). NO escribe nada (aún no hubo INSERT); retorno
  --    controlado, no excepción.
  IF v_perfil.id IS NOT NULL THEN
    IF v_perfil.nombre_completo IS NOT NULL
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
    -- Misma persona (nombre coincide, o perfil sin nombre) → añadir hermano a su familia.
    v_familia_id := v_perfil.familia_id;
  ELSE
    -- 6. CREAR familia + perfil titular. Etiqueta = nombre+apellidos del 1er niño
    --    (apellidos puede ser NULL; se acota a 200 por el CHECK de familias.etiqueta).
    INSERT INTO public.familias (centro_id, etiqueta)
    VALUES (
      p_centro_id,
      left(NULLIF(trim(COALESCE(p_nombre_nino,'') || ' ' || COALESCE(p_apellidos_nino,'')), ''), 200)
    )
    RETURNING id INTO v_familia_id;
    v_familia_nueva := true;

    -- INSERT (no UPDATE) de usuario_id → no dispara el congelado de F-2a.
    INSERT INTO public.familia_tutores (familia_id, usuario_id, rol_familia, email, nombre_completo)
    VALUES (v_familia_id, p_usuario_id, 'titular', p_tutor_email, p_tutor_nombre_completo);
  END IF;

  -- 7. NIÑO con familia_id SIEMPRE seteado.
  INSERT INTO public.ninos (centro_id, nombre, apellidos, fecha_nacimiento, familia_id)
  VALUES (p_centro_id, p_nombre_nino, p_apellidos_nino, p_fecha_nacimiento, v_familia_id)
  RETURNING id INTO v_nino_id;

  -- 8. MATRÍCULA pendiente contra (aula, curso activo).
  INSERT INTO public.matriculas (nino_id, aula_id, curso_academico_id, estado)
  VALUES (v_nino_id, p_aula_id, v_curso_id, 'pendiente')
  RETURNING id INTO v_matricula_id;

  -- 9. VÍNCULO por-niño + ROL (solo con cuenta; acceso sin cambio respecto a hoy).
  IF p_usuario_id IS NOT NULL THEN
    INSERT INTO public.vinculos_familiares
      (nino_id, usuario_id, tipo_vinculo, parentesco, descripcion_parentesco, permisos)
    VALUES
      (v_nino_id, p_usuario_id, 'tutor_legal_principal',
       p_parentesco::public.parentesco, p_descripcion_parentesco, COALESCE(p_permisos, '{}'::jsonb))
    ON CONFLICT (nino_id, usuario_id) DO NOTHING;

    -- Rol tutor_legal (idempotente, sin depender del nombre del UNIQUE).
    INSERT INTO public.roles_usuario (usuario_id, centro_id, rol)
    SELECT p_usuario_id, p_centro_id, 'tutor_legal'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.roles_usuario
      WHERE usuario_id = p_usuario_id AND centro_id = p_centro_id
        AND rol = 'tutor_legal' AND deleted_at IS NULL
    );
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

GRANT EXECUTE ON FUNCTION public.crear_o_anadir_a_familia(
  text, text, date, uuid, uuid, text, text, text, text, uuid, jsonb
) TO authenticated;

COMMIT;
