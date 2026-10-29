-- =============================================================================
-- FEAT — Retención (F11-B, punto 6, PR-8, tercera pieza): lo fiscal a los 6 años
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/retencion-plazos.md. Lo fiscal (recibos, remesas, mandatos y lo que justifica
-- sus importes) se conservaba para siempre, y con ello la familia, sus tutores y las fichas ya
-- anónimas de los niños. Decisiones de Jose (2026-10-29):
--
--   · Por familia, no por recibo: a los 6 años del último recibo pagado de la familia (cobrado a
--     mano, `cobro_fecha`; o enviado al banco, `fecha_envio_banco`; el método da igual).
--   · Una familia que nunca tuvo un recibo pagado: a los 6 años de que FINALIZA EL CURSO de la
--     baja de su último hijo (el predicado del PR-5, `privado.curso_vencido`), no del día de la
--     baja. Es el criterio de la operativa.
--   · Mientras quede algo pendiente no se destruye nada de la familia: un recibo pendiente de
--     procesar, una devolución sin resolver, un borrador que lleva dentro una deuda o un saldo (una
--     devolución arrastrada al mes siguiente, el sobrante de un cheque diferido) y el dinero a favor
--     de la familia sin devolver (un exceso de beca, una transferencia pendiente). Un borrador sin
--     nada de eso no frena, ni un recibo pendiente sin importe que cobrar (total ≤ 0: no entra en
--     una remesa ni se cobra a mano, así que no sale nunca de pendiente). Para el abogado (F11-B):
--     hace falta un tope a los impagos.
--   · En todo lo que va por plazo, «pendiente» es eso mismo, el dinero vivo: también para la cuenta
--     del tutor (pieza 2), que esperaba a cualquier recibo sin cerrar y con un borrador olvidado
--     no se purgaba nunca, y su familia tampoco se destruía. Se reescriben `privado.cuenta_vencida`
--     y la comprobación de `purgar_sujeto_db` para la petición por plazo. El olvido que pide la
--     familia se queda exactamente como está.
--   · Se destruye TODO: los recibos con sus líneas, su parte de las remesas (una remesa vacía se
--     borra: no guarda datos de nadie), los mandatos y su documento en Storage, el método de pago,
--     las asignaciones, el parte de servicio, las becas, los tutores, la propia familia, las fichas
--     ya anónimas de los niños, y la cuenta del tutor cuando no le queda nada en ningún centro.
--     Nada de esqueletos para siempre. Sin copia en audit_log, también las de lo borrado antes.
--   · La retención manda: un niño retenido hace esperar a su familia entera; un tutor retenido, a
--     todas sus familias.
--
-- La familia espera además a que haya terminado todo lo anterior: sus niños purgados, sin nada
-- conservado (las firmas, pieza 2), sin lecturas de la ficha ni registro de accesos, y sus tutores
-- purgados en el centro (o con otro rol vivo allí, que los mantiene). Si no, quedarían colgando.
--
-- La cuenta: purgada en todos sus centros, sin perfil de tutor en ninguna familia, sin rol vivo y
-- sin retener. Se borra si ya nada la nombra; si algo la nombra todavía (su actividad en audit_log
-- hasta su plazo, una petición de olvido que pidió ella), espera: «si no le queda nada».
--
-- Las funciones se ejecutan con la sesión del servicio (el cron): los congelados de recibos,
-- líneas, partes, becas y remesas eximen a service_role, que es la limpieza del servidor.
--
-- La aplica el responsable por SQL Editor. Sin orden obligado con el despliegue: no revoca nada, y
-- las dos funciones que reescribe devuelven lo mismo; solo cambia qué frena la purga por plazo de
-- una cuenta. Hoy no vence nada (el último pago es de 2026-10-26). Tras aplicar: registrar en
-- supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  r     record;
BEGIN
  IF to_regprocedure('public.destruir_fiscal_familia(uuid,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'ya aplicada: public.destruir_fiscal_familia existe';
  END IF;
  IF to_regprocedure('privado.plazo_cumplido(date,integer)') IS NULL
     OR to_regprocedure('privado.queda_conservado_nino(uuid)') IS NULL THEN
    RAISE EXCEPTION 'falta 20261207120000 (las firmas y la cuenta): esta va detrás';
  END IF;

  -- Lo que se reescribe es lo que hay, tal como quedó. olvido_bloqueos no se reescribe, pero
  -- bloqueos_por_plazo quita uno de sus códigos por su nombre.
  FOR r IN SELECT * FROM (VALUES
      ('privado.cuenta_vencida(uuid,uuid,integer)', '2bf7c02548148e517307e179deb79802', '20261207120000'),
      ('public.purgar_sujeto_db(uuid)', 'c5bd976dba7d61f4cfe494e67d2a1a7c', '20261207120000'),
      ('privado.olvido_bloqueos(olvido_sujeto_tipo,uuid,uuid)', 'a25058d41c0f6d8054318ef77115fe1b',
       '20261206120000')
    ) AS t(f, md5, mig)
  LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f);
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION '% no es la de %: %', r.f, r.mig, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;

  RAISE NOTICE 'guarda previa: % familias, % recibos (% pagados), % remesas, % mandatos, % niños purgados, % cuentas olvidadas',
    (SELECT count(*) FROM public.familias),
    (SELECT count(*) FROM public.recibos),
    (SELECT count(*) FROM public.recibos WHERE estado IN ('cobrado_manual', 'enviado_banco')),
    (SELECT count(*) FROM public.remesas),
    (SELECT count(*) FROM public.mandatos_sepa),
    (SELECT count(*) FROM public.ninos WHERE deleted_reason = 'purga_rgpd'),
    (SELECT count(*) FROM public.usuarios u WHERE privado.cuenta_olvidada(u.id));
END
$guarda$;

-- ---- 1. Los predicados ----

-- El último recibo pagado de la familia: el cobro a mano (`cobro_fecha`, también el de una
-- devolución cobrada en efectivo) o el envío al banco. NULL si nunca pagó uno.
CREATE FUNCTION privado.familia_ultimo_pago(p_familia_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT max(GREATEST(r.cobro_fecha,
                      CASE WHEN r.estado = 'enviado_banco' THEN r.fecha_envio_banco END))
    FROM public.recibos r
   WHERE r.familia_id = p_familia_id;
$function$;

-- Le queda dinero vivo: algo que cobrar, algo que devolverle, o una deuda o un saldo dentro de un
-- borrador. Un borrador sin nada de eso no cuenta, ni un pendiente sin importe que cobrar.
CREATE FUNCTION privado.familia_dinero_pendiente(p_familia_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.recibos r
                  WHERE r.familia_id = p_familia_id AND r.deleted_at IS NULL
                    AND ((r.estado = 'pendiente_procesar' AND r.total_centimos > 0)
                         OR (r.estado = 'devuelto' AND r.devolucion_salida IS NULL)
                         OR (r.estado = 'borrador'
                             AND EXISTS (SELECT 1 FROM public.lineas_recibo l
                                          WHERE l.recibo_id = r.id
                                            AND (l.arrastre_de_recibo_id IS NOT NULL
                                                 OR l.sobrante_de_desborde_id IS NOT NULL)))))
      OR EXISTS (SELECT 1 FROM public.beca_comedor_desborde d
                  WHERE d.familia_id = p_familia_id AND d.estado = 'pendiente')
      OR EXISTS (SELECT 1 FROM public.beca_comedor_transferencia t
                  WHERE t.familia_id = p_familia_id AND t.estado = 'pendiente');
$function$;

-- Los adultos de la familia: sus tutores (con cuenta) y quien tiene vínculo con sus niños, salvo
-- el de Dirección.
CREATE FUNCTION privado.familia_adultos(p_familia_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT ft.usuario_id FROM public.familia_tutores ft
   WHERE ft.familia_id = p_familia_id AND ft.usuario_id IS NOT NULL
  UNION
  SELECT v.usuario_id FROM public.vinculos_familiares v
    JOIN public.ninos n ON n.id = v.nino_id
   WHERE n.familia_id = p_familia_id AND v.tipo_vinculo <> 'admin';
$function$;

-- Lo fiscal de la familia ha vencido y no queda nada antes: sus niños purgados y sin nada
-- conservado, ni lecturas, ni registro de accesos; sus adultos purgados en el centro o con otro rol
-- vivo allí; nadie retenido; sin dinero vivo; y el plazo cumplido desde el último recibo pagado o,
-- sin ninguno, desde el final del curso de la baja de su último hijo.
CREATE FUNCTION privado.familia_fiscal_vencida(p_familia_id uuid, p_anios integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $function$
DECLARE
  v_centro uuid;
  v_pago   date;
  v_baja   date;
BEGIN
  SELECT centro_id INTO v_centro FROM public.familias WHERE id = p_familia_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Sus niños: al menos uno, todos purgados y sin nada que les quede.
  IF NOT EXISTS (SELECT 1 FROM public.ninos WHERE familia_id = p_familia_id)
     OR EXISTS (SELECT 1 FROM public.ninos n
                 WHERE n.familia_id = p_familia_id
                   AND (n.deleted_reason IS DISTINCT FROM 'purga_rgpd'
                        OR privado.queda_conservado_nino(n.id)
                        OR EXISTS (SELECT 1 FROM public.lecturas_ficha_medica l WHERE l.nino_id = n.id)
                        OR EXISTS (SELECT 1 FROM public.accesos_datos_bloqueados x
                                    WHERE x.sujeto_tipo = 'nino' AND x.sujeto_id = n.id)
                        -- Retención (PR-8): un niño retenido hace esperar a su familia entera.
                        OR privado.retenido(v_centro, 'nino', n.id))) THEN
    RETURN false;
  END IF;

  -- Sus adultos: purgados en el centro, o con otro rol vivo allí; ninguno retenido.
  IF EXISTS (SELECT 1 FROM privado.familia_adultos(p_familia_id) a(usuario_id)
              WHERE privado.retenido(v_centro, 'usuario', a.usuario_id)
                 OR NOT (true OR privado.usuario_olvidado_en(a.usuario_id, v_centro)
                         OR EXISTS (SELECT 1 FROM public.roles_usuario r
                                     WHERE r.usuario_id = a.usuario_id AND r.centro_id = v_centro
                                       AND r.deleted_at IS NULL
                                       AND r.rol NOT IN ('tutor_legal', 'autorizado')))) THEN
    RETURN false;
  END IF;

  IF privado.familia_dinero_pendiente(p_familia_id) THEN
    RETURN false;
  END IF;

  v_pago := privado.familia_ultimo_pago(p_familia_id);
  IF v_pago IS NOT NULL THEN
    RETURN privado.plazo_cumplido(v_pago, p_anios);
  END IF;
  SELECT max(privado.fecha_baja_destruccion(n.id)) INTO v_baja
    FROM public.ninos n WHERE n.familia_id = p_familia_id;
  RETURN v_baja IS NOT NULL AND privado.curso_vencido(v_centro, v_baja, p_anios);
END;
$function$;

-- La cuenta se puede borrar: purgada en todos sus centros, sin perfil de tutor en ninguna familia,
-- sin rol vivo, no es de la plataforma y nadie la retiene. Que nada más la nombre lo dice el DELETE.
CREATE FUNCTION privado.cuenta_destruible(p_usuario_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT privado.cuenta_olvidada(p_usuario_id)
     AND NOT EXISTS (SELECT 1 FROM public.familia_tutores WHERE usuario_id = p_usuario_id)
     AND NOT EXISTS (SELECT 1 FROM public.roles_usuario
                      WHERE usuario_id = p_usuario_id AND deleted_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE usuario_id = p_usuario_id)
     AND NOT EXISTS (SELECT 1 FROM public.retenciones
                      WHERE sujeto_tipo = 'usuario' AND sujeto_id = p_usuario_id
                        AND quitada_en IS NULL);
$function$;

-- Lo que frena la purga por plazo de una cuenta en un centro: lo que frena su olvido, salvo
-- «recibos_pendientes» (cualquier recibo sin cerrar), que se cambia por el dinero vivo de sus
-- familias allí (las mismas que mira el olvido). Un borrador sin deuda dentro no la frena.
CREATE FUNCTION privado.bloqueos_por_plazo(p_usuario_id uuid, p_centro_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT coalesce((SELECT jsonb_agg(b)
                     FROM jsonb_array_elements(privado.olvido_bloqueos('usuario', p_usuario_id, p_centro_id)
                                               -> 'bloqueos') b
                    WHERE b->>'codigo' <> 'recibos_pendientes'), '[]'::jsonb)
      || CASE WHEN EXISTS (SELECT 1 FROM public.familia_tutores ft
                            WHERE ft.usuario_id = p_usuario_id AND ft.centro_id = p_centro_id
                              AND ft.deleted_at IS NULL
                              AND privado.familia_dinero_pendiente(ft.familia_id))
              THEN jsonb_build_array(jsonb_build_object('codigo', 'dinero_vivo', 'n', 1))
              ELSE '[]'::jsonb END;
$function$;

DO $permisos$
DECLARE
  v_f text;
BEGIN
  FOREACH v_f IN ARRAY ARRAY['privado.familia_ultimo_pago(uuid)',
                             'privado.familia_dinero_pendiente(uuid)',
                             'privado.familia_adultos(uuid)',
                             'privado.familia_fiscal_vencida(uuid,integer)',
                             'privado.cuenta_destruible(uuid)',
                             'privado.bloqueos_por_plazo(uuid,uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_f);
  END LOOP;
END
$permisos$;

-- ---- 2. Lo fiscal de la familia ----

-- Las familias vencidas, con las rutas de sus documentos en Storage (los mandatos firmados y el
-- DNI de un tutor que no se purgó), que la app borra antes. Solo el servicio.
CREATE FUNCTION public.familias_fiscal_vencidas(p_anios integer)
RETURNS TABLE(familia_id uuid, centro_id uuid, mandatos text[], dnis text[])
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF p_anios IS NULL OR p_anios < 1 THEN
    RAISE EXCEPTION 'plazo fiscal no válido' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
  SELECT f.id, f.centro_id,
         coalesce((SELECT array_agg(m.documento_path ORDER BY m.documento_path)
                     FROM public.mandatos_sepa m
                    WHERE m.familia_id = f.id AND nullif(m.documento_path, '') IS NOT NULL), '{}'),
         coalesce((SELECT array_agg(ft.dni_documento_path ORDER BY ft.dni_documento_path)
                     FROM public.familia_tutores ft
                    WHERE ft.familia_id = f.id AND nullif(ft.dni_documento_path, '') IS NOT NULL), '{}')
    FROM public.familias f
   WHERE privado.familia_fiscal_vencida(f.id, p_anios)
   ORDER BY f.created_at, f.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.familias_fiscal_vencidas(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.familias_fiscal_vencidas(integer) TO service_role;

-- La destrucción de una. Vuelve a mirar, con la familia bloqueada, que siga vencida: entre la
-- lista y aquí pudieron retener a alguien. NULL si ya no toca; si no, cuántas filas por tabla.
-- El orden lo marcan las FK: los enlaces con las remesas, el dinero a favor, las líneas, las becas,
-- los recibos (de los que apuntan a otro hacia atrás), lo de los niños y, al final, la familia.
CREATE FUNCTION public.destruir_fiscal_familia(p_familia_id uuid, p_anios integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_centro   uuid;
  v_ninos    uuid[];
  v_recibos  uuid[];
  v_hist     text[];
  v_remesas  uuid[];
  v_n        integer;
  v_vuelta   integer;
  v_total    integer;
  r          jsonb := '{}'::jsonb;
BEGIN
  IF p_anios IS NULL OR p_anios < 1 THEN
    RAISE EXCEPTION 'plazo fiscal no válido' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT centro_id INTO v_centro FROM public.familias WHERE id = p_familia_id FOR UPDATE;
  IF NOT FOUND OR NOT privado.familia_fiscal_vencida(p_familia_id, p_anios) THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(array_agg(id), '{}') INTO v_ninos FROM public.ninos WHERE familia_id = p_familia_id;
  SELECT coalesce(array_agg(id), '{}') INTO v_recibos FROM public.recibos WHERE familia_id = p_familia_id;
  -- Los recibos de la familia que ya no existen (un borrador regenerado) siguen en audit_log: sus
  -- líneas se reconocen por ellos.
  SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_hist FROM (
    SELECT unnest(v_recibos)::text AS x
    UNION
    SELECT a.registro_id::text FROM public.audit_log a
     WHERE a.tabla = 'recibos' AND a.centro_id = v_centro
       AND (a.valores_antes->>'familia_id' = p_familia_id::text
            OR a.valores_despues->>'familia_id' = p_familia_id::text)) h;

  PERFORM set_config('app.audit_actor', 'system:destruir_fiscal_vencido', true);
  PERFORM set_config('app.borrar_sin_copia', 'on', true);

  WITH b AS (DELETE FROM public.recibos_remesa WHERE recibo_id = ANY (v_recibos) RETURNING remesa_id)
  SELECT count(*), coalesce(array_agg(DISTINCT remesa_id), '{}') INTO v_n, v_remesas FROM b;
  r := r || jsonb_build_object('recibos_remesa', v_n);
  -- Una remesa que se queda vacía no es de nadie: se va.
  DELETE FROM public.remesas m
   WHERE m.id = ANY (v_remesas)
     AND NOT EXISTS (SELECT 1 FROM public.recibos_remesa rr WHERE rr.remesa_id = m.id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || jsonb_build_object('remesas', v_n);

  DELETE FROM public.beca_comedor_transferencia
   WHERE familia_id = p_familia_id OR recibo_id = ANY (v_recibos);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || jsonb_build_object('beca_comedor_transferencia', v_n);

  -- Las líneas antes que los recibos y los desbordes: una línea arrastrada o de sobrante, al irse,
  -- reabre su origen (sus triggers), y ese origen se va justo después.
  DELETE FROM public.lineas_recibo WHERE recibo_id = ANY (v_recibos);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || jsonb_build_object('lineas_recibo', v_n);

  DELETE FROM public.beca_comedor_desborde
   WHERE familia_id = p_familia_id OR recibo_id = ANY (v_recibos);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || jsonb_build_object('beca_comedor_desborde', v_n);

  DELETE FROM public.beca_comedor_tramo
   WHERE nino_id = ANY (v_ninos) OR aplicada_en_recibo_id = ANY (v_recibos);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || jsonb_build_object('beca_comedor_tramo', v_n);

  -- Los recibos: primero los que nadie más nombra (un re-giro o una diferencia apuntan a su origen).
  v_total := 0;
  FOR v_vuelta IN 1..100 LOOP
    DELETE FROM public.recibos x
     WHERE x.familia_id = p_familia_id
       AND NOT EXISTS (SELECT 1 FROM public.recibos y
                        WHERE y.id <> x.id
                          AND (y.devuelto_de_recibo_id = x.id OR y.diferencia_de_recibo_id = x.id));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_total := v_total + v_n;
    EXIT WHEN v_n = 0;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.recibos WHERE familia_id = p_familia_id) THEN
    RAISE EXCEPTION 'quedan recibos de la familia que no se han podido borrar'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'recibos_en_cadena';
  END IF;
  r := r || jsonb_build_object('recibos', v_total);

  DELETE FROM public.beca_comedor_elegibilidad WHERE nino_id = ANY (v_ninos);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || jsonb_build_object('beca_comedor_elegibilidad', v_n);

  DELETE FROM public.parte_servicio_diario WHERE nino_id = ANY (v_ninos);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || jsonb_build_object('parte_servicio_diario', v_n);

  DELETE FROM public.asignacion_concepto WHERE familia_id = p_familia_id OR nino_id = ANY (v_ninos);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || jsonb_build_object('asignacion_concepto', v_n);

  DELETE FROM public.mandatos_sepa WHERE familia_id = p_familia_id OR nino_id = ANY (v_ninos);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || jsonb_build_object('mandatos_sepa', v_n);

  DELETE FROM public.metodo_pago_familia WHERE familia_id = p_familia_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || jsonb_build_object('metodo_pago_familia', v_n);

  -- Las fichas ya anónimas de los niños: primero lo que las sujeta (RESTRICT), como la purga de
  -- esqueletos; después el niño, que se lleva en cascada sus vínculos, invitaciones y demás.
  DELETE FROM public.info_medica_emergencia WHERE nino_id = ANY (v_ninos);
  DELETE FROM public.datos_pedagogicos_nino WHERE nino_id = ANY (v_ninos);
  DELETE FROM public.matriculas WHERE nino_id = ANY (v_ninos);
  DELETE FROM public.ninos WHERE id = ANY (v_ninos);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || jsonb_build_object('ninos', v_n);

  DELETE FROM public.familia_tutores WHERE familia_id = p_familia_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || jsonb_build_object('familia_tutores', v_n);

  DELETE FROM public.familias WHERE id = p_familia_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || jsonb_build_object('familias', v_n);

  -- Las retenciones ya quitadas de sus niños: el registro se va con lo que retenía.
  DELETE FROM public.retenciones
   WHERE centro_id = v_centro AND sujeto_tipo = 'nino' AND sujeto_id = ANY (v_ninos);

  -- Nada vive más en audit_log que en su tabla: las copias que quedan de filas de la familia, de
  -- sus niños o de sus recibos borradas antes (un borrador regenerado, una línea quitada…).
  DELETE FROM public.audit_log a
   WHERE a.centro_id = v_centro
     AND (a.valores_antes->>'familia_id'   = p_familia_id::text
          OR a.valores_despues->>'familia_id' = p_familia_id::text
          OR a.valores_antes->>'nino_id'      = ANY (v_ninos::text[])
          OR a.valores_despues->>'nino_id'    = ANY (v_ninos::text[])
          OR a.valores_antes->>'recibo_id'    = ANY (v_hist)
          OR a.valores_despues->>'recibo_id'  = ANY (v_hist)
          OR (a.tabla = 'recibos' AND a.registro_id::text = ANY (v_hist))
          OR (a.tabla = 'ninos' AND a.registro_id = ANY (v_ninos))
          OR (a.tabla = 'familias' AND a.registro_id = p_familia_id));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || jsonb_build_object('copias_huerfanas', v_n);

  PERFORM set_config('app.borrar_sin_copia', '', true);
  PERFORM set_config('app.audit_actor', '', true);
  RETURN r;
END;
$function$;
REVOKE ALL ON FUNCTION public.destruir_fiscal_familia(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.destruir_fiscal_familia(uuid, integer) TO service_role;

-- ---- 3. La cuenta del tutor, cuando no le queda nada ----

-- Las cuentas destruibles se borran de usuarios, cada una por separado: si algo la nombra todavía
-- (su actividad en audit_log, una petición de olvido suya), su DELETE no pasa y espera. Devuelve
-- las borradas, para que la app borre su cuenta de Auth. En simulación, cuántas lo intentaría.
CREATE FUNCTION public.destruir_cuentas_olvidadas(p_simular boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_id       uuid;
  v_borradas uuid[] := '{}';
  v_esperan  integer := 0;
BEGIN
  IF p_simular IS NULL THEN
    RAISE EXCEPTION 'falta p_simular' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_simular THEN
    RETURN jsonb_build_object('candidatas',
      (SELECT count(*) FROM public.usuarios u WHERE privado.cuenta_destruible(u.id)));
  END IF;

  PERFORM set_config('app.audit_actor', 'system:destruir_cuentas_olvidadas', true);
  PERFORM set_config('app.borrar_sin_copia', 'on', true);
  FOR v_id IN SELECT u.id FROM public.usuarios u WHERE privado.cuenta_destruible(u.id) ORDER BY u.id LOOP
    BEGIN
      DELETE FROM public.retenciones WHERE sujeto_tipo = 'usuario' AND sujeto_id = v_id;
      DELETE FROM public.usuarios WHERE id = v_id;
      v_borradas := v_borradas || v_id;
    EXCEPTION WHEN foreign_key_violation THEN
      v_esperan := v_esperan + 1;
    END;
  END LOOP;
  PERFORM set_config('app.borrar_sin_copia', '', true);
  PERFORM set_config('app.audit_actor', '', true);
  RETURN jsonb_build_object('borradas', to_jsonb(v_borradas), 'esperan', v_esperan);
END;
$function$;
REVOKE ALL ON FUNCTION public.destruir_cuentas_olvidadas(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.destruir_cuentas_olvidadas(boolean) TO service_role;

-- Las cuentas de Auth que la purga dejó anonimizadas (`borrado+<id>@borrado.invalid`) y ya no
-- tienen fila en usuarios: las que la app tiene que borrar por la Admin API, también si falló antes.
CREATE FUNCTION public.cuentas_auth_huerfanas()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT a.id FROM auth.users a
   WHERE a.email = 'borrado+' || a.id::text || '@borrado.invalid'
     AND NOT EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = a.id)
   ORDER BY a.id;
$function$;
REVOKE ALL ON FUNCTION public.cuentas_auth_huerfanas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cuentas_auth_huerfanas() TO service_role;

-- ---- 4. Lo que va por plazo: el dinero vivo ----

-- Su cuenta ha vencido en el centro: sin purgar allí, purgable, con el plazo cumplido desde la
-- baja de su último hijo, sin retener y sin nada que frene la purga por plazo (un hijo matriculado,
-- dinero vivo de su familia: privado.bloqueos_por_plazo). Un borrador sin deuda dentro no la frena.
CREATE OR REPLACE FUNCTION privado.cuenta_vencida(p_usuario_id uuid, p_centro_id uuid, p_anios integer)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT NOT privado.usuario_olvidado_en(p_usuario_id, p_centro_id)
     AND privado.cuenta_purgable(p_usuario_id, p_centro_id)
     AND privado.plazo_cumplido(privado.cuenta_baja(p_usuario_id, p_centro_id), p_anios)
     AND NOT privado.retenido(p_centro_id, 'usuario', p_usuario_id)
     AND jsonb_array_length(privado.bloqueos_por_plazo(p_usuario_id, p_centro_id)) = 0;
$function$;

-- La purga: la petición por plazo mira lo mismo que cuenta_vencida; el resto, como estaba.
CREATE OR REPLACE FUNCTION public.purgar_sujeto_db(p_solicitud_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s        public.olvido_solicitudes%ROWTYPE;
  v_nombre text;
  v_lista  uuid[];
  v_ft     uuid[];
  v_bloqueos jsonb;
  k_nino  text[] := ARRAY['nombre','apellidos','fecha_nacimiento','sexo','nacionalidad',
                          'foto_url','notas_admin'];
  k_med   text[] := ARRAY['alergias_graves','notas_emergencia','medicacion_habitual',
                          'alergias_leves','medico_familia','telefono_emergencia'];
  k_user  text[] := ARRAY['nombre_completo','foto_url'];
  k_ft    text[] := ARRAY['nombre_completo','email','direccion_calle','direccion_numero',
                          'direccion_cp','direccion_ciudad','dni_documento_path'];
  k_extra text[] := ARRAY['ip_address','user_agent','descripcion_parentesco',
                          'nombre_externo','observaciones','observaciones_generales',
                          'contenido','nombre_tecleado','comentario'];
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
  IF auth.uid() IS NOT NULL AND NOT privado.es_responsable(s.centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF s.purgado_en IS NOT NULL THEN
    RETURN;
  END IF;

  -- Retención (PR-8): el sujeto retenido por un procedimiento abierto espera, también con la
  -- petición ya confirmada (olvido_pendientes ya no la lista; esto cubre cualquier otro camino).
  IF privado.retenido(s.centro_id, s.sujeto_tipo::text, s.sujeto_id) THEN
    RAISE EXCEPTION 'el sujeto está retenido por un procedimiento abierto'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'retenido';
  END IF;

  -- Retención (PR-8, pieza 2): la petición por plazo vuelve a mirar que la cuenta siga purgable
  -- (todos sus hijos de baja y ningún otro rol vivo): entre abrirla y purgarla le pudieron dar un
  -- rol, o un hijo pudo volver. Sin la fecha: el plazo, una vez cumplido, no deja de estarlo.
  IF s.por_plazo AND NOT privado.cuenta_purgable(s.sujeto_id, s.centro_id) THEN
    RAISE EXCEPTION 'la cuenta ya no se purga por plazo'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'plazo';
  END IF;

  -- Retención (PR-7): ningún tutor se olvida con un hijo matriculado. Lo que impide confirmar
  -- impide purgar (olvido_pendientes ya no la lista; esto cubre cualquier otro camino).
  -- Retención (PR-8, pieza 3): la petición por plazo no mira cualquier recibo sin cerrar, sino el
  -- dinero vivo de sus familias (privado.bloqueos_por_plazo): un borrador sin deuda dentro no frena.
  IF s.sujeto_tipo = 'usuario' THEN
    v_bloqueos := CASE WHEN s.por_plazo
                       THEN privado.bloqueos_por_plazo(s.sujeto_id, s.centro_id)
                       ELSE privado.olvido_bloqueos(s.sujeto_tipo, s.sujeto_id, s.centro_id) -> 'bloqueos'
                  END;
    IF jsonb_array_length(v_bloqueos) > 0 THEN
      RAISE EXCEPTION 'todavía falta algo para purgar'
        USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'hay_bloqueos',
              DETAIL = v_bloqueos::text;
    END IF;
  END IF;

  -- Grupo 1 (PR B): las filas de auditoría que escribe la purga llevan su etiqueta.
  PERFORM set_config('app.audit_actor', 'system:purgar_sujeto_db', true);

  IF s.sujeto_tipo = 'nino' THEN
    -- Retención (F11-B, punto 6, PR-6): la purga del niño, la misma para el olvido y para el
    -- plazo del expediente (20261204120000).
    PERFORM privado.purgar_nino(s.sujeto_id);

  ELSE  -- usuario
    SELECT nombre_completo INTO v_nombre FROM public.usuarios WHERE id = s.sujeto_id;

    IF public.olvido_es_ultimo_centro(s.id) THEN
      -- Último centro: la cuenta entera y todo lo que quede, también lo de los centros sin
      -- solicitud. Es literal la rama del usuario de 20261019120000.
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

      -- Cierre de la purga: también la foto de perfil (el objeto lo borra antes el manifiesto).
      UPDATE public.usuarios SET
        nombre_completo = '[borrado]',
        foto_url        = NULL,
        deleted_at      = COALESCE(deleted_at, now())
      WHERE id = s.sujeto_id;

      UPDATE public.consentimientos SET ip_address = NULL, user_agent = NULL
        WHERE usuario_id = s.sujeto_id;
      DELETE FROM public.push_subscriptions WHERE usuario_id = s.sujeto_id;
      -- Cierre de la purga: preferencias y lecturas, igual que los dispositivos.
      DELETE FROM public.preferencias_usuario WHERE usuario_id = s.sujeto_id;
      DELETE FROM public.lectura_conversacion WHERE usuario_id = s.sujeto_id;
      DELETE FROM public.lectura_anuncio      WHERE usuario_id = s.sujeto_id;

      -- Cierre de la purga: su perfil de tutor en familia_tutores. Se anonimiza y se da de baja;
      -- usuario_id, familia_id y rol_familia se quedan (seudónimos; el trigger los congela). No se
      -- asciende al otro tutor: lo decide la directora (promover_a_titular). Su copia en
      -- audit_log se redacta por registro_id, que alcanza también las filas de antes de tener
      -- cuenta. El DNI en Storage lo borra antes el manifiesto, por su ruta exacta.
      WITH anonimizados AS (
        UPDATE public.familia_tutores SET
          nombre_completo    = NULL,
          email              = NULL,
          direccion_calle    = NULL,
          direccion_numero   = NULL,
          direccion_cp       = NULL,
          direccion_ciudad   = NULL,
          dni_documento_path = NULL,
          deleted_at         = COALESCE(deleted_at, now())
        WHERE usuario_id = s.sujeto_id RETURNING id
      )
      SELECT array_agg(id) INTO v_ft FROM anonimizados;
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   k_ft),
        valores_despues = public._redactar_jsonb(valores_despues, k_ft)
      WHERE tabla = 'familia_tutores' AND registro_id = ANY (v_ft);

      -- Cierre de la purga: los cambios que pidió sobre sus propios datos de tutor (email,
      -- dirección, ruta de su DNI en el payload). Los que pidió sobre el niño son del niño.
      DELETE FROM public.cambios_pendientes
       WHERE solicitado_por = s.sujeto_id AND entidad IN ('datos_tutor', 'datos_tutor_dni');

      -- Cierre de la purga: su texto al responder a una cita (la auditoría la redacta k_extra).
      UPDATE public.cita_invitados SET comentario = NULL
       WHERE usuario_id = s.sujeto_id AND comentario IS NOT NULL;

      -- Purga de lista_espera: el teléfono y el email que el tutor dejó en sus prospectos. El
      -- prospecto es del niño y se queda; su copia en audit_log pierde esas dos claves.
      WITH limpiados AS (
        UPDATE public.lista_espera SET telefono_tutor = NULL, email_tutor = NULL
        WHERE tutor_usuario_id = s.sujeto_id RETURNING id
      )
      SELECT array_agg(id) INTO v_lista FROM limpiados;
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY['telefono_tutor', 'email_tutor']),
        valores_despues = public._redactar_jsonb(valores_despues, ARRAY['telefono_tutor', 'email_tutor'])
      WHERE tabla = 'lista_espera' AND registro_id = ANY (v_lista);

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
    ELSE
      -- Multicentro (Fase 2 · PR B): le queda otro centro. Cada sentencia es la de la rama de
      -- arriba acotada a ESTE centro (s.centro_id). No se tocan usuarios, push, preferencias ni
      -- los consentimientos sin niño: son de la cuenta y se van con el último centro.

      -- Su nombre en los mensajes de las conversaciones de este centro, y en su auditoría.
      IF v_nombre IS NOT NULL AND length(trim(v_nombre)) > 0 THEN
        UPDATE public.mensajes
          SET contenido = replace(contenido, v_nombre, '[borrado]')
          WHERE contenido LIKE '%' || v_nombre || '%'
            AND conversacion_id IN (SELECT c.id FROM public.conversaciones c
                                     WHERE c.centro_id = s.centro_id);

        UPDATE public.audit_log SET
          valores_antes = CASE WHEN strpos(valores_antes->>'contenido', v_nombre) > 0
            THEN jsonb_set(valores_antes, '{contenido}',
                           to_jsonb(replace(valores_antes->>'contenido', v_nombre, '[borrado]')))
            ELSE valores_antes END,
          valores_despues = CASE WHEN strpos(valores_despues->>'contenido', v_nombre) > 0
            THEN jsonb_set(valores_despues, '{contenido}',
                           to_jsonb(replace(valores_despues->>'contenido', v_nombre, '[borrado]')))
            ELSE valores_despues END
        WHERE tabla = 'mensajes' AND centro_id = s.centro_id
          AND (strpos(valores_antes->>'contenido', v_nombre) > 0
               OR strpos(valores_despues->>'contenido', v_nombre) > 0);
      END IF;

      -- Los consentimientos ligados a un niño de este centro.
      UPDATE public.consentimientos SET ip_address = NULL, user_agent = NULL
        WHERE usuario_id = s.sujeto_id
          AND nino_id IN (SELECT n.id FROM public.ninos n WHERE n.centro_id = s.centro_id);
      -- Las lecturas de conversaciones y anuncios de este centro.
      DELETE FROM public.lectura_conversacion
        WHERE usuario_id = s.sujeto_id
          AND conversacion_id IN (SELECT c.id FROM public.conversaciones c
                                   WHERE c.centro_id = s.centro_id);
      DELETE FROM public.lectura_anuncio
        WHERE usuario_id = s.sujeto_id
          AND anuncio_id IN (SELECT a.id FROM public.anuncios a WHERE a.centro_id = s.centro_id);

      -- Su perfil de tutor en la familia de este centro (el DNI de esa familia lo borra antes el
      -- manifiesto, solo el de este centro).
      WITH anonimizados AS (
        UPDATE public.familia_tutores SET
          nombre_completo    = NULL,
          email              = NULL,
          direccion_calle    = NULL,
          direccion_numero   = NULL,
          direccion_cp       = NULL,
          direccion_ciudad   = NULL,
          dni_documento_path = NULL,
          deleted_at         = COALESCE(deleted_at, now())
        WHERE usuario_id = s.sujeto_id AND centro_id = s.centro_id RETURNING id
      )
      SELECT array_agg(id) INTO v_ft FROM anonimizados;
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   k_ft),
        valores_despues = public._redactar_jsonb(valores_despues, k_ft)
      WHERE tabla = 'familia_tutores' AND registro_id = ANY (v_ft);

      -- Los cambios que pidió sobre sus datos de tutor en este centro.
      DELETE FROM public.cambios_pendientes
       WHERE solicitado_por = s.sujeto_id AND entidad IN ('datos_tutor', 'datos_tutor_dni')
         AND centro_id = s.centro_id;

      -- Su texto al responder a las citas de este centro.
      UPDATE public.cita_invitados SET comentario = NULL
       WHERE usuario_id = s.sujeto_id AND comentario IS NOT NULL AND centro_id = s.centro_id;

      -- El teléfono y el email de sus prospectos de este centro.
      WITH limpiados AS (
        UPDATE public.lista_espera SET telefono_tutor = NULL, email_tutor = NULL
        WHERE tutor_usuario_id = s.sujeto_id AND centro_id = s.centro_id RETURNING id
      )
      SELECT array_agg(id) INTO v_lista FROM limpiados;
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY['telefono_tutor', 'email_tutor']),
        valores_despues = public._redactar_jsonb(valores_despues, ARRAY['telefono_tutor', 'email_tutor'])
      WHERE tabla = 'lista_espera' AND registro_id = ANY (v_lista);

      -- Sus roles en este centro y sus vínculos con niños de este centro.
      UPDATE public.roles_usuario SET
        deleted_reason = 'purga_rgpd',
        deleted_at     = COALESCE(deleted_at, now())
        WHERE usuario_id = s.sujeto_id AND centro_id = s.centro_id;
      UPDATE public.vinculos_familiares SET
        descripcion_parentesco = NULL,
        deleted_reason         = 'purga_rgpd',
        deleted_at             = COALESCE(deleted_at, now())
      WHERE usuario_id = s.sujeto_id
        AND nino_id IN (SELECT n.id FROM public.ninos n WHERE n.centro_id = s.centro_id);

      -- Su auditoría en este centro. Las filas sin centro (las de usuarios) son de la cuenta.
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   k_user || k_extra),
        valores_despues = public._redactar_jsonb(valores_despues, k_user || k_extra)
      WHERE centro_id = s.centro_id
        AND (registro_id = s.sujeto_id OR usuario_id = s.sujeto_id
             OR valores_antes->>'usuario_id'   = s.sujeto_id::text
             OR valores_despues->>'usuario_id' = s.sujeto_id::text);

      -- Sus invitaciones de este centro (purgar-vencidos.ts las marca antes, solo las de este
      -- centro), y su auditoría.
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY['email', 'nombre_completo']),
        valores_despues = public._redactar_jsonb(valores_despues, ARRAY['email', 'nombre_completo'])
      WHERE tabla = 'invitaciones' AND centro_id = s.centro_id
        AND registro_id IN (SELECT i.id FROM public.invitaciones i
                             WHERE i.email = '[borrado]' AND i.centro_id = s.centro_id);
    END IF;
  END IF;

  UPDATE public.olvido_solicitudes SET purgado_en = now() WHERE id = p_solicitud_id;
  PERFORM set_config('app.audit_actor', '', true);
END $function$;


-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_f   text;
  v_src text;
BEGIN
  FOREACH v_f IN ARRAY ARRAY['public.familias_fiscal_vencidas(integer)',
                             'public.destruir_fiscal_familia(uuid,integer)',
                             'public.destruir_cuentas_olvidadas(boolean)',
                             'public.cuentas_auth_huerfanas()'] LOOP
    IF has_function_privilege('authenticated', v_f, 'EXECUTE')
       OR has_function_privilege('anon', v_f, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION 'guarda posterior: % tiene que ser solo del servicio', v_f;
    END IF;
  END LOOP;
  FOREACH v_f IN ARRAY ARRAY['privado.familia_ultimo_pago(uuid)',
                             'privado.familia_dinero_pendiente(uuid)',
                             'privado.familia_adultos(uuid)',
                             'privado.familia_fiscal_vencida(uuid,integer)',
                             'privado.cuenta_destruible(uuid)',
                             'privado.bloqueos_por_plazo(uuid,uuid)',
                             'privado.cuenta_vencida(uuid,uuid,integer)'] LOOP
    IF has_function_privilege('authenticated', v_f, 'EXECUTE')
       OR has_function_privilege('anon', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION 'guarda posterior: % no puede abrirse a las sesiones', v_f;
    END IF;
  END LOOP;

  FOR v_f, v_src IN SELECT * FROM (VALUES
      ('privado.familia_fiscal_vencida(uuid,integer)', 'OR privado.retenido(v_centro, ''nino'', n.id)'),
      ('privado.familia_fiscal_vencida(uuid,integer)', 'WHERE privado.retenido(v_centro, ''usuario'', a.usuario_id)'),
      ('privado.familia_fiscal_vencida(uuid,integer)', 'IF privado.familia_dinero_pendiente(p_familia_id) THEN'),
      ('privado.familia_fiscal_vencida(uuid,integer)', 'privado.curso_vencido(v_centro, v_baja, p_anios)'),
      ('public.destruir_fiscal_familia(uuid,integer)', 'NOT privado.familia_fiscal_vencida(p_familia_id, p_anios)'),
      ('public.destruir_cuentas_olvidadas(boolean)', 'EXCEPTION WHEN foreign_key_violation THEN'),
      ('privado.familia_dinero_pendiente(uuid)', '(r.estado = ''pendiente_procesar'' AND r.total_centimos > 0)'),
      ('privado.bloqueos_por_plazo(uuid,uuid)', 'WHERE b->>''codigo'' <> ''recibos_pendientes'''),
      ('privado.bloqueos_por_plazo(uuid,uuid)', 'AND privado.familia_dinero_pendiente(ft.familia_id))'),
      ('privado.cuenta_vencida(uuid,uuid,integer)', 'jsonb_array_length(privado.bloqueos_por_plazo(p_usuario_id, p_centro_id)) = 0'),
      ('privado.cuenta_vencida(uuid,uuid,integer)', 'NOT privado.retenido(p_centro_id, ''usuario'', p_usuario_id)'),
      ('public.purgar_sujeto_db(uuid)', 'THEN privado.bloqueos_por_plazo(s.sujeto_id, s.centro_id)'),
      ('public.purgar_sujeto_db(uuid)', 'IF s.por_plazo AND NOT privado.cuenta_purgable(s.sujeto_id, s.centro_id) THEN'),
      ('public.purgar_sujeto_db(uuid)', 'IF privado.retenido(s.centro_id, s.sujeto_tipo::text, s.sujeto_id) THEN')
    ) AS t(f, ancla)
  LOOP
    IF strpos((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure(v_f)), v_src) = 0 THEN
      RAISE EXCEPTION 'guarda posterior: a % le falta «%»', v_f, v_src;
    END IF;
  END LOOP;

  IF has_function_privilege('authenticated', 'public.purgar_sujeto_db(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.purgar_sujeto_db(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'guarda posterior: purgar_sujeto_db no puede abrirse a las sesiones';
  END IF;

  RAISE NOTICE 'guarda posterior: funciones creadas y cerradas; md5 % (cuenta_vencida), % (purgar_sujeto_db)',
    (SELECT md5(regexp_replace(regexp_replace(replace(prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
       FROM pg_proc WHERE oid = 'privado.cuenta_vencida(uuid,uuid,integer)'::regprocedure),
    (SELECT md5(regexp_replace(regexp_replace(replace(prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
       FROM pg_proc WHERE oid = 'public.purgar_sujeto_db(uuid)'::regprocedure);
END
$guarda$;
