-- =============================================================================
-- F-2c-4 · Storage del mandato SEPA con path FAMILIA-scoped (gestión por el TUTOR)
-- =============================================================================
-- El tutor gestiona la domiciliación de su FAMILIA desde /family/recibos con firma
-- DIGITAL completa (trazo + PDF + hash + metodo='digital'). El PDF del mandato se sube
-- al bucket `mandato-sepa` en una ruta FAMILIA-scoped:
--
--     {centroId}/familia/{familiaId}/mandato-{timestamp}.pdf
--
-- `storage.foldername(name)` de esa ruta = {centroId, 'familia', familiaId}:
--     [1]=centroId · [2]='familia' · [3]=familiaId
--
-- Las políticas nino-scoped de F11-G-0 ({centroId}/{ninoId}/mandato.pdf, gate
-- es_admin([1]) OR es_tutor_legal_de([2])) NO se tocan. `storage.objects` es
-- PERMISIVO (OR entre políticas): estas políticas nuevas AÑADEN acceso al prefijo
-- `familia`, NO reemplazan nada. El alta sigue subiendo nino-scoped sin cambios.
--
-- El guard `[2]='familia'` acota estas políticas al path nuevo: una ruta nino-scoped
-- ([2]=ninoId) no las activa (cae en las de F11-G-0). Gate = mismo criterio que las
-- RPCs `registrar/sustituir_mandato_sepa`: es_admin(centro) OR es_tutor_de_familia(familia).
--
-- DELETE: ya cubierto por `mandato_sepa_delete` (es_admin([1]=centroId)), válido para
-- cualquier path del bucket incluido el familia-scoped → NO se añade DELETE nuevo (el
-- tutor no borra; el histórico se conserva vía timestamp en el nombre + estado revocado).
--
-- Migración de SOLO storage (CREATE POLICY aditivo). Sin cambios en tablas/RPC.
-- Gated en tests por F2C4_MIGRATION_APPLIED. Aplicar por SQL Editor (CLI SIGILL).
-- =============================================================================

BEGIN;

-- SELECT: el tutor de la familia (o admin del centro) firma/lee su PDF familia-scoped.
CREATE POLICY "mandato_sepa_select_familia" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'mandato-sepa'
    AND (storage.foldername(name))[2] = 'familia'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR public.es_tutor_de_familia(((storage.foldername(name))[3])::uuid)
    )
  );

-- INSERT: el tutor sube el PDF del mandato de SU familia (aislado por es_tutor_de_familia).
CREATE POLICY "mandato_sepa_insert_familia" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'mandato-sepa'
    AND (storage.foldername(name))[2] = 'familia'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR public.es_tutor_de_familia(((storage.foldername(name))[3])::uuid)
    )
  );

-- UPDATE: por si un upsert re-escribe el mismo path (colisión de timestamp); mismo gate.
CREATE POLICY "mandato_sepa_update_familia" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'mandato-sepa'
    AND (storage.foldername(name))[2] = 'familia'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR public.es_tutor_de_familia(((storage.foldername(name))[3])::uuid)
    )
  )
  WITH CHECK (
    bucket_id = 'mandato-sepa'
    AND (storage.foldername(name))[2] = 'familia'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR public.es_tutor_de_familia(((storage.foldername(name))[3])::uuid)
    )
  );

COMMIT;
