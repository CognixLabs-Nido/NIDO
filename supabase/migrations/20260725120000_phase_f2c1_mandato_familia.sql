-- =============================================================================
-- F-2c-1 — Relajar `mandatos_sepa` a la FAMILIA (esquema + RPC + lectores)
-- -----------------------------------------------------------------------------
-- Decisión de fondo cerrada (F-2c, opción a): el mandato SEPA es de la FAMILIA,
-- no del niño. `nino_id` pasa a NULLABLE e INFORMATIVO (qué niño originó el alta);
-- el mandato cuelga de `familia_id` (columna añadida NULLABLE por F-0). Un mandato
-- por familia ACTIVO a la vez; los revocados se conservan (estado='revocado',
-- deleted_at NULL) para trazabilidad. HAY 0 FILAS en la tabla → relajación LIBRE,
-- sin backfill ni dual-write.
--
-- Contenido (subfase 2c-1, SIN UI — el paso 8 del alta es 2c-2; las pantallas de
-- gestión/sustitución son 2c-3/2c-4):
--   1) Esquema: nino_id DROP NOT NULL; CHECK familia_id NOT NULL; índice único
--      parcial 1-activo-por-familia; trigger de centro_id derivado de familia_id.
--   2) RLS de `mandatos_sepa` reescrita por familia (es_admin OR es_tutor_de_familia).
--   3) RPCs por familia: `registrar_mandato_sepa` (upsert-in-place del activo de la
--      familia, idempotente — conserva el comportamiento del alta actual) y
--      `sustituir_mandato_sepa` (revoca el activo + inserta el nuevo, atómico — para
--      2c-3/2c-4). Cifrado del IBAN idéntico (pgp_sym_encrypt + _get_sepa_key).
--   4) `get_mandatos_remesa` resuelve el mandato ACTIVO por la FAMILIA del niño del
--      recibo (recibo → nino → ninos.familia_id → mandato de la familia). El pain.008
--      NO cambia: mismas columnas de salida y misma semántica (IBAN del deudor).
--
-- Reutiliza helpers YA existentes: `centro_de_familia`/`es_tutor_de_familia` (F-0),
-- `_get_sepa_key` (G-2bis), `es_admin`, `centro_de_nino`. NO crea helper nuevo (el
-- "tutor legal de la familia" es exactamente `es_tutor_de_familia`, gate por
-- pertenencia a `familia_tutores`).
--
-- ⚠️ PRERREQUISITO DE OPERADOR: el secreto 'sepa_encryption_key' debe existir en
--    Vault (lo creó F11-G-2bis). El PERFORM final revierte la migración si no.
-- APLICAR POR SQL EDITOR (rol postgres). NO por CLI. `database.ts` se tipa a mano.
-- =============================================================================
BEGIN;

-- ─── 1. Esquema: nino_id opcional, familia_id obligatorio ─────────────────────
ALTER TABLE public.mandatos_sepa ALTER COLUMN nino_id DROP NOT NULL;

-- El mandato es de la familia → familia_id SIEMPRE presente en filas nuevas.
-- (0 filas legacy → se exige directamente, sin tolerancia.)
ALTER TABLE public.mandatos_sepa
  DROP CONSTRAINT IF EXISTS mandatos_sepa_familia_requerida;
ALTER TABLE public.mandatos_sepa
  ADD CONSTRAINT mandatos_sepa_familia_requerida CHECK (familia_id IS NOT NULL);

COMMENT ON COLUMN public.mandatos_sepa.nino_id IS
  'F-2c-1: INFORMATIVO/OPCIONAL — qué niño originó el alta del mandato. El mandato es de la FAMILIA (familia_id). Nullable desde F-2c-1.';
COMMENT ON COLUMN public.mandatos_sepa.familia_id IS
  'F-2c-1: dueña del mandato SEPA (obligatoria). Un único mandato ACTIVO por familia (índice único parcial).';

-- ─── 2. Índices: 1 mandato ACTIVO por familia; retirar el no-único redundante ──
DROP INDEX IF EXISTS public.idx_mandatos_sepa_familia;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mandatos_sepa_familia_activo
  ON public.mandatos_sepa (familia_id)
  WHERE estado = 'activo' AND deleted_at IS NULL;

-- ─── 3. centro_id derivado de familia_id (no de un nino_id que puede ser NULL) ─
-- El trigger compartido `derivar_centro_id_de_nino` (datos_tutor/becas/…) NO se
-- toca; `mandatos_sepa` recibe su propio trigger que deriva de familia_id.
CREATE OR REPLACE FUNCTION public.derivar_centro_id_de_mandato_sepa()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.centro_id := public.centro_de_familia(NEW.familia_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS mandatos_sepa_set_centro_id ON public.mandatos_sepa;
CREATE TRIGGER mandatos_sepa_set_centro_id
  BEFORE INSERT ON public.mandatos_sepa
  FOR EACH ROW EXECUTE FUNCTION public.derivar_centro_id_de_mandato_sepa();

-- ─── 4. RLS por familia (es_admin OR tutor de la familia) ─────────────────────
DROP POLICY IF EXISTS mandatos_sepa_select ON public.mandatos_sepa;
DROP POLICY IF EXISTS mandatos_sepa_insert ON public.mandatos_sepa;
DROP POLICY IF EXISTS mandatos_sepa_update ON public.mandatos_sepa;

CREATE POLICY mandatos_sepa_select ON public.mandatos_sepa
  FOR SELECT TO authenticated
  USING (public.es_admin(centro_id) OR public.es_tutor_de_familia(familia_id));
CREATE POLICY mandatos_sepa_insert ON public.mandatos_sepa
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.es_admin(centro_id) OR public.es_tutor_de_familia(familia_id))
    AND usuario_id = auth.uid()
  );
CREATE POLICY mandatos_sepa_update ON public.mandatos_sepa
  FOR UPDATE TO authenticated
  USING (public.es_admin(centro_id) OR public.es_tutor_de_familia(familia_id))
  WITH CHECK (public.es_admin(centro_id) OR public.es_tutor_de_familia(familia_id));
-- DELETE: sin policy → default DENY (revocar = estado='revocado', se conserva).

-- ─── 5. registrar_mandato_sepa por FAMILIA (upsert-in-place, idempotente) ─────
-- Cambia la firma (p_nino_id → p_familia_id + p_nino_id informativo) → DROP de la
-- vieja (12 args) + CREATE. Comportamiento: si la familia ya tiene mandato ACTIVO,
-- lo ACTUALIZA en su sitio (re-firma/corrección del alta, respeta el índice único);
-- si no, lo INSERTA. Idempotente y sin violar UNIQUE(familia_id) activo. La
-- SUSTITUCIÓN con histórico (revoca+inserta) es la RPC aparte `sustituir_mandato_sepa`.
DROP FUNCTION IF EXISTS public.registrar_mandato_sepa(
  uuid, text, text, text, text, text, text, text, inet, text, timestamptz, public.firma_metodo
);

CREATE OR REPLACE FUNCTION public.registrar_mandato_sepa(
  p_familia_id            uuid,
  p_nino_id               uuid,   -- INFORMATIVO/OPCIONAL: qué niño originó el alta
  p_iban                  text,
  p_titular               text,
  p_identificador_mandato text,
  p_documento_path        text,
  p_firma_imagen          text,
  p_nombre_tecleado       text,
  p_texto_hash            text,
  p_ip_address            inet,
  p_user_agent            text,
  p_fecha_firma           timestamptz,
  p_metodo                public.firma_metodo DEFAULT 'digital'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_clave text := public._get_sepa_key();
  v_uid   uuid := auth.uid();
  v_id    uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  -- Gate por FAMILIA: admin del centro de la familia O tutor de la familia.
  IF NOT (public.es_admin(public.centro_de_familia(p_familia_id))
          OR public.es_tutor_de_familia(p_familia_id)) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF p_iban IS NULL OR char_length(p_iban) < 15 OR char_length(p_iban) > 34 THEN
    RAISE EXCEPTION 'IBAN inválido';
  END IF;

  -- Mandato ACTIVO de la familia (no por nino+usuario). Si existe → upsert-in-place.
  SELECT id INTO v_id
  FROM public.mandatos_sepa
  WHERE familia_id = p_familia_id AND estado = 'activo' AND deleted_at IS NULL
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.mandatos_sepa SET
      nino_id               = p_nino_id,
      usuario_id            = v_uid,
      iban_cifrado          = pgp_sym_encrypt(p_iban, v_clave),
      titular               = p_titular,
      identificador_mandato = p_identificador_mandato,
      documento_path        = p_documento_path,
      estado                = 'activo',
      firma_imagen          = p_firma_imagen,
      nombre_tecleado       = p_nombre_tecleado,
      texto_hash            = p_texto_hash,
      ip_address            = p_ip_address,
      user_agent            = p_user_agent,
      fecha_firma           = p_fecha_firma,
      metodo_firma          = p_metodo
    WHERE id = v_id;
  ELSE
    INSERT INTO public.mandatos_sepa (
      centro_id, familia_id, nino_id, usuario_id, iban_cifrado, titular,
      identificador_mandato, documento_path, estado, firma_imagen,
      nombre_tecleado, texto_hash, ip_address, user_agent, fecha_firma, metodo_firma
    ) VALUES (
      public.centro_de_familia(p_familia_id), p_familia_id, p_nino_id, v_uid,
      pgp_sym_encrypt(p_iban, v_clave), p_titular,
      p_identificador_mandato, p_documento_path, 'activo', p_firma_imagen,
      p_nombre_tecleado, p_texto_hash, p_ip_address, p_user_agent, p_fecha_firma, p_metodo
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_mandato_sepa(
  uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamptz, public.firma_metodo
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_mandato_sepa(
  uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamptz, public.firma_metodo
) TO authenticated;

-- ─── 6. sustituir_mandato_sepa: revoca el activo + inserta el nuevo (atómico) ──
-- Para las pantallas de gestión (2c-3/2c-4): cambiar de banco/IBAN sin perder el
-- mandato anterior. En UNA transacción (la propia función): UPDATE el activo a
-- 'revocado' (conservado, deleted_at NULL) + INSERT el nuevo 'activo'. Sin bloque
-- EXCEPTION (atomicidad = si algo falla, revierte todo). Mismo gate y cifrado.
CREATE OR REPLACE FUNCTION public.sustituir_mandato_sepa(
  p_familia_id            uuid,
  p_nino_id               uuid,   -- INFORMATIVO/OPCIONAL
  p_iban                  text,
  p_titular               text,
  p_identificador_mandato text,
  p_documento_path        text,
  p_firma_imagen          text,
  p_nombre_tecleado       text,
  p_texto_hash            text,
  p_ip_address            inet,
  p_user_agent            text,
  p_fecha_firma           timestamptz,
  p_metodo                public.firma_metodo DEFAULT 'digital'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_clave text := public._get_sepa_key();
  v_uid   uuid := auth.uid();
  v_id    uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF NOT (public.es_admin(public.centro_de_familia(p_familia_id))
          OR public.es_tutor_de_familia(p_familia_id)) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF p_iban IS NULL OR char_length(p_iban) < 15 OR char_length(p_iban) > 34 THEN
    RAISE EXCEPTION 'IBAN inválido';
  END IF;

  -- Revoca el activo actual de la familia (se conserva la fila: estado='revocado',
  -- deleted_at NULL). Libera el índice único ANTES del INSERT del nuevo activo.
  UPDATE public.mandatos_sepa
    SET estado = 'revocado'
    WHERE familia_id = p_familia_id AND estado = 'activo' AND deleted_at IS NULL;

  INSERT INTO public.mandatos_sepa (
    centro_id, familia_id, nino_id, usuario_id, iban_cifrado, titular,
    identificador_mandato, documento_path, estado, firma_imagen,
    nombre_tecleado, texto_hash, ip_address, user_agent, fecha_firma, metodo_firma
  ) VALUES (
    public.centro_de_familia(p_familia_id), p_familia_id, p_nino_id, v_uid,
    pgp_sym_encrypt(p_iban, v_clave), p_titular,
    p_identificador_mandato, p_documento_path, 'activo', p_firma_imagen,
    p_nombre_tecleado, p_texto_hash, p_ip_address, p_user_agent, p_fecha_firma, p_metodo
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sustituir_mandato_sepa(
  uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamptz, public.firma_metodo
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sustituir_mandato_sepa(
  uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamptz, public.firma_metodo
) TO authenticated;

-- ─── 7. get_mandatos_remesa: resolver el mandato por la FAMILIA del niño ───────
-- Único cambio funcional frente a 20260701120000: el enlace recibo→mandato ya no
-- es por `ms.nino_id = r.nino_id`, sino por la FAMILIA del niño del recibo
-- (`ms.familia_id = n.familia_id`). Mismas columnas de salida, misma semántica,
-- mismo descifrado → el generador pain.008 NO cambia. `ninos.familia_id` es NOT
-- NULL (F-2b-3) → el INNER JOIN a `ninos` no descarta filas.
CREATE OR REPLACE FUNCTION public.get_mandatos_remesa(p_remesa_id uuid)
RETURNS TABLE (
  recibo_id             uuid,
  nino_id               uuid,
  total_centimos        integer,
  identificador_mandato text,
  iban                  text,
  titular               text,
  fecha_mandato         date
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_clave  text := public._get_sepa_key();
  v_centro uuid := public.centro_de_remesa(p_remesa_id);
BEGIN
  IF v_centro IS NULL THEN
    RAISE EXCEPTION 'Remesa no encontrada';
  END IF;
  IF NOT public.es_admin(v_centro) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.nino_id,
    r.total_centimos,
    m.identificador_mandato,
    CASE
      WHEN m.iban_cifrado IS NULL THEN NULL
      ELSE pgp_sym_decrypt(m.iban_cifrado, v_clave)
    END,
    m.titular,
    m.fecha_mandato
  FROM public.recibos_remesa rr
  JOIN public.recibos r ON r.id = rr.recibo_id
  -- Familia del niño del recibo (familia_id NOT NULL desde F-2b-3).
  JOIN public.ninos n ON n.id = r.nino_id
  -- Mandato ACTIVO más reciente de la FAMILIA (determinista). LEFT JOIN: si no hay,
  -- la fila sale con los campos de mandato en NULL (el generador la señala y rechaza).
  LEFT JOIN LATERAL (
    SELECT
      ms.identificador_mandato,
      ms.iban_cifrado,
      ms.titular,
      COALESCE(ms.fecha_firma, ms.created_at)::date AS fecha_mandato
    FROM public.mandatos_sepa ms
    WHERE ms.familia_id = n.familia_id
      AND ms.estado = 'activo'
      AND ms.deleted_at IS NULL
    ORDER BY ms.fecha_firma DESC NULLS LAST, ms.created_at DESC, ms.id DESC
    LIMIT 1
  ) m ON true
  WHERE rr.remesa_id = p_remesa_id
    AND r.metodo = 'sepa'
    AND r.deleted_at IS NULL
  ORDER BY r.nino_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_mandatos_remesa(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mandatos_remesa(uuid) TO authenticated;

-- ─── 8. Validación: la clave de Vault debe existir (si no, revierte todo) ──────
DO $$ BEGIN PERFORM public._get_sepa_key(); END $$;

COMMIT;
