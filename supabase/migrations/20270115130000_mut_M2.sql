-- MUTACIÓN M2 (rama mut/, no se mergea)
CREATE OR REPLACE FUNCTION public.ficha_gestion_ninos(p_nino_ids uuid[])
RETURNS TABLE (
  nino_id uuid,
  notas_admin text,
  dni text,
  observaciones_familia text,
  direccion_calle text,
  direccion_numero text,
  direccion_cp text,
  direccion_ciudad text,
  direccion_provincia text,
  estado_civil_familia public.estado_civil,
  libro_familia_path text,
  hermanos_total smallint,
  hermanos_lugar smallint,
  como_nos_conocio text,
  como_nos_conocio_otro text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT n.id, n.notas_admin, n.dni, n.observaciones_familia, n.direccion_calle, n.direccion_numero,
         n.direccion_cp, n.direccion_ciudad, n.direccion_provincia, n.estado_civil_familia,
         n.libro_familia_path, n.hermanos_total, n.hermanos_lugar, n.como_nos_conocio,
         n.como_nos_conocio_otro
    FROM public.ninos n
   WHERE n.id = ANY (p_nino_ids)
     AND auth.uid() IS NOT NULL
     AND (public.es_admin(n.centro_id) OR public.es_tutor_legal_de(n.id) OR public.es_profe_de_nino(n.id));
$function$;
