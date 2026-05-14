-- =============================================================================
-- Fase 2.6 — Datos pedagógicos del niño + logo del centro
-- =============================================================================
-- 1. centros.logo_url + seed para ANAIA.
-- 2. ENUMs nuevos: lactancia_estado, control_esfinteres, tipo_alimentacion.
-- 3. Tabla datos_pedagogicos_nino (1:1 con ninos, ON DELETE RESTRICT).
-- 4. Trigger updated_at.
-- 5. RLS habilitada + 3 policies (admin/profe/tutor) reusando helpers.
-- 6. audit_trigger_function() extendida con rama nueva y trigger AFTER.
-- 7. Backfill JSONB: puede_ver_datos_pedagogicos en vinculos_familiares.
-- =============================================================================

BEGIN;

-- ─── 1. centros.logo_url ───────────────────────────────────────────────────
ALTER TABLE public.centros ADD COLUMN logo_url TEXT NULL;

UPDATE public.centros
  SET logo_url = '/brand/anaia-logo-wordmark.png'
  WHERE id = '33c79b50-13b5-4962-b849-d88dd6a21366';

-- ─── 2a. Helper IMMUTABLE para validar idiomas_casa en CHECK ───────────────
-- Postgres no admite subqueries en CHECK; usamos una función SQL IMMUTABLE.
-- Devuelve TRUE si TODOS los códigos tienen exactamente 2 caracteres.
CREATE OR REPLACE FUNCTION public.idiomas_iso_2letras(p_codigos text[])
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT bool_and(length(c) = 2) FROM unnest(p_codigos) AS c;
$$;

-- ─── 2b. ENUMs ─────────────────────────────────────────────────────────────
CREATE TYPE public.lactancia_estado AS ENUM (
  'materna','biberon','mixta','finalizada','no_aplica'
);

CREATE TYPE public.control_esfinteres AS ENUM (
  'panal_completo','transicion','sin_panal_diurno','sin_panal_total'
);

CREATE TYPE public.tipo_alimentacion AS ENUM (
  'omnivora','vegetariana','vegana','sin_lactosa','sin_gluten',
  'religiosa_halal','religiosa_kosher','otra'
);

-- ─── 3. Tabla datos_pedagogicos_nino ───────────────────────────────────────
CREATE TABLE public.datos_pedagogicos_nino (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nino_id UUID NOT NULL UNIQUE REFERENCES public.ninos(id) ON DELETE RESTRICT,
  lactancia_estado public.lactancia_estado NOT NULL,
  lactancia_observaciones TEXT,
  control_esfinteres public.control_esfinteres NOT NULL,
  control_esfinteres_observaciones TEXT,
  siesta_horario_habitual TEXT,
  siesta_numero_diario SMALLINT,
  siesta_observaciones TEXT,
  tipo_alimentacion public.tipo_alimentacion NOT NULL,
  alimentacion_observaciones TEXT,
  idiomas_casa TEXT[] NOT NULL,
  tiene_hermanos_en_centro BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT siesta_numero_diario_range
    CHECK (siesta_numero_diario IS NULL OR (siesta_numero_diario >= 0 AND siesta_numero_diario <= 5)),
  CONSTRAINT idiomas_casa_length
    CHECK (
      array_length(idiomas_casa, 1) BETWEEN 1 AND 8
      AND public.idiomas_iso_2letras(idiomas_casa)
    ),
  CONSTRAINT alimentacion_otra_requiere_obs
    CHECK (
      tipo_alimentacion <> 'otra'
      OR (alimentacion_observaciones IS NOT NULL AND length(trim(alimentacion_observaciones)) > 0)
    )
);

-- ─── 4. Trigger updated_at ─────────────────────────────────────────────────
CREATE TRIGGER datos_pedagogicos_nino_set_updated_at
  BEFORE UPDATE ON public.datos_pedagogicos_nino
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 5. RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.datos_pedagogicos_nino ENABLE ROW LEVEL SECURITY;

CREATE POLICY dp_admin_all ON public.datos_pedagogicos_nino
  FOR ALL TO authenticated
  USING (public.es_admin(public.centro_de_nino(nino_id)))
  WITH CHECK (public.es_admin(public.centro_de_nino(nino_id)));

CREATE POLICY dp_profe_select ON public.datos_pedagogicos_nino
  FOR SELECT TO authenticated
  USING (public.es_profe_de_nino(nino_id));

CREATE POLICY dp_tutor_select ON public.datos_pedagogicos_nino
  FOR SELECT TO authenticated
  USING (public.tiene_permiso_sobre(nino_id, 'puede_ver_datos_pedagogicos'));

-- ─── 6. audit_trigger_function extendida + trigger en la tabla nueva ───────
-- La función original (Fase 2) usa IF/ELSIF por TG_TABLE_NAME para derivar
-- centro_id. La extendemos para incluir datos_pedagogicos_nino. CREATE OR
-- REPLACE reemplaza el cuerpo entero; a partir de aquí esta es la "verdad".
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

CREATE TRIGGER audit_datos_pedagogicos_nino
  AFTER INSERT OR UPDATE OR DELETE ON public.datos_pedagogicos_nino
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

-- ─── 7. Backfill permiso JSONB ────────────────────────────────────────────
-- Añade `puede_ver_datos_pedagogicos` al JSONB `permisos` de cada vínculo
-- existente. El valor se hereda de `puede_ver_info_medica` (true → true,
-- false / null → false), de forma que la visibilidad existente se preserva
-- sin sorpresas para los tutores que ya podían ver info médica.
UPDATE public.vinculos_familiares
SET permisos = permisos || jsonb_build_object(
  'puede_ver_datos_pedagogicos',
  COALESCE((permisos->>'puede_ver_info_medica')::boolean, false)
)
WHERE NOT (permisos ? 'puede_ver_datos_pedagogicos');

COMMIT;
