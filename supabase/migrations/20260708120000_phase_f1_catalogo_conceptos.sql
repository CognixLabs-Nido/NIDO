-- =============================================================================
-- F-1 · Catálogo de conceptos configurable (rediseño facturación → Familia)
-- -----------------------------------------------------------------------------
-- ADITIVA e INERTE. Evoluciona el catálogo `conceptos_cobro` (ADD COLUMN con
-- DEFAULT → no rompe filas/inserts actuales) y crea `aplicaciones_concepto`
-- (instancia genérica concepto→niño/familia/mes) VACÍA con RLS deny-all. NADIE
-- lo consume hasta F-4 (motor): el cierre actual sigue leyendo asignacion_cuota
-- + conceptos_cobro.precio_* + parte_servicio_diario como hoy. Sin migración de
-- datos. `becas` y `asignacion_cuota` NO se tocan.
--
-- Verificado: el insert de `conceptos-cobro` (Zod superRefine) exige precio para
-- todo tipo_concepto → el CHECK de coherencia fijo⇒importe no rompe nada.
-- Aplicar por SQL Editor (rol postgres). NO por CLI. Regenerar database.ts DESPUÉS.
-- =============================================================================
BEGIN;

-- -----------------------------------------------------------------------------
-- 1. CATÁLOGO — evolución de conceptos_cobro. Todas las columnas nuevas con
--    DEFAULT (los inserts actuales que las omiten siguen válidos). Se conservan
--    precio_mensual_centimos/precio_diario_centimos/tipo_concepto/servicio.
-- -----------------------------------------------------------------------------
ALTER TABLE public.conceptos_cobro
  ADD COLUMN signo            smallint NOT NULL DEFAULT 1
             CHECK (signo IN (1, -1)),
  ADD COLUMN ambito           text NOT NULL DEFAULT 'nino'
             CHECK (ambito IN ('nino', 'familia')),
  ADD COLUMN aplicacion       text NOT NULL DEFAULT 'manual'
             CHECK (aplicacion IN ('automatico', 'manual')),
  ADD COLUMN tipo_valor       text NOT NULL DEFAULT 'fijo'
             CHECK (tipo_valor IN ('fijo', 'porcentaje')),
  ADD COLUMN porcentaje_bp    integer
             CHECK (porcentaje_bp IS NULL OR porcentaje_bp >= 0),
  ADD COLUMN importe_centimos integer
             CHECK (importe_centimos IS NULL OR importe_centimos >= 0);

-- Coherencia valor↔importe (verificado: no rompe inserts actuales, tabla vacía).
ALTER TABLE public.conceptos_cobro
  ADD CONSTRAINT conceptos_cobro_valor_coherente CHECK (
    (tipo_valor = 'porcentaje' AND porcentaje_bp IS NOT NULL)
    OR
    (tipo_valor = 'fijo' AND (
         precio_mensual_centimos IS NOT NULL
      OR precio_diario_centimos  IS NOT NULL
      OR importe_centimos        IS NOT NULL))
  );

-- -----------------------------------------------------------------------------
-- 2. INSTANCIA — aplicaciones_concepto: un concepto aplicado a un niño O a una
--    familia en un (anio, mes). Genérica (supersede a asignacion_cuota en F-4).
-- -----------------------------------------------------------------------------
CREATE TABLE public.aplicaciones_concepto (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id                 uuid NOT NULL REFERENCES public.centros(id)          ON DELETE RESTRICT,
  concepto_id               uuid NOT NULL REFERENCES public.conceptos_cobro(id)  ON DELETE RESTRICT,
  nino_id                   uuid REFERENCES public.ninos(id)                     ON DELETE RESTRICT,
  familia_id                uuid REFERENCES public.familias(id)                  ON DELETE RESTRICT,
  anio                      integer NOT NULL CHECK (anio BETWEEN 2024 AND 2100),
  mes                       integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
  cantidad                  integer NOT NULL DEFAULT 1 CHECK (cantidad >= 1),
  -- CENTRAL: precio ad-hoc manual distinto del catálogo (puntual).
  importe_override_centimos integer CHECK (importe_override_centimos IS NULL OR importe_override_centimos >= 0),
  origen                    text NOT NULL CHECK (origen IN ('automatico', 'manual')),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  deleted_at                timestamptz,
  -- Ámbito exclusivo: exactamente uno de niño/familia.
  CONSTRAINT aplicaciones_concepto_ambito_xor
    CHECK ((nino_id IS NOT NULL) <> (familia_id IS NOT NULL))
);

-- Anti-duplicado del cargo AUTOMÁTICO recurrente: un concepto automático por
-- (destino, mes). Se usa COALESCE(nino_id, familia_id) como "destino" porque un
-- UNIQUE sobre (nino_id, familia_id) con NULLs los trataría como distintos y NO
-- deduplicaría (los NULL son siempre distintos en índices únicos). El XOR
-- garantiza que exactamente uno no es NULL. Los cargos MANUALES no se limitan
-- (p.ej. dos "hora extra" el mismo mes).
CREATE UNIQUE INDEX ux_aplicaciones_concepto_automatico
  ON public.aplicaciones_concepto (concepto_id, COALESCE(nino_id, familia_id), anio, mes)
  WHERE origen = 'automatico' AND deleted_at IS NULL;

-- Índices de acceso (motor F-4 + consultas por destino/mes).
CREATE INDEX idx_aplicaciones_concepto_nino
  ON public.aplicaciones_concepto (nino_id, anio, mes)    WHERE deleted_at IS NULL;
CREATE INDEX idx_aplicaciones_concepto_familia
  ON public.aplicaciones_concepto (familia_id, anio, mes) WHERE deleted_at IS NULL;
CREATE INDEX idx_aplicaciones_concepto_centro_mes
  ON public.aplicaciones_concepto (centro_id, anio, mes)  WHERE deleted_at IS NULL;
CREATE INDEX idx_aplicaciones_concepto_concepto
  ON public.aplicaciones_concepto (concepto_id);

-- updated_at (función compartida real, verificada en F-0).
CREATE TRIGGER aplicaciones_concepto_set_updated_at
  BEFORE UPDATE ON public.aplicaciones_concepto
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ON sin policies → deny-all (inerte). El service_role la bypassa; las
-- policies admin-CRUD llegan con la UI de gestión (F-4/config). Sin auditoría en F-1.
ALTER TABLE public.aplicaciones_concepto ENABLE ROW LEVEL SECURITY;

COMMIT;
