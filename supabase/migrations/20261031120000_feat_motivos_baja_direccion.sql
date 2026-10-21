-- =============================================================================
-- FEAT — Motivos de baja de Dirección (PR 4 del modelo de roles, 1 de 2)
-- -----------------------------------------------------------------------------
-- Dos valores nuevos en `motivo_borrado`, para las filas de `roles_usuario` que retira la
-- gestión de Dirección:
--   · `baja_direccion`: una directora deja la dirección del centro (la da de baja la admin, o se
--     da de baja ella);
--   · `traspaso_admin`: el traspaso de la administración, que retira la fila `admin` de la
--     saliente y la fila `directora` de la entrante.
-- Va en su propia migración porque un valor nuevo de un enum no se puede usar en la misma
-- transacción que lo añade. Por sí solo no cambia nada: lo usa `20261031130000`, que se aplica
-- después.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor, ANTES de
-- `20261031130000`. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

ALTER TYPE public.motivo_borrado ADD VALUE IF NOT EXISTS 'baja_direccion';
ALTER TYPE public.motivo_borrado ADD VALUE IF NOT EXISTS 'traspaso_admin';
