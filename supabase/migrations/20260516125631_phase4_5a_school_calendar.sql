-- =============================================================================
-- Fase 4.5a — Calendario laboral del centro
-- =============================================================================
-- 1 tabla nueva (`dias_centro`), 1 ENUM nuevo (`tipo_dia_centro` con 7
-- valores), 2 helpers SQL (`tipo_de_dia`, `centro_abierto`), políticas RLS
-- por tabla con excepción explícita DELETE permitido a admin (ADR-0019),
-- audit log automático extendiendo `audit_trigger_function()` con una
-- nueva rama para `dias_centro`.
--
-- A diferencia de las tablas operativas de F3/F4, `dias_centro` NO usa la
-- ventana de edición (`dentro_de_ventana_edicion`). El admin puede crear,
-- modificar o eliminar overrides para CUALQUIER fecha sin restricción
-- temporal — el calendario laboral es planificación administrativa, no un
-- hecho operativo del día.
--
-- Spec: docs/specs/school-calendar.md
-- ADRs: 0019 (default + excepciones + DELETE permitido).
-- =============================================================================

-- ─── 1. ENUM tipo_dia_centro ──────────────────────────────────────────────
-- 7 valores. Default semántico: lun-vie = lectivo, sáb-dom = cerrado (NO
-- se persiste, lo calcula `tipo_de_dia`). Las filas en `dias_centro` son
-- solo overrides al default.
CREATE TYPE public.tipo_dia_centro AS ENUM (
  'lectivo',
  'festivo',
  'vacaciones',
  'escuela_verano',
  'escuela_navidad',
  'jornada_reducida',
  'cerrado'
);

-- ─── 2. Tabla dias_centro ─────────────────────────────────────────────────
CREATE TABLE public.dias_centro (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id     uuid NOT NULL REFERENCES public.centros(id) ON DELETE CASCADE,
  fecha         date NOT NULL,
  tipo          public.tipo_dia_centro NOT NULL,
  observaciones text NULL,
  creado_por    uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dias_centro_centro_fecha_unique UNIQUE (centro_id, fecha),
  CONSTRAINT dias_centro_obs_len CHECK (
    observaciones IS NULL OR length(observaciones) <= 500
  )
);

-- El UNIQUE(centro_id, fecha) ya cubre las queries por mes:
-- `WHERE centro_id=? AND fecha BETWEEN ? AND ?` usa el índice unique.
-- Índice secundario en fecha para `getProximosDiasCerrados` que filtra
-- desde "hoy" con LIMIT pequeño.
CREATE INDEX dias_centro_fecha_idx ON public.dias_centro (fecha);

CREATE TRIGGER dias_centro_set_updated_at
  BEFORE UPDATE ON public.dias_centro
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 3. Helpers SQL ───────────────────────────────────────────────────────
-- `tipo_de_dia(centro, fecha)`: devuelve el tipo del día.
--   1) Si hay override en `dias_centro`, lo devuelve.
--   2) Si no, calcula default por ISO day-of-week:
--      - 1-5 (lun-vie) → 'lectivo'
--      - 6-7 (sáb-dom) → 'cerrado'
-- Trabaja con DATE (sin hora), por lo que el cambio DST no afecta.
CREATE OR REPLACE FUNCTION public.tipo_de_dia(p_centro_id uuid, p_fecha date)
RETURNS public.tipo_dia_centro
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tipo public.tipo_dia_centro;
  v_dow int;
BEGIN
  SELECT tipo INTO v_tipo
  FROM public.dias_centro
  WHERE centro_id = p_centro_id AND fecha = p_fecha;

  IF FOUND THEN
    RETURN v_tipo;
  END IF;

  v_dow := EXTRACT(ISODOW FROM p_fecha)::int;
  IF v_dow <= 5 THEN
    RETURN 'lectivo'::public.tipo_dia_centro;
  ELSE
    RETURN 'cerrado'::public.tipo_dia_centro;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tipo_de_dia(uuid, date) TO authenticated;

-- `centro_abierto(centro, fecha)`: boolean de conveniencia.
-- Abierto si el tipo resuelto es lectivo / escuela_verano / escuela_navidad
-- / jornada_reducida. Cerrado si festivo / vacaciones / cerrado.
CREATE OR REPLACE FUNCTION public.centro_abierto(p_centro_id uuid, p_fecha date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.tipo_de_dia(p_centro_id, p_fecha) IN (
    'lectivo'::public.tipo_dia_centro,
    'escuela_verano'::public.tipo_dia_centro,
    'escuela_navidad'::public.tipo_dia_centro,
    'jornada_reducida'::public.tipo_dia_centro
  );
$$;

GRANT EXECUTE ON FUNCTION public.centro_abierto(uuid, date) TO authenticated;

-- ─── 4. RLS: dias_centro ──────────────────────────────────────────────────
-- SELECT amplio: cualquier miembro del centro (admin, profe, tutor o
-- autorizado) ve el calendario. `pertenece_a_centro` mira `roles_usuario`,
-- que cubre los 4 roles al haber sido asignado el rol del centro.
--
-- INSERT/UPDATE/DELETE: solo admin del centro. DELETE permitido como
-- EXCEPCIÓN al patrón habitual del proyecto — la ausencia de fila tiene
-- significado semántico (vuelta al default por día de semana), no procede
-- "anular con prefijo" porque no es un evento sino un override. La
-- trazabilidad queda en `audit_log` (valores_antes poblado por el trigger).
-- Ver ADR-0019.
--
-- NO se usa `dentro_de_ventana_edicion(fecha)` porque el calendario es
-- planificación, no un hecho operativo. El admin edita cualquier fecha.
ALTER TABLE public.dias_centro ENABLE ROW LEVEL SECURITY;

CREATE POLICY dias_centro_select ON public.dias_centro
  FOR SELECT
  USING (public.pertenece_a_centro(centro_id));

CREATE POLICY dias_centro_insert ON public.dias_centro
  FOR INSERT
  WITH CHECK (public.es_admin(centro_id));

CREATE POLICY dias_centro_update ON public.dias_centro
  FOR UPDATE
  USING (public.es_admin(centro_id))
  WITH CHECK (public.es_admin(centro_id));

CREATE POLICY dias_centro_delete ON public.dias_centro
  FOR DELETE
  USING (public.es_admin(centro_id));

-- ─── 5. audit_trigger_function ampliada ───────────────────────────────────
-- Añade una rama nueva: `dias_centro` deriva `centro_id` directamente
-- desde la fila (NEW o OLD), igual que `centros`, `ninos`, `roles_usuario`.
-- CREATE OR REPLACE preserva las ramas previas (Fases 2, 2.6, 3, 4).
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

-- ─── 6. Trigger de audit en dias_centro ───────────────────────────────────
CREATE TRIGGER audit_dias_centro
  AFTER INSERT OR UPDATE OR DELETE ON public.dias_centro
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
