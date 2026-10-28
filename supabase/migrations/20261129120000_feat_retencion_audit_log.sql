-- =============================================================================
-- FEAT — Borrar sin dejar copia en audit_log, y audit_log a 5 años (F11-B, punto 6, PR-2)
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/retencion-plazos.md. Borrar una fila auditada deja en audit_log una copia
-- entera de cómo estaba (`valores_antes` del DELETE), y siguen ahí su alta y sus cambios. Un plazo
-- que vence en la tabla y no en audit_log no se cumple. Principio: nada vive más en audit_log que
-- en su tabla. Ahora:
--
--   · `audit_trigger_function`: con `app.borrar_sin_copia = 'on'` y sin humano, un DELETE borra
--     las copias de esa fila en audit_log y no escribe la suya. Las cascadas también pasan por el
--     trigger, así que se llevan las suyas sin enumerarlas.
--   · Lo usan los borrados del barrido de retención que tocan tablas auditadas:
--       - `purgar_esqueleto_huerfano_nino` (alta abandonada);
--       - `purgar_fotos_blog_nino` (nueva): las fotos del blog en las que el niño de baja es el
--         único etiquetado, y sus etiquetas. Antes eran dos DELETE desde la app con service_role,
--         que no pueden fijar el ajuste;
--       - `purgar_esqueleto_stub_db` (nueva): la fila de `usuarios` de una cuenta stub, antes de
--         borrarla de auth.users por la Admin API (la cascada desde auth.users no pasa por aquí).
--   · `purgar_audit_log` (nueva): el plazo provisional de 5 años de audit_log, para el cron.
--
-- El olvido (`purgar_sujeto_db`) sigue redactando: lo alcanza el PR-4.
--
-- `audit_trigger_function` y `purgar_esqueleto_huerfano_nino` se recrean desde el texto leído en
-- producción (md5 normalizado en la guarda).
--
-- La aplica el responsable por SQL Editor, DESPUÉS de `20261128120000`. Orden: mergear, esperar el
-- despliegue y aplicar después; el código nuevo llama a dos funciones que crea esta migración, y
-- hasta aplicarla esas dos fuentes del barrido fallan (se cuentan como fallidas y se reintentan).
-- Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF to_regprocedure('public.purgar_audit_log(integer,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'ya aplicada: existe purgar_audit_log';
  END IF;
  IF to_regclass('public.lecturas_ficha_medica') IS NULL THEN
    RAISE EXCEPTION 'falta 20261128120000: no existe lecturas_ficha_medica';
  END IF;

  -- Las dos funciones que se recrean tienen que ser las leídas en producción
  -- (md5 normalizado: sin \r, sin comentarios, espacios colapsados).
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.audit_trigger_function()');
  IF v_md5 IS DISTINCT FROM '7f061564a8314ef5f7a9ae0a1083984f' THEN
    RAISE EXCEPTION 'audit_trigger_function no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.purgar_esqueleto_huerfano_nino(uuid,timestamptz)');
  IF v_md5 IS DISTINCT FROM '3f3835996b963099dbbb04522ce8762b' THEN
    RAISE EXCEPTION 'purgar_esqueleto_huerfano_nino no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;

  -- Nadie fija ya el ajuste nuevo.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname IN ('public', 'privado') AND p.prosrc LIKE '%app.borrar_sin_copia%') THEN
    RAISE EXCEPTION 'ya hay funciones que usan app.borrar_sin_copia';
  END IF;
END
$guarda$;

-- ---- 1. El trigger de auditoría: borrar sin dejar copia ----
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

  -- ── Retención (F11-B, punto 6): nada vive más en audit_log que en su tabla ──
  -- Un borrado por plazo o por olvido se lleva sus copias en audit_log: las anteriores (alta y
  -- cambios) y la que escribiría este DELETE. Lo pide la purga con
  -- set_config('app.borrar_sin_copia', 'on', true), y solo vale sin humano (auth.uid() NULL):
  -- con sesión, el DELETE se audita siempre. Las cascadas pasan por aquí fila a fila, así que
  -- también se llevan las suyas.
  IF TG_OP = 'DELETE' AND auth.uid() IS NULL
     AND current_setting('app.borrar_sin_copia', true) = 'si' THEN
    DELETE FROM public.audit_log WHERE tabla = TG_TABLE_NAME AND registro_id = v_registro_id;
    RETURN OLD;
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

-- ---- 2. El esqueleto huérfano del niño, sin copia ----
CREATE OR REPLACE FUNCTION public.purgar_esqueleto_huerfano_nino(p_nino_id uuid, p_cutoff timestamp with time zone)
 RETURNS void
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
  -- Retención (F11-B, punto 6): cada DELETE, también los de la cascada, se lleva sus copias en
  -- audit_log (app.borrar_sin_copia, en audit_trigger_function).
  PERFORM set_config('app.audit_actor', 'system:purgar_esqueleto_huerfano_nino', true);
  PERFORM set_config('app.borrar_sin_copia', 'on', true);

  DELETE FROM info_medica_emergencia WHERE nino_id = p_nino_id;
  DELETE FROM datos_pedagogicos_nino WHERE nino_id = p_nino_id;
  DELETE FROM matriculas            WHERE nino_id = p_nino_id;
  DELETE FROM ninos                 WHERE id      = p_nino_id;

  -- Lo que queda en audit_log del niño son filas de otras tablas que lo nombran y no se han
  -- borrado aquí. Se redactan con la lista de claves que comparte con purgar_sujeto_db.
  PERFORM public._redactar_auditoria_nino(p_nino_id);

  -- Grupo 1 (PR B): las invitaciones que caen ahora en cascada ya se han llevado sus copias.
  -- Quedan las de invitaciones del niño borradas antes (su DELETE se auditó entero): no
  -- conservan el email ni el nombre del invitado, que nunca llegó a tener cuenta y al que
  -- ninguna purga de usuario alcanzará.
  UPDATE public.audit_log SET
    valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY['email', 'nombre_completo']),
    valores_despues = public._redactar_jsonb(valores_despues, ARRAY['email', 'nombre_completo'])
  WHERE tabla = 'invitaciones'
    AND (valores_antes->>'nino_id' = p_nino_id::text OR valores_despues->>'nino_id' = p_nino_id::text);

  PERFORM set_config('app.borrar_sin_copia', '', true);
  PERFORM set_config('app.audit_actor', '', true);
END;
$function$;

-- ---- 3. Las fotos del blog de un niño vencido, sin copia ----
-- Lo que hacía `limpiarDb` de la fuente `foto-blog-exclusiva` con dos DELETE: las fotos en las que
-- el niño es el único etiquetado (sus etiquetas caen en cascada) y su etiqueta en las compartidas.
-- Una etiqueta sin niño cuenta como de otro (`IS DISTINCT FROM`), igual que en la app.
CREATE FUNCTION public.purgar_fotos_blog_nino(p_nino_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF p_nino_id IS NULL THEN
    RAISE EXCEPTION 'falta el niño' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM set_config('app.audit_actor', 'system:purgar_fotos_blog_nino', true);
  PERFORM set_config('app.borrar_sin_copia', 'on', true);

  DELETE FROM public.media m
   WHERE EXISTS (SELECT 1 FROM public.media_etiquetas e
                  WHERE e.media_id = m.id AND e.nino_id = p_nino_id)
     AND NOT EXISTS (SELECT 1 FROM public.media_etiquetas e
                      WHERE e.media_id = m.id AND e.nino_id IS DISTINCT FROM p_nino_id);
  DELETE FROM public.media_etiquetas WHERE nino_id = p_nino_id;

  PERFORM set_config('app.borrar_sin_copia', '', true);
  PERFORM set_config('app.audit_actor', '', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.purgar_fotos_blog_nino(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purgar_fotos_blog_nino(uuid) TO service_role;

-- ---- 4. La cuenta stub huérfana, sin copia ----
-- La Admin API borra auth.users y la cascada a `usuarios` la hace otra conexión, sin el ajuste: la
-- copia del alta de `usuarios` (email y nombre) se quedaría. Se borra antes aquí, re-validando el
-- predicado; si la Admin API falla después, la siguiente pasada la reintenta (el predicado mira
-- auth.users).
CREATE FUNCTION public.purgar_esqueleto_stub_db(p_usuario_id uuid, p_cutoff timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT COALESCE(public.es_esqueleto_stub_purgable(p_usuario_id, p_cutoff), false) THEN
    RAISE EXCEPTION 'no es stub huerfano (predicado no se cumple)'
      USING ERRCODE = 'check_violation';
  END IF;
  PERFORM set_config('app.audit_actor', 'system:purgar_esqueleto_stub_db', true);
  PERFORM set_config('app.borrar_sin_copia', 'on', true);

  DELETE FROM public.usuarios WHERE id = p_usuario_id;

  PERFORM set_config('app.borrar_sin_copia', '', true);
  PERFORM set_config('app.audit_actor', '', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.purgar_esqueleto_stub_db(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purgar_esqueleto_stub_db(uuid, timestamptz) TO service_role;

-- ---- 5. audit_log a 5 años (plazo provisional, lo pasa el cron) ----
CREATE FUNCTION public.purgar_audit_log(p_anios integer, p_simular boolean)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_n integer;
BEGIN
  IF p_anios IS NULL OR p_anios < 1 OR p_simular IS NULL THEN
    RAISE EXCEPTION 'plazo de audit_log no válido' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_simular THEN
    SELECT count(*) INTO v_n FROM public.audit_log WHERE ts < now() - make_interval(years => p_anios);
  ELSE
    DELETE FROM public.audit_log WHERE ts < now() - make_interval(years => p_anios);
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.purgar_audit_log(integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purgar_audit_log(integer, boolean) TO service_role;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_md5 text;
  v_n   integer;
BEGIN
  IF has_function_privilege('authenticated', 'public.purgar_fotos_blog_nino(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.purgar_esqueleto_stub_db(uuid,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.purgar_audit_log(integer,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.purgar_esqueleto_huerfano_nino(uuid,timestamptz)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.purgar_fotos_blog_nino(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.purgar_esqueleto_stub_db(uuid,timestamptz)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.purgar_audit_log(integer,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.purgar_esqueleto_huerfano_nino(uuid,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'una purga quedó abierta a quien no toca';
  END IF;
  IF NOT (SELECT bool_and(prosecdef) FROM pg_proc
           WHERE oid IN ('public.audit_trigger_function()'::regprocedure,
                         'public.purgar_esqueleto_huerfano_nino(uuid,timestamptz)'::regprocedure,
                         'public.purgar_fotos_blog_nino(uuid)'::regprocedure,
                         'public.purgar_esqueleto_stub_db(uuid,timestamptz)'::regprocedure,
                         'public.purgar_audit_log(integer,boolean)'::regprocedure)) THEN
    RAISE EXCEPTION 'las funciones de la retención tienen que ser SECURITY DEFINER';
  END IF;

  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.audit_trigger_function()');
  IF v_md5 IS DISTINCT FROM '5375fe7bd25c8c0a2c553cf462fc1196' THEN
    RAISE EXCEPTION 'audit_trigger_function no quedó como este fichero: %', v_md5;
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.purgar_esqueleto_huerfano_nino(uuid,timestamptz)');
  IF v_md5 IS DISTINCT FROM '8f0bb351bd1d9025e982a8d643d6ec56' THEN
    RAISE EXCEPTION 'purgar_esqueleto_huerfano_nino no quedó como este fichero: %', v_md5;
  END IF;

  -- Los 60 triggers de auditoría siguen apuntando a la función.
  SELECT count(*) INTO v_n FROM pg_trigger t
   WHERE t.tgfoid = 'public.audit_trigger_function()'::regprocedure AND NOT t.tgisinternal;
  RAISE NOTICE 'guarda posterior: % triggers de auditoría; % filas de audit_log, % de más de 5 años',
    v_n, (SELECT count(*) FROM public.audit_log),
    (SELECT count(*) FROM public.audit_log WHERE ts < now() - interval '5 years');
END
$guarda$;
