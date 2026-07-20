-- =============================================================================
-- Alta wizard · acuses_alta — acuse por-niño de normas/imagen SIN documento
-- -----------------------------------------------------------------------------
-- Regresión del wizard de alta: aceptar las NORMAS de régimen interno o la
-- AUTORIZACIÓN DE IMAGEN dependía de que existiera una instancia/plantilla publicada
-- de `autorizaciones` (patrón A normas / B2 imagen). En test no hay documentos reales →
-- imposible aceptar → imposible finalizar el alta.
--
-- Vía B (decisión de Jose): la aceptación de normas/imagen es un ACUSE por-niño por
-- CHECKBOX, sin firma, sin trazo, sin documento, registrado por sí mismo. Es una vía
-- VÁLIDA del gate de finalizar ADEMÁS de la firma real (`firmas_autorizacion`): si el
-- centro publica el documento, se sigue pudiendo abrir/leer/firmar; pero aceptar NUNCA
-- depende de que exista. SEPA NO cambia (se firma en pantalla con trazo, mecanismo aparte).
--
-- Tabla aditiva, sin relajar ninguna FK/constraint. RLS: el TUTOR del niño registra y lee
-- su propio acuse (mismo gate que `firmas_autorizacion.firmas_insert`: `es_tutor_de` +
-- `firmante_id = auth.uid()`), con coherencia centro↔niño vía `centro_de_nino` (patrón
-- `beca_comedor_mes`, D-6-1). El admin del centro puede leerlos.
--
-- Sin trigger de audit_log (fuera de scope, igual que beca_comedor_mes D-6-1). Sin
-- updated_at (un acuse es un hecho puntual: se registra una vez, no se edita).
--
-- Aplicar por SQL Editor / db push (rol postgres). Regenerar database.ts DESPUÉS.
-- =============================================================================
BEGIN;

CREATE TABLE public.acuses_alta (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nino_id     uuid NOT NULL REFERENCES public.ninos(id),
  centro_id   uuid NOT NULL REFERENCES public.centros(id),
  tipo        text NOT NULL CHECK (tipo IN ('normas', 'imagen')),
  firmante_id uuid REFERENCES auth.users(id),
  aceptado_en timestamptz NOT NULL DEFAULT now(),
  metodo      text NOT NULL DEFAULT 'checkbox',
  -- Un acuse por niño y tipo (idempotente: re-aceptar no duplica).
  UNIQUE (nino_id, tipo)
);

COMMENT ON TABLE public.acuses_alta IS
  'Alta wizard: acuse por-niño de normas/imagen por checkbox (SIN documento). Vía válida del gate de finalizar además de la firma real (firmas_autorizacion).';

-- -----------------------------------------------------------------------------
-- RLS: el tutor del niño registra/lee su acuse; el admin del centro lo lee.
-- -----------------------------------------------------------------------------
ALTER TABLE public.acuses_alta ENABLE ROW LEVEL SECURITY;

-- INSERT: el tutor del niño registra su propio acuse. Mismo gate que
-- `firmas_autorizacion.firmas_insert` (es_tutor_de + firmante_id=auth.uid()) + coherencia
-- centro↔niño (patrón beca_comedor_mes): un centro_id que no sea el del niño → rechazado.
CREATE POLICY acuses_alta_insert ON public.acuses_alta
  FOR INSERT WITH CHECK (
    public.es_tutor_de(nino_id)
    AND firmante_id = auth.uid()
    AND public.centro_de_nino(nino_id) = centro_id
  );

-- SELECT: el tutor del niño y el admin del centro.
CREATE POLICY acuses_alta_select ON public.acuses_alta
  FOR SELECT USING (
    public.es_tutor_de(nino_id)
    OR public.es_admin(centro_id)
  );

COMMIT;
