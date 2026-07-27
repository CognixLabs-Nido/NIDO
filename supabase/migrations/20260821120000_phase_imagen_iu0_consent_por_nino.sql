-- =============================================================================
-- IU-0 · Autorización de IMAGEN por-niño: `consentimientos` (tipo='imagen') como
--        FUENTE DE VERDAD ÚNICA, y `ninos.puede_aparecer_en_fotos` DERIVADO de ella.
-- -----------------------------------------------------------------------------
-- Contexto: TEST sin datos reales → se construye LIMPIO desde cero (no se migra el
-- acuse viejo de #237; eso es IU-2). Esta subfase es la FUNDACIÓN: modelo por-niño +
-- helpers + trigger derivador. NO reconduce el alta (IU-2), NO quita el toggle manual
-- (IU-1), NO toca subida/revocación/pantalla.
--
-- MECANISMO REUTILIZADO (no se inventa otro): el ledger `consentimientos` ya es
-- append-only con `revocado_en` (NULL = VIGENTE; el trigger `consentimientos_solo_revocar`
-- solo permite la transición NULL→now() y la redacción de metadatos). "Otorgar" = fila
-- nueva; "revocar" = sellar `revocado_en`. Aquí solo se añade la dimensión POR NIÑO
-- (`nino_id`) para el tipo 'imagen', y el derivado del flag.
--
-- Decisiones de diseño de Jose aplicadas: consent por-niño (nino_id); un consent vigente
-- del niño ⇒ autorizado; el flag SIEMPRE derivado (nunca a mano — IU-1 retira el toggle);
-- estricto por-niño (el consent/flag de un niño NO afecta a sus hermanos).
--
-- Aplicar por SQL Editor / db push (rol postgres). Regenerar database.ts después. La
-- suite gated se activa con IMAGEN_CONSENT_DERIVADO_APPLIED=1 tras aplicar.
-- =============================================================================
BEGIN;

-- ── 1. `consentimientos` gana la dimensión POR NIÑO (solo obligatoria en 'imagen') ──
ALTER TABLE public.consentimientos
  ADD COLUMN nino_id uuid REFERENCES public.ninos(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.consentimientos.nino_id IS
  'IU-0: niño al que aplica el consentimiento de IMAGEN (por-niño). NULL en los tipos de cuenta (terminos/privacidad/datos_medicos).';

-- Limpieza de TEST (sin ceremonia): imagen sin niño no debe existir bajo el modelo nuevo.
DELETE FROM public.consentimientos WHERE tipo = 'imagen' AND nino_id IS NULL;

-- CHECK: imagen ⇒ nino_id NOT NULL. El resto de tipos se quedan como están (nino_id NULL).
ALTER TABLE public.consentimientos
  ADD CONSTRAINT consentimientos_imagen_requiere_nino
    CHECK (tipo <> 'imagen' OR nino_id IS NOT NULL);

CREATE INDEX idx_consentimientos_imagen_nino
  ON public.consentimientos (nino_id) WHERE tipo = 'imagen';

-- ── 2. Append-only: `nino_id` INMUTABLE en UPDATE (revocación/redacción) ─────────────
-- Extiende `consentimientos_solo_revocar` (BEFORE UPDATE) fijando NEW.nino_id := OLD.nino_id
-- (la identidad del consentimiento no cambia; solo se sella `revocado_en` o se redactan
-- metadatos). El resto del cuerpo es IDÉNTICO al vivo.
CREATE OR REPLACE FUNCTION public.consentimientos_solo_revocar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Inmutables siempre.
  NEW.id          := OLD.id;
  NEW.usuario_id  := OLD.usuario_id;
  NEW.tipo        := OLD.tipo;
  NEW.version     := OLD.version;
  NEW.aceptado_en := OLD.aceptado_en;
  NEW.created_at  := OLD.created_at;
  NEW.nino_id     := OLD.nino_id;   -- IU-0: identidad por-niño inmutable.

  -- Metadatos re-identificables: solo se permiten BORRAR (→NULL) para la
  -- redacción del derecho al olvido; cualquier otro valor se rechaza forzando OLD.
  NEW.ip_address  := CASE WHEN NEW.ip_address IS NULL THEN NULL ELSE OLD.ip_address END;
  NEW.user_agent  := CASE WHEN NEW.user_agent IS NULL THEN NULL ELSE OLD.user_agent END;

  -- Revocación: transición única NULL→now(). Si ya estaba revocada, se conserva.
  IF OLD.revocado_en IS NULL THEN
    NEW.revocado_en := now();
  ELSE
    NEW.revocado_en := OLD.revocado_en;
  END IF;

  RETURN NEW;
END $function$;

-- ── 3. Helper por-niño: ¿imagen VIGENTE de ESE niño? ────────────────────────────────
-- VOLATILE a propósito (lección F11-A3): se invoca desde el trigger derivador AFTER y
-- DEBE ver la fila recién insertada/actualizada; un STABLE usaría el snapshot previo.
-- COALESCE(...,false): NULL NUNCA autoriza (lección NULL-propagation).
CREATE OR REPLACE FUNCTION public.tiene_consentimiento_imagen(p_nino_id uuid)
 RETURNS boolean
 LANGUAGE sql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT true FROM public.consentimientos
    WHERE tipo = 'imagen' AND nino_id = p_nino_id AND revocado_en IS NULL
    LIMIT 1
  ), false);
$function$;

GRANT EXECUTE ON FUNCTION public.tiene_consentimiento_imagen(uuid) TO authenticated;

-- ── 4. Otorgar / revocar POR NIÑO sobre el MISMO ledger (append + revocado_en) ──────
-- Autorización (SECURITY DEFINER bypassa RLS): service (auth.uid NULL, p.ej. captura en
-- el alta) o admin del centro del niño o tutor del niño. Espejo de la guardia de
-- `registrar_consentimiento`, pero por-niño.
CREATE OR REPLACE FUNCTION public.otorgar_consentimiento_imagen(
  p_nino_id uuid,
  p_tutor uuid,
  p_version text DEFAULT 'imagen-v1',
  p_ip inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_metodo public.firma_metodo DEFAULT 'digital'
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.es_admin(public.centro_de_nino(p_nino_id))
     AND NOT public.es_tutor_de(p_nino_id) THEN
    RAISE EXCEPTION 'no autorizado a otorgar consentimiento de imagen de este niño'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.consentimientos
    (usuario_id, tipo, version, nino_id, ip_address, user_agent, metodo_firma)
  VALUES
    (p_tutor, 'imagen', p_version, p_nino_id, p_ip, p_user_agent, p_metodo)
  RETURNING id INTO v_id;   -- el trigger derivador recalcula el flag del niño

  RETURN v_id;
END $function$;

GRANT EXECUTE ON FUNCTION
  public.otorgar_consentimiento_imagen(uuid, uuid, text, inet, text, public.firma_metodo)
  TO authenticated;

-- Revoca TODAS las filas de imagen VIGENTES del niño (una por tutor si hubiera varias).
-- Por-niño estricto: no toca a los hermanos. Devuelve cuántas revocó (0 = nada vigente).
CREATE OR REPLACE FUNCTION public.revocar_consentimiento_imagen(p_nino_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.es_admin(public.centro_de_nino(p_nino_id))
     AND NOT public.es_tutor_de(p_nino_id) THEN
    RAISE EXCEPTION 'no autorizado a revocar consentimiento de imagen de este niño'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH upd AS (
    UPDATE public.consentimientos
       SET revocado_en = now()            -- el trigger append-only lo re-normaliza a now()
     WHERE tipo = 'imagen' AND nino_id = p_nino_id AND revocado_en IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM upd;       -- el trigger derivador recalcula el flag

  RETURN v_n;
END $function$;

GRANT EXECUTE ON FUNCTION public.revocar_consentimiento_imagen(uuid) TO authenticated;

-- ── 5. TRIGGER DERIVADOR: el flag del niño SIEMPRE = tiene_consentimiento_imagen(niño) ──
-- Acotado a tipo='imagen' (el resto de consentimientos: RETURN inmediato → cero impacto).
-- Por-niño estricto: solo toca la fila del niño del consentimiento. INSERT (otorgar),
-- UPDATE (revocar/redacción) y DELETE (limpieza de test) recalculan.
CREATE OR REPLACE FUNCTION public.consentimiento_imagen_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_nino uuid;
  v_val  boolean;
BEGIN
  IF COALESCE(NEW.tipo, OLD.tipo) <> 'imagen' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  v_nino := COALESCE(NEW.nino_id, OLD.nino_id);
  IF v_nino IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_val := public.tiene_consentimiento_imagen(v_nino);
  UPDATE public.ninos
     SET puede_aparecer_en_fotos = v_val
   WHERE id = v_nino
     AND puede_aparecer_en_fotos IS DISTINCT FROM v_val;   -- guard anti-ruido de audit

  RETURN COALESCE(NEW, OLD);
END $function$;

CREATE TRIGGER consentimiento_imagen_sync_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.consentimientos
  FOR EACH ROW EXECUTE FUNCTION public.consentimiento_imagen_sync();

-- ── 6. Reconciliar TODOS los niños (TEST): el flag pasa a ser derivado del consent ──
-- Con 0 consentimientos de imagen, todos los flags quedan en false: cierra el descuadre
-- (p.ej. Pepe con flag=true sin consentimiento → false).
UPDATE public.ninos n
   SET puede_aparecer_en_fotos = public.tiene_consentimiento_imagen(n.id)
 WHERE n.puede_aparecer_en_fotos IS DISTINCT FROM public.tiene_consentimiento_imagen(n.id);

COMMIT;
