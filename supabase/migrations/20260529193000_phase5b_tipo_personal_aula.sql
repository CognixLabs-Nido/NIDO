-- Fase 5B PR #34 — ENUM tipo_personal_aula en profes_aulas.
--
-- Sustituye la semántica del booleano es_profe_principal por un enum
-- cerrado de 4 valores. La columna nueva queda NOT NULL con default
-- 'profesora' (default cubre helpers de tests e inserts legacy que no
-- pasan el campo explícitamente; el server action sí lo pasa).
--
-- Backfill (idempotente):
--   es_profe_principal=true  → 'coordinadora'
--   es_profe_principal=false → 'profesora'
--
-- es_profe_principal NO se dropea aquí — queda deprecated y se elimina
-- en un PR posterior tras un sprint de validación en produccion.
--
-- Índice único parcial: el 1-coordinadora-por-aula reemplaza al antiguo
-- 1-principal-por-aula con la misma semántica funcional.

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. ENUM type
-- ----------------------------------------------------------------------------
CREATE TYPE public.tipo_personal_aula AS ENUM (
  'coordinadora',
  'profesora',
  'tecnico',
  'apoyo'
);

-- ----------------------------------------------------------------------------
-- 2. Columna nullable (paso intermedio para que el backfill no falle)
-- ----------------------------------------------------------------------------
ALTER TABLE public.profes_aulas
  ADD COLUMN tipo_personal_aula public.tipo_personal_aula;

COMMENT ON COLUMN public.profes_aulas.tipo_personal_aula IS
  'Tipo de personal asignado al aula. F5B-#34. Backfill inicial: '
  'es_profe_principal=true → coordinadora; false → profesora. '
  'Tras la migracion, el admin del centro puede reclasificar al tipo '
  'correcto (especialmente para identificar tecnicos que hoy quedan '
  'como profesora).';

COMMENT ON COLUMN public.profes_aulas.es_profe_principal IS
  'DEPRECATED desde F5B-#34 — reemplazado por tipo_personal_aula. '
  'Drop en PR siguiente tras un sprint en produccion.';

-- ----------------------------------------------------------------------------
-- 3. Backfill idempotente
-- ----------------------------------------------------------------------------
UPDATE public.profes_aulas
SET tipo_personal_aula =
  CASE WHEN es_profe_principal THEN 'coordinadora'::public.tipo_personal_aula
       ELSE 'profesora'::public.tipo_personal_aula END
WHERE tipo_personal_aula IS NULL;

DO $$
BEGIN
  RAISE NOTICE 'F5B-#34: backfill completado. Revisar profes_aulas: cada coordinadora '
               'ya tiene tipo_personal_aula. Si algun profe NO principal es en realidad '
               'tecnico o apoyo, reclasificarlo manualmente vía UPDATE.';
END $$;

-- ----------------------------------------------------------------------------
-- 4. NOT NULL + default (default protege helpers/tests e inserts legacy)
-- ----------------------------------------------------------------------------
ALTER TABLE public.profes_aulas
  ALTER COLUMN tipo_personal_aula SET DEFAULT 'profesora';

ALTER TABLE public.profes_aulas
  ALTER COLUMN tipo_personal_aula SET NOT NULL;

-- ----------------------------------------------------------------------------
-- 5. Indice unico parcial: 1 coordinadora activa por aula
-- ----------------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_un_principal_activo_por_aula;

CREATE UNIQUE INDEX idx_un_coordinadora_activa_por_aula
  ON public.profes_aulas (aula_id)
  WHERE tipo_personal_aula = 'coordinadora'
    AND fecha_fin IS NULL
    AND deleted_at IS NULL;

COMMIT;
