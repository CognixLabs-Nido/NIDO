-- =============================================================================
-- 0c-1 · El mandato v2: sus datos en la base, y sin CID del centro no se firma ninguno
-- -----------------------------------------------------------------------------
-- Decisiones del responsable (spec docs/specs/altas-serie.md, «SEPA» y el 0c del PR-0):
--
--   · El CID (identificador de acreedor) entra en el mandato con una versión 2 del texto
--     canónico que se hashea. Los mandatos que ya existen se quedan en v1: su hash se puede
--     recalcular con el texto v1. Hoy NADA recalcula el hash de un mandato; la versión es lo que
--     permite hacerlo algún día con el texto con el que se firmó.
--   · El mandato pide el documento de identidad y la dirección del titular, como el papel. Se
--     tratan como `titular`: en claro en la tabla, fuera de audit_log, dentro del export, y se
--     destruyen con el mandato (sus filas las borran anular_alta y destruir_fiscal_familia).
--   · SIN CID DEL CENTRO NO SE FIRMA NINGÚN MANDATO (2026-11-04; revoca «El CID no toca el alta»,
--     del 2026-10-31). Un mandato sin CID no vale para el banco y habría que volver a firmarlo.
--     Aquí la defensa: registrar_mandato_sepa y sustituir_mandato_sepa lo rechazan (HINT
--     centro_sin_cid). La app (0c-2) no enseña el paso: el alta se completa en efectivo.
--
-- Lo que hace:
--   1. mandatos_sepa: version_canonico (1 o 2; las filas de hoy, 1), titular_documento,
--      titular_direccion, y la foto del acreedor con la que se firmó (acreedor_cid,
--      acreedor_nombre). Con v2 son obligatorios, con el hash; con v1, vacíos. La foto hace falta
--      para recalcular el hash v2 aunque el centro cambie después de nombre o de CID.
--   2. privado.version_datos_mandato: la comprobación común de las dos funciones. Sin CID del
--      centro, P0001 centro_sin_cid. Sin ningún dato v2, v1 (la app de antes del 0c-2). Con
--      ellos: completos (mandato_incompleto), el CID y el nombre del centro de verdad
--      (cid_distinto, acreedor_distinto) y el hash en hexadecimal (hash_invalido).
--   3. registrar_mandato_sepa y sustituir_mandato_sepa con cuatro parámetros más, opcionales: la
--      app de hoy las sigue llamando igual. Cambia la firma, así que se borran y se crean (un
--      CREATE OR REPLACE dejaría la vieja como sobrecarga), con los mismos permisos.
--   4. audit_trigger_function: titular_documento y titular_direccion fuera de audit_log.
--   5. export_datos_sujeto: los cinco datos nuevos del mandato salen en el export.
--
-- Orden: ANTES de esta migración, el CID de prueba de CEI Ejemplo
-- (supabase/operaciones/20261229100000_cid_prueba_cei_ejemplo.sql). Sin él, desde esta migración
-- no se puede firmar ningún mandato en CEI Ejemplo, y la app de hoy todavía enseña el paso.
--
-- Se aplica por el SQL Editor copiando este fichero. Sin BEGIN ni COMMIT. Tras aplicar:
-- registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_esperado text;
  v_fn text;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'mandatos_sepa'
                AND column_name IN ('version_canonico', 'titular_documento', 'titular_direccion',
                                    'acreedor_cid', 'acreedor_nombre')) THEN
    RAISE EXCEPTION 'mandatos_sepa ya tiene las columnas del mandato v2: ¿aplicada dos veces?';
  END IF;
  -- Los cuatro cuerpos que se recrean son los de main (lógica normalizada: sin \r, sin
  -- comentarios, espacios colapsados).
  FOR v_fn, v_esperado IN VALUES
    ('registrar_mandato_sepa', 'baf4784d75b6008dbd9bec4a7c0fd0a6'),
    ('sustituir_mandato_sepa', '301cad5c7c5579b869e3af3be785bdc5'),
    ('audit_trigger_function', '22b915a1879ea8f203062cbed913e17e'),
    ('export_datos_sujeto',    '48dda9b29b8b64144aaf02f63f274491')
  LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc WHERE oid = ('public.' || v_fn)::regproc;
    IF v_md5 IS DISTINCT FROM v_esperado THEN
      RAISE EXCEPTION '% no es el cuerpo esperado (md5 %)', v_fn, v_md5;
    END IF;
  END LOOP;
  RAISE NOTICE 'antes: % mandatos (% activos); % centros vivos, % sin CID',
    (SELECT count(*) FROM public.mandatos_sepa),
    (SELECT count(*) FROM public.mandatos_sepa WHERE estado = 'activo' AND deleted_at IS NULL),
    (SELECT count(*) FROM public.centros WHERE deleted_at IS NULL),
    (SELECT count(*) FROM public.centros
      WHERE deleted_at IS NULL AND nullif(btrim(identificador_acreedor), '') IS NULL);
END
$guarda$;

-- ---- 1. Las columnas del mandato v2 ----
ALTER TABLE public.mandatos_sepa
  ADD COLUMN version_canonico smallint NOT NULL DEFAULT 1,
  ADD COLUMN titular_documento text,
  ADD COLUMN titular_direccion text,
  ADD COLUMN acreedor_cid text,
  ADD COLUMN acreedor_nombre text,
  ADD CONSTRAINT mandatos_sepa_version_canonico CHECK (version_canonico IN (1, 2)),
  -- COALESCE: en un CHECK, NULL pasa. Sin él, un v2 sin hash cumpliría la regla.
  ADD CONSTRAINT mandatos_sepa_datos_por_version CHECK (COALESCE(
    CASE version_canonico
      WHEN 1 THEN titular_documento IS NULL AND titular_direccion IS NULL
              AND acreedor_cid IS NULL AND acreedor_nombre IS NULL
      WHEN 2 THEN texto_hash ~ '^[0-9a-f]{64}$'
              AND char_length(btrim(titular_documento)) BETWEEN 1 AND 40
              AND char_length(btrim(titular_direccion)) BETWEEN 1 AND 300
              AND char_length(btrim(acreedor_cid)) BETWEEN 1 AND 35
              AND char_length(btrim(acreedor_nombre)) >= 1
    END, false));

COMMENT ON COLUMN public.mandatos_sepa.version_canonico IS
  'Versión del texto canónico sobre el que se calculó texto_hash: 1 (sin CID, documento ni dirección del titular) o 2 (con ellos, 20261229120000).';
COMMENT ON COLUMN public.mandatos_sepa.titular_documento IS
  'Documento de identidad del titular de la cuenta (NIF, NIE, CIF o extranjero), tal como lo tecleó. En claro, fuera de audit_log, en el export.';
COMMENT ON COLUMN public.mandatos_sepa.titular_direccion IS
  'Dirección del titular de la cuenta. En claro, fuera de audit_log, en el export.';
COMMENT ON COLUMN public.mandatos_sepa.acreedor_cid IS
  'El identificador de acreedor del centro con el que se firmó el mandato (v2). La base comprueba que es el del centro al firmar.';
COMMENT ON COLUMN public.mandatos_sepa.acreedor_nombre IS
  'El nombre del centro con el que se firmó el mandato (v2), para recalcular el hash aunque el centro cambie de nombre.';

-- ---- 2. La comprobación común: CID del centro y datos del v2 ----
-- De invocador: la llaman registrar y sustituir, SECURITY DEFINER de postgres, después de
-- autorizar (así nadie de fuera sabe si un centro tiene CID). Nadie más la ejecuta.
CREATE FUNCTION privado.version_datos_mandato(p_familia_id uuid, p_texto_hash text,
  p_titular_documento text, p_titular_direccion text, p_acreedor_cid text, p_acreedor_nombre text)
 RETURNS smallint
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cid    text;
  v_nombre text;
  v_n      int := num_nonnulls(p_titular_documento, p_titular_direccion, p_acreedor_cid,
                               p_acreedor_nombre);
BEGIN
  SELECT nullif(btrim(c.identificador_acreedor), ''), c.nombre INTO v_cid, v_nombre
    FROM public.centros c WHERE c.id = privado.centro_de_familia(p_familia_id);
  IF v_cid IS NULL THEN
    RAISE EXCEPTION 'el centro no tiene identificador de acreedor: sin él no se firma ningún mandato'
      USING ERRCODE = 'P0001', HINT = 'centro_sin_cid';
  END IF;
  IF v_n = 0 THEN
    RETURN 1;
  END IF;
  IF v_n < 4 OR btrim(p_titular_documento) = '' OR btrim(p_titular_direccion) = '' THEN
    RAISE EXCEPTION 'faltan datos del mandato: documento y dirección del titular, CID y nombre del acreedor'
      USING ERRCODE = 'P0001', HINT = 'mandato_incompleto';
  END IF;
  IF p_acreedor_cid IS DISTINCT FROM v_cid THEN
    RAISE EXCEPTION 'el CID del mandato no es el del centro'
      USING ERRCODE = 'P0001', HINT = 'cid_distinto';
  END IF;
  IF p_acreedor_nombre IS DISTINCT FROM v_nombre THEN
    RAISE EXCEPTION 'el acreedor del mandato no es el centro'
      USING ERRCODE = 'P0001', HINT = 'acreedor_distinto';
  END IF;
  IF p_texto_hash IS NULL OR p_texto_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'el mandato v2 lleva su hash (sha256 en hexadecimal)'
      USING ERRCODE = 'P0001', HINT = 'hash_invalido';
  END IF;
  RETURN 2;
END $function$;
REVOKE ALL ON FUNCTION privado.version_datos_mandato(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---- 3. registrar y sustituir, con los datos del v2 ----
DROP FUNCTION public.registrar_mandato_sepa(uuid, uuid, text, text, text, text, text, text, text,
  inet, text, timestamp with time zone, firma_metodo);
DROP FUNCTION public.sustituir_mandato_sepa(uuid, uuid, text, text, text, text, text, text, text,
  inet, text, timestamp with time zone, firma_metodo);

CREATE FUNCTION public.registrar_mandato_sepa(p_familia_id uuid, p_nino_id uuid, p_iban text, p_titular text, p_identificador_mandato text, p_documento_path text, p_firma_imagen text, p_nombre_tecleado text, p_texto_hash text, p_ip_address inet, p_user_agent text, p_fecha_firma timestamp with time zone, p_metodo firma_metodo DEFAULT 'digital'::firma_metodo, p_titular_documento text DEFAULT NULL, p_titular_direccion text DEFAULT NULL, p_acreedor_cid text DEFAULT NULL, p_acreedor_nombre text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clave       text := public._get_sepa_key();
  v_uid         uuid := auth.uid();
  v_id          uuid;
  v_iban_actual text;
  v_version     smallint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  -- Gate por FAMILIA: admin del centro de la familia O tutor de la familia.
  -- El superusuario no registra el mandato en nombre de la familia (ADR-0061).
  IF NOT ((public.es_admin(privado.centro_de_familia(p_familia_id)) AND NOT public.is_superadmin())
          OR public.es_tutor_de_familia(p_familia_id)) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF p_iban IS NULL OR char_length(p_iban) < 15 OR char_length(p_iban) > 34 THEN
    RAISE EXCEPTION 'IBAN inválido';
  END IF;
  -- Sin el identificador de acreedor del centro no se firma ningún mandato (20261229120000).
  -- Con los datos del texto canónico v2, el mandato es v2; sin ninguno, v1 (la app de antes).
  v_version := privado.version_datos_mandato(p_familia_id, p_texto_hash, p_titular_documento,
    p_titular_direccion, p_acreedor_cid, p_acreedor_nombre);

  -- Mandato ACTIVO de la familia (no por nino+usuario). Se descifra su IBAN para
  -- decidir: mismo IBAN = reintento del alta (UPDATE in-place, sin ensuciar histórico);
  -- IBAN distinto = cambio real de cuenta → NO se pisa aquí, se exige sustituir_mandato_sepa
  -- (revoca + inserta, con histórico). NO se compara `iban_cifrado` directamente:
  -- pgp_sym_encrypt no es determinista (mismo IBAN cifra distinto) → hay que descifrar.
  SELECT id, pgp_sym_decrypt(iban_cifrado, v_clave) INTO v_id, v_iban_actual
  FROM public.mandatos_sepa
  WHERE familia_id = p_familia_id AND estado = 'activo' AND deleted_at IS NULL
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    -- Comparación en CLARO normalizada (sin espacios/tabuladores, mayúsculas) por si el
    -- tecleo trae espacios. Distinto → error claro; el cambio de cuenta va por sustituir.
    IF upper(regexp_replace(v_iban_actual, '\s', '', 'g'))
       <> upper(regexp_replace(p_iban, '\s', '', 'g')) THEN
      RAISE EXCEPTION 'mandato_activo_otro_iban'
        USING HINT = 'existe un mandato activo con otro IBAN; usa sustituir_mandato_sepa';
    END IF;
    UPDATE public.mandatos_sepa SET
      nino_id               = p_nino_id,
      usuario_id            = v_uid,
      iban_cifrado          = pgp_sym_encrypt(p_iban, v_clave),
      iban_ultimos4         = right(regexp_replace(p_iban, '\s', '', 'g'), 4),
      titular               = p_titular,
      identificador_mandato = p_identificador_mandato,
      documento_path        = p_documento_path,
      estado                = 'activo',
      firma_imagen          = p_firma_imagen,
      nombre_tecleado       = p_nombre_tecleado,
      texto_hash            = p_texto_hash,
      ip_address            = p_ip_address,
      user_agent            = p_user_agent,
      fecha_firma           = p_fecha_firma,
      metodo_firma          = p_metodo,
      version_canonico      = v_version,
      titular_documento     = p_titular_documento,
      titular_direccion     = p_titular_direccion,
      acreedor_cid          = p_acreedor_cid,
      acreedor_nombre       = p_acreedor_nombre
    WHERE id = v_id;
  ELSE
    INSERT INTO public.mandatos_sepa (
      centro_id, familia_id, nino_id, usuario_id, iban_cifrado, iban_ultimos4, titular,
      identificador_mandato, documento_path, estado, firma_imagen,
      nombre_tecleado, texto_hash, ip_address, user_agent, fecha_firma, metodo_firma,
      version_canonico, titular_documento, titular_direccion, acreedor_cid, acreedor_nombre
    ) VALUES (
      privado.centro_de_familia(p_familia_id), p_familia_id, p_nino_id, v_uid,
      pgp_sym_encrypt(p_iban, v_clave), right(regexp_replace(p_iban, '\s', '', 'g'), 4), p_titular,
      p_identificador_mandato, p_documento_path, 'activo', p_firma_imagen,
      p_nombre_tecleado, p_texto_hash, p_ip_address, p_user_agent, p_fecha_firma, p_metodo,
      v_version, p_titular_documento, p_titular_direccion, p_acreedor_cid, p_acreedor_nombre
    )
    RETURNING id INTO v_id;
    -- PR-7: el PRIMER mandato que la familia firma EN SU ALTA (firma digital del tutor, sin ningún
    -- hijo con la matrícula ya activada) la pasa a recibo por banco, salvo que la directora ya
    -- haya elegido la forma de pago a mano. Una familia ya dada de alta que activa un mandato (la
    -- domiciliación desde /family/recibos, o el presencial de Dirección), el reintento del alta
    -- (la rama de arriba) y el cambio de cuenta (sustituir_mandato_sepa) no tocan el método: lo
    -- pregunta la app.
    IF p_metodo = 'digital' AND public.es_tutor_de_familia(p_familia_id)
       AND NOT EXISTS (SELECT 1 FROM public.matriculas m JOIN public.ninos n ON n.id = m.nino_id
                        WHERE n.familia_id = p_familia_id AND m.activada_at IS NOT NULL) THEN
      UPDATE public.familias SET metodo_pago = 'sepa'
       WHERE id = p_familia_id AND NOT metodo_pago_manual AND metodo_pago IS DISTINCT FROM 'sepa';
    END IF;
  END IF;

  RETURN v_id;
END;
$function$;

CREATE FUNCTION public.sustituir_mandato_sepa(p_familia_id uuid, p_nino_id uuid, p_iban text, p_titular text, p_identificador_mandato text, p_documento_path text, p_firma_imagen text, p_nombre_tecleado text, p_texto_hash text, p_ip_address inet, p_user_agent text, p_fecha_firma timestamp with time zone, p_metodo firma_metodo DEFAULT 'digital'::firma_metodo, p_titular_documento text DEFAULT NULL, p_titular_direccion text DEFAULT NULL, p_acreedor_cid text DEFAULT NULL, p_acreedor_nombre text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clave   text := public._get_sepa_key();
  v_uid     uuid := auth.uid();
  v_id      uuid;
  v_version smallint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  -- El superusuario no registra el mandato en nombre de la familia (ADR-0061).
  IF NOT ((public.es_admin(privado.centro_de_familia(p_familia_id)) AND NOT public.is_superadmin())
          OR public.es_tutor_de_familia(p_familia_id)) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF p_iban IS NULL OR char_length(p_iban) < 15 OR char_length(p_iban) > 34 THEN
    RAISE EXCEPTION 'IBAN inválido';
  END IF;
  -- Sin el identificador de acreedor del centro no se firma ningún mandato (20261229120000):
  -- antes de revocar el activo. Con los datos del canónico v2, v2; sin ninguno, v1.
  v_version := privado.version_datos_mandato(p_familia_id, p_texto_hash, p_titular_documento,
    p_titular_direccion, p_acreedor_cid, p_acreedor_nombre);

  -- Revoca el activo actual de la familia (se conserva la fila: estado='revocado',
  -- deleted_at NULL, con SU iban_ultimos4 intacto). Libera el índice único ANTES
  -- del INSERT del nuevo activo.
  UPDATE public.mandatos_sepa
    SET estado = 'revocado'
    WHERE familia_id = p_familia_id AND estado = 'activo' AND deleted_at IS NULL;

  INSERT INTO public.mandatos_sepa (
    centro_id, familia_id, nino_id, usuario_id, iban_cifrado, iban_ultimos4, titular,
    identificador_mandato, documento_path, estado, firma_imagen,
    nombre_tecleado, texto_hash, ip_address, user_agent, fecha_firma, metodo_firma,
    version_canonico, titular_documento, titular_direccion, acreedor_cid, acreedor_nombre
  ) VALUES (
    privado.centro_de_familia(p_familia_id), p_familia_id, p_nino_id, v_uid,
    pgp_sym_encrypt(p_iban, v_clave), right(regexp_replace(p_iban, '\s', '', 'g'), 4), p_titular,
    p_identificador_mandato, p_documento_path, 'activo', p_firma_imagen,
    p_nombre_tecleado, p_texto_hash, p_ip_address, p_user_agent, p_fecha_firma, p_metodo,
    v_version, p_titular_documento, p_titular_direccion, p_acreedor_cid, p_acreedor_nombre
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_mandato_sepa(uuid, uuid, text, text, text, text, text, text,
  text, inet, text, timestamp with time zone, firma_metodo, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_mandato_sepa(uuid, uuid, text, text, text, text, text,
  text, text, inet, text, timestamp with time zone, firma_metodo, text, text, text, text)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.sustituir_mandato_sepa(uuid, uuid, text, text, text, text, text, text,
  text, inet, text, timestamp with time zone, firma_metodo, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sustituir_mandato_sepa(uuid, uuid, text, text, text, text, text,
  text, text, inet, text, timestamp with time zone, firma_metodo, text, text, text, text)
  TO authenticated, service_role;

-- ---- 4 y 5. Fuera de audit_log y dentro del export ----
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
                                   'ip_address', 'user_agent', 'titular_documento',
                                   'titular_direccion'];
    v_despues := v_despues - ARRAY['iban_cifrado', 'firma_imagen', 'titular', 'nombre_tecleado',
                                   'ip_address', 'user_agent', 'titular_documento',
                                   'titular_direccion'];
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
  -- TG_TABLE_NAME es `name`, de collation "C", y `::text` la conserva: comparado así con `tabla`
  -- el índice (tabla, registro_id) solo sirve para registro_id y recorre el índice entero en cada
  -- fila (~7 ms con 370 000 filas). Con COLLATE "default" va por clave exacta (0,05 ms).
  IF TG_OP = 'DELETE' AND auth.uid() IS NULL
     AND current_setting('app.borrar_sin_copia', true) = 'on' THEN
    DELETE FROM public.audit_log
     WHERE tabla = TG_TABLE_NAME::text COLLATE "default" AND registro_id = v_registro_id;
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

CREATE OR REPLACE FUNCTION public.export_datos_sujeto(p_sujeto_tipo text, p_sujeto_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_self   boolean;
  v_admin  boolean;
  v_centro uuid;
  v_email  text;
  v_bloq   boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no autorizado a exportar este sujeto'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ---------------------------------------------------------------- USUARIO
  IF p_sujeto_tipo = 'usuario' THEN
    v_self := v_uid = p_sujeto_id;
    IF NOT v_self AND NOT EXISTS (
      SELECT 1 FROM public.roles_usuario ru
       WHERE ru.usuario_id = p_sujeto_id
         AND ru.deleted_at IS NULL
         AND privado.es_responsable(ru.centro_id)
    ) THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = p_sujeto_id;

    -- Cada fila con centro pasa si es el propio usuario o si quien exporta es admin de ese
    -- centro (centro NULL nunca: es_responsable(NULL) es FALSE).
    RETURN jsonb_build_object(
      'preferencias', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'clave', p.clave, 'valor', p.valor, 'actualizado_en', p.updated_at)
               ORDER BY p.clave)
          FROM public.preferencias_usuario p
         WHERE p.usuario_id = p_sujeto_id), '[]'::jsonb),

      'dispositivos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'actualizado_en', s.updated_at,
                 'navegador', s.user_agent, 'registrado_en', s.created_at,
                 'ultima_actividad', s.last_active_at)
               ORDER BY s.created_at)
          FROM public.push_subscriptions s
         WHERE s.usuario_id = p_sujeto_id), '[]'::jsonb),

      'lecturas_conversaciones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'conversacion_id', l.conversacion_id, 'leido_hasta', l.last_read_at)
               ORDER BY l.last_read_at)
          FROM public.lectura_conversacion l
          JOIN public.conversaciones c ON c.id = l.conversacion_id
         WHERE l.usuario_id = p_sujeto_id
           AND (v_self OR (c.centro_id IS NOT NULL AND privado.es_responsable(c.centro_id)))), '[]'::jsonb),

      'lecturas_anuncios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'anuncio_id', l.anuncio_id, 'anuncio', a.titulo, 'leido_en', l.leido_at)
               ORDER BY l.leido_at)
          FROM public.lectura_anuncio l
          JOIN public.anuncios a ON a.id = l.anuncio_id
         WHERE l.usuario_id = p_sujeto_id
           AND (v_self OR (a.centro_id IS NOT NULL AND privado.es_responsable(a.centro_id)))), '[]'::jsonb),

      'invitaciones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'email', i.email, 'nombre_completo', i.nombre_completo,
                 'rol_objetivo', i.rol_objetivo, 'tipo_vinculo', i.tipo_vinculo,
                 -- 2c (2026-11-02, columnas-export.ts)
                 'tipo_personal_aula', i.tipo_personal_aula,
                 'enviada_en', i.created_at, 'expira_en', i.expires_at,
                 'aceptada_en', i.accepted_at, 'rechazada_en', i.rejected_at)
               ORDER BY i.created_at)
          FROM public.invitaciones i
         WHERE v_email IS NOT NULL
           AND lower(i.email) = lower(v_email)
           AND (v_self OR privado.es_responsable(i.centro_id))), '[]'::jsonb),

      'lista_espera_contacto', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', le.created_at, 'actualizado_en', le.updated_at,
                 'telefono_tutor', le.telefono_tutor, 'email_tutor', le.email_tutor,
                 -- 2c (2026-11-02, columnas-export.ts): el prospecto entero, nota incluida
                 'nombre_nino', le.nombre_nino, 'apellidos_nino', le.apellidos_nino,
                 'fecha_nacimiento', le.fecha_nacimiento, 'nota', le.nota,
                 'posicion', le.posicion, 'estado', le.estado, 'curso', ca.nombre,
                 'descartado_en', le.descartado_at)
               ORDER BY le.created_at)
          FROM public.lista_espera le
          LEFT JOIN public.cursos_academicos ca ON ca.id = le.curso_academico_id
         WHERE le.tutor_usuario_id = p_sujeto_id
           AND (v_self OR privado.es_responsable(le.centro_id))), '[]'::jsonb),

      'exportaciones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'exportado_en', e.created_at,
                 'solicitado_por_ti', e.solicitado_por = p_sujeto_id)
               ORDER BY e.created_at)
          FROM public.export_log e
         WHERE e.sujeto_tipo = 'usuario' AND e.sujeto_id = p_sujeto_id
           AND (v_self OR privado.es_responsable(e.centro_id))), '[]'::jsonb),

      'solicitudes_olvido', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', o.created_at,
                 -- 2c (2026-11-02, columnas-export.ts)
                 'por_plazo', o.por_plazo,
                 'solicitado_en', o.solicitado_en, 'estado', o.estado,
                 'pedida_por_centro', o.pedida_por_centro, 'inmediato', o.inmediato,
                 'confirmada_en', o.confirmada_en, 'gracia_hasta', o.gracia_hasta,
                 'rechazada_en', o.rechazada_en, 'motivo_rechazo', o.motivo_rechazo,
                 'retirada_en', o.retirada_en, 'nota_centro', o.nota_centro,
                 'purgado_en', o.purgado_en)
               ORDER BY o.solicitado_en)
          FROM public.olvido_solicitudes o
         WHERE o.sujeto_tipo = 'usuario' AND o.sujeto_id = p_sujeto_id
           AND (v_self OR privado.es_responsable(o.centro_id))), '[]'::jsonb),

      -- Su perfil de tutor en cada familia (solo su fila, no la del otro tutor).
      'perfiles_familia', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', ft.created_at, 'actualizado_en', ft.updated_at, 'borrado_en', ft.deleted_at,
                 'familia_id', ft.familia_id, 'rol_familia', ft.rol_familia,
                 'nombre_completo', ft.nombre_completo, 'email', ft.email,
                 'direccion_calle', ft.direccion_calle, 'direccion_numero', ft.direccion_numero,
                 'direccion_cp', ft.direccion_cp, 'direccion_ciudad', ft.direccion_ciudad,
                 'dni_documento_path', ft.dni_documento_path)
               ORDER BY ft.created_at)
          FROM public.familia_tutores ft
          JOIN public.familias f ON f.id = ft.familia_id
         WHERE ft.usuario_id = p_sujeto_id AND ft.deleted_at IS NULL
           AND (v_self OR privado.es_responsable(f.centro_id))), '[]'::jsonb),

      -- Los mandatos que firmó él. Del IBAN, solo los 4 últimos dígitos.
      'mandatos_sepa', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'texto_hash', m.texto_hash, 'creado_en', m.created_at, 'actualizado_en', m.updated_at, 'borrado_en', m.deleted_at, 'familia_id', m.familia_id,
                 'identificador_mandato', m.identificador_mandato, 'titular', m.titular,
                 'iban_ultimos4', m.iban_ultimos4, 'estado', m.estado,
                 'metodo_firma', m.metodo_firma, 'fecha_firma', m.fecha_firma,
                 'nombre_tecleado', m.nombre_tecleado, 'firma_imagen', m.firma_imagen,
                 'ip_firma', host(m.ip_address), 'navegador_firma', m.user_agent,
                 'documento_path', m.documento_path,
                 -- 0c-1 (20261229120000): el texto canónico v2 y sus datos
                 'version_canonico', m.version_canonico,
                 'titular_documento', m.titular_documento, 'titular_direccion', m.titular_direccion,
                 'acreedor_cid', m.acreedor_cid, 'acreedor_nombre', m.acreedor_nombre)
               ORDER BY m.created_at)
          FROM public.mandatos_sepa m
         WHERE m.usuario_id = p_sujeto_id AND m.deleted_at IS NULL
           AND (v_self OR privado.es_responsable(m.centro_id))), '[]'::jsonb),

      -- Cobros de cada familia de la que es tutor (los dos tutores reciben lo mismo).
      'cobros_familia', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'id', f.id, 'creado_en', f.created_at, 'actualizado_en', f.updated_at, 'borrado_en', f.deleted_at, 'motivo_borrado', f.deleted_reason,
                 'familia', f.etiqueta, 'metodo_pago', f.metodo_pago,
                 -- 2c (2026-11-02, columnas-export.ts)
                 'metodo_pago_manual', f.metodo_pago_manual,
                 'recibos', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', r.created_at, 'actualizado_en', r.updated_at, 'borrado_en', r.deleted_at,
                            'id', r.id,
                            'anio', r.anio, 'mes', r.mes, 'estado', r.estado, 'metodo', r.metodo,
                            'total_centimos', r.total_centimos, 'es_esporadico', r.es_esporadico,
                            'concepto_esporadico', r.concepto_esporadico,
                            'fecha_envio_banco', r.fecha_envio_banco,
                            'fecha_devolucion', r.fecha_devolucion,
                            'cobro_forma', r.cobro_forma, 'cobro_fecha', r.cobro_fecha,
                            'cobro_nota', r.cobro_nota,
                            'cobro_importe_centimos', r.cobro_importe_centimos,
                            'devolucion_gastos_centimos', r.devolucion_gastos_centimos,
                            'devolucion_salida', r.devolucion_salida,
                            -- 20261215120000: la red del export (columnas-export.ts).
                            'regiro_de', r.devuelto_de_recibo_id,
                            'diferencia_de', r.diferencia_de_recibo_id,
                            'fecha_cobro_banco', r.fecha_cobro_banco,
                            'lineas', COALESCE((
                              SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', lr.created_at, 'arrastre_de_recibo_id', lr.arrastre_de_recibo_id, 'sobrante_de_desborde_id', lr.sobrante_de_desborde_id,
                                       'descripcion', lr.descripcion, 'cantidad', lr.cantidad,
                                       'precio_unitario_centimos', lr.precio_unitario_centimos,
                 -- 2c (2026-11-02, columnas-export.ts)
                 'origen', lr.origen,
                                       'importe_centimos', lr.importe_centimos)
                                     ORDER BY lr.created_at, lr.id)
                                FROM public.lineas_recibo lr
                               WHERE lr.recibo_id = r.id), '[]'::jsonb))
                          ORDER BY r.anio, r.mes, r.created_at)
                     FROM public.recibos r
                    WHERE r.familia_id = f.id AND r.deleted_at IS NULL), '[]'::jsonb),
                 'metodos_pago', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', mp.created_at, 'actualizado_en', mp.updated_at, 'borrado_en', mp.deleted_at,
                            'anio', mp.anio, 'mes', mp.mes, 'metodo', mp.metodo)
                          ORDER BY mp.anio, mp.mes)
                     FROM public.metodo_pago_familia mp
                    WHERE mp.familia_id = f.id AND mp.deleted_at IS NULL), '[]'::jsonb),
                 'conceptos_asignados', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', ac.created_at, 'actualizado_en', ac.updated_at, 'borrado_en', ac.deleted_at,
                 -- 2c (2026-11-02, columnas-export.ts)
                            'origen', ac.origen,
                            'concepto', cc.nombre, 'cantidad', ac.cantidad_default,
                            'importe_especial_centimos', ac.importe_override_centimos,
                            'porcentaje_especial_bp', ac.porcentaje_override_bp,
                            'vigencia_desde', ac.vigencia_desde,
                            'vigencia_hasta', ac.vigencia_hasta)
                          ORDER BY ac.created_at)
                     FROM public.asignacion_concepto ac
                     JOIN public.conceptos_cobro cc ON cc.id = ac.concepto_id
                    WHERE ac.familia_id = f.id AND ac.deleted_at IS NULL), '[]'::jsonb),
                 'beca_comedor_excesos', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'id', d.id, 'recibo_id', d.recibo_id, 'creado_en', d.created_at, 'actualizado_en', d.updated_at,
                            'anio', d.anio, 'mes', d.mes, 'origen', d.origen,
                            'cuota_total_centimos', d.cuota_total_centimos,
                            'beca_total_centimos', d.beca_total_centimos,
                            'exceso_centimos', d.exceso_centimos,
                            'estado', d.estado, 'via', d.via, 'resuelto_en', d.resuelto_at)
                          ORDER BY d.anio, d.mes)
                     FROM public.beca_comedor_desborde d
                    WHERE d.familia_id = f.id), '[]'::jsonb),
                 'beca_comedor_transferencias', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'recibo_id', bt.recibo_id, 'creado_en', bt.created_at, 'actualizado_en', bt.updated_at,
                            'anio', bt.anio, 'mes', bt.mes, 'origen', bt.origen,
                            'importe_centimos', bt.importe_centimos,
                            'estado', bt.estado, 'realizada_en', bt.realizada_at)
                          ORDER BY bt.anio, bt.mes)
                     FROM public.beca_comedor_transferencia bt
                    WHERE bt.familia_id = f.id), '[]'::jsonb))
               ORDER BY f.created_at)
          FROM public.familias f
         WHERE f.id IN (SELECT ft.familia_id FROM public.familia_tutores ft
                         WHERE ft.usuario_id = p_sujeto_id AND ft.deleted_at IS NULL)
           AND (v_self OR privado.es_responsable(f.centro_id))), '[]'::jsonb),

      -- Retención (PR-7): lo que se conserva por obligación legal y está bloqueado. No sale, y
      -- no se calla: qué es, cuánto y desde cuándo.
      'datos_bloqueados', privado.datos_bloqueados('usuario', p_sujeto_id, v_self),
      'consultas_datos_bloqueados', privado.consultas_datos_bloqueados('usuario', p_sujeto_id, v_self)
    );
  END IF;

  -- ---------------------------------------------------------------- NIÑO
  IF p_sujeto_tipo = 'nino' THEN
    v_centro := privado.centro_de_nino(p_sujeto_id);
    IF v_centro IS NULL THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_admin := privado.es_responsable(v_centro);
    v_bloq  := privado.nino_bloqueado(p_sujeto_id);
    IF NOT v_admin AND NOT public.es_tutor_legal_de(p_sujeto_id) THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN jsonb_build_object(
      -- Su prospecto entero.
      'lista_espera', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'actualizado_en', le.updated_at,
                 'nombre_nino', le.nombre_nino, 'apellidos_nino', le.apellidos_nino,
                 'fecha_nacimiento', le.fecha_nacimiento, 'telefono_tutor', le.telefono_tutor,
                 'email_tutor', le.email_tutor, 'nota', le.nota, 'posicion', le.posicion,
                 'estado', le.estado, 'curso', ca.nombre, 'apuntado_en', le.created_at,
                 -- 2d (2026-11-02, columnas-export.ts)
                 'descartado_en', le.descartado_at)
               ORDER BY le.created_at)
          FROM public.lista_espera le
          LEFT JOIN public.cursos_academicos ca ON ca.id = le.curso_academico_id
         WHERE le.nino_id = p_sujeto_id), '[]'::jsonb),

      -- Sin motivo_baja. La familia, solo activa/baja (como get_recorrido_nino_familia).
      'matriculas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', m.created_at, 'borrado_en', m.deleted_at,
                 'id', m.id, 'aula', a.nombre, 'curso', ca.nombre, 'estado', m.estado,
                 'fecha_alta', m.fecha_alta, 'fecha_baja', m.fecha_baja,
                 'activada_en', m.activada_at)
               ORDER BY ca.fecha_inicio, m.fecha_alta, m.id)
          FROM public.matriculas m
          JOIN public.aulas a ON a.id = m.aula_id
          JOIN public.cursos_academicos ca ON ca.id = m.curso_academico_id
         WHERE m.nino_id = p_sujeto_id AND m.deleted_at IS NULL
           AND (v_admin OR m.estado IN ('activa', 'baja'))), '[]'::jsonb),

      -- Por sujeto, no por quién firmó: sale también el que dio el otro tutor.
      'consentimientos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', c.created_at,
                 'tipo', c.tipo, 'version_texto', c.version, 'aceptado_en', c.aceptado_en,
                 'revocado_en', c.revocado_en, 'metodo_firma', c.metodo_firma,
                 'otorgado_por', u.nombre_completo)
               ORDER BY c.aceptado_en)
          FROM public.consentimientos c
          LEFT JOIN public.usuarios u ON u.id = c.usuario_id
         WHERE c.nino_id = p_sujeto_id AND NOT v_bloq
           AND NOT privado.usuario_olvidado_en(c.usuario_id, v_centro)), '[]'::jsonb),

      'acuses_alta', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'tipo', aa.tipo, 'metodo', aa.metodo, 'aceptado_en', aa.aceptado_en)
               ORDER BY aa.aceptado_en)
          FROM public.acuses_alta aa
         WHERE aa.nino_id = p_sujeto_id AND NOT v_bloq
           AND NOT (aa.firmante_id IS NOT NULL
                    AND privado.usuario_olvidado_en(aa.firmante_id, aa.centro_id))), '[]'::jsonb),

      'cambios_solicitados', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'entidad', cp.entidad, 'campo', cp.campo,
                 'valor_propuesto', cp.valor_propuesto, 'detalle', cp.payload,
                 'estado', cp.estado, 'solicitado_en', cp.created_at,
                 'decidido_en', cp.decided_at)
               ORDER BY cp.created_at)
          FROM public.cambios_pendientes cp
         WHERE cp.nino_id = p_sujeto_id), '[]'::jsonb),

      'fin_de_curso', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('curso', ca.nombre, 'registrado_en', rf.created_at)
               ORDER BY rf.created_at)
          FROM public.rollover_finaliza rf
          JOIN public.cursos_academicos ca ON ca.id = rf.curso_academico_id
         WHERE rf.nino_id = p_sujeto_id), '[]'::jsonb),

      'citas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', ci.created_at, 'actualizado_en', ci.updated_at,
                 'titulo', ci.titulo, 'tipo', ci.tipo, 'fecha', ci.fecha,
                 'hora_inicio', ci.hora_inicio, 'hora_fin', ci.hora_fin, 'lugar', ci.lugar,
                 'descripcion', ci.descripcion, 'estado', ci.estado)
               ORDER BY ci.fecha, ci.hora_inicio)
          FROM public.citas ci
         WHERE ci.nino_id = p_sujeto_id), '[]'::jsonb),

      'eventos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'id', e.id, 'creado_en', e.created_at, 'actualizado_en', e.updated_at,
                 'titulo', e.titulo, 'tipo', e.tipo, 'fecha', e.fecha, 'fecha_fin', e.fecha_fin,
                 'hora_inicio', e.hora_inicio, 'hora_fin', e.hora_fin, 'lugar', e.lugar,
                 'descripcion', e.descripcion, 'estado', e.estado,
                 -- 2d (2026-11-02, columnas-export.ts)
                 'requiere_confirmacion', e.requiere_confirmacion)
               ORDER BY e.fecha, e.hora_inicio)
          FROM public.eventos e
         WHERE e.nino_id = p_sujeto_id), '[]'::jsonb),

      'confirmaciones_eventos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'evento_id', ce.evento_id, 'creado_en', ce.created_at, 'actualizado_en', ce.updated_at,
                 'evento', e.titulo, 'fecha_evento', e.fecha, 'estado', ce.estado,
                 'comentario', ce.comentario, 'confirmado_at', ce.confirmado_at)
               ORDER BY e.fecha)
          FROM public.confirmaciones_evento ce
          JOIN public.eventos e ON e.id = ce.evento_id
         WHERE ce.nino_id = p_sujeto_id), '[]'::jsonb),

      -- Los dirigidos a la familia sobre el niño; los del personal son trabajo del centro.
      'recordatorios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', r.created_at, 'actualizado_en', r.updated_at,
                 'titulo', r.titulo, 'descripcion', r.descripcion,
                 'vencimiento', r.vencimiento, 'completado_en', r.completado_en,
                 -- 2d (2026-11-02, columnas-export.ts)
                 'erroneo', r.erroneo)
               ORDER BY r.created_at)
          FROM public.recordatorios r
         WHERE r.nino_id = p_sujeto_id AND r.destinatario = 'familia_individual'), '[]'::jsonb),

      'conceptos_asignados', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', ac.created_at, 'actualizado_en', ac.updated_at, 'borrado_en', ac.deleted_at,
                 -- 2c (2026-11-02, columnas-export.ts)
                 'origen', ac.origen,
                 'concepto', cc.nombre, 'cantidad', ac.cantidad_default,
                 'importe_especial_centimos', ac.importe_override_centimos,
                            'porcentaje_especial_bp', ac.porcentaje_override_bp,
                 'vigencia_desde', ac.vigencia_desde, 'vigencia_hasta', ac.vigencia_hasta)
               ORDER BY ac.created_at)
          FROM public.asignacion_concepto ac
          JOIN public.conceptos_cobro cc ON cc.id = ac.concepto_id
         WHERE ac.nino_id = p_sujeto_id AND ac.deleted_at IS NULL), '[]'::jsonb),

      'lineas_recibo', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', lr.created_at, 'beca_tramo_id', lr.beca_tramo_id,
                 'anio', r.anio, 'mes', r.mes, 'descripcion', lr.descripcion,
                 'cantidad', lr.cantidad, 'importe_centimos', lr.importe_centimos,
                 -- 2c (2026-11-02, columnas-export.ts)
                 'precio_unitario_centimos', lr.precio_unitario_centimos, 'origen', lr.origen)
               ORDER BY r.anio, r.mes, lr.created_at)
          FROM public.lineas_recibo lr
          JOIN public.recibos r ON r.id = lr.recibo_id
         WHERE lr.nino_id = p_sujeto_id AND r.deleted_at IS NULL), '[]'::jsonb),

      'servicios_diarios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', ps.created_at, 'actualizado_en', ps.updated_at,
                 'fecha', ps.fecha, 'servicio', ps.servicio, 'presente', ps.presente)
               ORDER BY ps.fecha, ps.servicio)
          FROM public.parte_servicio_diario ps
         WHERE ps.nino_id = p_sujeto_id), '[]'::jsonb),

      'beca_comedor_elegibilidad', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', be.created_at, 'actualizado_en', be.updated_at,
                 'curso', ca.nombre, 'fecha_alta', be.fecha_alta,
                 'fecha_baja', be.fecha_baja, 'activa', be.activa)
               ORDER BY be.fecha_alta)
          FROM public.beca_comedor_elegibilidad be
          JOIN public.cursos_academicos ca ON ca.id = be.curso_academico_id
         WHERE be.nino_id = p_sujeto_id), '[]'::jsonb),

      'beca_comedor_tramos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'id', bt.id, 'tramo_padre_id', bt.tramo_padre_id, 'creado_en', bt.created_at, 'actualizado_en', bt.updated_at,
                 'anio_correspondiente', bt.anio_correspondiente,
                 'mes_correspondiente', bt.mes_correspondiente,
                 'anio_aplicacion', bt.anio_aplicacion, 'mes_aplicacion', bt.mes_aplicacion,
                 'importe_centimos', bt.importe_centimos, 'estado', bt.estado,
                 'origen', bt.origen)
               ORDER BY bt.anio_correspondiente, bt.mes_correspondiente, bt.created_at)
          FROM public.beca_comedor_tramo bt
         WHERE bt.nino_id = p_sujeto_id), '[]'::jsonb),

      -- Sus peticiones de olvido, con su estado (las mismas columnas que en el usuario).
      'solicitudes_olvido', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', o.created_at,
                 'solicitado_en', o.solicitado_en, 'estado', o.estado,
                 'pedida_por_centro', o.pedida_por_centro, 'inmediato', o.inmediato,
                 'confirmada_en', o.confirmada_en, 'gracia_hasta', o.gracia_hasta,
                 'rechazada_en', o.rechazada_en, 'motivo_rechazo', o.motivo_rechazo,
                 'retirada_en', o.retirada_en, 'nota_centro', o.nota_centro,
                 'purgado_en', o.purgado_en,
                 -- 2d (2026-11-02, columnas-export.ts)
                 'por_plazo', o.por_plazo)
               ORDER BY o.solicitado_en)
          FROM public.olvido_solicitudes o
         WHERE o.sujeto_tipo = 'nino' AND o.sujeto_id = p_sujeto_id), '[]'::jsonb),

      -- Quién ha leído su ficha médica (20261128120000). El nombre, solo si es de la familia del
      -- niño; del personal del centro y del soporte, solo el rol (R4, 2026-11-01).
      'lecturas_ficha_medica', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'leida_en', l.leida_en, 'lector', u.nombre_completo, 'rol_lector', l.rol_lector,
                 'origen', l.origen, 'campos', l.campos)
               ORDER BY l.leida_en)
          FROM public.lecturas_ficha_medica l
          LEFT JOIN public.usuarios u ON u.id = l.lector_id
                                     AND l.rol_lector IN ('tutor_legal', 'autorizado')
         WHERE l.nino_id = p_sujeto_id AND NOT v_bloq), '[]'::jsonb),

      -- Retención (PR-7): lo que se conserva por obligación legal y está bloqueado.
      'datos_bloqueados', privado.datos_bloqueados('nino', p_sujeto_id, v_admin),
      'consultas_datos_bloqueados', privado.consultas_datos_bloqueados('nino', p_sujeto_id, true)
    );
  END IF;

  RAISE EXCEPTION 'tipo de sujeto inválido: %', p_sujeto_tipo
    USING ERRCODE = 'invalid_parameter_value';
END
$function$;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_src text;
  v_fn  text;
  v_n   int;
BEGIN
  -- Una sola versión de cada función, la de 17 argumentos.
  FOR v_fn IN VALUES ('registrar_mandato_sepa'), ('sustituir_mandato_sepa') LOOP
    SELECT count(*), max(pronargs) INTO v_n, v_src
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_fn;
    IF v_n <> 1 OR v_src <> '17' THEN
      RAISE EXCEPTION '%: % versiones (argumentos %), esperaba una de 17', v_fn, v_n, v_src;
    END IF;
    SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v_src
      FROM pg_proc WHERE oid = ('public.' || v_fn)::regproc;
    IF strpos(v_src, 'privado.version_datos_mandato(p_familia_id') = 0
       OR strpos(v_src, 'version_canonico') = 0 OR strpos(v_src, 'p_titular_documento') = 0 THEN
      RAISE EXCEPTION '% no mira la versión ni guarda los datos del v2', v_fn;
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = ('public.' || v_fn)::regproc)
       OR has_function_privilege('anon', ('public.' || v_fn)::regproc, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', ('public.' || v_fn)::regproc, 'EXECUTE')
       OR NOT has_function_privilege('service_role', ('public.' || v_fn)::regproc, 'EXECUTE') THEN
      RAISE EXCEPTION '%: SECURITY DEFINER o permisos no esperados', v_fn;
    END IF;
  END LOOP;
  -- La comprobación común: nadie la ejecuta fuera de las dos funciones.
  FOR v_fn IN VALUES ('anon'), ('authenticated'), ('service_role'), ('public') LOOP
    IF has_function_privilege(v_fn,
         'privado.version_datos_mandato(uuid, text, text, text, text, text)', 'EXECUTE') THEN
      RAISE EXCEPTION '% puede ejecutar privado.version_datos_mandato', v_fn;
    END IF;
  END LOOP;
  -- audit_log no recibe los dos datos del titular, y el export los saca.
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v_src
    FROM pg_proc WHERE oid = 'public.audit_trigger_function'::regproc;
  IF (SELECT count(*) FROM regexp_matches(v_src, '''titular_documento''', 'g')) <> 2
     OR (SELECT count(*) FROM regexp_matches(v_src, '''titular_direccion''', 'g')) <> 2 THEN
    RAISE EXCEPTION 'audit_trigger_function no quita los dos datos del titular de antes y después';
  END IF;
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v_src
    FROM pg_proc WHERE oid = 'public.export_datos_sujeto'::regproc;
  IF strpos(v_src, '''titular_documento'', m.titular_documento') = 0
     OR strpos(v_src, '''titular_direccion'', m.titular_direccion') = 0
     OR strpos(v_src, '''version_canonico'', m.version_canonico') = 0
     OR strpos(v_src, '''acreedor_cid'', m.acreedor_cid') = 0 THEN
    RAISE EXCEPTION 'export_datos_sujeto no saca los datos del mandato v2';
  END IF;
  -- Los mandatos que había son todos v1 y sin datos nuevos.
  IF EXISTS (SELECT 1 FROM public.mandatos_sepa
              WHERE version_canonico <> 1 OR titular_documento IS NOT NULL
                 OR acreedor_cid IS NOT NULL) THEN
    RAISE EXCEPTION 'hay mandatos que no son v1 recién añadida la columna';
  END IF;
  RAISE NOTICE 'después: % mandatos, todos v1; % centros vivos sin CID (sin él no se firma)',
    (SELECT count(*) FROM public.mandatos_sepa),
    (SELECT count(*) FROM public.centros
      WHERE deleted_at IS NULL AND nullif(btrim(identificador_acreedor), '') IS NULL);
END
$guarda$;
