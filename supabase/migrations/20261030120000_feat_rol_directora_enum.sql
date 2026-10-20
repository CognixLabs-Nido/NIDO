-- =============================================================================
-- FEAT — El valor directora en user_role (PR 2 del modelo de roles, 1 de 2)
-- -----------------------------------------------------------------------------
-- El rol de la directora: una o varias por centro, con todo el día a día; la admin es también
-- directora sin fila aparte. Va en su propia migración porque un valor nuevo de un enum no se
-- puede usar en la misma transacción que lo añade. Por sí solo no cambia nada: el permiso se lo da
-- `20261030130000`, que se aplica después.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor, ANTES de
-- `20261030130000`. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'directora';
