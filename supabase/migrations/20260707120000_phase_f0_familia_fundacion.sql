-- =============================================================================
-- F-0 · Fundación del modelo FAMILIA (rediseño facturación/agrupación)
-- -----------------------------------------------------------------------------
-- ADITIVA e INERTE: crea 2 tablas VACÍAS (familias, familia_tutores), añade
-- columnas `familia_id` NULLABLE (ignoradas por el código actual) y 3 helpers
-- RLS que NINGUNA policy usa aún. No toca ninguna tabla/columna/RPC/policy/
-- trigger existente ni la función de audit compartida. Sin migración de datos.
--
-- Decisiones aplicadas: rol_familia = CHECK (no enum); usuario_id ON DELETE SET
-- NULL; familia_tutores.familia_id ON DELETE CASCADE; familia_id de negocio
-- ON DELETE RESTRICT; SIN auditoría en F-0 (se cablea en F-2); "un adulto = una
-- familia" como índice único parcial sobre filas ACTIVAS; dirección del hogar en
-- el PERFIL del tutor (familia_tutores), no en familias.
--
-- Aplicar por SQL Editor (rol postgres). NO por CLI. Regenerar database.ts DESPUÉS.
-- =============================================================================
BEGIN;

-- -----------------------------------------------------------------------------
-- 1. TABLA familias — unidad de agrupación/facturación. Centro-scoped, soft-delete.
--    Sin dirección (vive en el perfil del tutor). `etiqueta` = apellidos a mostrar.
-- -----------------------------------------------------------------------------
CREATE TABLE public.familias (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id  uuid NOT NULL REFERENCES public.centros(id) ON DELETE RESTRICT,
  etiqueta   text NOT NULL CHECK (char_length(etiqueta) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_familias_centro
  ON public.familias (centro_id) WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- 2. TABLA familia_tutores — membresía + PERFIL ÚNICO del adulto (sustituye la
--    duplicación per-niño de datos_tutor). Dirección del hogar del tutor AQUÍ
--    (cubre padres separados). usuario_id NULLABLE (tutor tecleado antes de
--    tener cuenta). rol_familia por CHECK. Soft-delete.
-- -----------------------------------------------------------------------------
CREATE TABLE public.familia_tutores (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  familia_id          uuid NOT NULL REFERENCES public.familias(id) ON DELETE CASCADE,
  usuario_id          uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  rol_familia         text NOT NULL CHECK (rol_familia IN ('titular', 'segundo_tutor')),
  email               text CHECK (email IS NULL OR char_length(email) <= 255),
  nombre_completo     text CHECK (nombre_completo IS NULL OR char_length(nombre_completo) <= 200),
  dni_documento_path  text,
  direccion_calle     text,
  direccion_numero    text,
  direccion_cp        text,
  direccion_ciudad    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

-- Un usuario no figura dos veces en la MISMA familia (fila activa).
CREATE UNIQUE INDEX ux_familia_tutores_familia_usuario
  ON public.familia_tutores (familia_id, usuario_id)
  WHERE usuario_id IS NOT NULL AND deleted_at IS NULL;

-- "UN ADULTO = UNA FAMILIA": un usuario_id no está en DOS familias activas.
CREATE UNIQUE INDEX ux_familia_tutores_usuario_unico
  ON public.familia_tutores (usuario_id)
  WHERE usuario_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_familia_tutores_familia
  ON public.familia_tutores (familia_id) WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- 3. Triggers updated_at (reutiliza la función compartida real public.set_updated_at()).
-- -----------------------------------------------------------------------------
CREATE TRIGGER familias_set_updated_at
  BEFORE UPDATE ON public.familias
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER familia_tutores_set_updated_at
  BEFORE UPDATE ON public.familia_tutores
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. RLS ON sin policies → default DENY (locked). El service_role BYPASSA RLS,
--    así que el alta (F-2, service-role) escribirá pese al deny-all. Las policies
--    de tutor/admin llegan en F-2/F-5.
-- -----------------------------------------------------------------------------
ALTER TABLE public.familias        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.familia_tutores ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 5. Columnas familia_id NULLABLE e INERTES (se pueblan/hacen NOT NULL en fases
--    posteriores). Nullable + FK NO rompe inserts actuales (omiten la columna →
--    NULL; la FK solo valida si NO es NULL). ON DELETE RESTRICT (integridad).
-- -----------------------------------------------------------------------------
ALTER TABLE public.ninos
  ADD COLUMN familia_id uuid REFERENCES public.familias(id) ON DELETE RESTRICT;
CREATE INDEX idx_ninos_familia
  ON public.ninos (familia_id) WHERE familia_id IS NOT NULL;

ALTER TABLE public.mandatos_sepa
  ADD COLUMN familia_id uuid REFERENCES public.familias(id) ON DELETE RESTRICT;
CREATE INDEX idx_mandatos_sepa_familia
  ON public.mandatos_sepa (familia_id) WHERE familia_id IS NOT NULL;

ALTER TABLE public.recibos
  ADD COLUMN familia_id uuid REFERENCES public.familias(id) ON DELETE RESTRICT;
CREATE INDEX idx_recibos_familia
  ON public.recibos (familia_id) WHERE familia_id IS NOT NULL;

ALTER TABLE public.metodo_pago_familia
  ADD COLUMN familia_id uuid REFERENCES public.familias(id) ON DELETE RESTRICT;
CREATE INDEX idx_metodo_pago_familia_familia
  ON public.metodo_pago_familia (familia_id) WHERE familia_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 6. HELPERS RLS INERTES (aún no los invoca ninguna policy). STABLE, SECURITY
--    DEFINER, search_path fijo. Leen OTRAS tablas → seguros frente al gotcha
--    MVCC de INSERT…RETURNING cuando se usen en policies (F-5).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.familia_de_nino(p_nino_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT familia_id FROM public.ninos WHERE id = p_nino_id;
$$;

CREATE OR REPLACE FUNCTION public.centro_de_familia(p_familia_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT centro_id FROM public.familias WHERE id = p_familia_id;
$$;

CREATE OR REPLACE FUNCTION public.es_tutor_de_familia(p_familia_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.familia_tutores ft
    WHERE ft.familia_id = p_familia_id
      AND ft.usuario_id = auth.uid()
      AND ft.deleted_at IS NULL
  );
$$;

GRANT EXECUTE ON FUNCTION public.familia_de_nino(uuid)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.centro_de_familia(uuid)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.es_tutor_de_familia(uuid) TO authenticated, service_role;

COMMIT;
