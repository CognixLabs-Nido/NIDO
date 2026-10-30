-- =============================================================================
-- FEAT — El estado de conservación del niño (PR-B2) y la ficha médica bloqueada para la admin
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/retencion-plazos.md. Decisiones del responsable del 2026-10-30 (ADR-0064).
--
--   · `public.estado_retencion_nino(niño, plazos…)`: lo que pasa con cada dato del niño, con su
--     fecha o con el motivo de que no la haya: la ficha médica, el día a día, las firmas, el
--     expediente, lo fiscal de su familia y la cuenta de cada adulto. Los plazos llegan como
--     parámetros desde las constantes de la app, como en el cron: si cambia un plazo, cambian a la
--     vez la purga y lo que se enseña. La pantalla no calcula nada. La ve Dirección
--     (`es_admin` del centro del niño); son fechas, no datos.
--   · `privado.plazo_vence` y `privado.curso_vence`: el día en que vence un plazo, con la misma
--     regla que `plazo_cumplido` y `curso_vencido` (al día siguiente, en Madrid, más los años).
--   · `privado.operativa_fechas(tabla)`: la fecha de cada registro de la operativa, de la que cuenta
--     su plazo, y el niño al que pertenece. `privado.operativa_vencida` pasa a leerla: la purga y el
--     estado usan la misma fecha. En una conversación, la más tardía entre la suya y la de sus
--     mensajes: equivale a «vencida y sin mensajes por vencer», porque `curso_vencido` no deja de
--     cumplirse al adelantar la fecha.
--   · `ver_datos_bloqueados` entrega a la admin, con motivo, la ficha médica bloqueada del niño de
--     baja (art. 32 LOPDGDD: lo bloqueado solo se pone a disposición de jueces, tribunales,
--     Ministerio Fiscal y Administraciones competentes). Hasta ahora solo cubría al purgado, y la
--     ficha de un niño de baja, bloqueada desde el final del curso, no la podía leer nadie. Solo la
--     lee, no la escribe: los setters siguen contestando 55000. La lectura queda dos veces: en
--     `accesos_datos_bloqueados` y en `lecturas_ficha_medica` (origen `datos_bloqueados`).
--     `sujetos_bloqueados` lista también a esos niños.
--
-- La aplica el responsable por SQL Editor. Sin orden obligado con el despliegue: la app vieja no
-- llama a `estado_retencion_nino` ni pide la ficha a `ver_datos_bloqueados`, y lo que cambia en
-- `operativa_vencida` no cambia qué devuelve. Tras aplicar: registrar en
-- supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
-- Los cuerpos vivos son los de sus migraciones (md5 normalizado: sin \r, sin comentarios, espacios
-- colapsados; el SQL Editor guarda CRLF y a veces se come los comentarios).
DO $guarda$
DECLARE
  r     record;
  v_md5 text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('privado.operativa_vencida(text,integer)', 'f49737d26a14ee6adbf937a4e979d3c5', '20261203120000'),
      ('privado.curso_vencido(uuid,date,integer)', 'bf295802894cacc6863b4caa2ea8e3fd', '20261203120000'),
      ('privado.plazo_cumplido(date,integer)', 'f1f0e2f34b8530d266dfea647c82ea10', '20261207120000'),
      ('privado.ficha_medica_bloqueada_desde(uuid)', '3c9e25692af575cbfb75468f1925bf78', '20261210120000'),
      ('privado.contenido_bloqueado(uuid,text,uuid)', '16de04f69d0cdac20a5ecd54b053ccf8', '20261205120000'),
      ('public.ver_datos_bloqueados(uuid,text,uuid,text,text,text)', '1ae0d390866f7cf9877fe648aa59674a', '20261205120000'),
      ('public.sujetos_bloqueados(uuid)', 'f4979cf5a956218451de22bfa45841a8', '20261205120000')
    ) AS t(f, md5, mig)
  LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f);
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION '% no es la de %: %', r.f, r.mig, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;

  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conname = 'lecturas_ficha_medica_origen_check')
     IS DISTINCT FROM 'CHECK ((origen = ANY (ARRAY[''ficha''::text, ''alta''::text, ''export''::text])))' THEN
    RAISE EXCEPTION 'el CHECK del origen de las lecturas no es el de 20261128120000';
  END IF;

  RAISE NOTICE 'guarda previa: % niños de baja, % purgados, % lecturas de la ficha',
    (SELECT count(*) FROM public.ninos WHERE deleted_reason = 'baja_nino'),
    (SELECT count(*) FROM public.ninos WHERE deleted_reason = 'purga_rgpd'),
    (SELECT count(*) FROM public.lecturas_ficha_medica);
END
$guarda$;

-- ---- 1. El día en que vence un plazo ----
-- Misma regla que `plazo_cumplido`: cumplido cuando ha pasado el día siguiente a la fecha, en
-- Madrid, más los años. Devuelve ese día: a partir de él se borra. NULL sin fecha.
CREATE FUNCTION privado.plazo_vence(p_fecha date, p_anios integer)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT (p_fecha + 1 + make_interval(years => p_anios))::date;
$function$;
REVOKE ALL ON FUNCTION privado.plazo_vence(date, integer) FROM PUBLIC, anon, authenticated;

-- Misma regla que `curso_vencido`: el primer curso del centro que termina en la fecha o después,
-- el día siguiente a su final, más los años. NULL si el centro aún no tiene ese curso.
CREATE FUNCTION privado.curso_vence(p_centro_id uuid, p_fecha date, p_anios integer)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT (min(c.fecha_fin) + 1 + make_interval(years => p_anios))::date
    FROM public.cursos_academicos c
   WHERE c.centro_id = p_centro_id AND c.deleted_at IS NULL AND c.fecha_fin >= p_fecha;
$function$;
REVOKE ALL ON FUNCTION privado.curso_vence(uuid, date, integer) FROM PUBLIC, anon, authenticated;

-- ---- 2. La fecha de cada registro de la operativa, en un solo sitio ----
-- La fecha de la que cuenta su plazo (la más tardía del registro, también la de alta) y el niño al
-- que pertenece (el de la purga del olvido, `olvido_borrar_operativa_nino`; NULL si no es de un
-- niño). Las mismas expresiones que tenía `operativa_vencida` (20261203120000).
CREATE FUNCTION privado.operativa_fechas(p_tabla text)
RETURNS TABLE (id uuid, centro_id uuid, nino_id uuid, fecha date)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $function$
BEGIN
  CASE p_tabla
  WHEN 'agendas_diarias' THEN
    RETURN QUERY SELECT a.id, n.centro_id, a.nino_id, a.fecha
      FROM public.agendas_diarias a JOIN public.ninos n ON n.id = a.nino_id;
  WHEN 'asistencias' THEN
    RETURN QUERY SELECT a.id, n.centro_id, a.nino_id, a.fecha
      FROM public.asistencias a JOIN public.ninos n ON n.id = a.nino_id;
  WHEN 'ausencias' THEN
    RETURN QUERY SELECT a.id, n.centro_id, a.nino_id,
                        GREATEST(a.fecha_fin, (a.created_at AT TIME ZONE 'Europe/Madrid')::date)
      FROM public.ausencias a JOIN public.ninos n ON n.id = a.nino_id;
  WHEN 'informes_evolucion' THEN
    RETURN QUERY SELECT i.id, i.centro_id, i.nino_id,
                        GREATEST(c.fecha_fin, (i.updated_at AT TIME ZONE 'Europe/Madrid')::date)
      FROM public.informes_evolucion i JOIN public.cursos_academicos c ON c.id = i.curso_academico_id;
  WHEN 'mensajes' THEN
    RETURN QUERY SELECT m.id, v.centro_id, v.nino_id, (m.created_at AT TIME ZONE 'Europe/Madrid')::date
      FROM public.mensajes m JOIN public.conversaciones v ON v.id = m.conversacion_id;
  WHEN 'conversaciones' THEN
    -- La más tardía entre la suya y la de sus mensajes: vence cuando ella y todos sus mensajes han
    -- vencido.
    RETURN QUERY SELECT v.id, v.centro_id, v.nino_id,
                        GREATEST((v.created_at AT TIME ZONE 'Europe/Madrid')::date, mm.ultima)
      FROM public.conversaciones v
      LEFT JOIN LATERAL (SELECT max((m.created_at AT TIME ZONE 'Europe/Madrid')::date) AS ultima
                           FROM public.mensajes m WHERE m.conversacion_id = v.id) mm ON true;
  WHEN 'citas' THEN
    RETURN QUERY SELECT c.id, c.centro_id, c.nino_id,
                        GREATEST(c.fecha, (c.created_at AT TIME ZONE 'Europe/Madrid')::date)
      FROM public.citas c;
  WHEN 'recordatorios' THEN
    RETURN QUERY SELECT r.id, r.centro_id, r.nino_id,
                        GREATEST((r.created_at AT TIME ZONE 'Europe/Madrid')::date,
                                 (r.vencimiento AT TIME ZONE 'Europe/Madrid')::date)
      FROM public.recordatorios r;
  WHEN 'confirmaciones_evento' THEN
    RETURN QUERY SELECT ce.id, e.centro_id, ce.nino_id,
                        GREATEST(COALESCE(e.fecha_fin, e.fecha), (ce.created_at AT TIME ZONE 'Europe/Madrid')::date)
      FROM public.confirmaciones_evento ce JOIN public.eventos e ON e.id = ce.evento_id;
  ELSE
    RAISE EXCEPTION 'tabla de operativa desconocida: %', p_tabla USING ERRCODE = 'invalid_parameter_value';
  END CASE;
END;
$function$;
REVOKE ALL ON FUNCTION privado.operativa_fechas(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION privado.operativa_vencida(p_tabla text, p_anios integer)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $function$
BEGIN
  RETURN QUERY SELECT f.id FROM privado.operativa_fechas(p_tabla) f
                WHERE privado.curso_vencido(f.centro_id, f.fecha, p_anios);
END;
$function$;

-- ---- 3. La ficha médica bloqueada, para la admin ----
ALTER TABLE public.lecturas_ficha_medica DROP CONSTRAINT lecturas_ficha_medica_origen_check;
ALTER TABLE public.lecturas_ficha_medica ADD CONSTRAINT lecturas_ficha_medica_origen_check
  CHECK (origen IN ('ficha', 'alta', 'export', 'datos_bloqueados'));

-- El niño de baja con la ficha bloqueada (no purgado: el purgado ya lo cubría `nino_bloqueado`).
CREATE OR REPLACE FUNCTION public.ver_datos_bloqueados(
  p_centro_id uuid, p_sujeto_tipo text, p_sujeto_id uuid,
  p_motivo_tipo text, p_motivo text, p_accion text DEFAULT 'ver')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_bloqueado boolean;
  v_desde     date;
  v_contenido jsonb;
  v_apartados text[];
  v_ficha     boolean := false;
  v_clave     text;
  v_ime       public.info_medica_emergencia%ROWTYPE;
  v_campos    text[] := '{}';
BEGIN
  IF v_uid IS NULL OR p_centro_id IS NULL OR NOT privado.es_titular(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado a ver lo bloqueado de este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_motivo_tipo IS NULL OR p_motivo_tipo NOT IN ('agencia_tributaria', 'juzgado', 'reclamacion',
                                                    'proteccion_datos', 'otro')
     OR p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 10 AND 1000
     OR p_accion IS NULL OR p_accion NOT IN ('ver', 'descargar') THEN
    RAISE EXCEPTION 'hace falta un motivo (de 10 a 1000 caracteres) y su tipo'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'motivo';
  END IF;

  IF p_sujeto_tipo = 'nino' THEN
    IF privado.centro_de_nino(p_sujeto_id) IS DISTINCT FROM p_centro_id THEN
      v_bloqueado := false;
    ELSIF privado.nino_bloqueado(p_sujeto_id) THEN
      v_bloqueado := true;
      v_desde := privado.nino_bloqueado_desde(p_sujeto_id);
    ELSE
      -- De baja y con la ficha bloqueada (20261211120000): se entrega solo la ficha.
      v_desde := privado.ficha_medica_bloqueada_desde(p_sujeto_id);
      v_ficha := v_desde IS NOT NULL;
      v_bloqueado := v_ficha;
    END IF;
  ELSIF p_sujeto_tipo = 'usuario' THEN
    v_bloqueado := privado.usuario_olvidado_en(p_sujeto_id, p_centro_id);
    v_desde := privado.usuario_olvidado_desde(p_sujeto_id, p_centro_id);
  ELSE
    RAISE EXCEPTION 'tipo de sujeto inválido' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT COALESCE(v_bloqueado, false) THEN
    RAISE EXCEPTION 'este sujeto no tiene nada bloqueado en este centro'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'no_bloqueado';
  END IF;

  IF v_ficha THEN
    -- Descifrada aquí, en la misma transacción que deja las dos filas. Solo se lee: los setters
    -- siguen contestando 55000 con la ficha bloqueada.
    v_clave := public._get_medical_key();
    SELECT * INTO v_ime FROM public.info_medica_emergencia WHERE nino_id = p_sujeto_id;
    IF FOUND THEN
      v_campos := array_remove(ARRAY[
        CASE WHEN v_ime.alergias_graves     IS NOT NULL THEN 'alergias_graves' END,
        CASE WHEN v_ime.notas_emergencia    IS NOT NULL THEN 'notas_emergencia' END,
        CASE WHEN v_ime.medicacion_habitual IS NOT NULL THEN 'medicacion_habitual' END,
        CASE WHEN v_ime.alergias_leves      IS NOT NULL THEN 'alergias_leves' END,
        CASE WHEN v_ime.medico_familia      IS NOT NULL THEN 'medico_familia' END,
        CASE WHEN v_ime.telefono_emergencia IS NOT NULL THEN 'telefono_emergencia' END], NULL);
      v_contenido := jsonb_build_object('ficha_medica', jsonb_build_array(jsonb_build_object(
        'alergias_graves', extensions.pgp_sym_decrypt(v_ime.alergias_graves, v_clave),
        'notas_emergencia', extensions.pgp_sym_decrypt(v_ime.notas_emergencia, v_clave),
        'medicacion_habitual', extensions.pgp_sym_decrypt(v_ime.medicacion_habitual, v_clave),
        'alergias_leves', extensions.pgp_sym_decrypt(v_ime.alergias_leves, v_clave),
        'medico_familia', extensions.pgp_sym_decrypt(v_ime.medico_familia, v_clave),
        'telefono_emergencia', extensions.pgp_sym_decrypt(v_ime.telefono_emergencia, v_clave))));
    ELSE
      v_contenido := jsonb_build_object('ficha_medica', '[]'::jsonb);
    END IF;
    INSERT INTO public.lecturas_ficha_medica (nino_id, centro_id, lector_id, rol_lector, origen, campos)
    VALUES (p_sujeto_id, p_centro_id, v_uid, 'admin', 'datos_bloqueados', v_campos);
  ELSE
    v_contenido := privado.contenido_bloqueado(p_centro_id, p_sujeto_tipo, p_sujeto_id);
  END IF;
  SELECT COALESCE(array_agg(k ORDER BY k), '{}') INTO v_apartados
    FROM jsonb_each(v_contenido) AS e(k, v) WHERE jsonb_array_length(v) > 0;

  INSERT INTO public.accesos_datos_bloqueados
    (centro_id, sujeto_tipo, sujeto_id, lector_id, motivo_tipo, motivo, accion, apartados)
  VALUES (p_centro_id, p_sujeto_tipo::public.olvido_sujeto_tipo, p_sujeto_id, v_uid,
          p_motivo_tipo, btrim(p_motivo), p_accion, v_apartados);

  RETURN jsonb_build_object('bloqueado_desde', v_desde, 'apartados', v_contenido);
END;
$function$;

-- La lista: también los niños de baja con la ficha bloqueada, desde el día en que se bloqueó.
CREATE OR REPLACE FUNCTION public.sujetos_bloqueados(p_centro_id uuid)
RETURNS TABLE (sujeto_tipo text, sujeto_id uuid, bloqueado_desde date, familia text,
               aula text, curso text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL OR p_centro_id IS NULL OR NOT privado.es_titular(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado a ver lo bloqueado de este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT 'nino'::text, n.id,
         COALESCE(privado.nino_bloqueado_desde(n.id), privado.ficha_medica_bloqueada_desde(n.id)),
         f.etiqueta, um.aula, um.curso
    FROM public.ninos n
    LEFT JOIN public.familias f ON f.id = n.familia_id
    LEFT JOIN LATERAL (
      SELECT a.nombre AS aula, ca.nombre AS curso
        FROM public.matriculas m
        JOIN public.aulas a ON a.id = m.aula_id
        JOIN public.cursos_academicos ca ON ca.id = m.curso_academico_id
       WHERE m.nino_id = n.id AND m.deleted_at IS NULL
       ORDER BY ca.fecha_inicio DESC, m.fecha_alta DESC
       LIMIT 1) um ON true
   WHERE n.centro_id = p_centro_id
     AND (n.deleted_reason = 'purga_rgpd'
          OR (n.deleted_reason = 'baja_nino' AND privado.ficha_medica_bloqueada_desde(n.id) IS NOT NULL))
  UNION ALL
  SELECT 'usuario'::text, s.sujeto_id, privado.usuario_olvidado_desde(s.sujeto_id, p_centro_id),
         (SELECT f.etiqueta FROM public.familia_tutores ft JOIN public.familias f ON f.id = ft.familia_id
           WHERE ft.usuario_id = s.sujeto_id AND ft.centro_id = p_centro_id
           ORDER BY ft.created_at DESC LIMIT 1),
         NULL::text, NULL::text
    FROM (SELECT DISTINCT o.sujeto_id FROM public.olvido_solicitudes o
           WHERE o.sujeto_tipo = 'usuario' AND o.centro_id = p_centro_id
             AND o.purgado_en IS NOT NULL) s
   ORDER BY 3 DESC NULLS LAST;
END;
$function$;

-- ---- 4. El estado de conservación del niño ----
-- Una entrada por dato, con `estado` y, según el caso, `desde`, `hasta` (el día a partir del que
-- se borra) o `motivo` (por qué no hay fecha). Las fechas pasadas se dicen como hechos: «borrado»
-- solo si el dato ya no está (o con la fecha de la purga); si el plazo venció y sigue ahí,
-- `vencido`. Los plazos, en años, son los de la app.
CREATE FUNCTION public.estado_retencion_nino(
  p_nino_id uuid, p_anios_expediente integer, p_anios_firmas integer, p_anios_operativa integer,
  p_anios_fiscal integer, p_anios_cuenta integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_hoy        date := public.hoy_madrid();
  n            public.ninos%ROWTYPE;
  v_purgado    boolean;
  v_purga      date;
  v_baja       date;
  v_retenido   boolean;
  v_exp        date;
  v_medicos    jsonb;
  v_expediente jsonb;
  v_operativa  jsonb;
  v_firmas     jsonb;
  v_fiscal     jsonb;
  v_cuentas    jsonb := '[]'::jsonb;
  v_bloq       date;
  v_firma_vence date;
  v_n          bigint;
  v_sin_curso  boolean;
  v_ultima     date;
  v_motivos    text[];
  v_pago       date;
  v_hasta      date;
  a            record;
  v_cbaja      date;
  v_cvence     date;
BEGIN
  IF p_anios_expediente IS NULL OR p_anios_expediente < 1 OR p_anios_firmas IS NULL OR p_anios_firmas < 1
     OR p_anios_operativa IS NULL OR p_anios_operativa < 1 OR p_anios_fiscal IS NULL OR p_anios_fiscal < 1
     OR p_anios_cuenta IS NULL OR p_anios_cuenta < 1 THEN
    RAISE EXCEPTION 'plazos no válidos' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO n FROM public.ninos WHERE id = p_nino_id;
  -- Sin centro, `es_admin(NULL)` daría TRUE a cualquier persona de Dirección: el que no existe
  -- recibe lo mismo que el de otro centro.
  IF auth.uid() IS NULL OR NOT FOUND OR NOT public.es_admin(n.centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Con el niño activo `deleted_reason` es NULL: la comparación tiene que dar FALSE, no NULL.
  v_purgado := n.deleted_reason IS NOT DISTINCT FROM 'purga_rgpd';
  v_purga := (COALESCE(n.purgado_en, n.deleted_at) AT TIME ZONE 'Europe/Madrid')::date;
  v_baja := privado.fecha_baja_destruccion(n.id);
  v_retenido := privado.retenido(n.centro_id, 'nino', n.id);

  IF NOT v_purgado AND v_baja IS NULL THEN
    RETURN jsonb_build_object('estado', 'activo');
  END IF;

  -- El expediente: la purga a los años de la baja. La ficha médica se vacía con ella.
  v_exp := privado.plazo_vence(v_baja, p_anios_expediente);
  v_expediente := CASE
    WHEN v_purgado THEN jsonb_build_object('estado', 'borrado', 'desde', v_purga)
    WHEN v_retenido THEN jsonb_build_object('estado', 'sin_fecha', 'motivo', 'retenido')
    WHEN v_exp <= v_hoy THEN jsonb_build_object('estado', 'vencido', 'hasta', v_exp)
    ELSE jsonb_build_object('estado', 'se_borrara', 'hasta', v_exp) END;

  -- La ficha médica: bloqueada al terminar el curso de la baja (o desde la purga) y vaciada con la
  -- purga.
  IF v_purgado THEN
    v_medicos := jsonb_build_object('estado', 'borrados', 'desde', v_purga);
  ELSE
    v_bloq := privado.ficha_medica_bloqueada_desde(n.id);
    v_medicos := CASE
      WHEN v_bloq IS NOT NULL THEN jsonb_build_object('estado', 'bloqueados', 'desde', v_bloq)
      ELSE jsonb_build_object('estado', 'a_la_vista', 'desde', privado.curso_vence(n.centro_id, v_baja, 0))
    END || jsonb_build_object('borrado', v_expediente);
  END IF;

  -- El día a día: cada registro, al año del final de su curso. Se dice el último.
  IF v_purgado THEN
    v_operativa := jsonb_build_object('estado', 'borrado', 'desde', v_purga);
  ELSE
    SELECT count(*), bool_or(x.vence IS NULL), max(x.vence) INTO v_n, v_sin_curso, v_ultima
      FROM (SELECT privado.curso_vence(f.centro_id, f.fecha, p_anios_operativa) AS vence
              FROM unnest(ARRAY['agendas_diarias', 'asistencias', 'ausencias', 'informes_evolucion',
                                'conversaciones', 'mensajes', 'citas', 'recordatorios',
                                'confirmaciones_evento']) t(tabla)
             CROSS JOIN LATERAL privado.operativa_fechas(t.tabla) f
             WHERE f.nino_id = n.id) x;
    v_operativa := CASE
      WHEN v_n = 0 THEN jsonb_build_object('estado', 'nada')
      WHEN v_sin_curso THEN jsonb_build_object('estado', 'sin_fecha', 'motivo', 'sin_curso')
      WHEN v_ultima <= v_hoy THEN jsonb_build_object('estado', 'vencido', 'hasta', v_ultima)
      ELSE jsonb_build_object('estado', 'por_partes', 'hasta', v_ultima) END;
  END IF;

  -- Firmas, consentimientos, acuses y medicación administrada: se bloquean con la purga y se
  -- destruyen a los años de la baja, con el niño purgado.
  v_firma_vence := privado.plazo_vence(v_baja, p_anios_firmas);
  v_firmas := CASE
    WHEN NOT privado.queda_conservado_nino(n.id) THEN jsonb_build_object('estado', 'nada')
    WHEN v_retenido THEN jsonb_build_object('estado', CASE WHEN v_purgado THEN 'bloqueados' ELSE 'a_la_vista' END,
                                            'desde', CASE WHEN v_purgado THEN v_purga END,
                                            'motivo', 'retenido')
    WHEN v_purgado THEN jsonb_build_object('estado', 'bloqueados', 'desde', v_purga,
                                           'hasta', v_firma_vence, 'vencido', v_firma_vence <= v_hoy)
    ELSE jsonb_build_object('estado', 'a_la_vista', 'bloqueo', v_expediente,
                            'hasta', v_firma_vence) END;

  -- Lo fiscal de la familia: a la vista, al menos hasta el plazo desde el último recibo pagado (o
  -- desde el final del curso de la última baja, sin ninguno). Lo que hoy lo frena, en `motivos`.
  v_motivos := array_remove(ARRAY[
    CASE WHEN EXISTS (SELECT 1 FROM public.ninos h
                       WHERE h.familia_id = n.familia_id AND h.id <> n.id
                         AND h.deleted_reason IS DISTINCT FROM 'purga_rgpd'
                         AND privado.fecha_baja_destruccion(h.id) IS NULL) THEN 'otro_hijo' END,
    CASE WHEN privado.familia_dinero_pendiente(n.familia_id) THEN 'dinero_pendiente' END,
    CASE WHEN EXISTS (SELECT 1 FROM public.ninos h
                       WHERE h.familia_id = n.familia_id AND privado.retenido(n.centro_id, 'nino', h.id))
           OR EXISTS (SELECT 1 FROM privado.familia_adultos(n.familia_id) fa(usuario_id)
                       WHERE privado.retenido(n.centro_id, 'usuario', fa.usuario_id)) THEN 'retenido' END],
    NULL);
  v_pago := privado.familia_ultimo_pago(n.familia_id);
  IF v_pago IS NOT NULL THEN
    v_hasta := privado.plazo_vence(v_pago, p_anios_fiscal);
  ELSE
    SELECT privado.curso_vence(n.centro_id, max(privado.fecha_baja_destruccion(h.id)), p_anios_fiscal)
      INTO v_hasta FROM public.ninos h WHERE h.familia_id = n.familia_id;
  END IF;
  v_fiscal := CASE
    WHEN cardinality(v_motivos) > 0 THEN jsonb_build_object('estado', 'sin_fecha', 'motivos', to_jsonb(v_motivos))
    WHEN v_hasta IS NULL THEN jsonb_build_object('estado', 'sin_fecha', 'motivos', jsonb_build_array('sin_curso'))
    ELSE jsonb_build_object('estado', 'a_la_vista', 'hasta', v_hasta, 'vencido', v_hasta <= v_hoy,
                            'desde_pago', v_pago IS NOT NULL) END;

  -- La cuenta de cada adulto de la familia: a los años de la baja de su último hijo en el centro.
  FOR a IN
    SELECT fa.usuario_id, u.nombre_completo
      FROM privado.familia_adultos(n.familia_id) fa(usuario_id)
      LEFT JOIN public.usuarios u ON u.id = fa.usuario_id
     ORDER BY u.nombre_completo
  LOOP
    v_cbaja := privado.cuenta_baja(a.usuario_id, n.centro_id);
    v_cvence := privado.plazo_vence(v_cbaja, p_anios_cuenta);
    -- Entre paréntesis: `lista || objeto || objeto` añadiría el segundo como otro elemento.
    v_cuentas := v_cuentas || (jsonb_build_object(
      'usuario_id', a.usuario_id,
      'nombre', CASE WHEN privado.usuario_olvidado_en(a.usuario_id, n.centro_id) THEN NULL ELSE a.nombre_completo END,
      'baja_ultimo_hijo', v_cbaja,
      'por_otro_hijo', v_cbaja IS NOT NULL AND v_cbaja IS DISTINCT FROM v_baja)
      || CASE
        WHEN privado.usuario_olvidado_en(a.usuario_id, n.centro_id) THEN
          jsonb_build_object('estado', 'borrada', 'desde', privado.usuario_olvidado_desde(a.usuario_id, n.centro_id))
        WHEN EXISTS (SELECT 1 FROM public.roles_usuario r
                      WHERE r.usuario_id = a.usuario_id AND r.centro_id = n.centro_id
                        AND r.deleted_at IS NULL AND r.rol NOT IN ('tutor_legal', 'autorizado')) THEN
          jsonb_build_object('estado', 'sin_fecha', 'motivo', 'trabaja_en_centro')
        WHEN v_cbaja IS NULL THEN jsonb_build_object('estado', 'sin_fecha', 'motivo', 'otro_hijo')
        WHEN privado.retenido(n.centro_id, 'usuario', a.usuario_id) THEN
          jsonb_build_object('estado', 'sin_fecha', 'motivo', 'retenido')
        WHEN jsonb_array_length(privado.bloqueos_por_plazo(a.usuario_id, n.centro_id)) > 0 THEN
          jsonb_build_object('estado', 'sin_fecha', 'motivo',
            CASE WHEN privado.bloqueos_por_plazo(a.usuario_id, n.centro_id) @> '[{"codigo": "dinero_vivo"}]'
                 THEN 'dinero_pendiente' ELSE 'otro_bloqueo' END)
        WHEN v_cvence <= v_hoy THEN jsonb_build_object('estado', 'vencido', 'hasta', v_cvence)
        ELSE jsonb_build_object('estado', 'se_borrara', 'hasta', v_cvence) END);
  END LOOP;

  RETURN jsonb_build_object(
    'estado', CASE WHEN v_purgado THEN 'purgado' ELSE 'baja' END,
    'baja', v_baja,
    'retenido', v_retenido,
    -- El camino a lo bloqueado: solo la admin, y solo si hay algo que ver (`ver_datos_bloqueados`).
    'puede_ver_bloqueado', privado.es_titular(n.centro_id)
                           AND (v_purgado OR privado.ficha_medica_bloqueada_desde(n.id) IS NOT NULL),
    'medicos', v_medicos,
    'operativa', v_operativa,
    'firmas', v_firmas,
    'expediente', v_expediente,
    'fiscal', v_fiscal,
    'cuentas', v_cuentas);
END;
$function$;
REVOKE ALL ON FUNCTION public.estado_retencion_nino(uuid, integer, integer, integer, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estado_retencion_nino(uuid, integer, integer, integer, integer, integer)
  TO authenticated;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  r     record;
  v_md5 text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('privado.curso_vencido(uuid,date,integer)', 'bf295802894cacc6863b4caa2ea8e3fd'),
      ('privado.plazo_cumplido(date,integer)', 'f1f0e2f34b8530d266dfea647c82ea10'),
      ('privado.ficha_medica_bloqueada_desde(uuid)', '3c9e25692af575cbfb75468f1925bf78'),
      ('privado.contenido_bloqueado(uuid,text,uuid)', '16de04f69d0cdac20a5ecd54b053ccf8')
    ) AS t(f, md5)
  LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f);
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION '% no quedó como se esperaba: %', r.f, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;

  -- La purga de la operativa lee la fecha de `operativa_fechas`, y nada más la lleva escrita.
  IF strpos((SELECT prosrc FROM pg_proc WHERE oid = 'privado.operativa_vencida(text,integer)'::regprocedure),
            'privado.operativa_fechas(') = 0
     OR strpos((SELECT prosrc FROM pg_proc WHERE oid = 'privado.operativa_vencida(text,integer)'::regprocedure),
               'AT TIME ZONE') > 0 THEN
    RAISE EXCEPTION 'operativa_vencida no lee la fecha de operativa_fechas';
  END IF;

  -- La ficha bloqueada: la entrega solo `ver_datos_bloqueados`, que deja las dos filas.
  IF strpos((SELECT prosrc FROM pg_proc WHERE oid = 'public.ver_datos_bloqueados(uuid,text,uuid,text,text,text)'::regprocedure),
            '''datos_bloqueados''') = 0 THEN
    RAISE EXCEPTION 'ver_datos_bloqueados no registra la lectura de la ficha';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'lecturas_ficha_medica_origen_check')
     IS DISTINCT FROM 'CHECK ((origen = ANY (ARRAY[''ficha''::text, ''alta''::text, ''export''::text, ''datos_bloqueados''::text])))' THEN
    RAISE EXCEPTION 'el CHECK del origen de las lecturas no quedó como se esperaba';
  END IF;

  -- Permisos: el estado, para quien tiene sesión (lo filtra `es_admin` dentro); los auxiliares, de nadie.
  IF NOT has_function_privilege('authenticated', 'public.estado_retencion_nino(uuid,integer,integer,integer,integer,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.estado_retencion_nino(uuid,integer,integer,integer,integer,integer)', 'EXECUTE')
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.estado_retencion_nino(uuid,integer,integer,integer,integer,integer)'::regprocedure)
     OR has_function_privilege('authenticated', 'privado.plazo_vence(date,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'privado.curso_vence(uuid,date,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'privado.operativa_fechas(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.ver_datos_bloqueados(uuid,text,uuid,text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.sujetos_bloqueados(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'una función quedó con los permisos que no toca';
  END IF;

  RAISE NOTICE 'guarda posterior: % niños de baja con la ficha bloqueada, % purgados',
    (SELECT count(*) FROM public.ninos n
      WHERE n.deleted_reason = 'baja_nino' AND privado.ficha_medica_bloqueada_desde(n.id) IS NOT NULL),
    (SELECT count(*) FROM public.ninos WHERE deleted_reason = 'purga_rgpd');
END
$guarda$;
