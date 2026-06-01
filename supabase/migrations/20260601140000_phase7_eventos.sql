-- =============================================================================
-- Fase 7 — Calendario y eventos (LEAN)
-- =============================================================================
-- ADITIVA: las tablas `eventos` y `confirmaciones_evento` NO existen → solo
-- CREATE. NUNCA drop+recreate. Spec: docs/specs/f7-calendario.md (decisiones
-- D1-D13 cerradas). Patrones reusados de F4.5a/F5/F6-C.
--
-- 4 ENUMs:
--   ambito_evento       = centro | aula | nino
--   tipo_evento         = excursion | reunion | fiesta | vacaciones | otro (D1)
--   evento_estado       = programado | cancelado (D7)
--   confirmacion_estado = pendiente | confirmado | rechazado (D9; `pendiente` =
--                         ausencia de fila — la tabla solo almacena conf./rech.)
--
-- 2 helpers SQL nuevos (STABLE SECURITY DEFINER, search_path=public):
--   usuario_es_audiencia_evento_row(centro_id, ambito, aula_id, nino_id)
--     → ROW-AWARE (recibe los campos del row, no re-lee `eventos`): evita el
--       gotcha MVCC en `INSERT…RETURNING` (crearEvento hace .insert().select()).
--   evento_aplica_a_nino(evento_id, nino_id) → ¿el niño está en la audiencia del
--     evento? (lee `eventos`+`matriculas`+`ninos`; usado en RLS de confirmaciones,
--     que NO re-lee confirmaciones → sin MVCC).
-- Reutiliza: es_admin, es_profe_de_aula, es_profe_de_nino, es_tutor_de,
--   es_tutor_en_aula (F6-C), pertenece_a_centro, centro_de_aula, centro_de_nino.
--
-- audit_trigger_function ampliada con 1 rama: `eventos` (centro_id directo).
--   `confirmaciones_evento` NO se audita (D13: telemetría, como lectura_*).
-- Sin Realtime (D11). centro_id derivado explícito en el server action; el
--   trigger BEFORE INSERT es solo red de seguridad.
-- =============================================================================
BEGIN;

-- ─── 1. ENUMs ────────────────────────────────────────────────────────────────
CREATE TYPE public.ambito_evento       AS ENUM ('centro', 'aula', 'nino');
CREATE TYPE public.tipo_evento         AS ENUM ('excursion', 'reunion', 'fiesta', 'vacaciones', 'otro');
CREATE TYPE public.evento_estado       AS ENUM ('programado', 'cancelado');
CREATE TYPE public.confirmacion_estado AS ENUM ('pendiente', 'confirmado', 'rechazado');

-- ─── 2. Tabla eventos ────────────────────────────────────────────────────────
CREATE TABLE public.eventos (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id              uuid NOT NULL REFERENCES public.centros(id)  ON DELETE CASCADE,
  ambito                 public.ambito_evento NOT NULL,
  aula_id                uuid REFERENCES public.aulas(id)             ON DELETE CASCADE,
  nino_id                uuid REFERENCES public.ninos(id)             ON DELETE CASCADE,
  tipo                   public.tipo_evento NOT NULL,
  titulo                 text NOT NULL,
  descripcion            text,
  lugar                  text,
  fecha                  date NOT NULL,
  fecha_fin              date,
  hora_inicio            time,
  hora_fin               time,
  requiere_confirmacion  boolean NOT NULL DEFAULT false,
  estado                 public.evento_estado NOT NULL DEFAULT 'programado',
  creado_por             uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- Coherencia ámbito ↔ referencia (espejo de anuncios; D3 sin multi-aula).
  CONSTRAINT eventos_ambito_coherencia CHECK (
    (ambito = 'nino'   AND nino_id IS NOT NULL AND aula_id IS NULL)
    OR (ambito = 'aula'   AND aula_id IS NOT NULL AND nino_id IS NULL)
    OR (ambito = 'centro' AND aula_id IS NULL AND nino_id IS NULL)
  ),
  CONSTRAINT eventos_titulo_len      CHECK (char_length(titulo) BETWEEN 1 AND 200),
  CONSTRAINT eventos_descripcion_len CHECK (descripcion IS NULL OR char_length(descripcion) <= 2000),
  CONSTRAINT eventos_lugar_len       CHECK (lugar IS NULL OR char_length(lugar) <= 200),
  -- Rango (D6): fecha_fin opcional, nunca anterior al inicio.
  CONSTRAINT eventos_rango_coherencia CHECK (fecha_fin IS NULL OR fecha_fin >= fecha),
  -- Hora opcional; si ambas en el mismo día sin rango, fin > inicio.
  CONSTRAINT eventos_hora_coherencia CHECK (
    hora_inicio IS NULL OR hora_fin IS NULL OR fecha_fin IS NOT NULL OR hora_fin > hora_inicio
  )
);

COMMENT ON TABLE public.eventos IS
  'Eventos del calendario (F7 LEAN). admin: cualquier ámbito; profe: solo ámbito aula. Ver docs/specs/f7-calendario.md.';

CREATE INDEX idx_eventos_centro_fecha ON public.eventos (centro_id, fecha);
CREATE INDEX idx_eventos_aula  ON public.eventos (aula_id)  WHERE aula_id IS NOT NULL;
CREATE INDEX idx_eventos_nino  ON public.eventos (nino_id)  WHERE nino_id IS NOT NULL;

-- ─── 3. Tabla confirmaciones_evento ──────────────────────────────────────────
-- Confirmación POR NIÑO (D2): UNIQUE (evento_id, nino_id), last-write-wins.
-- `confirmado_por`/`confirmado_at` = quién/cuándo respondió por última vez.
CREATE TABLE public.confirmaciones_evento (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id       uuid NOT NULL REFERENCES public.eventos(id)  ON DELETE CASCADE,
  nino_id         uuid NOT NULL REFERENCES public.ninos(id)    ON DELETE CASCADE,
  estado          public.confirmacion_estado NOT NULL,
  comentario      text,
  confirmado_por  uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  confirmado_at   timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT confirmaciones_evento_unica UNIQUE (evento_id, nino_id),
  -- La tabla solo almacena respuestas reales; `pendiente` = ausencia de fila.
  CONSTRAINT confirmaciones_estado_no_pendiente CHECK (estado <> 'pendiente'),
  CONSTRAINT confirmaciones_comentario_len CHECK (comentario IS NULL OR char_length(comentario) <= 500)
);

COMMENT ON TABLE public.confirmaciones_evento IS
  'Confirmación de asistencia por niño (F7, D2). Asistencia LIGERA, no autorización legal (eso es F8). No se audita (D13).';

CREATE INDEX idx_confirmaciones_evento_evento ON public.confirmaciones_evento (evento_id);

-- ─── 4. Triggers updated_at ──────────────────────────────────────────────────
CREATE TRIGGER eventos_set_updated_at
  BEFORE UPDATE ON public.eventos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER confirmaciones_evento_set_updated_at
  BEFORE UPDATE ON public.confirmaciones_evento
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 5. Trigger BEFORE INSERT: derivar centro_id (red de seguridad) ──────────
-- El server action ya pasa centro_id explícito (db-triggers.md: no sentinel).
-- Este trigger solo cubre el caso NULL para ámbitos aula/nino.
CREATE OR REPLACE FUNCTION public.eventos_set_centro_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.centro_id IS NULL AND NEW.nino_id IS NOT NULL THEN
    NEW.centro_id := public.centro_de_nino(NEW.nino_id);
  END IF;
  IF NEW.centro_id IS NULL AND NEW.aula_id IS NOT NULL THEN
    NEW.centro_id := public.centro_de_aula(NEW.aula_id);
  END IF;
  IF NEW.centro_id IS NULL THEN
    RAISE EXCEPTION 'eventos: no se pudo derivar centro_id (ambito=% aula_id=% nino_id=%)',
      NEW.ambito, NEW.aula_id, NEW.nino_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER eventos_set_centro_id_trg
  BEFORE INSERT ON public.eventos
  FOR EACH ROW EXECUTE FUNCTION public.eventos_set_centro_id();

-- ─── 6. Helpers SQL ──────────────────────────────────────────────────────────
-- ROW-AWARE (recibe los campos del row): la SELECT policy NO re-lee `eventos` →
-- el gotcha MVCC de INSERT…RETURNING NO aplica (cf. usuario_es_audiencia_anuncio_row, F5).
CREATE OR REPLACE FUNCTION public.usuario_es_audiencia_evento_row(
  p_centro_id uuid,
  p_ambito    public.ambito_evento,
  p_aula_id   uuid,
  p_nino_id   uuid
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.es_admin(p_centro_id) THEN
    RETURN TRUE;
  END IF;
  IF p_ambito = 'nino' THEN
    RETURN public.es_profe_de_nino(p_nino_id) OR public.es_tutor_de(p_nino_id);
  ELSIF p_ambito = 'aula' THEN
    RETURN public.es_profe_de_aula(p_aula_id) OR public.es_tutor_en_aula(p_aula_id);
  ELSIF p_ambito = 'centro' THEN
    RETURN public.pertenece_a_centro(p_centro_id);
  END IF;
  RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.usuario_es_audiencia_evento_row(uuid, public.ambito_evento, uuid, uuid) TO authenticated;

-- ¿El niño está en la audiencia del evento? Lee `eventos`+`matriculas`+`ninos`
-- (otras tablas respecto a confirmaciones_evento) → sin MVCC en su RLS.
CREATE OR REPLACE FUNCTION public.evento_aplica_a_nino(p_evento_id uuid, p_nino_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.eventos%ROWTYPE;
BEGIN
  SELECT * INTO e FROM public.eventos WHERE id = p_evento_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF e.ambito = 'nino' THEN
    RETURN e.nino_id = p_nino_id;
  ELSIF e.ambito = 'aula' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.matriculas m
      WHERE m.nino_id = p_nino_id AND m.aula_id = e.aula_id
        AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
    );
  ELSIF e.ambito = 'centro' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.ninos n
      WHERE n.id = p_nino_id AND n.centro_id = e.centro_id AND n.deleted_at IS NULL
    );
  END IF;
  RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.evento_aplica_a_nino(uuid, uuid) TO authenticated;

-- ─── 7. RLS: eventos ─────────────────────────────────────────────────────────
ALTER TABLE public.eventos ENABLE ROW LEVEL SECURITY;

-- SELECT: audiencia por ámbito (row-aware).
CREATE POLICY eventos_select ON public.eventos
  FOR SELECT USING (
    public.usuario_es_audiencia_evento_row(centro_id, ambito, aula_id, nino_id)
  );

-- INSERT: admin (cualquier ámbito) o profe (solo ámbito aula sobre su aula).
-- creado_por = auth.uid() (anti-suplantación). Espejo de anuncios_insert (F5).
CREATE POLICY eventos_insert ON public.eventos
  FOR INSERT WITH CHECK (
    creado_por = auth.uid()
    AND (
      public.es_admin(centro_id)
      OR (ambito = 'aula'
          AND public.es_profe_de_aula(aula_id)
          AND public.centro_de_aula(aula_id) = centro_id)
    )
  );

-- UPDATE: autor o admin del centro (D8). Defensa simétrica USING + WITH CHECK.
-- El server action limita columnas (editar campos / cancelar a estado='cancelado').
CREATE POLICY eventos_update ON public.eventos
  FOR UPDATE
  USING (creado_por = auth.uid() OR public.es_admin(centro_id))
  WITH CHECK (creado_por = auth.uid() OR public.es_admin(centro_id));

-- DELETE: sin policy → default DENY. Cancelar = estado='cancelado' (no se borra).

-- ─── 8. RLS: confirmaciones_evento ───────────────────────────────────────────
ALTER TABLE public.confirmaciones_evento ENABLE ROW LEVEL SECURITY;

-- SELECT: tutor del niño (ve la suya), profe del niño y admin del centro (roster).
-- Helpers leen OTRAS tablas → sin MVCC en INSERT…RETURNING.
CREATE POLICY confirmaciones_select ON public.confirmaciones_evento
  FOR SELECT USING (
    public.es_tutor_de(nino_id)
    OR public.es_profe_de_nino(nino_id)
    OR public.es_admin(public.centro_de_nino(nino_id))
  );

-- INSERT/UPDATE: solo un tutor del niño, sobre un evento que lo incluye,
-- y confirmado_por = auth.uid() (anti-suplantación). last-write-wins (D2).
CREATE POLICY confirmaciones_insert ON public.confirmaciones_evento
  FOR INSERT WITH CHECK (
    public.es_tutor_de(nino_id)
    AND confirmado_por = auth.uid()
    AND public.evento_aplica_a_nino(evento_id, nino_id)
  );

CREATE POLICY confirmaciones_update ON public.confirmaciones_evento
  FOR UPDATE
  USING (public.es_tutor_de(nino_id))
  WITH CHECK (
    public.es_tutor_de(nino_id)
    AND confirmado_por = auth.uid()
    AND public.evento_aplica_a_nino(evento_id, nino_id)
  );

-- DELETE: sin policy → default DENY (cambiar a 'rechazado' en vez de borrar).

-- ─── 9. audit_trigger_function ampliada (rama eventos) ───────────────────────
-- CREATE OR REPLACE preserva las ramas previas (Fases 2..6). Se añade 1 rama:
-- eventos (centro_id directo). confirmaciones_evento NO se audita (D13).
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

CREATE TRIGGER audit_eventos
  AFTER INSERT OR UPDATE OR DELETE ON public.eventos
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

COMMIT;
