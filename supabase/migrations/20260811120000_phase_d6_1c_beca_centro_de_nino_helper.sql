-- =============================================================================
-- D-6-1c · beca_comedor_mes: coherencia de centro vía helper centro_de_nino
-- -----------------------------------------------------------------------------
-- Sustituye el subquery EXISTS de 20260810120000 por el helper existente
-- `public.centro_de_nino(nino_id)` en el WITH CHECK de INSERT y UPDATE:
--     AND public.centro_de_nino(nino_id) = centro_id
--
-- MOTIVO: `centro_de_nino` es `STABLE SECURITY DEFINER` → resuelve el centro real del
-- niño SIN depender de la RLS de `ninos` (que el EXISTS evaluaba bajo el contexto del
-- invocante). Más robusto ante cambios futuros en la RLS de `ninos` y es el patrón del
-- proyecto para lookups en policies (ADR-0007). Semántica idéntica: rechaza que un admin
-- del centro A registre/mueva una beca con centro_id=A hacia un niño de otro centro.
--
-- Solo se recrean INSERT y UPDATE (DROP + CREATE). SELECT y DELETE se dejan igual. No se
-- toca la tabla ni los CHECK ya aplicados en 20260809.
--
-- Aplicar por SQL Editor / db push (rol postgres).
-- =============================================================================
BEGIN;

DROP POLICY IF EXISTS beca_comedor_mes_insert ON public.beca_comedor_mes;
CREATE POLICY beca_comedor_mes_insert ON public.beca_comedor_mes
  FOR INSERT WITH CHECK (
    public.es_admin(centro_id)
    AND public.centro_de_nino(nino_id) = centro_id
  );

DROP POLICY IF EXISTS beca_comedor_mes_update ON public.beca_comedor_mes;
CREATE POLICY beca_comedor_mes_update ON public.beca_comedor_mes
  FOR UPDATE USING (public.es_admin(centro_id))
  WITH CHECK (
    public.es_admin(centro_id)
    AND public.centro_de_nino(nino_id) = centro_id
  );

COMMIT;
