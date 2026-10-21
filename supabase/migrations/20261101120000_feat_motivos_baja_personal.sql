-- =============================================================================
-- FEAT — Motivos de baja del personal (baja temporal y salida del centro, 1 de 2)
-- -----------------------------------------------------------------------------
-- Dos valores nuevos en `motivo_borrado`, para la fila `profe` de `roles_usuario`:
--   · `baja_temporal`: enfermedad, maternidad, excedencia. Sigue siendo de la casa y volverá;
--     mientras tanto no entra. Al volver, Dirección la reactiva desde Personal, sin invitación.
--   · `salida_centro`: despido o se va. Definitivo: si vuelve, es un alta nueva con invitación.
-- Va en su propia migración porque un valor nuevo de un enum no se puede usar en la misma
-- transacción que lo añade. Por sí solo no cambia nada: lo usa `20261101130000`, que se aplica
-- después.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor, ANTES de
-- `20261101130000`. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

ALTER TYPE public.motivo_borrado ADD VALUE IF NOT EXISTS 'baja_temporal';
ALTER TYPE public.motivo_borrado ADD VALUE IF NOT EXISTS 'salida_centro';
