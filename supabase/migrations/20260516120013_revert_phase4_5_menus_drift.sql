-- =============================================================================
-- Chore — Revertir drift de Fase 4.5 (PR #12 cerrado sin merge)
-- =============================================================================
-- El PR #12 introducía `plantillas_menu`, `plantilla_menu_dia`, 2 ENUMs, 3
-- helpers SQL y ampliaba `audit_trigger_function()` con 2 ramas adicionales.
-- La migración `20260516000000_phase4_5_menus.sql` se aplicó al proyecto
-- Supabase remoto durante el Checkpoint B, pero el PR se cerró sin merge
-- tras un cambio de planes en el diseño del módulo de menús (rehacer con
-- menú mensual + calendario laboral + platos, ver F4.5a).
--
-- Esta migración limpia el drift del remoto y deja el esquema exactamente
-- como estaba al finalizar Fase 4 (post-merge de PR #11 hotfix CI).
--
-- IDEMPOTENTE: usa IF EXISTS y CASCADE porque el estado difiere entre
-- entornos. En un local fresco (supabase db reset desde main), nada de
-- esto existe y los DROPs son no-op silenciosos.
-- =============================================================================

-- ─── 1. Triggers de audit ─────────────────────────────────────────────────
DROP TRIGGER IF EXISTS audit_plantilla_menu_dia ON public.plantilla_menu_dia;
DROP TRIGGER IF EXISTS audit_plantillas_menu ON public.plantillas_menu;

-- ─── 2. Tablas (en orden FK: hija primero) ────────────────────────────────
-- CASCADE elimina cualquier policy RLS, índice, FK que quedara colgando.
DROP TABLE IF EXISTS public.plantilla_menu_dia CASCADE;
DROP TABLE IF EXISTS public.plantillas_menu CASCADE;

-- ─── 3. Helpers SQL ───────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.menu_del_dia(uuid, date);
DROP FUNCTION IF EXISTS public.nino_toma_comida_solida(uuid);
DROP FUNCTION IF EXISTS public.centro_de_plantilla(uuid);

-- ─── 4. ENUMs ─────────────────────────────────────────────────────────────
DROP TYPE IF EXISTS public.estado_plantilla_menu;
DROP TYPE IF EXISTS public.dia_semana;

-- ─── 5. Restaurar audit_trigger_function al estado post-Fase 4 ────────────
-- Cuerpo idéntico al de la migración 20260515203407_phase4_attendance.sql
-- (sección 7), con las ramas de centros, ninos, roles_usuario, las tablas
-- por nino_id (info_medica, vinculos, matriculas, datos_pedagogicos,
-- asistencias, ausencias), agendas_diarias y las 4 hijas de agenda. SIN las
-- ramas de plantillas_menu / plantilla_menu_dia que añadía F4.5.
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

-- ─── 6. Borrar el registro huérfano del migration history ─────────────────
-- La migración original 20260516000000 se aplicó al remoto pero el archivo
-- ya no existe en main. Borramos su entrada para que `supabase db push`
-- futuro no se desincronice y `supabase db reset` no falle al replicar.
-- IF EXISTS implícito: si no hay fila, DELETE no falla, devuelve 0 rows.
DELETE FROM supabase_migrations.schema_migrations
WHERE version = '20260516000000';
