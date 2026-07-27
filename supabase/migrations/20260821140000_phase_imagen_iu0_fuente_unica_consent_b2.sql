-- =============================================================================
-- IU-0 (consolidación B2) · FUENTE ÚNICA del flag de imagen = `consentimientos`.
-- -----------------------------------------------------------------------------
-- Problema (escenario C, confirmado): tras el fix `20260821130000` coexistían DOS
-- derivaciones de `ninos.puede_aparecer_en_fotos`:
--   (1) `consentimiento_imagen_sync` (consent-based, por-niño), y
--   (2) `firma_imagen_sync` que ADEMÁS movía el flag vía `imagen_consentida` (firmas).
-- Divergen de forma real: firmar A → consent A → flag true; Dirección revoca el consent
-- de A → flag false; pero la firma sigue 'firmado', así que la derivación por firmas
-- (imagen_consentida) puede RESUCITAR el flag (la revocación de Dirección no es durable).
--
-- Consolidación (decisión de Jose, opción B2):
--   • FUENTE ÚNICA = `consentimientos`. UN SOLO escritor del flag: el trigger
--     consent-based `consentimiento_imagen_sync`. La firma (vía A) SIGUE otorgando/
--     revocando el CONSENT por-niño, pero YA NO toca el flag.
--   • Se RETIRA la derivación por firmas: `firma_imagen_sync` deja de escribir el flag
--     y se ELIMINA `imagen_consentida` (su único consumidor era ese flag).
--   • B2 — se PRESERVA el gate de doble consentimiento parental (`requiere_ambos_firmantes`):
--     ahora se evalúa sobre CONSENT (+ vínculos de tutores principales), NO sobre firmas.
--     El gate no se pierde, solo cambia de fuente.
--
-- Encadena tras `20260821130000` (reconducción per-niño de la firma). IU-0 base
-- (`20260821120000`) ya aplicada. Aplicar por SQL Editor / db push (rol postgres).
-- =============================================================================
BEGIN;

-- ── 1. Derivador consent-based que RESPETA requiere_ambos (B2) ───────────────────────
-- Fuente única = consentimientos. Para `requiere_ambos_firmantes` el flag exige que
-- TODOS los tutores principales del niño tengan consent 'imagen' vigente (y que haya ≥1);
-- si no lo requiere, basta un consent vigente cualquiera. Lee consentimientos + vínculos
-- (NO firmas_autorizacion). VOLATILE: lo invoca el trigger AFTER y debe ver la fila NEW
-- del consent recién insertado/actualizado. coalesce(...,false): NULL nunca autoriza.
CREATE OR REPLACE FUNCTION public.tiene_consentimiento_imagen(p_nino_id uuid)
 RETURNS boolean
 LANGUAGE sql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN COALESCE(
           (SELECT requiere_ambos_firmantes FROM public.ninos WHERE id = p_nino_id),
           false)
    THEN
      -- Doble consentimiento: existe ≥1 tutor principal y NINGÚN principal sin consent vigente.
      EXISTS (
        SELECT 1 FROM public.vinculos_familiares vf
        WHERE vf.nino_id = p_nino_id
          AND vf.tipo_vinculo = 'tutor_legal_principal'
          AND vf.deleted_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.vinculos_familiares vf
        WHERE vf.nino_id = p_nino_id
          AND vf.tipo_vinculo = 'tutor_legal_principal'
          AND vf.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.consentimientos c
            WHERE c.tipo = 'imagen'
              AND c.nino_id = p_nino_id
              AND c.usuario_id = vf.usuario_id
              AND c.revocado_en IS NULL
          )
      )
    ELSE
      COALESCE((
        SELECT true FROM public.consentimientos
        WHERE tipo = 'imagen' AND nino_id = p_nino_id AND revocado_en IS NULL
        LIMIT 1
      ), false)
  END;
$function$;

-- ── 2. La firma (vía A) SOLO escribe/revoca el CONSENT; ya NO toca el flag ───────────
-- Único cambio vs `20260821130000`: se elimina el bloque que recalculaba el flag vía
-- `imagen_consentida` y el UPDATE de `ninos`. El flag lo mueve EXCLUSIVAMENTE el trigger
-- consent-based `consentimiento_imagen_sync` cuando cambia el consent. El resto
-- (acotamiento a `autorizacion_imagenes`, consent por-niño acotado a firmante+niño,
-- supersede idempotente) queda IDÉNTICO.
CREATE OR REPLACE FUNCTION public.firma_imagen_sync()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.autorizaciones%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.autorizaciones WHERE id = NEW.autorizacion_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  -- Solo instancias reales de autorización de imágenes.
  IF a.es_plantilla OR a.tipo <> 'autorizacion_imagenes' THEN RETURN NEW; END IF;

  -- Fuente única = consentimientos: la firma SOLO sincroniza el CONSENT por-niño,
  -- acotado a (usuario_id = NEW.firmante_id, nino_id = NEW.nino_id). NO toca el flag
  -- puede_aparecer_en_fotos (lo deriva consentimiento_imagen_sync al cambiar el consent).
  IF NEW.decision = 'firmado' THEN
    -- Supersede idempotente del vigente previo del firmante PARA ESE NIÑO; alta del
    -- nuevo con la versión del texto firmado (D2/D3) y nino_id = NEW.nino_id.
    UPDATE public.consentimientos
       SET revocado_en = now()
     WHERE tipo = 'imagen' AND usuario_id = NEW.firmante_id
       AND nino_id = NEW.nino_id AND revocado_en IS NULL;
    INSERT INTO public.consentimientos
      (usuario_id, tipo, version, nino_id, ip_address, user_agent)
    VALUES
      (NEW.firmante_id, 'imagen'::public.consentimiento_tipo, a.texto_version,
       NEW.nino_id, NEW.ip_address, NEW.user_agent);
  ELSE
    -- revocado / rechazado → retira el vigente del firmante PARA ESE NIÑO.
    UPDATE public.consentimientos
       SET revocado_en = now()
     WHERE tipo = 'imagen' AND usuario_id = NEW.firmante_id
       AND nino_id = NEW.nino_id AND revocado_en IS NULL;
  END IF;

  RETURN NEW;
END $$;

-- ── 3. Retirar `imagen_consentida` (derivador por firmas) ────────────────────────────
-- Su ÚNICO consumidor era el flag desde `firma_imagen_sync` (ya no la llama). Al
-- eliminarla, las firmas quedan TOTALMENTE fuera de la derivación del flag → no hay
-- forma de que una firma vigente resucite el flag tras revocar el consent (escenario C).
DROP FUNCTION IF EXISTS public.imagen_consentida(uuid, uuid);

-- ── 4. Reconciliar (idempotente): el flag = derivador consent-based B2 ────────────────
-- Alinea cualquier drift con la nueva `tiene_consentimiento_imagen` (incl. niños
-- requiere_ambos). Con 0 consents de imagen en el remoto, no cambia nada; es red de
-- seguridad si hubiera estados parciales.
UPDATE public.ninos n
   SET puede_aparecer_en_fotos = public.tiene_consentimiento_imagen(n.id)
 WHERE n.puede_aparecer_en_fotos IS DISTINCT FROM public.tiene_consentimiento_imagen(n.id);

COMMIT;
