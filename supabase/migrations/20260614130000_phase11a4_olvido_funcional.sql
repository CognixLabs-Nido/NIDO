-- =============================================================================
-- Fase 11-A4 (RGPD) — Derecho al olvido funcional (anonimización in-place)
-- =============================================================================
--
-- Spec: docs/specs/proteccion-datos.md (approved) — Comportamiento 1 + Decisiones
-- #1 (anonimización in-place, NO hard-delete: tombstone del id, PII → marcador),
-- #2 (gracia 30 días + purga inmediata a petición), #3 (vía controlada de
-- redacción de audit_log sin abrir policy UPDATE), #5 (foto compartida: se quita
-- la etiqueta; el objeto solo se borra si era exclusiva del niño), #6 (mensajes:
-- conservar contenido, redactar PII del sujeto), #7 (firmas EXCLUIDAS — retención
-- legal art. 17.3; las purga A6 por tiempo). Decisión F: NULL en columnas cifradas
-- y claras de info_medica_emergencia.
--
-- REPARTO de responsabilidades (Decisión B + C):
--   - Esta migración cubre TODO lo que vive en el schema `public` (anonimización
--     de filas + redacción de audit_log), de forma transaccional e idempotente.
--   - `auth.users` (email/teléfono) y los OBJETOS de Storage NO se tocan aquí: los
--     ejecuta la capa de app con service-role (Admin API + storage.remove), porque
--     no son SQL y no deben ir en la misma transacción (retriable). El orquestador
--     `purgarVencidos()` los hace ANTES de llamar a `purgar_sujeto_db`, que es el
--     punto de commit (fija `purgado_en`).
--
-- Modelo en dos tiempos:
--   1. solicitar_olvido_{usuario,nino}(...) → soft-delete (deleted_at) + fila en
--      olvido_solicitudes con gracia_hasta = now()+30d (o now() si inmediato).
--   2. Al vencer la gracia, purgar_sujeto_db(solicitud) anonimiza in-place y fija
--      purgado_en. olvido_pendientes() lista lo vencido para el barrido.
--
-- Marcador de PII: texto '[borrado]'; NULL en opcionales/metadatos; el id SIEMPRE
-- se conserva (integridad referencial: FKs RESTRICT a usuarios/ninos).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Registro del ejercicio del derecho (es, a su vez, la auditoría del olvido:
--    quién/cuándo/sobre quién, sin reintroducir la PII borrada). Append-ish: las
--    RPC SECURITY DEFINER son la única vía de escritura (no hay policy de write).
-- -----------------------------------------------------------------------------
CREATE TYPE public.olvido_sujeto_tipo AS ENUM ('usuario', 'nino');

CREATE TABLE public.olvido_solicitudes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sujeto_tipo    public.olvido_sujeto_tipo NOT NULL,
  sujeto_id      uuid NOT NULL,
  centro_id      uuid NOT NULL REFERENCES public.centros(id) ON DELETE CASCADE,
  solicitado_por uuid REFERENCES public.usuarios(id),   -- admin que ejerció (NULL si service-role)
  solicitado_en  timestamptz NOT NULL DEFAULT now(),
  gracia_hasta   timestamptz NOT NULL,                   -- fin del periodo de gracia
  inmediato      boolean NOT NULL DEFAULT false,         -- purga inmediata a petición del sujeto (#2)
  purgado_en     timestamptz,                            -- NULL = pendiente; ts = purga ejecutada
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT olvido_gracia_coherente CHECK (gracia_hasta >= solicitado_en),
  CONSTRAINT olvido_purgado_coherente CHECK (purgado_en IS NULL OR purgado_en >= solicitado_en)
);

-- Una sola solicitud PENDIENTE por sujeto a la vez (idempotencia de la solicitud).
CREATE UNIQUE INDEX olvido_solicitudes_sujeto_pendiente
  ON public.olvido_solicitudes (sujeto_tipo, sujeto_id)
  WHERE purgado_en IS NULL;

-- Barrido: localizar lo vencido rápido.
CREATE INDEX olvido_solicitudes_vencidas
  ON public.olvido_solicitudes (gracia_hasta)
  WHERE purgado_en IS NULL;

COMMENT ON TABLE public.olvido_solicitudes IS
  'F11-A4/RGPD: registro del ejercicio del derecho al olvido (art. 17). Es la '
  'auditoría del propio olvido. Escritura solo vía RPC SECURITY DEFINER.';

ALTER TABLE public.olvido_solicitudes ENABLE ROW LEVEL SECURITY;

-- La dirección del centro consulta el estado de sus solicitudes. Sin policy de
-- INSERT/UPDATE/DELETE: solo las RPC (owner → bypass RLS) escriben.
CREATE POLICY olvido_solicitudes_admin_select ON public.olvido_solicitudes
  FOR SELECT USING (public.es_admin(centro_id));

-- -----------------------------------------------------------------------------
-- 2. Helper de redacción de jsonb: pone cada clave presente a '[borrado]' (vía
--    controlada de #3; NO abre policy UPDATE sobre audit_log — el owner de la RPC
--    bypassa RLS). No-op sobre claves ausentes; preserva el resto de la traza.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._redactar_jsonb(j jsonb, claves text[])
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  k text;
  r jsonb := j;
BEGIN
  IF r IS NULL THEN RETURN NULL; END IF;
  FOREACH k IN ARRAY claves LOOP
    IF r ? k THEN
      r := jsonb_set(r, ARRAY[k], '"[borrado]"'::jsonb, false);
    END IF;
  END LOOP;
  RETURN r;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Solicitar el olvido de un NIÑO. Autorizado a es_admin del centro (o service).
--    Soft-delete + fila de solicitud. Idempotente sobre la solicitud pendiente.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.solicitar_olvido_nino(
  p_nino_id   uuid,
  p_inmediato boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_centro uuid;
  v_gracia timestamptz;
  v_id     uuid;
BEGIN
  SELECT centro_id INTO v_centro FROM public.ninos WHERE id = p_nino_id;
  IF v_centro IS NULL THEN
    RAISE EXCEPTION 'niño no encontrado: %', p_nino_id USING ERRCODE = 'no_data_found';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.es_admin(v_centro) THEN
    RAISE EXCEPTION 'no autorizado a ejercer el olvido en este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_gracia := CASE WHEN p_inmediato THEN now() ELSE now() + interval '30 days' END;

  UPDATE public.ninos SET deleted_at = COALESCE(deleted_at, now()) WHERE id = p_nino_id;

  INSERT INTO public.olvido_solicitudes
    (sujeto_tipo, sujeto_id, centro_id, solicitado_por, gracia_hasta, inmediato)
  VALUES ('nino', p_nino_id, v_centro, auth.uid(), v_gracia, p_inmediato)
  ON CONFLICT (sujeto_tipo, sujeto_id) WHERE purgado_en IS NULL
  DO UPDATE SET
    gracia_hasta = LEAST(public.olvido_solicitudes.gracia_hasta, EXCLUDED.gracia_hasta),
    inmediato    = public.olvido_solicitudes.inmediato OR EXCLUDED.inmediato
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.solicitar_olvido_nino(uuid, boolean)
  TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Solicitar el olvido de un USUARIO. El centro se deriva de su rol; autoriza
--    el admin de ese centro (o service). Soft-delete + fila de solicitud.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.solicitar_olvido_usuario(
  p_usuario_id uuid,
  p_inmediato  boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_centro uuid;
  v_gracia timestamptz;
  v_id     uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE id = p_usuario_id) THEN
    RAISE EXCEPTION 'usuario no encontrado: %', p_usuario_id USING ERRCODE = 'no_data_found';
  END IF;

  SELECT centro_id INTO v_centro
  FROM public.roles_usuario
  WHERE usuario_id = p_usuario_id AND deleted_at IS NULL
  ORDER BY created_at
  LIMIT 1;

  IF v_centro IS NULL THEN
    RAISE EXCEPTION 'usuario sin centro: no se puede ubicar el responsable del tratamiento'
      USING ERRCODE = 'no_data_found';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.es_admin(v_centro) THEN
    RAISE EXCEPTION 'no autorizado a ejercer el olvido en este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_gracia := CASE WHEN p_inmediato THEN now() ELSE now() + interval '30 days' END;

  UPDATE public.usuarios SET deleted_at = COALESCE(deleted_at, now()) WHERE id = p_usuario_id;

  INSERT INTO public.olvido_solicitudes
    (sujeto_tipo, sujeto_id, centro_id, solicitado_por, gracia_hasta, inmediato)
  VALUES ('usuario', p_usuario_id, v_centro, auth.uid(), v_gracia, p_inmediato)
  ON CONFLICT (sujeto_tipo, sujeto_id) WHERE purgado_en IS NULL
  DO UPDATE SET
    gracia_hasta = LEAST(public.olvido_solicitudes.gracia_hasta, EXCLUDED.gracia_hasta),
    inmediato    = public.olvido_solicitudes.inmediato OR EXCLUDED.inmediato
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.solicitar_olvido_usuario(uuid, boolean)
  TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Listar las solicitudes vencidas pendientes de purga (para el barrido). El
--    cron/RPC manual (service-role, auth.uid() NULL) las ve todas; un admin solo
--    las de su centro.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.olvido_pendientes()
RETURNS TABLE (
  solicitud_id uuid,
  sujeto_tipo  public.olvido_sujeto_tipo,
  sujeto_id    uuid,
  centro_id    uuid,
  gracia_hasta timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.sujeto_tipo, s.sujeto_id, s.centro_id, s.gracia_hasta
  FROM public.olvido_solicitudes s
  WHERE s.purgado_en IS NULL
    AND s.gracia_hasta <= now()
    AND (auth.uid() IS NULL OR public.es_admin(s.centro_id))
  ORDER BY s.gracia_hasta;
$$;

GRANT EXECUTE ON FUNCTION public.olvido_pendientes() TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Purga in-place del sujeto (parte SQL: schema public). Idempotente. Es el
--    PUNTO DE COMMIT del olvido: fija purgado_en al final. La app ya hizo Storage
--    + auth.users ANTES de llamar aquí.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purgar_sujeto_db(p_solicitud_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s        public.olvido_solicitudes%ROWTYPE;
  v_nombre text;
  -- Claves PII a redactar en el jsonb del audit (cubren las filas de varias tablas).
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

  -- Idempotencia: ya purgado → no-op.
  IF s.purgado_en IS NOT NULL THEN
    RETURN;
  END IF;

  IF s.sujeto_tipo = 'nino' THEN
    -- PII directa del niño (id conservado; fecha_nacimiento es NOT NULL → fecha centinela).
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

    -- Info médica de emergencia: cifradas + claras → NULL (Decisión F).
    UPDATE public.info_medica_emergencia SET
      alergias_graves     = NULL,
      notas_emergencia    = NULL,
      medicacion_habitual = NULL,
      alergias_leves      = NULL,
      medico_familia      = NULL,
      telefono_emergencia = NULL
    WHERE nino_id = s.sujeto_id;

    -- Datos pedagógicos: observaciones libres → NULL (alimentación 'otra' exige
    -- texto no vacío por CHECK → marcador en ese caso).
    UPDATE public.datos_pedagogicos_nino SET
      lactancia_observaciones          = NULL,
      control_esfinteres_observaciones = NULL,
      siesta_horario_habitual          = NULL,
      siesta_observaciones             = NULL,
      alimentacion_observaciones       = CASE WHEN tipo_alimentacion = 'otra'
                                              THEN '[borrado]' ELSE NULL END,
      deleted_at                       = COALESCE(deleted_at, now())
    WHERE nino_id = s.sujeto_id;

    -- Vínculos del niño: descripción libre → NULL + soft-delete del vínculo.
    UPDATE public.vinculos_familiares SET
      descripcion_parentesco = NULL,
      deleted_at             = COALESCE(deleted_at, now())
    WHERE nino_id = s.sujeto_id;

    -- Blog (#5): borrar la fila media SOLO si el niño era el ÚNICO etiquetado
    -- (cascada borra sus etiquetas). El objeto de Storage lo eliminó la app antes.
    DELETE FROM public.media m
    WHERE EXISTS (
            SELECT 1 FROM public.media_etiquetas e
            WHERE e.media_id = m.id AND e.nino_id = s.sujeto_id)
      AND NOT EXISTS (
            SELECT 1 FROM public.media_etiquetas e2
            WHERE e2.media_id = m.id AND e2.nino_id <> s.sujeto_id);
    -- En fotos compartidas (no borradas) se quita solo la asociación del niño.
    DELETE FROM public.media_etiquetas WHERE nino_id = s.sujeto_id;

    -- audit_log: redactar la PII del niño en su histórico (filas del propio niño y
    -- de tablas dependientes cuyo jsonb lo describe). #7: las firmas NO se purgan,
    -- pero su PII en el AUDIT sí se redacta (la fila probatoria firmas_autorizacion
    -- permanece intacta; solo se limpia la copia en audit_log).
    UPDATE public.audit_log SET
      valores_antes   = public._redactar_jsonb(valores_antes,   k_nino || k_med || k_extra),
      valores_despues = public._redactar_jsonb(valores_despues, k_nino || k_med || k_extra)
    WHERE registro_id = s.sujeto_id
       OR (valores_antes->>'nino_id'   = s.sujeto_id::text)
       OR (valores_despues->>'nino_id' = s.sujeto_id::text);

  ELSE  -- usuario
    SELECT nombre_completo INTO v_nombre FROM public.usuarios WHERE id = s.sujeto_id;

    -- Mensajes (#6): conservar contenido (dato del interlocutor); redactar la PII
    -- del propio sujeto best-effort (su nombre_completo). La autoría queda como
    -- tombstone vía la anonimización de `usuarios` (autor_id se conserva, FK RESTRICT).
    IF v_nombre IS NOT NULL AND length(trim(v_nombre)) > 0 THEN
      UPDATE public.mensajes
        SET contenido = replace(contenido, v_nombre, '[borrado]')
        WHERE contenido LIKE '%' || v_nombre || '%';
    END IF;

    -- usuarios: tombstone del nombre (email/teléfono viven en auth.users → app).
    UPDATE public.usuarios SET
      nombre_completo = '[borrado]',
      deleted_at      = COALESCE(deleted_at, now())
    WHERE id = s.sujeto_id;

    -- Metadatos re-identificables.
    UPDATE public.consentimientos SET ip_address = NULL, user_agent = NULL
      WHERE usuario_id = s.sujeto_id;
    DELETE FROM public.push_subscriptions WHERE usuario_id = s.sujeto_id;

    -- El usuario deja de operar.
    UPDATE public.roles_usuario SET deleted_at = COALESCE(deleted_at, now())
      WHERE usuario_id = s.sujeto_id;
    UPDATE public.vinculos_familiares SET
      descripcion_parentesco = NULL,
      deleted_at             = COALESCE(deleted_at, now())
    WHERE usuario_id = s.sujeto_id;

    -- audit_log: redactar la PII del usuario en su histórico.
    UPDATE public.audit_log SET
      valores_antes   = public._redactar_jsonb(valores_antes,   k_user || k_extra),
      valores_despues = public._redactar_jsonb(valores_despues, k_user || k_extra)
    WHERE registro_id = s.sujeto_id OR usuario_id = s.sujeto_id;
  END IF;

  -- Punto de commit del olvido.
  UPDATE public.olvido_solicitudes SET purgado_en = now() WHERE id = p_solicitud_id;
END $$;

GRANT EXECUTE ON FUNCTION public.purgar_sujeto_db(uuid) TO authenticated, service_role;

COMMIT;
