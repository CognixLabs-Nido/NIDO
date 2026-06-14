-- =============================================================================
-- Fase 11-A (RGPD) — Activar la tabla `consentimientos` como FUENTE DE VERDAD
-- =============================================================================
--
-- Spec: docs/specs/proteccion-datos.md (approved) — Comportamiento 2 + Decisiones
-- #4 (tabla = verdad, columnas usuarios = caché, revocación con revocado_en) y
-- #13 (versionado por tipo → re-consentimiento). Decisión #8 (NO añadir trigger
-- de audit: la propia tabla append-only ES el registro probatorio).
--
-- Estado previo: la tabla existe desde F2 (append-only por RLS: INSERT self,
-- SELECT self/admin; sin UPDATE/DELETE) pero NUNCA se escribía desde la app — el
-- único versionado real corría por las columnas usuarios.consentimiento_*_version
-- (CONSENT_VERSION='v1.0' hardcoded). Aquí se ACTIVA.
--
-- Modelo (append-only):
--   - Cada consentimiento DADO = una fila (revocado_en NULL).
--   - REVOCAR = fijar revocado_en (transición única NULL→timestamp) en la fila
--     vigente, vía RPC SECURITY DEFINER. No se borra ni se reescribe el resto.
--   - RE-CONSENTIR (texto nuevo, #13) = fila NUEVA con la versión nueva.
--   - Vigente para (usuario, tipo) = última fila por aceptado_en con revocado_en NULL.
--   - Las columnas usuarios.consentimiento_{terminos,privacidad}_version son CACHÉ
--     denormalizada (lectura rápida); se mantienen en la MISMA transacción que la
--     fila, dentro de los RPC.
--
-- NO se toca el ENUM consentimiento_tipo (terminos|privacidad|imagen|datos_medicos).
-- El tipo `imagen` queda listo en el modelo pero su captura va por la firma F8
-- (pieza siguiente), no aquí.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Columna de revocación (Decisión #4). Coherencia: revocado_en >= aceptado_en.
-- -----------------------------------------------------------------------------
ALTER TABLE public.consentimientos
  ADD COLUMN IF NOT EXISTS revocado_en timestamptz NULL;

ALTER TABLE public.consentimientos
  ADD CONSTRAINT consentimientos_revocado_coherente
  CHECK (revocado_en IS NULL OR revocado_en >= aceptado_en);

COMMENT ON COLUMN public.consentimientos.revocado_en IS
  'F11-A/RGPD: NULL = consentimiento vigente; timestamp = revocado (transición única). '
  'Vigente para (usuario, tipo) = última fila por aceptado_en con revocado_en NULL. '
  'No se reactiva: re-consentir crea una fila nueva.';

-- -----------------------------------------------------------------------------
-- 2. Trigger: en UPDATE solo se permite fijar revocado_en (una vez). El resto de
--    columnas son inmutables. Espejo del patrón `solo_confirmar` de F8.
--    (No hay policy UPDATE → los clientes no pueden UPDATE directo; este trigger
--    es defensa en profundidad y normaliza el timestamp server-side.)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consentimientos_solo_revocar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.revocado_en IS NOT NULL THEN
    RAISE EXCEPTION 'consentimientos: fila ya revocada, inmutable'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Inmutabilidad de todo salvo revocado_en (que se fija a now() server-side).
  NEW.id          := OLD.id;
  NEW.usuario_id  := OLD.usuario_id;
  NEW.tipo        := OLD.tipo;
  NEW.version     := OLD.version;
  NEW.aceptado_en := OLD.aceptado_en;
  NEW.ip_address  := OLD.ip_address;
  NEW.user_agent  := OLD.user_agent;
  NEW.created_at  := OLD.created_at;
  NEW.revocado_en := now();
  RETURN NEW;
END $$;

CREATE TRIGGER consentimientos_solo_revocar
  BEFORE UPDATE ON public.consentimientos
  FOR EACH ROW EXECUTE FUNCTION public.consentimientos_solo_revocar();

-- -----------------------------------------------------------------------------
-- 3. RPC de captura: inserta la fila (verdad) y refresca la caché en usuarios,
--    en la MISMA transacción. Autorizado a service role (captura en el alta) o
--    al propio usuario (re-consentimiento self-service). 1 tipo por llamada.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_consentimiento(
  p_usuario_id uuid,
  p_tipo       public.consentimiento_tipo,
  p_version    text,
  p_ip         inet  DEFAULT NULL,
  p_user_agent text  DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Service role (captura en el alta) tiene auth.uid() NULL; un usuario
  -- autenticado solo puede registrar el suyo.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'no autorizado a registrar consentimientos de otro usuario'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.consentimientos (usuario_id, tipo, version, ip_address, user_agent)
  VALUES (p_usuario_id, p_tipo, p_version, p_ip, p_user_agent)
  RETURNING id INTO v_id;

  -- Caché denormalizada (solo terminos/privacidad tienen columna en usuarios).
  IF p_tipo = 'terminos' THEN
    UPDATE public.usuarios SET consentimiento_terminos_version = p_version WHERE id = p_usuario_id;
  ELSIF p_tipo = 'privacidad' THEN
    UPDATE public.usuarios SET consentimiento_privacidad_version = p_version WHERE id = p_usuario_id;
  END IF;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.registrar_consentimiento(uuid, public.consentimiento_tipo, text, inet, text)
  TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. RPC de revocación (self-service): fija revocado_en en la fila vigente del
--    tipo e invalida la caché. Idempotente: si no hay vigente, devuelve NULL.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revocar_consentimiento(
  p_tipo public.consentimiento_tipo
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no autenticado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.consentimientos
    SET revocado_en = now()                 -- el trigger lo re-normaliza a now()
  WHERE id = (
    SELECT id FROM public.consentimientos
    WHERE usuario_id = v_uid AND tipo = p_tipo AND revocado_en IS NULL
    ORDER BY aceptado_en DESC
    LIMIT 1
  )
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN NULL;  -- nada vigente que revocar
  END IF;

  IF p_tipo = 'terminos' THEN
    UPDATE public.usuarios SET consentimiento_terminos_version = NULL WHERE id = v_uid;
  ELSIF p_tipo = 'privacidad' THEN
    UPDATE public.usuarios SET consentimiento_privacidad_version = NULL WHERE id = v_uid;
  END IF;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.revocar_consentimiento(public.consentimiento_tipo)
  TO authenticated;

COMMIT;
