-- =============================================================================
-- Fase 11-A6 (RGPD) — Retención por tiempo + barrido programado
-- =============================================================================
--
-- Spec: docs/specs/proteccion-datos.md (approved) — Comportamiento 5 + Decisión
-- #12 (plazos placeholder a validar por abogado en F11-B; automatización en Ola 1)
-- y #7 (las firmas se CONSERVAN; solo se purga el OBJETO de Storage del DNI, no la
-- fila probatoria ni su `datos.adjuntos`/hash).
--
-- Esta pieza es mayormente de APLICACIÓN (el borrado de objetos de Storage y de
-- auth.users no es SQL): el barrido vive en `src/features/retencion` y lo dispara
-- un cron (Vercel Cron → route protegida con CRON_SECRET, D1). Lo único que toca
-- BD es este registro append-only de ejecuciones (D6), que da traza/auditoría del
-- barrido (qué categoría, cuántos objetos, en qué centro, simulado vs purgado).
--
-- Reuso de A4: el barrido reaprovecha el patrón de manifiesto declarativo de
-- adjuntos y `borrarObjetosBucket`; `purgarVencidos()` (olvido con gracia) lo
-- programa el MISMO cron. A6 = retención POR ANTIGÜEDAD (ortogonal al olvido a
-- demanda de A4).
-- =============================================================================

BEGIN;

-- Categorías de dato con retención por tiempo (extensible: agendas/asistencias/
-- mensajes quedan FUERA por ahora — pendiente política F11-B, D7).
CREATE TYPE public.retencion_categoria AS ENUM (
  'dni_recogida',        -- recogida-adjuntos: foto de DNI de terceros (#7: solo el objeto)
  'foto_perfil_nino',    -- ninos-fotos: foto de la ficha del niño
  'foto_blog_exclusiva'  -- aula-fotos: media donde el niño es el ÚNICO etiquetado (#5)
);

-- Acción de una ejecución: 'simulado' = dry-run (lista lo que purgaría, NO borra);
-- 'purgado' = borrado autónomo efectivo (D4: dry-run primero, luego autónomo).
CREATE TYPE public.retencion_accion AS ENUM ('simulado', 'purgado');

-- -----------------------------------------------------------------------------
-- Registro append-only de ejecuciones del barrido de retención (D6). Es la
-- auditoría del barrido: NO guarda PII (ni paths), solo categoría/centro/recuento
-- y la referencia del sujeto para trazar. Escritura solo vía service-role (el
-- barrido); sin policy de INSERT/UPDATE/DELETE → append-only para todos los roles.
-- -----------------------------------------------------------------------------
CREATE TABLE public.retencion_ejecuciones (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria    public.retencion_categoria NOT NULL,
  centro_id    uuid NOT NULL REFERENCES public.centros(id) ON DELETE CASCADE,
  ref_tipo     text,                                  -- 'nino' | 'firma' (traza, sin PII)
  ref_id       uuid,                                  -- id del sujeto/firma afectado
  bucket       text NOT NULL,
  objetos      integer NOT NULL DEFAULT 0 CHECK (objetos >= 0),  -- nº de objetos de Storage
  motivo       text,                                  -- predicado que disparó (p. ej. 'puntual_vencida')
  accion       public.retencion_accion NOT NULL,
  ejecutado_en timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX retencion_ejecuciones_centro
  ON public.retencion_ejecuciones (centro_id, ejecutado_en DESC);

COMMENT ON TABLE public.retencion_ejecuciones IS
  'F11-A6/RGPD: registro append-only del barrido de retención por tiempo. '
  'Sin PII (categoría/centro/recuento/ref). Escritura solo vía service-role.';

ALTER TABLE public.retencion_ejecuciones ENABLE ROW LEVEL SECURITY;

-- La dirección del centro consulta el historial de barridos de SU centro. Sin
-- policy de write: el barrido escribe con service-role (bypass RLS).
CREATE POLICY retencion_ejecuciones_admin_select ON public.retencion_ejecuciones
  FOR SELECT USING (public.es_admin(centro_id));

COMMIT;
