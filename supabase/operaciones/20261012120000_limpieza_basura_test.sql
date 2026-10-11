-- =============================================================================
-- OPERACIÓN 20261012120000 · Limpieza de la basura de test en producción
--
-- Una sola vez, en producción. NO es una migración: no cambia el esquema y no se registra en
-- supabase_migrations (convención en supabase/operaciones/README.md).
--
-- Contexto: la suite RLS corrió contra producción hasta el 11-10-2026 (#340 cerró el grifo;
-- desde entonces no entra ninguna fila en audit_log). Dejó:
--   - 8 centros de test vivos (email @nido.test, creados en la ventana de la nocturna del
--     11-10-2026), con 6 niños, 24 familias, 4 aulas y 4 cursos;
--   - 28.550 filas de audit_log con centro_id NULL: el DELETE en cascada de sus fixtures busca el
--     centro por un padre ya borrado y lo graba NULL; deleteTestCentro solo borraba por centro_id;
--   - 298 filas de audit_log con el centro_id de esos 8 centros (278) o de 3 centros de test ya
--     borrados (20).
-- Diagnóstico completo: docs/operations/limpieza-basura-test-2026-10.md.
--
-- Todo es UN bloque DO: una sola sentencia, una sola transacción. Cualquier guarda que falle
-- lanza una excepción y no queda NADA hecho.
--
-- ENSAYO: anteponer `SET nido.ensayo = 'on';` al fichero. Corre todo, comprueba todas las
-- guardas y termina en RAISE EXCEPTION con los recuentos de cada paso: no confirma nada.
-- Sin esa línea, el fichero tal cual borra de verdad.
--
-- No toca: los 16 usuarios @nido.test de Auth (van aparte, por la admin API), Storage (no hay
-- objetos de estos centros) ni ANAIA (33c79b50-13b5-4962-b849-d88dd6a21366).
-- =============================================================================

DO $operacion$
DECLARE
  c_anaia     constant uuid := '33c79b50-13b5-4962-b849-d88dd6a21366';
  -- Los 8 centros de test vivos (lista explícita; diagnóstico del 12-10-2026).
  c_centros   constant uuid[] := ARRAY[
    '0a0052c3-785e-441f-b57e-51901d5f9bfd',  -- Centro Olvido
    'fcc871f5-8971-4596-a2a2-3f074695f068',  -- Centro Ajeno
    'adfae2e8-2a82-441d-83ee-f8a9d09b2bab',  -- Centro IMG
    'a93fb081-645a-4af9-8924-bfda5fafd0b9',  -- Centro Export
    'bf8271bd-7be7-4e40-b738-e62ab55fc221',  -- Centro Export Ajeno
    '0d3b9dca-98a0-4321-9dbc-7ba5e2003681',  -- Centro LP A
    '05d9ead6-a80a-4f41-be64-17ca8891a9ac',  -- Centro A6 esqueleto
    '700be224-5d4c-4817-b1d6-6d5708ccf70d'   -- Centro AcusesU0 A
  ]::uuid[];
  -- 3 centros de test ya borrados que dejaron 20 filas de auditoría (alta con @nido.test).
  c_centros_borrados constant uuid[] := ARRAY[
    '277f7987-3ac7-4777-b9a4-b8e2e775b1b3',
    'c090a3ae-0d13-468a-9cbe-512a76d0b2a4',
    'e5567cf3-6277-441a-9c53-9c100e80c5fe'
  ]::uuid[];
  -- Ventana de la nocturna del 11-10-2026 (run de rls-suite.yml): las únicas filas de usuarios.
  c_ventana_ini constant timestamptz := '2026-10-11 08:21:23+00';
  c_ventana_fin constant timestamptz := '2026-10-11 09:08:19+00';

  -- RECUENTOS APROBADOS. Si un paso borra otro número, rollback total.
  e_paso1 constant jsonb := '{"acuses_alta": 2, "administraciones_medicacion": 0, "informes_evolucion": 0,
    "conversaciones": 0, "asistencias": 0, "ausencias": 0, "agendas_diarias": 0,
    "info_medica_emergencia": 0, "datos_pedagogicos_nino": 0, "matriculas": 0, "ninos": 6,
    "aulas": 4, "cursos_academicos": 4, "familias": 24, "roles_usuario": 0, "invitaciones": 0,
    "centros": 8}';
  e_paso2 constant jsonb := '{"vinculos_familiares": 17264, "familia_tutores": 9005, "menu_dia": 1267,
    "firmas_autorizacion": 500, "comidas": 252, "mensajes": 251, "usuarios": 11}';
  e_paso3 constant bigint := 298;
  e_paso4 constant jsonb := '{"acuses_alta": 2, "ninos": 6, "vinculos_familiares": 1, "aulas": 4,
    "aulas_curso": 4, "cursos_academicos": 4, "familias": 24, "centros": 8}';

  v_xid      xid;
  v_ninos    uuid[];
  v_n        bigint;
  r_paso1    jsonb := '{}';
  r_paso2    jsonb;
  r_paso3    bigint;
  r_paso4    jsonb;
  f          text[] := '{}';
BEGIN
  -- La transacción de esta operación: las filas de auditoría que generen sus propios DELETE
  -- llevan este xmin (paso 4). Sin bloques EXCEPTION dentro: no hay subtransacciones.
  v_xid := pg_current_xact_id()::xid;

  -- ── GUARDA ANAIA AL PRINCIPIO ──────────────────────────────────────────────────────────
  IF (SELECT count(*) FROM public.audit_log WHERE centro_id = c_anaia) <> 164
     OR (SELECT count(*) FROM public.ninos WHERE centro_id = c_anaia) <> 4
     OR (SELECT count(*) FROM public.roles_usuario WHERE centro_id = c_anaia) <> 9 THEN
    RAISE EXCEPTION 'guarda ANAIA (inicio): esperaba 164/4/9 y hay %/%/%',
      (SELECT count(*) FROM public.audit_log WHERE centro_id = c_anaia),
      (SELECT count(*) FROM public.ninos WHERE centro_id = c_anaia),
      (SELECT count(*) FROM public.roles_usuario WHERE centro_id = c_anaia);
  END IF;
  IF c_anaia = ANY (c_centros) OR c_anaia = ANY (c_centros_borrados) THEN
    RAISE EXCEPTION 'ANAIA está en una lista de centros a borrar';
  END IF;
  -- Los 8 tienen que seguir siendo de test: email @nido.test.
  IF (SELECT count(*) FROM public.centros WHERE id = ANY (c_centros) AND email_contacto ILIKE '%@nido.test') <> 8 THEN
    RAISE EXCEPTION 'guarda: no están los 8 centros de test con email @nido.test';
  END IF;

  -- ── PASO 1 · Los 8 centros, en el orden de deleteTestCentro (src/test/rls/setup.ts) ────
  -- Más acuses_alta, que referencia ninos sin cascada y deleteTestCentro no borra.
  SELECT coalesce(array_agg(id), '{}') INTO v_ninos FROM public.ninos WHERE centro_id = ANY (c_centros);

  DELETE FROM public.acuses_alta WHERE nino_id = ANY (v_ninos);
  GET DIAGNOSTICS v_n = ROW_COUNT; r_paso1 := r_paso1 || jsonb_build_object('acuses_alta', v_n);
  DELETE FROM public.administraciones_medicacion WHERE nino_id = ANY (v_ninos);
  GET DIAGNOSTICS v_n = ROW_COUNT; r_paso1 := r_paso1 || jsonb_build_object('administraciones_medicacion', v_n);
  DELETE FROM public.informes_evolucion WHERE nino_id = ANY (v_ninos);
  GET DIAGNOSTICS v_n = ROW_COUNT; r_paso1 := r_paso1 || jsonb_build_object('informes_evolucion', v_n);
  DELETE FROM public.conversaciones WHERE nino_id = ANY (v_ninos);
  GET DIAGNOSTICS v_n = ROW_COUNT; r_paso1 := r_paso1 || jsonb_build_object('conversaciones', v_n);
  DELETE FROM public.asistencias WHERE nino_id = ANY (v_ninos);
  GET DIAGNOSTICS v_n = ROW_COUNT; r_paso1 := r_paso1 || jsonb_build_object('asistencias', v_n);
  DELETE FROM public.ausencias WHERE nino_id = ANY (v_ninos);
  GET DIAGNOSTICS v_n = ROW_COUNT; r_paso1 := r_paso1 || jsonb_build_object('ausencias', v_n);
  DELETE FROM public.agendas_diarias WHERE nino_id = ANY (v_ninos);
  GET DIAGNOSTICS v_n = ROW_COUNT; r_paso1 := r_paso1 || jsonb_build_object('agendas_diarias', v_n);
  DELETE FROM public.info_medica_emergencia WHERE nino_id = ANY (v_ninos);
  GET DIAGNOSTICS v_n = ROW_COUNT; r_paso1 := r_paso1 || jsonb_build_object('info_medica_emergencia', v_n);
  DELETE FROM public.datos_pedagogicos_nino WHERE nino_id = ANY (v_ninos);
  GET DIAGNOSTICS v_n = ROW_COUNT; r_paso1 := r_paso1 || jsonb_build_object('datos_pedagogicos_nino', v_n);
  DELETE FROM public.matriculas WHERE nino_id = ANY (v_ninos);
  GET DIAGNOSTICS v_n = ROW_COUNT; r_paso1 := r_paso1 || jsonb_build_object('matriculas', v_n);
  DELETE FROM public.ninos WHERE id = ANY (v_ninos);
  GET DIAGNOSTICS v_n = ROW_COUNT; r_paso1 := r_paso1 || jsonb_build_object('ninos', v_n);
  -- Estructura: aulas cascadea aulas_curso y profes_aulas; familias cascadea familia_tutores.
  DELETE FROM public.aulas WHERE centro_id = ANY (c_centros);
  GET DIAGNOSTICS v_n = ROW_COUNT; r_paso1 := r_paso1 || jsonb_build_object('aulas', v_n);
  DELETE FROM public.cursos_academicos WHERE centro_id = ANY (c_centros);
  GET DIAGNOSTICS v_n = ROW_COUNT; r_paso1 := r_paso1 || jsonb_build_object('cursos_academicos', v_n);
  DELETE FROM public.familias WHERE centro_id = ANY (c_centros);
  GET DIAGNOSTICS v_n = ROW_COUNT; r_paso1 := r_paso1 || jsonb_build_object('familias', v_n);
  DELETE FROM public.roles_usuario WHERE centro_id = ANY (c_centros);
  GET DIAGNOSTICS v_n = ROW_COUNT; r_paso1 := r_paso1 || jsonb_build_object('roles_usuario', v_n);
  DELETE FROM public.invitaciones WHERE centro_id = ANY (c_centros);
  GET DIAGNOSTICS v_n = ROW_COUNT; r_paso1 := r_paso1 || jsonb_build_object('invitaciones', v_n);
  DELETE FROM public.centros WHERE id = ANY (c_centros);
  GET DIAGNOSTICS v_n = ROW_COUNT; r_paso1 := r_paso1 || jsonb_build_object('centros', v_n);

  -- ── PASO 2 · audit_log con centro_id NULL: el criterio, explícito ──────────────────────
  -- Solo filas anteriores a esta operación (xmin distinto): las de este bloque van al paso 4.
  WITH
  -- Todo lo que alguna vez fue de ANAIA según su propia auditoría, y sus usuarios.
  anaia_registros AS (
    SELECT registro_id AS id FROM public.audit_log WHERE centro_id = c_anaia AND registro_id IS NOT NULL
  ),
  anaia_usuarios AS (
    -- Sin NULL: un NULL dentro de un NOT IN vaciaría el criterio entero.
    SELECT usuario_id AS id FROM public.roles_usuario WHERE centro_id = c_anaia AND usuario_id IS NOT NULL
    UNION SELECT usuario_id FROM public.audit_log WHERE centro_id = c_anaia AND usuario_id IS NOT NULL
    UNION SELECT nullif(coalesce(valores_despues, valores_antes)->>'usuario_id', '')::uuid
            FROM public.audit_log WHERE centro_id = c_anaia
             AND nullif(coalesce(valores_despues, valores_antes)->>'usuario_id', '') IS NOT NULL
  ),
  candidatas AS (
    SELECT a.id, a.tabla, a.accion, a.registro_id, a.ts,
           CASE a.tabla
             WHEN 'vinculos_familiares' THEN 'ninos'   WHEN 'firmas_autorizacion' THEN 'ninos'
             WHEN 'familia_tutores'     THEN 'familias' WHEN 'menu_dia' THEN 'plantillas_menu_mensual'
             WHEN 'comidas'             THEN 'agendas_diarias' WHEN 'mensajes' THEN 'conversaciones'
           END AS padre_tabla,
           (a.valores_antes->>CASE a.tabla
             WHEN 'vinculos_familiares' THEN 'nino_id'   WHEN 'firmas_autorizacion' THEN 'nino_id'
             WHEN 'familia_tutores'     THEN 'familia_id' WHEN 'menu_dia' THEN 'plantilla_id'
             WHEN 'comidas'             THEN 'agenda_id' WHEN 'mensajes' THEN 'conversacion_id'
           END)::uuid AS padre,
           nullif(a.valores_antes->>'usuario_id', '')::uuid AS usuario_ref,
           a.valores_antes->>'email' AS email
      FROM public.audit_log a
     WHERE a.centro_id IS NULL AND a.xmin <> v_xid
  ),
  basura AS (
    -- (a) Las 6 tablas que caen en cascada con un fixture: DELETE cuyo padre ya no existe y nunca
    --     fue de ANAIA; su usuario, si lo tiene, no existe o es @nido.test y nunca fue de ANAIA;
    --     su email, si lo tiene, es @nido.test.
    SELECT c.id, c.tabla FROM candidatas c
     WHERE c.padre_tabla IS NOT NULL
       AND c.accion = 'DELETE'
       AND c.padre IS NOT NULL
       AND NOT CASE c.padre_tabla
             WHEN 'ninos'                   THEN EXISTS (SELECT 1 FROM public.ninos x WHERE x.id = c.padre)
             WHEN 'familias'                THEN EXISTS (SELECT 1 FROM public.familias x WHERE x.id = c.padre)
             WHEN 'plantillas_menu_mensual' THEN EXISTS (SELECT 1 FROM public.plantillas_menu_mensual x WHERE x.id = c.padre)
             WHEN 'agendas_diarias'         THEN EXISTS (SELECT 1 FROM public.agendas_diarias x WHERE x.id = c.padre)
             WHEN 'conversaciones'          THEN EXISTS (SELECT 1 FROM public.conversaciones x WHERE x.id = c.padre)
           END
       AND c.padre NOT IN (SELECT id FROM anaia_registros)
       AND (c.usuario_ref IS NULL
            OR (c.usuario_ref NOT IN (SELECT id FROM anaia_usuarios)
                AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = c.usuario_ref AND u.email NOT ILIKE '%@nido.test')))
       AND (c.email IS NULL OR c.email ILIKE '%@nido.test')
    UNION ALL
    -- (b) usuarios (auditada desde 20261011120000): de la nocturna del 11-10, nunca de ANAIA, y
    --     el usuario ya no existe o es @nido.test.
    SELECT c.id, c.tabla FROM candidatas c
     WHERE c.tabla = 'usuarios'
       AND c.ts BETWEEN c_ventana_ini AND c_ventana_fin
       AND c.registro_id NOT IN (SELECT id FROM anaia_registros)
       AND c.registro_id NOT IN (SELECT id FROM anaia_usuarios)
       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = c.registro_id AND u.email NOT ILIKE '%@nido.test')
  ),
  borradas AS (
    DELETE FROM public.audit_log a USING basura b WHERE a.id = b.id RETURNING a.tabla
  )
  SELECT coalesce(jsonb_object_agg(tabla, n), '{}') INTO r_paso2
    FROM (SELECT tabla, count(*) AS n FROM borradas GROUP BY tabla) s;

  -- ── PASO 3 · audit_log de los centros de test (los 8 y los 3 ya borrados) ──────────────
  DELETE FROM public.audit_log
   WHERE (centro_id = ANY (c_centros) OR centro_id = ANY (c_centros_borrados)) AND xmin <> v_xid;
  GET DIAGNOSTICS r_paso3 = ROW_COUNT;

  -- ── PASO 4 · Lo que ha escrito en audit_log esta misma operación (xmin = su transacción) ─
  WITH borradas AS (
    DELETE FROM public.audit_log WHERE xmin = v_xid RETURNING tabla
  )
  SELECT coalesce(jsonb_object_agg(tabla, n), '{}') INTO r_paso4
    FROM (SELECT tabla, count(*) AS n FROM borradas GROUP BY tabla) s;

  -- ── GUARDA DE RECUENTO: cada paso, exactamente lo aprobado ─────────────────────────────
  IF r_paso1 <> e_paso1 THEN f := f || format('paso 1: %s (esperado %s)', r_paso1, e_paso1); END IF;
  IF r_paso2 <> e_paso2 THEN f := f || format('paso 2: %s (esperado %s)', r_paso2, e_paso2); END IF;
  IF r_paso3 <> e_paso3 THEN f := f || format('paso 3: %s (esperado %s)', r_paso3, e_paso3); END IF;
  IF r_paso4 <> e_paso4 THEN f := f || format('paso 4: %s (esperado %s)', r_paso4, e_paso4); END IF;
  -- Y no queda nada de esta operación ni de los centros de test en audit_log.
  IF EXISTS (SELECT 1 FROM public.audit_log WHERE xmin = v_xid) THEN f := f || 'quedan filas de esta operación'::text; END IF;
  IF EXISTS (SELECT 1 FROM public.centros WHERE id = ANY (c_centros)) THEN f := f || 'queda algún centro de test'::text; END IF;

  -- ── GUARDA ANAIA AL FINAL ──────────────────────────────────────────────────────────────
  IF (SELECT count(*) FROM public.audit_log WHERE centro_id = c_anaia) <> 164
     OR (SELECT count(*) FROM public.ninos WHERE centro_id = c_anaia) <> 4
     OR (SELECT count(*) FROM public.roles_usuario WHERE centro_id = c_anaia) <> 9 THEN
    f := f || format('ANAIA (final): %s/%s/%s, esperaba 164/4/9',
      (SELECT count(*) FROM public.audit_log WHERE centro_id = c_anaia),
      (SELECT count(*) FROM public.ninos WHERE centro_id = c_anaia),
      (SELECT count(*) FROM public.roles_usuario WHERE centro_id = c_anaia));
  END IF;

  IF cardinality(f) > 0 THEN
    RAISE EXCEPTION 'GUARDA: rollback total | %', array_to_string(f, ' | ');
  END IF;

  IF current_setting('nido.ensayo', true) = 'on' THEN
    RAISE EXCEPTION 'ENSAYO OK, nada confirmado | paso 1: % | paso 2: % | paso 3: % | paso 4: % | ANAIA final 164/4/9',
      r_paso1, r_paso2, r_paso3, r_paso4;
  END IF;

  RAISE NOTICE 'Limpieza hecha | paso 1: % | paso 2: % | paso 3: % | paso 4: %', r_paso1, r_paso2, r_paso3, r_paso4;
END $operacion$;
