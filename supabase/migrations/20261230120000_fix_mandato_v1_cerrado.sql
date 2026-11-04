-- =============================================================================
-- 0c-3 · No se firman mandatos v1 nuevos; los que existen se quedan como están
-- -----------------------------------------------------------------------------
-- Decisión del responsable del 2026-11-04, después del despliegue del 0c-2 (#488).
--
--   · Desde el 0c-2 la app firma solo el v2 (con el documento y la dirección del titular y el CID
--     del centro). La base todavía aceptaba la llamada sin esos datos y la guardaba como v1: si la
--     app ya no lo hace, la base no tiene por qué dejar que nadie lo haga por otra vía.
--   · Los mandatos v1 que ya existen (3 en producción el 2026-11-04) se quedan como están: están
--     firmados y su hash se recalcula con el texto v1. Se pueden revocar (al sustituirlos por uno
--     v2) y borrar (anular_alta, destruir_fiscal_familia), y volver a firmarse en su sitio como v2.
--     Lo que se cierra es crear v1 NUEVOS, también volver a firmar uno existente como v1.
--
-- Lo que hace:
--   1. privado.version_datos_mandato: sin ningún dato del v2, P0001 HINT v1_cerrado, en lugar de
--      devolver 1. La llaman registrar_mandato_sepa y sustituir_mandato_sepa antes de escribir (en
--      sustituir, antes de revocar el activo), así que el rechazo no deja nada a medias. Cubre a
--      las sesiones y a service_role: solo esas dos funciones crean mandatos (20261225120000).
--   2. Trigger mandatos_sepa_v1_cerrado (BEFORE INSERT OR UPDATE), para todos, también postgres
--      por el SQL Editor y cualquier función futura: un INSERT v1 no entra, y un UPDATE que deja
--      la fila en v1 solo vale si ya era v1 y no cambia lo firmado (HINT v1_solo_existentes).
--      HINT distinto del de la función: así un test distingue cuál de las dos defensas rechaza.
--   3. version_canonico DEFAULT 2: el DEFAULT 1 decía que lo normal es el v1.
--   1b. registrar_mandato_sepa y sustituir_mandato_sepa: solo su comentario («sin ninguno, v1»);
--      la misma lógica, comprobada por su md5 normalizado antes y después. Mismos permisos.
--
-- Se aplica por el SQL Editor copiando este fichero. Sin BEGIN ni COMMIT. Tras aplicar:
-- registrar en supabase_migrations.schema_migrations. Orden: después del despliegue del 0c-2 (la
-- app de antes llamaba sin los datos del v2 y desde aquí recibiría v1_cerrado). Desplegado el
-- 2026-11-04 (ac5f91d, despliegue 7545505531 en success).
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_fn text;
  v_esperado text;
BEGIN
  -- El cuerpo que se recrea es el de 20261229120000 (lógica normalizada: sin \r, sin
  -- comentarios, espacios colapsados).
  SELECT md5(regexp_replace(regexp_replace(replace(prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc
   WHERE oid = 'privado.version_datos_mandato(uuid, text, text, text, text, text)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '45a6d2850853d39662520f1e2c53ace2' THEN
    RAISE EXCEPTION 'privado.version_datos_mandato no es el cuerpo esperado (md5 %)', v_md5;
  END IF;
  -- registrar y sustituir: se recrean solo para cambiar su comentario (misma lógica).
  FOR v_fn, v_esperado IN VALUES
    ('registrar_mandato_sepa', 'bf41590cd48371fc73cd20b33453a108'),
    ('sustituir_mandato_sepa', '9cbd3c733f0fbe49ce34431ab457d40e')
  LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc WHERE oid = ('public.' || v_fn)::regproc;
    IF v_md5 IS DISTINCT FROM v_esperado THEN
      RAISE EXCEPTION '% no es el cuerpo esperado (md5 %)', v_fn, v_md5;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.mandatos_sepa'::regclass
                AND tgname = 'mandatos_sepa_v1_cerrado') THEN
    RAISE EXCEPTION 'mandatos_sepa ya tiene el trigger mandatos_sepa_v1_cerrado: ¿aplicada dos veces?';
  END IF;
  RAISE NOTICE 'antes: % mandatos, % v1 (% activos), % v2',
    (SELECT count(*) FROM public.mandatos_sepa),
    (SELECT count(*) FROM public.mandatos_sepa WHERE version_canonico = 1),
    (SELECT count(*) FROM public.mandatos_sepa WHERE version_canonico = 1 AND estado = 'activo'
        AND deleted_at IS NULL),
    (SELECT count(*) FROM public.mandatos_sepa WHERE version_canonico = 2);
END
$guarda$;

-- ---- 1. La comprobación común: sin los datos del v2, no ----
CREATE OR REPLACE FUNCTION privado.version_datos_mandato(p_familia_id uuid, p_texto_hash text,
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
    RAISE EXCEPTION 'ya no se firman mandatos v1: los que existen se quedan como están, y uno nuevo lleva el documento y la dirección del titular y el CID del centro (v2)'
      USING ERRCODE = 'P0001', HINT = 'v1_cerrado';
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

-- ---- 1b. registrar y sustituir: solo su comentario ----
-- Sus cuerpos decían «sin ninguno, v1». Se recrean con el comentario corregido y la misma lógica: la
-- guarda posterior comprueba que el md5 normalizado (sin comentarios) es el de antes.
CREATE OR REPLACE FUNCTION public.registrar_mandato_sepa(p_familia_id uuid, p_nino_id uuid, p_iban text, p_titular text, p_identificador_mandato text, p_documento_path text, p_firma_imagen text, p_nombre_tecleado text, p_texto_hash text, p_ip_address inet, p_user_agent text, p_fecha_firma timestamp with time zone, p_metodo firma_metodo DEFAULT 'digital'::firma_metodo, p_titular_documento text DEFAULT NULL, p_titular_direccion text DEFAULT NULL, p_acreedor_cid text DEFAULT NULL, p_acreedor_nombre text DEFAULT NULL)
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
  -- El mandato es v2, con sus datos; sin ellos no se firma (v1_cerrado, 20261230120000).
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

CREATE OR REPLACE FUNCTION public.sustituir_mandato_sepa(p_familia_id uuid, p_nino_id uuid, p_iban text, p_titular text, p_identificador_mandato text, p_documento_path text, p_firma_imagen text, p_nombre_tecleado text, p_texto_hash text, p_ip_address inet, p_user_agent text, p_fecha_firma timestamp with time zone, p_metodo firma_metodo DEFAULT 'digital'::firma_metodo, p_titular_documento text DEFAULT NULL, p_titular_direccion text DEFAULT NULL, p_acreedor_cid text DEFAULT NULL, p_acreedor_nombre text DEFAULT NULL)
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
  -- antes de revocar el activo. El mandato es v2; sin sus datos no se firma (v1_cerrado,
  -- 20261230120000), y el activo sigue activo.
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

-- ---- 2. El trigger: para todos, también postgres ----
-- «Lo firmado» de un mandato: lo que entra en su texto canónico o en su firma. Un v1 que ya existe
-- puede cambiar de estado (revocarse), de ruta del documento o de niño informativo; lo firmado no.
CREATE FUNCTION privado.mandato_v1_cerrado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.version_canonico IS DISTINCT FROM 1 THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'ya no se crean mandatos v1: los que existen se quedan como están'
      USING ERRCODE = 'P0001', HINT = 'v1_solo_existentes';
  END IF;
  IF OLD.version_canonico IS DISTINCT FROM 1
     OR ROW(NEW.familia_id, NEW.iban_cifrado, NEW.titular, NEW.identificador_mandato,
            NEW.firma_imagen, NEW.nombre_tecleado, NEW.texto_hash, NEW.fecha_firma,
            NEW.metodo_firma, NEW.titular_documento, NEW.titular_direccion, NEW.acreedor_cid,
            NEW.acreedor_nombre)
        IS DISTINCT FROM
        ROW(OLD.familia_id, OLD.iban_cifrado, OLD.titular, OLD.identificador_mandato,
            OLD.firma_imagen, OLD.nombre_tecleado, OLD.texto_hash, OLD.fecha_firma,
            OLD.metodo_firma, OLD.titular_documento, OLD.titular_direccion, OLD.acreedor_cid,
            OLD.acreedor_nombre) THEN
    RAISE EXCEPTION 'un mandato v1 no se vuelve a firmar como v1: los que existen se quedan como están'
      USING ERRCODE = 'P0001', HINT = 'v1_solo_existentes';
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION privado.mandato_v1_cerrado() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER mandatos_sepa_v1_cerrado
  BEFORE INSERT OR UPDATE ON public.mandatos_sepa
  FOR EACH ROW EXECUTE FUNCTION privado.mandato_v1_cerrado();

-- ---- 3. El DEFAULT ----
ALTER TABLE public.mandatos_sepa ALTER COLUMN version_canonico SET DEFAULT 2;
COMMENT ON COLUMN public.mandatos_sepa.version_canonico IS
  'Versión del texto canónico sobre el que se calculó texto_hash: 1 (sin CID, documento ni dirección del titular; solo los firmados antes de 20261230120000, que no se crean ni se vuelven a firmar como v1) o 2 (con ellos, 20261229120000).';

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_src text;
  v_fn text;
  v_esperado text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc
   WHERE oid = 'privado.version_datos_mandato(uuid, text, text, text, text, text)'::regprocedure;
  IF strpos(v_src, 'v1_cerrado') = 0 OR strpos(v_src, 'RETURN 1') > 0 THEN
    RAISE EXCEPTION 'privado.version_datos_mandato todavía devuelve un v1';
  END IF;
  FOR v_fn, v_esperado IN VALUES
    ('registrar_mandato_sepa', 'bf41590cd48371fc73cd20b33453a108'),
    ('sustituir_mandato_sepa', '9cbd3c733f0fbe49ce34431ab457d40e')
  LOOP
    SELECT prosrc INTO v_src FROM pg_proc WHERE oid = ('public.' || v_fn)::regproc;
    IF md5(regexp_replace(regexp_replace(replace(v_src, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
         IS DISTINCT FROM v_esperado THEN
      RAISE EXCEPTION '% ha cambiado de lógica: solo tenía que cambiar su comentario', v_fn;
    END IF;
    IF strpos(v_src, 'sin ninguno, v1') > 0 THEN
      RAISE EXCEPTION '% todavía dice que sin los datos del v2 el mandato es v1', v_fn;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.mandatos_sepa'::regclass
                    AND tgname = 'mandatos_sepa_v1_cerrado' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'falta el trigger mandatos_sepa_v1_cerrado, o no está activo';
  END IF;
  IF has_function_privilege('authenticated', 'privado.version_datos_mandato(uuid, text, text, text, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'privado.mandato_v1_cerrado()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated puede ejecutar una de las dos funciones';
  END IF;
  IF (SELECT column_default FROM information_schema.columns WHERE table_schema = 'public'
        AND table_name = 'mandatos_sepa' AND column_name = 'version_canonico') IS DISTINCT FROM '2' THEN
    RAISE EXCEPTION 'version_canonico no tiene DEFAULT 2';
  END IF;
  RAISE NOTICE 'después: % mandatos, % v1 (no se tocan), % v2',
    (SELECT count(*) FROM public.mandatos_sepa),
    (SELECT count(*) FROM public.mandatos_sepa WHERE version_canonico = 1),
    (SELECT count(*) FROM public.mandatos_sepa WHERE version_canonico = 2);
END
$guarda$;
