-- =============================================================================
-- FEAT — Recibos, PR-1a: cobrar a mano en efectivo o por transferencia
-- -----------------------------------------------------------------------------
-- Un recibo que no es SEPA se quedaba en `pendiente_procesar` para siempre: no entra en ninguna
-- remesa y el único «cobrado» manual estaba en Devoluciones, solo para los devueltos. Decisiones
-- del responsable:
--
--   · El cobro manual guarda su forma (`cobro_forma`: efectivo o transferencia), su fecha
--     (`cobro_fecha`) y una nota opcional (`cobro_nota`). Los tres van juntos con el estado
--     `cobrado_manual` (CHECK). El cheque guardería llegará en el PR-1b ampliando la forma.
--   · Se conservan las fechas de banco: un devuelto cobrado a mano guarda su envío y su
--     devolución. Hasta ahora el CHECK `recibos_envio_banco_fecha` obligaba a borrarlas.
--   · Solo se cobra a mano un recibo `pendiente_procesar` o `devuelto`, y nunca un SEPA
--     pendiente, que va por remesa (`recibos_validar_cobro_manual`, BEFORE UPDATE OF estado). Es
--     una regla de la TRANSICIÓN, no del estado: un trigger, no un CHECK.
--   · `cobro_nota` es texto libre de la directora y la purga no redacta recibos (se conservan
--     como registro económico): no entra en `audit_log`. La forma y la fecha sí.
--   · El export del art. 15 (`export_datos_sujeto`) incluye la forma, la fecha y la nota.
--
-- `audit_trigger_function` y `export_datos_sujeto` se recrean desde su definición viva en
-- producción (leída el 2026-10-22, md5 normalizado en la guarda previa), con solo esos cambios.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor, DESPUÉS de
-- `20261104120000`. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_n   integer;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'recibos'
                AND column_name IN ('cobro_forma', 'cobro_fecha', 'cobro_nota'))
     OR to_regprocedure('public.recibos_validar_cobro_manual()') IS NOT NULL THEN
    RAISE EXCEPTION 'las columnas del cobro manual o su trigger ya existen';
  END IF;
  -- Las dos funciones que se recrean, con la lógica que se leyó en producción (md5 normalizado:
  -- sin \r, sin comentarios, espacios colapsados).
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.audit_trigger_function()');
  IF v_md5 IS DISTINCT FROM '4fca0468976a319f6bb5d895af702833' THEN
    RAISE EXCEPTION 'audit_trigger_function no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.export_datos_sujeto(text,uuid)');
  IF v_md5 IS DISTINCT FROM '85dad02f189ac803f0ec3ee62d30fc93' THEN
    RAISE EXCEPTION 'export_datos_sujeto no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  -- El CHECK que se sustituye.
  SELECT md5(pg_get_constraintdef(c.oid)) INTO v_md5
    FROM pg_constraint c
   WHERE c.conrelid = 'public.recibos'::regclass AND c.conname = 'recibos_envio_banco_fecha';
  IF v_md5 IS DISTINCT FROM '156cf3a7cf5a1e15889a80df33d36afe' THEN
    RAISE EXCEPTION 'recibos_envio_banco_fecha no es el leído en producción: %', coalesce(v_md5, 'falta');
  END IF;
  -- Un cobrado_manual ya existente no tiene forma ni fecha: el CHECK nuevo lo rechazaría.
  SELECT count(*) INTO v_n FROM public.recibos WHERE estado = 'cobrado_manual';
  RAISE NOTICE 'recibos en cobrado_manual antes de aplicar: %', v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'hay % recibos en cobrado_manual sin forma ni fecha de cobro', v_n;
  END IF;
END
$guarda$;

-- ---- Columnas y CHECK ----
ALTER TABLE public.recibos
  ADD COLUMN cobro_forma public.metodo_pago,
  ADD COLUMN cobro_fecha date,
  ADD COLUMN cobro_nota  text;

COMMENT ON COLUMN public.recibos.cobro_forma IS
  'PR-1a: forma del cobro manual (efectivo o transferencia). Solo con estado cobrado_manual.';
COMMENT ON COLUMN public.recibos.cobro_fecha IS
  'PR-1a: fecha en que se cobró a mano. Solo con estado cobrado_manual.';
COMMENT ON COLUMN public.recibos.cobro_nota IS
  'PR-1a: nota opcional del cobro manual. No entra en audit_log (texto libre que la purga no redacta).';

ALTER TABLE public.recibos
  ADD CONSTRAINT recibos_cobro_manual_datos CHECK (
    (estado = 'cobrado_manual') = (cobro_forma IS NOT NULL AND cobro_fecha IS NOT NULL)
    AND (cobro_nota IS NULL OR estado = 'cobrado_manual')
  ),
  ADD CONSTRAINT recibos_cobro_forma_manual CHECK (
    cobro_forma IS NULL OR cobro_forma IN ('efectivo', 'transferencia')
  ),
  ADD CONSTRAINT recibos_cobro_nota_longitud CHECK (
    cobro_nota IS NULL OR char_length(cobro_nota) BETWEEN 1 AND 500
  );

-- Las fechas de banco se conservan al cobrar a mano un devuelto: cobrado_manual admite las dos
-- vacías (nunca fue al banco) o las dos rellenas (fue y volvió).
ALTER TABLE public.recibos DROP CONSTRAINT recibos_envio_banco_fecha;
ALTER TABLE public.recibos
  ADD CONSTRAINT recibos_envio_banco_fecha CHECK (
       (estado = 'enviado_banco' AND fecha_envio_banco IS NOT NULL AND fecha_devolucion IS NULL)
    OR (estado = 'devuelto' AND fecha_envio_banco IS NOT NULL AND fecha_devolucion IS NOT NULL)
    OR (estado = 'cobrado_manual'
        AND ((fecha_envio_banco IS NULL AND fecha_devolucion IS NULL)
          OR (fecha_envio_banco IS NOT NULL AND fecha_devolucion IS NOT NULL)))
    OR (estado NOT IN ('enviado_banco', 'devuelto', 'cobrado_manual')
        AND fecha_envio_banco IS NULL AND fecha_devolucion IS NULL)
  );

-- ---- La transición a cobrado_manual ----
CREATE FUNCTION public.recibos_validar_cobro_manual()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Se mira la TRANSICIÓN: solo al entrar en cobrado_manual. Vale para todos, también para
  -- service_role y para los esporádicos y re-giros (el congelado por estado no los cubre).
  IF NEW.estado = 'cobrado_manual' AND OLD.estado IS DISTINCT FROM 'cobrado_manual' THEN
    IF OLD.estado NOT IN ('pendiente_procesar', 'devuelto') THEN
      RAISE EXCEPTION 'solo se cobra a mano un recibo pendiente o devuelto (este está en %)', OLD.estado
        USING ERRCODE = 'P0001', HINT = 'no_cobrable_manual';
    END IF;
    -- Un SEPA pendiente se cobra por remesa. Para cobrarlo a mano, primero se desconfirma y se
    -- cambia el método del mes.
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.recibos_validar_cobro_manual() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER recibos_validar_cobro_manual
  BEFORE UPDATE OF estado ON public.recibos
  FOR EACH ROW EXECUTE FUNCTION public.recibos_validar_cobro_manual();

-- ---- audit_trigger_function: recibos sin cobro_nota ----
CREATE OR REPLACE FUNCTION public.audit_trigger_function()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    v_centro_id := privado.centro_de_plantilla(COALESCE((NEW).plantilla_id, (OLD).plantilla_id));
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
    v_centro_id := privado.centro_de_nino(COALESCE((NEW).nino_id, (OLD).nino_id));
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
  -- ── F-3-A: rollover_finaliza (centro_id directo) ─────────────────────────
  ELSIF TG_TABLE_NAME = 'rollover_finaliza' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  -- ── F-2a: familias (centro_id directo) ───────────────────────────────────
  ELSIF TG_TABLE_NAME = 'familias' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  -- ── F-2a: familia_tutores (centro derivado de la familia) ────────────────
  ELSIF TG_TABLE_NAME = 'familia_tutores' THEN
    v_centro_id := privado.centro_de_familia(COALESCE((NEW).familia_id, (OLD).familia_id));
  ELSIF TG_TABLE_NAME IN (
    'conceptos_cobro',
    'tipos_beca',
    'asignacion_concepto',
    'becas',
    'metodo_pago_familia',
    'parte_servicio_diario',
    'cierre_mensual',
    'recibos',
    'lineas_recibo',
    'remesas',
    'recibos_remesa',
    -- ── B2: beca comedor v2 (centro_id directo) ────────────────────────────
    'beca_comedor_elegibilidad',
    'beca_comedor_tramo',
    'beca_comedor_desborde',
    'beca_comedor_transferencia'
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
    v_centro_id := privado.centro_de_nino(COALESCE((NEW).nino_id, (OLD).nino_id));
  ELSIF TG_TABLE_NAME IN ('comidas', 'biberones', 'suenos', 'deposiciones') THEN
    v_centro_id := privado.centro_de_agenda(COALESCE((NEW).agenda_id, (OLD).agenda_id));
  END IF;

  -- ── Grupo 1 (PR A): tablas auditadas desde 20261011120000 ────────────────
  -- profes_aulas no tiene centro_id: se deriva del aula. Si el aula ya no está (DELETE en
  -- cascada al borrar el aula), del curso. usuarios no es de un centro: centro_id NULL.
  IF TG_TABLE_NAME = 'profes_aulas' THEN
    v_centro_id := COALESCE(
      privado.centro_de_aula(COALESCE((NEW).aula_id, (OLD).aula_id)),
      (SELECT ca.centro_id FROM public.cursos_academicos ca
        WHERE ca.id = COALESCE((NEW).curso_academico_id, (OLD).curso_academico_id)));
  ELSIF TG_TABLE_NAME IN (
    'aulas',
    'cursos_academicos',
    'tarifa_concepto_anio',
    'acuses_alta',
    'cambios_pendientes',
    'mandatos_sepa'
  ) THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  END IF;

  -- ── Grupo 1 (PR B): invitaciones (centro_id directo) ─────────────────────
  IF TG_TABLE_NAME = 'invitaciones' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  END IF;

  v_antes   := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END;
  v_despues := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END;
  v_registro_id := COALESCE((NEW).id, (OLD).id);

  -- ── Grupo 1 (PR A): columnas que no entran en audit_log ──────────────────
  -- Nada entra en audit_log que la redacción de la purga RGPD no sepa limpiar.
  --   cambios_pendientes: el contenido del cambio (payload, valor_propuesto) lleva datos del
  --     niño (p. ej. la dirección) y acaba en la tabla real, que ya se audita.
  --   mandatos_sepa: el IBAN cifrado y la firma, y los datos del firmante que la purga no
  --     redacta en esta tabla (titular, nombre tecleado, IP, user agent).
  IF TG_TABLE_NAME = 'cambios_pendientes' THEN
    v_antes   := v_antes   - ARRAY['payload', 'valor_propuesto'];
    v_despues := v_despues - ARRAY['payload', 'valor_propuesto'];
  ELSIF TG_TABLE_NAME = 'mandatos_sepa' THEN
    v_antes   := v_antes   - ARRAY['iban_cifrado', 'firma_imagen', 'titular', 'nombre_tecleado',
                                   'ip_address', 'user_agent'];
    v_despues := v_despues - ARRAY['iban_cifrado', 'firma_imagen', 'titular', 'nombre_tecleado',
                                   'ip_address', 'user_agent'];
  ELSIF TG_TABLE_NAME = 'recibos' THEN
    -- recibos: la nota del cobro manual es texto libre de la directora, y la purga no redacta
    -- recibos (se conservan). La forma y la fecha del cobro sí entran.
    v_antes   := v_antes   - 'cobro_nota';
    v_despues := v_despues - 'cobro_nota';
  END IF;

  -- ── Grupo 1 (PR B): invitaciones sin token ───────────────────────────────
  IF TG_TABLE_NAME = 'invitaciones' THEN
    v_antes   := v_antes   - 'token';
    v_despues := v_despues - 'token';
  END IF;

  -- ── Grupo 1 (PR B): actor_sistema ────────────────────────────────────────
  -- Solo sin humano (auth.uid() NULL): la etiqueta de app.audit_actor si empieza por
  -- 'system:' (la fijan las purgas con set_config(..., true)); si no la hay y el rol es
  -- service_role, 'system:service_role'. Con sesión humana nunca se rellena.
  INSERT INTO public.audit_log
    (tabla, registro_id, accion, usuario_id, valores_antes, valores_despues, centro_id, actor_sistema)
  VALUES
    (TG_TABLE_NAME, v_registro_id, TG_OP::public.audit_accion, auth.uid(), v_antes, v_despues, v_centro_id,
     CASE WHEN auth.uid() IS NULL THEN
       CASE
         WHEN current_setting('app.audit_actor', true) LIKE 'system:%'
              AND char_length(current_setting('app.audit_actor', true)) <= 100
           THEN current_setting('app.audit_actor', true)
         WHEN auth.role() = 'service_role' THEN 'system:service_role'
       END
     END);

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- ---- export_datos_sujeto: la forma, la fecha y la nota del cobro manual ----
CREATE OR REPLACE FUNCTION public.export_datos_sujeto(p_sujeto_tipo text, p_sujeto_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_self   boolean;
  v_admin  boolean;
  v_centro uuid;
  v_email  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no autorizado a exportar este sujeto'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ---------------------------------------------------------------- USUARIO
  IF p_sujeto_tipo = 'usuario' THEN
    v_self := v_uid = p_sujeto_id;
    IF NOT v_self AND NOT EXISTS (
      SELECT 1 FROM public.roles_usuario ru
       WHERE ru.usuario_id = p_sujeto_id
         AND ru.deleted_at IS NULL
         AND privado.es_responsable(ru.centro_id)
    ) THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = p_sujeto_id;

    -- Cada fila con centro pasa si es el propio usuario o si quien exporta es admin de ese
    -- centro (centro NULL nunca: es_responsable(NULL) es FALSE).
    RETURN jsonb_build_object(
      'preferencias', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'clave', p.clave, 'valor', p.valor, 'actualizado_en', p.updated_at)
               ORDER BY p.clave)
          FROM public.preferencias_usuario p
         WHERE p.usuario_id = p_sujeto_id), '[]'::jsonb),

      'dispositivos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'navegador', s.user_agent, 'registrado_en', s.created_at,
                 'ultima_actividad', s.last_active_at)
               ORDER BY s.created_at)
          FROM public.push_subscriptions s
         WHERE s.usuario_id = p_sujeto_id), '[]'::jsonb),

      'lecturas_conversaciones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'conversacion_id', l.conversacion_id, 'leido_hasta', l.last_read_at)
               ORDER BY l.last_read_at)
          FROM public.lectura_conversacion l
          JOIN public.conversaciones c ON c.id = l.conversacion_id
         WHERE l.usuario_id = p_sujeto_id
           AND (v_self OR (c.centro_id IS NOT NULL AND privado.es_responsable(c.centro_id)))), '[]'::jsonb),

      'lecturas_anuncios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'anuncio_id', l.anuncio_id, 'anuncio', a.titulo, 'leido_en', l.leido_at)
               ORDER BY l.leido_at)
          FROM public.lectura_anuncio l
          JOIN public.anuncios a ON a.id = l.anuncio_id
         WHERE l.usuario_id = p_sujeto_id
           AND (v_self OR (a.centro_id IS NOT NULL AND privado.es_responsable(a.centro_id)))), '[]'::jsonb),

      'invitaciones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'email', i.email, 'nombre_completo', i.nombre_completo,
                 'rol_objetivo', i.rol_objetivo, 'tipo_vinculo', i.tipo_vinculo,
                 'enviada_en', i.created_at, 'expira_en', i.expires_at,
                 'aceptada_en', i.accepted_at, 'rechazada_en', i.rejected_at)
               ORDER BY i.created_at)
          FROM public.invitaciones i
         WHERE v_email IS NOT NULL
           AND lower(i.email) = lower(v_email)
           AND (v_self OR privado.es_responsable(i.centro_id))), '[]'::jsonb),

      'lista_espera_contacto', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'telefono_tutor', le.telefono_tutor, 'email_tutor', le.email_tutor)
               ORDER BY le.created_at)
          FROM public.lista_espera le
         WHERE le.tutor_usuario_id = p_sujeto_id
           AND (v_self OR privado.es_responsable(le.centro_id))), '[]'::jsonb),

      'exportaciones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'exportado_en', e.created_at,
                 'solicitado_por_ti', e.solicitado_por = p_sujeto_id)
               ORDER BY e.created_at)
          FROM public.export_log e
         WHERE e.sujeto_tipo = 'usuario' AND e.sujeto_id = p_sujeto_id
           AND (v_self OR privado.es_responsable(e.centro_id))), '[]'::jsonb),

      'solicitudes_olvido', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'solicitado_en', o.solicitado_en, 'gracia_hasta', o.gracia_hasta,
                 'inmediato', o.inmediato, 'purgado_en', o.purgado_en)
               ORDER BY o.solicitado_en)
          FROM public.olvido_solicitudes o
         WHERE o.sujeto_tipo = 'usuario' AND o.sujeto_id = p_sujeto_id
           AND (v_self OR privado.es_responsable(o.centro_id))), '[]'::jsonb),

      -- Su perfil de tutor en cada familia (solo su fila, no la del otro tutor).
      'perfiles_familia', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'familia_id', ft.familia_id, 'rol_familia', ft.rol_familia,
                 'nombre_completo', ft.nombre_completo, 'email', ft.email,
                 'direccion_calle', ft.direccion_calle, 'direccion_numero', ft.direccion_numero,
                 'direccion_cp', ft.direccion_cp, 'direccion_ciudad', ft.direccion_ciudad,
                 'dni_documento_path', ft.dni_documento_path)
               ORDER BY ft.created_at)
          FROM public.familia_tutores ft
          JOIN public.familias f ON f.id = ft.familia_id
         WHERE ft.usuario_id = p_sujeto_id AND ft.deleted_at IS NULL
           AND (v_self OR privado.es_responsable(f.centro_id))), '[]'::jsonb),

      -- Los mandatos que firmó él. Del IBAN, solo los 4 últimos dígitos.
      'mandatos_sepa', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'identificador_mandato', m.identificador_mandato, 'titular', m.titular,
                 'iban_ultimos4', m.iban_ultimos4, 'estado', m.estado,
                 'metodo_firma', m.metodo_firma, 'fecha_firma', m.fecha_firma,
                 'nombre_tecleado', m.nombre_tecleado, 'firma_imagen', m.firma_imagen,
                 'ip_firma', host(m.ip_address), 'navegador_firma', m.user_agent,
                 'documento_path', m.documento_path)
               ORDER BY m.created_at)
          FROM public.mandatos_sepa m
         WHERE m.usuario_id = p_sujeto_id AND m.deleted_at IS NULL
           AND (v_self OR privado.es_responsable(m.centro_id))), '[]'::jsonb),

      -- Cobros de cada familia de la que es tutor (los dos tutores reciben lo mismo).
      'cobros_familia', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'familia', f.etiqueta,
                 'recibos', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'anio', r.anio, 'mes', r.mes, 'estado', r.estado, 'metodo', r.metodo,
                            'total_centimos', r.total_centimos, 'es_esporadico', r.es_esporadico,
                            'concepto_esporadico', r.concepto_esporadico,
                            'fecha_envio_banco', r.fecha_envio_banco,
                            'fecha_devolucion', r.fecha_devolucion,
                            'cobro_forma', r.cobro_forma, 'cobro_fecha', r.cobro_fecha,
                            'cobro_nota', r.cobro_nota,
                            'lineas', COALESCE((
                              SELECT jsonb_agg(jsonb_build_object(
                                       'descripcion', lr.descripcion, 'cantidad', lr.cantidad,
                                       'precio_unitario_centimos', lr.precio_unitario_centimos,
                                       'importe_centimos', lr.importe_centimos)
                                     ORDER BY lr.created_at, lr.id)
                                FROM public.lineas_recibo lr
                               WHERE lr.recibo_id = r.id), '[]'::jsonb))
                          ORDER BY r.anio, r.mes, r.created_at)
                     FROM public.recibos r
                    WHERE r.familia_id = f.id AND r.deleted_at IS NULL), '[]'::jsonb),
                 'metodos_pago', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'anio', mp.anio, 'mes', mp.mes, 'metodo', mp.metodo)
                          ORDER BY mp.anio, mp.mes)
                     FROM public.metodo_pago_familia mp
                    WHERE mp.familia_id = f.id AND mp.deleted_at IS NULL), '[]'::jsonb),
                 'conceptos_asignados', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'concepto', cc.nombre, 'cantidad', ac.cantidad_default,
                            'importe_especial_centimos', ac.importe_override_centimos,
                            'vigencia_desde', ac.vigencia_desde,
                            'vigencia_hasta', ac.vigencia_hasta)
                          ORDER BY ac.created_at)
                     FROM public.asignacion_concepto ac
                     JOIN public.conceptos_cobro cc ON cc.id = ac.concepto_id
                    WHERE ac.familia_id = f.id AND ac.deleted_at IS NULL), '[]'::jsonb),
                 'beca_comedor_excesos', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'anio', d.anio, 'mes', d.mes,
                            'cuota_total_centimos', d.cuota_total_centimos,
                            'beca_total_centimos', d.beca_total_centimos,
                            'exceso_centimos', d.exceso_centimos,
                            'estado', d.estado, 'via', d.via, 'resuelto_en', d.resuelto_at)
                          ORDER BY d.anio, d.mes)
                     FROM public.beca_comedor_desborde d
                    WHERE d.familia_id = f.id), '[]'::jsonb),
                 'beca_comedor_transferencias', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'anio', bt.anio, 'mes', bt.mes,
                            'importe_centimos', bt.importe_centimos,
                            'estado', bt.estado, 'realizada_en', bt.realizada_at)
                          ORDER BY bt.anio, bt.mes)
                     FROM public.beca_comedor_transferencia bt
                    WHERE bt.familia_id = f.id), '[]'::jsonb))
               ORDER BY f.created_at)
          FROM public.familias f
         WHERE f.id IN (SELECT ft.familia_id FROM public.familia_tutores ft
                         WHERE ft.usuario_id = p_sujeto_id AND ft.deleted_at IS NULL)
           AND (v_self OR privado.es_responsable(f.centro_id))), '[]'::jsonb)
    );
  END IF;

  -- ---------------------------------------------------------------- NIÑO
  IF p_sujeto_tipo = 'nino' THEN
    v_centro := privado.centro_de_nino(p_sujeto_id);
    IF v_centro IS NULL THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_admin := privado.es_responsable(v_centro);
    IF NOT v_admin AND NOT public.es_tutor_legal_de(p_sujeto_id) THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN jsonb_build_object(
      -- Su prospecto entero.
      'lista_espera', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'nombre_nino', le.nombre_nino, 'apellidos_nino', le.apellidos_nino,
                 'fecha_nacimiento', le.fecha_nacimiento, 'telefono_tutor', le.telefono_tutor,
                 'email_tutor', le.email_tutor, 'nota', le.nota, 'posicion', le.posicion,
                 'estado', le.estado, 'curso', ca.nombre, 'apuntado_en', le.created_at)
               ORDER BY le.created_at)
          FROM public.lista_espera le
          LEFT JOIN public.cursos_academicos ca ON ca.id = le.curso_academico_id
         WHERE le.nino_id = p_sujeto_id), '[]'::jsonb),

      -- Sin motivo_baja. La familia, solo activa/baja (como get_recorrido_nino_familia).
      'matriculas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', m.id, 'aula', a.nombre, 'curso', ca.nombre, 'estado', m.estado,
                 'fecha_alta', m.fecha_alta, 'fecha_baja', m.fecha_baja,
                 'activada_en', m.activada_at)
               ORDER BY ca.fecha_inicio, m.fecha_alta, m.id)
          FROM public.matriculas m
          JOIN public.aulas a ON a.id = m.aula_id
          JOIN public.cursos_academicos ca ON ca.id = m.curso_academico_id
         WHERE m.nino_id = p_sujeto_id AND m.deleted_at IS NULL
           AND (v_admin OR m.estado IN ('activa', 'baja'))), '[]'::jsonb),

      -- Por sujeto, no por quién firmó: sale también el que dio el otro tutor.
      'consentimientos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'tipo', c.tipo, 'version_texto', c.version, 'aceptado_en', c.aceptado_en,
                 'revocado_en', c.revocado_en, 'metodo_firma', c.metodo_firma,
                 'otorgado_por', u.nombre_completo)
               ORDER BY c.aceptado_en)
          FROM public.consentimientos c
          LEFT JOIN public.usuarios u ON u.id = c.usuario_id
         WHERE c.nino_id = p_sujeto_id), '[]'::jsonb),

      'acuses_alta', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'tipo', aa.tipo, 'metodo', aa.metodo, 'aceptado_en', aa.aceptado_en)
               ORDER BY aa.aceptado_en)
          FROM public.acuses_alta aa
         WHERE aa.nino_id = p_sujeto_id), '[]'::jsonb),

      'cambios_solicitados', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'entidad', cp.entidad, 'campo', cp.campo,
                 'valor_propuesto', cp.valor_propuesto, 'detalle', cp.payload,
                 'estado', cp.estado, 'solicitado_en', cp.created_at,
                 'decidido_en', cp.decided_at)
               ORDER BY cp.created_at)
          FROM public.cambios_pendientes cp
         WHERE cp.nino_id = p_sujeto_id), '[]'::jsonb),

      'fin_de_curso', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('curso', ca.nombre, 'registrado_en', rf.created_at)
               ORDER BY rf.created_at)
          FROM public.rollover_finaliza rf
          JOIN public.cursos_academicos ca ON ca.id = rf.curso_academico_id
         WHERE rf.nino_id = p_sujeto_id), '[]'::jsonb),

      'citas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'titulo', ci.titulo, 'tipo', ci.tipo, 'fecha', ci.fecha,
                 'hora_inicio', ci.hora_inicio, 'hora_fin', ci.hora_fin, 'lugar', ci.lugar,
                 'descripcion', ci.descripcion, 'estado', ci.estado)
               ORDER BY ci.fecha, ci.hora_inicio)
          FROM public.citas ci
         WHERE ci.nino_id = p_sujeto_id), '[]'::jsonb),

      'eventos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'titulo', e.titulo, 'tipo', e.tipo, 'fecha', e.fecha, 'fecha_fin', e.fecha_fin,
                 'hora_inicio', e.hora_inicio, 'hora_fin', e.hora_fin, 'lugar', e.lugar,
                 'descripcion', e.descripcion, 'estado', e.estado)
               ORDER BY e.fecha, e.hora_inicio)
          FROM public.eventos e
         WHERE e.nino_id = p_sujeto_id), '[]'::jsonb),

      'confirmaciones_eventos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'evento', e.titulo, 'fecha_evento', e.fecha, 'estado', ce.estado,
                 'comentario', ce.comentario, 'confirmado_at', ce.confirmado_at)
               ORDER BY e.fecha)
          FROM public.confirmaciones_evento ce
          JOIN public.eventos e ON e.id = ce.evento_id
         WHERE ce.nino_id = p_sujeto_id), '[]'::jsonb),

      -- Los dirigidos a la familia sobre el niño; los del personal son trabajo del centro.
      'recordatorios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'titulo', r.titulo, 'descripcion', r.descripcion,
                 'vencimiento', r.vencimiento, 'completado_en', r.completado_en)
               ORDER BY r.created_at)
          FROM public.recordatorios r
         WHERE r.nino_id = p_sujeto_id AND r.destinatario = 'familia_individual'), '[]'::jsonb),

      'becas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'tipo_beca', tb.nombre, 'importe_centimos', b.importe_centimos,
                 'fecha_desde', b.fecha_desde, 'fecha_hasta', b.fecha_hasta)
               ORDER BY b.fecha_desde)
          FROM public.becas b
          JOIN public.tipos_beca tb ON tb.id = b.tipo_beca_id
         WHERE b.nino_id = p_sujeto_id AND b.deleted_at IS NULL), '[]'::jsonb),

      'conceptos_asignados', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'concepto', cc.nombre, 'cantidad', ac.cantidad_default,
                 'importe_especial_centimos', ac.importe_override_centimos,
                 'vigencia_desde', ac.vigencia_desde, 'vigencia_hasta', ac.vigencia_hasta)
               ORDER BY ac.created_at)
          FROM public.asignacion_concepto ac
          JOIN public.conceptos_cobro cc ON cc.id = ac.concepto_id
         WHERE ac.nino_id = p_sujeto_id AND ac.deleted_at IS NULL), '[]'::jsonb),

      'lineas_recibo', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'anio', r.anio, 'mes', r.mes, 'descripcion', lr.descripcion,
                 'cantidad', lr.cantidad, 'importe_centimos', lr.importe_centimos)
               ORDER BY r.anio, r.mes, lr.created_at)
          FROM public.lineas_recibo lr
          JOIN public.recibos r ON r.id = lr.recibo_id
         WHERE lr.nino_id = p_sujeto_id AND r.deleted_at IS NULL), '[]'::jsonb),

      'servicios_diarios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'fecha', ps.fecha, 'servicio', ps.servicio, 'presente', ps.presente)
               ORDER BY ps.fecha, ps.servicio)
          FROM public.parte_servicio_diario ps
         WHERE ps.nino_id = p_sujeto_id), '[]'::jsonb),

      'beca_comedor_elegibilidad', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'curso', ca.nombre, 'fecha_alta', be.fecha_alta,
                 'fecha_baja', be.fecha_baja, 'activa', be.activa)
               ORDER BY be.fecha_alta)
          FROM public.beca_comedor_elegibilidad be
          JOIN public.cursos_academicos ca ON ca.id = be.curso_academico_id
         WHERE be.nino_id = p_sujeto_id), '[]'::jsonb),

      'beca_comedor_tramos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'anio_correspondiente', bt.anio_correspondiente,
                 'mes_correspondiente', bt.mes_correspondiente,
                 'anio_aplicacion', bt.anio_aplicacion, 'mes_aplicacion', bt.mes_aplicacion,
                 'importe_centimos', bt.importe_centimos, 'estado', bt.estado,
                 'origen', bt.origen)
               ORDER BY bt.anio_correspondiente, bt.mes_correspondiente, bt.created_at)
          FROM public.beca_comedor_tramo bt
         WHERE bt.nino_id = p_sujeto_id), '[]'::jsonb)
    );
  END IF;

  RAISE EXCEPTION 'tipo de sujeto inválido: %', p_sujeto_tipo
    USING ERRCODE = 'invalid_parameter_value';
END
$function$;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_firma text;
  v_md5 text;
  v_esperado jsonb := jsonb_build_object(
    'public.audit_trigger_function()', '7f061564a8314ef5f7a9ae0a1083984f',
    'public.export_datos_sujeto(text,uuid)', 'c82938fd00de723556c04dab62dfc840',
    'public.recibos_validar_cobro_manual()', '315807670b8d28e09401fb048c43f8d4');
BEGIN
  FOR v_firma IN SELECT jsonb_object_keys(v_esperado) LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_firma);
    IF v_md5 IS DISTINCT FROM v_esperado ->> v_firma THEN
      RAISE EXCEPTION '% no quedó como este fichero: %', v_firma, coalesce(v_md5, 'falta');
    END IF;
    -- Las de trigger no se pueden llamar por RPC: conservan el EXECUTE que ya tenían.
    IF (SELECT prorettype FROM pg_proc WHERE oid = v_firma::regprocedure) <> 'trigger'::regtype
       AND (has_function_privilege('anon', v_firma::regprocedure, 'EXECUTE')
            OR has_function_privilege('public', v_firma::regprocedure, 'EXECUTE')) THEN
      RAISE EXCEPTION '% abierta a anon o a PUBLIC', v_firma;
    END IF;
  END LOOP;
  -- El export lo sigue llamando la app con sesión.
  IF NOT has_function_privilege('authenticated', 'public.export_datos_sujeto(text,uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'export_datos_sujeto ya no la puede ejecutar authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.recibos'::regclass AND tgname = 'recibos_validar_cobro_manual'
                    AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'falta el trigger recibos_validar_cobro_manual';
  END IF;
  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'public.recibos'::regclass
         AND conname IN ('recibos_cobro_manual_datos', 'recibos_cobro_forma_manual',
                         'recibos_cobro_nota_longitud', 'recibos_envio_banco_fecha')) <> 4 THEN
    RAISE EXCEPTION 'faltan CHECK del cobro manual';
  END IF;
  RAISE NOTICE 'guarda posterior: columnas, CHECK, trigger de la transición, auditoría y export';
END
$guarda$;
