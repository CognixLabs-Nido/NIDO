-- =============================================================================
-- FIX — ON DELETE explícito en las 6 FKs a auth.users que no lo tenían
-- -----------------------------------------------------------------------------
-- PROBLEMA. Seis columnas "quién hizo esto" referencian auth.users(id) SIN cláusula
-- (NO ACTION): acuses_alta (alta), tarifa_concepto_anio (B1) y las 4 de beca comedor v2
-- (B2). Todas bloquean borrar la cuenta, también cuando la referencia es un simple
-- metadato. El resto del modelo decide la política columna a columna (RESTRICT en la
-- autoría que es prueba, SET NULL en metadatos: dias_centro.creado_por, etc.).
--
-- POLÍTICA POR COLUMNA:
--   RESTRICT — la referencia ES la prueba; sin ella la fila no demuestra nada:
--     · acuses_alta.firmante_id              (quién aceptó las normas; = firmas_autorizacion)
--     · beca_comedor_desborde.resuelto_por   (decisión sobre dinero; = cierre_mensual.cerrado_por)
--     · beca_comedor_transferencia.realizada_por (movimiento de dinero)
--   SET NULL — metadato de configuración; la fila vale igual sin saber quién la creó:
--     · tarifa_concepto_anio.created_by
--     · beca_comedor_elegibilidad.created_by
--     · beca_comedor_tramo.created_by
--
-- RESTRICT vs el NO ACTION actual: mismo efecto aquí. Las 6 son NOT DEFERRABLE y la única
-- diferencia (NO ACTION comprueba al final de la sentencia, RESTRICT en el acto) solo se
-- nota si la MISMA sentencia que borra la cuenta borrase también las filas que la
-- referencian, y borrar una cuenta no cascadea a estas tablas (sus otras FKs van a
-- centros/ninos/familias/recibos). Se explicitan para que el bloqueo conste como decisión.
--
-- Cada tabla: DROP + ADD en UN solo ALTER TABLE (sin instante sin FK). Mismos nombres de
-- constraint; solo cambia el ON DELETE. Las 6 columnas ya son NULLABLE (SET NULL no
-- necesita tocar nada más). No toca datos, RLS ni tipos (database.ts no refleja ON DELETE).
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor (CLI SIGILL
-- en ARM). Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================
BEGIN;

-- ─── RESTRICT: la referencia es la prueba ────────────────────────────────────
ALTER TABLE public.acuses_alta
  DROP CONSTRAINT acuses_alta_firmante_id_fkey,
  ADD CONSTRAINT acuses_alta_firmante_id_fkey
    FOREIGN KEY (firmante_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.beca_comedor_desborde
  DROP CONSTRAINT beca_comedor_desborde_resuelto_por_fkey,
  ADD CONSTRAINT beca_comedor_desborde_resuelto_por_fkey
    FOREIGN KEY (resuelto_por) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.beca_comedor_transferencia
  DROP CONSTRAINT beca_comedor_transferencia_realizada_por_fkey,
  ADD CONSTRAINT beca_comedor_transferencia_realizada_por_fkey
    FOREIGN KEY (realizada_por) REFERENCES auth.users(id) ON DELETE RESTRICT;

-- ─── SET NULL: metadato de configuración ─────────────────────────────────────
ALTER TABLE public.tarifa_concepto_anio
  DROP CONSTRAINT tarifa_concepto_anio_created_by_fkey,
  ADD CONSTRAINT tarifa_concepto_anio_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.beca_comedor_elegibilidad
  DROP CONSTRAINT beca_comedor_elegibilidad_created_by_fkey,
  ADD CONSTRAINT beca_comedor_elegibilidad_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.beca_comedor_tramo
  DROP CONSTRAINT beca_comedor_tramo_created_by_fkey,
  ADD CONSTRAINT beca_comedor_tramo_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMIT;
