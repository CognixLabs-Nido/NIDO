-- MUTACIÓN M5 (rama mut/, no se mergea)
DROP POLICY adm_med_select ON public.administraciones_medicacion;
CREATE POLICY adm_med_select ON public.administraciones_medicacion FOR SELECT TO authenticated USING (public.es_admin(centro_id) OR public.es_profe_de_nino(nino_id) OR public.es_tutor_de(nino_id));
