-- =============================================================================
-- IU-1b · `ninos.puede_aparecer_en_fotos` IMPOSIBLE de escribir a mano: solo derivado.
-- -----------------------------------------------------------------------------
-- IU-0 dejó el flag como DERIVADO del consentimiento de imagen (fuente única). IU-1
-- retiró el toggle de UI. Pero la RLS `ninos_admin_all` (FOR ALL, es_admin) sigue
-- permitiendo a un admin escribir CUALQUIER columna de `ninos` por API directa, incluido
-- este flag → un `UPDATE ninos SET puede_aparecer_en_fotos=true` sin consent lo falsearía
-- (el vector del falso positivo tipo «Pepe»).
--
-- Cierre: un trigger BEFORE INSERT OR UPDATE que IGNORA el valor entrante de la columna
-- y la FUERZA al valor real derivado (`tiene_consentimiento_imagen(niño)`). Así el flag
-- solo puede reflejar el estado del consent; ninguna escritura directa lo falsea.
--
-- SIN recursión ni conflicto con `consentimiento_imagen_sync` (el trigger que propaga
-- consent→flag desde el lado de `consentimientos`):
--   · Es un BEFORE trigger: modifica NEW in situ, NO emite otro UPDATE → no se re-dispara
--     a sí mismo.
--   · No escribe en `consentimientos` → no re-dispara `consentimiento_imagen_sync` (no hay
--     ciclo cruzado).
--   · Cuando `consentimiento_imagen_sync` hace `UPDATE ninos SET flag = tiene(nino)`, este
--     BEFORE recomputa `tiene(NEW.id)` = el MISMO valor (mismo estado de consent en la tx)
--     → coinciden, no se pisan.
-- Los dos son complementarios: `consentimiento_imagen_sync` PROPAGA el consent al flag;
-- este BEFORE BLINDA la columna contra escrituras directas. `consentimiento_imagen_sync`
-- NO se modifica (sin CREATE OR REPLACE → sin diff de equivalencia).
--
-- Aplicar por SQL Editor / db push (rol postgres). Sin cambios de datos.
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.ninos_flag_imagen_derivado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- El flag es DERIVADO: se ignora el valor entrante y se fuerza al derivado del consent.
  -- En UPDATE solo se recomputa si alguien intenta CAMBIAR la columna (evita coste en los
  -- updates que no la tocan); en INSERT siempre (un niño nuevo no tiene consent → false).
  IF TG_OP = 'INSERT'
     OR NEW.puede_aparecer_en_fotos IS DISTINCT FROM OLD.puede_aparecer_en_fotos THEN
    NEW.puede_aparecer_en_fotos := public.tiene_consentimiento_imagen(NEW.id);
  END IF;
  RETURN NEW;
END $function$;

CREATE TRIGGER ninos_flag_imagen_derivado_trg
  BEFORE INSERT OR UPDATE ON public.ninos
  FOR EACH ROW EXECUTE FUNCTION public.ninos_flag_imagen_derivado();

COMMIT;
