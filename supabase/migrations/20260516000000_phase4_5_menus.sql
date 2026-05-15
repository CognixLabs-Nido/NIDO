-- =============================================================================
-- Fase 4.5 — Menús del centro + helpers para pase de lista comida
-- =============================================================================
-- 2 tablas (plantillas_menu, plantilla_menu_dia), 2 ENUMs, 3 helpers SQL
-- nuevos (centro_de_plantilla, menu_del_dia, nino_toma_comida_solida),
-- RLS estándar, audit log automático en ambas tablas. La plantilla NO
-- materializa filas en `comidas` (ADR-0018 lazy materialization). Las
-- `comidas` siguen sus RLS y ventana de edición de F3.
--
-- Spec: docs/specs/menus.md
-- ADRs: 0017 (plantilla por día de semana), 0018 (lazy materialization).
-- =============================================================================

-- ─── 1. ENUMs ─────────────────────────────────────────────────────────────
CREATE TYPE public.estado_plantilla_menu AS ENUM (
  'borrador', 'publicada', 'archivada'
);

CREATE TYPE public.dia_semana AS ENUM (
  'lunes', 'martes', 'miercoles', 'jueves', 'viernes'
);

-- ─── 2. Tabla plantillas_menu ─────────────────────────────────────────────
CREATE TABLE public.plantillas_menu (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id     uuid NOT NULL REFERENCES public.centros(id) ON DELETE CASCADE,
  nombre        text NOT NULL,
  estado        public.estado_plantilla_menu NOT NULL DEFAULT 'borrador',
  vigente_desde date NULL,
  vigente_hasta date NULL,
  creada_por    uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz NULL,
  CONSTRAINT plantillas_menu_nombre_len CHECK (length(nombre) BETWEEN 2 AND 120),
  CONSTRAINT plantillas_menu_rango_fechas CHECK (
    vigente_desde IS NULL OR vigente_hasta IS NULL OR vigente_hasta >= vigente_desde
  )
);

-- Solo una plantilla 'publicada' viva por centro.
CREATE UNIQUE INDEX plantillas_menu_unica_publicada
  ON public.plantillas_menu (centro_id)
  WHERE estado = 'publicada' AND deleted_at IS NULL;

CREATE INDEX plantillas_menu_centro_estado_idx
  ON public.plantillas_menu (centro_id, estado);

CREATE TRIGGER plantillas_menu_set_updated_at
  BEFORE UPDATE ON public.plantillas_menu
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 3. Tabla plantilla_menu_dia ──────────────────────────────────────────
CREATE TABLE public.plantilla_menu_dia (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plantilla_id  uuid NOT NULL REFERENCES public.plantillas_menu(id) ON DELETE CASCADE,
  dia_semana    public.dia_semana NOT NULL,
  desayuno      text NULL,
  media_manana  text NULL,
  comida        text NULL,
  merienda      text NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plantilla_menu_dia_unica UNIQUE (plantilla_id, dia_semana),
  CONSTRAINT plantilla_menu_dia_desayuno_len CHECK (
    desayuno IS NULL OR length(desayuno) <= 500
  ),
  CONSTRAINT plantilla_menu_dia_media_manana_len CHECK (
    media_manana IS NULL OR length(media_manana) <= 500
  ),
  CONSTRAINT plantilla_menu_dia_comida_len CHECK (
    comida IS NULL OR length(comida) <= 500
  ),
  CONSTRAINT plantilla_menu_dia_merienda_len CHECK (
    merienda IS NULL OR length(merienda) <= 500
  )
);

CREATE INDEX plantilla_menu_dia_plantilla_idx
  ON public.plantilla_menu_dia (plantilla_id);

CREATE TRIGGER plantilla_menu_dia_set_updated_at
  BEFORE UPDATE ON public.plantilla_menu_dia
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 4. Helpers SQL ───────────────────────────────────────────────────────

-- 4.1 centro_de_plantilla: lookup anti-recursión (patrón ADR-0007).
CREATE OR REPLACE FUNCTION public.centro_de_plantilla(p_plantilla_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT centro_id FROM public.plantillas_menu WHERE id = p_plantilla_id;
$$;

-- 4.2 menu_del_dia: resuelve la plantilla publicada vigente para una fecha
-- y devuelve los 4 momentos del día correspondiente. ISODOW (lunes=1..7).
-- Sábado y domingo devuelven cero filas.
CREATE OR REPLACE FUNCTION public.menu_del_dia(p_centro_id uuid, p_fecha date)
RETURNS TABLE(desayuno text, media_manana text, comida text, merienda text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dia public.dia_semana;
BEGIN
  v_dia := CASE EXTRACT(ISODOW FROM p_fecha)::int
    WHEN 1 THEN 'lunes'::public.dia_semana
    WHEN 2 THEN 'martes'::public.dia_semana
    WHEN 3 THEN 'miercoles'::public.dia_semana
    WHEN 4 THEN 'jueves'::public.dia_semana
    WHEN 5 THEN 'viernes'::public.dia_semana
    ELSE NULL
  END;
  IF v_dia IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT pd.desayuno, pd.media_manana, pd.comida, pd.merienda
    FROM public.plantillas_menu pm
    JOIN public.plantilla_menu_dia pd ON pd.plantilla_id = pm.id
    WHERE pm.centro_id = p_centro_id
      AND pm.estado = 'publicada'
      AND pm.deleted_at IS NULL
      AND (pm.vigente_desde IS NULL OR pm.vigente_desde <= p_fecha)
      AND (pm.vigente_hasta IS NULL OR pm.vigente_hasta >= p_fecha)
      AND pd.dia_semana = v_dia
    LIMIT 1;
END;
$$;

-- 4.3 nino_toma_comida_solida: filtra del pase de lista a los niños que
-- toman exclusivamente leche. La lactancia 'mixta' SÍ entra en el pase de
-- lista (los niños en transición comen sólidos parciales). Solo se
-- excluyen los lactantes exclusivos: 'materna' y 'biberon'. Si no hay
-- datos pedagógicos, COALESCE devuelve TRUE → no excluye por ausencia
-- de datos.
CREATE OR REPLACE FUNCTION public.nino_toma_comida_solida(p_nino_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT lactancia_estado NOT IN (
       'materna'::public.lactancia_estado,
       'biberon'::public.lactancia_estado
     )
     FROM public.datos_pedagogicos_nino
     WHERE nino_id = p_nino_id),
    TRUE
  );
$$;

-- ─── 5. RLS ──────────────────────────────────────────────────────────────
ALTER TABLE public.plantillas_menu ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plantilla_menu_dia ENABLE ROW LEVEL SECURITY;

-- 5.1 plantillas_menu — SELECT: cualquier rol del centro (admin/profe/tutor)
CREATE POLICY pm_select ON public.plantillas_menu
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND public.pertenece_a_centro(centro_id)
  );

-- 5.2 plantillas_menu — INSERT/UPDATE: admin del centro
CREATE POLICY pm_admin_insert ON public.plantillas_menu
  FOR INSERT
  WITH CHECK (public.es_admin(centro_id));

CREATE POLICY pm_admin_update ON public.plantillas_menu
  FOR UPDATE
  USING (public.es_admin(centro_id))
  WITH CHECK (public.es_admin(centro_id));

-- DELETE: nadie (default DENY).

-- 5.3 plantilla_menu_dia — SELECT: cualquier rol del centro de la plantilla
CREATE POLICY pmd_select ON public.plantilla_menu_dia
  FOR SELECT
  USING (
    public.pertenece_a_centro(public.centro_de_plantilla(plantilla_id))
  );

-- 5.4 plantilla_menu_dia — INSERT/UPDATE: admin del centro de la plantilla
CREATE POLICY pmd_admin_insert ON public.plantilla_menu_dia
  FOR INSERT
  WITH CHECK (public.es_admin(public.centro_de_plantilla(plantilla_id)));

CREATE POLICY pmd_admin_update ON public.plantilla_menu_dia
  FOR UPDATE
  USING (public.es_admin(public.centro_de_plantilla(plantilla_id)))
  WITH CHECK (public.es_admin(public.centro_de_plantilla(plantilla_id)));

-- DELETE: nadie (default DENY). Para "borrar" un día, admin lo actualiza
-- vaciando los campos. ON DELETE CASCADE desde plantillas_menu sí limpia
-- los hijos si soft-delete de plantilla se promueve a hard delete vía
-- service_role.

-- ─── 6. audit_trigger_function ampliada ───────────────────────────────────
-- Añade dos ramas: plantillas_menu (centro_id directo) y plantilla_menu_dia
-- (centro derivado vía centro_de_plantilla). CREATE OR REPLACE preserva
-- todas las ramas previas (Fases 2, 2.6, 3, 4).
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
  ELSIF TG_TABLE_NAME = 'plantillas_menu' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'plantilla_menu_dia' THEN
    v_centro_id := public.centro_de_plantilla(
      COALESCE((NEW).plantilla_id, (OLD).plantilla_id)
    );
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

-- ─── 7. Triggers de audit en las 2 tablas nuevas ──────────────────────────
CREATE TRIGGER audit_plantillas_menu
  AFTER INSERT OR UPDATE OR DELETE ON public.plantillas_menu
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

CREATE TRIGGER audit_plantilla_menu_dia
  AFTER INSERT OR UPDATE OR DELETE ON public.plantilla_menu_dia
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

-- ─── 8. NO se añade Realtime a las plantillas. ────────────────────────────
-- Las plantillas cambian con poca frecuencia (semanal/mensual) y la UI
-- admin recarga al guardar. Las `comidas` (que sí cambian on-line desde
-- el pase de lista batch) ya están en supabase_realtime desde F3.
