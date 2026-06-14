-- =============================================================================
-- Fase 11-A5 (RGPD) — Auditoría del export de datos (acceso art. 15 + portab. 20)
-- =============================================================================
--
-- Spec: docs/specs/proteccion-datos.md (Decisión #10, export completo en Ola 1).
-- El export es un ACCESO a datos personales → debe quedar registrado (accountability).
-- Como es una LECTURA (los triggers de audit solo capturan escrituras), se registra
-- explícitamente con una fila append-only por sujeto exportado.
--
-- Quién escribe: la capa de app, con service-role, DESPUÉS de que la RLS del
-- solicitante haya autorizado la lectura del sujeto (patrón ADR-0027). No hay
-- policy de INSERT/UPDATE/DELETE → los clientes no escriben aquí directamente.
-- Quién lee: la dirección del centro (es_admin), para acreditar los accesos.
-- =============================================================================

BEGIN;

CREATE TABLE public.export_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sujeto_tipo    text NOT NULL CHECK (sujeto_tipo IN ('usuario', 'nino')),
  sujeto_id      uuid NOT NULL,
  solicitado_por uuid REFERENCES public.usuarios(id),   -- quién ejerció el export
  centro_id      uuid NOT NULL REFERENCES public.centros(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX export_log_centro_ts ON public.export_log (centro_id, created_at DESC);
CREATE INDEX export_log_sujeto    ON public.export_log (sujeto_tipo, sujeto_id);

COMMENT ON TABLE public.export_log IS
  'F11-A5/RGPD: registro append-only de cada export de datos (acceso/portabilidad). '
  'Escritura solo service-role tras autorizar la lectura; SELECT solo admin del centro.';

ALTER TABLE public.export_log ENABLE ROW LEVEL SECURITY;

-- La dirección consulta los accesos de su centro. Sin policy de escritura: solo
-- el service-role (que bypassa RLS) inserta tras autorizar.
CREATE POLICY export_log_admin_select ON public.export_log
  FOR SELECT USING (public.es_admin(centro_id));

COMMIT;
