-- =============================================================================
-- F11 alta PR-3b-1 (modo "Completa Dirección") — (3/6) RLS firmas_insert + es_admin
-- -----------------------------------------------------------------------------
-- Amplía el INSERT de `firmas_autorizacion` para que la ADMIN del centro del niño
-- pueda firmar A SU NOMBRE (firmante_id = auth.uid() = la admin), simétrico al
-- tutor. Así la app firma por el cliente normal, SIN RPC especial.
--
-- PARTE DE LA VERSIÓN VIGENTE (F8 hardening, 20260621140000): el gate del tutor es
-- `tiene_permiso_sobre(nino_id,'puede_firmar_autorizaciones')` — NO `es_tutor_de`.
-- Se CONSERVA ese gate intacto (no se regresa el endurecimiento) y solo se AÑADE la
-- rama admin con OR. El `firmante_id = auth.uid()` común a ambas ramas garantiza que
-- cada uno firma a su propio nombre (anti-suplantación). Las policies se recrean con
-- DROP + CREATE (no admiten CREATE OR REPLACE).
--
-- Camino TUTOR intacto: `tiene_permiso_sobre(...) AND firmante_id=auth.uid() AND
-- autorizacion_aplica_a_nino AND autorizacion_firmable` se mantiene verbatim.
--
-- APLICAR POR SQL EDITOR (rol postgres). NO por CLI. Requiere metodo_firma (1/6).
-- =============================================================================

DROP POLICY IF EXISTS firmas_insert ON public.firmas_autorizacion;

CREATE POLICY firmas_insert ON public.firmas_autorizacion
  FOR INSERT WITH CHECK (
    (
      -- Rama TUTOR (verbatim F8 hardening): permiso granular de firma sobre el niño.
      public.tiene_permiso_sobre(nino_id, 'puede_firmar_autorizaciones')
      -- Rama ADMIN (nueva): admin DEL CENTRO del niño, firma a su propio nombre.
      OR public.es_admin(public.centro_de_nino(nino_id))
    )
    AND firmante_id = auth.uid()
    AND public.autorizacion_aplica_a_nino(autorizacion_id, nino_id)
    AND public.autorizacion_firmable(autorizacion_id)
  );
