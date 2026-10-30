-- =============================================================================
-- FEAT — Los cabos de la retención (PR-A2): export_log a 5 años, la purga del alta abandonada
-- fuera, la ficha médica del niño purgado bloqueada y un comentario que nombraba a esa purga
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/retencion-plazos.md. Ahora:
--
--   · `public.purgar_export_log(años, simular)`, para el cron: borra las filas de `export_log`
--     de más de N años (`RETENCION_REGISTROS_DERECHOS_ANIOS`, 5, provisional) desde su
--     `created_at`. En simulación solo cuenta. `export_log` no se audita: no deja copias. Las
--     peticiones de olvido (`olvido_solicitudes`) no tienen plazo: ninguna se borra por tiempo.
--   · `public.purgar_esqueleto_huerfano_nino` se retira. El barrido dejó de llamarla en
--     20261209120000 (el alta que no se termina la borra Dirección con `anular_alta`), y ninguna
--     función la llama.
--   · `privado.ficha_medica_bloqueada_desde(niño)` cuenta también desde la purga: con el niño
--     purgado (`purgado_en`, o `deleted_reason = 'purga_rgpd'`) está bloqueada desde la purga.
--     Hasta ahora solo miraba al niño de baja (`fecha_baja_nino` pide `baja_nino`), y con un
--     purgado Dirección pasaba la autorización: `get_info_medica_emergencia` dejaba su fila en
--     `lecturas_ficha_medica` y los setters podían volver a escribir la ficha vaciada. Las cinco
--     funciones de la ficha la llaman y no cambian: contestan 55000 con la fecha en DETAIL, sin
--     registrar la lectura, y `alertas_medicas` no da su aviso. La fecha: `purgado_en`, o el
--     archivado (`deleted_at`, que el CHECK `ninos_deleted_reason_coherente` exige con el motivo).
--   · `privado.purgar_nino`: literal de 20261205120000 salvo el comentario que nombraba a la
--     función retirada.
--
-- La aplica el responsable por SQL Editor. Sin orden obligado con el despliegue: el cron llama a
-- `purgar_export_log` solo con el código nuevo, y el viejo ya no llama a la función que se retira
-- (desde 20261209120000). Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
-- Los cuerpos vivos son los de sus migraciones (md5 normalizado: sin \r, sin comentarios, espacios
-- colapsados; el SQL Editor guarda CRLF y a veces se come los comentarios).
DO $guarda$
DECLARE
  r     record;
  v_md5 text;
  v_n   bigint;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('privado.ficha_medica_bloqueada_desde(uuid)', '1c2443d0581c8f400fa35144ff9c02ba', '20261204120000'),
      ('privado.fecha_baja_nino(uuid)', '0522d50b325eddfc8a57cf7d4ab25263', '20261204120000'),
      ('privado.purgar_nino(uuid)', '53730ba72640c24f65ff81bf7ace7103', '20261205120000'),
      ('public.purgar_esqueleto_huerfano_nino(uuid,timestamptz)', '8f0bb351bd1d9025e982a8d643d6ec56', '20261129120000'),
      ('public.get_info_medica_emergencia(uuid,text)', '0b00f375d493666784a35991d1c99e7c', '20261204120000'),
      ('public.set_info_medica_emergencia_cifrada(uuid,text,text,text,text,text,text)', '2f256aaa2161e5cf9bb6dc7fe54c9ea4', '20261204120000'),
      ('public.set_info_medica_emergencia_cifrada_tutor(uuid,text,text,text,text,text,text,boolean)', 'b1c8ed86ca06000dfedda2c41e45f72c', '20261204120000'),
      ('public.borrar_info_medica_nino_tutor(uuid)', '67e1f083715d33f1001d3f526fad873e', '20261204120000'),
      ('public.alertas_medicas(uuid[])', '22567dca62ab4ff5b8d3bb9131419529', '20261204120000')
    ) AS t(f, md5, mig)
  LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f);
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION '% no es la de %: %', r.f, r.mig, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;

  -- Nadie llama a la función que se retira: solo la nombra el comentario de purgar_nino.
  SELECT count(*) INTO v_n FROM pg_proc p
   WHERE p.prosrc ILIKE '%purgar_esqueleto_huerfano_nino%'
     AND p.oid NOT IN ('public.purgar_esqueleto_huerfano_nino(uuid,timestamptz)'::regprocedure,
                       'privado.purgar_nino(uuid)'::regprocedure);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'hay % funciones que nombran a purgar_esqueleto_huerfano_nino', v_n;
  END IF;

  RAISE NOTICE 'guarda previa: % niños purgados, % filas en export_log (% de más de 5 años)',
    (SELECT count(*) FROM public.ninos WHERE purgado_en IS NOT NULL OR deleted_reason = 'purga_rgpd'),
    (SELECT count(*) FROM public.export_log),
    (SELECT count(*) FROM public.export_log WHERE created_at < now() - make_interval(years => 5));
END
$guarda$;

-- ---- 1. export_log a 5 años (plazo provisional, lo pasa el cron) ----
CREATE FUNCTION public.purgar_export_log(p_anios integer, p_simular boolean)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_n integer;
BEGIN
  IF p_anios IS NULL OR p_anios < 1 OR p_simular IS NULL THEN
    RAISE EXCEPTION 'plazo de export_log no válido' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_simular THEN
    SELECT count(*) INTO v_n FROM public.export_log
     WHERE created_at < now() - make_interval(years => p_anios);
  ELSE
    DELETE FROM public.export_log WHERE created_at < now() - make_interval(years => p_anios);
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.purgar_export_log(integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purgar_export_log(integer, boolean) TO service_role;

-- ---- 2. La purga del alta abandonada, fuera ----
DROP FUNCTION public.purgar_esqueleto_huerfano_nino(uuid, timestamptz);

-- ---- 3. La ficha médica, bloqueada también desde la purga ----
-- El niño purgado, desde la purga. El de baja, el día siguiente al final del primer curso del
-- centro que termina en la baja o después, si ya ha llegado (como en 20261204120000). NULL si no
-- está bloqueada.
CREATE OR REPLACE FUNCTION privado.ficha_medica_bloqueada_desde(p_nino_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT CASE
           WHEN n.purgado_en IS NOT NULL OR n.deleted_reason = 'purga_rgpd'
             THEN (COALESCE(n.purgado_en, n.deleted_at) AT TIME ZONE 'Europe/Madrid')::date
           WHEN b.fecha IS NOT NULL AND privado.curso_vencido(n.centro_id, b.fecha, 0)
             THEN (SELECT min(c.fecha_fin) FROM public.cursos_academicos c
                    WHERE c.centro_id = n.centro_id AND c.deleted_at IS NULL
                      AND c.fecha_fin >= b.fecha) + 1
         END
    FROM public.ninos n
   CROSS JOIN LATERAL (SELECT privado.fecha_baja_nino(n.id) AS fecha) b
   WHERE n.id = p_nino_id;
$function$;
REVOKE ALL ON FUNCTION privado.ficha_medica_bloqueada_desde(uuid) FROM PUBLIC, anon, authenticated;

-- ---- 4. purgar_nino, sin la función retirada en su comentario ----
CREATE OR REPLACE FUNCTION privado.purgar_nino(p_nino_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lista uuid[];
BEGIN
  -- D-5: motivo 'purga_rgpd' → desarchivar_nino RAISE (no reincorpora un sujeto purgado).
  UPDATE public.ninos SET
    nombre           = '[borrado]',
    apellidos        = '[borrado]',
    fecha_nacimiento = DATE '1900-01-01',
    sexo             = NULL,
    nacionalidad     = NULL,
    foto_url         = NULL,
    notas_admin      = NULL,
    -- Purga RGPD del niño: el resto de columnas personales de la ficha. idioma_principal
    -- es NOT NULL: 'zz' (no es un idioma, como en idiomas_casa) en vez de inventar 'es'. El
    -- CHECK solo admite 'zz' con deleted_reason = 'purga_rgpd', que pone este mismo UPDATE.
    idioma_principal     = 'zz',
    direccion_calle      = NULL,
    direccion_numero     = NULL,
    direccion_cp         = NULL,
    direccion_ciudad     = NULL,
    libro_familia_path   = NULL,
    estado_civil_familia = NULL,
    deleted_reason   = 'purga_rgpd',
    deleted_at       = COALESCE(deleted_at, now()),
    -- Retención (PR-7): desde cuándo está bloqueado lo que se conserva.
    purgado_en       = COALESCE(purgado_en, now())
  WHERE id = p_nino_id;

  UPDATE public.info_medica_emergencia SET
    alergias_graves     = NULL,
    notas_emergencia    = NULL,
    medicacion_habitual = NULL,
    alergias_leves      = NULL,
    medico_familia      = NULL,
    telefono_emergencia = NULL
  WHERE nino_id = p_nino_id;

  UPDATE public.datos_pedagogicos_nino SET
    lactancia_observaciones          = NULL,
    control_esfinteres_observaciones = NULL,
    siesta_horario_habitual          = NULL,
    siesta_observaciones             = NULL,
    alimentacion_observaciones       = CASE WHEN tipo_alimentacion = 'otra'
                                            THEN '[borrado]' ELSE NULL END,
    -- Purga RGPD del niño: el CHECK exige de 1 a 8 códigos de 2 letras; 'zz' no es un idioma.
    idiomas_casa                     = ARRAY['zz'],
    deleted_at                       = COALESCE(deleted_at, now())
  WHERE nino_id = p_nino_id;

  -- Purga RGPD del niño: el motivo de baja es texto libre del centro sobre el niño.
  UPDATE public.matriculas SET motivo_baja = NULL
  WHERE nino_id = p_nino_id AND motivo_baja IS NOT NULL;

  -- D-5: motivo 'purga_rgpd' → desarchivar_nino NUNCA revive un vínculo purgado.
  UPDATE public.vinculos_familiares SET
    descripcion_parentesco = NULL,
    deleted_reason         = 'purga_rgpd',
    deleted_at             = COALESCE(deleted_at, now())
  WHERE nino_id = p_nino_id;

  DELETE FROM public.media m
  WHERE EXISTS (
          SELECT 1 FROM public.media_etiquetas e
          WHERE e.media_id = m.id AND e.nino_id = p_nino_id)
    AND NOT EXISTS (
          SELECT 1 FROM public.media_etiquetas e2
          WHERE e2.media_id = m.id AND e2.nino_id <> p_nino_id);
  DELETE FROM public.media_etiquetas WHERE nino_id = p_nino_id;

  -- Cierre de la purga: los cambios pendientes del niño (su dirección, su libro de familia,
  -- los datos de sus tutores) se borran; el payload no entra en audit_log, solo la tabla lo
  -- guarda. Los documentos en Storage los borra antes el manifiesto de adjuntos.
  DELETE FROM public.cambios_pendientes WHERE nino_id = p_nino_id;

  -- Retención (F11-B, punto 6, PR-4): su operativa (agenda, asistencia, mensajes, informes,
  -- citas, recordatorios, respuestas a eventos) se borra, con sus copias en audit_log.
  PERFORM privado.olvido_borrar_operativa_nino(p_nino_id);

  -- Purga RGPD del niño: la copia en audit_log, con la lista de claves personales por tabla
  -- (_claves_pii_nino).
  PERFORM public._redactar_auditoria_nino(p_nino_id);

  -- Purga de lista_espera: el prospecto del niño se borra entero (la plaza no tiene sentido
  -- sin el niño). Su copia en audit_log se redacta por registro_id: así se alcanza también el
  -- INSERT, que nace con nino_id NULL, y el DELETE que acaba de escribir esta purga.
  WITH borrados AS (
    DELETE FROM public.lista_espera WHERE nino_id = p_nino_id RETURNING id
  )
  SELECT array_agg(id) INTO v_lista FROM borrados;
  UPDATE public.audit_log SET
    valores_antes   = public._redactar_jsonb(valores_antes,   public._claves_pii_nino('lista_espera')),
    valores_despues = public._redactar_jsonb(valores_despues, public._claves_pii_nino('lista_espera'))
  WHERE tabla = 'lista_espera' AND registro_id = ANY (v_lista);

END;
$function$;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  r     record;
  v_md5 text;
  v_n   bigint;
BEGIN
  -- Lo nuevo es lo del fichero, y lo que no cambia sigue igual. purgar_nino da el mismo md5 que
  -- antes: solo cambia un comentario, que la normalización quita.
  FOR r IN
    SELECT * FROM (VALUES
      ('privado.ficha_medica_bloqueada_desde(uuid)', '3c9e25692af575cbfb75468f1925bf78'),
      ('public.purgar_export_log(integer,boolean)', 'eeae54d01e78c44f63b2151a406ebfad'),
      ('privado.purgar_nino(uuid)', '53730ba72640c24f65ff81bf7ace7103'),
      ('privado.fecha_baja_nino(uuid)', '0522d50b325eddfc8a57cf7d4ab25263'),
      ('public.get_info_medica_emergencia(uuid,text)', '0b00f375d493666784a35991d1c99e7c'),
      ('public.set_info_medica_emergencia_cifrada(uuid,text,text,text,text,text,text)', '2f256aaa2161e5cf9bb6dc7fe54c9ea4'),
      ('public.set_info_medica_emergencia_cifrada_tutor(uuid,text,text,text,text,text,text,boolean)', 'b1c8ed86ca06000dfedda2c41e45f72c'),
      ('public.borrar_info_medica_nino_tutor(uuid)', '67e1f083715d33f1001d3f526fad873e'),
      ('public.alertas_medicas(uuid[])', '22567dca62ab4ff5b8d3bb9131419529')
    ) AS t(f, md5)
  LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f);
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION '% no quedó como se esperaba: %', r.f, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;

  -- Las cinco funciones de la ficha siguen preguntando al predicado.
  SELECT count(*) INTO v_n FROM pg_proc p
   WHERE p.oid IN ('public.get_info_medica_emergencia(uuid,text)'::regprocedure,
                   'public.set_info_medica_emergencia_cifrada(uuid,text,text,text,text,text,text)'::regprocedure,
                   'public.set_info_medica_emergencia_cifrada_tutor(uuid,text,text,text,text,text,text,boolean)'::regprocedure,
                   'public.borrar_info_medica_nino_tutor(uuid)'::regprocedure,
                   'public.alertas_medicas(uuid[])'::regprocedure)
     AND strpos(p.prosrc, 'privado.ficha_medica_bloqueada_desde(') > 0;
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'esperaba 5 funciones de la ficha con el predicado y hay %', v_n;
  END IF;

  -- La retirada: ni la función, ni nadie que la nombre (tampoco en un comentario).
  IF to_regprocedure('public.purgar_esqueleto_huerfano_nino(uuid,timestamptz)') IS NOT NULL THEN
    RAISE EXCEPTION 'purgar_esqueleto_huerfano_nino sigue existiendo';
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc p WHERE p.prosrc ILIKE '%purgar_esqueleto_huerfano_nino%';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'hay % funciones que nombran a purgar_esqueleto_huerfano_nino', v_n;
  END IF;

  -- Permisos: la purga de export_log, solo del servicio; el predicado, de nadie con sesión.
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.purgar_export_log(integer,boolean)'::regprocedure)
     OR has_function_privilege('anon', 'public.purgar_export_log(integer,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.purgar_export_log(integer,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.purgar_export_log(integer,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'privado.ficha_medica_bloqueada_desde(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'privado.ficha_medica_bloqueada_desde(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'privado.purgar_nino(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'privado.purgar_nino(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'una función quedó con los permisos que no toca';
  END IF;

  -- Todo niño purgado tiene la ficha bloqueada.
  SELECT count(*) INTO v_n FROM public.ninos n
   WHERE (n.purgado_en IS NOT NULL OR n.deleted_reason = 'purga_rgpd')
     AND privado.ficha_medica_bloqueada_desde(n.id) IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'hay % niños purgados con la ficha sin bloquear', v_n;
  END IF;

  RAISE NOTICE 'guarda posterior: % fichas bloqueadas (% de niños purgados)',
    (SELECT count(*) FROM public.ninos n WHERE privado.ficha_medica_bloqueada_desde(n.id) IS NOT NULL),
    (SELECT count(*) FROM public.ninos n
      WHERE (n.purgado_en IS NOT NULL OR n.deleted_reason = 'purga_rgpd')
        AND privado.ficha_medica_bloqueada_desde(n.id) IS NOT NULL);
END
$guarda$;
