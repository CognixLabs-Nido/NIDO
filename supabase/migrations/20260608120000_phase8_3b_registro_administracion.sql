-- =============================================================================
-- Fase 8 — F8-3b: REGISTRO DE ADMINISTRACIÓN DE MEDICACIÓN (doble confirmación)
-- =============================================================================
-- ADITIVA sobre F8-0 (20260603120000) y F8-RW-0 (20260607120000). Tabla NUEVA
-- `administraciones_medicacion` — NUNCA toca tablas existentes salvo extender el
-- audit_trigger_function (CREATE OR REPLACE, preserva todas las ramas previas).
--
--   QUÉ MODELA. Cada vez que un staff (profe del aula / dirección) ADMINISTRA una
--   dosis de una medicación FIRMADA y VIGENTE de un niño, deja un registro. Ese
--   registro nace PENDIENTE y un SEGUNDO staff distinto lo CONFIRMA activamente
--   (doble confirmación real, decisión 2026-06-08, Opción A): una sola tabla, la
--   confirmación es un UPDATE acotadísimo (pendiente → confirmada), no una segunda
--   fila. Espejo del patrón "un segundo actor transiciona el estado" ya usado en
--   NIDO (RSVP de citas, completar recordatorio): UPDATE de una columna, acotado
--   por RLS + trigger de congelación. El resto de columnas son inmutables y no hay
--   DELETE (registro sanitario append-only del menor, se audita).
--
--   "NO BASTA CON NOMBRARLO." En el INSERT, `confirmado_por` DEBE ser NULL (RLS +
--   CHECK): quien registra no puede autoconfirmarse ni designar al segundo. Solo el
--   segundo staff, autenticado, rellena `confirmado_por = auth.uid()` (≠ quien
--   administró, garantizado por CHECK en BD y por la RLS de UPDATE).
--
--   GATE DE FIRMA + VIGENCIA. Solo se puede registrar sobre una medicación
--   FIRMADA (consentida según `firmantes_requeridos` + override por niño) y VIGENTE
--   HOY (hoy ∈ [fecha_inicio, fecha_fin] del tratamiento, que viaja en
--   `firmas.datos.medicacion` — recordar que en F8-3a vigencia_desde de la fila =
--   día de creación para permitir pre-autorizar, NO fecha_inicio). Una medicación
--   futura o caducada NO admite registro. Helper `medicacion_administrable_hoy`.
--
--   F8-3b NO crea ENUMs nuevos ni columnas en `autorizaciones`. Reutiliza:
--   es_admin, es_profe_de_nino, es_tutor_de, centro_de_nino, hoy_madrid,
--   autorizacion_aplica_a_nino (F8-RW-0). El audit gana una rama (centro_id directo).
--
-- ⚖️ AVISO LEGAL / RGPD (pendiente de abogado, RAT F11): el registro de
--    administración de medicación es **dato de salud de un menor**. Doble
--    confirmación = control organizativo, NO certificación legal de la firma.
--    Retención y derecho al olvido se tratan en F11.
-- =============================================================================
BEGIN;

-- ─── 1. Helper: ¿la medicación es FIRMADA + VIGENTE hoy? (gate del INSERT) ────
-- Espejo en SQL de la lógica TS (estado-firma.ts): consentida = última firma por
-- firmante = 'firmado' según la política efectiva (override `requiere_ambos_firmantes`
-- prevalece). Vigente = hoy ∈ [fecha_inicio, fecha_fin] de la última firma 'firmado'.
-- Lee `autorizaciones`/`firmas_autorizacion`/`ninos`/`vinculos_familiares` (otras
-- tablas respecto a `administraciones_medicacion` → sin MVCC en su uso en la RLS).
CREATE OR REPLACE FUNCTION public.medicacion_administrable_hoy(p_autorizacion_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.autorizaciones%ROWTYPE;
  v_requiere_ambos boolean;
  v_politica public.politica_firmantes;
  v_total_principales int;
  v_firmados_principales int;
  v_consentida boolean;
  v_inicio date;
  v_fin date;
BEGIN
  SELECT * INTO a FROM public.autorizaciones WHERE id = p_autorizacion_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  -- Solo instancias REALES de medicación publicadas (no plantilla, no otro tipo).
  IF a.es_plantilla OR a.tipo <> 'medicacion' OR a.estado <> 'publicada' OR a.nino_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT requiere_ambos_firmantes INTO v_requiere_ambos FROM public.ninos WHERE id = a.nino_id;
  v_politica := CASE WHEN COALESCE(v_requiere_ambos, false)
                     THEN 'todos_los_principales'::public.politica_firmantes
                     ELSE a.firmantes_requeridos END;

  -- ¿Consentida? (última decisión por firmante, según política).
  IF v_politica = 'todos_los_principales' THEN
    SELECT count(*) INTO v_total_principales
      FROM public.vinculos_familiares vf
      WHERE vf.nino_id = a.nino_id
        AND vf.tipo_vinculo = 'tutor_legal_principal'
        AND vf.deleted_at IS NULL;
    IF v_total_principales = 0 THEN
      -- Sin principales (dato incompleto): basta una firma vigente (fallback TS).
      v_consentida := EXISTS (
        SELECT 1 FROM (
          SELECT DISTINCT ON (f.firmante_id) f.decision
          FROM public.firmas_autorizacion f
          WHERE f.autorizacion_id = a.id AND f.nino_id = a.nino_id
          ORDER BY f.firmante_id, f.firmado_at DESC
        ) ult WHERE ult.decision = 'firmado'
      );
    ELSE
      -- Todos los principales con su última firma = 'firmado'.
      SELECT count(*) INTO v_firmados_principales FROM (
        SELECT DISTINCT ON (f.firmante_id) f.firmante_id, f.decision
        FROM public.firmas_autorizacion f
        JOIN public.vinculos_familiares vf
          ON vf.usuario_id = f.firmante_id
         AND vf.nino_id = a.nino_id
         AND vf.tipo_vinculo = 'tutor_legal_principal'
         AND vf.deleted_at IS NULL
        WHERE f.autorizacion_id = a.id AND f.nino_id = a.nino_id
        ORDER BY f.firmante_id, f.firmado_at DESC
      ) ult WHERE ult.decision = 'firmado';
      v_consentida := v_firmados_principales >= v_total_principales;
    END IF;
  ELSE
    -- uno_principal / cualquiera: basta una firma vigente 'firmado'.
    v_consentida := EXISTS (
      SELECT 1 FROM (
        SELECT DISTINCT ON (f.firmante_id) f.decision
        FROM public.firmas_autorizacion f
        WHERE f.autorizacion_id = a.id AND f.nino_id = a.nino_id
        ORDER BY f.firmante_id, f.firmado_at DESC
      ) ult WHERE ult.decision = 'firmado'
    );
  END IF;

  IF NOT v_consentida THEN RETURN FALSE; END IF;

  -- Vigente hoy: hoy ∈ [fecha_inicio, fecha_fin] de la última firma 'firmado'
  -- (el tratamiento real viaja en datos.medicacion; F8-3a desacopló vigencia).
  SELECT (f.datos->'medicacion'->>'fecha_inicio')::date,
         (f.datos->'medicacion'->>'fecha_fin')::date
    INTO v_inicio, v_fin
    FROM public.firmas_autorizacion f
    WHERE f.autorizacion_id = a.id AND f.nino_id = a.nino_id AND f.decision = 'firmado'
    ORDER BY f.firmado_at DESC
    LIMIT 1;
  IF v_inicio IS NULL OR v_fin IS NULL THEN RETURN FALSE; END IF;
  RETURN public.hoy_madrid() BETWEEN v_inicio AND v_fin;
END;
$$;
GRANT EXECUTE ON FUNCTION public.medicacion_administrable_hoy(uuid) TO authenticated;

-- ─── 2. Tabla administraciones_medicacion (append-only salvo confirmar) ──────
-- FKs ON DELETE RESTRICT: registro sanitario legal del menor — nada se pierde por
-- arrastre; el derecho al olvido (F11) redacta deliberadamente (≠ firmas, CASCADE).
CREATE TABLE public.administraciones_medicacion (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autorizacion_id  uuid NOT NULL REFERENCES public.autorizaciones(id) ON DELETE RESTRICT,
  nino_id          uuid NOT NULL REFERENCES public.ninos(id)          ON DELETE RESTRICT,
  centro_id        uuid NOT NULL REFERENCES public.centros(id)        ON DELETE RESTRICT,
  administrado_por uuid NOT NULL REFERENCES public.usuarios(id)       ON DELETE RESTRICT,  -- staff que la da
  confirmado_por   uuid          REFERENCES public.usuarios(id)       ON DELETE RESTRICT,  -- 2.º staff, NULL al crear
  administrado_en  timestamptz NOT NULL DEFAULT now(),
  medicamento      text NOT NULL,   -- snapshot del tratamiento al administrar
  dosis            text NOT NULL,   -- snapshot
  notas            text,
  confirmado_at    timestamptz,     -- lo fija el trigger al confirmar (server-authoritative)
  created_at       timestamptz NOT NULL DEFAULT now(),

  -- El que confirma NUNCA es el que administró (doble confirmación real).
  CONSTRAINT adm_med_confirmador_distinto    CHECK (confirmado_por IS NULL OR confirmado_por <> administrado_por),
  -- confirmado_por y confirmado_at van juntos (ambos NULL = pendiente; ambos set = confirmada).
  CONSTRAINT adm_med_confirmacion_coherente  CHECK ((confirmado_por IS NULL) = (confirmado_at IS NULL)),
  CONSTRAINT adm_med_medicamento_len         CHECK (char_length(medicamento) BETWEEN 1 AND 200),
  CONSTRAINT adm_med_dosis_len               CHECK (char_length(dosis) BETWEEN 1 AND 200),
  CONSTRAINT adm_med_notas_len               CHECK (notas IS NULL OR char_length(notas) <= 500)
);

COMMENT ON TABLE public.administraciones_medicacion IS
  'Registro de administración de medicación con doble confirmación (F8-3b). Nace pendiente (confirmado_por NULL); un 2.º staff distinto lo confirma con un UPDATE acotado. Append-only salvo esa transición; sin DELETE. Snapshot medicamento+dosis. Se audita. ⚖️ dato de salud del menor (RAT F11).';

CREATE INDEX idx_adm_med_autorizacion ON public.administraciones_medicacion (autorizacion_id);
CREATE INDEX idx_adm_med_nino         ON public.administraciones_medicacion (nino_id, administrado_en DESC);
-- Cola de pendientes de confirmación (la ve el 2.º staff del centro).
CREATE INDEX idx_adm_med_pendientes   ON public.administraciones_medicacion (centro_id)
  WHERE confirmado_por IS NULL;

-- ─── 3. Trigger de congelación: el ÚNICO UPDATE es confirmar una vez ─────────
-- Patrón del trigger de congelación de F8-0. Bloquea editar cualquier columna de
-- contenido y re-confirmar; solo admite pendiente → confirmada, fijando confirmado_at.
CREATE OR REPLACE FUNCTION public.administraciones_medicacion_solo_confirmar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Ya confirmada → inmutable (idempotencia dura; la RLS USING ya filtra, esto es red).
  IF OLD.confirmado_por IS NOT NULL THEN
    RAISE EXCEPTION 'administraciones_medicacion: ya confirmada, es inmutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  -- Resto de columnas CONGELADAS: solo confirmado_por/at pueden cambiar.
  IF NEW.autorizacion_id  IS DISTINCT FROM OLD.autorizacion_id
     OR NEW.nino_id          IS DISTINCT FROM OLD.nino_id
     OR NEW.centro_id        IS DISTINCT FROM OLD.centro_id
     OR NEW.administrado_por IS DISTINCT FROM OLD.administrado_por
     OR NEW.administrado_en  IS DISTINCT FROM OLD.administrado_en
     OR NEW.medicamento      IS DISTINCT FROM OLD.medicamento
     OR NEW.dosis            IS DISTINCT FROM OLD.dosis
     OR NEW.notas            IS DISTINCT FROM OLD.notas
     OR NEW.created_at       IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'administraciones_medicacion: solo se puede confirmar; el resto de columnas son inmutables'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  -- El UPDATE debe efectivamente confirmar (no dejar la fila pendiente).
  IF NEW.confirmado_por IS NULL THEN
    RAISE EXCEPTION 'administraciones_medicacion: el UPDATE debe establecer confirmado_por'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  -- confirmado_at server-authoritative (no se confía en el cliente).
  NEW.confirmado_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER administraciones_medicacion_freeze
  BEFORE UPDATE ON public.administraciones_medicacion
  FOR EACH ROW EXECUTE FUNCTION public.administraciones_medicacion_solo_confirmar();

-- ─── 4. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.administraciones_medicacion ENABLE ROW LEVEL SECURITY;

-- SELECT: staff del niño (admin del centro / profe del aula) + la FAMILIA del niño
-- (transparencia: "se administró X a las HH:MM"). Helpers leen OTRAS tablas → la
-- SELECT policy no re-lee `administraciones_medicacion` (sin gotcha MVCC en RETURNING).
CREATE POLICY adm_med_select ON public.administraciones_medicacion
  FOR SELECT USING (
    public.es_admin(centro_id)
    OR public.es_profe_de_nino(nino_id)
    OR public.es_tutor_de(nino_id)
  );

-- INSERT: staff del niño, registra como uno mismo, SIN confirmar (confirmado_por
-- NULL), centro coherente, el niño está en alcance de la instancia, y la medicación
-- es FIRMADA + VIGENTE hoy. La familia NO registra.
CREATE POLICY adm_med_insert ON public.administraciones_medicacion
  FOR INSERT WITH CHECK (
    administrado_por = auth.uid()
    AND confirmado_por IS NULL
    AND (public.es_admin(centro_id) OR public.es_profe_de_nino(nino_id))
    AND public.centro_de_nino(nino_id) = centro_id
    AND public.autorizacion_aplica_a_nino(autorizacion_id, nino_id)
    AND public.medicacion_administrable_hoy(autorizacion_id)
  );

-- UPDATE (confirmar): un SEGUNDO staff distinto del que administró confirma una fila
-- aún pendiente, nombrándose a sí mismo. USING filtra pendientes (idempotencia:
-- "USING falso → 0 filas" si ya confirmada o si soy quien administró). El trigger
-- congela el resto de columnas y fija confirmado_at. WITH CHECK ata confirmado_por
-- a auth.uid() (anti-suplantación). DELETE: sin policy → default DENY.
CREATE POLICY adm_med_update_confirmar ON public.administraciones_medicacion
  FOR UPDATE
  USING (
    confirmado_por IS NULL
    AND administrado_por <> auth.uid()
    AND (public.es_admin(centro_id) OR public.es_profe_de_nino(nino_id))
  )
  WITH CHECK (
    confirmado_por = auth.uid()
    AND administrado_por <> auth.uid()
    AND (public.es_admin(centro_id) OR public.es_profe_de_nino(nino_id))
  );

-- ─── 5. audit_trigger_function ampliada (+ administraciones_medicacion) ───────
-- CREATE OR REPLACE preserva todas las ramas previas (Fases 2..8). Se añade una:
-- administraciones_medicacion (centro_id directo). Registro sanitario → se audita.
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
  ELSIF TG_TABLE_NAME = 'administraciones_medicacion' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
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

CREATE TRIGGER audit_administraciones_medicacion
  AFTER INSERT OR UPDATE OR DELETE ON public.administraciones_medicacion
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

COMMIT;
