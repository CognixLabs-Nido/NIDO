-- El mandato SEPA como prueba, migración 1 de 2 (ANTES del despliegue: solo añade, la app de hoy
-- sigue funcionando). Spec `docs/specs/mandato-sepa-cierre.md`, decisiones del 2026-11-22.
--
--   · El sello v3 (decisión 2): el texto sellado lleva además el sha256 del PDF que compone el
--     servidor, su idioma y la versión de su plantilla. La base RECALCULA el sello con lo que recibe
--     (el IBAN en claro incluido) y rechaza el que no cuadra, comprueba que la ruta es la que sale del
--     sello y que el fichero está en el bucket (decisión 7: el fichero se nombra por el sello y solo
--     cuenta el que la fila nombra). Sin el sha del PDF, las tres funciones siguen firmando v2: la app
--     de hoy. La migración 2, después del despliegue, deja de aceptar un digital v2.
--   · Volver a firmar crea un mandato nuevo (decisión 3): `registrar_mandato_sepa` con el mismo IBAN
--     ya no reescribe la fila activa; la revoca y crea otra, como `sustituir_mandato_sepa`. Medido
--     abierto el 2026-11-22: con un v2 activo, registrar el mismo IBAN dejaba el mismo id con otro
--     identificador, y la firma de antes desaparecía (ya pasó con uno de los tres de producción).
--   · Quién abre el PDF (decisión 4, «sin enlace, como la 10c»): `lecturas_mandato_sepa`, con el
--     mecanismo de `lecturas_ficha_medica`. La escribe `abrir_documento_mandato` en la misma
--     transacción en la que autoriza (Dirección del centro o un tutor de la familia: decisión 5 de
--     Jose, «es su cuenta»), ANTES de que la ruta sirva los bytes. La lee `lecturas_mandato_sepa`.
--   · El alta anulada (decisión del 2026-11-22): el mandato se va con ella, pero el evento del final
--     de `anular_alta` deja constancia de cada mandato destruido (identificador, cuatro últimos
--     dígitos, estado, método, fecha de firma), la fecha y quién anuló; nada de la familia, porque
--     en audit_log no entra lo que la purga no sabe redactar.
--   · El huérfano (decisión del 2026-11-22): `mandatos_sepa_huerfanos()` lista los ficheros del bucket
--     que ninguna fila nombra, de más de un día; el cron de retención los cuenta y los borra, como los
--     de las remesas. `retencion_pasadas` pasa de trece claves a catorce (`mandatosHuerfanos`).

DO $guarda$
DECLARE
  esperadas CONSTANT text[][] := ARRAY[
    ARRAY['anular_alta(uuid,uuid,text)', '59728450d376784fa1e3cda18fa782aa'],
    ARRAY['audit_trigger_function()', 'd3b75253259c939879e5879a673dad3f'],
    ARRAY['es_admin(uuid)', 'da96f192cef9402cf0618ea2cbd82902'],
    ARRAY['es_tutor_de_familia(uuid)', '3b67b913ada5eca51c25a519aed25e29'],
    ARRAY['is_superadmin()', 'e5b750968737756e992fc03aacc862d6'],
    ARRAY['mandatos_sepa_validar_ruta()', '79b220bf3382c0ec3347db580a6c965f'],
    ARRAY['privado.centro_de_familia(uuid)', '7ee913ee666cc0c67708d5185a0566a5'],
    ARRAY['privado.familia_alta_validada(uuid)', '29d2745b5e421aa2a144759bca6da7bd'],
    ARRAY['privado.mandato_v1_cerrado()', '9da0e4be5782ae195540311d1d68deaa'],
    ARRAY['privado.version_datos_mandato(uuid,text,text,text,text,text)', '00984f00406c400c27b548ed3071b0fc'],
    ARRAY['proponer_mandato_sepa(uuid,uuid,text,text,text,text,text,text,text,inet,text,timestamp with time zone,firma_metodo,text,text,text,text)', '12b127b6cd2c439126a10ed48e2de4bf'],
    ARRAY['registrar_mandato_sepa(uuid,uuid,text,text,text,text,text,text,text,inet,text,timestamp with time zone,firma_metodo,text,text,text,text)', 'b335d281b88827c88b73eb531991fc3a'],
    ARRAY['sustituir_mandato_sepa(uuid,uuid,text,text,text,text,text,text,text,inet,text,timestamp with time zone,firma_metodo,text,text,text,text)', '6109cec31eeccf4c75bd822723dac2df']
  ];
  i int;
  v text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20270202120000') THEN
    RAISE EXCEPTION 'mandato: falta la 20270202120000 aplicada';
  END IF;
  FOR i IN 1 .. array_length(esperadas, 1) LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v FROM pg_proc p WHERE p.oid = to_regprocedure(esperadas[i][1]);
    IF v IS DISTINCT FROM esperadas[i][2] THEN
      RAISE EXCEPTION 'mandato: % no es la leída en producción (2026-11-22)', esperadas[i][1];
    END IF;
  END LOOP;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'mandatos_sepa_version_canonico')
       IS DISTINCT FROM 'CHECK ((version_canonico = ANY (ARRAY[1, 2])))' THEN
    RAISE EXCEPTION 'mandato: el CHECK de version_canonico no es el leído';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'retencion_pasadas_recuentos_check')
       NOT LIKE '%''ficherosRemesa''%'
     OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'retencion_pasadas_recuentos_check')
       LIKE '%mandatosHuerfanos%' THEN
    RAISE EXCEPTION 'mandato: el CHECK de retencion_pasadas no es el de trece claves';
  END IF;
  IF to_regclass('public.lecturas_mandato_sepa') IS NOT NULL
     OR to_regproc('public.abrir_documento_mandato') IS NOT NULL
     OR to_regproc('public.mandatos_sepa_huerfanos') IS NOT NULL
     OR to_regproc('privado.version_y_sello_mandato') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                 AND table_name = 'mandatos_sepa' AND column_name = 'documento_sha256') THEN
    RAISE EXCEPTION 'mandato: algo de esta migración ya existe';
  END IF;
END $guarda$;

-- ---------------------------------------------------------------------------------------------
-- 1 · Las columnas del v3. Un v1 o un v2 no las lleva; un v3, todas, y siempre con su documento.
ALTER TABLE public.mandatos_sepa
  ADD COLUMN documento_sha256 text,
  ADD COLUMN documento_idioma text,
  ADD COLUMN plantilla_pdf_version smallint,
  ADD COLUMN acreedor_direccion text;
ALTER TABLE public.mandatos_sepa DROP CONSTRAINT mandatos_sepa_version_canonico;
ALTER TABLE public.mandatos_sepa ADD CONSTRAINT mandatos_sepa_version_canonico
  CHECK (version_canonico = ANY (ARRAY[1, 2, 3]));
ALTER TABLE public.mandatos_sepa ADD CONSTRAINT mandatos_sepa_documento_v3
  CHECK (CASE WHEN version_canonico = 3
              THEN documento_sha256 ~ '^[0-9a-f]{64}$' AND documento_idioma IN ('es', 'en', 'va')
                   AND plantilla_pdf_version >= 1 AND documento_path IS NOT NULL
                   AND acreedor_direccion IS NOT NULL
                   AND texto_hash ~ '^[0-9a-f]{64}$'
              ELSE documento_sha256 IS NULL AND documento_idioma IS NULL AND plantilla_pdf_version IS NULL
                   AND acreedor_direccion IS NULL
         END);
-- El v3 lleva todo lo del v2: el CHECK de los datos lo mira igual.
ALTER TABLE public.mandatos_sepa DROP CONSTRAINT mandatos_sepa_datos_por_version;
ALTER TABLE public.mandatos_sepa ADD CONSTRAINT mandatos_sepa_datos_por_version CHECK (COALESCE(
CASE version_canonico
    WHEN 1 THEN ((titular_documento IS NULL) AND (titular_direccion IS NULL) AND (acreedor_cid IS NULL) AND (acreedor_nombre IS NULL))
    WHEN 2 THEN ((texto_hash ~ '^[0-9a-f]{64}$'::text) AND ((char_length(btrim(titular_documento)) >= 1) AND (char_length(btrim(titular_documento)) <= 40)) AND ((char_length(btrim(titular_direccion)) >= 1) AND (char_length(btrim(titular_direccion)) <= 300)) AND ((char_length(btrim(acreedor_cid)) >= 1) AND (char_length(btrim(acreedor_cid)) <= 35)) AND (char_length(btrim(acreedor_nombre)) >= 1))
    WHEN 3 THEN ((texto_hash ~ '^[0-9a-f]{64}$'::text) AND ((char_length(btrim(titular_documento)) >= 1) AND (char_length(btrim(titular_documento)) <= 40)) AND ((char_length(btrim(titular_direccion)) >= 1) AND (char_length(btrim(titular_direccion)) <= 300)) AND ((char_length(btrim(acreedor_cid)) >= 1) AND (char_length(btrim(acreedor_cid)) <= 35)) AND (char_length(btrim(acreedor_nombre)) >= 1))
    ELSE NULL::boolean
END, false));
COMMENT ON COLUMN public.mandatos_sepa.documento_sha256 IS 'v3 (2026-11-22): el sha256 de los bytes del PDF que compuso el servidor. Entra en el texto sellado (texto_hash), y el fichero se llama por el sello: el PDF queda atado a la firma.';

-- ---------------------------------------------------------------------------------------------
-- 2 · El texto canónico v3 y el sello, en la base. Mismo texto que `textoCanonicoMandatoV3`
-- (src/features/alta/lib/mandato-sepa.ts); un test de la CI compara los dos.
CREATE FUNCTION privado.texto_canonico_mandato_v3(
  p_identificador text, p_iban text, p_titular text, p_titular_documento text,
  p_titular_direccion text, p_acreedor_nombre text, p_acreedor_cid text, p_fecha_firma timestamptz,
  p_documento_sha256 text, p_documento_idioma text, p_plantilla_pdf_version smallint,
  p_acreedor_direccion text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT concat_ws('|',
    'SEPA-CORE-MANDATE-V3',
    'id=' || p_identificador,
    'iban=' || upper(regexp_replace(p_iban, '[\s-]', '', 'g')),
    'titular=' || btrim(p_titular),
    'titular_documento=' || btrim(p_titular_documento),
    'titular_direccion=' || btrim(p_titular_direccion),
    'acreedor=' || btrim(p_acreedor_nombre),
    'acreedor_cid=' || btrim(p_acreedor_cid),
    'acreedor_direccion=' || btrim(p_acreedor_direccion),
    'tipo=recurrente',
    'fecha=' || to_char(p_fecha_firma AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
    'documento_sha256=' || p_documento_sha256,
    'idioma=' || p_documento_idioma,
    'plantilla_pdf=' || p_plantilla_pdf_version::text);
$function$;
REVOKE ALL ON FUNCTION privado.texto_canonico_mandato_v3(text, text, text, text, text, text, text, timestamptz, text, text, smallint, text) FROM PUBLIC, anon, authenticated;

-- La versión de lo que se firma y, si es v3, su sello: lo que la base puede derivar no lo acepta del
-- cliente. Devuelve 2 (sin documento del servidor: la app de hoy, y el presencial) o 3.
CREATE FUNCTION privado.version_y_sello_mandato(
  p_familia_id uuid, p_iban text, p_titular text, p_identificador text, p_documento_path text,
  p_texto_hash text, p_fecha_firma timestamptz, p_metodo firma_metodo, p_titular_documento text,
  p_titular_direccion text, p_acreedor_cid text, p_acreedor_nombre text, p_documento_sha256 text,
  p_documento_idioma text, p_plantilla_pdf_version smallint, p_acreedor_direccion text)
RETURNS smallint
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_version smallint := privado.version_datos_mandato(p_familia_id, p_texto_hash, p_titular_documento,
                          p_titular_direccion, p_acreedor_cid, p_acreedor_nombre);
  v_sello   text;
BEGIN
  IF p_documento_sha256 IS NULL THEN
    IF p_documento_idioma IS NOT NULL OR p_plantilla_pdf_version IS NOT NULL
       OR p_acreedor_direccion IS NOT NULL THEN
      RAISE EXCEPTION 'un mandato con idioma o plantilla de PDF lleva el sha256 de su PDF'
        USING ERRCODE = 'P0001', HINT = 'v3_incompleto';
    END IF;
    RETURN v_version;
  END IF;
  IF p_metodo IS DISTINCT FROM 'digital' THEN
    RAISE EXCEPTION 'el presencial no tiene PDF: su prueba es el papel'
      USING ERRCODE = 'P0001', HINT = 'v3_presencial';
  END IF;
  IF p_documento_sha256 !~ '^[0-9a-f]{64}$' OR p_documento_idioma IS NULL
     OR p_documento_idioma NOT IN ('es', 'en', 'va')
     OR p_plantilla_pdf_version IS NULL OR p_plantilla_pdf_version < 1 THEN
    RAISE EXCEPTION 'el v3 lleva el sha256 del PDF, su idioma y la versión de su plantilla'
      USING ERRCODE = 'P0001', HINT = 'v3_incompleto';
  END IF;
  -- La dirección del acreedor va en el PDF: es la del centro, como el CID y el nombre.
  IF p_acreedor_direccion IS NULL OR btrim(p_acreedor_direccion) IS DISTINCT FROM
       (SELECT coalesce(btrim(c.direccion), '') FROM public.centros c
         WHERE c.id = privado.centro_de_familia(p_familia_id)) THEN
    RAISE EXCEPTION 'la dirección del acreedor no es la del centro'
      USING ERRCODE = 'P0001', HINT = 'acreedor_distinto';
  END IF;
  v_sello := encode(digest(convert_to(privado.texto_canonico_mandato_v3(
               p_identificador, p_iban, p_titular, p_titular_documento, p_titular_direccion,
               p_acreedor_nombre, p_acreedor_cid, p_fecha_firma, p_documento_sha256,
               p_documento_idioma, p_plantilla_pdf_version, p_acreedor_direccion), 'UTF8'), 'sha256'), 'hex');
  IF p_texto_hash IS DISTINCT FROM v_sello THEN
    RAISE EXCEPTION 'el sello no es el de lo que se firma'
      USING ERRCODE = 'P0001', HINT = 'sello_distinto';
  END IF;
  IF p_documento_path IS DISTINCT FROM
       privado.centro_de_familia(p_familia_id) || '/familia/' || p_familia_id || '/mandato-' || v_sello || '.pdf' THEN
    RAISE EXCEPTION 'el fichero del mandato se llama por su sello'
      USING ERRCODE = 'P0001', HINT = 'ruta_distinta';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o
                  WHERE o.bucket_id = 'mandato-sepa' AND o.name = p_documento_path
                    AND o.metadata->>'mimetype' = 'application/pdf') THEN
    RAISE EXCEPTION 'el PDF del mandato no está en el bucket'
      USING ERRCODE = 'P0001', HINT = 'sin_documento';
  END IF;
  RETURN 3;
END $function$;
REVOKE ALL ON FUNCTION privado.version_y_sello_mandato(uuid, text, text, text, text, text, timestamptz, firma_metodo, text, text, text, text, text, text, smallint, text) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 3 · Las tres funciones que crean un mandato, con los tres parámetros del v3 (DEFAULT NULL: la app
-- de hoy las sigue llamando igual). `registrar`, además, ya no reescribe al volver a firmar.
DROP FUNCTION public.registrar_mandato_sepa(uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamptz, firma_metodo, text, text, text, text);
DROP FUNCTION public.sustituir_mandato_sepa(uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamptz, firma_metodo, text, text, text, text);
DROP FUNCTION public.proponer_mandato_sepa(uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamptz, firma_metodo, text, text, text, text);

CREATE FUNCTION public.registrar_mandato_sepa(p_familia_id uuid, p_nino_id uuid, p_iban text, p_titular text, p_identificador_mandato text, p_documento_path text, p_firma_imagen text, p_nombre_tecleado text, p_texto_hash text, p_ip_address inet, p_user_agent text, p_fecha_firma timestamp with time zone, p_metodo firma_metodo DEFAULT 'digital'::firma_metodo, p_titular_documento text DEFAULT NULL::text, p_titular_direccion text DEFAULT NULL::text, p_acreedor_cid text DEFAULT NULL::text, p_acreedor_nombre text DEFAULT NULL::text, p_documento_sha256 text DEFAULT NULL::text, p_documento_idioma text DEFAULT NULL::text, p_plantilla_pdf_version smallint DEFAULT NULL::smallint, p_acreedor_direccion text DEFAULT NULL::text)
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
  v_habia_activo boolean;
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
  -- 2026-11-20 (regla de Jose, opción A): con el alta de la familia validada, el mandato que firma
  -- un tutor es prueba y va a la cola (`proponer_mandato_sepa`); solo Dirección lo cambia directo.
  IF NOT (public.es_admin(privado.centro_de_familia(p_familia_id)) AND NOT public.is_superadmin())
     AND privado.familia_alta_validada(p_familia_id) THEN
    RAISE EXCEPTION 'alta validada: el mandato va a la cola de validacion'
      USING ERRCODE = '42501', HINT = 'cola_validacion';
  END IF;
  IF p_iban IS NULL OR char_length(p_iban) < 15 OR char_length(p_iban) > 34 THEN
    RAISE EXCEPTION 'IBAN inválido';
  END IF;
  -- Sin el identificador de acreedor del centro no se firma ningún mandato (20261229120000).
  -- El mandato es v2, con sus datos; sin ellos no se firma (v1_cerrado, 20261230120000).
  v_version := privado.version_y_sello_mandato(p_familia_id, p_iban, p_titular,
    p_identificador_mandato, p_documento_path, p_texto_hash, p_fecha_firma, p_metodo,
    p_titular_documento, p_titular_direccion, p_acreedor_cid, p_acreedor_nombre,
    p_documento_sha256, p_documento_idioma, p_plantilla_pdf_version, p_acreedor_direccion);

  -- Mandato ACTIVO de la familia (no por nino+usuario). Se descifra su IBAN para
  -- decidir: mismo IBAN = reintento del alta (UPDATE in-place, sin ensuciar histórico);
  -- IBAN distinto = cambio real de cuenta → NO se pisa aquí, se exige sustituir_mandato_sepa
  -- (revoca + inserta, con histórico). NO se compara `iban_cifrado` directamente:
  -- pgp_sym_encrypt no es determinista (mismo IBAN cifra distinto) → hay que descifrar.
  SELECT id, pgp_sym_decrypt(iban_cifrado, v_clave) INTO v_id, v_iban_actual
  FROM public.mandatos_sepa
  WHERE familia_id = p_familia_id AND estado = 'activo' AND deleted_at IS NULL
  LIMIT 1;
  v_habia_activo := v_id IS NOT NULL;

  IF v_id IS NOT NULL THEN
    -- Comparación en CLARO normalizada (sin espacios/tabuladores, mayúsculas) por si el
    -- tecleo trae espacios. Distinto → error claro; el cambio de cuenta va por sustituir.
    IF upper(regexp_replace(v_iban_actual, '\s', '', 'g'))
       <> upper(regexp_replace(p_iban, '\s', '', 'g')) THEN
      RAISE EXCEPTION 'mandato_activo_otro_iban'
        USING HINT = 'existe un mandato activo con otro IBAN; usa sustituir_mandato_sepa';
    END IF;
    -- 2026-11-22 (decisión 3, el criterio de la fase 3): una firma no se borra. Volver a firmar con el
    -- mismo IBAN ya no reescribe la fila: revoca la activa y crea un mandato nuevo, como sustituir.
    UPDATE public.mandatos_sepa SET estado = 'revocado' WHERE id = v_id;
  END IF;
  BEGIN
    INSERT INTO public.mandatos_sepa (
      centro_id, familia_id, nino_id, usuario_id, iban_cifrado, iban_ultimos4, titular,
      identificador_mandato, documento_path, estado, firma_imagen,
      nombre_tecleado, texto_hash, ip_address, user_agent, fecha_firma, metodo_firma,
      version_canonico, titular_documento, titular_direccion, acreedor_cid, acreedor_nombre,
      documento_sha256, documento_idioma, plantilla_pdf_version, acreedor_direccion
    ) VALUES (
      privado.centro_de_familia(p_familia_id), p_familia_id, p_nino_id, v_uid,
      pgp_sym_encrypt(p_iban, v_clave), right(regexp_replace(p_iban, '\s', '', 'g'), 4), p_titular,
      p_identificador_mandato, p_documento_path, 'activo', p_firma_imagen,
      p_nombre_tecleado, p_texto_hash, p_ip_address, p_user_agent, p_fecha_firma, p_metodo,
      v_version, p_titular_documento, p_titular_direccion, p_acreedor_cid, p_acreedor_nombre,
      p_documento_sha256, p_documento_idioma, p_plantilla_pdf_version,
      CASE WHEN p_documento_sha256 IS NULL THEN NULL ELSE p_acreedor_direccion END
    )
    RETURNING id INTO v_id;
    -- PR-7: el PRIMER mandato que la familia firma EN SU ALTA (firma digital del tutor, sin ningún
    -- hijo con la matrícula ya activada) la pasa a recibo por banco, salvo que la directora ya
    -- haya elegido la forma de pago a mano. Una familia ya dada de alta que activa un mandato (la
    -- domiciliación desde /family/recibos, o el presencial de Dirección), el reintento del alta
    -- (la rama de arriba) y el cambio de cuenta (sustituir_mandato_sepa) no tocan el método: lo
    -- pregunta la app.
    IF NOT v_habia_activo AND p_metodo = 'digital' AND public.es_tutor_de_familia(p_familia_id)
       AND NOT EXISTS (SELECT 1 FROM public.matriculas m JOIN public.ninos n ON n.id = m.nino_id
                        WHERE n.familia_id = p_familia_id AND m.activada_at IS NOT NULL) THEN
      UPDATE public.familias SET metodo_pago = 'sepa'
       WHERE id = p_familia_id AND NOT metodo_pago_manual AND metodo_pago IS DISTINCT FROM 'sepa';
    END IF;
  END;

  RETURN v_id;
END;
$function$
;

CREATE FUNCTION public.sustituir_mandato_sepa(p_familia_id uuid, p_nino_id uuid, p_iban text, p_titular text, p_identificador_mandato text, p_documento_path text, p_firma_imagen text, p_nombre_tecleado text, p_texto_hash text, p_ip_address inet, p_user_agent text, p_fecha_firma timestamp with time zone, p_metodo firma_metodo DEFAULT 'digital'::firma_metodo, p_titular_documento text DEFAULT NULL::text, p_titular_direccion text DEFAULT NULL::text, p_acreedor_cid text DEFAULT NULL::text, p_acreedor_nombre text DEFAULT NULL::text, p_documento_sha256 text DEFAULT NULL::text, p_documento_idioma text DEFAULT NULL::text, p_plantilla_pdf_version smallint DEFAULT NULL::smallint, p_acreedor_direccion text DEFAULT NULL::text)
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
  -- 2026-11-20 (regla de Jose, opción A): con el alta de la familia validada, el mandato que firma
  -- un tutor es prueba y va a la cola (`proponer_mandato_sepa`); solo Dirección lo cambia directo.
  IF NOT (public.es_admin(privado.centro_de_familia(p_familia_id)) AND NOT public.is_superadmin())
     AND privado.familia_alta_validada(p_familia_id) THEN
    RAISE EXCEPTION 'alta validada: el mandato va a la cola de validacion'
      USING ERRCODE = '42501', HINT = 'cola_validacion';
  END IF;
  IF p_iban IS NULL OR char_length(p_iban) < 15 OR char_length(p_iban) > 34 THEN
    RAISE EXCEPTION 'IBAN inválido';
  END IF;
  -- Sin el identificador de acreedor del centro no se firma ningún mandato (20261229120000):
  -- antes de revocar el activo. El mandato es v2; sin sus datos no se firma (v1_cerrado,
  -- 20261230120000), y el activo sigue activo.
  v_version := privado.version_y_sello_mandato(p_familia_id, p_iban, p_titular,
    p_identificador_mandato, p_documento_path, p_texto_hash, p_fecha_firma, p_metodo,
    p_titular_documento, p_titular_direccion, p_acreedor_cid, p_acreedor_nombre,
    p_documento_sha256, p_documento_idioma, p_plantilla_pdf_version, p_acreedor_direccion);

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
    version_canonico, titular_documento, titular_direccion, acreedor_cid, acreedor_nombre,
    documento_sha256, documento_idioma, plantilla_pdf_version, acreedor_direccion
  ) VALUES (
    privado.centro_de_familia(p_familia_id), p_familia_id, p_nino_id, v_uid,
    pgp_sym_encrypt(p_iban, v_clave), right(regexp_replace(p_iban, '\s', '', 'g'), 4), p_titular,
    p_identificador_mandato, p_documento_path, 'activo', p_firma_imagen,
    p_nombre_tecleado, p_texto_hash, p_ip_address, p_user_agent, p_fecha_firma, p_metodo,
    v_version, p_titular_documento, p_titular_direccion, p_acreedor_cid, p_acreedor_nombre,
    p_documento_sha256, p_documento_idioma, p_plantilla_pdf_version,
    CASE WHEN p_documento_sha256 IS NULL THEN NULL ELSE p_acreedor_direccion END
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$
;

CREATE FUNCTION public.proponer_mandato_sepa(p_familia_id uuid, p_nino_id uuid, p_iban text, p_titular text, p_identificador_mandato text, p_documento_path text, p_firma_imagen text, p_nombre_tecleado text, p_texto_hash text, p_ip_address inet, p_user_agent text, p_fecha_firma timestamp with time zone, p_metodo firma_metodo DEFAULT 'digital'::firma_metodo, p_titular_documento text DEFAULT NULL::text, p_titular_direccion text DEFAULT NULL::text, p_acreedor_cid text DEFAULT NULL::text, p_acreedor_nombre text DEFAULT NULL::text, p_documento_sha256 text DEFAULT NULL::text, p_documento_idioma text DEFAULT NULL::text, p_plantilla_pdf_version smallint DEFAULT NULL::smallint, p_acreedor_direccion text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clave   text := public._get_sepa_key();
  v_uid     uuid := auth.uid();
  v_version smallint;
  v_nino    uuid;
  v_id      uuid;
BEGIN
  IF v_uid IS NULL OR p_familia_id IS NULL OR NOT public.es_tutor_de_familia(p_familia_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF NOT privado.familia_alta_validada(p_familia_id) THEN
    RAISE EXCEPTION 'el alta de la familia no está validada: el mandato se registra directo'
      USING ERRCODE = 'P0001', HINT = 'sin_validar';
  END IF;
  -- El tutor firma siempre en digital (el presencial lo registra Dirección, directo).
  IF p_metodo IS DISTINCT FROM 'digital' THEN
    RAISE EXCEPTION 'el tutor firma el mandato en digital' USING ERRCODE = '22023', HINT = 'metodo';
  END IF;
  IF p_iban IS NULL OR char_length(p_iban) < 15 OR char_length(p_iban) > 34 THEN
    RAISE EXCEPTION 'IBAN inválido';
  END IF;
  v_version := privado.version_y_sello_mandato(p_familia_id, p_iban, p_titular,
    p_identificador_mandato, p_documento_path, p_texto_hash, p_fecha_firma, p_metodo,
    p_titular_documento, p_titular_direccion, p_acreedor_cid, p_acreedor_nombre,
    p_documento_sha256, p_documento_idioma, p_plantilla_pdf_version, p_acreedor_direccion);

  PERFORM pg_advisory_xact_lock(hashtext('mandato_propuesto:' || p_familia_id::text));
  IF EXISTS (SELECT 1 FROM public.mandatos_sepa
              WHERE familia_id = p_familia_id AND estado = 'propuesto' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'ya hay un cambio de domiciliación esperando a Dirección'
      USING ERRCODE = 'P0001', HINT = 'mandato_pendiente';
  END IF;

  -- El niño de la entrada de la cola: el del alta si es de la familia; si no, uno con el alta validada.
  SELECT n.id INTO v_nino FROM public.ninos n
   WHERE n.familia_id = p_familia_id AND n.deleted_at IS NULL
     AND (n.id = p_nino_id OR public.alta_validada_de_nino(n.id))
   ORDER BY (n.id = p_nino_id) DESC NULLS LAST, n.created_at, n.id
   LIMIT 1;
  IF v_nino IS NULL THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.mandatos_sepa (
    centro_id, familia_id, nino_id, usuario_id, iban_cifrado, iban_ultimos4, titular,
    identificador_mandato, documento_path, estado, firma_imagen,
    nombre_tecleado, texto_hash, ip_address, user_agent, fecha_firma, metodo_firma,
    version_canonico, titular_documento, titular_direccion, acreedor_cid, acreedor_nombre,
    documento_sha256, documento_idioma, plantilla_pdf_version, acreedor_direccion
  ) VALUES (
    privado.centro_de_familia(p_familia_id), p_familia_id, p_nino_id, v_uid,
    pgp_sym_encrypt(p_iban, v_clave), right(regexp_replace(p_iban, '\s', '', 'g'), 4), p_titular,
    p_identificador_mandato, p_documento_path, 'propuesto', p_firma_imagen,
    p_nombre_tecleado, p_texto_hash, p_ip_address, p_user_agent, p_fecha_firma, p_metodo,
    v_version, p_titular_documento, p_titular_direccion, p_acreedor_cid, p_acreedor_nombre,
    p_documento_sha256, p_documento_idioma, p_plantilla_pdf_version,
    CASE WHEN p_documento_sha256 IS NULL THEN NULL ELSE p_acreedor_direccion END
  )
  RETURNING id INTO v_id;

  INSERT INTO public.cambios_pendientes (centro_id, nino_id, entidad, registro_id, payload, solicitado_por)
  VALUES (privado.centro_de_familia(p_familia_id), v_nino, 'mandato_sepa', v_id,
          jsonb_build_object('mandato_id', v_id), v_uid);
  RETURN v_id;
END
$function$
;

REVOKE ALL ON FUNCTION public.registrar_mandato_sepa(uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamptz, firma_metodo, text, text, text, text, text, text, smallint, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sustituir_mandato_sepa(uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamptz, firma_metodo, text, text, text, text, text, text, smallint, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.proponer_mandato_sepa(uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamptz, firma_metodo, text, text, text, text, text, text, smallint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_mandato_sepa(uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamptz, firma_metodo, text, text, text, text, text, text, smallint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sustituir_mandato_sepa(uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamptz, firma_metodo, text, text, text, text, text, text, smallint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.proponer_mandato_sepa(uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamptz, firma_metodo, text, text, text, text, text, text, smallint, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 4 · Quién abre el PDF (decisión 4, con el mecanismo de `lecturas_ficha_medica`).
CREATE TABLE public.lecturas_mandato_sepa (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandato_id  uuid NOT NULL REFERENCES public.mandatos_sepa(id) ON DELETE CASCADE,
  centro_id   uuid NOT NULL REFERENCES public.centros(id) ON DELETE CASCADE,
  lector_id   uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  rol_lector  text NOT NULL CONSTRAINT lecturas_mandato_sepa_rol_check
                CHECK (rol_lector IN ('admin', 'directora', 'superusuario', 'tutor')),
  origen      text NOT NULL CONSTRAINT lecturas_mandato_sepa_origen_check
                CHECK (origen IN ('alta', 'ficha', 'recibos', 'export')),
  leida_en    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lecturas_mandato_sepa_mandato_idx ON public.lecturas_mandato_sepa (mandato_id, leida_en);
ALTER TABLE public.lecturas_mandato_sepa ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lecturas_mandato_sepa FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.lecturas_mandato_sepa IS 'Quién ha abierto el PDF de un mandato SEPA (decisión del 2026-11-22, el mecanismo de lecturas_ficha_medica). La escribe abrir_documento_mandato en la misma transacción en la que autoriza, antes de que la ruta sirva los bytes. Sin políticas ni privilegios para las sesiones; se va con su mandato.';

CREATE FUNCTION public.abrir_documento_mandato(p_mandato_id uuid, p_origen text)
RETURNS TABLE(documento_path text, identificador_mandato text, fecha_firma timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  m     public.mandatos_sepa%ROWTYPE;
  v_rol text;
BEGIN
  IF p_origen IS NULL OR p_origen NOT IN ('alta', 'ficha', 'recibos', 'export') THEN
    RAISE EXCEPTION 'origen no válido' USING ERRCODE = '22023', HINT = 'origen';
  END IF;
  SELECT * INTO m FROM public.mandatos_sepa x WHERE x.id = p_mandato_id AND x.deleted_at IS NULL;
  -- Un mandato que no existe y uno ajeno contestan lo mismo: no se dice cuál es.
  IF v_uid IS NULL OR NOT FOUND OR m.documento_path IS NULL THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF public.es_admin(m.centro_id) THEN
    v_rol := CASE
      WHEN EXISTS (SELECT 1 FROM public.roles_usuario r WHERE r.usuario_id = v_uid AND r.centro_id = m.centro_id
                     AND r.rol::text = 'admin' AND r.deleted_at IS NULL) THEN 'admin'
      WHEN EXISTS (SELECT 1 FROM public.roles_usuario r WHERE r.usuario_id = v_uid AND r.centro_id = m.centro_id
                     AND r.rol::text = 'directora' AND r.deleted_at IS NULL) THEN 'directora'
      ELSE 'superusuario' END;
  ELSIF public.es_tutor_de_familia(m.familia_id) THEN
    v_rol := 'tutor';
  ELSE
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.lecturas_mandato_sepa (mandato_id, centro_id, lector_id, rol_lector, origen)
  VALUES (m.id, m.centro_id, v_uid, v_rol, p_origen);
  RETURN QUERY SELECT m.documento_path, m.identificador_mandato, m.fecha_firma;
END $function$;
REVOKE ALL ON FUNCTION public.abrir_documento_mandato(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abrir_documento_mandato(uuid, text) TO authenticated;
COMMENT ON FUNCTION public.abrir_documento_mandato(uuid, text) IS 'El PDF de un mandato, sin enlace (2026-11-22, como la ficha firmada de la 10c): autoriza (Dirección del centro o un tutor de la familia; decisión 5 de Jose, «es su cuenta», que vale porque la cuenta es común) y deja la lectura en lecturas_mandato_sepa ANTES de que la ruta sirva los bytes.';

-- Quién lo ha abierto: a Dirección, con el nombre; a un tutor de la familia, el nombre de quien es de
-- la familia y, del personal, solo el rol (la raya de `lecturas_ficha_medica`, R4).
CREATE FUNCTION public.lecturas_mandato_sepa(p_familia_id uuid)
RETURNS TABLE(mandato_id uuid, identificador_mandato text, lector_nombre text, nombre_oculto boolean,
              rol_lector text, origen text, leida_en timestamptz)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin boolean := public.es_admin(privado.centro_de_familia(p_familia_id));
BEGIN
  IF auth.uid() IS NULL OR p_familia_id IS NULL
     OR NOT (v_admin OR public.es_tutor_de_familia(p_familia_id)) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT l.mandato_id, m.identificador_mandato,
         CASE WHEN v_admin OR l.rol_lector = 'tutor' THEN u.nombre_completo END,
         NOT (v_admin OR l.rol_lector = 'tutor'),
         l.rol_lector, l.origen, l.leida_en
    FROM public.lecturas_mandato_sepa l
    JOIN public.mandatos_sepa m ON m.id = l.mandato_id
    LEFT JOIN public.usuarios u ON u.id = l.lector_id
   WHERE m.familia_id = p_familia_id
   ORDER BY l.leida_en DESC;
END $function$;
REVOKE ALL ON FUNCTION public.lecturas_mandato_sepa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lecturas_mandato_sepa(uuid) TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5 · El alta anulada deja constancia del mandato que se destruye.
CREATE OR REPLACE FUNCTION public.anular_alta(p_nino_id uuid, p_actor uuid, p_accion text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a          record;
  v_centro   uuid;
  v_fam      uuid;
  v_accion   text;
  v_cuentas  uuid[];
  v_u        uuid;
  v_borradas uuid[] := '{}';
  v_esperan  integer := 0;
  v_n        integer;
  r          jsonb := '{}'::jsonb;
  v_mandatos jsonb := '[]'::jsonb;
BEGIN
  IF p_accion IS NULL OR p_accion NOT IN ('cancelar', 'borrar') THEN
    RAISE EXCEPTION 'acción no válida' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT centro_id, familia_id INTO v_centro, v_fam FROM public.ninos WHERE id = p_nino_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF NOT privado.es_direccion(p_actor, v_centro) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO a FROM privado.alta_sin_terminar(p_nino_id);
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_accion := CASE WHEN a.estado = 'invitacion_abierta' THEN 'cancelar' ELSE 'borrar' END;
  IF v_accion <> p_accion THEN
    RAISE EXCEPTION 'el alta ha cambiado' USING ERRCODE = 'serialization_failure',
      HINT = 'el_alta_ha_cambiado';
  END IF;

  PERFORM set_config('app.audit_actor', 'system:anular_alta', true);

  IF v_accion = 'cancelar' THEN
    UPDATE public.invitaciones SET expires_at = now()
     WHERE nino_id = p_nino_id AND accepted_at IS NULL AND rejected_at IS NULL AND expires_at > now();
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO public.audit_log (tabla, registro_id, accion, usuario_id, centro_id, valores_despues)
    VALUES ('alta_sin_terminar', v_centro, 'UPDATE', p_actor, v_centro,
            jsonb_build_object('accion', 'cancelada'));
    PERFORM set_config('app.audit_actor', '', true);
    RETURN jsonb_build_object('accion', 'cancelada', 'invitaciones', v_n);
  END IF;

  -- Retención (PR-8): un niño o un tutor retenidos no se borran.
  IF privado.retenido(v_centro, 'nino', p_nino_id)
     OR EXISTS (SELECT 1 FROM privado.cuentas_del_alta(p_nino_id, a.familia_nueva) c
                 WHERE privado.retenido(v_centro, 'usuario', c)) THEN
    RAISE EXCEPTION 'hay alguien retenido en el alta'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'retenido';
  END IF;
  -- Un alta sin terminar no tiene operativa; si la tiene, algo no cuadra y no se borra.
  IF EXISTS (SELECT 1 FROM public.asistencias WHERE nino_id = p_nino_id)
     OR EXISTS (SELECT 1 FROM public.ausencias WHERE nino_id = p_nino_id)
     OR EXISTS (SELECT 1 FROM public.agendas_diarias WHERE nino_id = p_nino_id)
     OR EXISTS (SELECT 1 FROM public.conversaciones WHERE nino_id = p_nino_id)
     OR EXISTS (SELECT 1 FROM public.administraciones_medicacion WHERE nino_id = p_nino_id)
     OR EXISTS (SELECT 1 FROM public.informes_evolucion WHERE nino_id = p_nino_id) THEN
    RAISE EXCEPTION 'el niño tiene actividad'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'con_actividad';
  END IF;
  -- Solo se borran borradores: un recibo validado es de otra regla (lo fiscal).
  IF EXISTS (SELECT 1 FROM public.recibos x
              WHERE x.estado <> 'borrador'
                AND ((a.familia_nueva AND x.familia_id = v_fam) OR x.nino_id = p_nino_id
                     OR EXISTS (SELECT 1 FROM public.lineas_recibo l
                                 WHERE l.recibo_id = x.id AND l.nino_id = p_nino_id))) THEN
    RAISE EXCEPTION 'el alta tiene recibos validados'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'con_cobros';
  END IF;

  SELECT coalesce(array_agg(c), '{}') INTO v_cuentas
    FROM privado.cuentas_del_alta(p_nino_id, a.familia_nueva) c;
  PERFORM set_config('app.borrar_sin_copia', 'on', true);

  IF a.familia_nueva THEN
    DELETE FROM public.beca_comedor_transferencia WHERE familia_id = v_fam;
    DELETE FROM public.lineas_recibo l USING public.recibos x
     WHERE l.recibo_id = x.id AND x.familia_id = v_fam;
    DELETE FROM public.recibos WHERE familia_id = v_fam;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    r := r || jsonb_build_object('recibos', v_n);
    -- 2026-11-22: el mandato se va con el alta anulada (no cobró nada), pero queda constancia de
    -- que existió y se destruyó, con la fecha y quién anuló: en el evento del final, sin el IBAN ni
    -- nada de la familia (en audit_log no entra lo que la purga no sabe redactar): se reconoce por
    -- los cuatro últimos dígitos y la fecha de firma.
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'identificador_mandato', m.identificador_mandato, 'iban_ultimos4', m.iban_ultimos4,
             'estado', m.estado, 'metodo_firma', m.metodo_firma, 'fecha_firma', m.fecha_firma,
             'con_documento', m.documento_path IS NOT NULL) ORDER BY m.created_at), '[]'::jsonb)
      INTO v_mandatos FROM public.mandatos_sepa m WHERE m.familia_id = v_fam;
    DELETE FROM public.mandatos_sepa WHERE familia_id = v_fam;
  ELSE
    -- La familia se queda: del alta, solo las líneas del niño en sus borradores, y el niño fuera
    -- de lo que es de la familia (el recibo y el mandato no se van con él en cascada).
    DELETE FROM public.lineas_recibo WHERE nino_id = p_nino_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    r := r || jsonb_build_object('lineas', v_n);
    UPDATE public.recibos x
       SET total_centimos = coalesce((SELECT sum(l.importe_centimos) FROM public.lineas_recibo l
                                       WHERE l.recibo_id = x.id), 0)
     WHERE x.familia_id = v_fam AND x.estado = 'borrador';
    DELETE FROM public.recibos x
     WHERE x.familia_id = v_fam AND x.estado = 'borrador'
       AND NOT EXISTS (SELECT 1 FROM public.lineas_recibo l WHERE l.recibo_id = x.id);
    UPDATE public.recibos SET nino_id = NULL WHERE nino_id = p_nino_id;
    UPDATE public.mandatos_sepa SET nino_id = NULL WHERE nino_id = p_nino_id;
  END IF;

  DELETE FROM public.acuses_alta WHERE nino_id = p_nino_id;
  DELETE FROM public.beca_comedor_tramo WHERE nino_id = p_nino_id;
  DELETE FROM public.beca_comedor_elegibilidad WHERE nino_id = p_nino_id;
  DELETE FROM public.info_medica_emergencia WHERE nino_id = p_nino_id;
  DELETE FROM public.datos_pedagogicos_nino WHERE nino_id = p_nino_id;
  DELETE FROM public.matriculas WHERE nino_id = p_nino_id;
  DELETE FROM public.lista_espera WHERE nino_id = p_nino_id;
  DELETE FROM public.ninos WHERE id = p_nino_id;
  r := r || jsonb_build_object('ninos', 1);

  IF a.familia_nueva THEN
    DELETE FROM public.familia_tutores WHERE familia_id = v_fam;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    r := r || jsonb_build_object('familia_tutores', v_n);
    DELETE FROM public.familias WHERE id = v_fam;
    r := r || jsonb_build_object('familias', 1);
  END IF;

  -- Las cuentas: fuera su rol en el centro, si no le queda allí otro niño ni otra familia; y la
  -- cuenta entera, si no le queda nada en ningún sitio y nada la nombra.
  FOREACH v_u IN ARRAY v_cuentas LOOP
    IF NOT EXISTS (SELECT 1 FROM public.vinculos_familiares v JOIN public.ninos n ON n.id = v.nino_id
                    WHERE v.usuario_id = v_u AND v.deleted_at IS NULL AND n.centro_id = v_centro)
       AND NOT EXISTS (SELECT 1 FROM public.familia_tutores ft
                        WHERE ft.usuario_id = v_u AND ft.centro_id = v_centro) THEN
      DELETE FROM public.roles_usuario
       WHERE usuario_id = v_u AND centro_id = v_centro AND rol::text IN ('tutor_legal', 'autorizado');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.roles_usuario WHERE usuario_id = v_u)
       AND NOT EXISTS (SELECT 1 FROM public.familia_tutores WHERE usuario_id = v_u)
       AND NOT EXISTS (SELECT 1 FROM public.vinculos_familiares WHERE usuario_id = v_u)
       AND NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE usuario_id = v_u) THEN
      BEGIN
        DELETE FROM public.consentimientos WHERE usuario_id = v_u;
        -- Las copias de su propio perfil (lo que cambió con su sesión) la nombran como autora, y la
        -- FK se comprueba antes de que el trigger se lleve las copias: se van primero. Lo demás que
        -- la nombre la sigue frenando.
        DELETE FROM public.audit_log WHERE tabla = 'usuarios' AND registro_id = v_u;
        DELETE FROM public.usuarios WHERE id = v_u;
        v_borradas := v_borradas || v_u;
      EXCEPTION WHEN foreign_key_violation THEN
        v_esperan := v_esperan + 1;
      END;
    END IF;
  END LOOP;

  -- Nada vive más en audit_log que en su tabla: las copias de filas del alta borradas antes.
  DELETE FROM public.audit_log x
   WHERE x.centro_id = v_centro
     AND (x.valores_antes->>'nino_id' = p_nino_id::text
          OR x.valores_despues->>'nino_id' = p_nino_id::text
          OR x.registro_id = p_nino_id
          OR (a.familia_nueva AND (x.valores_antes->>'familia_id' = v_fam::text
                                   OR x.valores_despues->>'familia_id' = v_fam::text
                                   OR x.registro_id = v_fam)));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || jsonb_build_object('copias_huerfanas', v_n);

  PERFORM set_config('app.borrar_sin_copia', '', true);
  INSERT INTO public.audit_log (tabla, registro_id, accion, usuario_id, centro_id, valores_despues)
  VALUES ('alta_sin_terminar', v_centro, 'DELETE', p_actor, v_centro,
          jsonb_build_object('accion', 'borrada')
          || CASE WHEN jsonb_array_length(v_mandatos) > 0
                  THEN jsonb_build_object('mandatos_destruidos', v_mandatos)
                  ELSE '{}'::jsonb END);
  PERFORM set_config('app.audit_actor', '', true);
  RETURN r || jsonb_build_object('accion', 'borrada', 'familia_nueva', a.familia_nueva,
                                 'cuentas', to_jsonb(v_borradas), 'esperan', v_esperan);
END;
$function$
;

-- ---------------------------------------------------------------------------------------------
-- 6 · El huérfano: un fichero del bucket que ninguna fila nombra (una subida cuyo registro no
-- entró y cuyo borrado falló). Con un IBAN dentro, no se queda suelto: lo cuenta y lo borra el cron.
CREATE FUNCTION public.mandatos_sepa_huerfanos()
RETURNS TABLE(ruta text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT o.name FROM storage.objects o
   WHERE o.bucket_id = 'mandato-sepa'
     AND o.created_at < now() - interval '1 day'
     AND NOT EXISTS (SELECT 1 FROM public.mandatos_sepa m WHERE m.documento_path = o.name);
$function$;
REVOKE ALL ON FUNCTION public.mandatos_sepa_huerfanos() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mandatos_sepa_huerfanos() TO service_role;

ALTER TABLE public.retencion_pasadas DROP CONSTRAINT retencion_pasadas_recuentos_check;
ALTER TABLE public.retencion_pasadas ADD CONSTRAINT retencion_pasadas_recuentos_check
  CHECK (jsonb_typeof(recuentos) = 'object'
         AND recuentos ?& ARRAY['olvido', 'retencion', 'lecturasFichaMedica',
                                'auditLog', 'exportLog', 'listaEspera', 'operativa',
                                'expediente', 'firmas', 'cuentas', 'fiscal',
                                'cuentasOlvidadas', 'ficherosRemesa', 'mandatosHuerfanos'])
  NOT VALID;

-- ---------------------------------------------------------------------------------------------
DO $posterior$
DECLARE
  v_firma text := 'uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamp with time zone, firma_metodo, text, text, text, text, text, text, smallint, text';
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['registrar_mandato_sepa', 'sustituir_mandato_sepa', 'proponer_mandato_sepa'] LOOP
    IF (SELECT count(*) FROM pg_proc WHERE proname = f AND pronamespace = 'public'::regnamespace) <> 1
       OR to_regprocedure('public.' || f || '(' || v_firma || ')') IS NULL THEN
      RAISE EXCEPTION 'mandato: % no tiene una sola forma, la del v3', f;
    END IF;
    IF (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.' || f || '(' || v_firma || ')'))
         NOT LIKE '%privado.version_y_sello_mandato(%' THEN
      RAISE EXCEPTION 'mandato: % no pasa por el sello', f;
    END IF;
    IF has_function_privilege('anon', 'public.' || f || '(' || v_firma || ')', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.' || f || '(' || v_firma || ')', 'EXECUTE') THEN
      RAISE EXCEPTION 'mandato: los privilegios de % no son los de antes', f;
    END IF;
  END LOOP;
  IF regexp_replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.registrar_mandato_sepa(' || v_firma || ')')), '--[^\n]*', '', 'g')
       ~ 'UPDATE public\.mandatos_sepa SET\s+nino_id' THEN
    RAISE EXCEPTION 'mandato: registrar sigue reescribiendo la fila';
  END IF;
  IF has_table_privilege('authenticated', 'public.lecturas_mandato_sepa', 'SELECT')
     OR has_table_privilege('anon', 'public.lecturas_mandato_sepa', 'SELECT')
     OR EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'lecturas_mandato_sepa') THEN
    RAISE EXCEPTION 'mandato: lecturas_mandato_sepa se lee con sesión';
  END IF;
  IF has_function_privilege('authenticated', 'public.mandatos_sepa_huerfanos()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.abrir_documento_mandato(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'mandato: los privilegios de las funciones nuevas';
  END IF;
  IF regexp_replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.anular_alta(uuid,uuid,text)'::regprocedure), '--[^\n]*', '', 'g')
       NOT LIKE '%''mandatos_destruidos''%' THEN
    RAISE EXCEPTION 'mandato: anular_alta no deja la constancia';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'retencion_pasadas_recuentos_check')
       NOT LIKE '%''mandatosHuerfanos''%' THEN
    RAISE EXCEPTION 'mandato: el CHECK de retencion_pasadas no tiene la clave nueva';
  END IF;
END $posterior$;
