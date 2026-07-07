-- =============================================================================
-- F-2a · RLS admin-CRUD + auditoría de ESCRITURA de familias / familia_tutores
-- -----------------------------------------------------------------------------
-- Enciende las 2 tablas de F-0 (hoy deny-all + VACÍAS): admin-CRUD por centro +
-- auditoría de escritura por la MISMA vía que el dato médico (info_medica_emergencia):
-- la función genérica public.audit_trigger_function() → public.audit_log.
--
-- audit_log es polimórfico de sujeto (tabla + registro_id + centro_id, SIN nino_id)
-- → no requiere sujeto_tipo/nino_id/backfill/FK: los eventos de familia entran con
-- tabla='familias'|'familia_tutores', registro_id=id, centro_id vía centro_de_familia.
-- Los eventos de niño siguen intactos. Sin migración de datos.
--
-- NO toca la escritura del alta (F-2b) ni otra tabla/RPC. service_role (BYPASSRLS)
-- podrá escribir familia/perfil en F-2b pese a estas policies.
-- Aplicar por SQL Editor (rol postgres). NO por CLI.
-- =============================================================================
BEGIN;

-- -----------------------------------------------------------------------------
-- 1. RLS familias — admin-CRUD por centro. Soft-delete (UPDATE deleted_at):
--    sin policy DELETE → el borrado físico queda denegado para authenticated;
--    solo el service_role (BYPASSRLS) podría hacerlo.
-- -----------------------------------------------------------------------------
CREATE POLICY familias_select ON public.familias
  FOR SELECT TO authenticated
  USING (public.es_admin(centro_id));

CREATE POLICY familias_insert ON public.familias
  FOR INSERT TO authenticated
  WITH CHECK (public.es_admin(centro_id));

CREATE POLICY familias_update ON public.familias
  FOR UPDATE TO authenticated
  USING (public.es_admin(centro_id))
  WITH CHECK (public.es_admin(centro_id));

-- -----------------------------------------------------------------------------
-- 2. RLS familia_tutores — admin del centro derivado vía familia (helper F-0).
--    Soft-delete (sin DELETE). usuario_id protegido por el trigger de §3.
-- -----------------------------------------------------------------------------
CREATE POLICY familia_tutores_select ON public.familia_tutores
  FOR SELECT TO authenticated
  USING (public.es_admin(public.centro_de_familia(familia_id)));

CREATE POLICY familia_tutores_insert ON public.familia_tutores
  FOR INSERT TO authenticated
  WITH CHECK (public.es_admin(public.centro_de_familia(familia_id)));

CREATE POLICY familia_tutores_update ON public.familia_tutores
  FOR UPDATE TO authenticated
  USING (public.es_admin(public.centro_de_familia(familia_id)))
  WITH CHECK (public.es_admin(public.centro_de_familia(familia_id)));

-- -----------------------------------------------------------------------------
-- 3. Congelado de usuario_id. NIDO no tiene función compartida de congelado; el
--    patrón real es un trigger BEFORE UPDATE bespoke por tabla con
--    `NEW.x IS DISTINCT FROM OLD.x → RAISE` (plantilla: administraciones_medicacion,
--    phase8_3b). La (des)vinculación de cuenta va por el flujo de cuenta (F-2b,
--    service_role): current_user='service_role' bajo PostgREST → exento.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.familia_tutores_proteger_usuario_id()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.usuario_id IS DISTINCT FROM OLD.usuario_id
     AND current_user <> 'service_role' THEN
    RAISE EXCEPTION
      'familia_tutores: usuario_id no es editable por este rol; la (des)vinculacion de cuenta va por el flujo de cuenta (F-2b)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER familia_tutores_proteger_usuario_id
  BEFORE UPDATE ON public.familia_tutores
  FOR EACH ROW EXECUTE FUNCTION public.familia_tutores_proteger_usuario_id();

-- -----------------------------------------------------------------------------
-- 4. Auditoría de ESCRITURA — misma vía que el dato médico: función genérica
--    compartida. CREATE OR REPLACE reproduce el cuerpo VIGENTE (phase12b_0,
--    40+ ramas verbatim) + 2 ramas nuevas. audit_log no tiene nino_id → el
--    sujeto familia entra sin columna nueva.
-- -----------------------------------------------------------------------------
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
  ELSIF TG_TABLE_NAME = 'plantillas_informe' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'informes_evolucion' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'campanas_informe' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'publicaciones' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'media' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'media_etiquetas' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'aulas_curso' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'lista_espera' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  -- ── F-2a: familias (centro_id directo) ───────────────────────────────────
  ELSIF TG_TABLE_NAME = 'familias' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  -- ── F-2a: familia_tutores (centro derivado de la familia) ────────────────
  ELSIF TG_TABLE_NAME = 'familia_tutores' THEN
    v_centro_id := public.centro_de_familia(COALESCE((NEW).familia_id, (OLD).familia_id));
  ELSIF TG_TABLE_NAME IN (
    'conceptos_cobro',
    'tipos_beca',
    'asignacion_cuota',
    'becas',
    'metodo_pago_familia',
    'parte_servicio_diario',
    'cierre_mensual',
    'recibos',
    'lineas_recibo',
    'remesas',
    'recibos_remesa'
  ) THEN
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

-- Triggers AFTER de escritura (INSERT/UPDATE/DELETE) en las 2 tablas.
CREATE TRIGGER audit_familias
  AFTER INSERT OR UPDATE OR DELETE ON public.familias
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

CREATE TRIGGER audit_familia_tutores
  AFTER INSERT OR UPDATE OR DELETE ON public.familia_tutores
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

COMMIT;
