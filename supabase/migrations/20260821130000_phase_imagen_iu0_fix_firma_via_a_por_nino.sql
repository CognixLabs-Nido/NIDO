-- =============================================================================
-- IU-0 (fix) · Reconducir la VÍA A (firma F11-A3) al consent de imagen POR NIÑO.
-- -----------------------------------------------------------------------------
-- Contexto: la migración IU-0 `20260821120000` añadió `consentimientos.nino_id` + el
-- CHECK `consentimientos_imagen_requiere_nino` (imagen ⇒ nino_id NOT NULL) + el trigger
-- derivador del flag. Pero `firma_imagen_sync` (mig `20260614120000`, AFTER INSERT en
-- `firmas_autorizacion`) —el ÚNICO camino de producción que escribe consent 'imagen'—
-- seguía registrándolo PER-USUARIO (via `registrar_consentimiento`, sin `nino_id`).
-- Bajo el CHECK nuevo, firmar una `autorizacion_imagenes` abortaría (SQLSTATE 23514)
-- y, per-usuario, revocar/re-firmar a un hijo tocaría el consent de un hermano.
--
-- Este fix reconduce la vía A a POR NIÑO. `firmas_autorizacion.nino_id` ya identifica
-- al niño, así que ambas vías —firma (A) y checkbox/acuse (B, IU-2)— alimentan el MISMO
-- consentimiento de imagen por-niño (fuente de verdad única de IU-0).
--
-- ÚNICO cambio respecto a la definición VIVA de `firma_imagen_sync`: el consent se
-- registra/revoca POR NIÑO (nino_id = NEW.nino_id, acotado a (firmante, niño)) en vez
-- de per-usuario. El resto —acotamiento a `autorizacion_imagenes`, ramas firmado/
-- revocado, supersede idempotente, y el recálculo del flag vía `imagen_consentida`
-- (D4)— queda IDÉNTICO.
--
-- Va en migración APARTE (no dentro del fichero de IU-0) porque IU-0 ya está aplicada:
-- una migración aplicada es inmutable (fix = migración nueva). Se aplica junto con el
-- resto del PR #254. Aplicar por SQL Editor / db push (rol postgres).
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.firma_imagen_sync()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.autorizaciones%ROWTYPE;
  v_consentida boolean;
BEGIN
  SELECT * INTO a FROM public.autorizaciones WHERE id = NEW.autorizacion_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  -- Solo instancias reales de autorización de imágenes.
  IF a.es_plantilla OR a.tipo <> 'autorizacion_imagenes' THEN RETURN NEW; END IF;

  -- Sincroniza el consentimiento (tabla = fuente de verdad) del firmante, POR NIÑO.
  -- El consent se acota a (usuario_id = NEW.firmante_id, nino_id = NEW.nino_id): firmar
  -- a un hijo NO toca el consent de un hermano (a diferencia del revocar_consentimiento
  -- per-usuario anterior, que revocaba TODAS las filas 'imagen' del firmante).
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

  -- Recalcula y sincroniza el flag operativo del niño (D4). Guard para no generar
  -- ruido de audit cuando no cambia.
  v_consentida := public.imagen_consentida(a.id, NEW.nino_id);
  UPDATE public.ninos
     SET puede_aparecer_en_fotos = v_consentida
   WHERE id = NEW.nino_id
     AND puede_aparecer_en_fotos IS DISTINCT FROM v_consentida;

  RETURN NEW;
END $$;

COMMIT;
