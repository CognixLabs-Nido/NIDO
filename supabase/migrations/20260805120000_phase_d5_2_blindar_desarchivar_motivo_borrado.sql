-- =============================================================================
-- D-5 (punto 2) · Blindar desarchivar/reactivación: motivo del soft-delete
-- -----------------------------------------------------------------------------
-- PROBLEMA: desarchivar_nino (F-3-F) y la rama de familia archivada de
-- crear_o_anadir_a_familia (F-2b-4-1) reviven TODO lo soft-borrado del niño/familia
-- (vínculos + rol tutor_legal + familia) asumiendo que la BAJA es la ÚNICA fuente de
-- esos soft-deletes. Ya NO es cierto: la purga RGPD (purgar_sujeto_db, F-11-A-4)
-- también soft-borra vínculos y roles → hoy desarchivar resucitaría datos de un
-- sujeto anonimizado. Bug PRESENTE, no futuro.
--
-- SOLUCIÓN (opción a): columna `deleted_reason` (ENUM `motivo_borrado`) que cada
-- primitivo de borrado RELLENA y desarchivar/reactivación FILTRAN. Solo se revive lo
-- que borró una baja ('baja_nino' vínculos, 'revocacion_familia' rol/familia). La
-- purga marca 'purga_rgpd' → jamás revivible. Cualquier motivo futuro tampoco lo será.
--
-- Se añade a `vinculos_familiares`, `roles_usuario` Y `familias` (sin esta última el
-- blindaje no sería completo: desarchivar reactiva la familia incondicionalmente).
--
-- CHECK de coherencia `(deleted_at IS NULL) = (deleted_reason IS NULL)` en las 3
-- tablas: red de seguridad para writers futuros que olviden estampar motivo (se
-- verificó por grep que los 3 únicos writers de deleted_at —archivar_nino, revocar_
-- acceso_familia, purgar_sujeto_db— quedan cubiertos aquí; los que ponen deleted_at a
-- NULL —desarchivar_nino, crear_o_anadir_a_familia— también ponen deleted_reason NULL).
--
-- DEUDA CONOCIDA (fuera de scope, no se resuelve aquí): roles_usuario es una fila por
-- (usuario, centro, rol); si un adulto es tutor de DOS familias del mismo centro, el
-- rol tutor_legal es UNA fila compartida y `deleted_reason` sobre ella es ambiguo (una
-- revocación por-familia lo marca aunque la otra familia siga activa). Es un borde
-- PREEXISTENTE de la revocación por-familia sobre un rol por-centro; la columna de
-- motivo no lo resuelve del todo. Registrado como deuda, no abordado en D-5.
--
-- Funciones tocadas (5, CREATE OR REPLACE): archivar_nino, revocar_acceso_familia,
-- desarchivar_nino, crear_o_anadir_a_familia, purgar_sujeto_db.
--
-- Backfill: 0 datos reales (piloto no arrancado; la purga no ha corrido en prod). Se
-- etiqueta lo ya soft-borrado como su fuente esperada (vínculos→baja; rol tutor_legal→
-- revocación; rol no-tutor→purga; familia→revocación) para PRESERVAR el comportamiento
-- actual (los archivados hoy siguen siendo reincorporables).
--
-- Aplicar por SQL Editor / db push (rol postgres). Regenerar database.ts DESPUÉS.
-- =============================================================================
BEGIN;

-- -----------------------------------------------------------------------------
-- 1. ENUM + columnas.
-- -----------------------------------------------------------------------------
CREATE TYPE public.motivo_borrado AS ENUM ('baja_nino', 'revocacion_familia', 'purga_rgpd');

ALTER TABLE public.vinculos_familiares ADD COLUMN deleted_reason public.motivo_borrado;
ALTER TABLE public.roles_usuario       ADD COLUMN deleted_reason public.motivo_borrado;
ALTER TABLE public.familias            ADD COLUMN deleted_reason public.motivo_borrado;

COMMENT ON COLUMN public.vinculos_familiares.deleted_reason IS
  'D-5: motivo del soft-delete. desarchivar_nino solo revive los ''baja_nino''. NULL sii deleted_at NULL.';
COMMENT ON COLUMN public.roles_usuario.deleted_reason IS
  'D-5: motivo del soft-delete. desarchivar/reactivación solo reviven los ''revocacion_familia''. NULL sii deleted_at NULL.';
COMMENT ON COLUMN public.familias.deleted_reason IS
  'D-5: motivo del soft-delete. desarchivar/reactivación solo reactivan las ''revocacion_familia''. NULL sii deleted_at NULL.';

-- -----------------------------------------------------------------------------
-- 2. BACKFILL (antes del CHECK). 0 datos reales; preserva comportamiento actual.
-- -----------------------------------------------------------------------------
UPDATE public.vinculos_familiares SET deleted_reason = 'baja_nino'
  WHERE deleted_at IS NOT NULL AND deleted_reason IS NULL;
UPDATE public.roles_usuario SET deleted_reason = 'revocacion_familia'
  WHERE deleted_at IS NOT NULL AND deleted_reason IS NULL AND rol = 'tutor_legal';
UPDATE public.roles_usuario SET deleted_reason = 'purga_rgpd'
  WHERE deleted_at IS NOT NULL AND deleted_reason IS NULL;  -- resto (no tutor) = purga
UPDATE public.familias SET deleted_reason = 'revocacion_familia'
  WHERE deleted_at IS NOT NULL AND deleted_reason IS NULL;

-- -----------------------------------------------------------------------------
-- 3. CHECK de coherencia (red de seguridad ante writers futuros sin motivo).
-- -----------------------------------------------------------------------------
ALTER TABLE public.vinculos_familiares
  ADD CONSTRAINT vinculos_familiares_deleted_reason_coherente
  CHECK ((deleted_at IS NULL) = (deleted_reason IS NULL));
ALTER TABLE public.roles_usuario
  ADD CONSTRAINT roles_usuario_deleted_reason_coherente
  CHECK ((deleted_at IS NULL) = (deleted_reason IS NULL));
ALTER TABLE public.familias
  ADD CONSTRAINT familias_deleted_reason_coherente
  CHECK ((deleted_at IS NULL) = (deleted_reason IS NULL));

-- -----------------------------------------------------------------------------
-- 4. archivar_nino — estampa 'baja_nino' al soft-borrar los vínculos del niño.
--    (Resto IDÉNTICO a 20260717120000.)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.archivar_nino(
  p_nino_id    uuid,
  p_motivo     text DEFAULT NULL,
  p_fecha_baja date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_centro_id    uuid;
  v_ya_archivado boolean;
  v_matriculas   integer := 0;
  v_vinculos     integer := 0;
BEGIN
  SELECT centro_id, (deleted_at IS NOT NULL)
    INTO v_centro_id, v_ya_archivado
    FROM public.ninos
    WHERE id = p_nino_id;
  IF v_centro_id IS NULL THEN
    RAISE EXCEPTION 'nino % no existe', p_nino_id USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT (public.es_admin(v_centro_id) OR (SELECT auth.role()) = 'service_role') THEN
    RAISE EXCEPTION 'no autorizado a archivar este nino';
  END IF;

  IF v_ya_archivado THEN
    RETURN jsonb_build_object(
      'nino_id', p_nino_id, 'ya_archivado', true,
      'matriculas_cerradas', 0, 'vinculos_borrados', 0
    );
  END IF;

  WITH cerradas AS (
    UPDATE public.matriculas
       SET estado = 'baja', fecha_baja = p_fecha_baja, motivo_baja = p_motivo
     WHERE nino_id = p_nino_id
       AND fecha_baja IS NULL
       AND deleted_at IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_matriculas FROM cerradas;

  -- D-5: se estampa el motivo del soft-delete → desarchivar sabrá que fue la baja.
  WITH borrados AS (
    UPDATE public.vinculos_familiares
       SET deleted_at = now(), deleted_reason = 'baja_nino'
     WHERE nino_id = p_nino_id
       AND deleted_at IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_vinculos FROM borrados;

  UPDATE public.ninos SET deleted_at = now() WHERE id = p_nino_id;

  RETURN jsonb_build_object(
    'nino_id', p_nino_id, 'ya_archivado', false,
    'matriculas_cerradas', v_matriculas, 'vinculos_borrados', v_vinculos
  );
END $$;

-- -----------------------------------------------------------------------------
-- 5. revocar_acceso_familia — estampa 'revocacion_familia' en el rol y la familia.
--    (Resto IDÉNTICO a 20260721120000, guard por ninos.familia_id.)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revocar_acceso_familia(p_familia_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_centro_id   uuid;
  v_ya_inactiva boolean;
  v_roles       integer := 0;
BEGIN
  SELECT centro_id, (deleted_at IS NOT NULL)
    INTO v_centro_id, v_ya_inactiva
    FROM public.familias
    WHERE id = p_familia_id;
  IF v_centro_id IS NULL THEN
    RAISE EXCEPTION 'familia % no existe', p_familia_id USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT (public.es_admin(v_centro_id) OR (SELECT auth.role()) = 'service_role') THEN
    RAISE EXCEPTION 'no autorizado a revocar el acceso de esta familia';
  END IF;

  IF v_ya_inactiva THEN
    RETURN jsonb_build_object(
      'familia_id', p_familia_id, 'revocado', false,
      'ya_inactiva', true, 'motivo', 'ya_inactiva', 'roles_revocados', 0
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ninos n
    WHERE n.familia_id = p_familia_id
      AND n.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object(
      'familia_id', p_familia_id, 'revocado', false,
      'ya_inactiva', false, 'motivo', 'tiene_ninos_activos', 'roles_revocados', 0
    );
  END IF;

  -- D-5: motivo del soft-delete del rol → desarchivar/reactivación lo reconocen como baja.
  WITH revocados AS (
    UPDATE public.roles_usuario ru
       SET deleted_at = now(), deleted_reason = 'revocacion_familia'
     WHERE ru.centro_id = v_centro_id
       AND ru.rol = 'tutor_legal'
       AND ru.deleted_at IS NULL
       AND ru.usuario_id IN (
         SELECT ft.usuario_id
           FROM public.familia_tutores ft
          WHERE ft.familia_id = p_familia_id
            AND ft.usuario_id IS NOT NULL
            AND ft.deleted_at IS NULL
       )
    RETURNING 1
  )
  SELECT count(*) INTO v_roles FROM revocados;

  -- D-5: motivo del soft-delete de la familia.
  UPDATE public.familias
     SET deleted_at = now(), deleted_reason = 'revocacion_familia'
   WHERE id = p_familia_id;

  RETURN jsonb_build_object(
    'familia_id', p_familia_id, 'revocado', true,
    'ya_inactiva', false, 'roles_revocados', v_roles
  );
END $$;

-- -----------------------------------------------------------------------------
-- 6. desarchivar_nino — solo revive lo marcado como baja; al revivir limpia el motivo.
--    (Resto IDÉNTICO a 20260722120000.)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.desarchivar_nino(p_nino_id uuid, p_aula_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_centro_id     uuid;
  v_familia_id    uuid;
  v_archivado     boolean;
  v_curso_id      uuid;
  v_familia_react boolean := false;
  v_roles         integer := 0;
  v_matricula_id  uuid;
BEGIN
  SELECT centro_id, familia_id, (deleted_at IS NOT NULL)
    INTO v_centro_id, v_familia_id, v_archivado
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

  -- 5a. Desarchiva el niño (el sujeto explícito → siempre).
  UPDATE public.ninos SET deleted_at = NULL WHERE id = p_nino_id;

  -- 5b. D-5: revive SOLO los vínculos que borró la BAJA ('baja_nino'), no los de una
  --     purga RGPD u otra vía. Al revivir, limpia el motivo (coherencia con el CHECK).
  UPDATE public.vinculos_familiares
     SET deleted_at = NULL, deleted_reason = NULL
   WHERE nino_id = p_nino_id
     AND deleted_at IS NOT NULL
     AND deleted_reason = 'baja_nino';

  -- 5c. D-5: reactiva la familia SOLO si la archivó una revocación de baja.
  UPDATE public.familias
     SET deleted_at = NULL, deleted_reason = NULL
   WHERE id = v_familia_id
     AND deleted_at IS NOT NULL
     AND deleted_reason = 'revocacion_familia';
  v_familia_react := FOUND;

  -- 5d. D-5: reactiva el rol tutor_legal SOLO de los revocados por baja ('revocacion_familia').
  WITH react AS (
    UPDATE public.roles_usuario ru
       SET deleted_at = NULL, deleted_reason = NULL
     WHERE ru.centro_id = v_centro_id
       AND ru.rol = 'tutor_legal'
       AND ru.deleted_at IS NOT NULL
       AND ru.deleted_reason = 'revocacion_familia'
       AND ru.usuario_id IN (
         SELECT ft.usuario_id
           FROM public.familia_tutores ft
          WHERE ft.familia_id = v_familia_id
            AND ft.usuario_id IS NOT NULL
            AND ft.deleted_at IS NULL
       )
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
END $$;

-- -----------------------------------------------------------------------------
-- 7. crear_o_anadir_a_familia — la rama de reactivación respeta el mismo filtro de
--    motivo (solo revive lo de baja) y limpia el motivo al revivir.
--    (Resto IDÉNTICO a 20260723120000.)
-- -----------------------------------------------------------------------------
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
      (v_nino_id, p_usuario_id, 'tutor_legal_principal',
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

  RETURN jsonb_build_object(
    'resultado',    CASE WHEN v_familia_nueva THEN 'familia_creada' ELSE 'nino_anadido' END,
    'familia_id',   v_familia_id,
    'nino_id',      v_nino_id,
    'matricula_id', v_matricula_id,
    'colision_info', NULL
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. purgar_sujeto_db — estampa 'purga_rgpd' en los soft-deletes de vínculos y roles,
--    para que desarchivar NUNCA los reviva. (Resto IDÉNTICO a 20260614130000.)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purgar_sujeto_db(p_solicitud_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s        public.olvido_solicitudes%ROWTYPE;
  v_nombre text;
  k_nino  text[] := ARRAY['nombre','apellidos','fecha_nacimiento','sexo','nacionalidad',
                          'foto_url','notas_admin'];
  k_med   text[] := ARRAY['alergias_graves','notas_emergencia','medicacion_habitual',
                          'alergias_leves','medico_familia','telefono_emergencia'];
  k_user  text[] := ARRAY['nombre_completo'];
  k_extra text[] := ARRAY['ip_address','user_agent','descripcion_parentesco',
                          'nombre_externo','observaciones','observaciones_generales',
                          'contenido','nombre_tecleado'];
BEGIN
  SELECT * INTO s FROM public.olvido_solicitudes WHERE id = p_solicitud_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'solicitud de olvido no encontrada: %', p_solicitud_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.es_admin(s.centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF s.purgado_en IS NOT NULL THEN
    RETURN;
  END IF;

  IF s.sujeto_tipo = 'nino' THEN
    UPDATE public.ninos SET
      nombre           = '[borrado]',
      apellidos        = '[borrado]',
      fecha_nacimiento = DATE '1900-01-01',
      sexo             = NULL,
      nacionalidad     = NULL,
      foto_url         = NULL,
      notas_admin      = NULL,
      deleted_at       = COALESCE(deleted_at, now())
    WHERE id = s.sujeto_id;

    UPDATE public.info_medica_emergencia SET
      alergias_graves     = NULL,
      notas_emergencia    = NULL,
      medicacion_habitual = NULL,
      alergias_leves      = NULL,
      medico_familia      = NULL,
      telefono_emergencia = NULL
    WHERE nino_id = s.sujeto_id;

    UPDATE public.datos_pedagogicos_nino SET
      lactancia_observaciones          = NULL,
      control_esfinteres_observaciones = NULL,
      siesta_horario_habitual          = NULL,
      siesta_observaciones             = NULL,
      alimentacion_observaciones       = CASE WHEN tipo_alimentacion = 'otra'
                                              THEN '[borrado]' ELSE NULL END,
      deleted_at                       = COALESCE(deleted_at, now())
    WHERE nino_id = s.sujeto_id;

    -- D-5: motivo 'purga_rgpd' → desarchivar_nino NUNCA revive un vínculo purgado.
    UPDATE public.vinculos_familiares SET
      descripcion_parentesco = NULL,
      deleted_reason         = 'purga_rgpd',
      deleted_at             = COALESCE(deleted_at, now())
    WHERE nino_id = s.sujeto_id;

    DELETE FROM public.media m
    WHERE EXISTS (
            SELECT 1 FROM public.media_etiquetas e
            WHERE e.media_id = m.id AND e.nino_id = s.sujeto_id)
      AND NOT EXISTS (
            SELECT 1 FROM public.media_etiquetas e2
            WHERE e2.media_id = m.id AND e2.nino_id <> s.sujeto_id);
    DELETE FROM public.media_etiquetas WHERE nino_id = s.sujeto_id;

    UPDATE public.audit_log SET
      valores_antes   = public._redactar_jsonb(valores_antes,   k_nino || k_med || k_extra),
      valores_despues = public._redactar_jsonb(valores_despues, k_nino || k_med || k_extra)
    WHERE registro_id = s.sujeto_id
       OR (valores_antes->>'nino_id'   = s.sujeto_id::text)
       OR (valores_despues->>'nino_id' = s.sujeto_id::text);

  ELSE  -- usuario
    SELECT nombre_completo INTO v_nombre FROM public.usuarios WHERE id = s.sujeto_id;

    IF v_nombre IS NOT NULL AND length(trim(v_nombre)) > 0 THEN
      UPDATE public.mensajes
        SET contenido = replace(contenido, v_nombre, '[borrado]')
        WHERE contenido LIKE '%' || v_nombre || '%';
    END IF;

    UPDATE public.usuarios SET
      nombre_completo = '[borrado]',
      deleted_at      = COALESCE(deleted_at, now())
    WHERE id = s.sujeto_id;

    UPDATE public.consentimientos SET ip_address = NULL, user_agent = NULL
      WHERE usuario_id = s.sujeto_id;
    DELETE FROM public.push_subscriptions WHERE usuario_id = s.sujeto_id;

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
    WHERE registro_id = s.sujeto_id OR usuario_id = s.sujeto_id;
  END IF;

  UPDATE public.olvido_solicitudes SET purgado_en = now() WHERE id = p_solicitud_id;
END $$;

COMMIT;
