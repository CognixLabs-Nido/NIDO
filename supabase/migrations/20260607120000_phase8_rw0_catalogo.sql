-- =============================================================================
-- Fase 8 — REWORK 0 (F8-RW-0): CATÁLOGO (plantilla durable) + dos patrones A/B
-- =============================================================================
-- ADITIVA sobre F8-0 (20260603120000) y F8-2-0 (20260606120000). NUNCA
-- drop+recreate de tablas. Implementa el modelo corregido del addendum del spec
-- (docs/specs/autorizaciones-firma.md §0-§6, decisiones de 2026-06-07):
--
--   El modelo de F8-0 confundía EL DOCUMENTO/FORMATO con EL ACTO de asignar/firmar
--   (CHECK forzaba nino_id NOT NULL en reglas/recogida/medicación/imágenes →
--   horneaba "por niño"). Aquí se separa:
--
--   • PLANTILLA durable (es_plantilla=true): el documento de catálogo. Una activa
--     por (centro, tipo) para reglas/imagenes/recogida/medicacion. NO se firma.
--   • INSTANCIA (es_plantilla=false): lo firmable. Tres formas:
--       - salida   : bespoke por evento (sin plantilla_id) — como F8-0.
--       - patrón A : la directora ENVÍA reglas/imagenes a una AUDIENCIA
--                    (ambito niño/aula/centro) → plantilla_id + ambito.
--       - patrón B : el TUTOR crea una instancia de recogida/medicacion desde la
--                    plantilla publicada (B2, decisión 2026-06-07), ambito='nino',
--                    nino_id propio, y firma esa instancia. Vigencia/estado por-niño
--                    de primera clase (medicación: episodios con caducidad propia;
--                    recogida: lista habitual y puntual coexisten con vigencias
--                    distintas) → por eso B2 y no B1 (firmar la plantilla directa).
--
--   Las filas LEGACY (reglas #56, instancia-por-niño del modelo viejo, plantilla_id
--   NULL) SIGUEN VÁLIDAS — el CHECK relajado admite esa forma hasta migrarlas a
--   plantilla+envío en el follow-up "reglas→A". No se rompe nada desplegado.
--
--   firmas_autorizacion.datos + hash compuesto (F8-2-0): SE CONSERVAN. En B la
--   firma apunta a la INSTANCIA del niño; en A, a la instancia enviada; en salida,
--   a la instancia-evento. Una PLANTILLA nunca se firma directamente.
--
-- IDEMPOTENCIA: #57 (F8-2-0) se aplicó al remoto pero NO se mergea (recogida se
-- rehace) → su migración no está en `main`. Esta migración re-asegura de forma
-- idempotente la columna firmas.datos + su CHECK (ADD COLUMN IF NOT EXISTS /
-- DROP CONSTRAINT IF EXISTS) para que `main` quede consistente tanto sobre el
-- remoto actual (donde ya existen) como sobre un clon limpio (donde no).
--
-- ⚖️ AVISO LEGAL (pendiente de abogado, RAT F11): sin cambios respecto a F8-0/F8-2-0
-- (validez de firma electrónica simple no certificada; DNIs de terceros en recogida).
-- =============================================================================
BEGIN;

-- ─── 1. ENUM de ámbito de la instancia (espejo de ambito_evento, F7) ─────────
CREATE TYPE public.autorizacion_ambito AS ENUM ('nino', 'aula', 'centro');

-- ─── 2. firmas_autorizacion.datos (idempotente — puede existir ya por F8-2-0) ─
ALTER TABLE public.firmas_autorizacion
  ADD COLUMN IF NOT EXISTS datos jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.firmas_autorizacion DROP CONSTRAINT IF EXISTS firmas_datos_size;
ALTER TABLE public.firmas_autorizacion
  ADD CONSTRAINT firmas_datos_size CHECK (char_length(datos::text) <= 20000);

COMMENT ON COLUMN public.firmas_autorizacion.datos IS
  'Datos estructurados firmados (recogida: datos.personas = [{nombre, dni, parentesco}]). Append-only: atado a esta firma y al texto_hash compuesto (hashFirma). Foto del DNI → F10 vía datos.adjuntos. ⚖️ DNIs de terceros (RAT F11).';

-- ─── 3. autorizaciones: columnas de catálogo + ámbito + plantilla_id ─────────
ALTER TABLE public.autorizaciones
  ADD COLUMN es_plantilla boolean NOT NULL DEFAULT false,
  ADD COLUMN ambito       public.autorizacion_ambito,                            -- NULL salvo instancias A/B2
  ADD COLUMN plantilla_id uuid REFERENCES public.autorizaciones(id) ON DELETE RESTRICT;  -- instancias A/B2 → su plantilla

COMMENT ON COLUMN public.autorizaciones.es_plantilla IS
  'true = documento de catálogo (formato estándar, NO firmable). false = instancia firmable (salida/A/B2 o legacy). Una plantilla activa por (centro,tipo) — idx_autorizaciones_plantilla_unica.';
COMMENT ON COLUMN public.autorizaciones.ambito IS
  'Audiencia de una INSTANCIA (niño/aula/centro). Espejo de eventos.ambito. NULL en plantillas, en salida (la audiencia viene del evento) y en filas legacy.';
COMMENT ON COLUMN public.autorizaciones.plantilla_id IS
  'Instancia (A/B2) → la plantilla de catálogo de la que deriva. NULL en plantillas, salida y legacy.';

-- ─── 4. CHECK de coherencia relajado (5 formas) ─────────────────────────────
-- Reemplaza autorizaciones_tipo_coherencia de F8-0 (que forzaba nino_id NOT NULL
-- en los tipos por-niño). Las 4 formas del modelo nuevo + la legacy.
ALTER TABLE public.autorizaciones DROP CONSTRAINT IF EXISTS autorizaciones_tipo_coherencia;
ALTER TABLE public.autorizaciones
  ADD CONSTRAINT autorizaciones_tipo_coherencia CHECK (
    -- (1) PLANTILLA durable de catálogo (formato estándar, no firmable)
    (es_plantilla = true
       AND tipo IN ('reglas_regimen_interno', 'autorizacion_imagenes', 'recogida', 'medicacion')
       AND evento_id IS NULL AND nino_id IS NULL AND aula_id IS NULL
       AND plantilla_id IS NULL AND ambito IS NULL)
    -- (2) INSTANCIA salida (bespoke por evento; la audiencia viene del evento)
    OR (es_plantilla = false AND tipo = 'salida'
       AND evento_id IS NOT NULL AND nino_id IS NULL AND aula_id IS NULL
       AND plantilla_id IS NULL AND ambito IS NULL)
    -- (3) INSTANCIA patrón A (reglas/imagenes enviadas a una audiencia)
    OR (es_plantilla = false AND tipo IN ('reglas_regimen_interno', 'autorizacion_imagenes')
       AND plantilla_id IS NOT NULL AND evento_id IS NULL AND ambito IS NOT NULL
       AND (
            (ambito = 'nino'   AND nino_id IS NOT NULL AND aula_id IS NULL)
         OR (ambito = 'aula'   AND aula_id IS NOT NULL AND nino_id IS NULL)
         OR (ambito = 'centro' AND nino_id IS NULL     AND aula_id IS NULL)
       ))
    -- (4) INSTANCIA patrón B2 (recogida/medicacion creada por el tutor desde la plantilla)
    OR (es_plantilla = false AND tipo IN ('recogida', 'medicacion')
       AND plantilla_id IS NOT NULL AND ambito = 'nino'
       AND nino_id IS NOT NULL AND evento_id IS NULL AND aula_id IS NULL)
    -- (5) LEGACY instancia-por-niño del modelo viejo (reglas/recogida/medicacion/
    --     imagenes pre-rework, sin plantilla_id). Se conservan hasta el follow-up.
    OR (es_plantilla = false
       AND tipo IN ('medicacion', 'recogida', 'reglas_regimen_interno', 'autorizacion_imagenes')
       AND plantilla_id IS NULL AND ambito IS NULL
       AND evento_id IS NULL AND nino_id IS NOT NULL AND aula_id IS NULL)
  );

-- ─── 5. Índices ──────────────────────────────────────────────────────────────
-- Una plantilla ACTIVA por (centro, tipo). Anular (estado='anulada') libera el
-- hueco → editar formato con firmas = nueva versión (anular vieja + crear nueva).
CREATE UNIQUE INDEX idx_autorizaciones_plantilla_unica
  ON public.autorizaciones (centro_id, tipo)
  WHERE es_plantilla AND estado <> 'anulada';

CREATE INDEX idx_autorizaciones_plantilla_id
  ON public.autorizaciones (plantilla_id) WHERE plantilla_id IS NOT NULL;

-- ─── 6. Helper de validación de plantilla (para el INSERT del tutor, patrón B2) ─
-- ¿plantilla_id apunta a una plantilla PUBLICADA y definitiva del mismo centro+tipo?
-- Lee OTRA fila de `autorizaciones` (la plantilla, ya commiteada) desde el WITH CHECK
-- del INSERT de la instancia → no es auto-referencia MVCC (no lee el row insertándose).
CREATE OR REPLACE FUNCTION public.autorizacion_plantilla_valida(
  p_plantilla_id uuid,
  p_centro_id    uuid,
  p_tipo         public.tipo_autorizacion
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.autorizaciones p
    WHERE p.id = p_plantilla_id
      AND p.es_plantilla = true
      AND p.centro_id = p_centro_id
      AND p.tipo = p_tipo
      AND p.estado = 'publicada'
      AND p.texto_definitivo = true
  );
$$;
GRANT EXECUTE ON FUNCTION public.autorizacion_plantilla_valida(uuid, uuid, public.tipo_autorizacion) TO authenticated;

-- ─── 7. Helper de audiencia AMPLIADO (row-aware, nueva firma con ambito) ─────
-- Cambia de firma (añade p_es_plantilla, p_ambito) → hay que recrear la policy que
-- lo usa antes de hacer DROP de la versión vieja de 5 args.
DROP POLICY IF EXISTS autorizaciones_select ON public.autorizaciones;
DROP FUNCTION IF EXISTS public.usuario_es_audiencia_autorizacion_row(uuid, public.tipo_autorizacion, uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.usuario_es_audiencia_autorizacion_row(
  p_centro_id    uuid,
  p_tipo         public.tipo_autorizacion,
  p_es_plantilla boolean,
  p_ambito       public.autorizacion_ambito,
  p_evento_id    uuid,
  p_nino_id      uuid,
  p_aula_id      uuid
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.eventos%ROWTYPE;
BEGIN
  IF public.es_admin(p_centro_id) THEN
    RETURN TRUE;
  END IF;
  -- Catálogo: el formato estándar es legible por cualquier miembro del centro
  -- (el tutor necesita verlo para iniciar una recogida/medicación — patrón B).
  IF p_es_plantilla THEN
    RETURN public.pertenece_a_centro(p_centro_id);
  END IF;
  -- salida: delega en la audiencia del evento (lee `eventos`, otra tabla → sin MVCC).
  IF p_tipo = 'salida' THEN
    SELECT * INTO e FROM public.eventos WHERE id = p_evento_id;
    IF NOT FOUND THEN RETURN FALSE; END IF;
    RETURN public.usuario_es_audiencia_evento_row(e.centro_id, e.ambito, e.aula_id, e.nino_id);
  END IF;
  -- instancias A / B2: por ámbito (espejo de la audiencia de eventos F7).
  IF p_ambito = 'nino' THEN
    RETURN public.es_profe_de_nino(p_nino_id) OR public.es_tutor_de(p_nino_id);
  ELSIF p_ambito = 'aula' THEN
    RETURN public.es_profe_de_aula(p_aula_id) OR public.es_tutor_en_aula(p_aula_id);
  ELSIF p_ambito = 'centro' THEN
    RETURN public.pertenece_a_centro(p_centro_id);
  END IF;
  -- legacy (ambito NULL, nino_id seteado, tipo por-niño del modelo viejo).
  IF p_nino_id IS NOT NULL THEN
    RETURN public.es_profe_de_nino(p_nino_id) OR public.es_tutor_de(p_nino_id);
  END IF;
  RETURN FALSE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.usuario_es_audiencia_autorizacion_row(uuid, public.tipo_autorizacion, boolean, public.autorizacion_ambito, uuid, uuid, uuid) TO authenticated;

-- ─── 8. ¿El niño está en el alcance de la INSTANCIA? (RLS de firmas) ─────────
-- Ampliado para ambito aula/centro (instancias A) además de nino/salida/legacy.
-- Una PLANTILLA nunca aplica a un niño (no se firma directamente → B2).
CREATE OR REPLACE FUNCTION public.autorizacion_aplica_a_nino(p_autorizacion_id uuid, p_nino_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.autorizaciones%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.autorizaciones WHERE id = p_autorizacion_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF a.es_plantilla THEN
    RETURN FALSE;  -- el catálogo no se firma; se firma la instancia (B2)
  END IF;
  IF a.tipo = 'salida' THEN
    RETURN public.evento_aplica_a_nino(a.evento_id, p_nino_id);
  ELSIF a.ambito = 'aula' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.matriculas m
      WHERE m.nino_id = p_nino_id AND m.aula_id = a.aula_id
        AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
    );
  ELSIF a.ambito = 'centro' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.ninos n
      WHERE n.id = p_nino_id AND n.centro_id = a.centro_id AND n.deleted_at IS NULL
    );
  ELSE  -- ambito='nino' (A/B2) o legacy (ambito NULL, nino_id seteado)
    RETURN a.nino_id = p_nino_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.autorizacion_aplica_a_nino(uuid, uuid) TO authenticated;

-- ─── 9. ¿Es firmable AHORA? + las plantillas NO son firmables ────────────────
-- Añade es_plantilla=false al guard (publicada + texto_definitivo + vigencia).
CREATE OR REPLACE FUNCTION public.autorizacion_firmable(p_autorizacion_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.autorizaciones%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.autorizaciones WHERE id = p_autorizacion_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  RETURN a.es_plantilla = false
    AND a.estado = 'publicada'
    AND a.texto_definitivo = true
    AND (a.vigencia_desde IS NULL OR public.hoy_madrid() >= a.vigencia_desde)
    AND (a.vigencia_hasta IS NULL OR public.hoy_madrid() <= a.vigencia_hasta);
END;
$$;
GRANT EXECUTE ON FUNCTION public.autorizacion_firmable(uuid) TO authenticated;

-- ─── 10. Congelar alcance tras la primera firma: + es_plantilla/ambito/plantilla_id ─
-- Extiende el trigger de F8-2-0 (CREATE OR REPLACE preserva el trigger). La
-- identidad de la instancia (catálogo del que deriva y su ámbito) también se congela.
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
       OR NEW.es_plantilla         IS DISTINCT FROM OLD.es_plantilla
       OR NEW.ambito               IS DISTINCT FROM OLD.ambito
       OR NEW.plantilla_id         IS DISTINCT FROM OLD.plantilla_id
     ) THEN
    RAISE EXCEPTION 'autorizaciones: el alcance consentido (texto, vigencia, modalidad, referente, catálogo o política) no se puede modificar tras existir firmas (crea una versión nueva)'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 11. RLS: SELECT (recrear con la nueva firma del helper) ─────────────────
-- Catálogo legible por miembros del centro; instancias por audiencia/ámbito.
CREATE POLICY autorizaciones_select ON public.autorizaciones
  FOR SELECT USING (
    public.usuario_es_audiencia_autorizacion_row(centro_id, tipo, es_plantilla, ambito, evento_id, nino_id, aula_id)
  );

-- ─── 12. RLS: INSERT (admin catálogo/Enviar + profe salida + TUTOR instancia B2) ─
-- B2 (decisión 2026-06-07): el tutor crea la instancia de recogida/medicación de
-- SU hijo desde una plantilla publicada del centro. Acotado por RLS:
--   es_tutor_de(nino_id) + plantilla publicada del mismo centro+tipo + ambito='nino'.
DROP POLICY IF EXISTS autorizaciones_insert ON public.autorizaciones;
CREATE POLICY autorizaciones_insert ON public.autorizaciones
  FOR INSERT WITH CHECK (
    creado_por = auth.uid()
    AND (
      -- admin: catálogo (plantillas) y Enviar (instancias A) — cualquier forma del centro
      public.es_admin(centro_id)
      -- profe: salida de un evento de su aula (como F8-0)
      OR (tipo = 'salida'
          AND public.es_profe_de_evento(evento_id)
          AND public.centro_de_evento(evento_id) = centro_id)
      -- tutor: instancia B2 de recogida/medicación de su propio hijo desde la plantilla
      OR (es_plantilla = false
          AND tipo IN ('recogida', 'medicacion')
          AND ambito = 'nino'
          AND nino_id IS NOT NULL
          AND plantilla_id IS NOT NULL
          AND public.es_tutor_de(nino_id)
          AND public.autorizacion_plantilla_valida(plantilla_id, centro_id, tipo))
    )
  );

-- autorizaciones_update / firmas_insert / firmas_select: SIN CAMBIOS.
--   • firmas_insert sigue exigiendo es_tutor_de + autorizacion_aplica_a_nino (ampliado
--     arriba) + autorizacion_firmable (ahora excluye plantillas). El tutor firma su
--     instancia B2; las plantillas no se firman.
--   • firmas_select ya cubre lectura por profe del aula del niño + admin (B firmadas).

COMMIT;
