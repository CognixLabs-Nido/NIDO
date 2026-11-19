-- Fase 10 · 10b-3, primera de dos: las puertas de la ficha firmada (2026-11-19). Spec:
-- docs/specs/altas-serie.md, «10b-3: el encargo, lo medido abierto y el orden», «La precisión de N2»
-- y «Pedir la firma de cualquier alta sin ficha firmada».
--
-- Medido ABIERTO en producción el 2026-11-19 (ensayo terminado en RAISE, ~/nido-logs/10/b3/abierto/):
-- Dirección otorga el «sí» de imagen a su propio nombre (N2a) y al de una profe sin vínculo (N2b); su
-- firma presencial de una autorización de imagen deja un «sí» a su nombre (S1); su firma presencial de
-- la ficha no dice de qué tutor es y mira su propia respuesta de imagen (P1, P1+); pedir la firma de
-- un alta sin ficha firmada da `sin_firma` (R1); la vista de datos bloqueados no enseña `firmas_ficha`
-- (B1, B2); y el tutor que no ha contestado no distingue «nadie ha dicho que sí» de «el otro dijo que
-- no» (O1, O2).
--
--   1. N2: `otorgar_consentimiento_imagen` exige que el TITULAR (`p_tutor` ya resuelto) sea tutor legal
--      del niño, como `denegar`. No mira a quien llama: Dirección sigue registrando el papel a nombre
--      del tutor (precisión del responsable, 2026-11-19: «QUIEN REGISTRA puede ser Dirección [...]
--      QUIEN ES TITULAR del consentimiento tiene que ser un TUTOR LEGAL DEL NIÑO»).
--   2. `firma_imagen_sync`: la firma presencial de una autorización de imagen no dice de qué tutor es,
--      así que su titular sería Dirección: se rechaza por eso, no por quién la registra.
--   3. `firmas_ficha.tutor_id` y `registrar_firma_ficha_presencial(niño, tutor, …)`: la presencial dice
--      de qué tutor legal es, y se mira la respuesta de imagen de ese tutor.
--   4. `pedir_refirma_ficha` ya no exige una firma previa (decisión del 2026-11-19).
--   5. `privado.contenido_bloqueado` y `privado.datos_bloqueados` con `firmas_ficha` (sin la foto).
--   6. `oposicion_imagen(niño)`: si hay un «no» vigente de otro, sin decir de quién.
--   7. Operación de datos: se revoca el «sí» de imagen vigente que N2 dejó escrito a nombre de quien no
--      es tutor legal del niño (decisión del responsable, 2026-11-19; abajo, antes de la guarda posterior).
--
-- ORDEN: aplicar ANTES del despliegue de la app de la 10b-3. No rompe la app de la 10b-2: el «sí» en
-- papel ya va a nombre de un tutor legal (`titularRespuestaImagen`), esa app no llama a
-- `registrar_firma_ficha_presencial`, y lo demás solo abre o añade. La segunda migración
-- (`marcar_matricula_lista` y `validar_alta` exigen la firma) va DESPUÉS del despliegue. Sin COMMIT ni
-- BEGIN: el SQL Editor la envuelve en su transacción.

-- ─────────────────────────────────────────────────────────────── guarda previa
DO $guarda$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20270128120000') THEN
    RAISE EXCEPTION 'falta la 20270128120000 en el registro: aplica antes la 10b-1';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'firmas_ficha' AND column_name = 'tutor_id')
     OR to_regprocedure('public.oposicion_imagen(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'las puertas de la ficha ya existen: esta migración ya se aplicó';
  END IF;
  -- Ninguna firma presencial antes de que la tabla sepa de qué tutor es (no había pantalla).
  IF EXISTS (SELECT 1 FROM public.firmas_ficha WHERE metodo_firma = 'presencial') THEN
    RAISE EXCEPTION 'hay firmas presenciales de la ficha sin tutor: mirarlas antes de aplicar';
  END IF;
  -- Las que se reescriben, con el cuerpo leído en producción (md5 de la lógica normalizada).
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.otorgar_consentimiento_imagen(uuid,uuid,text,inet,text,firma_metodo)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM '62ec3154a0dcba775f2a8a3fb42c2451' THEN
    RAISE EXCEPTION 'public.otorgar_consentimiento_imagen(uuid,uuid,text,inet,text,firma_metodo) no es la leída en producción el 2026-11-19';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.firma_imagen_sync()')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM 'd4ad5538d775627d6f6aaabb6024ac1a' THEN
    RAISE EXCEPTION 'public.firma_imagen_sync() no es la leída en producción el 2026-11-19';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.registrar_firma_ficha_presencial(uuid,text,text,inet,text)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM '073b272a0fe8ff066b6e36b2c35659e0' THEN
    RAISE EXCEPTION 'public.registrar_firma_ficha_presencial(uuid,text,text,inet,text) no es la leída en producción el 2026-11-19';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.firmar_ficha(uuid,text,text,text,inet,text)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM '244695de2a599d03fce63ef889cd733c' THEN
    RAISE EXCEPTION 'public.firmar_ficha(uuid,text,text,text,inet,text) no es la leída en producción el 2026-11-19';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('privado.firmar_ficha_comun(uuid,text,text,text,inet,text,firma_metodo,tipo_vinculo)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM 'bea144c63d333c0b2bc19fac9415132f' THEN
    RAISE EXCEPTION 'privado.firmar_ficha_comun(uuid,text,text,text,inet,text,firma_metodo,tipo_vinculo) no es la leída en producción el 2026-11-19';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.pedir_refirma_ficha(uuid)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM 'adcec1aeee0080959736537c232753e9' THEN
    RAISE EXCEPTION 'public.pedir_refirma_ficha(uuid) no es la leída en producción el 2026-11-19';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.contenido_firmas_ficha(uuid[])')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM '32f4ce9d3e3e8587c9c0e5c40b7d2cdf' THEN
    RAISE EXCEPTION 'public.contenido_firmas_ficha(uuid[]) no es la leída en producción el 2026-11-19';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('privado.contenido_bloqueado(uuid,text,uuid)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM '6ff3dafccd79174b8904b794f2b9b170' THEN
    RAISE EXCEPTION 'privado.contenido_bloqueado(uuid,text,uuid) no es la leída en producción el 2026-11-19';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('privado.datos_bloqueados(text,uuid,boolean)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM 'b35732e2d67397f3c4d36d85606b84d6' THEN
    RAISE EXCEPTION 'privado.datos_bloqueados(text,uuid,boolean) no es la leída en producción el 2026-11-19';
  END IF;
  -- Las dos que endurece la segunda migración: aquí no se tocan, y su cuerpo sigue siendo el leído.
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.marcar_matricula_lista(uuid)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM '7c33e387eb551afb268a0a8c66055a8e' THEN
    RAISE EXCEPTION 'public.marcar_matricula_lista(uuid) no es la leída en producción el 2026-11-19';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.validar_alta(uuid,date)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM 'ba4a30df96ac148ebe09a62615647c72' THEN
    RAISE EXCEPTION 'public.validar_alta(uuid,date) no es la leída en producción el 2026-11-19';
  END IF;
END
$guarda$;

-- ─────────────────────────────────────────────────────────────── de qué tutor es la firma presencial
-- La firma presencial la registra Dirección (firmante_id), y es la de un tutor legal del niño, que firmó
-- el papel (tutor_id). La digital la hace el propio tutor: no lleva tutor_id.
ALTER TABLE public.firmas_ficha
  ADD COLUMN tutor_id uuid REFERENCES public.usuarios (id) ON DELETE RESTRICT;
ALTER TABLE public.firmas_ficha
  ADD CONSTRAINT firmas_ficha_tutor_por_metodo
  CHECK ((metodo_firma = 'presencial') = (tutor_id IS NOT NULL));
COMMENT ON COLUMN public.firmas_ficha.tutor_id IS
  'El tutor legal de quien es la firma presencial (el que firmó el papel); NULL en la digital, que firma el propio tutor (firmante_id). 10b-3, 20270129120000.';
GRANT SELECT (tutor_id) ON public.firmas_ficha TO authenticated;

-- La firma presencial lleva datos de dos personas: también se bloquea con el tutor olvidado.
CREATE FUNCTION privado.firma_ficha_bloqueada(p_nino_id uuid, p_firmante_id uuid, p_tutor_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT privado.firma_bloqueada(p_nino_id, p_firmante_id)
      OR (p_tutor_id IS NOT NULL AND privado.firma_bloqueada(p_nino_id, p_tutor_id));
$function$;
REVOKE ALL ON FUNCTION privado.firma_ficha_bloqueada(uuid, uuid, uuid) FROM PUBLIC, anon;
-- La usa la política de la tabla: la sesión tiene que poder ejecutarla (los mismos permisos que
-- privado.firma_bloqueada, leídos en producción el 2026-11-19).
GRANT EXECUTE ON FUNCTION privado.firma_ficha_bloqueada(uuid, uuid, uuid) TO authenticated, service_role;

DROP POLICY bloqueo_retencion ON public.firmas_ficha;
CREATE POLICY bloqueo_retencion ON public.firmas_ficha AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT privado.firma_ficha_bloqueada(nino_id, firmante_id, tutor_id))
  WITH CHECK (NOT privado.firma_ficha_bloqueada(nino_id, firmante_id, tutor_id));

-- ─────────────────────────────────────────────────────────────── N2: el titular del «sí»
-- Reescrita desde su definición viva (2026-11-19), con un cambio: el titular es tutor legal del niño.
CREATE OR REPLACE FUNCTION public.otorgar_consentimiento_imagen(p_nino_id uuid, p_tutor uuid, p_version text DEFAULT 'imagen-v1'::text, p_ip inet DEFAULT NULL::inet, p_user_agent text DEFAULT NULL::text, p_metodo firma_metodo DEFAULT 'digital'::firma_metodo)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_uid uuid := auth.uid();
  v_centro uuid := privado.centro_de_nino(p_nino_id);
  v_admin boolean;
BEGIN
  IF v_uid IS NULL THEN
    IF NOT (COALESCE(auth.role(), '') = 'service_role'
            OR (session_user <> 'authenticator'
                AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
      RAISE EXCEPTION 'no autorizado a otorgar consentimiento de imagen de este niño'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    IF NOT privado.puede_consentir('imagen', p_nino_id) THEN
      RAISE EXCEPTION 'no autorizado a otorgar consentimiento de imagen de este niño'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- El superusuario no registra el consentimiento en nombre de un tutor (ADR-0061).
    v_admin := v_centro IS NOT NULL AND public.es_admin(v_centro) AND NOT public.is_superadmin();
    IF NOT v_admin THEN
      p_tutor := v_uid;
    END IF;
  END IF;

  -- [10b-3, N2] El TITULAR (ya resuelto) es un tutor legal del niño, como en `denegar`. No se mira a
  -- quien llama: Dirección registra el papel a nombre del tutor (precisión del 2026-11-19).
  IF NOT EXISTS (SELECT 1 FROM public.vinculos_familiares vf
                  WHERE vf.nino_id = p_nino_id AND vf.usuario_id = p_tutor AND vf.deleted_at IS NULL
                    AND vf.tipo_vinculo IN ('tutor_legal_principal', 'tutor_legal_secundario')) THEN
    RAISE EXCEPTION 'el «sí» de la imagen es de un tutor legal del niño'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'no_es_tutor_legal';
  END IF;

  -- [10a-2] El «sí» de un tutor retira SU propio «no», nunca el de otro (2026-11-17). Si lo
  -- registra Dirección por el tutor, queda su rastro.
  PERFORM privado.retirar_no_imagen(p_nino_id, p_tutor);

  INSERT INTO public.consentimientos
    (usuario_id, tipo, version, nino_id, ip_address, user_agent, metodo_firma)
  VALUES
    (p_tutor, 'imagen', p_version, p_nino_id, p_ip, p_user_agent, p_metodo)
  RETURNING id INTO v_id;

  RETURN v_id;
END $function$;

-- ─────────────────────────────────────────────────────────────── N2 por la otra entrada
-- Reescrita desde su definición viva (2026-11-19), con un cambio: la firma presencial de Dirección
-- sobre una autorización de imagen ya no deja un «sí» a su nombre: se rechaza.
CREATE OR REPLACE FUNCTION public.firma_imagen_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a public.autorizaciones%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.autorizaciones WHERE id = NEW.autorizacion_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF a.es_plantilla OR a.tipo <> 'autorizacion_imagenes' THEN RETURN NEW; END IF;

  IF NEW.decision = 'firmado' THEN
    IF NOT EXISTS (SELECT 1 FROM public.vinculos_familiares vf
                    WHERE vf.usuario_id = NEW.firmante_id
                      AND vf.nino_id = NEW.nino_id
                      AND vf.deleted_at IS NULL
                      AND vf.tipo_vinculo IN ('tutor_legal_principal', 'tutor_legal_secundario')) THEN
      -- [10b-3, N2 por otra entrada] La firma presencial de Dirección no dice de qué tutor es: el «sí»
      -- quedaría a nombre de Dirección. Se rechaza por su TITULAR, no por quién la registra; el papel
      -- entra por `otorgar_consentimiento_imagen` a nombre del tutor (2026-11-19).
      IF NEW.metodo_firma = 'presencial'
         AND EXISTS (SELECT 1 FROM public.roles_usuario ru
                      WHERE ru.usuario_id = NEW.firmante_id
                        AND ru.rol::text IN ('admin', 'directora')
                        AND ru.deleted_at IS NULL
                        AND ru.centro_id = privado.centro_de_nino(NEW.nino_id)) THEN
        RAISE EXCEPTION 'la autorización de imagen en papel se anota a nombre del tutor legal que la firmó'
          USING ERRCODE = 'invalid_parameter_value', HINT = 'no_es_tutor_legal';
      END IF;
      RETURN NEW;
    END IF;
    UPDATE public.consentimientos
       SET revocado_en = now()
     WHERE tipo = 'imagen' AND usuario_id = NEW.firmante_id
       AND nino_id = NEW.nino_id AND revocado_en IS NULL;
    -- [10a-2] El «sí» firmado retira el propio «no» del firmante, nunca el de otro.
    PERFORM privado.retirar_no_imagen(NEW.nino_id, NEW.firmante_id);
    INSERT INTO public.consentimientos
      (usuario_id, tipo, version, nino_id, ip_address, user_agent)
    VALUES
      (NEW.firmante_id, 'imagen'::public.consentimiento_tipo, a.texto_version,
       NEW.nino_id, NEW.ip_address, NEW.user_agent);
  ELSE
    UPDATE public.consentimientos
       SET revocado_en = now()
     WHERE tipo = 'imagen' AND usuario_id = NEW.firmante_id
       AND nino_id = NEW.nino_id AND revocado_en IS NULL;
  END IF;

  RETURN NEW;
END $function$;

-- ─────────────────────────────────────────────────────────────── la firma presencial dice de qué tutor es
-- `privado.firmar_ficha_comun`, reescrita desde su definición viva (2026-11-19) con un argumento más,
-- el tutor de la presencial: se guarda y su respuesta de imagen es la que se mira.
DROP FUNCTION privado.firmar_ficha_comun(uuid, text, text, text, inet, text, public.firma_metodo, public.tipo_vinculo);
CREATE FUNCTION privado.firmar_ficha_comun(p_nino_id uuid, p_hash_visto text, p_nombre_tecleado text, p_firma_imagen text, p_ip_address inet, p_user_agent text, p_metodo firma_metodo, p_rol tipo_vinculo, p_tutor uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
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
  -- respuesta de quien firma»). [10b-3] En la presencial, la del tutor que firmó el papel, no la de
  -- Dirección, que solo la registra.
  IF v_pendiente AND privado.respuesta_imagen(COALESCE(p_tutor, auth.uid()), p_nino_id) IS NULL THEN
    RAISE EXCEPTION 'falta la respuesta de imagen de quien firma' USING HINT = 'imagen_sin_respuesta';
  END IF;

  -- Se firma lo que se vio: si la foto cambió entre verla y firmar, no.
  v_ficha := privado.ficha_canonica(p_nino_id, 1);
  v_hash := privado.ficha_hash(v_ficha);
  IF p_hash_visto IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'la ficha ha cambiado desde que se mostró' USING HINT = 'ficha_cambiada';
  END IF;

  INSERT INTO public.firmas_ficha
    (nino_id, firmante_id, tutor_id, rol_firmante, metodo_firma, nombre_tecleado, firma_imagen, ip_address,
     user_agent, ficha_version, plantilla_pdf_version, contenido_cifrado, contenido_sha256)
  VALUES (p_nino_id, auth.uid(), p_tutor, p_rol, p_metodo, btrim(p_nombre_tecleado), p_firma_imagen,
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
END $function$;
REVOKE ALL ON FUNCTION privado.firmar_ficha_comun(uuid, text, text, text, inet, text, public.firma_metodo, public.tipo_vinculo, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- `firmar_ficha`: la digital no lleva tutor (firma el propio tutor). Desde su definición viva.
CREATE OR REPLACE FUNCTION public.firmar_ficha(p_nino_id uuid, p_hash_visto text, p_nombre_tecleado text, p_firma_imagen text, p_ip_address inet DEFAULT NULL::inet, p_user_agent text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rol public.tipo_vinculo;
BEGIN
  v_rol := privado.puerta_firma_tutor(p_nino_id);
  RETURN privado.firmar_ficha_comun(p_nino_id, p_hash_visto, p_nombre_tecleado, p_firma_imagen,
                                    p_ip_address, p_user_agent, 'digital', v_rol, NULL);
END $function$;

-- `registrar_firma_ficha_presencial`, con el tutor: obligatorio y tutor legal del niño. Sin decir de qué
-- tutor es, no se registra (control negativo del 2026-11-19). La app de la 10b-2 no la llama.
DROP FUNCTION public.registrar_firma_ficha_presencial(uuid, text, text, inet, text);
CREATE FUNCTION public.registrar_firma_ficha_presencial(p_nino_id uuid, p_tutor uuid, p_hash_visto text,
  p_nombre_tecleado text, p_ip_address inet DEFAULT NULL::inet, p_user_agent text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM privado.puerta_firma_direccion(p_nino_id);
  IF p_tutor IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.vinculos_familiares vf
        WHERE vf.nino_id = p_nino_id AND vf.usuario_id = p_tutor AND vf.deleted_at IS NULL
          AND vf.tipo_vinculo IN ('tutor_legal_principal', 'tutor_legal_secundario')) THEN
    RAISE EXCEPTION 'la firma en papel es de un tutor legal del niño'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'no_es_tutor_legal';
  END IF;
  RETURN privado.firmar_ficha_comun(p_nino_id, p_hash_visto, p_nombre_tecleado, NULL,
                                    p_ip_address, p_user_agent, 'presencial', 'admin', p_tutor);
END $function$;
REVOKE ALL ON FUNCTION public.registrar_firma_ficha_presencial(uuid, uuid, text, text, inet, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_firma_ficha_presencial(uuid, uuid, text, text, inet, text) TO authenticated;

-- `contenido_firmas_ficha`: el mismo bloqueo que la tabla (también con el tutor). Desde su definición viva.
CREATE OR REPLACE FUNCTION public.contenido_firmas_ficha(p_firma_ids uuid[])
 RETURNS TABLE(firma_id uuid, nombre_tecleado text, firma_imagen text, ip_address inet, user_agent text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT f.id, f.nombre_tecleado, f.firma_imagen, f.ip_address, f.user_agent
    FROM public.firmas_ficha f
   WHERE f.id = ANY (p_firma_ids)
     AND auth.uid() IS NOT NULL
     AND NOT privado.firma_ficha_bloqueada(f.nino_id, f.firmante_id, f.tutor_id)
     AND (f.firmante_id = auth.uid()
          OR public.es_tutor_legal_de(f.nino_id)
          OR public.es_admin(privado.centro_de_nino(f.nino_id)));
$function$;

-- ─────────────────────────────────────────────────────────────── pedir la firma
-- Reescrita desde su definición viva (2026-11-19), con un cambio: no exige una firma previa.
CREATE OR REPLACE FUNCTION public.pedir_refirma_ficha(p_nino_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_nino_id IS NULL
     OR NOT public.es_admin(privado.centro_de_nino(p_nino_id)) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- [10b-3] Sin exigir una firma previa: Dirección pide la firma de CUALQUIER alta sin ficha firmada
  -- (decisión del 2026-11-19: «el «no retroactivo» pasa a ser una decisión de la directora en vez de
  -- un muro del sistema»). Firmar ya contempla la ficha que nunca se firmó.
  INSERT INTO public.refirmas_ficha (nino_id, pedida_por) VALUES (p_nino_id, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;

-- ─────────────────────────────────────────────────────────────── la vista de datos bloqueados
-- Las dos, reescritas desde su definición viva (2026-11-19), con `firmas_ficha` en las dos ramas.
-- La del niño no tendrá filas mientras la purga del niño las borre (10b-1); la del tutor olvidado sí.
CREATE OR REPLACE FUNCTION privado.contenido_bloqueado(p_centro_id uuid, p_sujeto_tipo text, p_sujeto_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN p_sujeto_tipo = 'nino' THEN jsonb_build_object(
    'firmas', COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.firmado_at)
                          FROM public.firmas_autorizacion f WHERE f.nino_id = p_sujeto_id), '[]'::jsonb),
    'autorizaciones', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at)
                                  FROM public.autorizaciones a WHERE a.nino_id = p_sujeto_id), '[]'::jsonb),
    'consentimientos', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.aceptado_en)
                                   FROM public.consentimientos c WHERE c.nino_id = p_sujeto_id), '[]'::jsonb),
    'acuses_alta', COALESCE((SELECT jsonb_agg(to_jsonb(aa) ORDER BY aa.aceptado_en)
                               FROM public.acuses_alta aa WHERE aa.nino_id = p_sujeto_id), '[]'::jsonb),
    'firmas_documentos', COALESCE((SELECT jsonb_agg(to_jsonb(fd) ORDER BY fd.firmado_at)
                                     FROM public.firmas_documentos_centro fd
                                    WHERE fd.nino_id = p_sujeto_id), '[]'::jsonb),
    -- [10b-3] La ficha firmada, sin la foto cifrada (la foto es de la 10c).
    'firmas_ficha', COALESCE((SELECT jsonb_agg(to_jsonb(ff) - 'contenido_cifrado' ORDER BY ff.firmado_at)
                                FROM public.firmas_ficha ff WHERE ff.nino_id = p_sujeto_id), '[]'::jsonb),
    'medicacion_administrada', COALESCE((SELECT jsonb_agg(to_jsonb(am) ORDER BY am.administrado_en)
                                           FROM public.administraciones_medicacion am
                                          WHERE am.nino_id = p_sujeto_id), '[]'::jsonb),
    'lecturas_ficha_medica', COALESCE((SELECT jsonb_agg(to_jsonb(l) || jsonb_build_object('lector', u.nombre_completo)
                                                        ORDER BY l.leida_en)
                                         FROM public.lecturas_ficha_medica l
                                         LEFT JOIN public.usuarios u ON u.id = l.lector_id
                                        WHERE l.nino_id = p_sujeto_id), '[]'::jsonb))
  ELSE jsonb_build_object(
    'firmas', COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.firmado_at)
                          FROM public.firmas_autorizacion f
                         WHERE f.firmante_id = p_sujeto_id
                           AND privado.centro_de_nino(f.nino_id) = p_centro_id), '[]'::jsonb),
    'consentimientos', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.aceptado_en)
                                   FROM public.consentimientos c
                                  WHERE c.usuario_id = p_sujeto_id AND c.nino_id IS NOT NULL
                                    AND privado.centro_de_nino(c.nino_id) = p_centro_id), '[]'::jsonb),
    'acuses_alta', COALESCE((SELECT jsonb_agg(to_jsonb(aa) ORDER BY aa.aceptado_en)
                               FROM public.acuses_alta aa
                              WHERE aa.firmante_id = p_sujeto_id AND aa.centro_id = p_centro_id), '[]'::jsonb),
    'firmas_documentos', COALESCE((SELECT jsonb_agg(to_jsonb(fd) ORDER BY fd.firmado_at)
                                     FROM public.firmas_documentos_centro fd
                                    WHERE fd.firmante_id = p_sujeto_id
                                      AND fd.centro_id = p_centro_id), '[]'::jsonb),
    -- [10b-3] Las de la ficha que firmó, o que Dirección registró en papel a su nombre.
    'firmas_ficha', COALESCE((SELECT jsonb_agg(to_jsonb(ff) - 'contenido_cifrado' ORDER BY ff.firmado_at)
                                FROM public.firmas_ficha ff
                               WHERE (ff.firmante_id = p_sujeto_id OR ff.tutor_id = p_sujeto_id)
                                 AND privado.centro_de_nino(ff.nino_id) = p_centro_id), '[]'::jsonb))
  END;
$function$;

CREATE OR REPLACE FUNCTION privado.datos_bloqueados(p_sujeto_tipo text, p_sujeto_id uuid, p_todos boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH filas(codigo, desde) AS (
    -- ---- del niño ----
    SELECT 'firmas', LEAST(privado.nino_bloqueado_desde(f.nino_id),
                           privado.usuario_olvidado_desde(f.firmante_id, privado.centro_de_nino(f.nino_id)))
      FROM public.firmas_autorizacion f
     WHERE p_sujeto_tipo = 'nino' AND f.nino_id = p_sujeto_id
       AND privado.firma_bloqueada(f.nino_id, f.firmante_id)
    UNION ALL
    SELECT 'autorizaciones', privado.nino_bloqueado_desde(a.nino_id)
      FROM public.autorizaciones a
     WHERE p_sujeto_tipo = 'nino' AND a.nino_id = p_sujeto_id AND privado.nino_bloqueado(a.nino_id)
    UNION ALL
    SELECT 'consentimientos', LEAST(privado.nino_bloqueado_desde(c.nino_id),
                                    privado.usuario_olvidado_desde(c.usuario_id, privado.centro_de_nino(c.nino_id)))
      FROM public.consentimientos c
     WHERE p_sujeto_tipo = 'nino' AND c.nino_id = p_sujeto_id
       AND privado.consentimiento_bloqueado(c.usuario_id, c.nino_id)
    UNION ALL
    SELECT 'acuses_alta', LEAST(privado.nino_bloqueado_desde(aa.nino_id),
                                privado.usuario_olvidado_desde(aa.firmante_id, aa.centro_id))
      FROM public.acuses_alta aa
     WHERE p_sujeto_tipo = 'nino' AND aa.nino_id = p_sujeto_id
       AND privado.firma_bloqueada(aa.nino_id, aa.firmante_id)
    UNION ALL
    SELECT 'firmas_documentos', LEAST(privado.nino_bloqueado_desde(fd.nino_id),
                                      privado.usuario_olvidado_desde(fd.firmante_id, fd.centro_id))
      FROM public.firmas_documentos_centro fd
     WHERE p_sujeto_tipo = 'nino' AND fd.nino_id = p_sujeto_id
       AND privado.firma_bloqueada(fd.nino_id, fd.firmante_id)
    UNION ALL
    SELECT 'firmas_ficha', LEAST(privado.nino_bloqueado_desde(ff.nino_id),
                                 privado.usuario_olvidado_desde(ff.firmante_id, privado.centro_de_nino(ff.nino_id)),
                                 privado.usuario_olvidado_desde(ff.tutor_id, privado.centro_de_nino(ff.nino_id)))
      FROM public.firmas_ficha ff
     WHERE p_sujeto_tipo = 'nino' AND ff.nino_id = p_sujeto_id
       AND privado.firma_ficha_bloqueada(ff.nino_id, ff.firmante_id, ff.tutor_id)
    UNION ALL
    SELECT 'medicacion_administrada', privado.nino_bloqueado_desde(am.nino_id)
      FROM public.administraciones_medicacion am
     WHERE p_sujeto_tipo = 'nino' AND am.nino_id = p_sujeto_id AND privado.nino_bloqueado(am.nino_id)
    UNION ALL
    SELECT 'lecturas_ficha_medica', privado.nino_bloqueado_desde(l.nino_id)
      FROM public.lecturas_ficha_medica l
     WHERE p_sujeto_tipo = 'nino' AND l.nino_id = p_sujeto_id AND privado.nino_bloqueado(l.nino_id)
    -- ---- del usuario ----
    UNION ALL
    SELECT 'firmas', LEAST(privado.nino_bloqueado_desde(f.nino_id),
                           privado.usuario_olvidado_desde(f.firmante_id, privado.centro_de_nino(f.nino_id)))
      FROM public.firmas_autorizacion f
     WHERE p_sujeto_tipo = 'usuario' AND f.firmante_id = p_sujeto_id
       AND privado.firma_bloqueada(f.nino_id, f.firmante_id)
       AND (p_todos OR privado.es_responsable(privado.centro_de_nino(f.nino_id)))
    UNION ALL
    SELECT 'consentimientos', CASE WHEN c.nino_id IS NULL
                                   THEN privado.usuario_olvidado_desde(c.usuario_id, NULL)
                                   ELSE LEAST(privado.nino_bloqueado_desde(c.nino_id),
                                              privado.usuario_olvidado_desde(c.usuario_id,
                                                                             privado.centro_de_nino(c.nino_id))) END
      FROM public.consentimientos c
     WHERE p_sujeto_tipo = 'usuario' AND c.usuario_id = p_sujeto_id
       AND privado.consentimiento_bloqueado(c.usuario_id, c.nino_id)
       AND (p_todos OR (c.nino_id IS NOT NULL AND privado.es_responsable(privado.centro_de_nino(c.nino_id))))
    UNION ALL
    SELECT 'acuses_alta', LEAST(privado.nino_bloqueado_desde(aa.nino_id),
                                privado.usuario_olvidado_desde(aa.firmante_id, aa.centro_id))
      FROM public.acuses_alta aa
     WHERE p_sujeto_tipo = 'usuario' AND aa.firmante_id = p_sujeto_id
       AND privado.firma_bloqueada(aa.nino_id, aa.firmante_id)
       AND (p_todos OR privado.es_responsable(aa.centro_id))
    UNION ALL
    SELECT 'firmas_documentos', LEAST(privado.nino_bloqueado_desde(fd.nino_id),
                                      privado.usuario_olvidado_desde(fd.firmante_id, fd.centro_id))
      FROM public.firmas_documentos_centro fd
     WHERE p_sujeto_tipo = 'usuario' AND fd.firmante_id = p_sujeto_id
       AND privado.firma_bloqueada(fd.nino_id, fd.firmante_id)
       AND (p_todos OR privado.es_responsable(fd.centro_id))
    UNION ALL
    SELECT 'firmas_ficha', LEAST(privado.nino_bloqueado_desde(ff.nino_id),
                                 privado.usuario_olvidado_desde(p_sujeto_id, privado.centro_de_nino(ff.nino_id)))
      FROM public.firmas_ficha ff
     WHERE p_sujeto_tipo = 'usuario' AND (ff.firmante_id = p_sujeto_id OR ff.tutor_id = p_sujeto_id)
       AND privado.firma_ficha_bloqueada(ff.nino_id, ff.firmante_id, ff.tutor_id)
       AND (p_todos OR privado.es_responsable(privado.centro_de_nino(ff.nino_id)))
  )
  SELECT jsonb_agg(jsonb_build_object('codigo', codigo, 'n', n, 'desde', desde) ORDER BY codigo)
    FROM (SELECT codigo, count(*) AS n, min(desde) AS desde FROM filas GROUP BY codigo) x;
$function$;

-- ─────────────────────────────────────────────────────────────── el tutor que no ha contestado
-- ¿Hay un «no» vigente a la imagen de otro? Sí o no, sin decir de quién. Lo mismo que hace falso a
-- `existe_consentimiento_imagen` (cualquier «no» vigente), sin contar el de quien pregunta: así el tutor
-- que no ha contestado distingue «nadie ha dicho que sí» de «hay una oposición» (decisión del
-- 2026-11-18, «Las dos de la 10b-2, resueltas», 1). Para el tutor legal del niño y la Dirección de su
-- centro; a cualquier otro, 42501.
CREATE FUNCTION public.oposicion_imagen(p_nino_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR p_nino_id IS NULL
     OR NOT (public.es_tutor_legal_de(p_nino_id)
             OR public.es_admin(privado.centro_de_nino(p_nino_id))) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.consentimientos c
                  WHERE c.tipo = 'imagen_denegada' AND c.nino_id = p_nino_id
                    AND c.revocado_en IS NULL AND c.usuario_id <> auth.uid());
END $function$;
REVOKE ALL ON FUNCTION public.oposicion_imagen(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.oposicion_imagen(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────── operación de datos: el «sí» que N2 dejó
-- Decisión del responsable (2026-11-19): el «sí» de imagen que hay en producción a nombre de la antigua
-- admin del centro, que no es tutor legal del niño, se revoca AQUÍ, como operación de datos. Por qué:
-- N2 cierra la puerta para lo que entre desde ahora, pero no toca lo ya escrito, y ese «sí» es justo lo
-- que N2 impide. Era el único «sí» de ese niño: con él, el niño salía como autorizado para fotos sin que
-- ninguno de sus dos tutores legales lo hubiera dicho. Revocado, el niño queda sin respuesta de imagen
-- y su indicador (`ninos.puede_aparecer_en_fotos`) vuelve a false, recalculado por su trigger
-- (`consentimiento_imagen_sync_trg`). Se revoca, no se borra: queda la fila con su `revocado_en`.
--
-- Medido en producción el 2026-11-19 (solo lectura): 1 fila; su titular no tiene vínculo con el niño y
-- su único rol (admin del centro) está borrado; era el único «sí» del niño, sin ningún «no»; el
-- indicador, true; 0 fotos con el niño etiquetado. La fila se elige por esa condición, no por su id: el
-- repo es público.
--
-- En la base del CI no hay ninguna (se crea vacía): avisa y no hace nada. En producción tiene que ser
-- exactamente esa; cualquier otra cosa para la migración entera, sin tocar nada.
DO $datos$
DECLARE
  v_n int;
  v_id uuid;
  v_nino uuid;
  v_usuario uuid;
  v_otros_si int;
BEGIN
  SELECT count(*) INTO v_n
    FROM public.consentimientos c
   WHERE c.tipo = 'imagen' AND c.revocado_en IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.vinculos_familiares v
                      WHERE v.nino_id = c.nino_id AND v.usuario_id = c.usuario_id AND v.deleted_at IS NULL
                        AND v.tipo_vinculo IN ('tutor_legal_principal', 'tutor_legal_secundario'));
  IF v_n = 0 THEN
    RAISE NOTICE 'operación de datos: ningún «sí» de imagen vigente fuera de un tutor legal (la base del CI se crea vacía): nada que revocar';
    RETURN;
  END IF;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'operación de datos: % «sí» de imagen vigentes fuera de un tutor legal, y se midió 1 el 2026-11-19: no se toca nada', v_n;
  END IF;

  SELECT c.id, c.nino_id, c.usuario_id INTO v_id, v_nino, v_usuario
    FROM public.consentimientos c
   WHERE c.tipo = 'imagen' AND c.revocado_en IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.vinculos_familiares v
                      WHERE v.nino_id = c.nino_id AND v.usuario_id = c.usuario_id AND v.deleted_at IS NULL
                        AND v.tipo_vinculo IN ('tutor_legal_principal', 'tutor_legal_secundario'));

  -- La forma medida: la antigua admin. Sin ningún rol vivo, y con el de admin borrado.
  IF EXISTS (SELECT 1 FROM public.roles_usuario r WHERE r.usuario_id = v_usuario AND r.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'operación de datos: el titular del «sí» tiene un rol vivo; se midió sin ninguno: no se toca nada';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.roles_usuario r
                  WHERE r.usuario_id = v_usuario AND r.rol::text = 'admin' AND r.deleted_at IS NOT NULL
                    AND r.centro_id = privado.centro_de_nino(v_nino)) THEN
    RAISE EXCEPTION 'operación de datos: el titular del «sí» no fue admin del centro del niño: no se toca nada';
  END IF;
  -- Nada colgando: ninguna foto con el niño etiquetado (se midieron 0).
  IF EXISTS (SELECT 1 FROM public.media_etiquetas e WHERE e.nino_id = v_nino) THEN
    RAISE EXCEPTION 'operación de datos: hay fotos con el niño etiquetado; se midieron 0: no se toca nada';
  END IF;

  UPDATE public.consentimientos SET revocado_en = now() WHERE id = v_id;

  -- Después: ninguno fuera de un tutor legal, y el indicador es el que se deriva. Sin otro «sí» del
  -- niño (se midieron 0), false.
  IF EXISTS (SELECT 1 FROM public.consentimientos c
              WHERE c.tipo = 'imagen' AND c.revocado_en IS NULL
                AND NOT EXISTS (SELECT 1 FROM public.vinculos_familiares v
                                 WHERE v.nino_id = c.nino_id AND v.usuario_id = c.usuario_id AND v.deleted_at IS NULL
                                   AND v.tipo_vinculo IN ('tutor_legal_principal', 'tutor_legal_secundario'))) THEN
    RAISE EXCEPTION 'operación de datos: después de revocar sigue un «sí» fuera de un tutor legal';
  END IF;
  SELECT count(*) INTO v_otros_si FROM public.consentimientos
   WHERE tipo = 'imagen' AND nino_id = v_nino AND revocado_en IS NULL;
  IF (SELECT n.puede_aparecer_en_fotos FROM public.ninos n WHERE n.id = v_nino)
       IS DISTINCT FROM public.tiene_consentimiento_imagen(v_nino) THEN
    RAISE EXCEPTION 'operación de datos: el indicador del niño no es el derivado después de revocar';
  END IF;
  IF v_otros_si = 0 AND (SELECT n.puede_aparecer_en_fotos FROM public.ninos n WHERE n.id = v_nino) THEN
    RAISE EXCEPTION 'operación de datos: sin ningún «sí», el indicador del niño sigue en true';
  END IF;
  RAISE NOTICE 'operación de datos: revocado 1 «sí» de imagen fuera de un tutor legal; «sí» que le quedan al niño: %', v_otros_si;
END
$datos$;

-- ─────────────────────────────────────────────────────────────── guarda posterior
DO $posterior$
DECLARE
  v text;
  c text;
  r text;
BEGIN
  SELECT string_agg(polname || ':' || CASE WHEN polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END, ',' ORDER BY polname)
    INTO v FROM pg_policy WHERE polrelid = 'public.firmas_ficha'::regclass;
  IF v IS DISTINCT FROM 'bloqueo_retencion:RESTRICTIVE,firmas_ficha_select:PERMISSIVE' THEN
    RAISE EXCEPTION 'firmas_ficha no quedó con sus dos políticas: %', v;
  END IF;
  IF position('tutor_id' IN (SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
                              WHERE polrelid = 'public.firmas_ficha'::regclass AND polname = 'bloqueo_retencion')) = 0 THEN
    RAISE EXCEPTION 'bloqueo_retencion de firmas_ficha no mira al tutor';
  END IF;
  SELECT string_agg(column_name::text, ',' ORDER BY column_name) INTO v
    FROM information_schema.column_privileges
   WHERE table_schema = 'public' AND table_name = 'firmas_ficha' AND grantee = 'authenticated' AND privilege_type = 'SELECT';
  IF v IS DISTINCT FROM 'contenido_sha256,ficha_version,firmado_at,firmante_id,id,metodo_firma,nino_id,plantilla_pdf_version,rol_firmante,tutor_id' THEN
    RAISE EXCEPTION 'la sesión lee de firmas_ficha otras columnas que las diez: %', v;
  END IF;
  IF to_regprocedure('public.registrar_firma_ficha_presencial(uuid,text,text,inet,text)') IS NOT NULL
     OR to_regprocedure('privado.firmar_ficha_comun(uuid,text,text,text,inet,text,firma_metodo,tipo_vinculo)') IS NOT NULL THEN
    RAISE EXCEPTION 'queda una firma presencial sin tutor';
  END IF;
  FOREACH c IN ARRAY ARRAY['public.registrar_firma_ficha_presencial(uuid,uuid,text,text,inet,text)',
                           'public.oposicion_imagen(uuid)', 'public.pedir_refirma_ficha(uuid)',
                           'public.firmar_ficha(uuid,text,text,text,inet,text)',
                           'public.contenido_firmas_ficha(uuid[])',
                           'public.otorgar_consentimiento_imagen(uuid,uuid,text,inet,text,firma_metodo)'] LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure(c)) THEN
      RAISE EXCEPTION '% no es SECURITY DEFINER', c;
    END IF;
    IF NOT has_function_privilege('authenticated', c, 'EXECUTE') OR has_function_privilege('anon', c, 'EXECUTE') THEN
      RAISE EXCEPTION '% no quedó para authenticated y cerrada a anon', c;
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_function_privilege(r, 'privado.firmar_ficha_comun(uuid,text,text,text,inet,text,firma_metodo,tipo_vinculo,uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION '% puede ejecutar privado.firmar_ficha_comun', r;
    END IF;
  END LOOP;
  IF position('no_es_tutor_legal' IN (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.otorgar_consentimiento_imagen(uuid,uuid,text,inet,text,firma_metodo)'))) = 0
     OR position('no_es_tutor_legal' IN (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.firma_imagen_sync()'))) = 0
     OR position('sin_firma' IN (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.pedir_refirma_ficha(uuid)'))) > 0
     OR position('firmas_ficha' IN (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('privado.contenido_bloqueado(uuid,text,uuid)'))) = 0
     OR position('firmas_ficha' IN (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('privado.datos_bloqueados(text,uuid,boolean)'))) = 0 THEN
    RAISE EXCEPTION 'una de las funciones reescritas no quedó como se escribió';
  END IF;
  RAISE NOTICE '10b-3 (1/2): N2 por las dos entradas, la presencial con su tutor, pedir sin firma, bloqueados y oposición';
END
$posterior$;
