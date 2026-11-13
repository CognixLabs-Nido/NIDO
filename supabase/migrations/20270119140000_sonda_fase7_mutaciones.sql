-- SONDA de la fase 7: rompe cada defensa a la vez. NO SE MERGEA.

GRANT SELECT (sip) ON public.ninos TO authenticated;

CREATE OR REPLACE FUNCTION public.actualizar_identidad_nino_tutor(p_nino_id uuid, p_primer_apellido text, p_segundo_apellido text, p_fecha_nacimiento date, p_sexo nino_sexo, p_nacionalidad text, p_idioma_principal text, p_nombre text DEFAULT NULL::text, p_lugar_nacimiento text DEFAULT NULL::text, p_dni text DEFAULT NULL::text, p_hermanos_total integer DEFAULT NULL::integer, p_hermanos_lugar integer DEFAULT NULL::integer, p_observaciones_familia text DEFAULT NULL::text, p_como_nos_conocio text DEFAULT NULL::text, p_como_nos_conocio_otro text DEFAULT NULL::text, p_sip text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_actual public.ninos%ROWTYPE;
BEGIN
  IF NOT public.es_tutor_legal_de(p_nino_id) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 5a: los apellidos van en pareja. Si llega el primero, llega el segundo con él, y vacío es «no
  -- tiene»: así se puede quitar un segundo apellido. El primero no puede llegar vacío, y el segundo
  -- no llega solo. `apellidos` la deriva la base de los dos.
  IF p_primer_apellido IS NOT NULL AND btrim(p_primer_apellido) = '' THEN
    RAISE EXCEPTION 'falta el primer apellido'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'primer_apellido';
  END IF;
  IF p_primer_apellido IS NULL AND p_segundo_apellido IS NOT NULL THEN
    RAISE EXCEPTION 'el segundo apellido llega con el primero'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'apellidos_en_pareja';
  END IF;
  -- Los hermanos, también en pareja: el total (contando al niño) y el lugar que ocupa (1, el mayor).
  IF (p_hermanos_total IS NULL) <> (p_hermanos_lugar IS NULL) THEN
    RAISE EXCEPTION 'el total de hermanos y el lugar van juntos'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'hermanos';
  END IF;
  IF p_como_nos_conocio IS NULL AND p_como_nos_conocio_otro IS NOT NULL THEN
    RAISE EXCEPTION 'el texto de «otro» llega con la respuesta'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'como_nos_conocio';
  END IF;

  -- La puerta (20270113120000): con el alta validada, los ocho campos que IDENTIFICAN al niño no se
  -- cambian aquí, van a la cola de Dirección (cambios_pendientes, entidad 'ninos_identidad'). Se
  -- compara con lo guardado usando las MISMAS expresiones que el UPDATE de abajo: mandar el mismo
  -- valor no es un cambio, así que guardar el paso sin tocar nada no falla. Los otros seis (idioma,
  -- hermanos, observaciones, cómo nos conoció) siguen directos. Decidido por el responsable el
  -- 2026-11-07: cambiar el nombre o el DNI necesita a Dirección; el número de hermanos, no.
  IF public.alta_validada_de_nino(p_nino_id) THEN
    SELECT n.* INTO v_actual FROM public.ninos n WHERE n.id = p_nino_id;
    IF (p_nombre IS NOT NULL AND p_nombre IS DISTINCT FROM v_actual.nombre)
       OR (p_primer_apellido IS NOT NULL
           AND (btrim(p_primer_apellido) IS DISTINCT FROM v_actual.primer_apellido
                OR NULLIF(btrim(p_segundo_apellido), '') IS DISTINCT FROM v_actual.segundo_apellido))
       OR (p_fecha_nacimiento IS NOT NULL AND p_fecha_nacimiento IS DISTINCT FROM v_actual.fecha_nacimiento)
       OR (p_sexo IS NOT NULL AND p_sexo IS DISTINCT FROM v_actual.sexo)
       OR (p_nacionalidad IS NOT NULL AND p_nacionalidad IS DISTINCT FROM v_actual.nacionalidad)
       OR (p_lugar_nacimiento IS NOT NULL
           AND NULLIF(btrim(p_lugar_nacimiento), '') IS DISTINCT FROM v_actual.lugar_nacimiento)
       OR (p_dni IS NOT NULL
           AND NULLIF(upper(regexp_replace(p_dni, '[[:space:].-]', '', 'g')), '') IS DISTINCT FROM v_actual.dni)
       -- Fase 7: la tarjeta sanitaria identifica al niño como el DNI: con el alta validada, a la cola.
       THEN
      RAISE EXCEPTION 'alta validada: el cambio de identidad va a la cola de validacion'
        USING ERRCODE = 'insufficient_privilege', HINT = 'cola_validacion';
    END IF;
  END IF;

  -- Los campos nuevos (5a), con el contrato del setter médico: NULL deja lo que hay y vacío lo
  -- borra. El DNI se guarda sin espacios, puntos ni guiones, en mayúsculas; el CHECK mira la letra.
  UPDATE public.ninos SET
    nombre           = COALESCE(p_nombre, nombre),
    primer_apellido  = CASE WHEN p_primer_apellido IS NULL THEN primer_apellido ELSE btrim(p_primer_apellido) END,
    segundo_apellido = CASE WHEN p_primer_apellido IS NULL THEN segundo_apellido
                            ELSE NULLIF(btrim(p_segundo_apellido), '') END,
    fecha_nacimiento = COALESCE(p_fecha_nacimiento, fecha_nacimiento),
    sexo             = COALESCE(p_sexo, sexo),
    nacionalidad     = COALESCE(p_nacionalidad, nacionalidad),
    idioma_principal = COALESCE(p_idioma_principal, idioma_principal),
    lugar_nacimiento = CASE WHEN p_lugar_nacimiento IS NULL THEN lugar_nacimiento
                            ELSE NULLIF(btrim(p_lugar_nacimiento), '') END,
    dni              = CASE WHEN p_dni IS NULL THEN dni
                            ELSE NULLIF(upper(regexp_replace(p_dni, '[[:space:].-]', '', 'g')), '') END,
    sip              = CASE WHEN p_sip IS NULL THEN sip ELSE privado.sip_normalizado(p_sip) END,
    hermanos_total   = COALESCE(p_hermanos_total, hermanos_total),
    hermanos_lugar   = COALESCE(p_hermanos_lugar, hermanos_lugar),
    observaciones_familia = CASE WHEN p_observaciones_familia IS NULL THEN observaciones_familia
                                 ELSE NULLIF(btrim(p_observaciones_familia), '') END,
    como_nos_conocio = CASE WHEN p_como_nos_conocio IS NULL THEN como_nos_conocio
                            ELSE NULLIF(btrim(p_como_nos_conocio), '') END,
    como_nos_conocio_otro = CASE WHEN p_como_nos_conocio IS NULL THEN como_nos_conocio_otro
                                 WHEN btrim(p_como_nos_conocio) = 'otro' THEN NULLIF(btrim(p_como_nos_conocio_otro), '')
                                 ELSE NULL END
  WHERE id = p_nino_id
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sip_de_ninos(p_nino_ids uuid[])
 RETURNS TABLE (nino_id uuid, sip text, sip_documento_path text, ve_documento boolean)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT n.id, n.sip,
         n.sip_documento_path,
         true
    FROM public.ninos n
   CROSS JOIN LATERAL (SELECT public.es_admin(n.centro_id) OR public.es_tutor_legal_de(n.id) AS gestiona) g
   WHERE n.id = ANY (p_nino_ids)
     AND n.deleted_at IS NULL
     AND auth.uid() IS NOT NULL
     AND (g.gestiona OR public.es_profe_de_nino(n.id) OR public.es_tutor_de(n.id));
$function$;

CREATE OR REPLACE FUNCTION public.fijar_sip_documento_nino(p_nino_id uuid, p_path text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro uuid;
  v_admin boolean;
  v_anterior text;
BEGIN
  SELECT centro_id, sip_documento_path INTO v_centro, v_anterior
    FROM public.ninos
   WHERE id = p_nino_id AND deleted_at IS NULL;
  IF v_centro IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_admin := public.es_admin(v_centro);
  IF NOT (v_admin OR public.es_tutor_legal_de(p_nino_id)) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_path IS NULL
     OR p_path !~ ('^' || v_centro::text || '/' || p_nino_id::text || '/[A-Za-z0-9_-]+\.pdf$') THEN
    RAISE EXCEPTION 'la ruta de la tarjeta sanitaria no es del nino'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_path IS NOT DISTINCT FROM v_anterior THEN
    RETURN v_anterior;
  END IF;

  IF false THEN
    RAISE EXCEPTION 'alta validada: el cambio va a la cola de validacion'
      USING ERRCODE = 'insufficient_privilege', HINT = 'cola_validacion';
  END IF;

  UPDATE public.ninos
     SET sip_documento_path = p_path
   WHERE id = p_nino_id AND deleted_at IS NULL;

  RETURN v_anterior;
END;
$function$;

DROP POLICY sip_ninos_select ON storage.objects;
CREATE POLICY sip_ninos_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'sip-ninos'
         AND (public.es_admin(((storage.foldername(name))[1])::uuid)
              OR public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid)
              OR public.es_profe_de_nino(((storage.foldername(name))[2])::uuid))
         AND privado.ruta_coherente(bucket_id, name));

CREATE OR REPLACE FUNCTION public.marcar_matricula_lista(p_nino_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_pendiente boolean;
BEGIN
  -- Gate AMPLIADO: admin del centro del niño O tutor legal (el tutor pasa igual).
  IF NOT (public.es_admin(privado.centro_de_nino(p_nino_id))
          OR public.es_tutor_legal_de(p_nino_id)) THEN
    RAISE EXCEPTION 'no autorizado a finalizar el alta de este nino'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.matriculas
     WHERE nino_id = p_nino_id
       AND estado = 'pendiente'
       AND fecha_baja IS NULL
       AND deleted_at IS NULL
  ) INTO v_pendiente;

  -- Acuse de confidencialidad de datos médicos obligatorio para cerrar el alta
  -- (backstop F11-F, CONSERVADO). auth.uid() = quien finaliza (admin o tutor), y el acuse es de
  -- ESTE niño (U-3, corregido en la base en 20270103120000).
  IF v_pendiente AND NOT EXISTS (
       SELECT 1 FROM public.consentimientos c
        WHERE c.usuario_id = auth.uid()
          AND c.tipo = 'datos_medicos'
          AND c.nino_id = p_nino_id
          AND c.revocado_en IS NULL) THEN
    RAISE EXCEPTION 'falta el acuse de confidencialidad de datos medicos'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Fase 4 (4b-2): los documentos del centro obligatorios que el niño tiene por firmar. El que el
  -- centro todavía no ha subido (`falta_documento`) no frena (P-6), ni el opcional.
  IF v_pendiente AND EXISTS (
       SELECT 1 FROM privado.documentos_del_nino(p_nino_id) d
        WHERE d.obligatorio AND d.estado = 'por_firmar') THEN
    RAISE EXCEPTION 'faltan documentos del centro por firmar'
      USING HINT = 'documentos_por_firmar';
  END IF;

  -- Fase 5b (20270114120000): los datos del niño que el alta exige. Apellidos y fecha ya se exigían,
  -- pero en silencio (el UPDATE de abajo tocaba 0 filas y devolvía NULL); ahora frenan con su motivo,
  -- junto con los tres obligatorios de la fase 5 (decididos por el responsable el 2026-11-10): lugar
  -- de nacimiento, nacionalidad y hermanos. Solo al cerrar un alta pendiente: no toca a los niños ya
  -- validados. Dirección, que cierra el alta en papel, los escribe con su sesión antes de llegar aquí.
  IF v_pendiente AND EXISTS (
       SELECT 1 FROM public.ninos n
        WHERE n.id = p_nino_id
          AND (n.apellidos IS NULL
               OR n.fecha_nacimiento IS NULL
               OR NULLIF(btrim(n.lugar_nacimiento), '') IS NULL
               OR NULLIF(btrim(n.nacionalidad), '') IS NULL
               OR n.hermanos_total IS NULL
               -- Fase 7 (decidido por el responsable el 2026-11-13): el número de la tarjeta
               -- sanitaria, de cualquier comunidad o aseguradora. La imagen no se exige nunca.
               )) THEN
    RAISE EXCEPTION 'faltan datos del nino por completar'
      USING HINT = 'datos_nino_por_completar';
  END IF;

  -- Fase 6 (20270118120000): los datos de los tutores que el alta exige (decididos por el
  -- responsable el 2026-11-12/13: D12, D14, D15 y el número del DNI; `privado.tutor_completo`). El
  -- titular siempre; el segundo tutor si la familia lo tiene (sin fila = «no hay segundo tutor»). Solo
  -- al cerrar un alta pendiente: no toca a las familias ya validadas.
  IF v_pendiente AND (
       NOT EXISTS (
         SELECT 1 FROM public.ninos n
           JOIN public.familia_tutores t
             ON t.familia_id = n.familia_id AND t.rol_familia = 'titular' AND t.deleted_at IS NULL
          WHERE n.id = p_nino_id AND privado.tutor_completo(t))
    OR EXISTS (
         SELECT 1 FROM public.ninos n
           JOIN public.familia_tutores t
             ON t.familia_id = n.familia_id AND t.rol_familia = 'segundo_tutor' AND t.deleted_at IS NULL
          WHERE n.id = p_nino_id AND NOT privado.tutor_completo(t))) THEN
    RAISE EXCEPTION 'faltan datos de los tutores por completar'
      USING HINT = 'datos_tutor_por_completar';
  END IF;

  UPDATE public.matriculas
     SET estado = 'lista'
   WHERE nino_id = p_nino_id
     AND estado = 'pendiente'
     AND fecha_baja IS NULL
     AND deleted_at IS NULL
     AND EXISTS (
       SELECT 1 FROM public.ninos n
        WHERE n.id = p_nino_id
          AND n.apellidos IS NOT NULL
          AND n.fecha_nacimiento IS NOT NULL
     )
   RETURNING id INTO v_id;

  RETURN v_id;
END $function$;

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

INSERT INTO storage.buckets (id, name, public) VALUES ('bucket-de-mentira', 'bucket-de-mentira', false);

ALTER TABLE public.ninos DROP CONSTRAINT ninos_sip_forma;
