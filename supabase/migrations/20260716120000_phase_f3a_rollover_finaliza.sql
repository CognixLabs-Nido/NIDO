-- =============================================================================
-- F-3-A — Destino "Finaliza" en pasar-de-curso: tabla `rollover_finaliza`.
-- -----------------------------------------------------------------------------
-- Hasta ahora "graduarse" = ausencia de matrícula pendiente en el curso destino,
-- indistinguible de "sin marcar". F-3-A convierte "Finaliza" en un DESTINO REAL
-- con miembros: una fila `rollover_finaliza (curso_destino, niño)` = "este niño NO
-- continúa al curso siguiente".
--
-- No puede modelarse como matrícula: `matriculas.aula_id` es NOT NULL con FK
-- compuesta a `aulas_curso` → una matrícula exige un aula real. Por eso una tabla
-- de decisión aparte, paralela a la matrícula pendiente (= decisión "aula X").
--
-- ALCANCE F-3-A: solo la MARCA persistente + distinguible. NO archiva (no toca
-- ninos.deleted_at, matriculas, vinculos ni roles_usuario) — eso es F-3-C, que
-- consume estas filas. Las filas PERSISTEN tras confirmar el rollover.
--
-- Exclusión mutua pendiente-vs-finaliza: la garantizan las server actions (marcar
-- Finaliza borra la pendiente; asignar aula borra la fila Finaliza), NO un trigger
-- (decisión de producto F-3-A.3). Cubierta por tests.
-- =============================================================================

BEGIN;

CREATE TABLE public.rollover_finaliza (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id          uuid NOT NULL REFERENCES public.centros(id) ON DELETE CASCADE,
  curso_academico_id uuid NOT NULL REFERENCES public.cursos_academicos(id) ON DELETE CASCADE,
  nino_id            uuid NOT NULL REFERENCES public.ninos(id) ON DELETE CASCADE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES public.usuarios(id) ON DELETE SET NULL DEFAULT auth.uid(),
  -- Una sola decisión "Finaliza" por niño y curso destino (reversible = borrar fila).
  UNIQUE (curso_academico_id, nino_id)
);

CREATE INDEX idx_rollover_finaliza_curso ON public.rollover_finaliza (curso_academico_id);
CREATE INDEX idx_rollover_finaliza_nino ON public.rollover_finaliza (nino_id);

-- `centro_id` derivado del curso destino (mismo patrón que aulas_curso_set_centro_id).
CREATE OR REPLACE FUNCTION public.rollover_finaliza_set_centro_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.centro_id := public.centro_de_curso(NEW.curso_academico_id);
  RETURN NEW;
END $$;

CREATE TRIGGER rollover_finaliza_set_centro_id
  BEFORE INSERT ON public.rollover_finaliza
  FOR EACH ROW EXECUTE FUNCTION public.rollover_finaliza_set_centro_id();

ALTER TABLE public.rollover_finaliza ENABLE ROW LEVEL SECURITY;

-- Solo admin del centro (planificación). profe/tutor → default DENY (sin policy).
-- Gotcha MVCC: no aplica — `es_admin(centro_id)` lee `roles_usuario` (otra tabla),
-- nunca `rollover_finaliza`, así que `.insert().select()` es seguro sin helper row-aware.
CREATE POLICY rollover_finaliza_admin_all ON public.rollover_finaliza
  FOR ALL
  USING (public.es_admin(centro_id))
  WITH CHECK (public.es_admin(centro_id));

CREATE TRIGGER audit_rollover_finaliza
  AFTER INSERT OR UPDATE OR DELETE ON public.rollover_finaliza
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

-- ── Auditoría: añade la rama `rollover_finaliza` (centro_id directo) ──────────
-- CREATE OR REPLACE con el cuerpo vigente (20260709120000) + el nuevo ELSIF.
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
  ELSIF TG_TABLE_NAME = 'autorizaciones' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'firmas_autorizacion' THEN
    v_centro_id := public.centro_de_nino(COALESCE((NEW).nino_id, (OLD).nino_id));
  ELSIF TG_TABLE_NAME = 'administraciones_medicacion' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'plantillas_informe' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'informes_evolucion' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'campanas_informe' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'publicaciones' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'media' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'media_etiquetas' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'aulas_curso' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'lista_espera' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  -- ── F-3-A: rollover_finaliza (centro_id directo) ─────────────────────────
  ELSIF TG_TABLE_NAME = 'rollover_finaliza' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  -- ── F-2a: familias (centro_id directo) ───────────────────────────────────
  ELSIF TG_TABLE_NAME = 'familias' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  -- ── F-2a: familia_tutores (centro derivado de la familia) ────────────────
  ELSIF TG_TABLE_NAME = 'familia_tutores' THEN
    v_centro_id := public.centro_de_familia(COALESCE((NEW).familia_id, (OLD).familia_id));
  ELSIF TG_TABLE_NAME IN (
    'conceptos_cobro',
    'tipos_beca',
    'asignacion_cuota',
    'becas',
    'metodo_pago_familia',
    'parte_servicio_diario',
    'cierre_mensual',
    'recibos',
    'lineas_recibo',
    'remesas',
    'recibos_remesa'
  ) THEN
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

COMMIT;
