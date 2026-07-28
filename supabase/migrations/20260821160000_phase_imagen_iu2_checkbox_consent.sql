-- =============================================================================
-- IU-2 · El checkbox de imagen del alta otorga el CONSENTIMIENTO por-niño.
-- -----------------------------------------------------------------------------
-- El checkbox "autorizo imagen" del alta (#237) escribía una fila en `acuses_alta`
-- tipo 'imagen'. Pasa a OTORGAR el consentimiento de imagen del niño (fuente de verdad,
-- IU-0), igual que la firma (vía A). Así ambas vías alimentan el mismo consent por-niño
-- y el flag se deriva solo.
--
-- Esta migración aporta lo que el código app necesita:
--   1) `firma_metodo` gana el valor 'checkbox' (el checkbox del alta es un método de
--      aceptación distinto de la firma dibujada 'digital' y del 'presencial'). Se usa
--      como `metodo_firma` del consent otorgado por checkbox.
--   2) `existe_consentimiento_imagen(niño)`: helper para el GATE de finalización del alta
--      y la validación del director. Devuelve si el niño tiene ALGÚN consent 'imagen'
--      vigente (ANY, no requiere_ambos) → equivalente EXACTO a la señal vieja
--      "firma firmada O acuse" (una aceptación basta). NO usa el flag derivado
--      `tiene_consentimiento_imagen` (que exige ambos firmantes en requiere_ambos) para
--      no endurecer la exigencia del gate: solo se cambia la SEÑAL (acuse → consent).
--
-- Sin BEGIN/COMMIT: `ALTER TYPE ... ADD VALUE` se auto-commitea limpio y no se USA en
-- esta migración (el valor lo pasa el app por RPC). Aplicar por SQL Editor / db push.
-- =============================================================================

-- 1. Nuevo método de aceptación: checkbox del alta.
ALTER TYPE public.firma_metodo ADD VALUE IF NOT EXISTS 'checkbox';

-- 2. Señal del gate/validación: ¿el niño tiene algún consent 'imagen' vigente?
CREATE OR REPLACE FUNCTION public.existe_consentimiento_imagen(p_nino_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT true FROM public.consentimientos
    WHERE tipo = 'imagen' AND nino_id = p_nino_id AND revocado_en IS NULL
    LIMIT 1
  ), false);
$function$;

GRANT EXECUTE ON FUNCTION public.existe_consentimiento_imagen(uuid) TO authenticated;
