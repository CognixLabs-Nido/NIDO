-- =============================================================================
-- Fase 10-3 — Adjuntos sobre Storage: políticas para escritura del TUTOR
-- =============================================================================
-- ADITIVA: solo CREATE POLICY sobre storage.objects. NO toca tablas ni las
-- políticas de F10-0 (fichero 20260611120000). Fuente de verdad:
-- docs/specs/fotos-publicaciones.md (§Storage, §Comportamiento 6) + ADR-0045.
--
-- QUÉ AÑADE: las políticas de F10-0 dejaban escribir en `ninos-fotos` y
-- `recogida-adjuntos` SOLO a dirección/staff. F10-3 deja que el TUTOR suba:
--   1. la FOTO DE SU HIJO  → bucket `ninos-fotos`,        ruta {centroId}/{ninoId}/...
--   2. la FOTO DEL DNI de recogida de SU hijo → `recogida-adjuntos`, ruta {centroId}/{ninoId}/...
-- En ambos el 2.º segmento de la ruta es {ninoId} y la autorización se acota con
-- `es_tutor_de(ninoId)` (mismo helper que el SELECT de F10-0). Aislamiento entre
-- familias: un tutor NO puede escribir bajo el {ninoId} de otra familia.
--
-- El logo (`centro-assets`) ya lo escribe dirección en F10-0 → sin cambios aquí.
--
-- Las políticas de F10-0 (admin/staff INSERT/SELECT/DELETE) siguen vigentes: RLS
-- es permisiva (OR entre políticas), estas solo SUMAN al tutor.
-- =============================================================================
BEGIN;

-- ─── ninos-fotos: el tutor sube/borra la foto de SU hijo ─────────────────────
-- Ruta: {centroId}/{ninoId}/... → autoriza por `es_tutor_de([2]=ninoId)`.
-- (F10-0 ya daba INSERT/DELETE a admin y SELECT a admin/profe/tutor.)
CREATE POLICY "ninos_fotos_insert_tutor" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ninos-fotos'
    AND public.es_tutor_de(((storage.foldername(name))[2])::uuid)
  );
-- Borrar el objeto anterior al sustituir la foto (sin huérfanos).
CREATE POLICY "ninos_fotos_delete_tutor" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'ninos-fotos'
    AND public.es_tutor_de(((storage.foldername(name))[2])::uuid)
  );

-- ─── recogida-adjuntos: el tutor sube la foto del DNI de SU recogida ─────────
-- Ruta: {centroId}/{ninoId}/... (el {firmaId} no existe aún al subir-antes-de-firmar;
-- se ata a la firma por el hash de `datos.adjuntos`). Autoriza por `es_tutor_de([2]=ninoId)`.
-- Sensible: DNIs de terceros → RAT/retención en F11.
CREATE POLICY "recogida_adjuntos_insert_tutor" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'recogida-adjuntos'
    AND public.es_tutor_de(((storage.foldername(name))[2])::uuid)
  );
-- Releer lo propio (preview en el formulario / ver el DNI que subió).
CREATE POLICY "recogida_adjuntos_select_tutor" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'recogida-adjuntos'
    AND public.es_tutor_de(((storage.foldername(name))[2])::uuid)
  );

COMMIT;
