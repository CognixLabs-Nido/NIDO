-- F11 · Alta tutor-driven · Pieza 1 — Fundación
--
-- Sienta las bases para el alta tutor-driven (spec docs/specs/alta-tutor-driven.md):
--   A. Estado de matrícula: ENUM matricula_estado + columna matriculas.estado.
--      'pendiente' (esqueleto a completar por el tutor — se usa en la pieza 2),
--      'activa' (matrícula vigente), 'baja' (dada de baja). fecha_baja conserva la
--      FECHA; estado es el ESTADO (independientes, no se derivan). Default 'activa'.
--   B. invitaciones.tipo_vinculo: la invitación lleva el tipo de vínculo a crear al
--      aceptar (auto-vínculo en accept-invitation). NULLABLE y sin default DB (las
--      invitaciones admin/profe NO llevan tipo); el "default principal" para
--      tutor_legal lo aplica sendInvitation en la app.
--
-- vinculos_familiares NO se toca: su UNIQUE (nino_id, usuario_id) ya habilita el
-- ON CONFLICT DO NOTHING del auto-vínculo idempotente.

-- ============================================================
-- Bloque A — estado de matrícula
-- ============================================================

CREATE TYPE public.matricula_estado AS ENUM ('pendiente', 'activa', 'baja');

ALTER TABLE public.matriculas
  ADD COLUMN estado public.matricula_estado NOT NULL DEFAULT 'activa';

-- Backfill: las cerradas → 'baja'; el resto se queda 'activa' por el default.
UPDATE public.matriculas SET estado = 'baja' WHERE fecha_baja IS NOT NULL;

-- ============================================================
-- Bloque B — invitaciones.tipo_vinculo
-- ============================================================

ALTER TABLE public.invitaciones
  ADD COLUMN tipo_vinculo public.tipo_vinculo NULL;

-- Backfill de invitaciones ABIERTAS (las cerradas se quedan NULL; el CHECK lo permite).
UPDATE public.invitaciones SET tipo_vinculo = 'tutor_legal_principal'
  WHERE rol_objetivo = 'tutor_legal' AND tipo_vinculo IS NULL
    AND accepted_at IS NULL AND rejected_at IS NULL;
UPDATE public.invitaciones SET tipo_vinculo = 'autorizado'
  WHERE rol_objetivo = 'autorizado' AND tipo_vinculo IS NULL
    AND accepted_at IS NULL AND rejected_at IS NULL;

-- CHECK permisivo con NULL (no rompe las filas cerradas existentes con tipo NULL):
--   - admin/profe → solo NULL (no llevan tipo de vínculo).
--   - tutor_legal → principal | secundario.
--   - autorizado → 'autorizado'.
ALTER TABLE public.invitaciones
  ADD CONSTRAINT invitaciones_tipo_vinculo_coherente CHECK (
    tipo_vinculo IS NULL
    OR (rol_objetivo = 'tutor_legal' AND tipo_vinculo IN ('tutor_legal_principal', 'tutor_legal_secundario'))
    OR (rol_objetivo = 'autorizado' AND tipo_vinculo = 'autorizado')
  );
