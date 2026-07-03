-- =============================================================================
-- F11 alta PR-3b-1 (modo "Completa Dirección") — (2/4) RPC registrar_firma_como_admin
-- -----------------------------------------------------------------------------
-- Firma FÍSICA (autorización en papel) que la Directora registra EN NOMBRE del
-- tutor. Es SECURITY DEFINER y la invoca la SESIÓN DE LA ADMIN (no service role):
-- así `auth.uid()` = la Directora y el `audit_log` la registra a ELLA como actor,
-- mientras la FILA queda imputada al TUTOR (`firmante_id = p_usuario_id`).
--
-- La firma resultante:
--   firmante_id   = p_usuario_id (el tutor),
--   decision      = 'firmado',
--   metodo_firma  = 'presencial'  (CHECK relajado en la migración 1/4),
--   firma_imagen  = NULL          (no hay trazo),
--   nombre_tecleado = nombre del tutor (lo teclea la Directora),
--   texto_hash/texto_version = del texto vigente (mismo invariante que la firma
--   normal: sin datos, hash = sha256(normalizarTexto(texto))).
--
-- GATE TRIPLE embebido (server-side, NO se confía en la app):
--   (a) es_admin(centro_de_nino(p_nino_id)) — admin DEL CENTRO del niño.
--   (b) matrícula del niño en 'pendiente' o 'lista' (NUNCA 'activa'/'baja').
--   (c) p_usuario_id ES el tutor_legal_principal de ESE niño (no otro id).
-- Cualquier fallo → RAISE insufficient_privilege. Impide firmar por un usuario
-- arbitrario o fuera de un alta en curso.
--
-- APLICAR POR SQL EDITOR (rol postgres). NO por CLI. Depende de la migración 1/4.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.registrar_firma_como_admin(
  p_nino_id         uuid,
  p_autorizacion_id uuid,
  p_usuario_id      uuid,             -- el TUTOR imputado (firmante_id)
  p_nombre_tecleado text,
  p_ip_address      inet DEFAULT NULL,-- contexto de la Directora (o NULL)
  p_user_agent      text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_tipo    public.tipo_autorizacion;
  v_texto   text;
  v_version text;
  v_rol     public.tipo_vinculo;
  v_norm    text;
  v_hash    text;
  v_id      uuid;
BEGIN
  -- ── GATE TRIPLE ───────────────────────────────────────────────────────────
  -- (a) admin DEL CENTRO del niño. auth.uid() = la Directora que llama → el
  --     audit_log la registra a ELLA (rastro correcto de quién actuó).
  IF NOT public.es_admin(public.centro_de_nino(p_nino_id)) THEN
    RAISE EXCEPTION 'no autorizado: no es admin del centro del nino'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- (b) alta EN CURSO: matrícula 'pendiente' o 'lista' (nunca 'activa'/'baja').
  IF NOT EXISTS (
    SELECT 1 FROM public.matriculas
    WHERE nino_id = p_nino_id
      AND estado IN ('pendiente', 'lista')
      AND fecha_baja IS NULL
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'no autorizado: el alta no esta en curso (pendiente/lista)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- (c) el usuario imputado ES el tutor_legal_principal de ESE niño (no otro id).
  SELECT tipo_vinculo INTO v_rol
  FROM public.vinculos_familiares
  WHERE nino_id = p_nino_id
    AND usuario_id = p_usuario_id
    AND tipo_vinculo = 'tutor_legal_principal'
    AND deleted_at IS NULL;
  IF v_rol IS NULL THEN
    RAISE EXCEPTION 'no autorizado: el usuario no es el tutor principal de este nino'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── Documento firmable (misma validación que la firma normal) ─────────────
  SELECT tipo, texto, texto_version INTO v_tipo, v_texto, v_version
  FROM public.autorizaciones WHERE id = p_autorizacion_id;
  IF v_texto IS NULL THEN
    RAISE EXCEPTION 'autorizacion no encontrada' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.autorizacion_firmable(p_autorizacion_id) THEN
    RAISE EXCEPTION 'la autorizacion no es firmable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.autorizacion_aplica_a_nino(p_autorizacion_id, p_nino_id) THEN
    RAISE EXCEPTION 'la autorizacion no aplica a este nino'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- La firma física del alta es de ACUSE (reglas de régimen interno / imágenes):
  -- SIN `datos` estructurados. recogida/medicación atan `datos` al hash → esas NO
  -- se firman por esta vía (evita un hash inconsistente).
  IF v_tipo IN ('recogida', 'medicacion') THEN
    RAISE EXCEPTION 'firma presencial no soportada para recogida/medicacion'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  -- ── texto_hash = sha256(normalizarTexto(texto)) — MISMO invariante que hashFirma
  --    sin datos (app lib/hash.ts): CRLF/CR→LF + recorte de espacios/tabs al final
  --    de cada línea; luego SHA-256 de los bytes UTF-8 en hex. ──────────────────
  v_norm := regexp_replace(
              regexp_replace(v_texto, E'\r\n?', E'\n', 'g'),
              E'[ \t]+$', '', 'gn'
            );
  v_hash := encode(digest(convert_to(v_norm, 'UTF8'), 'sha256'), 'hex');

  -- ── Inserción append-only: imputada al TUTOR, método PRESENCIAL, sin trazo.
  --    `datos` usa el DEFAULT '{}'::jsonb (igual que la firma normal sin payload)
  --    → coherente con el hash sin datos. ─────────────────────────────────────
  INSERT INTO public.firmas_autorizacion (
    autorizacion_id, nino_id, firmante_id, rol_firmante, decision, metodo_firma,
    texto_hash, texto_version, nombre_tecleado, firma_imagen, ip_address, user_agent
  ) VALUES (
    p_autorizacion_id, p_nino_id, p_usuario_id, v_rol, 'firmado', 'presencial',
    v_hash, v_version, p_nombre_tecleado, NULL, p_ip_address, p_user_agent
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_firma_como_admin(uuid, uuid, uuid, text, inet, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_firma_como_admin(uuid, uuid, uuid, text, inet, text) TO authenticated;

COMMENT ON FUNCTION public.registrar_firma_como_admin(uuid, uuid, uuid, text, inet, text) IS
  'Firma PRESENCIAL (autorización en papel) que la Directora registra en nombre del tutor. Gate triple embebido (admin del centro + alta pendiente/lista + p_usuario_id = tutor principal del niño). La fila queda imputada al tutor; el audit_log registra a la Directora (auth.uid()). PR-3b-1.';
