-- =============================================================================
-- PR-D (auditoría F11-D, D2) — el actor humano queda en audit_log.
--
-- Tres flujos escribían `ninos` con service role tras autorizar en la app, así que el
-- trigger de auditoría grababa `usuario_id = auth.uid() = NULL`: no quedaba quién cambió la
-- dirección de un niño, quién subió su libro de familia o quién quitó su foto de perfil.
-- `ninos` solo tiene policy de escritura para admin (`ninos_admin_all`); una policy de tutor
-- no sirve, porque una policy decide filas y no columnas (abriría las 23 columnas al tutor).
--
-- Esta migración SOLO CREA tres RPC SECURITY DEFINER que la app llama con el cliente de
-- SESIÓN. Dentro, `auth.uid()` es el `sub` del JWT de la petición (SECURITY DEFINER cambia el
-- rol, no las claims): el trigger de auditoría, sin tocarlo, graba al humano real. No
-- modifica ninguna función, policy ni trigger existente → sin guardas de equivalencia.
--
-- Cada RPC:
--   - exige que el niño exista y no esté borrado (si no, 42501, sin revelar si existe);
--   - autoriza con `es_admin(centro del niño)` o `es_tutor_legal_de(niño)` (principal o
--     secundario; nunca un vínculo `autorizado`). El centro se lee de la fila, no del
--     llamador: nunca cross-niño ni cross-centro;
--   - escribe solo sus columnas;
--   - EXECUTE solo para `authenticated` (fuera PUBLIC y anon).
--
-- Frontera de la decisión J (cola de validación): con el alta YA validada (una matrícula
-- vigente `activa`), el tutor no puede escribir directo; su cambio va a `cambios_pendientes`.
-- Hasta hoy el tutor no tenía ningún camino de escritura en `ninos`, así que la RPC aplica
-- esa frontera para no abrir un atajo. La dirección no la tiene (ya escribe `ninos` por RLS).
-- =============================================================================

-- Alta validada = existe una matrícula vigente `activa` del niño (espejo de `altaValidada`).
CREATE OR REPLACE FUNCTION public.alta_validada_de_nino(p_nino_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.matriculas
     WHERE nino_id = p_nino_id
       AND fecha_baja IS NULL
       AND deleted_at IS NULL
       AND estado = 'activa'
  );
$$;

REVOKE ALL ON FUNCTION public.alta_validada_de_nino(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Dirección del menor + estado civil de la familia (asistente de alta).
--    `p_patch` es un objeto JSON con SOLO estas claves; una clave ausente no se toca y un
--    `null` explícito limpia el campo (misma semántica que el action).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.actualizar_familia_nino(p_nino_id uuid, p_patch jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_centro uuid;
  v_admin boolean;
  v_clave text;
BEGIN
  SELECT centro_id INTO v_centro
    FROM public.ninos
   WHERE id = p_nino_id AND deleted_at IS NULL;
  IF v_centro IS NULL THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_admin := public.es_admin(v_centro);
  IF NOT (v_admin OR public.es_tutor_legal_de(p_nino_id)) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'patch invalido' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR v_clave IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_clave NOT IN ('direccion_calle', 'direccion_numero', 'direccion_cp',
                       'direccion_ciudad', 'estado_civil_familia') THEN
      RAISE EXCEPTION 'columna no permitida: %', v_clave USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF jsonb_typeof(p_patch -> v_clave) NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'valor no permitido: %', v_clave USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END LOOP;

  IF p_patch = '{}'::jsonb THEN
    RETURN p_nino_id;
  END IF;

  IF NOT v_admin AND public.alta_validada_de_nino(p_nino_id) THEN
    RAISE EXCEPTION 'alta validada: el cambio va a la cola de validacion'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.ninos SET
    direccion_calle  = CASE WHEN p_patch ? 'direccion_calle'  THEN p_patch ->> 'direccion_calle'  ELSE direccion_calle  END,
    direccion_numero = CASE WHEN p_patch ? 'direccion_numero' THEN p_patch ->> 'direccion_numero' ELSE direccion_numero END,
    direccion_cp     = CASE WHEN p_patch ? 'direccion_cp'     THEN p_patch ->> 'direccion_cp'     ELSE direccion_cp     END,
    direccion_ciudad = CASE WHEN p_patch ? 'direccion_ciudad' THEN p_patch ->> 'direccion_ciudad' ELSE direccion_ciudad END,
    estado_civil_familia = CASE WHEN p_patch ? 'estado_civil_familia'
                                THEN (p_patch ->> 'estado_civil_familia')::public.estado_civil
                                ELSE estado_civil_familia END
  WHERE id = p_nino_id AND deleted_at IS NULL;

  RETURN p_nino_id;
END;
$$;

REVOKE ALL ON FUNCTION public.actualizar_familia_nino(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.actualizar_familia_nino(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Libro de familia: fija `libro_familia_path` y devuelve el anterior (la app borra ese
--    objeto de Storage). Backstop de ruta, igual que el CHECK de R1 en cambios_pendientes:
--    `{centro_id}/{nino_id}/<nombre>.pdf` del PROPIO niño.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fijar_libro_familia_nino(p_nino_id uuid, p_path text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_centro uuid;
  v_admin boolean;
  v_anterior text;
BEGIN
  SELECT centro_id, libro_familia_path INTO v_centro, v_anterior
    FROM public.ninos
   WHERE id = p_nino_id AND deleted_at IS NULL;
  IF v_centro IS NULL THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_admin := public.es_admin(v_centro);
  IF NOT (v_admin OR public.es_tutor_legal_de(p_nino_id)) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_path IS NULL
     OR p_path !~ ('^' || v_centro::text || '/' || p_nino_id::text || '/[A-Za-z0-9_-]+\.pdf$') THEN
    RAISE EXCEPTION 'la ruta del libro de familia no es del nino'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT v_admin AND public.alta_validada_de_nino(p_nino_id) THEN
    RAISE EXCEPTION 'alta validada: el cambio va a la cola de validacion'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.ninos
     SET libro_familia_path = p_path
   WHERE id = p_nino_id AND deleted_at IS NULL;

  RETURN v_anterior;
END;
$$;

REVOKE ALL ON FUNCTION public.fijar_libro_familia_nino(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fijar_libro_familia_nino(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Quitar la foto de perfil del niño (revocación del consentimiento de imagen): pone
--    `foto_url` a NULL y devuelve la anterior (la app borra el original y la miniatura).
--    Solo quita, nunca pone una ruta: sin frontera de la cola (reduce datos, no los cambia).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.quitar_foto_perfil_nino(p_nino_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_centro uuid;
  v_anterior text;
BEGIN
  SELECT centro_id, foto_url INTO v_centro, v_anterior
    FROM public.ninos
   WHERE id = p_nino_id AND deleted_at IS NULL;
  IF v_centro IS NULL THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (public.es_admin(v_centro) OR public.es_tutor_legal_de(p_nino_id)) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_anterior IS NOT NULL THEN
    UPDATE public.ninos
       SET foto_url = NULL
     WHERE id = p_nino_id AND deleted_at IS NULL;
  END IF;

  RETURN v_anterior;
END;
$$;

REVOKE ALL ON FUNCTION public.quitar_foto_perfil_nino(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quitar_foto_perfil_nino(uuid) TO authenticated;
