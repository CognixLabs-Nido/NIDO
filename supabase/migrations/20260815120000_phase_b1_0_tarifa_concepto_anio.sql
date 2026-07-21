-- =============================================================================
-- B1-0 · Importe de concepto por AÑO DE NACIMIENTO (solo esquema — sin motor, sin UI)
-- -----------------------------------------------------------------------------
-- Tercer modo de precio de un concepto de cobro: además del importe único del catálogo
-- (`conceptos_cobro.importe_centimos`) y del override manual por asignación
-- (`asignacion_concepto.importe_override_centimos`), un concepto puede fijar su importe
-- por AÑO DE NACIMIENTO literal del niño (el ayuntamiento cobra distinto por edad).
--
-- Esta migración crea SOLO:
--   1) el flag `conceptos_cobro.tarifa_por_anio_nacimiento` (default false: comportamiento
--      idéntico a hoy salvo que se marque explícitamente — NADA implícito por filas),
--   2) la tabla `tarifa_concepto_anio` (importe por concepto y año de nacimiento) + RLS
--      admin-only + coherencia de centro,
--   3) el helper `centro_de_concepto(uuid)` (no existía) para la coherencia de centro.
-- NO toca el motor (`generar_recibos_mes`, PR-2/B1-1) ni ninguna UI (PR-3/B1-2).
--
-- PRECEDENCIA (la resolverá el motor en B1-1): override manual > tarifa del año (si el flag
-- está activo y hay fila para el año del niño) > importe base del catálogo. Sin fecha de
-- nacimiento o sin fila para el año → importe base (fallback, decisión de Jose).
--
-- RLS: SOLO admin del centro en las 4 operaciones (patrón `beca_comedor_mes`), vía
-- `es_admin(centro_id)`. Deliberadamente NO se usa `pertenece_a_centro` (incluiría a
-- profes/tutores). Además, en INSERT/UPDATE se exige coherencia de centro: `centro_id`
-- debe ser el del concepto (`centro_de_concepto(concepto_id)`), para que un admin no cuelgue
-- una tarifa de un concepto de OTRO centro.
--
-- Sin trigger de audit_log (fuera de scope, igual que `beca_comedor_mes`). Aplicar por SQL
-- Editor / db push (rol postgres). Regenerar database.ts DESPUÉS de aplicar.
-- =============================================================================
BEGIN;

-- 1) Flag explícito en el catálogo de conceptos.
ALTER TABLE public.conceptos_cobro
  ADD COLUMN tarifa_por_anio_nacimiento boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.conceptos_cobro.tarifa_por_anio_nacimiento IS
  'B1: si TRUE, el motor resuelve el importe unitario por año de nacimiento del niño '
  '(tarifa_concepto_anio) cuando no hay override manual; si FALSE, usa el importe base.';

-- 2) Helper de centro del concepto (no existía; análogo a centro_de_nino).
CREATE OR REPLACE FUNCTION public.centro_de_concepto(p_concepto_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT centro_id FROM public.conceptos_cobro WHERE id = p_concepto_id;
$$;

GRANT EXECUTE ON FUNCTION public.centro_de_concepto(uuid) TO authenticated;

-- 3) Tabla de tarifas por año de nacimiento.
CREATE TABLE public.tarifa_concepto_anio (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concepto_id      uuid NOT NULL REFERENCES public.conceptos_cobro(id) ON DELETE CASCADE,
  centro_id        uuid NOT NULL REFERENCES public.centros(id),
  -- Año de nacimiento literal del niño (EXTRACT(YEAR FROM ninos.fecha_nacimiento)).
  anio_nacimiento  int  NOT NULL CHECK (anio_nacimiento BETWEEN 2000 AND 2100),
  -- Importe unitario para ese año (cuota/mes en mensual; precio/día en diario). >= 0
  -- (0 = gratis para esa edad). Mismo criterio de céntimos que el resto del módulo.
  importe_centimos int  NOT NULL CHECK (importe_centimos >= 0),
  created_by       uuid REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- Una tarifa por concepto y año de nacimiento.
  UNIQUE (concepto_id, anio_nacimiento)
);

COMMENT ON TABLE public.tarifa_concepto_anio IS
  'B1: importe de un concepto por año de nacimiento del niño. Lo consulta el motor solo si '
  'conceptos_cobro.tarifa_por_anio_nacimiento = TRUE y no hay override manual.';

CREATE INDEX idx_tarifa_concepto_anio_concepto
  ON public.tarifa_concepto_anio (concepto_id);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.tarifa_concepto_anio
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS: solo admin del centro; INSERT/UPDATE además exigen coherencia de centro.
-- -----------------------------------------------------------------------------
ALTER TABLE public.tarifa_concepto_anio ENABLE ROW LEVEL SECURITY;

CREATE POLICY tarifa_concepto_anio_select ON public.tarifa_concepto_anio
  FOR SELECT USING (public.es_admin(centro_id));

CREATE POLICY tarifa_concepto_anio_insert ON public.tarifa_concepto_anio
  FOR INSERT WITH CHECK (
    public.es_admin(centro_id)
    AND centro_id = public.centro_de_concepto(concepto_id)
  );

CREATE POLICY tarifa_concepto_anio_update ON public.tarifa_concepto_anio
  FOR UPDATE USING (public.es_admin(centro_id))
  WITH CHECK (
    public.es_admin(centro_id)
    AND centro_id = public.centro_de_concepto(concepto_id)
  );

CREATE POLICY tarifa_concepto_anio_delete ON public.tarifa_concepto_anio
  FOR DELETE USING (public.es_admin(centro_id));

COMMIT;
