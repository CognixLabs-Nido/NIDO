-- =============================================================================
-- Fase 8-2-0 — Recogida: datos estructurados de la firma + congelar alcance
-- =============================================================================
-- ADITIVA sobre F8-0 (20260603120000_phase8_autorizaciones.sql). No drop/recreate.
-- Recogida (`tipo='recogida'`) reusa el mecanismo de F8-1/F8-2b, pero la familia
-- aporta al firmar una LISTA de personas autorizadas (nombre + DNI). Esa lista:
--   - viaja CON la firma (append-only, inmutable): nueva columna
--     `firmas_autorizacion.datos jsonb`. Cambiar la lista = re-firmar (fila nueva).
--   - queda ATADA al hash: el server computa
--       texto_hash = sha256( normalizar(texto) || 0x01 || canonicalJSON(datos.personas) )
--     (helper hashFirma; sin lista ⇒ sha256(texto) EXACTO → compat F8-1/F8-2b).
--
-- Además, **congelamos el alcance consentido**: una vez existe alguna firma, no se
-- pueden cambiar ni el texto NI la vigencia/modalidad/referente/política de la
-- autorización (el trigger de F8-0 solo bloqueaba el texto). Anular (estado) sigue
-- permitido (no altera lo consentido, solo lo retira).
--
-- ⚖️ AVISO LEGAL (pendiente de abogado, RAT en F11): la lista contiene DNIs de
-- TERCEROS (adultos que recogen, que no son usuarios de la app). El centro trata
-- datos de terceros → requiere base jurídica + deber de información a esas personas,
-- además de la validez (no certificada) de la firma electrónica simple.
-- =============================================================================
BEGIN;

-- ─── 1. firmas_autorizacion.datos: la lista de personas autorizadas (recogida) ─
-- Vacío `{}` para los tipos sin datos (salida/reglas/medicación) → no rompe nada.
ALTER TABLE public.firmas_autorizacion
  ADD COLUMN datos jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Tope de tamaño (red de seguridad; el límite fino de personas lo valida Zod).
ALTER TABLE public.firmas_autorizacion
  ADD CONSTRAINT firmas_datos_size CHECK (char_length(datos::text) <= 20000);

COMMENT ON COLUMN public.firmas_autorizacion.datos IS
  'Datos estructurados firmados (recogida: datos.personas = [{nombre, dni, parentesco}]). Append-only: atado a esta firma y al texto_hash compuesto (hashFirma). Foto del DNI → F10 vía datos.adjuntos. ⚖️ DNIs de terceros (RAT F11).';

-- ─── 2. Congelar el ALCANCE consentido tras la primera firma ─────────────────
-- CREATE OR REPLACE preserva el trigger ...bloquea_texto_tras_firma_trg de F8-0.
-- Antes solo bloqueaba texto/version; ahora congela todo lo que define el alcance
-- de lo que el tutor consintió: el documento, su vigencia, su modalidad (datos),
-- el referente (tipo/niño/evento/aula) y la política de firmantes. `estado`
-- (publicar antes de firmar; anular después) y `updated_at` siguen libres.
CREATE OR REPLACE FUNCTION public.autorizaciones_bloquea_texto_tras_firma()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.firmas_autorizacion f WHERE f.autorizacion_id = OLD.id)
     AND (
          NEW.texto                IS DISTINCT FROM OLD.texto
       OR NEW.texto_version        IS DISTINCT FROM OLD.texto_version
       OR NEW.titulo               IS DISTINCT FROM OLD.titulo
       OR NEW.datos                IS DISTINCT FROM OLD.datos
       OR NEW.vigencia_desde       IS DISTINCT FROM OLD.vigencia_desde
       OR NEW.vigencia_hasta       IS DISTINCT FROM OLD.vigencia_hasta
       OR NEW.firmantes_requeridos IS DISTINCT FROM OLD.firmantes_requeridos
       OR NEW.tipo                 IS DISTINCT FROM OLD.tipo
       OR NEW.nino_id              IS DISTINCT FROM OLD.nino_id
       OR NEW.evento_id            IS DISTINCT FROM OLD.evento_id
       OR NEW.aula_id              IS DISTINCT FROM OLD.aula_id
     ) THEN
    RAISE EXCEPTION 'autorizaciones: el alcance consentido (texto, vigencia, modalidad, referente o política) no se puede modificar tras existir firmas (crea una versión nueva)'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
