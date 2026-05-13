-- =============================================================================
-- Fase 2 — Fix RLS: recursión infinita en políticas con subqueries inline
-- =============================================================================
-- Las políticas originales de Fase 2 usaban subqueries inline
--   USING ( public.es_admin((SELECT centro_id FROM public.ninos WHERE ...)) )
-- Esa subquery se ejecuta en el contexto del usuario invocador, lo que dispara
-- las políticas RLS de `ninos` → si esas políticas a su vez tocan `matriculas`,
-- y `matriculas` referencia `ninos`, Postgres detecta recursión infinita
-- (SQLSTATE 42P17).
--
-- Fix: encapsular los lookups de centro_id en funciones SECURITY DEFINER que
-- bypassan RLS internamente (el rol postgres tiene BYPASSRLS en Supabase).
-- También añadimos GRANT EXECUTE para que las funciones RPC de cifrado sean
-- llamables por el rol `authenticated` desde el cliente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helpers de lookup: centro_id sin disparar RLS de ninos/aulas
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.centro_de_nino(p_nino_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT centro_id FROM public.ninos WHERE id = p_nino_id;
$$;

CREATE OR REPLACE FUNCTION public.centro_de_aula(p_aula_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT centro_id FROM public.aulas WHERE id = p_aula_id;
$$;

-- -----------------------------------------------------------------------------
-- Reemplazar políticas con subqueries inline por llamadas a helpers
-- -----------------------------------------------------------------------------

-- ninos: la policy ninos_profe_select usaba EXISTS subquery contra matriculas,
-- que disparaba la policy de matriculas, que volvía a tocar ninos → recursión.
-- Sustituimos por una sola query a profes_aulas usando es_profe_de_aula con
-- el aula_id resuelto mediante un nuevo helper que NO toca ninos directamente.
CREATE OR REPLACE FUNCTION public.es_profe_de_nino(p_nino_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.matriculas m
    JOIN public.profes_aulas pa ON pa.aula_id = m.aula_id
    WHERE m.nino_id = p_nino_id
      AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
      AND pa.profe_id = auth.uid()
      AND pa.fecha_fin IS NULL AND pa.deleted_at IS NULL
  );
$$;

DROP POLICY IF EXISTS ninos_profe_select ON public.ninos;
CREATE POLICY ninos_profe_select ON public.ninos
  FOR SELECT USING (public.es_profe_de_nino(id));

-- info_medica_emergencia
DROP POLICY IF EXISTS ime_admin_all ON public.info_medica_emergencia;
CREATE POLICY ime_admin_all ON public.info_medica_emergencia
  FOR ALL USING (public.es_admin(public.centro_de_nino(nino_id)));

DROP POLICY IF EXISTS ime_profe_select ON public.info_medica_emergencia;
CREATE POLICY ime_profe_select ON public.info_medica_emergencia
  FOR SELECT USING (public.es_profe_de_nino(nino_id));

-- matriculas
DROP POLICY IF EXISTS matriculas_admin_all ON public.matriculas;
CREATE POLICY matriculas_admin_all ON public.matriculas
  FOR ALL USING (public.es_admin(public.centro_de_nino(nino_id)));

-- vinculos_familiares
DROP POLICY IF EXISTS vinculos_admin_all ON public.vinculos_familiares;
CREATE POLICY vinculos_admin_all ON public.vinculos_familiares
  FOR ALL USING (public.es_admin(public.centro_de_nino(nino_id)));

DROP POLICY IF EXISTS vinculos_profe_select ON public.vinculos_familiares;
CREATE POLICY vinculos_profe_select ON public.vinculos_familiares
  FOR SELECT USING (public.es_profe_de_nino(nino_id));

-- profes_aulas
DROP POLICY IF EXISTS profes_aulas_admin_all ON public.profes_aulas;
CREATE POLICY profes_aulas_admin_all ON public.profes_aulas
  FOR ALL USING (public.es_admin(public.centro_de_aula(aula_id)));

-- =============================================================================
-- GRANT EXECUTE de las funciones RPC al rol authenticated.
-- Sin esto el cliente con anon_key + sesión Supabase no puede invocarlas con
-- supabase-js .rpc(...). El service_role siempre tiene acceso.
-- =============================================================================
GRANT EXECUTE ON FUNCTION public.set_info_medica_emergencia_cifrada(
  uuid, text, text, text, text, text, text
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_info_medica_emergencia(uuid) TO authenticated;

-- También las helpers RLS deben ser invocables por authenticated (para queries
-- directas del cliente que las usen). Las políticas USING ya las invocan vía
-- el motor de RLS, pero exponerlas explícitamente es buena práctica.
GRANT EXECUTE ON FUNCTION public.centro_de_nino(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.centro_de_aula(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.es_profe_de_nino(uuid) TO authenticated;
