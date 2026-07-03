-- =============================================================================
-- F11 alta 4c-2 — nombre del menor editable por el tutor vía la RPC canónica
-- -----------------------------------------------------------------------------
-- Añade `p_nombre` a `actualizar_identidad_nino_tutor` para que el tutor edite el
-- nombre por el MISMO camino whitelisteado (no un path paralelo). Contrato NULL =
-- preservar, igual que el resto de campos (COALESCE(p_nombre, nombre)).
--
-- Firma: `p_nombre text DEFAULT NULL` va AL FINAL. La versión de 6 args se DROPEA
-- primero (no basta CREATE OR REPLACE: cambiar la lista de args crea un OVERLOAD
-- nuevo y dejaría viva la de 6 args → PostgREST no podría elegir candidato ante una
-- llamada de 6 args nombrados). Con una única función de 7 args y el DEFAULT, las
-- llamadas de 6 args nombrados (si quedara alguna) siguen resolviendo sin romper.
--
-- Authz INTACTA: se conserva el gate `es_tutor_legal_de` (apretado en la migración
-- 20260619120000); NO se relaja. SECURITY DEFINER y search_path idénticos.
-- =============================================================================

-- 1) Retira la versión de 6 args (será sustituida por la de 7 abajo).
DROP FUNCTION IF EXISTS public.actualizar_identidad_nino_tutor(
  uuid, text, date, public.nino_sexo, text, text
);

-- 2) Recrea la función con `p_nombre` al final.
CREATE OR REPLACE FUNCTION public.actualizar_identidad_nino_tutor(
  p_nino_id uuid,
  p_apellidos text,
  p_fecha_nacimiento date,
  p_sexo public.nino_sexo,
  p_nacionalidad text,
  p_idioma_principal text,
  p_nombre text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.es_tutor_legal_de(p_nino_id) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.ninos SET
    nombre           = COALESCE(p_nombre, nombre),
    apellidos        = COALESCE(p_apellidos, apellidos),
    fecha_nacimiento = COALESCE(p_fecha_nacimiento, fecha_nacimiento),
    sexo             = COALESCE(p_sexo, sexo),
    nacionalidad     = COALESCE(p_nacionalidad, nacionalidad),
    idioma_principal = COALESCE(p_idioma_principal, idioma_principal)
  WHERE id = p_nino_id
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- 3) Re-otorga el EXECUTE (el DROP se llevó el grant de la firma anterior).
GRANT EXECUTE ON FUNCTION public.actualizar_identidad_nino_tutor(
  uuid, text, date, public.nino_sexo, text, text, text
) TO authenticated;
