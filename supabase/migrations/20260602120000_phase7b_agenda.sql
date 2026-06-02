-- =============================================================================
-- Fase 7b — Agenda (citas con invitados nominales y RSVP) — LEAN
-- =============================================================================
-- ADITIVA: las tablas `citas`, `cita_invitados` y `preferencias_usuario` NO
-- existen → solo CREATE. NUNCA drop+recreate. Spec: docs/specs/agenda-citas.md
-- (decisiones AG-* cerradas 2026-06-02). Modelo NUEVO, separado de `eventos`
-- (F7 = difusión; Agenda = invitación nominal). Patrones reusados de F5/F7.
--
-- 3 ENUMs:
--   tipo_cita   = reunion_familia | reunion_clase | reunion_claustro | visita
--   cita_estado = programada | cancelada (cancelar = UPDATE, no DELETE)
--   rsvp_estado = pendiente | aceptado | rechazado
--                 (pendiente = default de la fila; el invitado existe siempre,
--                  a diferencia de confirmaciones_evento donde pendiente=sin fila)
--
-- 4 helpers SQL nuevos (STABLE/SECURITY DEFINER, search_path=public):
--   usuario_es_audiencia_cita_row(centro_id, organizador_id, cita_id)
--     → ROW-AWARE (recibe los campos de `citas`, NO re-lee `citas`): evita el
--       gotcha MVCC en `INSERT…RETURNING` (crearCita hace .insert().select()).
--       La rama "soy invitado" consulta `cita_invitados` (OTRA tabla) → sin MVCC.
--   usuario_es_invitado_cita(cita_id)  → ¿auth.uid() es invitado interno?
--   organizador_de_cita(cita_id)       → uuid (lee `citas`; usado en RLS de
--                                        cita_invitados, que NO re-lee invitados).
--   centro_de_cita(cita_id)            → uuid (red de seguridad del centro_id).
-- Reutiliza: es_admin, es_profe_de_nino, es_profe_de_aula, centro_de_nino,
--   centro_de_aula.
--
-- audit_trigger_function ampliada con 2 ramas: `citas` y `cita_invitados`
--   (ambas centro_id directo). cita_invitados se audita como REGISTRO
--   ADMINISTRATIVO (quién/cuándo del RSVP), NO autorización legal (eso es F8).
--   preferencias_usuario NO se audita (preferencia, como lectura_*).
-- Sin Realtime (AG-13). centro_id derivado explícito en el server action; los
--   triggers BEFORE INSERT son red de seguridad.
-- =============================================================================
BEGIN;

-- ─── 1. ENUMs ────────────────────────────────────────────────────────────────
CREATE TYPE public.tipo_cita   AS ENUM ('reunion_familia', 'reunion_clase', 'reunion_claustro', 'visita');
CREATE TYPE public.cita_estado AS ENUM ('programada', 'cancelada');
CREATE TYPE public.rsvp_estado AS ENUM ('pendiente', 'aceptado', 'rechazado');

-- ─── 2. Tabla citas ──────────────────────────────────────────────────────────
CREATE TABLE public.citas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id       uuid NOT NULL REFERENCES public.centros(id)  ON DELETE CASCADE,
  tipo            public.tipo_cita NOT NULL,
  organizador_id  uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  titulo          text NOT NULL,
  descripcion     text,
  lugar           text,
  fecha           date NOT NULL,
  hora_inicio     time NOT NULL,
  hora_fin        time,
  aula_id         uuid REFERENCES public.aulas(id)             ON DELETE CASCADE,
  nino_id         uuid REFERENCES public.ninos(id)             ON DELETE CASCADE,
  estado          public.cita_estado NOT NULL DEFAULT 'programada',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- Coherencia tipo ↔ referencia (espejo de eventos_ambito_coherencia).
  CONSTRAINT citas_tipo_coherencia CHECK (
       (tipo = 'reunion_familia'  AND nino_id IS NOT NULL AND aula_id IS NULL)
    OR (tipo = 'reunion_clase'    AND aula_id IS NOT NULL AND nino_id IS NULL)
    OR (tipo = 'reunion_claustro' AND aula_id IS NULL     AND nino_id IS NULL)
    OR (tipo = 'visita'           AND aula_id IS NULL     AND nino_id IS NULL)
  ),
  CONSTRAINT citas_titulo_len      CHECK (char_length(titulo) BETWEEN 1 AND 200),
  CONSTRAINT citas_descripcion_len CHECK (descripcion IS NULL OR char_length(descripcion) <= 2000),
  CONSTRAINT citas_lugar_len       CHECK (lugar IS NULL OR char_length(lugar) <= 200),
  CONSTRAINT citas_hora_coherencia CHECK (hora_fin IS NULL OR hora_fin > hora_inicio)
);

COMMENT ON TABLE public.citas IS
  'Citas de la Agenda (F7b LEAN): invitación nominal + RSVP. admin organiza cualquier tipo; profe solo reunion_familia/reunion_clase. Separada de eventos (difusión). Ver docs/specs/agenda-citas.md.';

CREATE INDEX idx_citas_centro_fecha ON public.citas (centro_id, fecha);
CREATE INDEX idx_citas_organizador  ON public.citas (organizador_id);

-- ─── 3. Tabla cita_invitados ─────────────────────────────────────────────────
-- Una fila por invitado: interno (usuario_id) O externo-texto (nombre_externo).
-- estado RSVP con default 'pendiente' (la fila SIEMPRE existe). respondido_por/
-- respondido_at = quién/cuándo fijó el estado (el invitado interno, o el
-- organizador para el externo). AG-12: registro administrativo, no legal.
CREATE TABLE public.cita_invitados (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cita_id         uuid NOT NULL REFERENCES public.citas(id)    ON DELETE CASCADE,
  centro_id       uuid NOT NULL REFERENCES public.centros(id)  ON DELETE CASCADE,
  usuario_id      uuid REFERENCES public.usuarios(id)          ON DELETE CASCADE,
  nombre_externo  text,
  estado          public.rsvp_estado NOT NULL DEFAULT 'pendiente',
  respondido_at   timestamptz,
  respondido_por  uuid REFERENCES public.usuarios(id)          ON DELETE SET NULL,
  comentario      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- Exactamente uno: invitado interno O externo-texto.
  CONSTRAINT cita_invitados_persona_coherencia CHECK (
       (usuario_id IS NOT NULL AND nombre_externo IS NULL)
    OR (usuario_id IS NULL     AND nombre_externo IS NOT NULL)
  ),
  CONSTRAINT cita_invitados_nombre_externo_len CHECK (nombre_externo IS NULL OR char_length(nombre_externo) BETWEEN 1 AND 200),
  CONSTRAINT cita_invitados_comentario_len     CHECK (comentario IS NULL OR char_length(comentario) <= 500)
);

COMMENT ON TABLE public.cita_invitados IS
  'Invitados nominales de una cita + RSVP (F7b). Interno o externo-texto. Se audita como registro administrativo (quién/cuándo), NO autorización legal (F8).';

-- No duplicar un mismo invitado interno en la misma cita.
CREATE UNIQUE INDEX uq_cita_invitados_interno ON public.cita_invitados (cita_id, usuario_id) WHERE usuario_id IS NOT NULL;
CREATE INDEX idx_cita_invitados_cita    ON public.cita_invitados (cita_id);
CREATE INDEX idx_cita_invitados_usuario ON public.cita_invitados (usuario_id) WHERE usuario_id IS NOT NULL;

-- ─── 4. Tabla preferencias_usuario (transversal, clave-valor) ────────────────
CREATE TABLE public.preferencias_usuario (
  usuario_id  uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  clave       text NOT NULL,
  valor       text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, clave),
  CONSTRAINT preferencias_usuario_clave_len CHECK (char_length(clave) BETWEEN 1 AND 64),
  CONSTRAINT preferencias_usuario_valor_len CHECK (char_length(valor) <= 256)
);

COMMENT ON TABLE public.preferencias_usuario IS
  'Preferencias clave-valor por usuario (p.ej. agenda_vista=dia|semana|mes). Aislamiento estricto por usuario_id. NO se audita.';

-- ─── 5. Triggers updated_at ──────────────────────────────────────────────────
CREATE TRIGGER citas_set_updated_at
  BEFORE UPDATE ON public.citas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER cita_invitados_set_updated_at
  BEFORE UPDATE ON public.cita_invitados
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER preferencias_usuario_set_updated_at
  BEFORE UPDATE ON public.preferencias_usuario
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 6. Triggers BEFORE INSERT: derivar centro_id (red de seguridad) ─────────
-- El server action ya pasa centro_id explícito. Para reunion_claustro/visita NO
-- hay nino/aula de donde derivar → el action DEBE pasarlo; el trigger solo cubre
-- el caso aula/nino y falla si no se puede derivar ni venía explícito.
CREATE OR REPLACE FUNCTION public.citas_set_centro_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.centro_id IS NULL AND NEW.nino_id IS NOT NULL THEN
    NEW.centro_id := public.centro_de_nino(NEW.nino_id);
  END IF;
  IF NEW.centro_id IS NULL AND NEW.aula_id IS NOT NULL THEN
    NEW.centro_id := public.centro_de_aula(NEW.aula_id);
  END IF;
  IF NEW.centro_id IS NULL THEN
    RAISE EXCEPTION 'citas: centro_id no resuelto (tipo=% aula_id=% nino_id=%) — el action debe pasarlo explícito en claustro/visita',
      NEW.tipo, NEW.aula_id, NEW.nino_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER citas_set_centro_id_trg
  BEFORE INSERT ON public.citas
  FOR EACH ROW EXECUTE FUNCTION public.citas_set_centro_id();

-- cita_invitados.centro_id deriva de la cita (red de seguridad; el action lo pasa).
CREATE OR REPLACE FUNCTION public.cita_invitados_set_centro_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.centro_id IS NULL THEN
    NEW.centro_id := public.centro_de_cita(NEW.cita_id);
  END IF;
  IF NEW.centro_id IS NULL THEN
    RAISE EXCEPTION 'cita_invitados: centro_id no resuelto para cita %', NEW.cita_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cita_invitados_set_centro_id_trg
  BEFORE INSERT ON public.cita_invitados
  FOR EACH ROW EXECUTE FUNCTION public.cita_invitados_set_centro_id();

-- ─── 7. Helpers SQL ──────────────────────────────────────────────────────────
-- Lee `citas` (otra tabla respecto a cita_invitados) → sin MVCC en sus RLS.
CREATE OR REPLACE FUNCTION public.centro_de_cita(p_cita_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT centro_id FROM public.citas WHERE id = p_cita_id;
$$;
GRANT EXECUTE ON FUNCTION public.centro_de_cita(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.organizador_de_cita(p_cita_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organizador_id FROM public.citas WHERE id = p_cita_id;
$$;
GRANT EXECUTE ON FUNCTION public.organizador_de_cita(uuid) TO authenticated;

-- ¿auth.uid() es invitado interno de la cita? Lee `cita_invitados`. Usado en la
-- SELECT policy de `citas` (otra tabla) → sin MVCC en INSERT…RETURNING de citas.
CREATE OR REPLACE FUNCTION public.usuario_es_invitado_cita(p_cita_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cita_invitados ci
    WHERE ci.cita_id = p_cita_id AND ci.usuario_id = auth.uid()
  );
$$;
GRANT EXECUTE ON FUNCTION public.usuario_es_invitado_cita(uuid) TO authenticated;

-- ROW-AWARE: recibe centro_id/organizador_id de `citas`, NO re-lee `citas`.
-- La rama "invitado" lee cita_invitados (otra tabla) → el gotcha MVCC de
-- INSERT…RETURNING sobre `citas` NO aplica.
CREATE OR REPLACE FUNCTION public.usuario_es_audiencia_cita_row(
  p_centro_id      uuid,
  p_organizador_id uuid,
  p_cita_id        uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.es_admin(p_centro_id)
      OR p_organizador_id = auth.uid()
      OR public.usuario_es_invitado_cita(p_cita_id);
$$;
GRANT EXECUTE ON FUNCTION public.usuario_es_audiencia_cita_row(uuid, uuid, uuid) TO authenticated;

-- ─── 8. RLS: citas ───────────────────────────────────────────────────────────
ALTER TABLE public.citas ENABLE ROW LEVEL SECURITY;

-- SELECT: admin del centro, organizador, o invitado interno (row-aware).
CREATE POLICY citas_select ON public.citas
  FOR SELECT USING (
    public.usuario_es_audiencia_cita_row(centro_id, organizador_id, id)
  );

-- INSERT: organizador_id = auth.uid() (anti-suplantación). Matriz AG-tipos:
--   admin → cualquier tipo; profe → solo reunion_familia (de su niño) y
--   reunion_clase (de su aula). claustro/visita → solo admin (sin rama profe).
CREATE POLICY citas_insert ON public.citas
  FOR INSERT WITH CHECK (
    organizador_id = auth.uid()
    AND (
      public.es_admin(centro_id)
      OR (tipo = 'reunion_familia'
          AND public.es_profe_de_nino(nino_id)
          AND public.centro_de_nino(nino_id) = centro_id)
      OR (tipo = 'reunion_clase'
          AND public.es_profe_de_aula(aula_id)
          AND public.centro_de_aula(aula_id) = centro_id)
    )
  );

-- UPDATE: organizador o admin (AG-11). Defensa simétrica. El server action
-- limita columnas (editar campos / cancelar a estado='cancelada').
CREATE POLICY citas_update ON public.citas
  FOR UPDATE
  USING (organizador_id = auth.uid() OR public.es_admin(centro_id))
  WITH CHECK (organizador_id = auth.uid() OR public.es_admin(centro_id));

-- DELETE: sin policy → default DENY. Cancelar = estado='cancelada'.

-- ─── 9. RLS: cita_invitados ──────────────────────────────────────────────────
ALTER TABLE public.cita_invitados ENABLE ROW LEVEL SECURITY;

-- SELECT: el propio invitado (su fila), el organizador (todas las de su cita) y
-- admin del centro. organizador_de_cita lee `citas` (otra tabla) → sin MVCC.
CREATE POLICY cita_invitados_select ON public.cita_invitados
  FOR SELECT USING (
    usuario_id = auth.uid()
    OR public.organizador_de_cita(cita_id) = auth.uid()
    OR public.es_admin(centro_id)
  );

-- INSERT: solo organizador o admin pueblan invitados (alta y "añadir" posterior);
-- centro_id coherente con la cita. El server action expande grupos a personas.
CREATE POLICY cita_invitados_insert ON public.cita_invitados
  FOR INSERT WITH CHECK (
    (public.organizador_de_cita(cita_id) = auth.uid() OR public.es_admin(centro_id))
    AND centro_id = public.centro_de_cita(cita_id)
  );

-- UPDATE: el invitado responde su fila (RSVP), o el organizador/admin marca al
-- externo. El server action separa los dos casos, limita columnas y aplica la
-- ventana (hasta hora_inicio). Idempotencia vía .select().maybeSingle().
CREATE POLICY cita_invitados_update ON public.cita_invitados
  FOR UPDATE
  USING (
    usuario_id = auth.uid()
    OR public.organizador_de_cita(cita_id) = auth.uid()
    OR public.es_admin(centro_id)
  )
  WITH CHECK (
    usuario_id = auth.uid()
    OR public.organizador_de_cita(cita_id) = auth.uid()
    OR public.es_admin(centro_id)
  );

-- DELETE: organizador o admin (quitar invitado). EXCEPCIÓN explícita al patrón
-- "DELETE bloqueado" (análoga a dias_centro, F4.5a): es gestión de lista; la
-- traza queda en audit_log. El invitado NO se auto-elimina (responde rechazado).
CREATE POLICY cita_invitados_delete ON public.cita_invitados
  FOR DELETE
  USING (public.organizador_de_cita(cita_id) = auth.uid() OR public.es_admin(centro_id));

-- ─── 10. RLS: preferencias_usuario ───────────────────────────────────────────
-- Aislamiento estricto por usuario_id (sin helpers; patrón push_subscriptions).
ALTER TABLE public.preferencias_usuario ENABLE ROW LEVEL SECURITY;

CREATE POLICY preferencias_usuario_select ON public.preferencias_usuario
  FOR SELECT USING (usuario_id = auth.uid());
CREATE POLICY preferencias_usuario_insert ON public.preferencias_usuario
  FOR INSERT WITH CHECK (usuario_id = auth.uid());
CREATE POLICY preferencias_usuario_update ON public.preferencias_usuario
  FOR UPDATE USING (usuario_id = auth.uid()) WITH CHECK (usuario_id = auth.uid());
CREATE POLICY preferencias_usuario_delete ON public.preferencias_usuario
  FOR DELETE USING (usuario_id = auth.uid());

-- ─── 11. audit_trigger_function ampliada (ramas citas + cita_invitados) ──────
-- CREATE OR REPLACE preserva las ramas previas (Fases 2..7). Se añaden 2 ramas,
-- ambas centro_id directo. preferencias_usuario NO se audita.
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
  ELSIF TG_TABLE_NAME = 'recordatorios' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'eventos' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'citas' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'cita_invitados' THEN
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

CREATE TRIGGER audit_citas
  AFTER INSERT OR UPDATE OR DELETE ON public.citas
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

CREATE TRIGGER audit_cita_invitados
  AFTER INSERT OR UPDATE OR DELETE ON public.cita_invitados
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

COMMIT;
