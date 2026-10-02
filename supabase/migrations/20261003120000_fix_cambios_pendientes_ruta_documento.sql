-- =============================================================================
-- FIX — cambios_pendientes: la ruta del documento staged debe ser del propio niño (R1/R1b)
-- -----------------------------------------------------------------------------
-- El tutor encola `ninos_libro_familia` / `datos_tutor_dni` con `payload.path` (la ruta del
-- PDF que acaba de subir). La policy `cambios_pendientes_insert` solo exige
-- `es_tutor_legal_de(nino_id) AND solicitado_por = auth.uid()`, y nada validaba la ruta: un
-- tutor podía insertar por PostgREST una fila con la ruta del libro de familia o del DNI de
-- OTRA familia/centro. Al RECHAZAR, `descartarCambioPendiente` borraba ese objeto con service
-- role (R1); al APROBAR, se escribía como `libro_familia_path` / `dni_documento_path` (R1b).
--
-- CHECK sobre la propia fila: para las dos entidades con documento, `payload->>'path'` tiene
-- que ser exactamente `{centro_id}/{nino_id}/<nombre>.pdf`, con un único segmento final de
-- [A-Za-z0-9_-] (sin `/` ni `..` → sin escapar del prefijo). Es la forma que construyen las
-- rutas legítimas (`alta/[ninoId]/libro-familia` → `<uuid>.pdf`, `alta/[ninoId]/dni` →
-- `dni-<vinculo>-<uuid>.pdf`). Sin `path` la condición es falsa (coalesce a ''), no NULL.
--
-- `centro_id` es fiable: el trigger BEFORE INSERT `cambios_pendientes_set_centro_id` lo
-- sobrescribe con `centro_de_nino(nino_id)` antes de evaluar el CHECK. El CHECK se re-evalúa
-- también en cada UPDATE (un admin no puede reescribir el payload a una ruta ajena).
--
-- La app valida lo mismo antes de usar la ruta (defensa en profundidad):
-- `rutaDocumentoDelNino` en cambios-pendientes/schemas.ts.
--
-- La tabla está vacía en producción a 2026-10-03 → el ADD CONSTRAINT valida sin filas.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor (CLI SIGILL
-- en ARM). Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

ALTER TABLE public.cambios_pendientes
  ADD CONSTRAINT cambios_pendientes_ruta_documento_del_nino CHECK (
    entidad NOT IN ('ninos_libro_familia', 'datos_tutor_dni')
    OR coalesce(payload ->> 'path', '')
       ~ ('^' || centro_id::text || '/' || nino_id::text || '/[A-Za-z0-9_-]+\.pdf$')
  );
