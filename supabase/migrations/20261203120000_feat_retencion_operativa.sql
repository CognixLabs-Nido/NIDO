-- =============================================================================
-- FEAT — La operativa por tiempo: 1 año desde el final del curso (F11-B, punto 6, PR-5)
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/retencion-plazos.md (`RETENCION_OPERATIVA_ANIOS`, provisional). La operativa del
-- día a día no tenía plazo: se guardaba para siempre. Ahora cada registro se borra cuando ha pasado
-- el plazo desde el final del curso en que se escribió, con sus copias en audit_log (nada vive más
-- en audit_log que en su tabla). Un niño que sigue tres cursos no arrastra la agenda del primero.
--
-- «El curso en que se escribió»: el primero del centro (sin borrar) que termina en la fecha del
-- registro o después. Un registro de verano, entre dos cursos, cuenta con el siguiente; si el
-- centro aún no tiene un curso que termine después, no vence. La fecha del registro es la más
-- tardía de las suyas (la del día y la de alta), así nunca vence antes de tiempo:
--
--   · `agendas_diarias` (con sus cuatro tablas en cascada) y `asistencias`: su `fecha`;
--   · `ausencias`: su `fecha_fin` o su alta;
--   · `informes_evolucion`: el final de su curso o su última edición;
--   · `mensajes`: su alta (centro, el de la conversación);
--   · `conversaciones` (con `lectura_conversacion`): su alta, y solo sin mensajes que no hayan
--     vencido;
--   · `citas` (con `cita_invitados`): su `fecha` o su alta;
--   · `recordatorios`: su alta o su vencimiento;
--   · `confirmaciones_evento`: la fecha del evento o la de la respuesta.
--
-- También se borran las copias en audit_log de filas de esas tablas que ya no existen (las borró
-- alguien antes y su DELETE se auditó entero) cuando el curso de la copia ha vencido.
--
-- Ahora:
--
--   · `privado.curso_vencido(centro, fecha, años)`: el predicado del curso, en un solo sitio.
--   · `privado.operativa_vencida(tabla, años)` y `privado.operativa_copias_vencidas(años)`: lo que
--     vence, igual para la simulación y para el borrado.
--   · `purgar_operativa_vencida(años, simular)`, para el cron: cuenta o borra, por tabla. Sin
--     humano y con `app.borrar_sin_copia` (20261129120000).
--
-- La aplica el responsable por SQL Editor, DESPUÉS de `20261202120000`, que hace que el borrado sin
-- copia vaya por el índice (sin ella, el barrido de 59 niños tardaba 7 min 39 s en la efímera; con
-- ella, 3,3 s). Sin orden con el despliegue: el código nuevo solo llama a la función nueva desde
-- el cron, y si falla, el cron lo registra y sigue. Tras aplicar: registrar en
-- supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF to_regprocedure('public.purgar_operativa_vencida(integer,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'ya aplicada: existe purgar_operativa_vencida';
  END IF;
  IF to_regprocedure('privado.olvido_borrar_operativa_nino(uuid)') IS NULL THEN
    RAISE EXCEPTION 'falta 20261201120000: no existe privado.olvido_borrar_operativa_nino';
  END IF;

  -- El borrado sin copia depende del trigger, tal como lo dejó 20261202120000 (por el índice).
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.audit_trigger_function()');
  IF v_md5 IS DISTINCT FROM '22b915a1879ea8f203062cbed913e17e' THEN
    RAISE EXCEPTION 'audit_trigger_function no es la de 20261202120000: %', coalesce(v_md5, 'falta');
  END IF;

  RAISE NOTICE 'guarda previa: operativa viva: % agendas, % asistencias, % ausencias, % informes, % mensajes, % conversaciones, % citas, % recordatorios, % confirmaciones',
    (SELECT count(*) FROM public.agendas_diarias), (SELECT count(*) FROM public.asistencias),
    (SELECT count(*) FROM public.ausencias), (SELECT count(*) FROM public.informes_evolucion),
    (SELECT count(*) FROM public.mensajes), (SELECT count(*) FROM public.conversaciones),
    (SELECT count(*) FROM public.citas), (SELECT count(*) FROM public.recordatorios),
    (SELECT count(*) FROM public.confirmaciones_evento);
END
$guarda$;

-- ---- 1. El curso en que se escribió, vencido ----
-- El primer curso del centro que termina en esa fecha o después ha terminado hace más de esos años
-- (el día siguiente al final, hora de Madrid). Basta con que alguno que termine después lo cumpla:
-- si lo cumple uno, lo cumple también el primero.
CREATE FUNCTION privado.curso_vencido(p_centro_id uuid, p_fecha date, p_anios integer)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.cursos_academicos c
     WHERE c.centro_id = p_centro_id
       AND c.deleted_at IS NULL
       AND c.fecha_fin >= p_fecha
       AND (c.fecha_fin + 1)::timestamp AT TIME ZONE 'Europe/Madrid'
           < now() - make_interval(years => p_anios));
$function$;
REVOKE ALL ON FUNCTION privado.curso_vencido(uuid, date, integer) FROM PUBLIC, anon, authenticated;

-- ---- 2. Lo que vence, por tabla ----
CREATE FUNCTION privado.operativa_vencida(p_tabla text, p_anios integer)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $function$
BEGIN
  CASE p_tabla
  WHEN 'agendas_diarias' THEN
    RETURN QUERY SELECT a.id FROM public.agendas_diarias a JOIN public.ninos n ON n.id = a.nino_id
      WHERE privado.curso_vencido(n.centro_id, a.fecha, p_anios);
  WHEN 'asistencias' THEN
    RETURN QUERY SELECT a.id FROM public.asistencias a JOIN public.ninos n ON n.id = a.nino_id
      WHERE privado.curso_vencido(n.centro_id, a.fecha, p_anios);
  WHEN 'ausencias' THEN
    RETURN QUERY SELECT a.id FROM public.ausencias a JOIN public.ninos n ON n.id = a.nino_id
      WHERE privado.curso_vencido(n.centro_id, a.fecha_fin, p_anios);
  WHEN 'informes_evolucion' THEN
    RETURN QUERY SELECT i.id FROM public.informes_evolucion i
      JOIN public.cursos_academicos c ON c.id = i.curso_academico_id
      WHERE privado.curso_vencido(i.centro_id,
              GREATEST(c.fecha_fin, (i.updated_at AT TIME ZONE 'Europe/Madrid')::date), p_anios);
  WHEN 'mensajes' THEN
    RETURN QUERY SELECT m.id FROM public.mensajes m JOIN public.conversaciones v ON v.id = m.conversacion_id
      WHERE privado.curso_vencido(v.centro_id, (m.created_at AT TIME ZONE 'Europe/Madrid')::date, p_anios);
  WHEN 'conversaciones' THEN
    RETURN QUERY SELECT v.id FROM public.conversaciones v
      WHERE privado.curso_vencido(v.centro_id, (v.created_at AT TIME ZONE 'Europe/Madrid')::date, p_anios)
        AND NOT EXISTS (
              SELECT 1 FROM public.mensajes m
               WHERE m.conversacion_id = v.id
                 AND NOT privado.curso_vencido(v.centro_id,
                           (m.created_at AT TIME ZONE 'Europe/Madrid')::date, p_anios));
  WHEN 'citas' THEN
    RETURN QUERY SELECT c.id FROM public.citas c
      WHERE privado.curso_vencido(c.centro_id,
              GREATEST(c.fecha, (c.created_at AT TIME ZONE 'Europe/Madrid')::date), p_anios);
  WHEN 'recordatorios' THEN
    RETURN QUERY SELECT r.id FROM public.recordatorios r
      WHERE privado.curso_vencido(r.centro_id,
              GREATEST((r.created_at AT TIME ZONE 'Europe/Madrid')::date,
                       (r.vencimiento AT TIME ZONE 'Europe/Madrid')::date), p_anios);
  WHEN 'confirmaciones_evento' THEN
    RETURN QUERY SELECT ce.id FROM public.confirmaciones_evento ce JOIN public.eventos e ON e.id = ce.evento_id
      WHERE privado.curso_vencido(e.centro_id,
              GREATEST(COALESCE(e.fecha_fin, e.fecha), (ce.created_at AT TIME ZONE 'Europe/Madrid')::date),
              p_anios);
  ELSE
    RAISE EXCEPTION 'tabla de operativa desconocida: %', p_tabla USING ERRCODE = 'invalid_parameter_value';
  END CASE;
END;
$function$;
REVOKE ALL ON FUNCTION privado.operativa_vencida(text, integer) FROM PUBLIC, anon, authenticated;

-- Las copias en audit_log de filas de la operativa que ya no existen, con su curso vencido (por la
-- fecha de la copia, que nunca es anterior a la del registro).
CREATE FUNCTION privado.operativa_copias_vencidas(p_anios integer)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT a.id FROM public.audit_log a
   WHERE a.tabla IN ('agendas_diarias', 'comidas', 'biberones', 'suenos', 'deposiciones',
                     'asistencias', 'ausencias', 'informes_evolucion', 'conversaciones',
                     'mensajes', 'citas', 'cita_invitados', 'recordatorios')
     AND privado.curso_vencido(a.centro_id, (a.ts AT TIME ZONE 'Europe/Madrid')::date, p_anios)
     AND NOT CASE a.tabla
       WHEN 'agendas_diarias'    THEN EXISTS (SELECT 1 FROM public.agendas_diarias    x WHERE x.id = a.registro_id)
       WHEN 'comidas'            THEN EXISTS (SELECT 1 FROM public.comidas            x WHERE x.id = a.registro_id)
       WHEN 'biberones'          THEN EXISTS (SELECT 1 FROM public.biberones          x WHERE x.id = a.registro_id)
       WHEN 'suenos'             THEN EXISTS (SELECT 1 FROM public.suenos             x WHERE x.id = a.registro_id)
       WHEN 'deposiciones'       THEN EXISTS (SELECT 1 FROM public.deposiciones       x WHERE x.id = a.registro_id)
       WHEN 'asistencias'        THEN EXISTS (SELECT 1 FROM public.asistencias        x WHERE x.id = a.registro_id)
       WHEN 'ausencias'          THEN EXISTS (SELECT 1 FROM public.ausencias          x WHERE x.id = a.registro_id)
       WHEN 'informes_evolucion' THEN EXISTS (SELECT 1 FROM public.informes_evolucion x WHERE x.id = a.registro_id)
       WHEN 'conversaciones'     THEN EXISTS (SELECT 1 FROM public.conversaciones     x WHERE x.id = a.registro_id)
       WHEN 'mensajes'           THEN EXISTS (SELECT 1 FROM public.mensajes           x WHERE x.id = a.registro_id)
       WHEN 'citas'              THEN EXISTS (SELECT 1 FROM public.citas              x WHERE x.id = a.registro_id)
       WHEN 'cita_invitados'     THEN EXISTS (SELECT 1 FROM public.cita_invitados     x WHERE x.id = a.registro_id)
       WHEN 'recordatorios'      THEN EXISTS (SELECT 1 FROM public.recordatorios      x WHERE x.id = a.registro_id)
     END;
$function$;
REVOKE ALL ON FUNCTION privado.operativa_copias_vencidas(integer) FROM PUBLIC, anon, authenticated;

-- ---- 3. El plazo (provisional, lo pasa el cron) ----
CREATE FUNCTION public.purgar_operativa_vencida(p_anios integer, p_simular boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  -- Los mensajes antes que las conversaciones, aunque el predicado de la conversación ya mira sus
  -- mensajes: así el orden no cambia el resultado.
  k_tablas text[] := ARRAY['agendas_diarias', 'asistencias', 'ausencias', 'informes_evolucion',
                           'mensajes', 'conversaciones', 'citas', 'recordatorios',
                           'confirmaciones_evento'];
  t   text;
  v_n integer;
  r   jsonb := '{}'::jsonb;
BEGIN
  IF p_anios IS NULL OR p_anios < 1 OR p_simular IS NULL THEN
    RAISE EXCEPTION 'plazo de la operativa no válido' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF NOT p_simular THEN
    PERFORM set_config('app.audit_actor', 'system:purgar_operativa_vencida', true);
    PERFORM set_config('app.borrar_sin_copia', 'on', true);
  END IF;

  FOREACH t IN ARRAY k_tablas LOOP
    IF p_simular THEN
      SELECT count(*) INTO v_n FROM privado.operativa_vencida(t, p_anios);
    ELSE
      EXECUTE format('DELETE FROM public.%I WHERE id IN (SELECT privado.operativa_vencida(%L, $1))', t, t)
        USING p_anios;
      GET DIAGNOSTICS v_n = ROW_COUNT;
    END IF;
    r := r || jsonb_build_object(t, v_n);
  END LOOP;

  IF p_simular THEN
    SELECT count(*) INTO v_n FROM privado.operativa_copias_vencidas(p_anios);
  ELSE
    DELETE FROM public.audit_log WHERE id IN (SELECT privado.operativa_copias_vencidas(p_anios));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM set_config('app.borrar_sin_copia', '', true);
    PERFORM set_config('app.audit_actor', '', true);
  END IF;
  RETURN r || jsonb_build_object('copias_huerfanas', v_n);
END;
$function$;
REVOKE ALL ON FUNCTION public.purgar_operativa_vencida(integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purgar_operativa_vencida(integer, boolean) TO service_role;

-- ---- Guarda posterior ----
DO $guarda$
BEGIN
  IF has_function_privilege('authenticated', 'public.purgar_operativa_vencida(integer,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.purgar_operativa_vencida(integer,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'privado.curso_vencido(uuid,date,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'privado.operativa_vencida(text,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'privado.operativa_copias_vencidas(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'una función de la operativa quedó abierta a quien no toca';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc
           WHERE oid = 'public.purgar_operativa_vencida(integer,boolean)'::regprocedure) THEN
    RAISE EXCEPTION 'purgar_operativa_vencida tiene que ser SECURITY DEFINER';
  END IF;
  RAISE NOTICE 'guarda posterior: vencida a 1 año (simulado): %', public.purgar_operativa_vencida(1, true);
END
$guarda$;
