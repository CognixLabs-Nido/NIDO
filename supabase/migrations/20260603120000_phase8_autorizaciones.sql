-- =============================================================================
-- Fase 8 — Autorizaciones + firma digital (F8-0: modelo + RLS, sin UI)
-- =============================================================================
-- ADITIVA: las tablas `autorizaciones` y `firmas_autorizacion` NO existen → solo
-- CREATE. NUNCA drop+recreate. Spec: docs/specs/autorizaciones-firma.md
-- (decisiones D1-D9 cerradas). Patrones reusados de F7 (eventos/confirmaciones).
--
-- ⚖️ AVISO LEGAL: este modelo da un registro AUDITABLE de quién/cuándo/qué se
-- firmó (hash del texto exacto). NO certifica validez jurídica de la firma; los
-- puntos ⚖️ del spec requieren validación de abogado.
--
-- 4 ENUMs:
--   tipo_autorizacion   = salida | medicacion | recogida | reglas_regimen_interno
--                         | autorizacion_imagenes
--                         (imagenes: la FEATURE es F11/RGPD; aqui solo se reserva el
--                          valor para reusar el mecanismo. reservado futuro:
--                          'atencion_medica_urgencia' via ALTER TYPE ... ADD VALUE)
--   autorizacion_estado = borrador | publicada | anulada
--   firma_decision      = firmado | rechazado | revocado
--   politica_firmantes  = uno_principal | todos_los_principales | cualquiera (D5)
--
-- Firma: nombre_tecleado (acto afirmativo) + firma_imagen (trazo dibujado con el
--   dedo, SVG/base64, EN BD por ser pequena; OBLIGATORIO si decision='firmado',
--   opcional en rechazo/revocacion) + texto_hash (SHA-256 del texto).
-- Doble firma por nino: ninos.requiere_ambos_firmantes (el REQUISITO, no el motivo
--   — minimizacion). El action pone firmantes_requeridos='todos_los_principales'.
-- Retencion de firmas: 12 meses (limpieza fina en F11/RGPD).
-- Adjuntos (informe medicacion, DNI recogida): via Storage TRAS F10 (ver spec);
--   referencias en `datos` jsonb. No requiere columnas nuevas.
--
-- GUARD del texto (D-texto / placeholder PENDIENTE):
--   `autorizaciones.texto_definitivo boolean` + CHECK (publicada ⇒ definitivo) +
--   helper `autorizacion_firmable()` (usado en RLS de firmas). Una autorización
--   con texto placeholder NO se puede publicar NI firmar. El hash es del texto real.
--
-- Helpers SQL nuevos (STABLE SECURITY DEFINER, search_path=public):
--   centro_de_evento(evento_id) → uuid (red de seguridad del centro_id en 'salida').
--   es_profe_de_evento(evento_id) → boolean (profe del aula de un evento ámbito aula).
--   usuario_es_audiencia_autorizacion_row(centro_id, tipo, evento_id, nino_id, aula_id)
--     → ROW-AWARE (no re-lee `autorizaciones`): evita el gotcha MVCC en
--       INSERT…RETURNING. Para 'salida' delega en la audiencia del evento (lee
--       `eventos`, otra tabla → sin MVCC).
--   autorizacion_aplica_a_nino(autorizacion_id, nino_id) → boolean (lee
--     `autorizaciones`+`eventos`+`matriculas`+`ninos`, otras tablas respecto a
--     `firmas_autorizacion` → sin MVCC en su RLS).
--   autorizacion_firmable(autorizacion_id) → boolean (publicada + texto_definitivo +
--     dentro de vigencia). Enforza el guard placeholder a nivel de RLS.
-- Reutiliza: es_admin, es_profe_de_aula, es_profe_de_nino, es_tutor_de,
--   centro_de_nino, centro_de_aula, hoy_madrid, usuario_es_audiencia_evento_row,
--   evento_aplica_a_nino, set_updated_at.
--
-- audit_trigger_function ampliada con 2 ramas: `autorizaciones` (centro_id directo)
--   y `firmas_autorizacion` (centro_de_nino). AMBAS se auditan (documentos legales,
--   a diferencia de confirmaciones_evento). Sin Realtime.
-- =============================================================================
BEGIN;

-- ─── 1. ENUMs ────────────────────────────────────────────────────────────────
CREATE TYPE public.tipo_autorizacion   AS ENUM ('salida', 'medicacion', 'recogida', 'reglas_regimen_interno', 'autorizacion_imagenes');
CREATE TYPE public.autorizacion_estado AS ENUM ('borrador', 'publicada', 'anulada');
CREATE TYPE public.firma_decision      AS ENUM ('firmado', 'rechazado', 'revocado');
CREATE TYPE public.politica_firmantes  AS ENUM ('uno_principal', 'todos_los_principales', 'cualquiera');

-- ─── 2. Tabla autorizaciones (el documento) ──────────────────────────────────
CREATE TABLE public.autorizaciones (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id            uuid NOT NULL REFERENCES public.centros(id)  ON DELETE CASCADE,
  tipo                 public.tipo_autorizacion NOT NULL,
  evento_id            uuid REFERENCES public.eventos(id)           ON DELETE CASCADE,  -- solo 'salida'
  nino_id              uuid REFERENCES public.ninos(id)             ON DELETE CASCADE,  -- 'medicacion'/'recogida'
  aula_id              uuid REFERENCES public.aulas(id)             ON DELETE CASCADE,  -- reservado (ámbito aula futuro)
  titulo               text NOT NULL,
  texto                text NOT NULL,                                -- arranca 'PENDIENTE'
  texto_version        text NOT NULL DEFAULT 'v0-pendiente',
  texto_definitivo     boolean NOT NULL DEFAULT false,               -- GUARD placeholder
  datos                jsonb NOT NULL DEFAULT '{}'::jsonb,           -- estructurados (medicación/recogida)
  firmantes_requeridos public.politica_firmantes NOT NULL DEFAULT 'uno_principal',
  vigencia_desde       date,
  vigencia_hasta       date,
  estado               public.autorizacion_estado NOT NULL DEFAULT 'borrador',
  creado_por           uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  -- Coherencia tipo ↔ referencia (D3). aula_id reservado: NULL en todos los tipos de Ola 1.
  -- salida ⇒ evento; el resto (por niño) ⇒ nino_id.
  CONSTRAINT autorizaciones_tipo_coherencia CHECK (
    (tipo = 'salida' AND evento_id IS NOT NULL AND nino_id IS NULL AND aula_id IS NULL)
    OR (tipo IN ('medicacion', 'recogida', 'reglas_regimen_interno', 'autorizacion_imagenes')
        AND evento_id IS NULL AND nino_id IS NOT NULL AND aula_id IS NULL)
  ),
  -- GUARD placeholder: no se puede PUBLICAR con texto no definitivo (D-texto).
  CONSTRAINT autorizaciones_publicar_requiere_texto CHECK (
    estado <> 'publicada' OR texto_definitivo = true
  ),
  CONSTRAINT autorizaciones_vigencia_coherencia CHECK (
    vigencia_hasta IS NULL OR vigencia_desde IS NULL OR vigencia_hasta >= vigencia_desde
  ),
  CONSTRAINT autorizaciones_titulo_len  CHECK (char_length(titulo) BETWEEN 1 AND 200),
  CONSTRAINT autorizaciones_texto_len   CHECK (char_length(texto) BETWEEN 1 AND 20000),
  CONSTRAINT autorizaciones_version_len CHECK (char_length(texto_version) BETWEEN 1 AND 40)
);

COMMENT ON TABLE public.autorizaciones IS
  'Autorizaciones administrativas firmables (F8). Texto placeholder PENDIENTE no publicable ni firmable (texto_definitivo). Ver docs/specs/autorizaciones-firma.md. ⚖️ validez legal pendiente de abogado.';

CREATE INDEX idx_autorizaciones_centro  ON public.autorizaciones (centro_id);
CREATE INDEX idx_autorizaciones_evento  ON public.autorizaciones (evento_id) WHERE evento_id IS NOT NULL;
CREATE INDEX idx_autorizaciones_nino    ON public.autorizaciones (nino_id)   WHERE nino_id IS NOT NULL;

-- ─── 2b. ninos: requisito de doble firma por niño ───────────────────────────
-- Guarda el REQUISITO ("se exigen ambos tutores principales"), NO el motivo
-- (separación, etc.) → minimización de datos. Cuando es true, el server action
-- crea las autorizaciones de ese niño con firmantes_requeridos='todos_los_principales'.
-- ninos ya está auditada → cambios de este flag quedan en audit_log. La gestiona
-- el admin vía la policy de UPDATE de ninos (sin policy nueva).
ALTER TABLE public.ninos
  ADD COLUMN requiere_ambos_firmantes boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.ninos.requiere_ambos_firmantes IS
  'Si true, las autorizaciones de este niño exigen firma de todos los tutores principales (F8). Es el requisito, no el motivo (minimización RGPD).';

-- ─── 3. Tabla firmas_autorizacion (la respuesta — append-only, inmutable) ────
-- Una firma NO se edita ni borra (default DENY UPDATE/DELETE). Revocar/re-firmar
-- = fila NUEVA (D4). Estado vigente = última fila por (autorizacion, nino, firmante)
-- por firmado_at. Se audita (documento legal).
CREATE TABLE public.firmas_autorizacion (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autorizacion_id uuid NOT NULL REFERENCES public.autorizaciones(id) ON DELETE CASCADE,
  nino_id         uuid NOT NULL REFERENCES public.ninos(id)          ON DELETE CASCADE,
  firmante_id     uuid NOT NULL REFERENCES public.usuarios(id)       ON DELETE RESTRICT,
  rol_firmante    public.tipo_vinculo NOT NULL,                       -- snapshot del vínculo al firmar
  decision        public.firma_decision NOT NULL,
  texto_hash      text NOT NULL,                                      -- SHA-256 hex del texto exacto firmado
  texto_version   text NOT NULL,                                      -- snapshot de la versión firmada
  nombre_tecleado text NOT NULL,                                      -- acto afirmativo explícito (D2)
  firma_imagen    text,                                               -- trazo dibujado con el dedo (SVG/base64), pequeño, en BD
  comentario      text,
  ip_address      inet,                                               -- contexto probatorio (patrón consentimientos)
  user_agent      text,
  firmado_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT firmas_hash_sha256        CHECK (texto_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT firmas_nombre_len         CHECK (char_length(nombre_tecleado) BETWEEN 1 AND 200),
  CONSTRAINT firmas_firma_imagen_len   CHECK (firma_imagen IS NULL OR char_length(firma_imagen) <= 500000),
  -- Trazo OBLIGATORIO al firmar; opcional en rechazo/revocación (no hay firma que dibujar).
  CONSTRAINT firmas_firma_imagen_req   CHECK (decision <> 'firmado' OR firma_imagen IS NOT NULL),
  CONSTRAINT firmas_comentario_len     CHECK (comentario IS NULL OR char_length(comentario) <= 500),
  CONSTRAINT firmas_version_len        CHECK (char_length(texto_version) BETWEEN 1 AND 40)
);

COMMENT ON TABLE public.firmas_autorizacion IS
  'Firma electrónica simple por niño (F8, D2): nombre_tecleado + firma_imagen (trazo) + hash SHA-256 del texto + IP/UA. Append-only e inmutable: revocar = fila nueva (D4). Se audita. Retención 12 meses (limpieza fina en F11). ⚖️ validez legal pendiente de abogado.';

CREATE INDEX idx_firmas_autorizacion ON public.firmas_autorizacion (autorizacion_id, nino_id);
CREATE INDEX idx_firmas_firmante     ON public.firmas_autorizacion (firmante_id);

-- ─── 4. Triggers updated_at (solo autorizaciones; firmas es append-only) ─────
CREATE TRIGGER autorizaciones_set_updated_at
  BEFORE UPDATE ON public.autorizaciones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 5. Helpers SQL ──────────────────────────────────────────────────────────
-- centro_id del evento (red de seguridad para 'salida' + INSERT policy).
CREATE OR REPLACE FUNCTION public.centro_de_evento(p_evento_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT centro_id FROM public.eventos WHERE id = p_evento_id;
$$;
GRANT EXECUTE ON FUNCTION public.centro_de_evento(uuid) TO authenticated;

-- ¿Soy profe del aula de un evento ámbito aula? (INSERT de 'salida' por profe).
CREATE OR REPLACE FUNCTION public.es_profe_de_evento(p_evento_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.eventos%ROWTYPE;
BEGIN
  SELECT * INTO e FROM public.eventos WHERE id = p_evento_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  RETURN e.ambito = 'aula' AND public.es_profe_de_aula(e.aula_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.es_profe_de_evento(uuid) TO authenticated;

-- Audiencia de la autorización. ROW-AWARE (no re-lee `autorizaciones`).
-- 'salida' delega en la audiencia del evento (lee `eventos`, otra tabla → sin MVCC).
CREATE OR REPLACE FUNCTION public.usuario_es_audiencia_autorizacion_row(
  p_centro_id uuid,
  p_tipo      public.tipo_autorizacion,
  p_evento_id uuid,
  p_nino_id   uuid,
  p_aula_id   uuid
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.eventos%ROWTYPE;
BEGIN
  IF public.es_admin(p_centro_id) THEN
    RETURN TRUE;
  END IF;
  IF p_tipo = 'salida' THEN
    SELECT * INTO e FROM public.eventos WHERE id = p_evento_id;
    IF NOT FOUND THEN RETURN FALSE; END IF;
    RETURN public.usuario_es_audiencia_evento_row(e.centro_id, e.ambito, e.aula_id, e.nino_id);
  ELSE  -- medicacion / recogida → por niño
    RETURN public.es_profe_de_nino(p_nino_id) OR public.es_tutor_de(p_nino_id);
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.usuario_es_audiencia_autorizacion_row(uuid, public.tipo_autorizacion, uuid, uuid, uuid) TO authenticated;

-- ¿El niño está en el alcance de la autorización? (RLS de firmas; lee otras tablas).
CREATE OR REPLACE FUNCTION public.autorizacion_aplica_a_nino(p_autorizacion_id uuid, p_nino_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.autorizaciones%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.autorizaciones WHERE id = p_autorizacion_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF a.tipo = 'salida' THEN
    RETURN public.evento_aplica_a_nino(a.evento_id, p_nino_id);
  ELSE
    RETURN a.nino_id = p_nino_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.autorizacion_aplica_a_nino(uuid, uuid) TO authenticated;

-- ¿Es firmable AHORA? publicada + texto definitivo + dentro de vigencia (huso Madrid).
-- Enforza el guard placeholder: texto PENDIENTE (texto_definitivo=false) ⇒ NO firmable.
CREATE OR REPLACE FUNCTION public.autorizacion_firmable(p_autorizacion_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.autorizaciones%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.autorizaciones WHERE id = p_autorizacion_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  RETURN a.estado = 'publicada'
    AND a.texto_definitivo = true
    AND (a.vigencia_desde IS NULL OR public.hoy_madrid() >= a.vigencia_desde)
    AND (a.vigencia_hasta IS NULL OR public.hoy_madrid() <= a.vigencia_hasta);
END;
$$;
GRANT EXECUTE ON FUNCTION public.autorizacion_firmable(uuid) TO authenticated;

-- ─── 6. Trigger BEFORE INSERT: derivar centro_id (red de seguridad) ──────────
-- El server action pasará centro_id explícito; este trigger solo cubre NULL.
CREATE OR REPLACE FUNCTION public.autorizaciones_set_centro_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.centro_id IS NULL AND NEW.nino_id IS NOT NULL THEN
    NEW.centro_id := public.centro_de_nino(NEW.nino_id);
  END IF;
  IF NEW.centro_id IS NULL AND NEW.evento_id IS NOT NULL THEN
    NEW.centro_id := public.centro_de_evento(NEW.evento_id);
  END IF;
  IF NEW.centro_id IS NULL AND NEW.aula_id IS NOT NULL THEN
    NEW.centro_id := public.centro_de_aula(NEW.aula_id);
  END IF;
  IF NEW.centro_id IS NULL THEN
    RAISE EXCEPTION 'autorizaciones: no se pudo derivar centro_id (tipo=% evento_id=% nino_id=%)',
      NEW.tipo, NEW.evento_id, NEW.nino_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER autorizaciones_set_centro_id_trg
  BEFORE INSERT ON public.autorizaciones
  FOR EACH ROW EXECUTE FUNCTION public.autorizaciones_set_centro_id();

-- ─── 7. Trigger BEFORE UPDATE: texto inmutable una vez hay firmas ────────────
-- Integridad del hash: si ya existe alguna firma, el texto/version no se pueden
-- cambiar (habría que crear otra autorización/versión). Red de seguridad de BD;
-- el server action además limita columnas.
CREATE OR REPLACE FUNCTION public.autorizaciones_bloquea_texto_tras_firma()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.texto IS DISTINCT FROM OLD.texto OR NEW.texto_version IS DISTINCT FROM OLD.texto_version)
     AND EXISTS (SELECT 1 FROM public.firmas_autorizacion f WHERE f.autorizacion_id = OLD.id) THEN
    RAISE EXCEPTION 'autorizaciones: el texto no se puede modificar tras existir firmas (crea una versión nueva)'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER autorizaciones_bloquea_texto_tras_firma_trg
  BEFORE UPDATE ON public.autorizaciones
  FOR EACH ROW EXECUTE FUNCTION public.autorizaciones_bloquea_texto_tras_firma();

-- ─── 8. RLS: autorizaciones ──────────────────────────────────────────────────
ALTER TABLE public.autorizaciones ENABLE ROW LEVEL SECURITY;

-- SELECT: audiencia (admin centro, profe del niño/aula, tutor del niño). Row-aware.
CREATE POLICY autorizaciones_select ON public.autorizaciones
  FOR SELECT USING (
    public.usuario_es_audiencia_autorizacion_row(centro_id, tipo, evento_id, nino_id, aula_id)
  );

-- INSERT: admin (cualquier tipo) o profe (solo 'salida' de un evento de su aula).
-- creado_por = auth.uid() (anti-suplantación). Espejo de eventos_insert.
CREATE POLICY autorizaciones_insert ON public.autorizaciones
  FOR INSERT WITH CHECK (
    creado_por = auth.uid()
    AND (
      public.es_admin(centro_id)
      OR (tipo = 'salida'
          AND public.es_profe_de_evento(evento_id)
          AND public.centro_de_evento(evento_id) = centro_id)
    )
  );

-- UPDATE: autor o admin del centro (defensa simétrica). El server action limita
-- columnas (publicar/editar/anular); el trigger bloquea cambiar texto tras firmas.
CREATE POLICY autorizaciones_update ON public.autorizaciones
  FOR UPDATE
  USING (creado_por = auth.uid() OR public.es_admin(centro_id))
  WITH CHECK (creado_por = auth.uid() OR public.es_admin(centro_id));

-- DELETE: sin policy → default DENY. Retirar = estado='anulada' (D9).

-- ─── 9. RLS: firmas_autorizacion ─────────────────────────────────────────────
ALTER TABLE public.firmas_autorizacion ENABLE ROW LEVEL SECURITY;

-- SELECT: el firmante (la suya), tutor del niño, profe del niño y admin del centro.
CREATE POLICY firmas_select ON public.firmas_autorizacion
  FOR SELECT USING (
    firmante_id = auth.uid()
    OR public.es_tutor_de(nino_id)
    OR public.es_profe_de_nino(nino_id)
    OR public.es_admin(public.centro_de_nino(nino_id))
  );

-- INSERT: SOLO un tutor del niño, sobre una autorización que lo incluye y que es
-- FIRMABLE (publicada + texto_definitivo + vigencia). firmante_id = auth.uid().
-- ⇒ texto PENDIENTE = no firmable (autorizacion_firmable() lo bloquea).
CREATE POLICY firmas_insert ON public.firmas_autorizacion
  FOR INSERT WITH CHECK (
    public.es_tutor_de(nino_id)
    AND firmante_id = auth.uid()
    AND public.autorizacion_aplica_a_nino(autorizacion_id, nino_id)
    AND public.autorizacion_firmable(autorizacion_id)
  );

-- UPDATE / DELETE: sin policy → default DENY. Append-only: revocar = fila nueva (D4).

-- ─── 10. audit_trigger_function ampliada (autorizaciones + firmas) ───────────
-- CREATE OR REPLACE preserva las ramas previas (Fases 2..7b). Se añaden 2 ramas:
-- autorizaciones (centro_id directo) y firmas_autorizacion (centro_de_nino).
-- AMBAS se auditan (documentos legales). preferencias/confirmaciones siguen sin audit.
CREATE OR REPLACE FUNCTION public.audit_trigger_function()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_centro_id uuid;
  v_antes jsonb;
  v_despues jsonb;
  v_registro_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'centros' THEN
    v_centro_id := COALESCE((NEW).id, (OLD).id);
  ELSIF TG_TABLE_NAME = 'ninos' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'roles_usuario' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'dias_centro' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'plantillas_menu_mensual' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'menu_dia' THEN
    v_centro_id := public.centro_de_plantilla(COALESCE((NEW).plantilla_id, (OLD).plantilla_id));
  ELSIF TG_TABLE_NAME = 'conversaciones' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'mensajes' THEN
    v_centro_id := public.centro_de_conversacion(COALESCE((NEW).conversacion_id, (OLD).conversacion_id));
  ELSIF TG_TABLE_NAME = 'anuncios' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'recordatorios' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'eventos' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'citas' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'cita_invitados' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'autorizaciones' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'firmas_autorizacion' THEN
    v_centro_id := public.centro_de_nino(COALESCE((NEW).nino_id, (OLD).nino_id));
  ELSIF TG_TABLE_NAME IN (
    'info_medica_emergencia',
    'vinculos_familiares',
    'matriculas',
    'datos_pedagogicos_nino',
    'asistencias',
    'ausencias'
  ) THEN
    SELECT n.centro_id INTO v_centro_id
    FROM public.ninos n
    WHERE n.id = COALESCE((NEW).nino_id, (OLD).nino_id);
  ELSIF TG_TABLE_NAME = 'agendas_diarias' THEN
    v_centro_id := public.centro_de_nino(COALESCE((NEW).nino_id, (OLD).nino_id));
  ELSIF TG_TABLE_NAME IN ('comidas', 'biberones', 'suenos', 'deposiciones') THEN
    v_centro_id := public.centro_de_agenda(COALESCE((NEW).agenda_id, (OLD).agenda_id));
  END IF;

  v_antes   := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END;
  v_despues := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END;
  v_registro_id := COALESCE((NEW).id, (OLD).id);

  INSERT INTO public.audit_log
    (tabla, registro_id, accion, usuario_id, valores_antes, valores_despues, centro_id)
  VALUES
    (TG_TABLE_NAME, v_registro_id, TG_OP::public.audit_accion, auth.uid(), v_antes, v_despues, v_centro_id);

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER audit_autorizaciones
  AFTER INSERT OR UPDATE OR DELETE ON public.autorizaciones
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

CREATE TRIGGER audit_firmas_autorizacion
  AFTER INSERT OR UPDATE OR DELETE ON public.firmas_autorizacion
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

COMMIT;
