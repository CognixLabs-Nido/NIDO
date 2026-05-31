-- =============================================================================
-- Fase 6 — Recordatorios bidireccionales (F6-A backend)
-- =============================================================================
-- 1 ENUM nuevo (recordatorio_destinatario): familia | equipo | direccion | personal.
-- 1 tabla nueva (recordatorios) con CHECK estructural por destino.
-- 1 helper trigger BEFORE INSERT (recordatorios_set_centro_id) — deriva
--   centro_id desde nino_id cuando falta (mismo patrón que conversaciones F5).
-- Políticas RLS por destino con default DENY (sin helper SQL nuevo: la SELECT
--   policy delega en helpers existentes que leen OTRAS tablas → el gotcha MVCC
--   de INSERT…RETURNING NO aplica, ver docs/architecture/rls-policies.md).
-- audit_trigger_function() ampliada con 1 rama (recordatorios, centro_id directo).
-- Realtime publication: recordatorios (para el badge de pendientes en vivo).
--
-- Spec:  docs/specs/reminders.md
-- ADRs:  0035 (modelo recordatorios bidireccionales), 0036 (idempotencia +
--        race safety al completar; ventana de anulación en el server action).
-- Notas: el flag `puede_recibir_mensajes` (F2.6) sigue actuando como switch
--        global del canal digital — un tutor con flag=false no ve ni crea
--        recordatorios familia/equipo. El borrado sigue el patrón F5: sin
--        DELETE (default DENY); error → erroneo=true + prefijo '[anulado] '.
-- =============================================================================
BEGIN;

-- ─── 1. ENUM de destino ───────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.recordatorio_destinatario AS ENUM ('familia', 'equipo', 'direccion', 'personal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 2. Tabla recordatorios ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recordatorios (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id                uuid NOT NULL REFERENCES public.centros(id)  ON DELETE CASCADE,
  destinatario             public.recordatorio_destinatario NOT NULL,
  nino_id                  uuid REFERENCES public.ninos(id)             ON DELETE CASCADE,
  usuario_destinatario_id  uuid REFERENCES public.usuarios(id)          ON DELETE CASCADE,
  creado_por               uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  titulo                   text NOT NULL,
  descripcion              text,
  vencimiento              timestamptz,
  completado_en            timestamptz,
  completado_por           uuid REFERENCES public.usuarios(id)          ON DELETE SET NULL,
  erroneo                  boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  -- Coherencia estructural por destino (paralelo a conversaciones_tipo_coherencia, F5.6-A):
  --   familia/equipo → niño-céntrico (nino_id obligatorio, sin usuario destinatario)
  --   direccion      → solo centro (sin niño, sin usuario destinatario)
  --   personal       → para uno mismo (usuario destinatario = creador, sin niño)
  CONSTRAINT recordatorios_destino_coherencia CHECK (
    (destinatario IN ('familia', 'equipo')
       AND nino_id IS NOT NULL AND usuario_destinatario_id IS NULL)
    OR (destinatario = 'direccion'
       AND nino_id IS NULL AND usuario_destinatario_id IS NULL)
    OR (destinatario = 'personal'
       AND nino_id IS NULL AND usuario_destinatario_id IS NOT NULL)
  ),
  -- 200 chars de input + 10 del prefijo '[anulado] ' (mismo criterio que mensajes/anuncios F5).
  CONSTRAINT recordatorios_titulo_len CHECK (char_length(titulo) BETWEEN 1 AND 210),
  CONSTRAINT recordatorios_descripcion_len CHECK (descripcion IS NULL OR char_length(descripcion) <= 1000),
  -- completado_en y completado_por van juntos (los dos NULL o los dos poblados).
  CONSTRAINT recordatorios_completado_coherencia CHECK (
    (completado_en IS NULL AND completado_por IS NULL)
    OR (completado_en IS NOT NULL AND completado_por IS NOT NULL)
  )
);

COMMENT ON TABLE public.recordatorios IS
  'Recordatorios bidireccionales centro<->familia (F6). Ver docs/specs/reminders.md.';
COMMENT ON COLUMN public.recordatorios.destinatario IS
  'familia (centro->familia) | equipo (familia->centro) | direccion (->admins) | personal (->uno mismo).';
COMMENT ON COLUMN public.recordatorios.vencimiento IS
  'Fecha/hora límite opcional (timestamptz). Se interpreta en Europe/Madrid en la app.';
COMMENT ON COLUMN public.recordatorios.completado_en IS
  'Instante de completado. NULL = pendiente. Se setea con UPDATE ... WHERE completado_en IS NULL (idempotente, ADR-0036).';

-- ─── 3. Índices ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_recordatorios_centro
  ON public.recordatorios (centro_id);
CREATE INDEX IF NOT EXISTS idx_recordatorios_nino
  ON public.recordatorios (nino_id) WHERE nino_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recordatorios_usuario_destinatario
  ON public.recordatorios (usuario_destinatario_id) WHERE usuario_destinatario_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recordatorios_creado_por
  ON public.recordatorios (creado_por);
-- "Mis pendientes" ordenados por vencimiento (parcial: solo los vivos).
CREATE INDEX IF NOT EXISTS idx_recordatorios_pendientes
  ON public.recordatorios (vencimiento)
  WHERE completado_en IS NULL AND erroneo = false;

-- ─── 4. Trigger updated_at ────────────────────────────────────────────────
DROP TRIGGER IF EXISTS recordatorios_set_updated_at ON public.recordatorios;
CREATE TRIGGER recordatorios_set_updated_at
  BEFORE UPDATE ON public.recordatorios
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 5. Trigger BEFORE INSERT: derivar centro_id desde nino_id si falta ────
-- Paralelo a conversaciones_set_centro_id (F5). SECURITY DEFINER para leer
-- ninos sin disparar su RLS. Solo deriva cuando hay niño (familia/equipo);
-- para direccion/personal el server action provee centro_id explícito.
CREATE OR REPLACE FUNCTION public.recordatorios_set_centro_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.centro_id IS NULL AND NEW.nino_id IS NOT NULL THEN
    NEW.centro_id := public.centro_de_nino(NEW.nino_id);
  END IF;
  IF NEW.centro_id IS NULL THEN
    RAISE EXCEPTION 'recordatorios: no se pudo derivar centro_id (destinatario=% nino_id=%)',
      NEW.destinatario, NEW.nino_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recordatorios_set_centro_id_trg ON public.recordatorios;
CREATE TRIGGER recordatorios_set_centro_id_trg
  BEFORE INSERT ON public.recordatorios
  FOR EACH ROW EXECUTE FUNCTION public.recordatorios_set_centro_id();

-- ─── 6. RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.recordatorios ENABLE ROW LEVEL SECURITY;

-- SELECT: visibilidad por destino. Reusa helpers que leen OTRAS tablas
-- (roles_usuario, matriculas/profes_aulas, vinculos_familiares) → la SELECT
-- policy NO re-lee `recordatorios`, así que el gotcha MVCC de INSERT…RETURNING
-- NO aplica (verificado con test explícito de .insert().select()).
DROP POLICY IF EXISTS recordatorios_select ON public.recordatorios;
CREATE POLICY recordatorios_select ON public.recordatorios
  FOR SELECT USING (
    (destinatario = 'familia' AND (
      public.es_admin(centro_id)
      OR public.es_profe_de_nino(nino_id)
      OR public.tiene_permiso_sobre(nino_id, 'puede_recibir_mensajes')
    ))
    OR (destinatario = 'equipo' AND (
      public.es_admin(centro_id)
      OR public.es_profe_de_nino(nino_id)
      OR public.es_tutor_de(nino_id)
    ))
    OR (destinatario = 'direccion' AND (
      public.es_admin(centro_id)
      OR creado_por = auth.uid()
    ))
    OR (destinatario = 'personal' AND usuario_destinatario_id = auth.uid())
  );

-- INSERT: quién puede crear cada destino. creado_por = auth.uid() anti-suplantación.
DROP POLICY IF EXISTS recordatorios_insert ON public.recordatorios;
CREATE POLICY recordatorios_insert ON public.recordatorios
  FOR INSERT WITH CHECK (
    creado_por = auth.uid()
    AND (
      (destinatario = 'familia'
        AND (public.es_admin(centro_id) OR public.es_profe_de_nino(nino_id))
        AND public.centro_de_nino(nino_id) = centro_id)
      OR (destinatario = 'equipo'
        AND public.es_tutor_de(nino_id)
        AND public.tiene_permiso_sobre(nino_id, 'puede_recibir_mensajes')
        AND public.centro_de_nino(nino_id) = centro_id)
      OR (destinatario = 'direccion'
        AND public.pertenece_a_centro(centro_id))
      OR (destinatario = 'personal'
        AND usuario_destinatario_id = auth.uid()
        AND public.pertenece_a_centro(centro_id))
    )
  );

-- UPDATE: completar (cualquiera que vea el recordatorio) o anular (emisor).
-- Mismo predicado de visibilidad en USING y WITH CHECK (defensa simétrica, cf.
-- gotcha "USING falso → 0 filas" F5.6-B). La restricción de columnas (solo
-- completar/anular) y la ventana de 5 min de anulación las enforza el server
-- action — NO la RLS — porque el UPDATE multiplexa completar (sin límite
-- temporal) y anular (5 min), imposible de separar por tiempo en una policy
-- (ver ADR-0036, riesgo aceptado).
DROP POLICY IF EXISTS recordatorios_update ON public.recordatorios;
CREATE POLICY recordatorios_update ON public.recordatorios
  FOR UPDATE
  USING (
    (destinatario = 'familia' AND (
      public.es_admin(centro_id) OR public.es_profe_de_nino(nino_id)
      OR public.tiene_permiso_sobre(nino_id, 'puede_recibir_mensajes')))
    OR (destinatario = 'equipo' AND (
      public.es_admin(centro_id) OR public.es_profe_de_nino(nino_id) OR public.es_tutor_de(nino_id)))
    OR (destinatario = 'direccion' AND (public.es_admin(centro_id) OR creado_por = auth.uid()))
    OR (destinatario = 'personal' AND usuario_destinatario_id = auth.uid())
  )
  WITH CHECK (
    (destinatario = 'familia' AND (
      public.es_admin(centro_id) OR public.es_profe_de_nino(nino_id)
      OR public.tiene_permiso_sobre(nino_id, 'puede_recibir_mensajes')))
    OR (destinatario = 'equipo' AND (
      public.es_admin(centro_id) OR public.es_profe_de_nino(nino_id) OR public.es_tutor_de(nino_id)))
    OR (destinatario = 'direccion' AND (public.es_admin(centro_id) OR creado_por = auth.uid()))
    OR (destinatario = 'personal' AND usuario_destinatario_id = auth.uid())
  );

-- DELETE: sin policy → default DENY. Los errores se marcan con erroneo + prefijo.

-- ─── 7. audit_trigger_function ampliada (rama recordatorios) ───────────────
-- CREATE OR REPLACE preserva todas las ramas previas (Fases 2..5). Se añade
-- 1 rama: recordatorios (centro_id directo).
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

DROP TRIGGER IF EXISTS audit_recordatorios ON public.recordatorios;
CREATE TRIGGER audit_recordatorios
  AFTER INSERT OR UPDATE OR DELETE ON public.recordatorios
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

-- ─── 8. Realtime publication ──────────────────────────────────────────────
-- El badge de "pendientes" se actualiza en vivo. La RLS de SELECT filtra los
-- eventos: cada cliente solo recibe notificaciones de filas que puede leer.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.recordatorios;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
