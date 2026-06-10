-- =============================================================================
-- Fase 9-5-0 — Campañas de informe (capa de datos + RLS, sin UI)
-- =============================================================================
-- ADITIVA: la tabla `campanas_informe` NO existe → solo CREATE. NUNCA drop+recreate.
-- Fuente de verdad: docs/specs/campana-informes.md (approved). ADR: ADR-0044.
--
-- QUÉ ES: la campaña es una CAPA de coordinación sobre F9, NO una puerta. La
-- dirección abre una campaña para (curso activo, período) con una fecha límite; las
-- profes ven en su INICIO los informes pendientes; la dirección ve el seguimiento; y
-- la profe (o la dirección) publica en lote. La campaña **no toca ni bloquea**
-- `informes_evolucion`: el flujo individual de F9 sigue funcionando solo.
--
-- 1 ENUM nuevo:
--   estado_campana_informe = abierta | cerrada
--
-- DECISIONES DE MODELO (ver ADR-0044 y spec):
--  - Q1  VARIAS campañas abiertas a la vez permitidas (p. ej. trimestre_1 y _2). El
--        UNIQUE es por (centro, curso, período), no "una abierta por centro".
--  - Q2  "Completado" = informe PUBLICADO; un borrador cuenta como pendiente. (Lo
--        evalúa la derivación de pendientes en la app, no la BD.)
--  - Q3  Pendientes = niños con matrícula ACTIVA; los de baja no cuentan. (Derivado
--        en la app; aquí no se modela.)
--  - Q4  estado abierta⇄cerrada: cerrar es REVERSIBLE (reabrir) y se puede editar la
--        fecha_limite mientras está abierta. No hay borrado (DELETE bloqueado).
--  - Q5  Publicar en lote SOLO publica informes existentes y completos; no crea.
--  - Q6  VÍNCULO LÓGICO informe↔campaña por (centro, curso, período): NO se añade FK
--        `campana_id` a `informes_evolucion` (esta migración NO la toca).
--  - Q7  Solo el CURSO ACTIVO (la app resuelve el curso activo del centro; aquí solo
--        se guarda el curso_academico_id que envíe el server).
--  - Q8/Q9 La publicación (individual o en lote) reusa la lógica de F9-2; aquí nada.
--
-- NO se crean helpers nuevos: la RLS reusa `es_admin(centro_id)` y
-- `es_profe_en_centro(centro_id)`, que leen OTRAS tablas (roles_usuario / profes_aulas),
-- nunca `campanas_informe` → la SELECT policy es segura frente al gotcha MVCC en
-- INSERT…RETURNING (igual razonamiento que en F9-0 con plantillas_informe).
--
-- audit_trigger_function ampliada con 1 rama: `campanas_informe` (centro_id directo).
-- Se audita (registro administrativo de plazos). Sin Realtime.
--
-- Operación sobre esquema productivo → se aplica MANUALMENTE por SQL Editor (CLI con
-- bug SIGILL en este Chromebook). No la ejecuta el agente. Tras aplicarla, registrar
-- en supabase_migrations.schema_migrations y regenerar src/types/database.ts.
-- =============================================================================
BEGIN;

-- ─── 1. ENUM ─────────────────────────────────────────────────────────────────
CREATE TYPE public.estado_campana_informe AS ENUM ('abierta', 'cerrada');

-- ─── 2. Tabla campanas_informe ───────────────────────────────────────────────
-- Una campaña por (centro, curso académico, período). `periodo` reusa el ENUM
-- existente periodo_informe (F9-0). `fecha_limite` es informativa (no bloquea).
-- Sin `deleted_at`: el ciclo de vida es abierta⇄cerrada (Q4); DELETE bloqueado.
CREATE TABLE public.campanas_informe (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id          uuid NOT NULL REFERENCES public.centros(id)           ON DELETE CASCADE,
  curso_academico_id uuid NOT NULL REFERENCES public.cursos_academicos(id) ON DELETE RESTRICT,
  periodo            public.periodo_informe NOT NULL,
  fecha_limite       date NOT NULL,
  estado             public.estado_campana_informe NOT NULL DEFAULT 'abierta',
  created_by         uuid NOT NULL REFERENCES public.usuarios(id)          ON DELETE RESTRICT,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- Una campaña por período/curso/centro (puede haber varias abiertas de períodos
  -- distintos a la vez — Q1; lo que NO se permite es duplicar la misma terna).
  CONSTRAINT campanas_informe_terna_unica UNIQUE (centro_id, curso_academico_id, periodo)
);

COMMENT ON TABLE public.campanas_informe IS
  'Campaña de informes (F9-5): plazo de entrega por (centro, curso activo, período). CAPA de coordinación, NO bloquea informes_evolucion (vínculo lógico por la terna, sin FK — Q6). estado abierta⇄cerrada reversible. Ver docs/specs/campana-informes.md y ADR-0044.';
COMMENT ON COLUMN public.campanas_informe.fecha_limite IS
  'Fecha límite INFORMATIVA: no bloquea publicar tarde; el aviso de pendientes se pone urgente al acercarse/pasar (umbral 3 días, lógica en la app).';
COMMENT ON COLUMN public.campanas_informe.estado IS
  'abierta = genera aviso de pendientes; cerrada = no. Reversible (reabrir). Editar fecha_limite permitido mientras abierta.';

-- Índice para listar campañas abiertas del centro/curso (derivación de pendientes).
CREATE INDEX idx_campanas_informe_centro_curso
  ON public.campanas_informe (centro_id, curso_academico_id) WHERE estado = 'abierta';

-- ─── 3. Trigger updated_at ───────────────────────────────────────────────────
CREATE TRIGGER campanas_informe_set_updated_at
  BEFORE UPDATE ON public.campanas_informe
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 4. RLS: campanas_informe ────────────────────────────────────────────────
ALTER TABLE public.campanas_informe ENABLE ROW LEVEL SECURITY;

-- SELECT: STAFF del centro (admin o cualquier profe del centro). Las profes necesitan
-- leer la campaña y su fecha para el aviso de pendientes y el botón de publicar en
-- lote. La FAMILIA NO accede (no se usa `pertenece_a_centro`, que incluiría tutores —
-- mismo criterio que plantillas_informe en F9-0).
-- Row-aware seguro: `es_admin`/`es_profe_en_centro` leen roles_usuario/profes_aulas,
-- NUNCA campanas_informe → sin gotcha MVCC en INSERT…RETURNING.
CREATE POLICY campanas_informe_select ON public.campanas_informe
  FOR SELECT USING (
    public.es_admin(centro_id) OR public.es_profe_en_centro(centro_id)
  );

-- INSERT (abrir campaña): solo dirección (admin). created_by = auth.uid() (anti-suplantación).
CREATE POLICY campanas_informe_insert ON public.campanas_informe
  FOR INSERT WITH CHECK (
    public.es_admin(centro_id) AND created_by = auth.uid()
  );

-- UPDATE (cerrar / reabrir / editar fecha_limite): solo dirección. Defensa simétrica.
CREATE POLICY campanas_informe_update ON public.campanas_informe
  FOR UPDATE
  USING (public.es_admin(centro_id))
  WITH CHECK (public.es_admin(centro_id));

-- DELETE: sin policy → default DENY. Cerrar (estado='cerrada') sustituye al borrado.

-- ─── 5. audit_trigger_function ampliada (+ campanas_informe) ──────────────────
-- CREATE OR REPLACE preserva todas las ramas previas (Fases 2..9-0). Se añade 1 rama
-- con centro_id directo. Se audita (registro administrativo de plazos de informes).
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

CREATE TRIGGER audit_campanas_informe
  AFTER INSERT OR UPDATE OR DELETE ON public.campanas_informe
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

COMMIT;
