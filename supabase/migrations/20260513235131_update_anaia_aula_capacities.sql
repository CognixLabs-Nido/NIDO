-- =============================================================================
-- Actualiza la capacidad_maxima de las 5 aulas iniciales de ANAIA con los
-- datos reales aportados por el responsable tras Fase 2.
-- =============================================================================
-- Aulas identificadas por nombre dentro del centro ANAIA
-- (33c79b50-13b5-4962-b849-d88dd6a21366):
--
--   Sea:             8
--   Farm big:        13
--   Farm little:     13
--   Sabanna big:     20
--   Sabanna little:  20
--
-- El UPDATE es idempotente: si la migración se aplica en un entorno donde
-- ya tengan los valores correctos, no rompe nada. Si una de las aulas no
-- existe (caso `db reset` que aún no ha corrido el seed inicial), el UPDATE
-- afecta 0 filas y la migración sigue.
--
-- El seed inicial (`20260513202012_phase2_core_entities.sql`) NO se edita
-- para mantener la inmutabilidad de las migraciones aplicadas; sin embargo,
-- ese seed inserta 12 para todas las aulas por defecto, y esta migración
-- se aplica inmediatamente después, dejando los datos reales en su sitio.
-- =============================================================================

UPDATE public.aulas
SET capacidad_maxima = CASE nombre
  WHEN 'Sea'            THEN 8
  WHEN 'Farm big'       THEN 13
  WHEN 'Farm little'    THEN 13
  WHEN 'Sabanna big'    THEN 20
  WHEN 'Sabanna little' THEN 20
END
WHERE centro_id = '33c79b50-13b5-4962-b849-d88dd6a21366'
  AND nombre IN ('Sea', 'Farm big', 'Farm little', 'Sabanna big', 'Sabanna little');
