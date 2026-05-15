-- =============================================================================
-- Fase 4 — Asistencia + ausencias
-- =============================================================================
-- 2 tablas operativas (asistencias y ausencias), 2 ENUMs, helper hoy_madrid
-- para coherencia con ADR-0011 (huso Madrid), políticas RLS por tabla
-- (asistencia con ventana ADR-0013/0016, ausencia con permiso JSONB
-- separado `puede_reportar_ausencias` introducido en esta fase), audit log
-- automático (extiende audit_trigger_function), Realtime publication,
-- backfill JSONB de `puede_reportar_ausencias` en vinculos_familiares.
--
-- Spec: docs/specs/attendance.md
-- ADRs: 0014 (pase de lista reutilizable), 0015 (asistencia lazy),
--       0016 (día cerrado para todos los roles, transversal).
-- =============================================================================

-- ─── 1. ENUMs ─────────────────────────────────────────────────────────────
CREATE TYPE public.estado_asistencia AS ENUM (
  'presente', 'ausente', 'llegada_tarde', 'salida_temprana'
);

CREATE TYPE public.motivo_ausencia AS ENUM (
  'enfermedad', 'cita_medica', 'vacaciones', 'familiar', 'otro'
);

-- ─── 2. Tabla asistencias ─────────────────────────────────────────────────
CREATE TABLE public.asistencias (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nino_id       uuid NOT NULL REFERENCES public.ninos(id) ON DELETE RESTRICT,
  fecha         date NOT NULL,
  estado        public.estado_asistencia NOT NULL,
  hora_llegada  time NULL,
  hora_salida   time NULL,
  observaciones text NULL,
  registrada_por uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asistencias_nino_fecha_unique UNIQUE (nino_id, fecha),
  CONSTRAINT asistencias_obs_len CHECK (
    observaciones IS NULL OR length(observaciones) <= 500
  ),
  CONSTRAINT asistencias_salida_posterior CHECK (
    hora_salida IS NULL OR hora_llegada IS NULL OR hora_salida > hora_llegada
  )
);

CREATE INDEX asistencias_fecha_idx ON public.asistencias (fecha DESC);
CREATE INDEX asistencias_nino_fecha_idx ON public.asistencias (nino_id, fecha DESC);

CREATE TRIGGER asistencias_set_updated_at
  BEFORE UPDATE ON public.asistencias
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 3. Tabla ausencias ───────────────────────────────────────────────────
CREATE TABLE public.ausencias (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nino_id       uuid NOT NULL REFERENCES public.ninos(id) ON DELETE RESTRICT,
  fecha_inicio  date NOT NULL,
  fecha_fin     date NOT NULL,
  motivo        public.motivo_ausencia NOT NULL,
  descripcion   text NULL,
  reportada_por uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ausencias_rango CHECK (fecha_fin >= fecha_inicio),
  CONSTRAINT ausencias_descripcion_len CHECK (
    descripcion IS NULL OR length(descripcion) <= 500
  )
);

CREATE INDEX ausencias_nino_inicio_idx ON public.ausencias (nino_id, fecha_inicio DESC);
-- Soporta el LEFT JOIN del pase de lista: `fecha BETWEEN fecha_inicio AND
-- fecha_fin`. Postgres usa bien índice compuesto con condición rango.
CREATE INDEX ausencias_rango_idx ON public.ausencias (fecha_inicio, fecha_fin);

CREATE TRIGGER ausencias_set_updated_at
  BEFORE UPDATE ON public.ausencias
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 4. Helper RLS: hoy_madrid ────────────────────────────────────────────
-- Wrapper sobre `(now() AT TIME ZONE 'Europe/Madrid')::date` para uso en
-- políticas RLS de `ausencias`. Mismo huso que ADR-0011 / ADR-0013.
-- Es STABLE (no IMMUTABLE) porque depende de `now()`.
CREATE OR REPLACE FUNCTION public.hoy_madrid()
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (now() AT TIME ZONE 'Europe/Madrid')::date;
$$;

GRANT EXECUTE ON FUNCTION public.hoy_madrid() TO authenticated;

-- ─── 5. RLS: asistencias ──────────────────────────────────────────────────
-- ADR-0013/0016: día cerrado para todos los roles incluido admin.
-- Reutiliza `dentro_de_ventana_edicion(fecha)` introducido en Fase 3.
ALTER TABLE public.asistencias ENABLE ROW LEVEL SECURITY;

CREATE POLICY asistencia_select ON public.asistencias
  FOR SELECT
  USING (
    public.es_admin(public.centro_de_nino(nino_id))
    OR public.es_profe_de_nino(nino_id)
    OR public.tiene_permiso_sobre(nino_id, 'puede_ver_agenda')
  );

CREATE POLICY asistencia_insert ON public.asistencias
  FOR INSERT
  WITH CHECK (
    public.dentro_de_ventana_edicion(fecha)
    AND (
      public.es_admin(public.centro_de_nino(nino_id))
      OR public.es_profe_de_nino(nino_id)
    )
  );

CREATE POLICY asistencia_update ON public.asistencias
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

-- DELETE: ninguna policy → default DENY (cancelaciones por SQL con service_role)

-- ─── 6. RLS: ausencias ────────────────────────────────────────────────────
-- SELECT gated por `puede_ver_agenda` (mismo permiso que la agenda diaria).
-- INSERT/UPDATE gated por permiso separado `puede_reportar_ausencias`
-- (semánticamente distinto: leer ≠ reportar).
ALTER TABLE public.ausencias ENABLE ROW LEVEL SECURITY;

CREATE POLICY ausencia_select ON public.ausencias
  FOR SELECT
  USING (
    public.es_admin(public.centro_de_nino(nino_id))
    OR public.es_profe_de_nino(nino_id)
    OR public.tiene_permiso_sobre(nino_id, 'puede_ver_agenda')
  );

-- INSERT: admin siempre; profe del aula siempre (registro retrospectivo);
--         tutor con `puede_reportar_ausencias` solo para fecha_inicio
--         futura/hoy.
CREATE POLICY ausencia_insert ON public.ausencias
  FOR INSERT
  WITH CHECK (
    public.es_admin(public.centro_de_nino(nino_id))
    OR public.es_profe_de_nino(nino_id)
    OR (
      public.tiene_permiso_sobre(nino_id, 'puede_reportar_ausencias')
      AND fecha_inicio >= public.hoy_madrid()
    )
  );

-- UPDATE:
--  - admin del centro siempre,
--  - tutor con permiso si fecha_inicio del registro original y del nuevo
--    son >= hoy,
--  - profe que reportó la ausencia (`reportada_por = auth.uid()`) puede
--    UPDATE; la server action valida que el único cambio sea aplicar el
--    prefijo `[cancelada] ` (cancelación). La RLS no inspecciona qué
--    columnas cambian — eso queda en la server action con Zod.
CREATE POLICY ausencia_update ON public.ausencias
  FOR UPDATE
  USING (
    public.es_admin(public.centro_de_nino(nino_id))
    OR (
      public.tiene_permiso_sobre(nino_id, 'puede_reportar_ausencias')
      AND fecha_inicio >= public.hoy_madrid()
    )
    OR (
      public.es_profe_de_nino(nino_id)
      AND reportada_por = auth.uid()
    )
  )
  WITH CHECK (
    public.es_admin(public.centro_de_nino(nino_id))
    OR (
      public.tiene_permiso_sobre(nino_id, 'puede_reportar_ausencias')
      AND fecha_inicio >= public.hoy_madrid()
    )
    OR (
      public.es_profe_de_nino(nino_id)
      AND reportada_por = auth.uid()
    )
  );

-- DELETE: ninguna policy → default DENY (cancelaciones via UPDATE con prefijo)

-- ─── 7. audit_trigger_function ampliada ───────────────────────────────────
-- Añade dos ramas: `asistencias` y `ausencias` derivan `centro_id` vía
-- `centro_de_nino(nino_id)`, igual que el resto de tablas con nino_id.
-- CREATE OR REPLACE preserva las ramas previas (Fases 2, 2.6, 3).
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

-- ─── 8. Triggers de audit en las 2 tablas nuevas ──────────────────────────
CREATE TRIGGER audit_asistencias
  AFTER INSERT OR UPDATE OR DELETE ON public.asistencias
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

CREATE TRIGGER audit_ausencias
  AFTER INSERT OR UPDATE OR DELETE ON public.ausencias
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

-- ─── 9. Realtime publication ──────────────────────────────────────────────
-- RLS de SELECT se aplica también a las notificaciones (mismo principio
-- que Fase 3: el filtrado client-side por aula es cosmético).
ALTER PUBLICATION supabase_realtime ADD TABLE
  public.asistencias,
  public.ausencias;

-- ─── 10. Backfill permiso JSONB `puede_reportar_ausencias` ────────────────
-- Default: true para tutor_legal_*, false para autorizado. Idempotente:
-- solo se aplica a vínculos que aún no tengan la clave.
UPDATE public.vinculos_familiares
SET permisos = permisos || jsonb_build_object(
  'puede_reportar_ausencias',
  tipo_vinculo IN ('tutor_legal_principal', 'tutor_legal_secundario')
)
WHERE NOT (permisos ? 'puede_reportar_ausencias');
