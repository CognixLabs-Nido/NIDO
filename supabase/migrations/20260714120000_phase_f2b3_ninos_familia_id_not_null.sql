-- =============================================================================
-- F-2b-3 · ninos.familia_id → NOT NULL
-- -----------------------------------------------------------------------------
-- Cierra el modelo Familia: TODO niño cuelga de una familia. Desde #190 el único
-- creador de niños (RPC `crear_o_anadir_a_familia`) setea `familia_id` SIEMPRE; no
-- hay ningún otro INSERT de `ninos` en la app. El wizard/cola de F-2b-3 leen y
-- escriben el perfil del tutor por familia (`familia_tutores`), así que dejar
-- `familia_id` nullable permitiría estados sin perfil resoluble.
--
-- SIN backfill: la BD del piloto está limpia (0 niños). Si hubiera filas con
-- `familia_id IS NULL`, este ALTER fallaría — es deliberado (no se relaja el NOT
-- NULL: se corregirían los datos antes). El factory de test crea la familia antes
-- del niño (F-2b-3), así que la suite RLS cumple el NOT NULL.
--
-- Aplicar por SQL Editor (rol postgres). NO por CLI. No genera diff de tipos
-- relevante (columna ya existía; solo cambia la nulabilidad).
-- =============================================================================
BEGIN;

ALTER TABLE public.ninos ALTER COLUMN familia_id SET NOT NULL;

COMMIT;
