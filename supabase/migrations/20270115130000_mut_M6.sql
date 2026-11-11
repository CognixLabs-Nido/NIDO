-- MUTACIÓN M6 (rama mut/, no se mergea)
DROP POLICY recogida_adjuntos_select_tutor ON storage.objects;
CREATE POLICY recogida_adjuntos_select_tutor ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'recogida-adjuntos' AND public.es_tutor_de(((storage.foldername(name))[2])::uuid) AND privado.ruta_coherente(bucket_id, name));
