-- =============================================================================
-- Fase 11-A3 (RGPD) — Consentimiento de imagen "firmable" vía la firma de F8
-- =============================================================================
--
-- Spec: docs/specs/proteccion-datos.md (approved) — Decisión #9. Decisiones de
-- arranque cerradas con el responsable (D1–D5):
--   D1: trigger AFTER INSERT SECURITY DEFINER en firmas_autorizacion, acotado a
--       tipo='autorizacion_imagenes'. La firma es la ÚNICA escritura del cliente;
--       el trigger fija flag + consentimiento DENTRO de la misma transacción
--       (si algo falla, la firma hace rollback → cero drift).
--   D2: versión del consentimiento = autorizaciones.texto_version (el texto firmado).
--   D3: usuario_id del consentimiento = firma.firmante_id (el tutor que firma).
--   D4: respeta requiere_ambos_firmantes / firmantes_requeridos — agregación estilo
--       medicacion_administrable_hoy (flag TRUE sii la ÚLTIMA decisión de los
--       firmantes requeridos = 'firmado'; se apaga si un requerido revoca/rechaza).
--   D5: el tutor puede revocar su firma de imágenes (cambio en revocar-firma.ts);
--       en decision='revocado'/'rechazado' el trigger recalcula el flag y revoca
--       el consentimiento del firmante.
--
-- Fuente de verdad = tabla `consentimientos` (#88); `usuarios.*_version` es caché
-- (imagen no tiene columna caché → solo fila). El flag `ninos.puede_aparecer_en_fotos`
-- es el DERIVADO operativo que consume la RLS de F10.
--
-- NOTA MVCC: el helper de agregación es **VOLATILE** (no STABLE como el de
-- medicación, que va en RLS). Se invoca desde un trigger AFTER INSERT y DEBE ver la
-- fila recién insertada (p.ej. contar la 2.ª firma en doble-firmante). Un STABLE
-- usaría el snapshot previo al INSERT y no la vería.
-- =============================================================================

BEGIN;

-- ─── 1. Helper: ¿el niño tiene el consentimiento de imagen CONSENTIDO? ────────
-- Espejo de la lógica «consentida» de medicacion_administrable_hoy (sin vigencia:
-- D4 = solo la última decisión de los firmantes requeridos). Lee firmas/vínculos
-- del propio niño. VOLATILE para ver la fila NEW en el trigger AFTER INSERT.
CREATE OR REPLACE FUNCTION public.imagen_consentida(p_autorizacion_id uuid, p_nino_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.autorizaciones%ROWTYPE;
  v_requiere_ambos boolean;
  v_politica public.politica_firmantes;
  v_total_principales int;
  v_firmados_principales int;
BEGIN
  SELECT * INTO a FROM public.autorizaciones WHERE id = p_autorizacion_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF a.es_plantilla OR a.tipo <> 'autorizacion_imagenes' THEN RETURN FALSE; END IF;

  SELECT requiere_ambos_firmantes INTO v_requiere_ambos FROM public.ninos WHERE id = p_nino_id;
  v_politica := CASE WHEN COALESCE(v_requiere_ambos, false)
                     THEN 'todos_los_principales'::public.politica_firmantes
                     ELSE a.firmantes_requeridos END;

  IF v_politica = 'todos_los_principales' THEN
    SELECT count(*) INTO v_total_principales
      FROM public.vinculos_familiares vf
      WHERE vf.nino_id = p_nino_id
        AND vf.tipo_vinculo = 'tutor_legal_principal'
        AND vf.deleted_at IS NULL;
    IF v_total_principales = 0 THEN
      -- Sin principales (dato incompleto): basta una última firma 'firmado' (fallback).
      RETURN EXISTS (
        SELECT 1 FROM (
          SELECT DISTINCT ON (f.firmante_id) f.decision
          FROM public.firmas_autorizacion f
          WHERE f.autorizacion_id = a.id AND f.nino_id = p_nino_id
          ORDER BY f.firmante_id, f.firmado_at DESC
        ) ult WHERE ult.decision = 'firmado'
      );
    END IF;
    -- Todos los principales con su última decisión = 'firmado'.
    SELECT count(*) INTO v_firmados_principales FROM (
      SELECT DISTINCT ON (f.firmante_id) f.firmante_id, f.decision
      FROM public.firmas_autorizacion f
      JOIN public.vinculos_familiares vf
        ON vf.usuario_id = f.firmante_id
       AND vf.nino_id = p_nino_id
       AND vf.tipo_vinculo = 'tutor_legal_principal'
       AND vf.deleted_at IS NULL
      WHERE f.autorizacion_id = a.id AND f.nino_id = p_nino_id
      ORDER BY f.firmante_id, f.firmado_at DESC
    ) ult WHERE ult.decision = 'firmado';
    RETURN v_firmados_principales >= v_total_principales;
  END IF;

  -- uno_principal / cualquiera: basta una última decisión 'firmado'.
  RETURN EXISTS (
    SELECT 1 FROM (
      SELECT DISTINCT ON (f.firmante_id) f.decision
      FROM public.firmas_autorizacion f
      WHERE f.autorizacion_id = a.id AND f.nino_id = p_nino_id
      ORDER BY f.firmante_id, f.firmado_at DESC
    ) ult WHERE ult.decision = 'firmado'
  );
END $$;

GRANT EXECUTE ON FUNCTION public.imagen_consentida(uuid, uuid) TO authenticated;

-- ─── 2. Trigger: sincroniza flag + consentimiento al firmar/revocar imágenes ──
-- AFTER INSERT en firmas_autorizacion. Acotado a tipo='autorizacion_imagenes'
-- (el resto de tipos: RETURN NEW inmediato → cero impacto en F8). Atómico con la
-- firma: si registrar/revocar/UPDATE lanza, la firma hace rollback.
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

  -- Sincroniza el consentimiento (tabla = fuente de verdad) del firmante.
  -- auth.uid() = NEW.firmante_id (la RLS firmas_insert lo enforza), por eso
  -- revocar_consentimiento (que opera sobre auth.uid()) afecta SIEMPRE al firmante.
  IF NEW.decision = 'firmado' THEN
    -- Supersede idempotente: revoca el vigente previo del firmante y registra el
    -- nuevo con la versión del texto firmado (D2/D3). Re-firma con versión nueva =
    -- re-consentimiento (fila nueva vigente; el histórico queda revocado).
    PERFORM public.revocar_consentimiento('imagen'::public.consentimiento_tipo);
    PERFORM public.registrar_consentimiento(
      NEW.firmante_id, 'imagen'::public.consentimiento_tipo, a.texto_version,
      NEW.ip_address, NEW.user_agent
    );
  ELSE
    -- revocado / rechazado → retira el consentimiento vigente del firmante.
    PERFORM public.revocar_consentimiento('imagen'::public.consentimiento_tipo);
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

CREATE TRIGGER firma_imagen_sync_trg
  AFTER INSERT ON public.firmas_autorizacion
  FOR EACH ROW EXECUTE FUNCTION public.firma_imagen_sync();

COMMIT;
