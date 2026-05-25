-- =============================================================================
-- Fase 5 — Mensajería profe ↔ familia + anuncios
-- =============================================================================
-- 1 ENUM nuevo (ambito_anuncio).
-- 5 tablas nuevas (conversaciones, mensajes, lectura_conversacion, anuncios,
-- lectura_anuncio).
-- 4 helpers SQL SECURITY DEFINER (anti-recursión RLS, ADR-0007):
--   - centro_de_conversacion(conv)        → uuid
--   - nino_de_conversacion(conv)          → uuid
--   - puede_participar_conversacion(conv) → boolean
--   - usuario_es_audiencia_anuncio(an)    → boolean
-- 2 triggers funcionales:
--   - conversaciones BEFORE INSERT: rellena centro_id automáticamente
--   - mensajes AFTER INSERT: actualiza conversaciones.last_message_at
-- Políticas RLS por tabla con default DENY.
-- audit_trigger_function() ampliada con 3 ramas (conversaciones, mensajes,
-- anuncios). lectura_* NO se auditan.
-- Realtime publication: solo mensajes y anuncios.
--
-- Spec:  docs/specs/messaging.md
-- ADRs:  0023 (modelo 5 tablas), 0024 (participantes dinámicos), 0025
--        (push diferido a F5.5).
-- Notas: el flag `puede_recibir_mensajes` (F2.6) actúa como switch global del
--        canal digital entrante — bloquea conversaciones Y anuncios para
--        tutores. Profes y admin siempre reciben todos los anuncios de su
--        ámbito.
-- =============================================================================

-- ─── 1. ENUMs ─────────────────────────────────────────────────────────────
CREATE TYPE public.ambito_anuncio AS ENUM ('aula', 'centro');

-- ─── 2. Tablas ────────────────────────────────────────────────────────────

-- 2.1 conversaciones (1 hilo por niño)
-- centro_id se rellena por trigger BEFORE INSERT a partir de nino_id.
-- last_message_at lo actualiza el trigger AFTER INSERT de mensajes
-- (SECURITY DEFINER, bypassa RLS — no necesitamos policy de UPDATE).
CREATE TABLE public.conversaciones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nino_id         uuid NOT NULL UNIQUE REFERENCES public.ninos(id) ON DELETE RESTRICT,
  centro_id       uuid NOT NULL REFERENCES public.centros(id) ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NULL
);

CREATE INDEX conversaciones_centro_last_msg_idx
  ON public.conversaciones (centro_id, last_message_at DESC NULLS LAST);

CREATE TRIGGER conversaciones_set_updated_at
  BEFORE UPDATE ON public.conversaciones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2.2 mensajes
-- CHECK length(contenido) <= 2011 = 2000 (límite Zod del input real) +
-- length('[anulado] ') = 11. Permite el marcado como erróneo sin chocar
-- contra el CHECK.
CREATE TABLE public.mensajes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversacion_id uuid NOT NULL REFERENCES public.conversaciones(id) ON DELETE CASCADE,
  autor_id        uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  contenido       text NOT NULL,
  erroneo         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mensajes_contenido_len CHECK (length(contenido) BETWEEN 1 AND 2011)
);

CREATE INDEX mensajes_conv_created_idx
  ON public.mensajes (conversacion_id, created_at DESC);

CREATE TRIGGER mensajes_set_updated_at
  BEFORE UPDATE ON public.mensajes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2.3 lectura_conversacion (read-receipt por usuario y conversación)
CREATE TABLE public.lectura_conversacion (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id      uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  conversacion_id uuid NOT NULL REFERENCES public.conversaciones(id) ON DELETE CASCADE,
  last_read_at    timestamptz NOT NULL,
  CONSTRAINT lectura_conv_usuario_conv_unique UNIQUE (usuario_id, conversacion_id)
);

CREATE INDEX lectura_conv_usuario_idx
  ON public.lectura_conversacion (usuario_id);

-- 2.4 anuncios (broadcasts unidireccionales)
-- Igual que mensajes: CHECK length deja margen de 11 chars para el prefijo
-- '[anulado] ' en el título al marcar erróneo. El contenido no se prefija;
-- el banner "anulado" se renderiza encima.
CREATE TABLE public.anuncios (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autor_id    uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  centro_id   uuid NOT NULL REFERENCES public.centros(id) ON DELETE RESTRICT,
  ambito      public.ambito_anuncio NOT NULL,
  aula_id     uuid NULL REFERENCES public.aulas(id) ON DELETE RESTRICT,
  titulo      text NOT NULL,
  contenido   text NOT NULL,
  erroneo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT anuncios_titulo_len CHECK (length(titulo) BETWEEN 1 AND 211),
  CONSTRAINT anuncios_contenido_len CHECK (length(contenido) BETWEEN 1 AND 4000),
  CONSTRAINT anuncios_aula_segun_ambito CHECK (
    (ambito = 'aula'   AND aula_id IS NOT NULL) OR
    (ambito = 'centro' AND aula_id IS NULL)
  )
);

CREATE INDEX anuncios_centro_created_idx
  ON public.anuncios (centro_id, created_at DESC);

CREATE INDEX anuncios_aula_created_idx
  ON public.anuncios (aula_id, created_at DESC)
  WHERE aula_id IS NOT NULL;

CREATE TRIGGER anuncios_set_updated_at
  BEFORE UPDATE ON public.anuncios
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2.5 lectura_anuncio (read-receipt por usuario y anuncio)
CREATE TABLE public.lectura_anuncio (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  anuncio_id  uuid NOT NULL REFERENCES public.anuncios(id) ON DELETE CASCADE,
  leido_at    timestamptz NOT NULL,
  CONSTRAINT lectura_anuncio_usuario_anuncio_unique UNIQUE (usuario_id, anuncio_id)
);

CREATE INDEX lectura_anuncio_anuncio_idx
  ON public.lectura_anuncio (anuncio_id);

-- ─── 3. Helpers SQL ───────────────────────────────────────────────────────
-- Patrón ADR-0007: lookups cruzados en helpers SECURITY DEFINER, no como
-- subqueries inline dentro de USING/WITH CHECK. Evita recursión RLS.

-- 3.1 centro_de_conversacion
CREATE OR REPLACE FUNCTION public.centro_de_conversacion(p_conversacion_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT centro_id FROM public.conversaciones WHERE id = p_conversacion_id;
$$;

GRANT EXECUTE ON FUNCTION public.centro_de_conversacion(uuid) TO authenticated;

-- 3.2 nino_de_conversacion
CREATE OR REPLACE FUNCTION public.nino_de_conversacion(p_conversacion_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT nino_id FROM public.conversaciones WHERE id = p_conversacion_id;
$$;

GRANT EXECUTE ON FUNCTION public.nino_de_conversacion(uuid) TO authenticated;

-- 3.3 puede_participar_conversacion
-- TRUE si el usuario actual es admin del centro, profe del aula actual del
-- niño, o tutor con permiso `puede_recibir_mensajes` sobre el niño.
-- Se usa tanto para SELECT como para INSERT de mensajes. Admin del centro
-- se considera "participante" a efectos de lectura/escritura (transparencia
-- operativa); el filtro de "badge no leídos" es responsabilidad del cliente.
CREATE OR REPLACE FUNCTION public.puede_participar_conversacion(p_conversacion_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversaciones c
    WHERE c.id = p_conversacion_id
      AND (
        public.es_admin(c.centro_id)
        OR public.es_profe_de_nino(c.nino_id)
        OR public.tiene_permiso_sobre(c.nino_id, 'puede_recibir_mensajes')
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.puede_participar_conversacion(uuid) TO authenticated;

-- 3.4 usuario_es_audiencia_anuncio
-- Determina si el usuario actual debe recibir un anuncio dado.
--   - Admin del centro: SIEMPRE (canal de supervisión).
--   - Autor del anuncio: SIEMPRE (defensa en profundidad).
--   - Ámbito 'aula':
--       * profe activo del aula concreta.
--       * tutor con `puede_recibir_mensajes=true` cuyo niño tiene matrícula
--         activa en esa aula.
--   - Ámbito 'centro':
--       * profe activo en cualquier aula del centro.
--       * tutor con `puede_recibir_mensajes=true` cuyo niño tiene matrícula
--         activa en cualquier aula del centro.
-- IMPORTANTE: `puede_recibir_mensajes=false` bloquea ambos ámbitos —
-- coherente con el flag global de recepción digital.
CREATE OR REPLACE FUNCTION public.usuario_es_audiencia_anuncio(p_anuncio_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.anuncios%ROWTYPE;
  v_usuario uuid := auth.uid();
BEGIN
  IF v_usuario IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO a FROM public.anuncios WHERE id = p_anuncio_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Admin del centro: siempre
  IF public.es_admin(a.centro_id) THEN
    RETURN TRUE;
  END IF;

  -- Autor del anuncio: siempre (defensa en profundidad)
  IF a.autor_id = v_usuario THEN
    RETURN TRUE;
  END IF;

  -- Ámbito 'aula'
  IF a.ambito = 'aula' THEN
    -- Profe activo del aula concreta
    IF public.es_profe_de_aula(a.aula_id) THEN
      RETURN TRUE;
    END IF;
    -- Tutor con permiso y niño matriculado activamente en esa aula
    RETURN EXISTS (
      SELECT 1
      FROM public.matriculas m
      JOIN public.vinculos_familiares vf ON vf.nino_id = m.nino_id
      WHERE m.aula_id = a.aula_id
        AND m.fecha_baja IS NULL
        AND m.deleted_at IS NULL
        AND vf.usuario_id = v_usuario
        AND vf.deleted_at IS NULL
        AND COALESCE((vf.permisos ->> 'puede_recibir_mensajes')::boolean, false) = true
    );
  END IF;

  -- Ámbito 'centro'
  IF a.ambito = 'centro' THEN
    -- Profe activo en cualquier aula del centro
    IF EXISTS (
      SELECT 1
      FROM public.profes_aulas pa
      JOIN public.aulas au ON au.id = pa.aula_id
      WHERE pa.profe_id = v_usuario
        AND pa.fecha_fin IS NULL
        AND pa.deleted_at IS NULL
        AND au.centro_id = a.centro_id
    ) THEN
      RETURN TRUE;
    END IF;
    -- Tutor con permiso y niño matriculado activamente en cualquier aula del centro
    RETURN EXISTS (
      SELECT 1
      FROM public.matriculas m
      JOIN public.aulas au ON au.id = m.aula_id
      JOIN public.vinculos_familiares vf ON vf.nino_id = m.nino_id
      WHERE au.centro_id = a.centro_id
        AND m.fecha_baja IS NULL
        AND m.deleted_at IS NULL
        AND vf.usuario_id = v_usuario
        AND vf.deleted_at IS NULL
        AND COALESCE((vf.permisos ->> 'puede_recibir_mensajes')::boolean, false) = true
    );
  END IF;

  RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.usuario_es_audiencia_anuncio(uuid) TO authenticated;

-- ─── 4. Triggers funcionales ──────────────────────────────────────────────

-- 4.1 conversaciones_set_centro_id (BEFORE INSERT)
-- Rellena centro_id automáticamente desde centro_de_nino(nino_id) si el
-- llamante no lo especifica. Permite que la creación lazy desde server
-- action sea atómica (1 INSERT + ON CONFLICT DO NOTHING).
CREATE OR REPLACE FUNCTION public.conversaciones_set_centro_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.centro_id IS NULL THEN
    NEW.centro_id := public.centro_de_nino(NEW.nino_id);
  END IF;
  IF NEW.centro_id IS NULL THEN
    RAISE EXCEPTION 'conversaciones: no se pudo derivar centro_id desde nino_id %', NEW.nino_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER conversaciones_set_centro_id_trg
  BEFORE INSERT ON public.conversaciones
  FOR EACH ROW EXECUTE FUNCTION public.conversaciones_set_centro_id();

-- 4.2 mensajes_touch_conversacion (AFTER INSERT)
-- Actualiza conversaciones.last_message_at con el created_at del mensaje
-- recién insertado, solo si es posterior al actual (evita race en
-- escrituras concurrentes que retrocedan el cursor). SECURITY DEFINER
-- bypassa la (ausencia de) policy UPDATE en conversaciones — es la
-- única forma legítima de modificar esa columna.
CREATE OR REPLACE FUNCTION public.mensajes_touch_conversacion()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.conversaciones
     SET last_message_at = NEW.created_at,
         updated_at      = now()
   WHERE id = NEW.conversacion_id
     AND (last_message_at IS NULL OR NEW.created_at > last_message_at);
  RETURN NULL;
END;
$$;

CREATE TRIGGER mensajes_touch_conversacion_trg
  AFTER INSERT ON public.mensajes
  FOR EACH ROW EXECUTE FUNCTION public.mensajes_touch_conversacion();

-- ─── 5. RLS: conversaciones ───────────────────────────────────────────────
-- SELECT: participantes + admin del centro (ambos resueltos por
--         puede_participar_conversacion).
-- INSERT: cualquier participante. centro_id lo rellena el trigger BEFORE.
-- UPDATE: SIN policy → default DENY. El trigger AFTER INSERT mensajes hace
--         su UPDATE como SECURITY DEFINER y bypassa RLS. Esto impide que
--         un usuario renombre centro_id / nino_id de una conversación.
-- DELETE: SIN policy → default DENY.
ALTER TABLE public.conversaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversaciones_select ON public.conversaciones
  FOR SELECT
  USING (
    public.es_admin(centro_id)
    OR public.es_profe_de_nino(nino_id)
    OR public.tiene_permiso_sobre(nino_id, 'puede_recibir_mensajes')
  );

CREATE POLICY conversaciones_insert ON public.conversaciones
  FOR INSERT
  WITH CHECK (
    public.es_admin(public.centro_de_nino(nino_id))
    OR public.es_profe_de_nino(nino_id)
    OR public.tiene_permiso_sobre(nino_id, 'puede_recibir_mensajes')
  );

-- ─── 6. RLS: mensajes ─────────────────────────────────────────────────────
-- SELECT: participantes (via puede_participar_conversacion).
-- INSERT: participantes Y autor_id = auth.uid() (anti-suplantación).
-- UPDATE: solo el autor. El server action enforza que la única mutación
--         válida es marcar como erróneo (UPDATE de `erroneo` + prefijo en
--         `contenido`). La RLS no inspecciona qué columnas cambian — la
--         lógica de negocio vive en el server action.
-- DELETE: SIN policy → default DENY.
ALTER TABLE public.mensajes ENABLE ROW LEVEL SECURITY;

CREATE POLICY mensajes_select ON public.mensajes
  FOR SELECT
  USING (public.puede_participar_conversacion(conversacion_id));

CREATE POLICY mensajes_insert ON public.mensajes
  FOR INSERT
  WITH CHECK (
    public.puede_participar_conversacion(conversacion_id)
    AND autor_id = auth.uid()
  );

CREATE POLICY mensajes_update_autor ON public.mensajes
  FOR UPDATE
  USING (autor_id = auth.uid())
  WITH CHECK (autor_id = auth.uid());

-- ─── 7. RLS: lectura_conversacion ─────────────────────────────────────────
-- Telemetría de usuario. El propio usuario gestiona su marcador.
-- DELETE: SIN policy → default DENY (read-receipts no se borran).
ALTER TABLE public.lectura_conversacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY lectura_conv_select_self ON public.lectura_conversacion
  FOR SELECT
  USING (usuario_id = auth.uid());

CREATE POLICY lectura_conv_insert_self ON public.lectura_conversacion
  FOR INSERT
  WITH CHECK (
    usuario_id = auth.uid()
    AND public.puede_participar_conversacion(conversacion_id)
  );

CREATE POLICY lectura_conv_update_self ON public.lectura_conversacion
  FOR UPDATE
  USING (usuario_id = auth.uid())
  WITH CHECK (usuario_id = auth.uid());

-- ─── 8. RLS: anuncios ─────────────────────────────────────────────────────
-- SELECT: audiencia (via usuario_es_audiencia_anuncio).
-- INSERT: autor_id = auth.uid() Y (
--           admin del centro (cualquier ámbito) O
--           profe activo del aula (solo ámbito='aula' con su aula y mismo centro)
--         ).
-- UPDATE: solo el autor (server action lo limita a marcar erróneo).
-- DELETE: SIN policy → default DENY.
ALTER TABLE public.anuncios ENABLE ROW LEVEL SECURITY;

CREATE POLICY anuncios_select ON public.anuncios
  FOR SELECT
  USING (public.usuario_es_audiencia_anuncio(id));

CREATE POLICY anuncios_insert ON public.anuncios
  FOR INSERT
  WITH CHECK (
    autor_id = auth.uid()
    AND (
      public.es_admin(centro_id)
      OR (
        ambito = 'aula'
        AND aula_id IS NOT NULL
        AND public.es_profe_de_aula(aula_id)
        AND public.centro_de_aula(aula_id) = centro_id
      )
    )
  );

CREATE POLICY anuncios_update_autor ON public.anuncios
  FOR UPDATE
  USING (autor_id = auth.uid())
  WITH CHECK (autor_id = auth.uid());

-- ─── 9. RLS: lectura_anuncio ──────────────────────────────────────────────
-- INSERT solo del propio usuario y solo si es audiencia del anuncio.
-- Sin UPDATE ni DELETE (read-receipt es append-only).
ALTER TABLE public.lectura_anuncio ENABLE ROW LEVEL SECURITY;

CREATE POLICY lectura_anuncio_select_self ON public.lectura_anuncio
  FOR SELECT
  USING (usuario_id = auth.uid());

CREATE POLICY lectura_anuncio_insert_self ON public.lectura_anuncio
  FOR INSERT
  WITH CHECK (
    usuario_id = auth.uid()
    AND public.usuario_es_audiencia_anuncio(anuncio_id)
  );

-- ─── 10. audit_trigger_function ampliada ──────────────────────────────────
-- Añade 3 ramas: conversaciones (centro_id directo), mensajes (vía
-- centro_de_conversacion), anuncios (centro_id directo). lectura_* NO
-- se auditan — son telemetría de usuario, no contenido.
-- CREATE OR REPLACE preserva todas las ramas previas (Fases 2, 2.6, 3,
-- 4, 4.5a, 4.5b).
CREATE OR REPLACE FUNCTION public.audit_trigger_function()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_centro_id uuid;
  v_antes jsonb;
  v_despues jsonb;
  v_registro_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'centros' THEN
    v_centro_id := COALESCE((NEW).id, (OLD).id);
  ELSIF TG_TABLE_NAME = 'ninos' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'roles_usuario' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'dias_centro' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'plantillas_menu_mensual' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'menu_dia' THEN
    v_centro_id := public.centro_de_plantilla(COALESCE((NEW).plantilla_id, (OLD).plantilla_id));
  ELSIF TG_TABLE_NAME = 'conversaciones' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'mensajes' THEN
    v_centro_id := public.centro_de_conversacion(COALESCE((NEW).conversacion_id, (OLD).conversacion_id));
  ELSIF TG_TABLE_NAME = 'anuncios' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME IN (
    'info_medica_emergencia',
    'vinculos_familiares',
    'matriculas',
    'datos_pedagogicos_nino',
    'asistencias',
    'ausencias'
  ) THEN
    SELECT n.centro_id INTO v_centro_id
    FROM public.ninos n
    WHERE n.id = COALESCE((NEW).nino_id, (OLD).nino_id);
  ELSIF TG_TABLE_NAME = 'agendas_diarias' THEN
    v_centro_id := public.centro_de_nino(COALESCE((NEW).nino_id, (OLD).nino_id));
  ELSIF TG_TABLE_NAME IN ('comidas', 'biberones', 'suenos', 'deposiciones') THEN
    v_centro_id := public.centro_de_agenda(COALESCE((NEW).agenda_id, (OLD).agenda_id));
  END IF;

  v_antes   := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END;
  v_despues := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END;
  v_registro_id := COALESCE((NEW).id, (OLD).id);

  INSERT INTO public.audit_log
    (tabla, registro_id, accion, usuario_id, valores_antes, valores_despues, centro_id)
  VALUES
    (TG_TABLE_NAME, v_registro_id, TG_OP::public.audit_accion, auth.uid(), v_antes, v_despues, v_centro_id);

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ─── 11. Triggers de audit en las 3 tablas auditadas ──────────────────────
-- lectura_conversacion y lectura_anuncio NO se auditan: telemetría de
-- usuario, no contenido (decisión explícita en la spec § "Audit log").
CREATE TRIGGER audit_conversaciones
  AFTER INSERT OR UPDATE OR DELETE ON public.conversaciones
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

CREATE TRIGGER audit_mensajes
  AFTER INSERT OR UPDATE OR DELETE ON public.mensajes
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

CREATE TRIGGER audit_anuncios
  AFTER INSERT OR UPDATE OR DELETE ON public.anuncios
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

-- ─── 12. Realtime publication ─────────────────────────────────────────────
-- Solo mensajes y anuncios. conversaciones (last_message_at) y lectura_*
-- se infieren client-side desde los cambios de mensajes/anuncios. Las RLS
-- de SELECT se aplican también a las notificaciones Realtime — los
-- clientes solo reciben eventos sobre filas que su rol puede leer.
ALTER PUBLICATION supabase_realtime ADD TABLE
  public.mensajes,
  public.anuncios;
