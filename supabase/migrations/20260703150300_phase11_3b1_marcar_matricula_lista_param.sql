-- =============================================================================
-- F11 alta PR-3b-1 (modo "Completa Dirección") — (4/4) marcar_matricula_lista param
-- -----------------------------------------------------------------------------
-- Parametriza `marcar_matricula_lista` para que la Directora pueda FINALIZAR el
-- alta EN NOMBRE del tutor (pendiente → lista), auditable (auth.uid() = la admin).
--
-- Se añade `p_usuario_id uuid DEFAULT NULL` AL FINAL (patrón 4c-2: DROP de la firma
-- vieja de 1 arg + CREATE con el parámetro nuevo con DEFAULT + re-GRANT):
--   - p_usuario_id NULL  → RAMA TUTOR (modo familia): IDÉNTICA (es_tutor_legal_de).
--     La llamada existente de 1 arg resuelve a esta función con el default → NO se
--     rompe.
--   - p_usuario_id != NULL → RAMA ADMIN (modo Dirección): GATE TRIPLE en vez de
--     es_tutor_legal_de; el UPDATE y sus guardas (apellidos/fecha_nac) son IDÉNTICOS.
--
-- GATE TRIPLE (rama admin): (a) es_admin(centro_de_nino) + (b) matrícula
-- pendiente/lista + (c) p_usuario_id = tutor_legal_principal del niño.
--
-- APLICAR POR SQL EDITOR (rol postgres). NO por CLI.
-- =============================================================================

DROP FUNCTION IF EXISTS public.marcar_matricula_lista(uuid);

CREATE OR REPLACE FUNCTION public.marcar_matricula_lista(
  p_nino_id    uuid,
  p_usuario_id uuid DEFAULT NULL   -- el TUTOR (modo Dirección); NULL = modo familia
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_usuario_id IS NOT NULL THEN
    -- ── RAMA ADMIN (modo Dirección): GATE TRIPLE ────────────────────────────
    -- (a) admin DEL CENTRO del niño (auth.uid() = la Directora → audit correcto).
    IF NOT public.es_admin(public.centro_de_nino(p_nino_id)) THEN
      RAISE EXCEPTION 'no autorizado: no es admin del centro del nino'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- (b) alta EN CURSO: matrícula 'pendiente' o 'lista'.
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
    -- (c) p_usuario_id ES el tutor_legal_principal de ESE niño.
    IF NOT EXISTS (
      SELECT 1 FROM public.vinculos_familiares
      WHERE nino_id = p_nino_id
        AND usuario_id = p_usuario_id
        AND tipo_vinculo = 'tutor_legal_principal'
        AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'no autorizado: el usuario no es el tutor principal de este nino'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    -- ── RAMA TUTOR (modo familia) — IDÉNTICA a la versión anterior ──────────
    IF NOT public.es_tutor_legal_de(p_nino_id) THEN
      RAISE EXCEPTION 'no autorizado a finalizar el alta de este nino'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- UPDATE y guardas IDÉNTICOS en ambos modos (identidad mínima del niño completa).
  UPDATE public.matriculas
     SET estado = 'lista'
   WHERE nino_id = p_nino_id
     AND estado = 'pendiente'
     AND fecha_baja IS NULL
     AND deleted_at IS NULL
     AND EXISTS (
       SELECT 1 FROM public.ninos n
        WHERE n.id = p_nino_id
          AND n.apellidos IS NOT NULL
          AND n.fecha_nacimiento IS NOT NULL
     )
   RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.marcar_matricula_lista(uuid, uuid) TO authenticated;
