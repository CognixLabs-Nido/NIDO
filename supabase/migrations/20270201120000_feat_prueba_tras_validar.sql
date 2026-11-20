-- Después de validar, lo que es prueba no cambia sin Dirección (2026-11-20, regla de Jose, opción A).
--
-- «una vez que la directora valide los documentos en el alta, una familia no debe poder cambiar nada
-- sin validación (ni sepa, ni dni, ni firmas realizadas, ni nada)»; y la opción A: la regla vale para
-- LO QUE ES PRUEBA DE ALGO, la documentación y las firmas (docs/specs/altas-serie.md, «Después de
-- validar, nada cambia sin validación»). Medido abierto en producción el 2026-11-20
-- (~/nido-logs/11/abierto/medida/RESUMEN.md). Este PR cierra:
--   1 a 5 · los cinco ficheros (DNI de los tutores, libro de familia, PDF del mandato, tarjeta
--           sanitaria, justificante de gastos): la tutora SOBRESCRIBÍA el validado en su misma ruta,
--           sin cambiar ninguna fila ni dejar rastro. Con el alta validada ya no; subir uno nuevo a otra
--           ruta sigue siendo como se propone el cambio a la cola.
--   8     · el mandato SEPA: con la familia validada, `registrar` y `sustituir` de un tutor van a la cola
--           (`proponer_mandato_sepa`); Dirección lo aprueba o lo rechaza (`decidir_mandato_propuesto`).
--   14    · la ficha firmada que deja de valer por un cambio libre: Dirección la ve en su lista
--           (`fichas_firmadas_sin_validez`).
--   y la autobaja: `usuarios` solo deja a la sesión escribir las dos columnas que la app escribe
--           (`foto_url`, `idioma_preferido`); `deleted_at` y las versiones de consentimiento, solo las
--           funciones.
-- Fuera, a propósito: el 7 (firmar una recogida nueva con personas y fotos), esperando a Jose.
--
-- El enum `estado_mandato_sepa` gana 'propuesto' y 'rechazado'. Postgres no deja USAR un valor nuevo en
-- la transacción que lo añade: aquí solo aparece dentro de cuerpos de funciones, que no se ejecutan.


DO $guarda$
DECLARE
  v text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20270131120000') THEN
    RAISE EXCEPTION 'prueba tras validar: falta 20270131120000 (10c) aplicada';
  END IF;
  IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.registrar_mandato_sepa(uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamp with time zone, public.firma_metodo, text, text, text, text)'::regprocedure), chr(13), '')) IS DISTINCT FROM '2c526e6cbf4b24b92c20d620bc9b8597' THEN
    RAISE EXCEPTION 'prueba tras validar: % no es la leída en producción el 2026-11-20', 'public.registrar_mandato_sepa(uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamp with time zone, public.firma_metodo, text, text, text, text)';
  END IF;
  IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.sustituir_mandato_sepa(uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamp with time zone, public.firma_metodo, text, text, text, text)'::regprocedure), chr(13), '')) IS DISTINCT FROM 'c60a10882cd5bc8cfb3164a60148cda3' THEN
    RAISE EXCEPTION 'prueba tras validar: % no es la leída en producción el 2026-11-20', 'public.sustituir_mandato_sepa(uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamp with time zone, public.firma_metodo, text, text, text, text)';
  END IF;
  IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'privado.familia_alta_validada(uuid)'::regprocedure), chr(13), '')) IS DISTINCT FROM '855702e4eb397360c65d0b090908b804' THEN
    RAISE EXCEPTION 'prueba tras validar: % no es la leída en producción el 2026-11-20', 'privado.familia_alta_validada(uuid)';
  END IF;
  IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.alta_validada_de_nino(uuid)'::regprocedure), chr(13), '')) IS DISTINCT FROM 'd7d29861c7387956eb1b0d1477e2387b' THEN
    RAISE EXCEPTION 'prueba tras validar: % no es la leída en producción el 2026-11-20', 'public.alta_validada_de_nino(uuid)';
  END IF;
  IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'privado.firma_ficha_vigente(uuid)'::regprocedure), chr(13), '')) IS DISTINCT FROM '49d9d44a87bd06073f47105f6076d0be' THEN
    RAISE EXCEPTION 'prueba tras validar: % no es la leída en producción el 2026-11-20', 'privado.firma_ficha_vigente(uuid)';
  END IF;
  IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'privado.version_datos_mandato(uuid, text, text, text, text, text)'::regprocedure), chr(13), '')) IS DISTINCT FROM '3426979de4d3ae283528af7f7645f6d1' THEN
    RAISE EXCEPTION 'prueba tras validar: % no es la leída en producción el 2026-11-20', 'privado.version_datos_mandato(uuid, text, text, text, text, text)';
  END IF;
  IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.familia_de_nino(uuid)'::regprocedure), chr(13), '')) IS DISTINCT FROM '729a8337cad2f529e8c888468e85597c' THEN
    RAISE EXCEPTION 'prueba tras validar: % no es la leída en producción el 2026-11-20', 'public.familia_de_nino(uuid)';
  END IF;
  IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'privado.puede_ver_dni_tutor(text, text)'::regprocedure), chr(13), '')) IS DISTINCT FROM 'fdd92d813ba081f8a9c7858948c380c9' THEN
    RAISE EXCEPTION 'prueba tras validar: % no es la leída en producción el 2026-11-20', 'privado.puede_ver_dni_tutor(text, text)';
  END IF;
  IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'privado.ruta_coherente(text, text)'::regprocedure), chr(13), '')) IS DISTINCT FROM '878d9457dc0ca27c6810082c835c7e1c' THEN
    RAISE EXCEPTION 'prueba tras validar: % no es la leída en producción el 2026-11-20', 'privado.ruta_coherente(text, text)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'dni_tutores_update'
                   AND cmd = 'UPDATE' AND qual = '((bucket_id = ''dni-tutores''::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR privado.puede_ver_dni_tutor(name, owner_id)) AND privado.ruta_coherente(bucket_id, name))'
                   AND with_check = '((bucket_id = ''dni-tutores''::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR privado.puede_ver_dni_tutor(name, owner_id)) AND privado.ruta_coherente(bucket_id, name))') THEN
    RAISE EXCEPTION 'prueba tras validar: la política % no es la leída en producción el 2026-11-20', 'dni_tutores_update';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'libro_familia_update'
                   AND cmd = 'UPDATE' AND qual = '((bucket_id = ''libro-familia''::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_legal_de(((storage.foldername(name))[2])::uuid)) AND privado.ruta_coherente(bucket_id, name))'
                   AND with_check = '((bucket_id = ''libro-familia''::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_legal_de(((storage.foldername(name))[2])::uuid)) AND privado.ruta_coherente(bucket_id, name))') THEN
    RAISE EXCEPTION 'prueba tras validar: la política % no es la leída en producción el 2026-11-20', 'libro_familia_update';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'mandato_sepa_update'
                   AND cmd = 'UPDATE' AND qual = '((bucket_id = ''mandato-sepa''::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_legal_de(((storage.foldername(name))[2])::uuid)) AND privado.ruta_coherente(bucket_id, name))'
                   AND with_check = '((bucket_id = ''mandato-sepa''::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_legal_de(((storage.foldername(name))[2])::uuid)) AND privado.ruta_coherente(bucket_id, name))') THEN
    RAISE EXCEPTION 'prueba tras validar: la política % no es la leída en producción el 2026-11-20', 'mandato_sepa_update';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'mandato_sepa_update_familia'
                   AND cmd = 'UPDATE' AND qual = '((bucket_id = ''mandato-sepa''::text) AND ((storage.foldername(name))[2] = ''familia''::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_de_familia(((storage.foldername(name))[3])::uuid)) AND privado.ruta_coherente(bucket_id, name))'
                   AND with_check = '((bucket_id = ''mandato-sepa''::text) AND ((storage.foldername(name))[2] = ''familia''::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_de_familia(((storage.foldername(name))[3])::uuid)) AND privado.ruta_coherente(bucket_id, name))') THEN
    RAISE EXCEPTION 'prueba tras validar: la política % no es la leída en producción el 2026-11-20', 'mandato_sepa_update_familia';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'sip_ninos_update'
                   AND cmd = 'UPDATE' AND qual = '((bucket_id = ''sip-ninos''::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_legal_de(((storage.foldername(name))[2])::uuid)) AND privado.ruta_coherente(bucket_id, name))'
                   AND with_check = '((bucket_id = ''sip-ninos''::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_legal_de(((storage.foldername(name))[2])::uuid)) AND privado.ruta_coherente(bucket_id, name))') THEN
    RAISE EXCEPTION 'prueba tras validar: la política % no es la leída en producción el 2026-11-20', 'sip_ninos_update';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'justificantes_gestion_update'
                   AND cmd = 'UPDATE' AND qual = '((bucket_id = ''justificantes-gestion''::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_legal_de(((storage.foldername(name))[2])::uuid)) AND privado.ruta_coherente(bucket_id, name))'
                   AND with_check = '((bucket_id = ''justificantes-gestion''::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR es_tutor_legal_de(((storage.foldername(name))[2])::uuid)) AND privado.ruta_coherente(bucket_id, name))') THEN
    RAISE EXCEPTION 'prueba tras validar: la política % no es la leída en producción el 2026-11-20', 'justificantes_gestion_update';
  END IF;
  SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) INTO v FROM pg_enum WHERE enumtypid = 'public.estado_mandato_sepa'::regtype;
  IF v IS DISTINCT FROM 'activo,revocado' THEN
    RAISE EXCEPTION 'prueba tras validar: estado_mandato_sepa es %, no activo,revocado', v;
  END IF;
  IF to_regprocedure('privado.alta_validada_de_ruta(text, text)') IS NOT NULL
     OR to_regprocedure('public.proponer_mandato_sepa(uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamp with time zone, public.firma_metodo, text, text, text, text)') IS NOT NULL
     OR to_regprocedure('public.decidir_mandato_propuesto(uuid, boolean)') IS NOT NULL
     OR to_regprocedure('public.fichas_firmadas_sin_validez(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'prueba tras validar: alguna función nueva ya existe';
  END IF;
END $guarda$;

-- ---------------------------------------------------------------------------------------------
-- 1 · Lo común: el estado de una propuesta de mandato, y si la ruta de un fichero es de un alta ya
-- validada. La ruta se valida segmento a segmento antes de convertirlo (como `ruta_coherente`).
ALTER TYPE public.estado_mandato_sepa ADD VALUE IF NOT EXISTS 'propuesto';
ALTER TYPE public.estado_mandato_sepa ADD VALUE IF NOT EXISTS 'rechazado';

CREATE FUNCTION privado.alta_validada_de_ruta(p_bucket text, p_name text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  -- El mandato y el DNI son de la FAMILIA (como `fijar_dni_tutor` y el mandato, por familia); el libro,
  -- la tarjeta y el justificante, del niño de la ruta. Una ruta que no se entiende no es de nadie
  -- validado: su política ya la rechaza por `ruta_coherente`.
  WITH r AS (
    SELECT (storage.foldername(p_name)) AS c,
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' AS uuid_re
  )
  SELECT CASE
    WHEN c[1] IS NULL OR c[2] IS NULL THEN false
    WHEN p_bucket = 'mandato-sepa' AND c[2] = 'familia' THEN
      CASE WHEN c[3] ~ uuid_re THEN coalesce(privado.familia_alta_validada(c[3]::uuid), false) ELSE false END
    WHEN c[2] !~ uuid_re THEN false
    WHEN p_bucket IN ('dni-tutores', 'mandato-sepa') THEN
      coalesce(privado.familia_alta_validada(public.familia_de_nino(c[2]::uuid)), false)
    ELSE coalesce(public.alta_validada_de_nino(c[2]::uuid), false)
  END
  FROM r;
$function$;
REVOKE ALL ON FUNCTION privado.alta_validada_de_ruta(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION privado.alta_validada_de_ruta(text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 1b · La autobaja. La app escribe `usuarios` SIEMPRE con service role (medido el 2026-11-20: cuatro
-- escrituras, `foto_url` en usuarios/[id]/avatar y `idioma_preferido` en accept-invitation,
-- crear-tutor-directo e idioma-invitacion), y las funciones del olvido y del consentimiento son
-- SECURITY DEFINER. A la sesión se le dejan solo esas dos columnas: las que la app escribe.
REVOKE UPDATE ON public.usuarios FROM authenticated;
GRANT UPDATE (foto_url, idioma_preferido) ON public.usuarios TO authenticated;


-- ---------------------------------------------------------------------------------------------
-- 2 · Los ficheros que son prueba: con el alta validada, la familia no sobrescribe ninguno.
-- Se cambia solo la rama del tutor de cada política de UPDATE; la de Dirección queda igual. El
-- INSERT no se toca: subir un fichero nuevo a otra ruta es como se propone un cambio a la cola.

DROP POLICY dni_tutores_update ON storage.objects;
CREATE POLICY dni_tutores_update ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((bucket_id = 'dni-tutores'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR (privado.puede_ver_dni_tutor(name, owner_id) AND (NOT privado.alta_validada_de_ruta(bucket_id, name)))) AND privado.ruta_coherente(bucket_id, name))
  WITH CHECK ((bucket_id = 'dni-tutores'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR (privado.puede_ver_dni_tutor(name, owner_id) AND (NOT privado.alta_validada_de_ruta(bucket_id, name)))) AND privado.ruta_coherente(bucket_id, name));

DROP POLICY libro_familia_update ON storage.objects;
CREATE POLICY libro_familia_update ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((bucket_id = 'libro-familia'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR (es_tutor_legal_de(((storage.foldername(name))[2])::uuid) AND (NOT privado.alta_validada_de_ruta(bucket_id, name)))) AND privado.ruta_coherente(bucket_id, name))
  WITH CHECK ((bucket_id = 'libro-familia'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR (es_tutor_legal_de(((storage.foldername(name))[2])::uuid) AND (NOT privado.alta_validada_de_ruta(bucket_id, name)))) AND privado.ruta_coherente(bucket_id, name));

DROP POLICY mandato_sepa_update ON storage.objects;
CREATE POLICY mandato_sepa_update ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((bucket_id = 'mandato-sepa'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR (CASE WHEN ((storage.foldername(name))[2] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'::text) THEN (es_tutor_legal_de(((storage.foldername(name))[2])::uuid) AND (NOT privado.alta_validada_de_ruta(bucket_id, name))) ELSE false END)) AND privado.ruta_coherente(bucket_id, name))
  WITH CHECK ((bucket_id = 'mandato-sepa'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR (CASE WHEN ((storage.foldername(name))[2] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'::text) THEN (es_tutor_legal_de(((storage.foldername(name))[2])::uuid) AND (NOT privado.alta_validada_de_ruta(bucket_id, name))) ELSE false END)) AND privado.ruta_coherente(bucket_id, name));

DROP POLICY mandato_sepa_update_familia ON storage.objects;
CREATE POLICY mandato_sepa_update_familia ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((bucket_id = 'mandato-sepa'::text) AND ((storage.foldername(name))[2] = 'familia'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR (es_tutor_de_familia(((storage.foldername(name))[3])::uuid) AND (NOT privado.alta_validada_de_ruta(bucket_id, name)))) AND privado.ruta_coherente(bucket_id, name))
  WITH CHECK ((bucket_id = 'mandato-sepa'::text) AND ((storage.foldername(name))[2] = 'familia'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR (es_tutor_de_familia(((storage.foldername(name))[3])::uuid) AND (NOT privado.alta_validada_de_ruta(bucket_id, name)))) AND privado.ruta_coherente(bucket_id, name));

DROP POLICY sip_ninos_update ON storage.objects;
CREATE POLICY sip_ninos_update ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((bucket_id = 'sip-ninos'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR (es_tutor_legal_de(((storage.foldername(name))[2])::uuid) AND (NOT privado.alta_validada_de_ruta(bucket_id, name)))) AND privado.ruta_coherente(bucket_id, name))
  WITH CHECK ((bucket_id = 'sip-ninos'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR (es_tutor_legal_de(((storage.foldername(name))[2])::uuid) AND (NOT privado.alta_validada_de_ruta(bucket_id, name)))) AND privado.ruta_coherente(bucket_id, name));

DROP POLICY justificantes_gestion_update ON storage.objects;
CREATE POLICY justificantes_gestion_update ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((bucket_id = 'justificantes-gestion'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR (es_tutor_legal_de(((storage.foldername(name))[2])::uuid) AND (NOT privado.alta_validada_de_ruta(bucket_id, name)))) AND privado.ruta_coherente(bucket_id, name))
  WITH CHECK ((bucket_id = 'justificantes-gestion'::text) AND (es_admin(((storage.foldername(name))[1])::uuid) OR (es_tutor_legal_de(((storage.foldername(name))[2])::uuid) AND (NOT privado.alta_validada_de_ruta(bucket_id, name)))) AND privado.ruta_coherente(bucket_id, name));


-- ---------------------------------------------------------------------------------------------
-- 3 · El mandato que firma un tutor con el alta validada va a la cola. Desde la definición VIVA
-- (leída el 2026-11-20), con la puerta nueva justo detrás de la de quién.

CREATE OR REPLACE FUNCTION public.registrar_mandato_sepa(p_familia_id uuid, p_nino_id uuid, p_iban text, p_titular text, p_identificador_mandato text, p_documento_path text, p_firma_imagen text, p_nombre_tecleado text, p_texto_hash text, p_ip_address inet, p_user_agent text, p_fecha_firma timestamp with time zone, p_metodo firma_metodo DEFAULT 'digital'::firma_metodo, p_titular_documento text DEFAULT NULL::text, p_titular_direccion text DEFAULT NULL::text, p_acreedor_cid text DEFAULT NULL::text, p_acreedor_nombre text DEFAULT NULL::text)
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
$function$
;

CREATE OR REPLACE FUNCTION public.sustituir_mandato_sepa(p_familia_id uuid, p_nino_id uuid, p_iban text, p_titular text, p_identificador_mandato text, p_documento_path text, p_firma_imagen text, p_nombre_tecleado text, p_texto_hash text, p_ip_address inet, p_user_agent text, p_fecha_firma timestamp with time zone, p_metodo firma_metodo DEFAULT 'digital'::firma_metodo, p_titular_documento text DEFAULT NULL::text, p_titular_direccion text DEFAULT NULL::text, p_acreedor_cid text DEFAULT NULL::text, p_acreedor_nombre text DEFAULT NULL::text)
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
$function$
;

-- ---------------------------------------------------------------------------------------------
-- 4 · La propuesta de mandato. Los mismos parámetros que `registrar_mandato_sepa`: la ruta la llama
-- igual. El IBAN se cifra aquí, como allí, y nunca viaja en el payload de la cola: la entrada de la
-- cola solo apunta a la fila 'propuesto'.
CREATE FUNCTION public.proponer_mandato_sepa(
  p_familia_id uuid, p_nino_id uuid, p_iban text, p_titular text, p_identificador_mandato text,
  p_documento_path text, p_firma_imagen text, p_nombre_tecleado text, p_texto_hash text,
  p_ip_address inet, p_user_agent text, p_fecha_firma timestamp with time zone,
  p_metodo public.firma_metodo DEFAULT 'digital'::public.firma_metodo,
  p_titular_documento text DEFAULT NULL::text, p_titular_direccion text DEFAULT NULL::text,
  p_acreedor_cid text DEFAULT NULL::text, p_acreedor_nombre text DEFAULT NULL::text)
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
  v_version := privado.version_datos_mandato(p_familia_id, p_texto_hash, p_titular_documento,
    p_titular_direccion, p_acreedor_cid, p_acreedor_nombre);

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
    version_canonico, titular_documento, titular_direccion, acreedor_cid, acreedor_nombre
  ) VALUES (
    privado.centro_de_familia(p_familia_id), p_familia_id, p_nino_id, v_uid,
    pgp_sym_encrypt(p_iban, v_clave), right(regexp_replace(p_iban, '\s', '', 'g'), 4), p_titular,
    p_identificador_mandato, p_documento_path, 'propuesto', p_firma_imagen,
    p_nombre_tecleado, p_texto_hash, p_ip_address, p_user_agent, p_fecha_firma, p_metodo,
    v_version, p_titular_documento, p_titular_direccion, p_acreedor_cid, p_acreedor_nombre
  )
  RETURNING id INTO v_id;

  INSERT INTO public.cambios_pendientes (centro_id, nino_id, entidad, registro_id, payload, solicitado_por)
  VALUES (privado.centro_de_familia(p_familia_id), v_nino, 'mandato_sepa', v_id,
          jsonb_build_object('mandato_id', v_id), v_uid);
  RETURN v_id;
END
$function$;
REVOKE ALL ON FUNCTION public.proponer_mandato_sepa(uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamp with time zone, public.firma_metodo, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proponer_mandato_sepa(uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamp with time zone, public.firma_metodo, text, text, text, text) TO authenticated, service_role;

-- Dirección decide. Aprobar: el activo de la familia pasa a 'revocado' (se conserva, como en
-- `sustituir`) y la propuesta a 'activo'. Rechazar: la propuesta queda 'rechazado', con su PDF, como
-- histórico. Cierra también la entrada de la cola si sigue pendiente (la app la marca antes).
CREATE FUNCTION public.decidir_mandato_propuesto(p_mandato_id uuid, p_aprobar boolean)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  m public.mandatos_sepa%ROWTYPE;
BEGIN
  SELECT * INTO m FROM public.mandatos_sepa WHERE id = p_mandato_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR p_aprobar IS NULL
     OR NOT (public.es_admin(m.centro_id) AND NOT public.is_superadmin()) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF m.estado IS DISTINCT FROM 'propuesto' OR m.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'ese mandato no está esperando a Dirección' USING ERRCODE = 'P0001', HINT = 'no_propuesto';
  END IF;
  IF p_aprobar THEN
    UPDATE public.mandatos_sepa SET estado = 'revocado'
     WHERE familia_id = m.familia_id AND estado = 'activo' AND deleted_at IS NULL;
    UPDATE public.mandatos_sepa SET estado = 'activo' WHERE id = m.id;
  ELSE
    UPDATE public.mandatos_sepa SET estado = 'rechazado' WHERE id = m.id;
  END IF;
  UPDATE public.cambios_pendientes
     SET estado = CASE WHEN p_aprobar THEN 'aprobado' ELSE 'rechazado' END::public.estado_cambio_pendiente,
         revisado_por = auth.uid(), decided_at = now()
   WHERE entidad = 'mandato_sepa' AND registro_id = m.id AND estado = 'pendiente';
  RETURN m.id;
END
$function$;
REVOKE ALL ON FUNCTION public.decidir_mandato_propuesto(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decidir_mandato_propuesto(uuid, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 5 · El 14. Las fichas firmadas de altas validadas cuya firma ya no vale (un cambio libre, como la
-- información médica o los datos pedagógicos, movió la ficha). Con la refirma ya pedida también salen,
-- marcadas: la ficha sigue sin valer hasta que la familia vuelva a firmar.
CREATE FUNCTION public.fichas_firmadas_sin_validez(p_centro_id uuid)
RETURNS TABLE (nino_id uuid, nombre text, apellidos text, firmado_at timestamp with time zone, refirma_pedida boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR p_centro_id IS NULL OR NOT public.es_admin(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT n.id, n.nombre, n.apellidos, f.firmado_at,
         EXISTS (SELECT 1 FROM public.refirmas_ficha r WHERE r.nino_id = n.id AND r.pedida_at > f.firmado_at)
    FROM public.ninos n
    JOIN LATERAL (SELECT ff.firmado_at FROM public.firmas_ficha ff WHERE ff.nino_id = n.id
                   ORDER BY ff.firmado_at DESC, ff.id DESC LIMIT 1) f ON true
   WHERE n.centro_id = p_centro_id AND n.deleted_at IS NULL
     AND public.alta_validada_de_nino(n.id)
     AND privado.firma_ficha_vigente(n.id) IS NULL
   ORDER BY n.nombre, n.id;
END
$function$;
REVOKE ALL ON FUNCTION public.fichas_firmadas_sin_validez(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fichas_firmadas_sin_validez(uuid) TO authenticated, service_role;


-- ---------------------------------------------------------------------------------------------
-- Guarda posterior.
DO $posterior$
DECLARE v text; n int;
BEGIN
  SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) INTO v FROM pg_enum WHERE enumtypid = 'public.estado_mandato_sepa'::regtype;
  IF v IS DISTINCT FROM 'activo,revocado,propuesto,rechazado' THEN
    RAISE EXCEPTION 'prueba tras validar (posterior): estado_mandato_sepa es %', v;
  END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd = 'UPDATE'
     AND policyname IN ('dni_tutores_update', 'libro_familia_update', 'mandato_sepa_update',
                        'mandato_sepa_update_familia', 'sip_ninos_update', 'justificantes_gestion_update')
     AND qual LIKE '%NOT privado.alta_validada_de_ruta(bucket_id, name)%'
     AND with_check LIKE '%NOT privado.alta_validada_de_ruta(bucket_id, name)%';
  IF n <> 6 THEN
    RAISE EXCEPTION 'prueba tras validar (posterior): % de 6 políticas de UPDATE miran el alta validada', n;
  END IF;
  SELECT count(*) INTO n FROM pg_proc
   WHERE proname IN ('registrar_mandato_sepa', 'sustituir_mandato_sepa') AND pronamespace = 'public'::regnamespace
     AND prosrc LIKE '%HINT = ''cola_validacion''%';
  IF n <> 2 THEN
    RAISE EXCEPTION 'prueba tras validar (posterior): % de 2 funciones del mandato mandan a la cola', n;
  END IF;
  IF has_column_privilege('authenticated', 'public.usuarios', 'deleted_at', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.usuarios', 'consentimiento_privacidad_version', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.usuarios', 'consentimiento_terminos_version', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.usuarios', 'nombre_completo', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.usuarios', 'foto_url', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.usuarios', 'idioma_preferido', 'UPDATE') THEN
    RAISE EXCEPTION 'prueba tras validar (posterior): los permisos de UPDATE de usuarios no son foto_url e idioma_preferido';
  END IF;
  IF has_function_privilege('anon', 'public.proponer_mandato_sepa(uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamp with time zone, public.firma_metodo, text, text, text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.decidir_mandato_propuesto(uuid, boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fichas_firmadas_sin_validez(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fichas_firmadas_sin_validez(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'prueba tras validar (posterior): permisos de las funciones nuevas';
  END IF;
END $posterior$;
