-- =============================================================================
-- Auditoría (Grupo 1, PR B) — invitaciones auditada, audit_log.actor_sistema y el hueco de la
-- purga de usuario
-- -----------------------------------------------------------------------------
-- Estado en producción (2026-10-11, solo lectura): 61 tablas con el trigger de auditoría;
-- audit_trigger_function = la de 20261011120000 (md5 normalizado da2aaec0…); invitaciones sin
-- trigger; audit_log sin actor_sistema; purgar_sujeto_db = la de 20261002140000 (lógica
-- normalizada; difiere en bytes por los CRLF del SQL Editor) y purgar_esqueleto_huerfano_nino =
-- la de 20260620160000.
--
-- Principio: nada entra en audit_log que la redacción de la purga RGPD no sepa limpiar.
--
-- 1. Hueco de la purga de usuario. purgar_sujeto_db hacía UPDATE de mensajes (quita el nombre
--    del contenido) y de vinculos_familiares (descripcion_parentesco). Esos UPDATE escriben
--    filas de audit_log con el id del mensaje o del vínculo y sin actor, y la redacción solo
--    miraba registro_id = sujeto o usuario_id = sujeto: la purga dejaba en audit_log el dato
--    que borra (demostrado por grupo1b-audit en la BD efímera antes de esta corrección).
--    Ahora:
--      · el nombre se quita también del contenido de toda fila de auditoría de mensajes;
--      · la redacción del usuario alcanza las filas cuyo JSON lleva usuario_id = sujeto.
-- 2. invitaciones se audita (centro_id directo) SIN token. El email y el nombre sí entran, y
--    se redactan:
--      · al purgar un usuario: purgar-vencidos.ts marca antes con '[borrado]' el email y el
--        nombre de sus invitaciones; purgar_sujeto_db redacta las copias en audit_log de las
--        invitaciones marcadas;
--      · al purgar un esqueleto huérfano: sus invitaciones caen en cascada con el niño; la
--        función redacta sus copias (el invitado nunca tuvo cuenta).
-- 3. audit_log.actor_sistema (text, CHECK 'system:%'). El trigger solo lo rellena sin humano
--    (auth.uid() NULL): con la etiqueta de app.audit_actor si empieza por 'system:'; si no,
--    con 'system:service_role' cuando el rol es service_role. Las dos purgas fijan su
--    etiqueta con set_config(..., true) y la vacían al terminar.
--
-- Guardas (comparación normalizada en Postgres: sin \r, sin comentarios --, espacios
-- colapsados):
--   · entrada: las tres funciones vivas son las esperadas, 61 tablas auditadas, invitaciones
--     sin trigger, audit_log sin actor_sistema;
--   · salida: cada función nueva es exactamente la anterior con solo los cambios de este PR
--     (se reconstruye en Postgres aplicando los mismos fragmentos); SECURITY DEFINER,
--     search_path y permisos sin cambios; 62 tablas auditadas; actor_sistema con su CHECK.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor (cat del
-- fichero commiteado, md5 verificado). Tras aplicar: registrar en
-- supabase_migrations.schema_migrations.
-- =============================================================================

-- 0. Foto previa y guarda de entrada.
CREATE TEMP TABLE _prb_antes AS
SELECT v.f, p.prosrc, p.prosecdef, p.proconfig, p.proacl::text AS proacl
  FROM (VALUES ('audit', 'public.audit_trigger_function()'::regprocedure),
               ('purga', 'public.purgar_sujeto_db(uuid)'::regprocedure),
               ('esq',   'public.purgar_esqueleto_huerfano_nino(uuid,timestamptz)'::regprocedure)) v(f, oid)
  JOIN pg_proc p ON p.oid = v.oid;

DO $$
DECLARE
  f          text[] := '{}';
  r          record;
  v_n        int;
  v_esperado text;
BEGIN
  FOR r IN SELECT a.f, md5(regexp_replace(regexp_replace(replace(a.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) AS m FROM _prb_antes a LOOP
    -- El CASE va a una variable: dentro de IF ... THEN, plpgsql corta en el primer THEN.
    v_esperado := CASE r.f WHEN 'audit' THEN 'da2aaec0bf9175f99e40ef6d30c73f71'
                           WHEN 'purga' THEN '1e33a33ace1c2f02d1557a85adf203dd'
                           WHEN 'esq'   THEN '27e4c4a9ef0fa2926845c092ae79992b' END;
    IF r.m IS DISTINCT FROM v_esperado THEN
      f := f || format('%s no es la versión esperada (md5 normalizado %s)', r.f, r.m);
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM _prb_antes) <> 3 THEN f := f || 'faltan funciones'::text; END IF;
  SELECT count(DISTINCT tg.tgrelid) INTO v_n FROM pg_trigger tg
   WHERE tg.tgfoid = 'public.audit_trigger_function()'::regprocedure AND NOT tg.tgisinternal;
  IF v_n <> 61 THEN f := f || format('%s tablas auditadas (esperadas 61)', v_n); END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.invitaciones'::regclass
              AND tg.tgfoid = 'public.audit_trigger_function()'::regprocedure) THEN
    f := f || 'invitaciones ya tiene trigger de auditoría'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'audit_log' AND column_name = 'actor_sistema') THEN
    f := f || 'audit_log ya tiene actor_sistema'::text;
  END IF;
  IF cardinality(f) > 0 THEN
    RAISE EXCEPTION 'guarda de entrada: %', array_to_string(f, ' | ');
  END IF;
END $$;

-- 1. audit_log.actor_sistema.
ALTER TABLE public.audit_log ADD COLUMN actor_sistema text
  CONSTRAINT audit_log_actor_sistema_formato
  CHECK (actor_sistema IS NULL OR (actor_sistema LIKE 'system:%' AND char_length(actor_sistema) <= 100));

COMMENT ON COLUMN public.audit_log.actor_sistema IS
  'Actor no humano (system:<operacion>) cuando usuario_id es NULL. Lo rellena audit_trigger_function: app.audit_actor si empieza por system:, o system:service_role.';

-- 2. audit_trigger_function: la de 20261011120000 más invitaciones y actor_sistema.
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
  -- ── F-3-A: rollover_finaliza (centro_id directo) ─────────────────────────
  ELSIF TG_TABLE_NAME = 'rollover_finaliza' THEN
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
    v_centro_id := public.centro_de_nino(COALESCE((NEW).nino_id, (OLD).nino_id));
  ELSIF TG_TABLE_NAME IN ('comidas', 'biberones', 'suenos', 'deposiciones') THEN
    v_centro_id := public.centro_de_agenda(COALESCE((NEW).agenda_id, (OLD).agenda_id));
  END IF;

  -- ── Grupo 1 (PR A): tablas auditadas desde 20261011120000 ────────────────
  -- profes_aulas no tiene centro_id: se deriva del aula. Si el aula ya no está (DELETE en
  -- cascada al borrar el aula), del curso. usuarios no es de un centro: centro_id NULL.
  IF TG_TABLE_NAME = 'profes_aulas' THEN
    v_centro_id := COALESCE(
      public.centro_de_aula(COALESCE((NEW).aula_id, (OLD).aula_id)),
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

-- 3. invitaciones se audita.
CREATE TRIGGER audit_invitaciones
  AFTER INSERT OR DELETE OR UPDATE ON public.invitaciones
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

-- 4. purgar_sujeto_db: la de 20261002140000 más el hueco, las invitaciones y su etiqueta.
CREATE OR REPLACE FUNCTION public.purgar_sujeto_db(p_solicitud_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s        public.olvido_solicitudes%ROWTYPE;
  v_nombre text;
  k_nino  text[] := ARRAY['nombre','apellidos','fecha_nacimiento','sexo','nacionalidad',
                          'foto_url','notas_admin'];
  k_med   text[] := ARRAY['alergias_graves','notas_emergencia','medicacion_habitual',
                          'alergias_leves','medico_familia','telefono_emergencia'];
  k_user  text[] := ARRAY['nombre_completo'];
  k_extra text[] := ARRAY['ip_address','user_agent','descripcion_parentesco',
                          'nombre_externo','observaciones','observaciones_generales',
                          'contenido','nombre_tecleado'];
BEGIN
  -- [CRIT-ANON] Sin uid solo entra el servicio: service_role o sesión directa sin JWT
  -- (SQL Editor / psql). anon, o un JWT sin sub, ya no se cuela por la rama "uid NULL". Patrón #284.
  IF auth.uid() IS NULL
     AND NOT (COALESCE(auth.role(), '') = 'service_role'
              OR (session_user <> 'authenticator'
                  AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                  AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
    RAISE EXCEPTION 'no autorizado: sin sesión solo el servicio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- [/CRIT-ANON]
  SELECT * INTO s FROM public.olvido_solicitudes WHERE id = p_solicitud_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'solicitud de olvido no encontrada: %', p_solicitud_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.es_admin(s.centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF s.purgado_en IS NOT NULL THEN
    RETURN;
  END IF;

  -- Grupo 1 (PR B): las filas de auditoría que escribe la purga llevan su etiqueta.
  PERFORM set_config('app.audit_actor', 'system:purgar_sujeto_db', true);

  IF s.sujeto_tipo = 'nino' THEN
    -- D-5: motivo 'purga_rgpd' → desarchivar_nino RAISE (no reincorpora un sujeto purgado).
    UPDATE public.ninos SET
      nombre           = '[borrado]',
      apellidos        = '[borrado]',
      fecha_nacimiento = DATE '1900-01-01',
      sexo             = NULL,
      nacionalidad     = NULL,
      foto_url         = NULL,
      notas_admin      = NULL,
      deleted_reason   = 'purga_rgpd',
      deleted_at       = COALESCE(deleted_at, now())
    WHERE id = s.sujeto_id;

    UPDATE public.info_medica_emergencia SET
      alergias_graves     = NULL,
      notas_emergencia    = NULL,
      medicacion_habitual = NULL,
      alergias_leves      = NULL,
      medico_familia      = NULL,
      telefono_emergencia = NULL
    WHERE nino_id = s.sujeto_id;

    UPDATE public.datos_pedagogicos_nino SET
      lactancia_observaciones          = NULL,
      control_esfinteres_observaciones = NULL,
      siesta_horario_habitual          = NULL,
      siesta_observaciones             = NULL,
      alimentacion_observaciones       = CASE WHEN tipo_alimentacion = 'otra'
                                              THEN '[borrado]' ELSE NULL END,
      deleted_at                       = COALESCE(deleted_at, now())
    WHERE nino_id = s.sujeto_id;

    -- D-5: motivo 'purga_rgpd' → desarchivar_nino NUNCA revive un vínculo purgado.
    UPDATE public.vinculos_familiares SET
      descripcion_parentesco = NULL,
      deleted_reason         = 'purga_rgpd',
      deleted_at             = COALESCE(deleted_at, now())
    WHERE nino_id = s.sujeto_id;

    DELETE FROM public.media m
    WHERE EXISTS (
            SELECT 1 FROM public.media_etiquetas e
            WHERE e.media_id = m.id AND e.nino_id = s.sujeto_id)
      AND NOT EXISTS (
            SELECT 1 FROM public.media_etiquetas e2
            WHERE e2.media_id = m.id AND e2.nino_id <> s.sujeto_id);
    DELETE FROM public.media_etiquetas WHERE nino_id = s.sujeto_id;

    UPDATE public.audit_log SET
      valores_antes   = public._redactar_jsonb(valores_antes,   k_nino || k_med || k_extra),
      valores_despues = public._redactar_jsonb(valores_despues, k_nino || k_med || k_extra)
    WHERE registro_id = s.sujeto_id
       OR (valores_antes->>'nino_id'   = s.sujeto_id::text)
       OR (valores_despues->>'nino_id' = s.sujeto_id::text);

  ELSE  -- usuario
    SELECT nombre_completo INTO v_nombre FROM public.usuarios WHERE id = s.sujeto_id;

    IF v_nombre IS NOT NULL AND length(trim(v_nombre)) > 0 THEN
      UPDATE public.mensajes
        SET contenido = replace(contenido, v_nombre, '[borrado]')
        WHERE contenido LIKE '%' || v_nombre || '%';

      -- Grupo 1 (PR B): el nombre tampoco se queda en la auditoría de los mensajes: ni en la
      -- fila que acaba de escribir el UPDATE de arriba ni en las anteriores, de cualquier autor.
      UPDATE public.audit_log SET
        valores_antes = CASE WHEN strpos(valores_antes->>'contenido', v_nombre) > 0
          THEN jsonb_set(valores_antes, '{contenido}',
                         to_jsonb(replace(valores_antes->>'contenido', v_nombre, '[borrado]')))
          ELSE valores_antes END,
        valores_despues = CASE WHEN strpos(valores_despues->>'contenido', v_nombre) > 0
          THEN jsonb_set(valores_despues, '{contenido}',
                         to_jsonb(replace(valores_despues->>'contenido', v_nombre, '[borrado]')))
          ELSE valores_despues END
      WHERE tabla = 'mensajes'
        AND (strpos(valores_antes->>'contenido', v_nombre) > 0
             OR strpos(valores_despues->>'contenido', v_nombre) > 0);
    END IF;

    UPDATE public.usuarios SET
      nombre_completo = '[borrado]',
      deleted_at      = COALESCE(deleted_at, now())
    WHERE id = s.sujeto_id;

    UPDATE public.consentimientos SET ip_address = NULL, user_agent = NULL
      WHERE usuario_id = s.sujeto_id;
    DELETE FROM public.push_subscriptions WHERE usuario_id = s.sujeto_id;

    -- D-5: motivo 'purga_rgpd' → la reactivación de familia NUNCA revive estas filas.
    UPDATE public.roles_usuario SET
      deleted_reason = 'purga_rgpd',
      deleted_at     = COALESCE(deleted_at, now())
      WHERE usuario_id = s.sujeto_id;
    UPDATE public.vinculos_familiares SET
      descripcion_parentesco = NULL,
      deleted_reason         = 'purga_rgpd',
      deleted_at             = COALESCE(deleted_at, now())
    WHERE usuario_id = s.sujeto_id;

    UPDATE public.audit_log SET
      valores_antes   = public._redactar_jsonb(valores_antes,   k_user || k_extra),
      valores_despues = public._redactar_jsonb(valores_despues, k_user || k_extra)
    WHERE registro_id = s.sujeto_id OR usuario_id = s.sujeto_id
       -- Grupo 1 (PR B): también las filas que LLEVAN al sujeto (vínculos, roles…), como su
       -- vínculo con descripcion_parentesco, escritas por otros o por esta misma purga.
       OR valores_antes->>'usuario_id'   = s.sujeto_id::text
       OR valores_despues->>'usuario_id' = s.sujeto_id::text;

    -- Grupo 1 (PR B): invitaciones. El paso 4 de la purga (purgar-vencidos.ts) ya marcó con
    -- '[borrado]' el email y el nombre de sus invitaciones; aquí se redactan sus copias en
    -- audit_log (la fila de ese UPDATE y las anteriores). Idempotente.
    UPDATE public.audit_log SET
      valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY['email', 'nombre_completo']),
      valores_despues = public._redactar_jsonb(valores_despues, ARRAY['email', 'nombre_completo'])
    WHERE tabla = 'invitaciones'
      AND registro_id IN (SELECT i.id FROM public.invitaciones i WHERE i.email = '[borrado]');
  END IF;

  UPDATE public.olvido_solicitudes SET purgado_en = now() WHERE id = p_solicitud_id;
  PERFORM set_config('app.audit_actor', '', true);
END $function$;

-- 5. purgar_esqueleto_huerfano_nino: la de 20260620160000 más su etiqueta y la redacción de
--    las invitaciones que caen en cascada.
CREATE OR REPLACE FUNCTION public.purgar_esqueleto_huerfano_nino(
  p_nino_id uuid,
  p_cutoff  timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ok        boolean;
  v_actividad boolean;
BEGIN
  -- Re-validación autoritativa del predicado (TOCTOU: el estado pudo cambiar
  -- entre listar() y limpiarDb() — p. ej. el tutor acaba de aceptar).
  SELECT
        EXISTS (SELECT 1 FROM matriculas m WHERE m.nino_id = p_nino_id
                  AND m.estado = 'pendiente' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM vinculos_familiares v WHERE v.nino_id = p_nino_id
                  AND v.deleted_at IS NULL)
    AND EXISTS (SELECT 1 FROM invitaciones i WHERE i.nino_id = p_nino_id
                  AND i.accepted_at IS NULL AND i.rejected_at IS NULL AND i.expires_at < p_cutoff)
    AND NOT EXISTS (SELECT 1 FROM invitaciones i WHERE i.nino_id = p_nino_id
                  AND i.accepted_at IS NULL AND i.rejected_at IS NULL AND i.expires_at >= p_cutoff)
    INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'no es esqueleto huerfano (predicado no se cumple)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Backstop: si el niño tiene CUALQUIER actividad real, abortar (rollback atómico).
  -- Un huérfano real no tiene nada de esto (verificado en la BD).
  SELECT
        EXISTS (SELECT 1 FROM asistencias WHERE nino_id = p_nino_id)
     OR EXISTS (SELECT 1 FROM ausencias WHERE nino_id = p_nino_id)
     OR EXISTS (SELECT 1 FROM agendas_diarias WHERE nino_id = p_nino_id)
     OR EXISTS (SELECT 1 FROM conversaciones WHERE nino_id = p_nino_id)
     OR EXISTS (SELECT 1 FROM administraciones_medicacion WHERE nino_id = p_nino_id)
     OR EXISTS (SELECT 1 FROM informes_evolucion WHERE nino_id = p_nino_id)
    INTO v_actividad;

  IF v_actividad THEN
    RAISE EXCEPTION 'el nino tiene actividad real; huerfano abortado'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Borrado FK-safe (atómico). Primero los RESTRICT 1:1, luego matrícula, luego
  -- el niño (CASCADE: vinculos, invitaciones, autorizaciones, firmas, media_etiquetas).
  -- Grupo 1 (PR B): las filas de auditoría que escribe la purga llevan su etiqueta.
  PERFORM set_config('app.audit_actor', 'system:purgar_esqueleto_huerfano_nino', true);

  DELETE FROM info_medica_emergencia WHERE nino_id = p_nino_id;
  DELETE FROM datos_pedagogicos_nino WHERE nino_id = p_nino_id;
  DELETE FROM matriculas            WHERE nino_id = p_nino_id;
  DELETE FROM ninos                 WHERE id      = p_nino_id;

  -- Grupo 1 (PR B): las invitaciones del niño se han borrado en cascada. Sus copias en
  -- audit_log (alta, cambios y este DELETE) no conservan el email ni el nombre del invitado,
  -- que nunca llegó a tener cuenta y al que ninguna purga de usuario alcanzará.
  UPDATE public.audit_log SET
    valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY['email', 'nombre_completo']),
    valores_despues = public._redactar_jsonb(valores_despues, ARRAY['email', 'nombre_completo'])
  WHERE tabla = 'invitaciones'
    AND (valores_antes->>'nino_id' = p_nino_id::text OR valores_despues->>'nino_id' = p_nino_id::text);

  PERFORM set_config('app.audit_actor', '', true);
END;
$function$;

-- 6. Guarda de salida.
DO $guarda$
DECLARE
  f          text[] := '{}';
  v_old      text;
  v_new      text;
  v_exp      text;
  v_secdef0  boolean;
  v_secdef   boolean;
  v_config0  text[];
  v_config   text[];
  v_acl0     text;
  v_acl      text;
  v_n        int;
BEGIN
  -- audit: la nueva = la anterior con solo los cambios de este PR.
  SELECT regexp_replace(regexp_replace(replace(a.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'), a.prosecdef, a.proconfig, a.proacl INTO v_old, v_secdef0, v_config0, v_acl0
    FROM _prb_antes a WHERE a.f = 'audit';
  IF position(btrim(regexp_replace(regexp_replace(replace('  v_antes   := CASE WHEN TG_OP IN (''UPDATE'',''DELETE'') THEN to_jsonb(OLD) END;', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) IN v_old) = 0 THEN f := f || 'audit: no encuentro el fragmento 1 en la versión anterior'::text; END IF;
  IF position(btrim(regexp_replace(regexp_replace(replace('  INSERT INTO public.audit_log
    (tabla, registro_id, accion, usuario_id, valores_antes, valores_despues, centro_id)
  VALUES
    (TG_TABLE_NAME, v_registro_id, TG_OP::public.audit_accion, auth.uid(), v_antes, v_despues, v_centro_id);', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) IN v_old) = 0 THEN f := f || 'audit: no encuentro el fragmento 2 en la versión anterior'::text; END IF;
  SELECT regexp_replace(regexp_replace(replace(p.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'), p.prosecdef, p.proconfig, p.proacl::text INTO v_new, v_secdef, v_config, v_acl
    FROM pg_proc p WHERE p.oid = 'public.audit_trigger_function()'::regprocedure;
  v_exp := replace(replace(v_old,
      btrim(regexp_replace(regexp_replace(replace('  v_antes   := CASE WHEN TG_OP IN (''UPDATE'',''DELETE'') THEN to_jsonb(OLD) END;', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')),
      btrim(regexp_replace(regexp_replace(replace('  -- ── Grupo 1 (PR B): invitaciones (centro_id directo) ─────────────────────
  IF TG_TABLE_NAME = ''invitaciones'' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  END IF;

  v_antes   := CASE WHEN TG_OP IN (''UPDATE'',''DELETE'') THEN to_jsonb(OLD) END;', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))),
      btrim(regexp_replace(regexp_replace(replace('  INSERT INTO public.audit_log
    (tabla, registro_id, accion, usuario_id, valores_antes, valores_despues, centro_id)
  VALUES
    (TG_TABLE_NAME, v_registro_id, TG_OP::public.audit_accion, auth.uid(), v_antes, v_despues, v_centro_id);', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')),
      btrim(regexp_replace(regexp_replace(replace('  -- ── Grupo 1 (PR B): invitaciones sin token ───────────────────────────────
  IF TG_TABLE_NAME = ''invitaciones'' THEN
    v_antes   := v_antes   - ''token'';
    v_despues := v_despues - ''token'';
  END IF;

  -- ── Grupo 1 (PR B): actor_sistema ────────────────────────────────────────
  -- Solo sin humano (auth.uid() NULL): la etiqueta de app.audit_actor si empieza por
  -- ''system:'' (la fijan las purgas con set_config(..., true)); si no la hay y el rol es
  -- service_role, ''system:service_role''. Con sesión humana nunca se rellena.
  INSERT INTO public.audit_log
    (tabla, registro_id, accion, usuario_id, valores_antes, valores_despues, centro_id, actor_sistema)
  VALUES
    (TG_TABLE_NAME, v_registro_id, TG_OP::public.audit_accion, auth.uid(), v_antes, v_despues, v_centro_id,
     CASE WHEN auth.uid() IS NULL THEN
       CASE
         WHEN current_setting(''app.audit_actor'', true) LIKE ''system:%''
              AND char_length(current_setting(''app.audit_actor'', true)) <= 100
           THEN current_setting(''app.audit_actor'', true)
         WHEN auth.role() = ''service_role'' THEN ''system:service_role''
       END
     END);', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')));
  IF md5(v_new) IS DISTINCT FROM md5(v_exp) THEN
    f := f || 'audit: la función nueva no es la anterior con solo los cambios de este PR'::text;
  END IF;
  IF v_secdef IS DISTINCT FROM v_secdef0 OR v_config IS DISTINCT FROM v_config0 OR v_acl IS DISTINCT FROM v_acl0 THEN
    f := f || format('audit: cambió SECURITY DEFINER, search_path o permisos (%s %s %s)', v_secdef, v_config, v_acl);
  END IF;
  -- purga: la nueva = la anterior con solo los cambios de este PR.
  SELECT regexp_replace(regexp_replace(replace(a.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'), a.prosecdef, a.proconfig, a.proacl INTO v_old, v_secdef0, v_config0, v_acl0
    FROM _prb_antes a WHERE a.f = 'purga';
  IF position(btrim(regexp_replace(regexp_replace(replace('  IF s.sujeto_tipo = ''nino'' THEN', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) IN v_old) = 0 THEN f := f || 'purga: no encuentro el fragmento 1 en la versión anterior'::text; END IF;
  IF position(btrim(regexp_replace(regexp_replace(replace('      UPDATE public.mensajes
        SET contenido = replace(contenido, v_nombre, ''[borrado]'')
        WHERE contenido LIKE ''%'' || v_nombre || ''%'';
    END IF;', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) IN v_old) = 0 THEN f := f || 'purga: no encuentro el fragmento 2 en la versión anterior'::text; END IF;
  IF position(btrim(regexp_replace(regexp_replace(replace('    WHERE registro_id = s.sujeto_id OR usuario_id = s.sujeto_id;
  END IF;', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) IN v_old) = 0 THEN f := f || 'purga: no encuentro el fragmento 3 en la versión anterior'::text; END IF;
  IF position(btrim(regexp_replace(regexp_replace(replace('  UPDATE public.olvido_solicitudes SET purgado_en = now() WHERE id = p_solicitud_id;', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) IN v_old) = 0 THEN f := f || 'purga: no encuentro el fragmento 4 en la versión anterior'::text; END IF;
  SELECT regexp_replace(regexp_replace(replace(p.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'), p.prosecdef, p.proconfig, p.proacl::text INTO v_new, v_secdef, v_config, v_acl
    FROM pg_proc p WHERE p.oid = 'public.purgar_sujeto_db(uuid)'::regprocedure;
  v_exp := replace(replace(replace(replace(v_old,
      btrim(regexp_replace(regexp_replace(replace('  IF s.sujeto_tipo = ''nino'' THEN', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')),
      btrim(regexp_replace(regexp_replace(replace('  -- Grupo 1 (PR B): las filas de auditoría que escribe la purga llevan su etiqueta.
  PERFORM set_config(''app.audit_actor'', ''system:purgar_sujeto_db'', true);

  IF s.sujeto_tipo = ''nino'' THEN', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))),
      btrim(regexp_replace(regexp_replace(replace('      UPDATE public.mensajes
        SET contenido = replace(contenido, v_nombre, ''[borrado]'')
        WHERE contenido LIKE ''%'' || v_nombre || ''%'';
    END IF;', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')),
      btrim(regexp_replace(regexp_replace(replace('      UPDATE public.mensajes
        SET contenido = replace(contenido, v_nombre, ''[borrado]'')
        WHERE contenido LIKE ''%'' || v_nombre || ''%'';

      -- Grupo 1 (PR B): el nombre tampoco se queda en la auditoría de los mensajes: ni en la
      -- fila que acaba de escribir el UPDATE de arriba ni en las anteriores, de cualquier autor.
      UPDATE public.audit_log SET
        valores_antes = CASE WHEN strpos(valores_antes->>''contenido'', v_nombre) > 0
          THEN jsonb_set(valores_antes, ''{contenido}'',
                         to_jsonb(replace(valores_antes->>''contenido'', v_nombre, ''[borrado]'')))
          ELSE valores_antes END,
        valores_despues = CASE WHEN strpos(valores_despues->>''contenido'', v_nombre) > 0
          THEN jsonb_set(valores_despues, ''{contenido}'',
                         to_jsonb(replace(valores_despues->>''contenido'', v_nombre, ''[borrado]'')))
          ELSE valores_despues END
      WHERE tabla = ''mensajes''
        AND (strpos(valores_antes->>''contenido'', v_nombre) > 0
             OR strpos(valores_despues->>''contenido'', v_nombre) > 0);
    END IF;', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))),
      btrim(regexp_replace(regexp_replace(replace('    WHERE registro_id = s.sujeto_id OR usuario_id = s.sujeto_id;
  END IF;', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')),
      btrim(regexp_replace(regexp_replace(replace('    WHERE registro_id = s.sujeto_id OR usuario_id = s.sujeto_id
       -- Grupo 1 (PR B): también las filas que LLEVAN al sujeto (vínculos, roles…), como su
       -- vínculo con descripcion_parentesco, escritas por otros o por esta misma purga.
       OR valores_antes->>''usuario_id''   = s.sujeto_id::text
       OR valores_despues->>''usuario_id'' = s.sujeto_id::text;

    -- Grupo 1 (PR B): invitaciones. El paso 4 de la purga (purgar-vencidos.ts) ya marcó con
    -- ''[borrado]'' el email y el nombre de sus invitaciones; aquí se redactan sus copias en
    -- audit_log (la fila de ese UPDATE y las anteriores). Idempotente.
    UPDATE public.audit_log SET
      valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY[''email'', ''nombre_completo'']),
      valores_despues = public._redactar_jsonb(valores_despues, ARRAY[''email'', ''nombre_completo''])
    WHERE tabla = ''invitaciones''
      AND registro_id IN (SELECT i.id FROM public.invitaciones i WHERE i.email = ''[borrado]'');
  END IF;', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))),
      btrim(regexp_replace(regexp_replace(replace('  UPDATE public.olvido_solicitudes SET purgado_en = now() WHERE id = p_solicitud_id;', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')),
      btrim(regexp_replace(regexp_replace(replace('  UPDATE public.olvido_solicitudes SET purgado_en = now() WHERE id = p_solicitud_id;
  PERFORM set_config(''app.audit_actor'', '''', true);', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')));
  IF md5(v_new) IS DISTINCT FROM md5(v_exp) THEN
    f := f || 'purga: la función nueva no es la anterior con solo los cambios de este PR'::text;
  END IF;
  IF v_secdef IS DISTINCT FROM v_secdef0 OR v_config IS DISTINCT FROM v_config0 OR v_acl IS DISTINCT FROM v_acl0 THEN
    f := f || format('purga: cambió SECURITY DEFINER, search_path o permisos (%s %s %s)', v_secdef, v_config, v_acl);
  END IF;
  -- esq: la nueva = la anterior con solo los cambios de este PR.
  SELECT regexp_replace(regexp_replace(replace(a.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'), a.prosecdef, a.proconfig, a.proacl INTO v_old, v_secdef0, v_config0, v_acl0
    FROM _prb_antes a WHERE a.f = 'esq';
  IF position(btrim(regexp_replace(regexp_replace(replace('  DELETE FROM info_medica_emergencia WHERE nino_id = p_nino_id;', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) IN v_old) = 0 THEN f := f || 'esq: no encuentro el fragmento 1 en la versión anterior'::text; END IF;
  IF position(btrim(regexp_replace(regexp_replace(replace('  DELETE FROM ninos                 WHERE id      = p_nino_id;', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) IN v_old) = 0 THEN f := f || 'esq: no encuentro el fragmento 2 en la versión anterior'::text; END IF;
  SELECT regexp_replace(regexp_replace(replace(p.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'), p.prosecdef, p.proconfig, p.proacl::text INTO v_new, v_secdef, v_config, v_acl
    FROM pg_proc p WHERE p.oid = 'public.purgar_esqueleto_huerfano_nino(uuid,timestamptz)'::regprocedure;
  v_exp := replace(replace(v_old,
      btrim(regexp_replace(regexp_replace(replace('  DELETE FROM info_medica_emergencia WHERE nino_id = p_nino_id;', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')),
      btrim(regexp_replace(regexp_replace(replace('  -- Grupo 1 (PR B): las filas de auditoría que escribe la purga llevan su etiqueta.
  PERFORM set_config(''app.audit_actor'', ''system:purgar_esqueleto_huerfano_nino'', true);

  DELETE FROM info_medica_emergencia WHERE nino_id = p_nino_id;', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))),
      btrim(regexp_replace(regexp_replace(replace('  DELETE FROM ninos                 WHERE id      = p_nino_id;', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')),
      btrim(regexp_replace(regexp_replace(replace('  DELETE FROM ninos                 WHERE id      = p_nino_id;

  -- Grupo 1 (PR B): las invitaciones del niño se han borrado en cascada. Sus copias en
  -- audit_log (alta, cambios y este DELETE) no conservan el email ni el nombre del invitado,
  -- que nunca llegó a tener cuenta y al que ninguna purga de usuario alcanzará.
  UPDATE public.audit_log SET
    valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY[''email'', ''nombre_completo'']),
    valores_despues = public._redactar_jsonb(valores_despues, ARRAY[''email'', ''nombre_completo''])
  WHERE tabla = ''invitaciones''
    AND (valores_antes->>''nino_id'' = p_nino_id::text OR valores_despues->>''nino_id'' = p_nino_id::text);

  PERFORM set_config(''app.audit_actor'', '''', true);', chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')));
  IF md5(v_new) IS DISTINCT FROM md5(v_exp) THEN
    f := f || 'esq: la función nueva no es la anterior con solo los cambios de este PR'::text;
  END IF;
  IF v_secdef IS DISTINCT FROM v_secdef0 OR v_config IS DISTINCT FROM v_config0 OR v_acl IS DISTINCT FROM v_acl0 THEN
    f := f || format('esq: cambió SECURITY DEFINER, search_path o permisos (%s %s %s)', v_secdef, v_config, v_acl);
  END IF;

  SELECT count(DISTINCT tg.tgrelid) INTO v_n FROM pg_trigger tg
   WHERE tg.tgfoid = 'public.audit_trigger_function()'::regprocedure AND NOT tg.tgisinternal
     AND tg.tgenabled = 'O';
  IF v_n <> 62 THEN f := f || format('%s tablas auditadas (esperadas 62)', v_n); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.invitaciones'::regclass
                  AND tg.tgfoid = 'public.audit_trigger_function()'::regprocedure AND tg.tgenabled = 'O') THEN
    f := f || 'invitaciones sin trigger de auditoría'::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.conrelid = 'public.audit_log'::regclass
                    AND c.conname = 'audit_log_actor_sistema_formato' AND c.contype = 'c') THEN
    f := f || 'falta el CHECK de actor_sistema'::text;
  END IF;

  IF cardinality(f) > 0 THEN
    RAISE EXCEPTION 'guarda de salida: %', array_to_string(f, ' | ');
  END IF;
END $guarda$;

DROP TABLE _prb_antes;
