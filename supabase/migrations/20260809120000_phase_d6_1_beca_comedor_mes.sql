-- =============================================================================
-- D-6-1 · Beca comedor variable por mes (solo esquema — sin UI, sin motor)
-- -----------------------------------------------------------------------------
-- La beca comedor es un importe que Dirección asigna POR NIÑO Y POR MES, distinto
-- cada mes, que en el recibo de la familia aparecerá como línea NEGATIVA. NO persiste
-- entre meses (se registra el mes que corresponde). Es independiente de la modalidad de
-- comedor (mensual o por días).
--
-- Esta migración crea SOLO la tabla `beca_comedor_mes` + RLS + trigger de updated_at.
-- El importe se guarda en POSITIVO (CHECK importe > 0); el motor de recibos lo aplicará
-- en negativo en D-6-2. NO se toca el motor ni ninguna UI (D-6-2/D-6-3).
--
-- RLS: SOLO admin del centro en las 4 operaciones (SELECT/INSERT/UPDATE/DELETE), vía el
-- helper existente `es_admin(centro_id)`. Deliberadamente NO se usa `pertenece_a_centro`
-- (incluiría a profes/tutores del centro): las profes NO ven ni tocan becas.
--
-- Sin trigger de audit_log (fuera de scope de D-6-1; añadir una rama a
-- audit_trigger_function excede esta migración). Registrado como follow-up para D-6-2/3
-- si se decide auditar el importe de beca.
--
-- Aplicar por SQL Editor / db push (rol postgres). Regenerar database.ts DESPUÉS.
-- =============================================================================
BEGIN;

CREATE TABLE public.beca_comedor_mes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nino_id    uuid NOT NULL REFERENCES public.ninos(id),
  centro_id  uuid NOT NULL REFERENCES public.centros(id),
  anio       int  NOT NULL,
  mes        int  NOT NULL CHECK (mes BETWEEN 1 AND 12),
  -- Se guarda en POSITIVO; el motor de recibos lo aplica en negativo (D-6-2).
  importe    numeric(10,2) NOT NULL CHECK (importe > 0),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Una beca comedor por niño y mes (no persiste entre meses).
  UNIQUE (nino_id, anio, mes)
);

COMMENT ON TABLE public.beca_comedor_mes IS
  'D-6: beca comedor variable por niño y mes. importe en positivo; el recibo la aplica en negativo (D-6-2).';

-- updated_at por trigger estándar del repo.
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.beca_comedor_mes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS: solo admin del centro (es_admin(centro_id)) en las 4 operaciones.
-- -----------------------------------------------------------------------------
ALTER TABLE public.beca_comedor_mes ENABLE ROW LEVEL SECURITY;

CREATE POLICY beca_comedor_mes_select ON public.beca_comedor_mes
  FOR SELECT USING (public.es_admin(centro_id));

CREATE POLICY beca_comedor_mes_insert ON public.beca_comedor_mes
  FOR INSERT WITH CHECK (public.es_admin(centro_id));

CREATE POLICY beca_comedor_mes_update ON public.beca_comedor_mes
  FOR UPDATE USING (public.es_admin(centro_id)) WITH CHECK (public.es_admin(centro_id));

CREATE POLICY beca_comedor_mes_delete ON public.beca_comedor_mes
  FOR DELETE USING (public.es_admin(centro_id));

COMMIT;
