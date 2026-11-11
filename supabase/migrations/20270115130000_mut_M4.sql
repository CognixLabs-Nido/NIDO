-- MUTACIÓN M4 (rama mut/, no se mergea)
DROP POLICY autorizaciones_select ON public.autorizaciones;
CREATE POLICY autorizaciones_select ON public.autorizaciones FOR SELECT TO authenticated USING (public.usuario_es_audiencia_autorizacion_row(centro_id, tipo, es_plantilla, ambito, evento_id, nino_id, aula_id));
