-- =============================================================================
-- Fase 6-C-1 — Re-modelado granular de destinatarios de recordatorios
-- =============================================================================
-- DESTRUCTIVA (D1, ADR-0037): DROP TABLE + DROP TYPE y recreación. El piloto no
-- ha arrancado y los datos de F6-A/B son de prueba; mapear equipo/direccion (que
-- se eliminan) a los nuevos destinos no tiene equivalente limpio y un ENUM no se
-- "renombra" sin recrearlo. `audit_log` es append-only y conserva el histórico
-- aunque se borre la tabla. El responsable confirma volumen ≈0 antes de aplicar.
--
-- Supera a F6-A (migración 20260531120000_phase6_reminders.sql) y a ADR-0035.
--
-- Nuevo ENUM (6 destinos): familia_individual | familias_aula | familias_centro
--   | profe_individual | profes_centro | personal.
-- Nueva columna `aula_id` (destino familias_aula). `usuario_destinatario_id`
--   cubre ahora profe_individual y personal. familias_centro/profes_centro no
--   necesitan ref extra (los lleva centro_id).
-- 2 helpers SQL nuevos: es_tutor_en_aula(p_aula_id), es_profe_en_centro(p_centro_id).
--   Reutiliza es_admin, es_profe_de_nino, es_profe_de_aula, tiene_permiso_sobre,
--   pertenece_a_centro, centro_de_nino, centro_de_aula y es_tutor_en_centro
--   (F5.6-A, firma de 2 args: se invoca con auth.uid() explícito).
-- RLS reescrita por la matriz D9 (admin/profe emisores; tutor solo recibe).
-- RPC contar_recordatorios_pendientes() para el badge (destinatario directo).
-- audit_recordatorios re-atado (la rama recordatorios de audit_trigger_function
--   no cambia: centro_id directo).
-- Realtime: re-añadir recordatorios a supabase_realtime (lo quita el DROP CASCADE).
--
-- Spec:  docs/specs/reminders-c.md  ·  ADR: 0037 (supera 0035). 0036 vigente.
-- Gotcha MVCC NO aplica: recordatorios_select lee columnas del propio row +
--   helpers sobre OTRAS tablas; nunca re-lee recordatorios (test .insert().select()).
-- =============================================================================
BEGIN;

-- ─── 0. Limpieza del modelo viejo (idempotente) ──────────────────────────────
-- DROP TABLE … CASCADE elimina policies, índices, triggers (incl. audit_recordatorios
-- y el trigger Realtime). audit_trigger_function() y set_updated_at() son compartidas
-- por otras tablas → NO se tocan.
DROP TABLE IF EXISTS public.recordatorios CASCADE;
DROP TYPE  IF EXISTS public.recordatorio_destinatario;

-- ─── 1. ENUM de destino (6 valores) ──────────────────────────────────────────
CREATE TYPE public.recordatorio_destinatario AS ENUM (
  'familia_individual', 'familias_aula', 'familias_centro',
  'profe_individual', 'profes_centro', 'personal'
);

-- ─── 2. Helpers SQL nuevos ───────────────────────────────────────────────────
-- ¿auth.uid() es tutor/autorizado de algún niño activo del aula?
CREATE OR REPLACE FUNCTION public.es_tutor_en_aula(p_aula_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.matriculas m
    JOIN public.vinculos_familiares v ON v.nino_id = m.nino_id
    WHERE m.aula_id = p_aula_id AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
      AND v.usuario_id = auth.uid() AND v.deleted_at IS NULL
  );
$$;

GRANT EXECUTE ON FUNCTION public.es_tutor_en_aula(uuid) TO authenticated;

-- ¿auth.uid() tiene rol profe en el centro?
CREATE OR REPLACE FUNCTION public.es_profe_en_centro(p_centro_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.roles_usuario r
    WHERE r.centro_id = p_centro_id AND r.usuario_id = auth.uid()
      AND r.rol = 'profe' AND r.deleted_at IS NULL
  );
$$;

GRANT EXECUTE ON FUNCTION public.es_profe_en_centro(uuid) TO authenticated;

-- ─── 3. Tabla recordatorios (modelo granular) ────────────────────────────────
CREATE TABLE public.recordatorios (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id                uuid NOT NULL REFERENCES public.centros(id)  ON DELETE CASCADE,
  destinatario             public.recordatorio_destinatario NOT NULL,
  nino_id                  uuid REFERENCES public.ninos(id)             ON DELETE CASCADE,
  aula_id                  uuid REFERENCES public.aulas(id)             ON DELETE CASCADE,
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

  -- Coherencia estructural por destino: cada destino lleva (solo) su referencia.
  CONSTRAINT recordatorios_destino_coherencia CHECK (
    (destinatario = 'familia_individual' AND nino_id IS NOT NULL AND aula_id IS NULL AND usuario_destinatario_id IS NULL)
    OR (destinatario = 'familias_aula'    AND aula_id IS NOT NULL AND nino_id IS NULL AND usuario_destinatario_id IS NULL)
    OR (destinatario = 'familias_centro'  AND nino_id IS NULL AND aula_id IS NULL AND usuario_destinatario_id IS NULL)
    OR (destinatario = 'profe_individual' AND usuario_destinatario_id IS NOT NULL AND nino_id IS NULL AND aula_id IS NULL)
    OR (destinatario = 'profes_centro'    AND nino_id IS NULL AND aula_id IS NULL AND usuario_destinatario_id IS NULL)
    OR (destinatario = 'personal'         AND usuario_destinatario_id IS NOT NULL AND nino_id IS NULL AND aula_id IS NULL)
  ),
  -- 200 chars de input + 10 del prefijo '[anulado] ' (mismo criterio que F5/F6-A).
  CONSTRAINT recordatorios_titulo_len CHECK (char_length(titulo) BETWEEN 1 AND 210),
  CONSTRAINT recordatorios_descripcion_len CHECK (descripcion IS NULL OR char_length(descripcion) <= 1000),
  -- completado_en y completado_por van juntos (los dos NULL o los dos poblados).
  CONSTRAINT recordatorios_completado_coherencia CHECK (
    (completado_en IS NULL AND completado_por IS NULL)
    OR (completado_en IS NOT NULL AND completado_por IS NOT NULL)
  )
);

COMMENT ON TABLE public.recordatorios IS
  'Recordatorios granulares (F6-C). admin/profe emisores; tutor solo recibe. Ver docs/specs/reminders-c.md.';
COMMENT ON COLUMN public.recordatorios.destinatario IS
  'familia_individual (1 niño) | familias_aula (1 aula) | familias_centro | profe_individual | profes_centro | personal.';

-- ─── 4. Índices ──────────────────────────────────────────────────────────────
CREATE INDEX idx_recordatorios_centro
  ON public.recordatorios (centro_id);
CREATE INDEX idx_recordatorios_nino
  ON public.recordatorios (nino_id) WHERE nino_id IS NOT NULL;
CREATE INDEX idx_recordatorios_aula
  ON public.recordatorios (aula_id) WHERE aula_id IS NOT NULL;
CREATE INDEX idx_recordatorios_usuario_destinatario
  ON public.recordatorios (usuario_destinatario_id) WHERE usuario_destinatario_id IS NOT NULL;
CREATE INDEX idx_recordatorios_creado_por
  ON public.recordatorios (creado_por);
CREATE INDEX idx_recordatorios_pendientes
  ON public.recordatorios (vencimiento)
  WHERE completado_en IS NULL AND erroneo = false;

-- ─── 5. Trigger updated_at ───────────────────────────────────────────────────
CREATE TRIGGER recordatorios_set_updated_at
  BEFORE UPDATE ON public.recordatorios
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 6. Trigger BEFORE INSERT: derivar centro_id (red de seguridad) ──────────
-- familia_individual → desde nino_id; familias_aula → desde aula_id. Para los
-- destinos sin niño/aula el server action provee centro_id explícito. Si queda
-- NULL → EXCEPTION. SECURITY DEFINER para leer ninos/aulas sin disparar su RLS.
CREATE OR REPLACE FUNCTION public.recordatorios_set_centro_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.centro_id IS NULL AND NEW.nino_id IS NOT NULL THEN
    NEW.centro_id := public.centro_de_nino(NEW.nino_id);
  END IF;
  IF NEW.centro_id IS NULL AND NEW.aula_id IS NOT NULL THEN
    NEW.centro_id := public.centro_de_aula(NEW.aula_id);
  END IF;
  IF NEW.centro_id IS NULL THEN
    RAISE EXCEPTION 'recordatorios: no se pudo derivar centro_id (destinatario=% nino_id=% aula_id=%)',
      NEW.destinatario, NEW.nino_id, NEW.aula_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER recordatorios_set_centro_id_trg
  BEFORE INSERT ON public.recordatorios
  FOR EACH ROW EXECUTE FUNCTION public.recordatorios_set_centro_id();

-- ─── 7. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.recordatorios ENABLE ROW LEVEL SECURITY;

-- SELECT: visibilidad por destino. Helpers leen OTRAS tablas (ninos/aulas/
-- matriculas/vinculos_familiares/roles_usuario) → la SELECT policy NO re-lee
-- recordatorios → gotcha MVCC de INSERT…RETURNING NO aplica.
CREATE POLICY recordatorios_select ON public.recordatorios
  FOR SELECT USING (
    (destinatario = 'familia_individual' AND (
      public.es_admin(centro_id)
      OR public.es_profe_de_nino(nino_id)
      OR public.tiene_permiso_sobre(nino_id, 'puede_recibir_mensajes')))
    OR (destinatario = 'familias_aula' AND (
      public.es_admin(centro_id)
      OR public.es_profe_de_aula(aula_id)
      OR public.es_tutor_en_aula(aula_id)))
    OR (destinatario = 'familias_centro' AND (
      public.es_admin(centro_id)
      OR public.es_tutor_en_centro(auth.uid(), centro_id)))
    OR (destinatario = 'profe_individual' AND (
      public.es_admin(centro_id)
      OR usuario_destinatario_id = auth.uid()))
    OR (destinatario = 'profes_centro' AND (
      public.es_admin(centro_id)
      OR public.es_profe_en_centro(centro_id)))
    OR (destinatario = 'personal' AND usuario_destinatario_id = auth.uid())
  );

-- INSERT: matriz D9. creado_por = auth.uid() (anti-suplantación). Tutor/autorizado
-- no pasan ningún predicado → no pueden crear ningún destino (solo reciben).
CREATE POLICY recordatorios_insert ON public.recordatorios
  FOR INSERT WITH CHECK (
    creado_por = auth.uid()
    AND (
      (destinatario = 'familia_individual'
        AND (public.es_admin(centro_id) OR public.es_profe_de_nino(nino_id))
        AND public.centro_de_nino(nino_id) = centro_id)
      OR (destinatario = 'familias_aula'
        AND (public.es_admin(centro_id) OR public.es_profe_de_aula(aula_id))
        AND public.centro_de_aula(aula_id) = centro_id)
      OR (destinatario = 'familias_centro'
        AND public.es_admin(centro_id))
      OR (destinatario = 'profe_individual'
        AND public.es_admin(centro_id))
      OR (destinatario = 'profes_centro'
        AND public.es_admin(centro_id))
      OR (destinatario = 'personal'
        AND usuario_destinatario_id = auth.uid()
        AND public.pertenece_a_centro(centro_id))
    )
  );

-- UPDATE: completar (quien lo ve) / anular (emisor, ventana en el action).
-- Mismo predicado de visibilidad que SELECT en USING y WITH CHECK (defensa
-- simétrica, cf. gotcha "USING falso → 0 filas" F5.6-B). La restricción de
-- columnas y la ventana de 5 min las enforza el server action (ADR-0036).
CREATE POLICY recordatorios_update ON public.recordatorios
  FOR UPDATE
  USING (
    (destinatario = 'familia_individual' AND (
      public.es_admin(centro_id) OR public.es_profe_de_nino(nino_id)
      OR public.tiene_permiso_sobre(nino_id, 'puede_recibir_mensajes')))
    OR (destinatario = 'familias_aula' AND (
      public.es_admin(centro_id) OR public.es_profe_de_aula(aula_id) OR public.es_tutor_en_aula(aula_id)))
    OR (destinatario = 'familias_centro' AND (
      public.es_admin(centro_id) OR public.es_tutor_en_centro(auth.uid(), centro_id)))
    OR (destinatario = 'profe_individual' AND (
      public.es_admin(centro_id) OR usuario_destinatario_id = auth.uid()))
    OR (destinatario = 'profes_centro' AND (
      public.es_admin(centro_id) OR public.es_profe_en_centro(centro_id)))
    OR (destinatario = 'personal' AND usuario_destinatario_id = auth.uid())
  )
  WITH CHECK (
    (destinatario = 'familia_individual' AND (
      public.es_admin(centro_id) OR public.es_profe_de_nino(nino_id)
      OR public.tiene_permiso_sobre(nino_id, 'puede_recibir_mensajes')))
    OR (destinatario = 'familias_aula' AND (
      public.es_admin(centro_id) OR public.es_profe_de_aula(aula_id) OR public.es_tutor_en_aula(aula_id)))
    OR (destinatario = 'familias_centro' AND (
      public.es_admin(centro_id) OR public.es_tutor_en_centro(auth.uid(), centro_id)))
    OR (destinatario = 'profe_individual' AND (
      public.es_admin(centro_id) OR usuario_destinatario_id = auth.uid()))
    OR (destinatario = 'profes_centro' AND (
      public.es_admin(centro_id) OR public.es_profe_en_centro(centro_id)))
    OR (destinatario = 'personal' AND usuario_destinatario_id = auth.uid())
  );

-- DELETE: sin policy → default DENY. Los errores se marcan con erroneo + prefijo.

-- ─── 8. RPC del badge (D7): pendientes donde soy DESTINATARIO DIRECTO ─────────
-- No por mera visibilidad RLS (admin ve todo del centro pero no es destinatario).
-- SECURITY DEFINER + auth.uid(). Excluye lo que el propio usuario creó (salvo
-- personal/profe_individual, que son self-dirigidos).
CREATE OR REPLACE FUNCTION public.contar_recordatorios_pendientes()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM public.recordatorios r
  WHERE r.completado_en IS NULL AND r.erroneo = false
    AND (
      (r.destinatario = 'personal'          AND r.usuario_destinatario_id = auth.uid())
      OR (r.destinatario = 'profe_individual' AND r.usuario_destinatario_id = auth.uid())
      OR (r.destinatario = 'profes_centro'  AND public.es_profe_en_centro(r.centro_id))
      OR (r.destinatario = 'familia_individual' AND r.creado_por <> auth.uid()
           AND public.tiene_permiso_sobre(r.nino_id, 'puede_recibir_mensajes'))
      OR (r.destinatario = 'familias_aula'  AND r.creado_por <> auth.uid()
           AND public.es_tutor_en_aula(r.aula_id))
      OR (r.destinatario = 'familias_centro' AND r.creado_por <> auth.uid()
           AND public.es_tutor_en_centro(auth.uid(), r.centro_id))
    );
$$;

GRANT EXECUTE ON FUNCTION public.contar_recordatorios_pendientes() TO authenticated;

-- ─── 9. Audit trigger (re-atar; la rama recordatorios no cambia) ─────────────
-- audit_trigger_function() ya tiene la rama recordatorios (centro_id directo) y
-- es compartida → no se recrea. El DROP TABLE CASCADE quitó el trigger; lo re-atamos.
CREATE TRIGGER audit_recordatorios
  AFTER INSERT OR UPDATE OR DELETE ON public.recordatorios
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

-- ─── 10. Realtime publication (re-añadir; el DROP CASCADE la quitó) ──────────
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.recordatorios;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
