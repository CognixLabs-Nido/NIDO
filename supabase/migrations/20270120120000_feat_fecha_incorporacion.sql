-- =============================================================================
-- Fase 8a · La fecha de incorporación (A, aditiva: se aplica ANTES de mergear)
-- -----------------------------------------------------------------------------
-- Decisión de Jose (2026-11-14): «yo puedo validar un alta en enero para el curso siguiente que
-- empieza en septiembre». La fecha de incorporación es el día en que el niño empieza a venir; la pone
-- Dirección al validar el alta, es obligatoria para validar, y decide desde cuándo se le cobra. Va en
-- el niño, no en la matrícula: cambiar de aula o pasar de curso no lo vuelven a incorporar.
--
-- Esta migración no cambia nada de lo que se cobra: la columna, su relleno, la validación con fecha,
-- reincorporar con fecha (la versión sin fecha se queda hasta la B, para que la app de antes siga) y
-- la purga. La B (después del despliegue) exige la fecha en la base y hace que el motor la respete.
--
-- Relleno: las matrículas que llegaron a activarse, con su fecha de activación en hora de Madrid
-- (la más antigua del niño; para los niños de hoy, una sola). Así todas las activas tienen fecha y a
-- ninguna le cambia lo que se le cobra. Los purgados, no: la purga ya les quitó los datos.
--
-- Generada con un guion desde los cuerpos vivos, con la guarda de md5 normalizado.
-- Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

DO $guarda$
DECLARE
  v_firma text;
  v_esperado text;
  v_md5 text;
  v text;
BEGIN
  FOR v_firma, v_esperado IN SELECT * FROM (VALUES
    ('public.desarchivar_nino(uuid,uuid)', '097ba7b5f19ec14dd77571da7001e74b'),
    ('privado.purgar_nino(uuid)', 'a31cc24876e658fef53d83e59532cc7b'),
    ('public._claves_pii_nino(text)', '003715eba174317ac6b4d44a89d9bffe')) AS t(f, m)
  LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_firma);
    IF v_md5 IS DISTINCT FROM v_esperado THEN
      RAISE EXCEPTION '% no es la de antes: %', v_firma, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;
  SELECT string_agg(attname, ',' ORDER BY attname) INTO v
    FROM pg_attribute WHERE attrelid = 'public.ninos'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v IS DISTINCT FROM 'apellidos,centro_id,como_nos_conocio,como_nos_conocio_otro,created_at,deleted_at,deleted_reason,direccion_calle,direccion_ciudad,direccion_cp,direccion_numero,direccion_provincia,dni,estado_civil_familia,familia_id,fecha_nacimiento,foto_url,hermanos_lugar,hermanos_total,id,idioma_principal,libro_familia_path,lugar_nacimiento,nacionalidad,nombre,notas_admin,observaciones_familia,primer_apellido,puede_aparecer_en_fotos,purgado_en,requiere_ambos_firmantes,segundo_apellido,sexo,sip,sip_documento_path,updated_at' THEN
    RAISE EXCEPTION 'ninos no tiene las columnas esperadas: %', v;
  END IF;
  IF to_regprocedure('public.validar_alta(uuid,date)') IS NOT NULL
     OR to_regprocedure('public.desarchivar_nino(uuid,uuid,date)') IS NOT NULL THEN
    RAISE EXCEPTION 'alguna función nueva ya existe';
  END IF;
  IF to_regprocedure('public.hoy_madrid()') IS NULL THEN
    RAISE EXCEPTION 'falta public.hoy_madrid()';
  END IF;
  RAISE NOTICE 'guarda previa: las 3 funciones son las de antes; ninos como se midió';
END
$guarda$;

-- ---- 1. La columna -----------------------------------------------------------
ALTER TABLE public.ninos ADD COLUMN fecha_incorporacion date;
COMMENT ON COLUMN public.ninos.fecha_incorporacion IS
  'Día en que el niño empieza a venir (fase 8a). La pone Dirección al validar el alta o al reincorporarlo. '
  'Nada se cobra de un mes anterior al suyo (generar_recibos_mes, desde 20270120130000). '
  'Todo niño con matrícula activa la tiene (matriculas_exige_incorporacion).';
-- Se lee como las demás columnas no sensibles del niño (la fila la sigue filtrando la RLS).
GRANT SELECT (fecha_incorporacion) ON public.ninos TO authenticated;

-- ---- 2. El relleno -------------------------------------------------------------
UPDATE public.ninos n
   SET fecha_incorporacion = (
         SELECT (min(m.activada_at) AT TIME ZONE 'Europe/Madrid')::date
           FROM public.matriculas m WHERE m.nino_id = n.id AND m.activada_at IS NOT NULL)
 WHERE n.purgado_en IS NULL
   AND EXISTS (SELECT 1 FROM public.matriculas m WHERE m.nino_id = n.id AND m.activada_at IS NOT NULL);

-- ---- 3. Validar el alta, con la fecha -------------------------------------------
CREATE FUNCTION public.validar_alta(p_matricula_id uuid, p_fecha_incorporacion date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- Fase 8a. Dirección valida un alta terminada por la familia (matrícula 'lista' → 'activa') y dice
-- qué día empieza a venir el niño. Las dos cosas a la vez, o ninguna. Devuelve la matrícula, o NULL
-- si no estaba 'lista' (ya activa, a medias o borrada): el mismo «0 filas» de antes.
DECLARE
  v_centro uuid;
  v_nino uuid;
  v_id uuid;
BEGIN
  SELECT n.centro_id, m.nino_id INTO v_centro, v_nino
    FROM public.matriculas m JOIN public.ninos n ON n.id = m.nino_id
   WHERE m.id = p_matricula_id;
  IF v_centro IS NULL OR NOT public.es_admin(v_centro) THEN
    RAISE EXCEPTION 'no autorizado: solo Dirección del centro del niño' USING ERRCODE = '42501';
  END IF;
  IF p_fecha_incorporacion IS NULL THEN
    RAISE EXCEPTION 'falta la fecha de incorporación' USING ERRCODE = 'null_value_not_allowed',
      HINT = 'falta_fecha_incorporacion';
  END IF;

  SELECT m.id INTO v_id FROM public.matriculas m
   WHERE m.id = p_matricula_id AND m.estado = 'lista' AND m.deleted_at IS NULL AND m.fecha_baja IS NULL
   FOR UPDATE;
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.ninos SET fecha_incorporacion = p_fecha_incorporacion WHERE id = v_nino;
  UPDATE public.matriculas SET estado = 'activa' WHERE id = v_id;
  RETURN v_id;
END $function$;
REVOKE ALL ON FUNCTION public.validar_alta(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validar_alta(uuid, date) TO authenticated, service_role;

-- ---- 4. Reincorporar, con la fecha (la de dos argumentos la borra la B) ----------
CREATE FUNCTION public.desarchivar_nino(p_nino_id uuid, p_aula_id uuid, p_fecha_incorporacion date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro_id     uuid;
  v_familia_id    uuid;
  v_archivado     boolean;
  v_motivo        public.motivo_borrado;
  v_curso_id      uuid;
  v_familia_react boolean := false;
  v_roles         integer := 0;
  v_matricula_id  uuid;
BEGIN
  -- Fase 8a: reincorporar es incorporar. Sin el día en que vuelve, no se reincorpora: es lo que
  -- decide desde qué mes se le cobra (`generar_recibos_mes`).
  IF p_fecha_incorporacion IS NULL THEN
    RAISE EXCEPTION 'falta la fecha de incorporación' USING ERRCODE = 'null_value_not_allowed',
      HINT = 'falta_fecha_incorporacion';
  END IF;

  SELECT centro_id, familia_id, (deleted_at IS NOT NULL), deleted_reason
    INTO v_centro_id, v_familia_id, v_archivado, v_motivo
    FROM public.ninos
    WHERE id = p_nino_id;
  IF v_centro_id IS NULL THEN
    RAISE EXCEPTION 'nino % no existe', p_nino_id USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT (public.es_admin(v_centro_id) OR (SELECT auth.role()) = 'service_role') THEN
    RAISE EXCEPTION 'no autorizado a reincorporar a este nino';
  END IF;

  IF NOT v_archivado THEN
    RETURN jsonb_build_object('nino_id', p_nino_id, 'ya_activo', true);
  END IF;

  -- D-5: solo se reincorpora lo que archivó una BAJA. Un niño purgado por RGPD
  -- (deleted_reason='purga_rgpd') NO es reincorporable: su PII ya se anonimizó.
  IF v_motivo IS DISTINCT FROM 'baja_nino' THEN
    RAISE EXCEPTION 'no se puede reincorporar a un sujeto purgado' USING ERRCODE = 'raise_exception';
  END IF;

  v_curso_id := public.curso_activo_de_centro(v_centro_id);
  IF v_curso_id IS NULL THEN
    RAISE EXCEPTION 'el centro no tiene curso academico activo' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.aulas_curso
    WHERE aula_id = p_aula_id AND curso_academico_id = v_curso_id
  ) THEN
    RAISE EXCEPTION 'el aula no pertenece al curso activo del centro' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- 5a. Desarchiva el niño (ya validado que fue una baja) y limpia el motivo.
  UPDATE public.ninos SET deleted_at = NULL, deleted_reason = NULL, fecha_incorporacion = p_fecha_incorporacion
   WHERE id = p_nino_id;

  -- 5b. D-5: revive SOLO los vínculos que borró la BAJA ('baja_nino'), no los de una
  --     purga RGPD u otra vía. Al revivir, limpia el motivo (coherencia con el CHECK).
  --     [INVITACIONES] Solo la última fila retirada de cada persona, y solo si no tiene ya una
  --     viva: la unicidad cuenta solo las vivas, y puede haber varias retiradas.
  UPDATE public.vinculos_familiares vf
     SET deleted_at = NULL, deleted_reason = NULL
   WHERE vf.id IN (
       SELECT DISTINCT ON (x.usuario_id) x.id
         FROM public.vinculos_familiares x
        WHERE x.nino_id = p_nino_id AND x.deleted_at IS NOT NULL
        ORDER BY x.usuario_id, x.deleted_at DESC, x.id DESC)
     AND vf.deleted_reason = 'baja_nino'
     AND NOT EXISTS (
       SELECT 1 FROM public.vinculos_familiares v
        WHERE v.nino_id = vf.nino_id AND v.usuario_id = vf.usuario_id AND v.deleted_at IS NULL);

  -- 5c. D-5: reactiva la familia SOLO si la archivó una revocación de baja.
  UPDATE public.familias
     SET deleted_at = NULL, deleted_reason = NULL
   WHERE id = v_familia_id
     AND deleted_at IS NOT NULL
     AND deleted_reason = 'revocacion_familia';
  v_familia_react := FOUND;

  -- 5d. D-5: reactiva el rol tutor_legal SOLO de los revocados por baja ('revocacion_familia').
  --     [INVITACIONES] La última retirada de cada tutor, y solo si no tiene ya una viva.
  WITH react AS (
    UPDATE public.roles_usuario ru
       SET deleted_at = NULL, deleted_reason = NULL
     WHERE ru.id IN (
         SELECT DISTINCT ON (r.usuario_id) r.id
           FROM public.roles_usuario r
          WHERE r.centro_id = v_centro_id
            AND r.rol = 'tutor_legal'
            AND r.deleted_at IS NOT NULL
            AND r.usuario_id IN (
              SELECT ft.usuario_id
                FROM public.familia_tutores ft
               WHERE ft.familia_id = v_familia_id
                 AND ft.usuario_id IS NOT NULL
                 AND ft.deleted_at IS NULL
            )
          ORDER BY r.usuario_id, r.deleted_at DESC, r.id DESC)
       AND ru.deleted_reason = 'revocacion_familia'
       AND NOT EXISTS (
         SELECT 1 FROM public.roles_usuario v
          WHERE v.usuario_id = ru.usuario_id AND v.centro_id = ru.centro_id
            AND v.rol = ru.rol AND v.deleted_at IS NULL)
    RETURNING 1
  )
  SELECT count(*) INTO v_roles FROM react;

  INSERT INTO public.matriculas (nino_id, aula_id, curso_academico_id, fecha_alta, estado)
  VALUES (p_nino_id, p_aula_id, v_curso_id, public.hoy_madrid(), 'activa')
  RETURNING id INTO v_matricula_id;

  RETURN jsonb_build_object(
    'nino_id',            p_nino_id,
    'desarchivado',       true,
    'matricula_id',       v_matricula_id,
    'familia_reactivada', v_familia_react,
    'roles_reactivados',  v_roles
  );
END $function$;
REVOKE ALL ON FUNCTION public.desarchivar_nino(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desarchivar_nino(uuid, uuid, date) TO authenticated, service_role;

-- ---- 5. La purga y las claves --------------------------------------------------
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
    -- 5a: `apellidos` la deriva la base de los dos; se borran los dos.
    primer_apellido  = '[borrado]',
    segundo_apellido = NULL,
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
    -- 5a: los campos nuevos de la ficha.
    lugar_nacimiento      = NULL,
    dni                   = NULL,
    hermanos_total        = NULL,
    hermanos_lugar        = NULL,
    direccion_provincia   = NULL,
    observaciones_familia = NULL,
    como_nos_conocio      = NULL,
    como_nos_conocio_otro = NULL,
    -- Fase 7: la tarjeta sanitaria, el número y la ruta de la imagen. El objeto del bucket
    -- `sip-ninos` lo borra antes el manifiesto de adjuntos, como el libro de familia.
    sip                   = NULL,
    sip_documento_path    = NULL,
    -- Fase 8a: la fecha de incorporación. Un niño purgado no tiene matrícula activa, que es lo
    -- único que la exige (`privado.ninos_incorporacion_no_se_quita`).
    fecha_incorporacion   = NULL,
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

CREATE OR REPLACE FUNCTION public._claves_pii_nino(p_tabla text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT ARRAY[
    'nombre', 'apellidos', 'fecha_nacimiento', 'sexo', 'nacionalidad', 'foto_url', 'notas_admin',
    'alergias_graves', 'notas_emergencia', 'medicacion_habitual', 'alergias_leves',
    'medico_familia', 'telefono_emergencia',
    'ip_address', 'user_agent', 'descripcion_parentesco', 'nombre_externo', 'observaciones',
    'observaciones_generales', 'contenido', 'nombre_tecleado'
  ]::text[] || CASE p_tabla
    WHEN 'ninos' THEN ARRAY['idioma_principal', 'direccion_calle', 'direccion_numero', 'direccion_cp',
                            'direccion_ciudad', 'libro_familia_path', 'estado_civil_familia',
                            'primer_apellido', 'segundo_apellido', 'lugar_nacimiento', 'dni',
                            'hermanos_total', 'hermanos_lugar', 'direccion_provincia',
                            'observaciones_familia', 'como_nos_conocio', 'como_nos_conocio_otro',
                            'sip', 'sip_documento_path', 'fecha_incorporacion']
    WHEN 'datos_pedagogicos_nino' THEN ARRAY['lactancia_observaciones', 'control_esfinteres_observaciones',
                            'siesta_horario_habitual', 'siesta_observaciones',
                            'alimentacion_observaciones', 'idiomas_casa']
    WHEN 'matriculas' THEN ARRAY['motivo_baja']
    WHEN 'firmas_autorizacion' THEN ARRAY['firma_imagen', 'comentario', 'datos']
    WHEN 'firmas_documentos_centro' THEN ARRAY['firma_imagen']
    WHEN 'autorizaciones' THEN ARRAY['titulo', 'texto', 'datos']
    WHEN 'cita_invitados' THEN ARRAY['comentario']
    WHEN 'lista_espera' THEN ARRAY['nombre_nino', 'apellidos_nino', 'primer_apellido_nino',
                                   'segundo_apellido_nino', 'telefono_tutor', 'email_tutor', 'nota']
    ELSE ARRAY[]::text[]
  END;
$function$;

-- ---- Guarda posterior ----------------------------------------------------------
DO $post$
DECLARE
  v_activos int;
  v_sin int;
  v_con int;
BEGIN
  SELECT count(DISTINCT n.id), count(DISTINCT n.id) FILTER (WHERE n.fecha_incorporacion IS NULL)
    INTO v_activos, v_sin
    FROM public.ninos n JOIN public.matriculas m ON m.nino_id = n.id
   WHERE m.estado = 'activa' AND m.deleted_at IS NULL AND m.fecha_baja IS NULL;
  SELECT count(*) INTO v_con FROM public.ninos WHERE fecha_incorporacion IS NOT NULL;
  IF v_sin > 0 THEN
    RAISE EXCEPTION 'quedan % de % niños activos sin fecha de incorporación', v_sin, v_activos;
  END IF;
  IF to_regprocedure('public.validar_alta(uuid,date)') IS NULL
     OR to_regprocedure('public.desarchivar_nino(uuid,uuid,date)') IS NULL
     OR to_regprocedure('public.desarchivar_nino(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'faltan funciones tras aplicar';
  END IF;
  IF NOT (public._claves_pii_nino('ninos') @> ARRAY['fecha_incorporacion']) THEN
    RAISE EXCEPTION '_claves_pii_nino no conoce la fecha';
  END IF;
  RAISE NOTICE 'guarda posterior: % niños activos, todos con fecha; % niños con fecha en total', v_activos, v_con;
END
$post$;
