-- =============================================================================
-- F-2b-5 — DROP de `datos_tutor`. Cierra el ciclo de migración a `familia_tutores`.
-- -----------------------------------------------------------------------------
-- `datos_tutor` era el perfil de tutor **por-niño** (identidad/dirección/DNI del
-- alta, una fila por cada niño). Queda **sustituida por `familia_tutores`**, el
-- perfil **por-tutor de familia** (COMPARTIDO entre los hermanos, no duplicado).
--
-- La migración de ESCRITURAS y LECTURAS a `familia_tutores` se cerró en #198
-- (guardar-datos-tutor, DNI, cambios-pendientes/aplicar, lectores del alta). El
-- ÚLTIMO consumidor vivo (la purga de curso a 5 años, que borraba filas de
-- `datos_tutor`) se retiró en #201. A esta altura `datos_tutor` NO tiene ningún
-- consumidor de app (0 `from('datos_tutor')` fuera de tests) ni objeto de BD que
-- dependa de ella:
--   · FKs ENTRANTES a datos_tutor: ninguna (verificado contra pg_constraint).
--   · FKs SALIENTES (centro_id/nino_id/usuario_id): se van con el DROP TABLE.
--   · Funciones/vistas/RPC que la lean: ninguna (verificado contra pg_proc/pg_views).
--   · Triggers: `datos_tutor_set_centro_id` (fn `derivar_centro_id_de_nino`) y
--     `datos_tutor_set_updated_at` (fn `set_updated_at`) — las **funciones** son
--     COMPARTIDAS (8 y 48 triggers respectivamente) → se dropean solo los
--     TRIGGERS, nunca las funciones.
--   · Índices (`datos_tutor_pkey`, `idx_datos_tutor_nino_vinculo`): se van con el
--     DROP TABLE.
--
-- Es un DROP irreversible. La tabla `familia_tutores` ya contiene el dato vivo.
-- =============================================================================

BEGIN;

-- 1. Policies (RLS) de datos_tutor.
DROP POLICY IF EXISTS datos_tutor_select ON public.datos_tutor;
DROP POLICY IF EXISTS datos_tutor_insert ON public.datos_tutor;
DROP POLICY IF EXISTS datos_tutor_update ON public.datos_tutor;

-- 2. Triggers de datos_tutor. Solo los triggers: las funciones que invocan
--    (`derivar_centro_id_de_nino`, `set_updated_at`) son compartidas por otras
--    tablas y NO se tocan.
DROP TRIGGER IF EXISTS datos_tutor_set_centro_id ON public.datos_tutor;
DROP TRIGGER IF EXISTS datos_tutor_set_updated_at ON public.datos_tutor;

-- 3. La tabla. Arrastra sus FKs salientes (centro_id/nino_id/usuario_id) y sus
--    índices (pkey, idx_datos_tutor_nino_vinculo). No hay FK entrante que la
--    bloquee, así que no hace falta CASCADE.
DROP TABLE IF EXISTS public.datos_tutor;

COMMIT;
