-- =============================================================================
-- D-6-1b · beca_comedor_mes: el niño debe pertenecer al centro de la beca
-- -----------------------------------------------------------------------------
-- HUECO (coherencia cross-centro): con las policies de 20260809120000, un admin del
-- centro A podía insertar una beca con `centro_id = A` pero `nino_id` de un niño del
-- centro B — la RLS (es_admin(A)) lo dejaba pasar y quedaba una fila que cruza centros.
-- Se cierra en la BD (no confiar en la UI): el WITH CHECK de INSERT y UPDATE exige que
-- el niño exista y sea de ESE centro (`ninos.centro_id = beca_comedor_mes.centro_id`).
--
-- Solo se recrean INSERT y UPDATE (DROP + CREATE). SELECT y DELETE se dejan igual. No se
-- toca la tabla ni los CHECK ya aplicados en 20260809.
--
-- Nota ADR-0007: el subquery va en WITH CHECK (no en USING) y referencia una tabla
-- DISTINTA (ninos), cuyas policies no referencian beca_comedor_mes → sin ciclo de
-- recursión RLS. Verificado contra el remoto (insert/update legítimo OK; cruce A↔B 42501).
--
-- Aplicar por SQL Editor / db push (rol postgres).
-- =============================================================================
BEGIN;

DROP POLICY IF EXISTS beca_comedor_mes_insert ON public.beca_comedor_mes;
CREATE POLICY beca_comedor_mes_insert ON public.beca_comedor_mes
  FOR INSERT WITH CHECK (
    public.es_admin(centro_id)
    AND EXISTS (
      SELECT 1 FROM public.ninos n
      WHERE n.id = nino_id AND n.centro_id = beca_comedor_mes.centro_id
    )
  );

DROP POLICY IF EXISTS beca_comedor_mes_update ON public.beca_comedor_mes;
CREATE POLICY beca_comedor_mes_update ON public.beca_comedor_mes
  FOR UPDATE USING (public.es_admin(centro_id))
  WITH CHECK (
    public.es_admin(centro_id)
    AND EXISTS (
      SELECT 1 FROM public.ninos n
      WHERE n.id = nino_id AND n.centro_id = beca_comedor_mes.centro_id
    )
  );

COMMIT;
