-- MUTACIÓN M3 (rama mut/, no se mergea)
CREATE OR REPLACE FUNCTION public.contenido_firmas(p_firma_ids uuid[])
RETURNS TABLE (
  firma_id uuid,
  nombre_tecleado text,
  firma_imagen text,
  ip_address inet,
  user_agent text,
  comentario text,
  datos jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT f.id, f.nombre_tecleado, f.firma_imagen, f.ip_address, f.user_agent, f.comentario, f.datos
    FROM public.firmas_autorizacion f
   WHERE f.id = ANY (p_firma_ids)
     AND auth.uid() IS NOT NULL
     AND NOT privado.firma_bloqueada(f.nino_id, f.firmante_id)
     AND (f.firmante_id = auth.uid()
          OR public.es_tutor_de(f.nino_id)
          OR public.es_profe_de_nino(f.nino_id)
          OR public.es_admin(privado.centro_de_nino(f.nino_id)));
$function$;
