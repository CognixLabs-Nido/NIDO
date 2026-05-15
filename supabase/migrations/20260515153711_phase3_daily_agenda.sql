-- =============================================================================
-- Fase 3 — Agenda diaria + bienestar
-- =============================================================================
-- 5 tablas operativas (1 padre + 4 hijo), 9 ENUMs, helper ventana de edición,
-- helpers de lookup vía agenda_id (patrón ADR-0007), políticas RLS por tabla,
-- audit log automático (extiende audit_trigger_function existente), Realtime
-- publication, backfill JSONB de permiso `puede_ver_agenda` en vínculos.
--
-- Spec: docs/specs/daily-agenda.md
-- ADRs: 0011 (timezone Madrid), 0012 (5 tablas vs JSONB), 0013 (ventana 1 día).
-- =============================================================================

-- ─── 1. ENUMs ─────────────────────────────────────────────────────────────
CREATE TYPE public.estado_general_agenda AS ENUM (
  'bien', 'regular', 'mal', 'mixto'
);

CREATE TYPE public.humor_agenda AS ENUM (
  'feliz', 'tranquilo', 'inquieto', 'triste', 'cansado'
);

CREATE TYPE public.momento_comida AS ENUM (
  'desayuno', 'media_manana', 'comida', 'merienda'
);

CREATE TYPE public.cantidad_comida AS ENUM (
  'todo', 'mayoria', 'mitad', 'poco', 'nada'
);

CREATE TYPE public.tipo_biberon AS ENUM (
  'materna', 'formula', 'agua', 'infusion', 'zumo'
);

CREATE TYPE public.calidad_sueno AS ENUM (
  'profundo', 'tranquilo', 'intermitente', 'nada'
);

CREATE TYPE public.tipo_deposicion AS ENUM (
  'pipi', 'caca', 'mixto'
);

CREATE TYPE public.consistencia_deposicion AS ENUM (
  'normal', 'dura', 'blanda', 'diarrea'
);

CREATE TYPE public.cantidad_deposicion AS ENUM (
  'mucha', 'normal', 'poca'
);

-- ─── 2. Tablas ────────────────────────────────────────────────────────────

-- 2.1 agendas_diarias (fila padre, 1 por niño/día)
CREATE TABLE public.agendas_diarias (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nino_id     uuid NOT NULL REFERENCES public.ninos(id) ON DELETE RESTRICT,
  fecha       date NOT NULL,
  estado_general public.estado_general_agenda NULL,
  humor       public.humor_agenda NULL,
  observaciones_generales text NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agendas_diarias_nino_fecha_unique UNIQUE (nino_id, fecha),
  CONSTRAINT agendas_diarias_obs_len CHECK (
    observaciones_generales IS NULL OR length(observaciones_generales) <= 500
  )
);

CREATE INDEX agendas_diarias_fecha_idx ON public.agendas_diarias (fecha DESC);
CREATE INDEX agendas_diarias_nino_idx ON public.agendas_diarias (nino_id);

CREATE TRIGGER agendas_diarias_set_updated_at
  BEFORE UPDATE ON public.agendas_diarias
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2.2 comidas
CREATE TABLE public.comidas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agenda_id   uuid NOT NULL REFERENCES public.agendas_diarias(id) ON DELETE CASCADE,
  momento     public.momento_comida NOT NULL,
  hora        time NULL,
  cantidad    public.cantidad_comida NOT NULL,
  descripcion text NULL,
  observaciones text NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comidas_descripcion_len CHECK (
    descripcion IS NULL OR length(descripcion) <= 500
  ),
  CONSTRAINT comidas_observaciones_len CHECK (
    observaciones IS NULL OR length(observaciones) <= 500
  )
);

CREATE INDEX comidas_agenda_idx ON public.comidas (agenda_id);

CREATE TRIGGER comidas_set_updated_at
  BEFORE UPDATE ON public.comidas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2.3 biberones
CREATE TABLE public.biberones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agenda_id   uuid NOT NULL REFERENCES public.agendas_diarias(id) ON DELETE CASCADE,
  hora        time NOT NULL,
  cantidad_ml smallint NOT NULL,
  tipo        public.tipo_biberon NOT NULL,
  tomado_completo boolean NOT NULL DEFAULT true,
  observaciones text NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT biberones_cantidad_range CHECK (cantidad_ml BETWEEN 0 AND 500),
  CONSTRAINT biberones_observaciones_len CHECK (
    observaciones IS NULL OR length(observaciones) <= 500
  )
);

CREATE INDEX biberones_agenda_idx ON public.biberones (agenda_id);

CREATE TRIGGER biberones_set_updated_at
  BEFORE UPDATE ON public.biberones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2.4 suenos
CREATE TABLE public.suenos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agenda_id   uuid NOT NULL REFERENCES public.agendas_diarias(id) ON DELETE CASCADE,
  hora_inicio time NOT NULL,
  hora_fin    time NULL,
  calidad     public.calidad_sueno NULL,
  observaciones text NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suenos_fin_posterior CHECK (
    hora_fin IS NULL OR hora_fin > hora_inicio
  ),
  CONSTRAINT suenos_observaciones_len CHECK (
    observaciones IS NULL OR length(observaciones) <= 500
  )
);

CREATE INDEX suenos_agenda_idx ON public.suenos (agenda_id);

CREATE TRIGGER suenos_set_updated_at
  BEFORE UPDATE ON public.suenos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2.5 deposiciones
CREATE TABLE public.deposiciones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agenda_id   uuid NOT NULL REFERENCES public.agendas_diarias(id) ON DELETE CASCADE,
  hora        time NULL,
  tipo        public.tipo_deposicion NOT NULL,
  consistencia public.consistencia_deposicion NULL,
  cantidad    public.cantidad_deposicion NOT NULL,
  observaciones text NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deposiciones_consistencia_solo_caca CHECK (
    NOT (tipo = 'pipi' AND consistencia IS NOT NULL)
  ),
  CONSTRAINT deposiciones_observaciones_len CHECK (
    observaciones IS NULL OR length(observaciones) <= 500
  )
);

CREATE INDEX deposiciones_agenda_idx ON public.deposiciones (agenda_id);

CREATE TRIGGER deposiciones_set_updated_at
  BEFORE UPDATE ON public.deposiciones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 3. Helpers RLS ───────────────────────────────────────────────────────

-- Ventana de edición = el día calendario actual en huso Europe/Madrid.
-- ADR-0011 documenta la decisión de hardcodear Madrid (NIDO arranca single-
-- tenant en Valencia, mismo huso CET). Cuando se incorpore un centro fuera de
-- ese huso, migraremos a centros.timezone y reescribiremos el helper.
CREATE OR REPLACE FUNCTION public.dentro_de_ventana_edicion(p_fecha date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_fecha = (now() AT TIME ZONE 'Europe/Madrid')::date;
$$;

-- Lookups vía agenda_id sin disparar RLS de agendas_diarias / ninos
-- (patrón ADR-0007 — evitar recursión RLS por subqueries inline).
CREATE OR REPLACE FUNCTION public.centro_de_agenda(p_agenda_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT n.centro_id
  FROM public.agendas_diarias a
  JOIN public.ninos n ON n.id = a.nino_id
  WHERE a.id = p_agenda_id;
$$;

CREATE OR REPLACE FUNCTION public.nino_de_agenda(p_agenda_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT nino_id FROM public.agendas_diarias WHERE id = p_agenda_id;
$$;

CREATE OR REPLACE FUNCTION public.fecha_de_agenda(p_agenda_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT fecha FROM public.agendas_diarias WHERE id = p_agenda_id;
$$;

-- ─── 4. GRANTs ────────────────────────────────────────────────────────────
-- El motor RLS invoca los helpers internamente, pero exponer EXECUTE al rol
-- `authenticated` es buena práctica (paridad con Fase 2 fix RLS).
GRANT EXECUTE ON FUNCTION public.dentro_de_ventana_edicion(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.centro_de_agenda(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nino_de_agenda(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fecha_de_agenda(uuid) TO authenticated;

-- ─── 5. RLS — agendas_diarias ─────────────────────────────────────────────
ALTER TABLE public.agendas_diarias ENABLE ROW LEVEL SECURITY;

CREATE POLICY agenda_select ON public.agendas_diarias
  FOR SELECT
  USING (
    public.es_admin(public.centro_de_nino(nino_id))
    OR public.es_profe_de_nino(nino_id)
    OR public.tiene_permiso_sobre(nino_id, 'puede_ver_agenda')
  );

CREATE POLICY agenda_insert ON public.agendas_diarias
  FOR INSERT
  WITH CHECK (
    public.dentro_de_ventana_edicion(fecha)
    AND (
      public.es_admin(public.centro_de_nino(nino_id))
      OR public.es_profe_de_nino(nino_id)
    )
  );

CREATE POLICY agenda_update ON public.agendas_diarias
  FOR UPDATE
  USING (
    public.dentro_de_ventana_edicion(fecha)
    AND (
      public.es_admin(public.centro_de_nino(nino_id))
      OR public.es_profe_de_nino(nino_id)
    )
  )
  WITH CHECK (
    public.dentro_de_ventana_edicion(fecha)
    AND (
      public.es_admin(public.centro_de_nino(nino_id))
      OR public.es_profe_de_nino(nino_id)
    )
  );

-- DELETE: ninguna policy → default DENY ALL.

-- ─── 6. RLS — tablas hijo (comidas, biberones, suenos, deposiciones) ──────
-- Mismo patrón replicado, derivando vía agenda_id.

-- 6.1 comidas
ALTER TABLE public.comidas ENABLE ROW LEVEL SECURITY;

CREATE POLICY comida_select ON public.comidas
  FOR SELECT
  USING (
    public.es_admin(public.centro_de_agenda(agenda_id))
    OR public.es_profe_de_nino(public.nino_de_agenda(agenda_id))
    OR public.tiene_permiso_sobre(public.nino_de_agenda(agenda_id), 'puede_ver_agenda')
  );

CREATE POLICY comida_insert ON public.comidas
  FOR INSERT
  WITH CHECK (
    public.dentro_de_ventana_edicion(public.fecha_de_agenda(agenda_id))
    AND (
      public.es_admin(public.centro_de_agenda(agenda_id))
      OR public.es_profe_de_nino(public.nino_de_agenda(agenda_id))
    )
  );

CREATE POLICY comida_update ON public.comidas
  FOR UPDATE
  USING (
    public.dentro_de_ventana_edicion(public.fecha_de_agenda(agenda_id))
    AND (
      public.es_admin(public.centro_de_agenda(agenda_id))
      OR public.es_profe_de_nino(public.nino_de_agenda(agenda_id))
    )
  )
  WITH CHECK (
    public.dentro_de_ventana_edicion(public.fecha_de_agenda(agenda_id))
    AND (
      public.es_admin(public.centro_de_agenda(agenda_id))
      OR public.es_profe_de_nino(public.nino_de_agenda(agenda_id))
    )
  );

-- 6.2 biberones
ALTER TABLE public.biberones ENABLE ROW LEVEL SECURITY;

CREATE POLICY biberon_select ON public.biberones
  FOR SELECT
  USING (
    public.es_admin(public.centro_de_agenda(agenda_id))
    OR public.es_profe_de_nino(public.nino_de_agenda(agenda_id))
    OR public.tiene_permiso_sobre(public.nino_de_agenda(agenda_id), 'puede_ver_agenda')
  );

CREATE POLICY biberon_insert ON public.biberones
  FOR INSERT
  WITH CHECK (
    public.dentro_de_ventana_edicion(public.fecha_de_agenda(agenda_id))
    AND (
      public.es_admin(public.centro_de_agenda(agenda_id))
      OR public.es_profe_de_nino(public.nino_de_agenda(agenda_id))
    )
  );

CREATE POLICY biberon_update ON public.biberones
  FOR UPDATE
  USING (
    public.dentro_de_ventana_edicion(public.fecha_de_agenda(agenda_id))
    AND (
      public.es_admin(public.centro_de_agenda(agenda_id))
      OR public.es_profe_de_nino(public.nino_de_agenda(agenda_id))
    )
  )
  WITH CHECK (
    public.dentro_de_ventana_edicion(public.fecha_de_agenda(agenda_id))
    AND (
      public.es_admin(public.centro_de_agenda(agenda_id))
      OR public.es_profe_de_nino(public.nino_de_agenda(agenda_id))
    )
  );

-- 6.3 suenos
ALTER TABLE public.suenos ENABLE ROW LEVEL SECURITY;

CREATE POLICY sueno_select ON public.suenos
  FOR SELECT
  USING (
    public.es_admin(public.centro_de_agenda(agenda_id))
    OR public.es_profe_de_nino(public.nino_de_agenda(agenda_id))
    OR public.tiene_permiso_sobre(public.nino_de_agenda(agenda_id), 'puede_ver_agenda')
  );

CREATE POLICY sueno_insert ON public.suenos
  FOR INSERT
  WITH CHECK (
    public.dentro_de_ventana_edicion(public.fecha_de_agenda(agenda_id))
    AND (
      public.es_admin(public.centro_de_agenda(agenda_id))
      OR public.es_profe_de_nino(public.nino_de_agenda(agenda_id))
    )
  );

CREATE POLICY sueno_update ON public.suenos
  FOR UPDATE
  USING (
    public.dentro_de_ventana_edicion(public.fecha_de_agenda(agenda_id))
    AND (
      public.es_admin(public.centro_de_agenda(agenda_id))
      OR public.es_profe_de_nino(public.nino_de_agenda(agenda_id))
    )
  )
  WITH CHECK (
    public.dentro_de_ventana_edicion(public.fecha_de_agenda(agenda_id))
    AND (
      public.es_admin(public.centro_de_agenda(agenda_id))
      OR public.es_profe_de_nino(public.nino_de_agenda(agenda_id))
    )
  );

-- 6.4 deposiciones
ALTER TABLE public.deposiciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY deposicion_select ON public.deposiciones
  FOR SELECT
  USING (
    public.es_admin(public.centro_de_agenda(agenda_id))
    OR public.es_profe_de_nino(public.nino_de_agenda(agenda_id))
    OR public.tiene_permiso_sobre(public.nino_de_agenda(agenda_id), 'puede_ver_agenda')
  );

CREATE POLICY deposicion_insert ON public.deposiciones
  FOR INSERT
  WITH CHECK (
    public.dentro_de_ventana_edicion(public.fecha_de_agenda(agenda_id))
    AND (
      public.es_admin(public.centro_de_agenda(agenda_id))
      OR public.es_profe_de_nino(public.nino_de_agenda(agenda_id))
    )
  );

CREATE POLICY deposicion_update ON public.deposiciones
  FOR UPDATE
  USING (
    public.dentro_de_ventana_edicion(public.fecha_de_agenda(agenda_id))
    AND (
      public.es_admin(public.centro_de_agenda(agenda_id))
      OR public.es_profe_de_nino(public.nino_de_agenda(agenda_id))
    )
  )
  WITH CHECK (
    public.dentro_de_ventana_edicion(public.fecha_de_agenda(agenda_id))
    AND (
      public.es_admin(public.centro_de_agenda(agenda_id))
      OR public.es_profe_de_nino(public.nino_de_agenda(agenda_id))
    )
  );

-- ─── 7. audit_trigger_function ampliada ───────────────────────────────────
-- Reemplazamos el cuerpo entero. A partir de aquí esta es la "verdad". Añade
-- rama para agendas_diarias (vía centro_de_nino) y para las 4 tablas hijo
-- (vía centro_de_agenda). Las ramas previas (Fases 2 y 2.6) se preservan.
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
    'datos_pedagogicos_nino'
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

-- ─── 8. Triggers de audit en las 5 tablas nuevas ──────────────────────────
CREATE TRIGGER audit_agendas_diarias
  AFTER INSERT OR UPDATE OR DELETE ON public.agendas_diarias
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

CREATE TRIGGER audit_comidas
  AFTER INSERT OR UPDATE OR DELETE ON public.comidas
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

CREATE TRIGGER audit_biberones
  AFTER INSERT OR UPDATE OR DELETE ON public.biberones
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

CREATE TRIGGER audit_suenos
  AFTER INSERT OR UPDATE OR DELETE ON public.suenos
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

CREATE TRIGGER audit_deposiciones
  AFTER INSERT OR UPDATE OR DELETE ON public.deposiciones
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

-- ─── 9. Realtime publication ──────────────────────────────────────────────
-- Habilitamos `postgres_changes` sobre las 5 tablas. Las RLS de SELECT se
-- aplican también a las notificaciones Realtime — los clientes solo reciben
-- eventos sobre filas que su rol puede leer.
ALTER PUBLICATION supabase_realtime ADD TABLE
  public.agendas_diarias,
  public.comidas,
  public.biberones,
  public.suenos,
  public.deposiciones;

-- ─── 10. Backfill permiso JSONB `puede_ver_agenda` ────────────────────────
-- Añade la clave `puede_ver_agenda` al JSONB `permisos` de cada vínculo
-- existente. Default: `true` para tutores legales (tipo_vinculo
-- 'tutor_legal_principal' o 'tutor_legal_secundario'), `false` para
-- autorizados. Idempotente: solo se aplica a vínculos que aún no tengan la
-- clave.
UPDATE public.vinculos_familiares
SET permisos = permisos || jsonb_build_object(
  'puede_ver_agenda',
  tipo_vinculo IN ('tutor_legal_principal', 'tutor_legal_secundario')
)
WHERE NOT (permisos ? 'puede_ver_agenda');
