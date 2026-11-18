-- Fase 10 · 10b-1: la ficha firmada, la base (2026-11-18). Spec: docs/specs/altas-serie.md, «Fase 10»,
-- «Adelante con la 10b», «10b: el diseño» y «Las dos, resueltas».
--
-- El responsable, 2026-11-16 a 18: la ficha se firma, con TODO lo declarado (los seis campos médicos
-- incluidos); se guarda la FOTO cifrada como `info_medica_emergencia` y su hash, no un PDF (la (C));
-- texto canónico y plantilla del PDF, versionados y guardados en la firma; tabla propia, nacida
-- cerrada por columnas; basta un tutor, y se guarda quién; FIRMAR ES FINALIZAR; un cambio entre
-- firmar y validar INVALIDA la firma; la firma es inmutable y Dirección pide refirma; en papel,
-- Dirección registra la firma presencial sin trazo; firma solo el tutor legal que puede ver la ficha
-- médica («Nadie firma lo que no puede leer»).
--
-- Medido ABIERTO en producción el 2026-11-18 (ensayo terminado en RAISE): con todo lo demás puesto y
-- sin respuesta de imagen, el tutor cierra el alta llamando a `marcar_matricula_lista`; en `lista`
-- cambia sus datos directamente y nada los ata a una firma; no existe ninguna tabla ni función de la
-- firma de la ficha.
--
--   1. `firmas_ficha` y `refirmas_ficha`, nacidas cerradas: la sesión no escribe ninguna y lee de la
--      primera solo quién, en calidad de qué, cómo, cuándo, las versiones y el hash.
--   2. `privado.ficha_canonica` compone la foto en la base (versión 1) y `privado.ficha_hash` su
--      sha256, sin el bloque de imagen (retirable por derecho: cambiarlo no invalida nada); `privado.firma_ficha_vigente`: la firma vale mientras la foto recompuesta dé su hash y
--      ninguna petición de refirma sea posterior (sin triggers en las seis tablas).
--   3. `ficha_para_firmar` (con su lectura en `lecturas_ficha_medica`), `firmar_ficha` (tutor legal
--      con el permiso de la ficha médica; si no lo tiene, HINT `sin_acceso_ficha_medica`),
--      `registrar_firma_ficha_presencial` (Dirección en persona), `pedir_refirma_ficha`,
--      `estado_firma_ficha` y `contenido_firmas_ficha`.
--   4. `privado.purgar_nino` borra las dos tablas del niño.
--
-- ORDEN: aplicar ANTES de mergear y del despliegue. Solo añade: la app de antes no llama a nada de
-- esto, y `marcar_matricula_lista` y `validar_alta` no cambian aquí (las endurece la 10b-3, después
-- del despliegue). Sin COMMIT ni BEGIN: el SQL Editor la envuelve en su transacción.

-- ─────────────────────────────────────────────────────────────── guarda previa
DO $guarda$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20270127120000') THEN
    RAISE EXCEPTION 'falta la 20270127120000 en el registro: aplica antes la 10a-2';
  END IF;
  IF to_regclass('public.firmas_ficha') IS NOT NULL OR to_regclass('public.refirmas_ficha') IS NOT NULL
     OR to_regprocedure('privado.ficha_canonica(uuid,integer)') IS NOT NULL
     OR to_regprocedure('public.firmar_ficha(uuid,text,text,text,inet,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'la ficha firmada ya existe: esta migración ya se aplicó';
  END IF;
  IF to_regprocedure('privado.firma_bloqueada(uuid,uuid)') IS NULL
     OR to_regprocedure('privado.ficha_medica_bloqueada_desde(uuid)') IS NULL
     OR to_regprocedure('public._get_medical_key()') IS NULL
     OR to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'falta una de las funciones de las que depende la ficha firmada';
  END IF;
  -- La función que se reescribe, con el cuerpo leído en producción (md5 de la lógica normalizada).
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('privado.purgar_nino(uuid)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM '6898d013c7d9b1e9e10e939353cedc80' THEN
    RAISE EXCEPTION 'privado.purgar_nino(uuid) no es la leída en producción el 2026-11-18';
  END IF;
  -- Las dos que la 10b-3 endurecerá: aquí no se tocan, y su cuerpo tiene que seguir siendo el leído.
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.marcar_matricula_lista(uuid)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM '7c33e387eb551afb268a0a8c66055a8e' THEN
    RAISE EXCEPTION 'public.marcar_matricula_lista(uuid) no es la leída en producción el 2026-11-18';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.validar_alta(uuid,date)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM 'ba4a30df96ac148ebe09a62615647c72' THEN
    RAISE EXCEPTION 'public.validar_alta(uuid,date) no es la leída en producción el 2026-11-18';
  END IF;
END
$guarda$;

-- ─────────────────────────────────────────────────────────────── la purga del niño
-- Reescrita desde su definición viva (2026-11-18), con un cambio: borra la ficha firmada.
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

  -- Fase 8b: la petición de servicios del alta (lo que la familia pidió). Lo que se cobró de verdad
  -- está en las asignaciones y los recibos, que son fiscales y se quedan.
  DELETE FROM public.peticion_servicio WHERE nino_id = p_nino_id;

  -- Fase 9: los gastos de gestión (lo declarado, el importe y la marca de cobro). Sin recibo (D6): no
  -- hay nada fiscal que guardar aquí. El justificante lo borra antes la app (FUENTES_ADJUNTOS).
  DELETE FROM public.gastos_gestion WHERE nino_id = p_nino_id;

  -- Fase 10b (20270128120000; decisión del 2026-11-18): la ficha firmada se va con el niño, y las
  -- peticiones de volver a firmarla. Lleva la foto de lo declarado (lo médico incluido): no se conserva
  -- una copia que se salte la purga. No hay fichero que perseguir: la (C) no guarda PDF.
  DELETE FROM public.refirmas_ficha WHERE nino_id = p_nino_id;
  DELETE FROM public.firmas_ficha WHERE nino_id = p_nino_id;

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

-- ─────────────────────────────────────────────────────────────── las tablas
-- La firma de la ficha. Nace cerrada: la sesión no la escribe (solo las funciones de abajo) y lee
-- solo las columnas de la fila (quién, en calidad de qué, cómo, cuándo, las versiones y el hash). El
-- trazo, la IP, el navegador y el nombre tecleado salen por `contenido_firmas_ficha`; la foto cifrada,
-- por nadie con sesión (la lee la 10c, por una función). Sin `centro_id`: el centro es el del niño.
CREATE TABLE public.firmas_ficha (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nino_id               uuid        NOT NULL REFERENCES public.ninos(id) ON DELETE CASCADE,
  firmante_id           uuid        NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  rol_firmante          public.tipo_vinculo NOT NULL,
  metodo_firma          public.firma_metodo NOT NULL,
  nombre_tecleado       text        NOT NULL,
  firma_imagen          text,
  ip_address            inet,
  user_agent            text,
  firmado_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
  ficha_version         smallint    NOT NULL,
  plantilla_pdf_version smallint    NOT NULL,
  contenido_cifrado     bytea       NOT NULL,
  contenido_sha256      text        NOT NULL,
  CONSTRAINT firmas_ficha_nombre CHECK (btrim(nombre_tecleado) <> '' AND char_length(nombre_tecleado) <= 200),
  CONSTRAINT firmas_ficha_versiones CHECK (ficha_version >= 1 AND plantilla_pdf_version >= 1),
  CONSTRAINT firmas_ficha_sha256 CHECK (contenido_sha256 ~ '^[0-9a-f]{64}$'),
  -- Con el dedo, el tutor legal y su trazo; en persona, Dirección (rol `admin`), sin trazo: la prueba
  -- es el papel. El `checkbox` no es una firma de la ficha.
  CONSTRAINT firmas_ficha_forma_por_metodo CHECK (
    (metodo_firma = 'digital' AND firma_imagen IS NOT NULL AND btrim(firma_imagen) <> ''
       AND rol_firmante IN ('tutor_legal_principal', 'tutor_legal_secundario'))
    OR (metodo_firma = 'presencial' AND firma_imagen IS NULL AND rol_firmante = 'admin'))
);
-- `clock_timestamp()`, no `now()`: dentro de una transacción `now()` no avanza, y una firma y una petición
-- de refirma de la misma transacción quedarían con el mismo instante (medido en el ensayo del 2026-11-18).
CREATE INDEX firmas_ficha_nino_idx ON public.firmas_ficha (nino_id, firmado_at DESC, id DESC);
COMMENT ON TABLE public.firmas_ficha IS
  'Fase 10b: la ficha firmada del alta. Una fila por firma, inmutable; la foto de lo firmado va cifrada '
  '(clave médica) con su sha256. Vale mientras la foto recompuesta dé ese hash (privado.firma_ficha_vigente). '
  'Solo la escriben firmar_ficha y registrar_firma_ficha_presencial; se va con la purga del niño.';

-- Que Dirección pida volver a firmar: una fila aparte, para que la firma no cambie nunca.
CREATE TABLE public.refirmas_ficha (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nino_id    uuid        NOT NULL REFERENCES public.ninos(id) ON DELETE CASCADE,
  pedida_por uuid        NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  pedida_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX refirmas_ficha_nino_idx ON public.refirmas_ficha (nino_id, pedida_at DESC);
COMMENT ON TABLE public.refirmas_ficha IS
  'Fase 10b: Dirección pide volver a firmar la ficha (pedir_refirma_ficha). Una firma anterior a la '
  'petición deja de valer. Inmutable; se va con la purga del niño.';

-- Inmutables: ninguna fila cambia, tampoco para service_role (no `postgres`: su llave).
CREATE FUNCTION privado.ficha_firmada_inmutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $f$
BEGIN
  RAISE EXCEPTION '% no cambia nunca', TG_TABLE_NAME
    USING ERRCODE = 'check_violation', HINT = 'firma_inmutable';
END $f$;
REVOKE ALL ON FUNCTION privado.ficha_firmada_inmutable() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER firmas_ficha_inmutable BEFORE UPDATE ON public.firmas_ficha
  FOR EACH ROW EXECUTE FUNCTION privado.ficha_firmada_inmutable();
CREATE TRIGGER refirmas_ficha_inmutable BEFORE UPDATE ON public.refirmas_ficha
  FOR EACH ROW EXECUTE FUNCTION privado.ficha_firmada_inmutable();

ALTER TABLE public.firmas_ficha ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refirmas_ficha ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.firmas_ficha FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.refirmas_ficha FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (id, nino_id, firmante_id, rol_firmante, metodo_firma, firmado_at, ficha_version,
              plantilla_pdf_version, contenido_sha256)
  ON public.firmas_ficha TO authenticated;
GRANT SELECT (id, nino_id, pedida_at) ON public.refirmas_ficha TO authenticated;

-- La ven el tutor legal y la Dirección del centro del niño; la profe y el autorizado, no (decisión del
-- 2026-11-17, punto 5).
CREATE POLICY firmas_ficha_select ON public.firmas_ficha FOR SELECT TO authenticated
  USING (public.es_tutor_legal_de(nino_id) OR public.es_admin(privado.centro_de_nino(nino_id)));
CREATE POLICY bloqueo_retencion ON public.firmas_ficha AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT privado.firma_bloqueada(nino_id, firmante_id))
  WITH CHECK (NOT privado.firma_bloqueada(nino_id, firmante_id));
CREATE POLICY refirmas_ficha_select ON public.refirmas_ficha FOR SELECT TO authenticated
  USING (public.es_tutor_legal_de(nino_id) OR public.es_admin(privado.centro_de_nino(nino_id)));

-- ─────────────────────────────────────────────────────────────── la foto
-- Lo que la familia declaró en el alta, de los seis sitios, en un jsonb (versión 1). La compone la
-- base: si la base puede derivar un valor, no lo acepta del cliente. Las listas van ordenadas, y el
-- texto de un jsonb no depende del orden de las claves: la misma ficha da siempre el mismo texto.
CREATE FUNCTION privado.ficha_canonica(p_nino_id uuid, p_version integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, extensions AS $f$
DECLARE
  v_clave text;
BEGIN
  IF p_version IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'versión de la ficha desconocida: %', p_version USING ERRCODE = '22023';
  END IF;
  v_clave := public._get_medical_key();
  RETURN jsonb_build_object(
    'version', 1,
    'nino', (SELECT jsonb_build_object(
               'nombre', n.nombre, 'primer_apellido', n.primer_apellido,
               'segundo_apellido', n.segundo_apellido, 'fecha_nacimiento', n.fecha_nacimiento,
               'sexo', n.sexo, 'lugar_nacimiento', n.lugar_nacimiento, 'nacionalidad', n.nacionalidad,
               'idioma_principal', n.idioma_principal, 'dni', n.dni, 'sip', n.sip,
               'direccion_calle', n.direccion_calle, 'direccion_numero', n.direccion_numero,
               'direccion_cp', n.direccion_cp, 'direccion_ciudad', n.direccion_ciudad,
               'direccion_provincia', n.direccion_provincia,
               'estado_civil_familia', n.estado_civil_familia, 'hermanos_total', n.hermanos_total,
               'hermanos_lugar', n.hermanos_lugar, 'observaciones_familia', n.observaciones_familia,
               'como_nos_conocio', n.como_nos_conocio, 'como_nos_conocio_otro', n.como_nos_conocio_otro)
             FROM public.ninos n WHERE n.id = p_nino_id),
    'tutores', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'rol_familia', t.rol_familia, 'nombre_completo', t.nombre_completo, 'email', t.email,
               'telefono', t.telefono, 'fecha_nacimiento', t.fecha_nacimiento,
               'dni_numero', t.dni_numero, 'direccion_calle', t.direccion_calle,
               'direccion_numero', t.direccion_numero, 'direccion_cp', t.direccion_cp,
               'direccion_ciudad', t.direccion_ciudad, 'estudios', t.estudios, 'empresa', t.empresa)
             ORDER BY t.rol_familia, t.id)
        FROM public.familia_tutores t
        JOIN public.ninos n ON n.familia_id = t.familia_id
       WHERE n.id = p_nino_id AND t.deleted_at IS NULL), '[]'::jsonb),
    'pedagogicos', (SELECT jsonb_build_object(
               'lactancia_estado', d.lactancia_estado, 'lactancia_observaciones', d.lactancia_observaciones,
               'control_esfinteres', d.control_esfinteres,
               'control_esfinteres_observaciones', d.control_esfinteres_observaciones,
               'siesta_horario_habitual', d.siesta_horario_habitual,
               'siesta_numero_diario', d.siesta_numero_diario, 'siesta_observaciones', d.siesta_observaciones,
               'tipo_alimentacion', d.tipo_alimentacion,
               'alimentacion_observaciones', d.alimentacion_observaciones,
               'idiomas_casa', d.idiomas_casa, 'tiene_hermanos_en_centro', d.tiene_hermanos_en_centro)
             FROM public.datos_pedagogicos_nino d WHERE d.nino_id = p_nino_id AND d.deleted_at IS NULL),
    'servicios', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'servicio', s.servicio, 'respuesta', s.respuesta, 'concepto_id', s.concepto_id)
             ORDER BY s.servicio)
        FROM public.peticion_servicio s WHERE s.nino_id = p_nino_id), '[]'::jsonb),
    'gastos_gestion', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'curso_academico_id', g.curso_academico_id, 'forma', g.forma,
               'con_justificante', g.justificante_path IS NOT NULL)
             ORDER BY g.curso_academico_id)
        FROM public.gastos_gestion g WHERE g.nino_id = p_nino_id), '[]'::jsonb),
    -- La respuesta de imagen de cada tutor (su «sí» o su «no» vigente) y cuándo la dio: las dos, para
    -- que la foto refleje el estado (decisión del 2026-11-18). No entra en el sello: ver ficha_hash.
    'imagen', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'usuario_id', c.usuario_id,
               'respuesta', CASE c.tipo::text WHEN 'imagen' THEN 'si' ELSE 'no' END,
               'aceptado_en', c.aceptado_en)
             ORDER BY c.usuario_id, c.tipo::text)
        FROM public.consentimientos c
       WHERE c.nino_id = p_nino_id AND c.tipo::text IN ('imagen', 'imagen_denegada')
         AND c.revocado_en IS NULL), '[]'::jsonb),
    -- Los seis campos médicos, descifrados (decisión del 2026-11-17, punto 4).
    'medico', (SELECT jsonb_build_object(
               'alergias_graves',     CASE WHEN m.alergias_graves     IS NULL THEN NULL ELSE pgp_sym_decrypt(m.alergias_graves,     v_clave) END,
               'notas_emergencia',    CASE WHEN m.notas_emergencia    IS NULL THEN NULL ELSE pgp_sym_decrypt(m.notas_emergencia,    v_clave) END,
               'medicacion_habitual', CASE WHEN m.medicacion_habitual IS NULL THEN NULL ELSE pgp_sym_decrypt(m.medicacion_habitual, v_clave) END,
               'alergias_leves',      CASE WHEN m.alergias_leves      IS NULL THEN NULL ELSE pgp_sym_decrypt(m.alergias_leves,      v_clave) END,
               'medico_familia',      CASE WHEN m.medico_familia      IS NULL THEN NULL ELSE pgp_sym_decrypt(m.medico_familia,      v_clave) END,
               'telefono_emergencia', CASE WHEN m.telefono_emergencia IS NULL THEN NULL ELSE pgp_sym_decrypt(m.telefono_emergencia, v_clave) END)
             FROM public.info_medica_emergencia m WHERE m.nino_id = p_nino_id)
  );
END $f$;

-- El sello de la firma: el sha256 de la foto SIN el bloque `imagen`. La foto lo registra (qué respondió
-- cada tutor y cuándo), pero el consentimiento de imagen es retirable en cualquier momento por derecho
-- (art. 7.3): si su cambio invalidara la firma, ejercer ese derecho obligaría a volver a firmar la ficha
-- entera (decisión del 2026-11-18). Es el único bloque de la foto que nace de un consentimiento; lo demás
-- son datos declarados, y rectificarlos sí pide volver a firmar.
CREATE FUNCTION privado.ficha_hash(p_ficha jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, extensions AS $f$
  SELECT encode(extensions.digest(convert_to((p_ficha - 'imagen')::text, 'UTF8'), 'sha256'), 'hex');
$f$;

-- La versión de la plantilla del PDF con la que se firma hoy (la compone la 10c, que conserva las
-- anteriores): sin ella, el PDF de dentro de un año no sería el que se firmó.
CREATE FUNCTION privado.ficha_plantilla_pdf_version()
RETURNS smallint LANGUAGE sql IMMUTABLE AS $f$ SELECT 1::smallint $f$;

-- ─────────────────────────────────────────────────────────────── qué vale
-- La firma que vale hoy: la última del niño, si ninguna petición de refirma es posterior y la foto
-- recompuesta con su versión da su hash. Un cambio en cualquier dato de la foto la deja sin valor sin
-- que nadie tenga que marcarla (decisión del 2026-11-18: «una propiedad en vez de seis sitios»).
CREATE FUNCTION privado.firma_ficha_vigente(p_nino_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SET search_path = public AS $f$
DECLARE
  f public.firmas_ficha%ROWTYPE;
BEGIN
  SELECT * INTO f FROM public.firmas_ficha
   WHERE nino_id = p_nino_id ORDER BY firmado_at DESC, id DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.refirmas_ficha r
              WHERE r.nino_id = p_nino_id AND r.pedida_at > f.firmado_at) THEN
    RETURN NULL;
  END IF;
  IF privado.ficha_hash(privado.ficha_canonica(p_nino_id, f.ficha_version)) <> f.contenido_sha256 THEN
    RETURN NULL;
  END IF;
  RETURN f.id;
END $f$;

-- La respuesta de imagen de un tutor para un niño: 'no' si tiene un «no» vigente, 'si' si tiene un
-- «sí» vigente, NULL si no ha contestado. Una consulta (la condición del 2026-11-17).
CREATE FUNCTION privado.respuesta_imagen(p_usuario_id uuid, p_nino_id uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $f$
  SELECT CASE WHEN bool_or(c.tipo::text = 'imagen_denegada') THEN 'no'
              WHEN bool_or(c.tipo::text = 'imagen') THEN 'si' END
    FROM public.consentimientos c
   WHERE c.usuario_id = p_usuario_id AND c.nino_id = p_nino_id
     AND c.tipo::text IN ('imagen', 'imagen_denegada') AND c.revocado_en IS NULL;
$f$;

-- Quién puede firmar con el dedo: el tutor legal que puede leer la ficha médica (decisión del
-- 2026-11-18: «Nadie firma lo que no puede leer»). Al tutor legal sin el permiso se le dice por qué
-- (HINT `sin_acceso_ficha_medica`: que lo pida a Dirección), no un error opaco.
CREATE FUNCTION privado.puerta_firma_tutor(p_nino_id uuid)
RETURNS public.tipo_vinculo LANGUAGE plpgsql STABLE SET search_path = public AS $f$
DECLARE
  v_tipo public.tipo_vinculo;
BEGIN
  IF auth.uid() IS NULL OR p_nino_id IS NULL OR NOT public.es_tutor_legal_de(p_nino_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.tiene_permiso_sobre(p_nino_id, 'puede_ver_info_medica') THEN
    RAISE EXCEPTION 'sin acceso a la ficha médica del niño'
      USING ERRCODE = 'insufficient_privilege', HINT = 'sin_acceso_ficha_medica';
  END IF;
  SELECT v.tipo_vinculo INTO v_tipo FROM public.vinculos_familiares v
   WHERE v.nino_id = p_nino_id AND v.usuario_id = auth.uid() AND v.deleted_at IS NULL
     AND v.tipo_vinculo IN ('tutor_legal_principal', 'tutor_legal_secundario')
   ORDER BY v.tipo_vinculo LIMIT 1;
  RETURN v_tipo;
END $f$;

-- Quién registra la firma en persona: Dirección del centro del niño, sin el superusuario (ADR-0061).
CREATE FUNCTION privado.puerta_firma_direccion(p_nino_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SET search_path = public AS $f$
BEGIN
  IF auth.uid() IS NULL OR p_nino_id IS NULL
     OR NOT (public.es_admin(privado.centro_de_nino(p_nino_id)) AND NOT public.is_superadmin()) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
END $f$;

-- ─────────────────────────────────────────────────────────────── ver antes de firmar
-- La foto y su hash, para enseñarla y firmar ESO. Enseña lo médico descifrado: deja su lectura en
-- `lecturas_ficha_medica` (origen `alta`), como `get_info_medica_emergencia`.
CREATE FUNCTION public.ficha_para_firmar(p_nino_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE
  v_ficha jsonb;
  v_rol text;
  v_centro uuid := privado.centro_de_nino(p_nino_id);
  v_bloqueada date;
BEGIN
  IF auth.uid() IS NOT NULL AND public.es_admin(v_centro) AND NOT public.is_superadmin() THEN
    SELECT CASE WHEN bool_or(r.rol::text = 'admin') THEN 'admin' ELSE 'directora' END INTO v_rol
      FROM public.roles_usuario r
     WHERE r.usuario_id = auth.uid() AND r.centro_id = v_centro AND r.deleted_at IS NULL
       AND r.rol::text IN ('admin', 'directora');
  ELSE
    PERFORM privado.puerta_firma_tutor(p_nino_id);
    v_rol := 'tutor_legal';
  END IF;

  v_bloqueada := privado.ficha_medica_bloqueada_desde(p_nino_id);
  IF v_bloqueada IS NOT NULL THEN
    RAISE EXCEPTION 'ficha médica bloqueada desde %', v_bloqueada
      USING ERRCODE = 'object_not_in_prerequisite_state', DETAIL = v_bloqueada::text;
  END IF;

  v_ficha := privado.ficha_canonica(p_nino_id, 1);
  INSERT INTO public.lecturas_ficha_medica (nino_id, centro_id, lector_id, rol_lector, origen, campos)
  SELECT p_nino_id, v_centro, auth.uid(), v_rol, 'alta',
         COALESCE(ARRAY(SELECT k FROM jsonb_each_text(CASE WHEN jsonb_typeof(v_ficha->'medico') = 'object' THEN v_ficha->'medico' ELSE '{}'::jsonb END) e(k, v)
                         WHERE v IS NOT NULL ORDER BY k), '{}');
  RETURN jsonb_build_object(
    'ficha', v_ficha, 'hash', privado.ficha_hash(v_ficha),
    'ficha_version', 1, 'plantilla_pdf_version', privado.ficha_plantilla_pdf_version());
END $f$;

-- ─────────────────────────────────────────────────────────────── firmar
-- Lo común a las dos firmas, con la puerta ya pasada. Firmar es finalizar: con la matrícula
-- pendiente, cierra el alta con las puertas de `marcar_matricula_lista` en la misma transacción; si
-- una falla, no queda ni la firma.
CREATE FUNCTION privado.firmar_ficha_comun(
  p_nino_id uuid, p_hash_visto text, p_nombre_tecleado text, p_firma_imagen text,
  p_ip_address inet, p_user_agent text, p_metodo public.firma_metodo, p_rol public.tipo_vinculo)
RETURNS uuid LANGUAGE plpgsql SET search_path = public, extensions AS $f$
DECLARE
  v_ficha jsonb;
  v_hash text;
  v_pendiente boolean;
  v_lista boolean;
  v_ultima public.firmas_ficha%ROWTYPE;
  v_id uuid;
  v_mat uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('firmas_ficha:' || p_nino_id::text));

  SELECT bool_or(estado = 'pendiente'), bool_or(estado = 'lista') INTO v_pendiente, v_lista
    FROM public.matriculas
   WHERE nino_id = p_nino_id AND fecha_baja IS NULL AND deleted_at IS NULL;
  v_pendiente := COALESCE(v_pendiente, false);
  v_lista := COALESCE(v_lista, false);

  -- Qué se puede firmar: el alta pendiente (firmar es finalizar), el alta en `lista` cuya firma ya
  -- no vale (un cambio la invalidó: se vuelve a firmar), o, con el alta validada, solo si Dirección
  -- lo pidió después de la última firma. Las altas validadas no firman hacia atrás solas.
  IF NOT v_pendiente THEN
    SELECT * INTO v_ultima FROM public.firmas_ficha
     WHERE nino_id = p_nino_id ORDER BY firmado_at DESC, id DESC LIMIT 1;
    IF v_lista THEN
      IF privado.firma_ficha_vigente(p_nino_id) IS NOT NULL THEN
        RAISE EXCEPTION 'la ficha ya está firmada' USING HINT = 'nada_que_firmar';
      END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM public.refirmas_ficha r
                       WHERE r.nino_id = p_nino_id
                         AND (v_ultima.id IS NULL OR r.pedida_at > v_ultima.firmado_at)) THEN
      RAISE EXCEPTION 'no hay nada que firmar' USING HINT = 'nada_que_firmar';
    END IF;
  END IF;

  -- La respuesta de imagen de quien cierra el alta (decisión del 2026-11-17: «basta que haya
  -- respuesta de quien firma»).
  IF v_pendiente AND privado.respuesta_imagen(auth.uid(), p_nino_id) IS NULL THEN
    RAISE EXCEPTION 'falta la respuesta de imagen de quien firma' USING HINT = 'imagen_sin_respuesta';
  END IF;

  -- Se firma lo que se vio: si la foto cambió entre verla y firmar, no.
  v_ficha := privado.ficha_canonica(p_nino_id, 1);
  v_hash := privado.ficha_hash(v_ficha);
  IF p_hash_visto IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'la ficha ha cambiado desde que se mostró' USING HINT = 'ficha_cambiada';
  END IF;

  INSERT INTO public.firmas_ficha
    (nino_id, firmante_id, rol_firmante, metodo_firma, nombre_tecleado, firma_imagen, ip_address,
     user_agent, ficha_version, plantilla_pdf_version, contenido_cifrado, contenido_sha256)
  VALUES (p_nino_id, auth.uid(), p_rol, p_metodo, btrim(p_nombre_tecleado), p_firma_imagen,
          p_ip_address, p_user_agent, 1, privado.ficha_plantilla_pdf_version(),
          pgp_sym_encrypt(v_ficha::text, public._get_medical_key()), v_hash)
  RETURNING id INTO v_id;

  IF v_pendiente THEN
    v_mat := public.marcar_matricula_lista(p_nino_id);
    IF v_mat IS NULL THEN
      RAISE EXCEPTION 'el alta no se ha podido cerrar' USING HINT = 'alta_no_cerrada';
    END IF;
  END IF;
  RETURN v_id;
END $f$;

CREATE FUNCTION public.firmar_ficha(
  p_nino_id uuid, p_hash_visto text, p_nombre_tecleado text, p_firma_imagen text,
  p_ip_address inet DEFAULT NULL, p_user_agent text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE
  v_rol public.tipo_vinculo;
BEGIN
  v_rol := privado.puerta_firma_tutor(p_nino_id);
  RETURN privado.firmar_ficha_comun(p_nino_id, p_hash_visto, p_nombre_tecleado, p_firma_imagen,
                                    p_ip_address, p_user_agent, 'digital', v_rol);
END $f$;

CREATE FUNCTION public.registrar_firma_ficha_presencial(
  p_nino_id uuid, p_hash_visto text, p_nombre_tecleado text,
  p_ip_address inet DEFAULT NULL, p_user_agent text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
BEGIN
  PERFORM privado.puerta_firma_direccion(p_nino_id);
  RETURN privado.firmar_ficha_comun(p_nino_id, p_hash_visto, p_nombre_tecleado, NULL,
                                    p_ip_address, p_user_agent, 'presencial', 'admin');
END $f$;

-- ─────────────────────────────────────────────────────────────── refirma y estado
-- Dirección pide que se vuelva a firmar. Nada automático (decisión del 2026-11-16).
CREATE FUNCTION public.pedir_refirma_ficha(p_nino_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_nino_id IS NULL
     OR NOT public.es_admin(privado.centro_de_nino(p_nino_id)) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.firmas_ficha WHERE nino_id = p_nino_id) THEN
    RAISE EXCEPTION 'la ficha no está firmada' USING HINT = 'sin_firma';
  END IF;
  INSERT INTO public.refirmas_ficha (nino_id, pedida_por) VALUES (p_nino_id, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

-- El estado, para las pantallas: si hay firma, si vale, si se pidió refirma y si quien llama puede
-- firmar (y si no, por qué). No enseña nada de la foto.
CREATE FUNCTION public.estado_firma_ficha(p_nino_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE
  v_ultima public.firmas_ficha%ROWTYPE;
  v_puede text;
BEGIN
  IF auth.uid() IS NULL OR p_nino_id IS NULL
     OR NOT (public.es_tutor_legal_de(p_nino_id)
             OR public.es_admin(privado.centro_de_nino(p_nino_id))) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_ultima FROM public.firmas_ficha
   WHERE nino_id = p_nino_id ORDER BY firmado_at DESC, id DESC LIMIT 1;
  v_puede := CASE
    WHEN public.es_tutor_legal_de(p_nino_id)
      THEN CASE WHEN public.tiene_permiso_sobre(p_nino_id, 'puede_ver_info_medica') THEN 'si'
                ELSE 'sin_acceso_ficha_medica' END
    WHEN public.is_superadmin() THEN 'no'
    ELSE 'presencial' END;
  RETURN jsonb_build_object(
    'firmada', v_ultima.id IS NOT NULL,
    'vigente', privado.firma_ficha_vigente(p_nino_id) IS NOT NULL,
    'ultima_firma_en', v_ultima.firmado_at,
    'refirma_pedida', EXISTS (SELECT 1 FROM public.refirmas_ficha r
                               WHERE r.nino_id = p_nino_id
                                 AND (v_ultima.id IS NULL OR r.pedida_at > v_ultima.firmado_at)),
    'puede_firmar', v_puede);
END $f$;

-- El trazo, la IP, el navegador y el nombre tecleado: quien firmó, el tutor legal y la Dirección,
-- respetando el bloqueo de la retención (como `contenido_firmas_documentos`).
CREATE FUNCTION public.contenido_firmas_ficha(p_firma_ids uuid[])
RETURNS TABLE(firma_id uuid, nombre_tecleado text, firma_imagen text, ip_address inet, user_agent text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT f.id, f.nombre_tecleado, f.firma_imagen, f.ip_address, f.user_agent
    FROM public.firmas_ficha f
   WHERE f.id = ANY (p_firma_ids)
     AND auth.uid() IS NOT NULL
     AND NOT privado.firma_bloqueada(f.nino_id, f.firmante_id)
     AND (f.firmante_id = auth.uid()
          OR public.es_tutor_legal_de(f.nino_id)
          OR public.es_admin(privado.centro_de_nino(f.nino_id)));
$f$;

-- Permisos: las auxiliares, cerradas a todos; las públicas, solo con sesión.
REVOKE ALL ON FUNCTION privado.ficha_canonica(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION privado.ficha_hash(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION privado.ficha_plantilla_pdf_version() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION privado.firma_ficha_vigente(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION privado.respuesta_imagen(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION privado.puerta_firma_tutor(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION privado.puerta_firma_direccion(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION privado.firmar_ficha_comun(uuid, text, text, text, inet, text, public.firma_metodo, public.tipo_vinculo) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ficha_para_firmar(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.firmar_ficha(uuid, text, text, text, inet, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.registrar_firma_ficha_presencial(uuid, text, text, inet, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.pedir_refirma_ficha(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.estado_firma_ficha(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.contenido_firmas_ficha(uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.ficha_para_firmar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.firmar_ficha(uuid, text, text, text, inet, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_firma_ficha_presencial(uuid, text, text, inet, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pedir_refirma_ficha(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.estado_firma_ficha(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contenido_firmas_ficha(uuid[]) TO authenticated;

-- ─────────────────────────────────────────────────────────────── guarda posterior
DO $guarda$
DECLARE
  v text;
  c text;
  r text;
  n integer;
BEGIN
  -- Las tablas, con RLS y sus políticas: dos en la firma (la de leer y el bloqueo de la retención,
  -- restrictiva) y una en la refirma.
  SELECT string_agg(policyname || ':' || permissive, ',' ORDER BY policyname) INTO v
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'firmas_ficha';
  IF v IS DISTINCT FROM 'bloqueo_retencion:RESTRICTIVE,firmas_ficha_select:PERMISSIVE' THEN
    RAISE EXCEPTION 'firmas_ficha no quedó con sus dos políticas: %', v;
  END IF;
  SELECT string_agg(policyname, ',') INTO v FROM pg_policies WHERE schemaname = 'public' AND tablename = 'refirmas_ficha';
  IF v IS DISTINCT FROM 'refirmas_ficha_select' THEN
    RAISE EXCEPTION 'refirmas_ficha no quedó con su política: %', v;
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.firmas_ficha'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.refirmas_ficha'::regclass) THEN
    RAISE EXCEPTION 'una de las dos tablas quedó sin RLS';
  END IF;

  -- Nacida cerrada por columnas: la sesión lee estas nueve y ninguna más; nadie escribe.
  SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO v
    FROM pg_attribute a
   WHERE a.attrelid = 'public.firmas_ficha'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND has_column_privilege('authenticated', 'public.firmas_ficha', a.attname, 'SELECT');
  IF v IS DISTINCT FROM 'contenido_sha256,ficha_version,firmado_at,firmante_id,id,metodo_firma,nino_id,plantilla_pdf_version,rol_firmante' THEN
    RAISE EXCEPTION 'la sesión lee de firmas_ficha otras columnas que las nueve: %', v;
  END IF;
  SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO v
    FROM pg_attribute a
   WHERE a.attrelid = 'public.refirmas_ficha'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND has_column_privilege('authenticated', 'public.refirmas_ficha', a.attname, 'SELECT');
  IF v IS DISTINCT FROM 'id,nino_id,pedida_at' THEN
    RAISE EXCEPTION 'la sesión lee de refirmas_ficha otras columnas: %', v;
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    FOREACH c IN ARRAY ARRAY['public.firmas_ficha', 'public.refirmas_ficha'] LOOP
      IF has_table_privilege(r, c, 'INSERT') OR has_table_privilege(r, c, 'UPDATE')
         OR has_table_privilege(r, c, 'DELETE') OR has_table_privilege(r, c, 'TRUNCATE') THEN
        RAISE EXCEPTION '% puede escribir en %', r, c;
      END IF;
    END LOOP;
    IF has_table_privilege(r, 'public.firmas_ficha', 'SELECT') THEN
      RAISE EXCEPTION '% lee firmas_ficha entera, no por columnas', r;
    END IF;
  END LOOP;

  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgname IN ('firmas_ficha_inmutable', 'refirmas_ficha_inmutable') AND NOT tgisinternal
     AND tgfoid = 'privado.ficha_firmada_inmutable()'::regprocedure;
  IF n <> 2 THEN
    RAISE EXCEPTION 'faltan los triggers de inmutabilidad (%)', n;
  END IF;

  -- Las públicas: SECURITY DEFINER, solo con sesión.
  FOREACH c IN ARRAY ARRAY['public.ficha_para_firmar(uuid)', 'public.firmar_ficha(uuid,text,text,text,inet,text)',
      'public.registrar_firma_ficha_presencial(uuid,text,text,inet,text)', 'public.pedir_refirma_ficha(uuid)',
      'public.estado_firma_ficha(uuid)', 'public.contenido_firmas_ficha(uuid[])'] LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure(c)) THEN
      RAISE EXCEPTION '% no es SECURITY DEFINER', c;
    END IF;
    IF NOT has_function_privilege('authenticated', c, 'EXECUTE')
       OR has_function_privilege('anon', c, 'EXECUTE')
       OR has_function_privilege('service_role', c, 'EXECUTE') THEN
      RAISE EXCEPTION '% no quedó solo para authenticated', c;
    END IF;
  END LOOP;
  -- Las auxiliares, cerradas a todos.
  FOREACH c IN ARRAY ARRAY['privado.ficha_canonica(uuid,integer)', 'privado.ficha_hash(jsonb)',
      'privado.ficha_plantilla_pdf_version()', 'privado.firma_ficha_vigente(uuid)',
      'privado.respuesta_imagen(uuid,uuid)', 'privado.puerta_firma_tutor(uuid)',
      'privado.puerta_firma_direccion(uuid)', 'privado.ficha_firmada_inmutable()',
      'privado.firmar_ficha_comun(uuid,text,text,text,inet,text,firma_metodo,tipo_vinculo)'] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF has_function_privilege(r, c, 'EXECUTE') THEN
        RAISE EXCEPTION '% puede ejecutar %', r, c;
      END IF;
    END LOOP;
  END LOOP;

  -- La foto tiene sus ocho claves, también de un niño que no existe (todo NULL o vacío).
  SELECT string_agg(k, ',' ORDER BY k) INTO v
    FROM jsonb_object_keys(privado.ficha_canonica('00000000-0000-0000-0000-000000000000', 1)) k;
  IF v IS DISTINCT FROM 'gastos_gestion,imagen,medico,nino,pedagogicos,servicios,tutores,version' THEN
    RAISE EXCEPTION 'la foto no tiene las claves esperadas: %', v;
  END IF;

  -- El sello no ve la imagen y sí lo demás (por su efecto, no por el texto).
  IF privado.ficha_hash('{"nino": {"a": 1}, "imagen": [{"respuesta": "si"}]}')
       IS DISTINCT FROM privado.ficha_hash('{"nino": {"a": 1}, "imagen": [{"respuesta": "no"}]}')
     OR privado.ficha_hash('{"nino": {"a": 1}, "imagen": []}')
       = privado.ficha_hash('{"nino": {"a": 2}, "imagen": []}') THEN
    RAISE EXCEPTION 'privado.ficha_hash no sella la foto sin la imagen';
  END IF;

  -- La purga, reescrita: borra las dos tablas (en el texto sin comentarios).
  v := regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = 'privado.purgar_nino(uuid)'::regprocedure), chr(13), ''),
                      '--[^' || chr(10) || ']*', '', 'g');
  IF position('DELETE FROM public.firmas_ficha WHERE nino_id = p_nino_id' IN v) = 0
     OR position('DELETE FROM public.refirmas_ficha WHERE nino_id = p_nino_id' IN v) = 0 THEN
    RAISE EXCEPTION 'privado.purgar_nino no quedó reescrita';
  END IF;

  SELECT count(*) INTO n FROM public.firmas_ficha;
  RAISE NOTICE 'ficha firmada: tablas, % firmas, funciones y purga en su sitio', n;
END
$guarda$;
