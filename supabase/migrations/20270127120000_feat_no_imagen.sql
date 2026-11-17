-- Fase 10 · 10a-2: el «no» de la imagen (2026-11-17). Spec: docs/specs/altas-serie.md, «Las cinco,
-- resueltas» (punto 2), «Cada tutor responde por sí» y «10a-2: el diseño».
--
-- El responsable, 2026-11-17: «CADA TUTOR RESPONDE POR SÍ, Y SI HAY ALGÚN «NO» VIGENTE, NO HAY
-- CONSENTIMIENTO. Un «no» solo lo retira quien lo puso, o Dirección con su rastro; el «sí» del otro
-- tutor no lo tumba.» Y: «Que la decisión salga de una sola consulta.»
--
-- Medido ABIERTO en producción el 2026-11-17 (ensayos terminados en RAISE): con el «no» de un tutor
-- vigente, el «sí» del otro (por `otorgar_consentimiento_imagen` o firmando la autorización de imagen)
-- dejaba al niño autorizado en las siete puertas: `existe_` y `tiene_consentimiento_imagen`, el
-- indicador `ninos.puede_aparecer_en_fotos`, `privado.nino_puede_aparecer`,
-- `publicacion_tiene_nino_sin_permiso`, y los dos escritores. Y `registrar_consentimiento` sin sesión
-- aceptaba `imagen_denegada`, también repetido.
--
--   1. `existe_` y `tiene_consentimiento_imagen`: el «sí» y la falta de «no», en UNA consulta.
--   2. `consentimiento_imagen_sync`: un «no» que entra o se retira recalcula el indicador; de él beben
--      `nino_puede_aparecer` y `publicacion_tiene_nino_sin_permiso` (no se tocan; la guarda exige su
--      cuerpo).
--   3. `otorgar_consentimiento_imagen` y `firma_imagen_sync`: el «sí» de un tutor retira SU «no».
--   4. `denegar_consentimiento_imagen` y `retirar_denegacion_imagen`, nuevas; `privado.retirar_no_imagen`
--      deja el rastro (`imagen_no_retirado` en `audit_log`) cuando quien retira no es el tutor.
--   5. `registrar_consentimiento` rechaza `imagen_denegada`; un «no» vigente por tutor y niño.
--   `revocar_consentimiento_imagen` no cambia («revocar es retirar, no imponer»).
--
-- ORDEN: aplicar antes de mergear. Sin ningún «no» en la base todo contesta como antes, y las dos
-- funciones nuevas no las llama la app de antes. Sin COMMIT ni BEGIN: el SQL Editor la envuelve en su
-- transacción.

-- ─────────────────────────────────────────────────────────────── guarda previa
DO $guarda$
DECLARE
  v text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20270126120000') THEN
    RAISE EXCEPTION 'falta la 20270126120000 en el registro: aplica antes la 10a-1';
  END IF;
  SELECT string_agg(enumlabel::text, ',' ORDER BY enumsortorder) INTO v
    FROM pg_enum WHERE enumtypid = 'public.consentimiento_tipo'::regtype;
  IF v IS DISTINCT FROM 'terminos,privacidad,imagen,datos_medicos,imagen_denegada' THEN
    RAISE EXCEPTION 'consentimiento_tipo no tiene las etiquetas esperadas: %', v;
  END IF;

  -- Las funciones que se reescriben y las que leen el indicador, con el cuerpo leído en producción
  -- (md5 de la lógica normalizada).
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.existe_consentimiento_imagen(uuid)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM '9c75911b6852c5686d71a64d2b558bbb' THEN
    RAISE EXCEPTION 'public.existe_consentimiento_imagen(uuid) no es la leída en producción el 2026-11-17';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.tiene_consentimiento_imagen(uuid)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM '0a44ff7da038975a40c1de975ad4884d' THEN
    RAISE EXCEPTION 'public.tiene_consentimiento_imagen(uuid) no es la leída en producción el 2026-11-17';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.consentimiento_imagen_sync()')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM '2dcf2809414c7f84098fcbd570d4bb55' THEN
    RAISE EXCEPTION 'public.consentimiento_imagen_sync() no es la leída en producción el 2026-11-17';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.otorgar_consentimiento_imagen(uuid,uuid,text,inet,text,firma_metodo)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM 'f5e00d81d781bfc08db739ff6b41aed7' THEN
    RAISE EXCEPTION 'public.otorgar_consentimiento_imagen(uuid,uuid,text,inet,text,firma_metodo) no es la leída en producción el 2026-11-17';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.firma_imagen_sync()')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM '076bfc98921e031213cedda5f9c0952b' THEN
    RAISE EXCEPTION 'public.firma_imagen_sync() no es la leída en producción el 2026-11-17';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.registrar_consentimiento(uuid,consentimiento_tipo,text,inet,text,firma_metodo,uuid)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM '81ef5d0a62698bb9cae1ae81a965f3cb' THEN
    RAISE EXCEPTION 'public.registrar_consentimiento(uuid,consentimiento_tipo,text,inet,text,firma_metodo,uuid) no es la leída en producción el 2026-11-17';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.ninos_flag_imagen_derivado()')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM '5de217e1cb2870d13e33fa12bee846c3' THEN
    RAISE EXCEPTION 'public.ninos_flag_imagen_derivado() no es la leída en producción el 2026-11-17';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('privado.nino_puede_aparecer(uuid)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM 'e8b5c095469ce9998f2768039b54192b' THEN
    RAISE EXCEPTION 'privado.nino_puede_aparecer(uuid) no es la leída en producción el 2026-11-17';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.publicacion_tiene_nino_sin_permiso(uuid)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM 'cf2f5e5f23665507486a68a7e5790107' THEN
    RAISE EXCEPTION 'public.publicacion_tiene_nino_sin_permiso(uuid) no es la leída en producción el 2026-11-17';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.revocar_consentimiento_imagen(uuid)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM 'b2c133bfe080545e582a8094d3db103a' THEN
    RAISE EXCEPTION 'public.revocar_consentimiento_imagen(uuid) no es la leída en producción el 2026-11-17';
  END IF;

  IF to_regprocedure('public.denegar_consentimiento_imagen(uuid,uuid,text,inet,text,firma_metodo)') IS NOT NULL
     OR to_regprocedure('public.retirar_denegacion_imagen(uuid,uuid)') IS NOT NULL
     OR to_regprocedure('privado.retirar_no_imagen(uuid,uuid)') IS NOT NULL
     OR to_regclass('public.consentimientos_un_no_imagen_vigente') IS NOT NULL THEN
    RAISE EXCEPTION 'ya existe alguna pieza de la 10a-2';
  END IF;

  -- El índice de un «no» vigente por tutor y niño no puede nacer con duplicados.
  IF EXISTS (SELECT 1 FROM public.consentimientos
              WHERE tipo = 'imagen_denegada' AND revocado_en IS NULL
              GROUP BY nino_id, usuario_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'hay «no» de imagen duplicados vigentes';
  END IF;
END
$guarda$;

-- ─────────────────────────────────────────────────────────────── un «no» vigente por tutor y niño
CREATE UNIQUE INDEX consentimientos_un_no_imagen_vigente
  ON public.consentimientos (nino_id, usuario_id)
  WHERE tipo = 'imagen_denegada' AND revocado_en IS NULL;

-- ─────────────────────────────────────────────────────────────── retirar un «no», con su rastro
CREATE FUNCTION privado.retirar_no_imagen(p_nino_id uuid, p_tutor uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_centro uuid := privado.centro_de_nino(p_nino_id);
  v_ids uuid[];
  v_id uuid;
BEGIN
  WITH r AS (
    UPDATE public.consentimientos
       SET revocado_en = now()
     WHERE tipo = 'imagen_denegada' AND nino_id = p_nino_id AND usuario_id = p_tutor
       AND revocado_en IS NULL
    RETURNING id
  )
  SELECT coalesce(array_agg(id), '{}') INTO v_ids FROM r;

  -- Lo retira alguien que no es el tutor (Dirección): queda quién, cuándo y qué fila. Sin datos de
  -- la familia: la fila de `consentimientos` ya dice de quién era.
  IF v_uid IS NOT NULL AND v_uid <> p_tutor THEN
    FOREACH v_id IN ARRAY v_ids LOOP
      INSERT INTO public.audit_log (tabla, registro_id, accion, usuario_id, centro_id, valores_despues)
      VALUES ('imagen_no_retirado', v_id, 'UPDATE', v_uid, v_centro,
              jsonb_build_object('accion', 'retirado_por_otro'));
    END LOOP;
  END IF;

  RETURN cardinality(v_ids);
END
$function$;
REVOKE ALL ON FUNCTION privado.retirar_no_imagen(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────── las seis, reescritas desde las vivas
CREATE OR REPLACE FUNCTION public.tiene_consentimiento_imagen(p_nino_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [10a-2] Una sola sentencia: ningún «no» vigente de nadie Y el «sí» que pide el niño (2026-11-17).
  SELECT NOT EXISTS (
           SELECT 1 FROM public.consentimientos d
           WHERE d.tipo = 'imagen_denegada' AND d.nino_id = p_nino_id AND d.revocado_en IS NULL)
  AND CASE
    WHEN COALESCE(
           (SELECT requiere_ambos_firmantes FROM public.ninos WHERE id = p_nino_id),
           false)
    THEN
      -- Doble consentimiento: existe ≥1 tutor principal y NINGÚN principal sin consent vigente.
      EXISTS (
        SELECT 1 FROM public.vinculos_familiares vf
        WHERE vf.nino_id = p_nino_id
          AND vf.tipo_vinculo = 'tutor_legal_principal'
          AND vf.deleted_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.vinculos_familiares vf
        WHERE vf.nino_id = p_nino_id
          AND vf.tipo_vinculo = 'tutor_legal_principal'
          AND vf.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.consentimientos c
            WHERE c.tipo = 'imagen'
              AND c.nino_id = p_nino_id
              AND c.usuario_id = vf.usuario_id
              AND c.revocado_en IS NULL
          )
      )
    ELSE
      COALESCE((
        SELECT true FROM public.consentimientos
        WHERE tipo = 'imagen' AND nino_id = p_nino_id AND revocado_en IS NULL
        LIMIT 1
      ), false)
  END;
$function$;

CREATE OR REPLACE FUNCTION public.existe_consentimiento_imagen(p_nino_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro uuid := privado.centro_de_nino(p_nino_id);
BEGIN
  -- [PR 2a] Solo quien es del centro del niño.
  IF auth.uid() IS NULL THEN
    IF NOT (COALESCE(auth.role(), '') = 'service_role'
            OR (session_user <> 'authenticator'
                AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
      RAISE EXCEPTION 'no autorizado: sin sesión solo el servicio'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NOT (public.pertenece_a_centro(v_centro)
             OR (v_centro IS NOT NULL AND public.es_admin(v_centro))) THEN
    RAISE EXCEPTION 'no autorizado: no es de este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- [10a-2] Una sola consulta: hay un «sí» vigente Y ningún «no» vigente de nadie (2026-11-17).
  RETURN EXISTS (
           SELECT 1 FROM public.consentimientos
           WHERE tipo = 'imagen' AND nino_id = p_nino_id AND revocado_en IS NULL)
     AND NOT EXISTS (
           SELECT 1 FROM public.consentimientos
           WHERE tipo = 'imagen_denegada' AND nino_id = p_nino_id AND revocado_en IS NULL);
END;
$function$;

CREATE OR REPLACE FUNCTION public.consentimiento_imagen_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_nino uuid;
  v_val  boolean;
BEGIN
  -- [10a-2] Un «no» que entra o se retira también recalcula el indicador.
  IF COALESCE(NEW.tipo, OLD.tipo) NOT IN ('imagen', 'imagen_denegada') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  v_nino := COALESCE(NEW.nino_id, OLD.nino_id);
  IF v_nino IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_val := public.tiene_consentimiento_imagen(v_nino);
  UPDATE public.ninos
     SET puede_aparecer_en_fotos = v_val
   WHERE id = v_nino
     AND puede_aparecer_en_fotos IS DISTINCT FROM v_val;   -- guard anti-ruido de audit

  RETURN COALESCE(NEW, OLD);
END $function$;

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
    IF NOT (
         EXISTS (SELECT 1 FROM public.vinculos_familiares vf
                  WHERE vf.usuario_id = NEW.firmante_id
                    AND vf.nino_id = NEW.nino_id
                    AND vf.deleted_at IS NULL
                    AND vf.tipo_vinculo IN ('tutor_legal_principal', 'tutor_legal_secundario'))
      OR (NEW.metodo_firma = 'presencial'
          AND EXISTS (SELECT 1 FROM public.roles_usuario ru
                       WHERE ru.usuario_id = NEW.firmante_id
                         AND ru.rol::text IN ('admin', 'directora')
                         AND ru.deleted_at IS NULL
                         AND ru.centro_id = privado.centro_de_nino(NEW.nino_id)))
    ) THEN
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

CREATE OR REPLACE FUNCTION public.registrar_consentimiento(p_usuario_id uuid, p_tipo consentimiento_tipo, p_version text, p_ip inet DEFAULT NULL::inet, p_user_agent text DEFAULT NULL::text, p_metodo firma_metodo DEFAULT 'digital'::firma_metodo, p_nino_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  -- Sin uid solo entra el servicio: service_role o sesión directa sin JWT (SQL Editor / psql).
  IF auth.uid() IS NULL
     AND NOT (COALESCE(auth.role(), '') = 'service_role'
              OR (session_user <> 'authenticator'
                  AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                  AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
    RAISE EXCEPTION 'no autorizado: sin sesión solo el servicio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'no autorizado a registrar consentimientos de otro usuario'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- La imagen va por otorgar_consentimiento_imagen, para todos (20270104120000).
  IF p_tipo = 'imagen' THEN
    RAISE EXCEPTION 'el consentimiento de imagen se registra con otorgar_consentimiento_imagen'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'imagen';
  END IF;
  -- [10a-2] El «no» de la imagen, por denegar_consentimiento_imagen (2026-11-17).
  IF p_tipo = 'imagen_denegada' THEN
    RAISE EXCEPTION 'el «no» de la imagen se registra con denegar_consentimiento_imagen'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'imagen';
  END IF;
  IF auth.uid() IS NOT NULL THEN
    -- Con sesión, la regla: de quién es el niño y de qué centro.
    IF NOT privado.puede_consentir(p_tipo, p_nino_id) THEN
      RAISE EXCEPTION 'no autorizado a registrar este consentimiento para este niño'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF (p_tipo IN ('terminos', 'privacidad')) <> (p_nino_id IS NULL) THEN
    -- Sin sesión (el servidor), la forma: de la cuenta sin niño, de un niño con él.
    RAISE EXCEPTION 'un consentimiento de la cuenta va sin niño, y uno de un niño con él'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'nino_id';
  END IF;

  INSERT INTO public.consentimientos
    (usuario_id, tipo, version, ip_address, user_agent, metodo_firma, nino_id)
  VALUES (p_usuario_id, p_tipo, p_version, p_ip, p_user_agent, p_metodo, p_nino_id)
  RETURNING id INTO v_id;

  -- Caché denormalizada (solo terminos/privacidad tienen columna en usuarios).
  IF p_tipo = 'terminos' THEN
    UPDATE public.usuarios SET consentimiento_terminos_version = p_version WHERE id = p_usuario_id;
  ELSIF p_tipo = 'privacidad' THEN
    UPDATE public.usuarios SET consentimiento_privacidad_version = p_version WHERE id = p_usuario_id;
  END IF;

  RETURN v_id;
END $function$;

-- ─────────────────────────────────────────────────────────────── el «no»
CREATE FUNCTION public.denegar_consentimiento_imagen(p_nino_id uuid, p_tutor uuid, p_version text,
  p_ip inet DEFAULT NULL::inet, p_user_agent text DEFAULT NULL::text,
  p_metodo firma_metodo DEFAULT 'checkbox'::firma_metodo)
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
  -- La puerta de otorgar_consentimiento_imagen: el tutor legal, el suyo; Dirección en persona (sin el
  -- superusuario, ADR-0061), el de un tutor legal del niño.
  IF v_uid IS NULL THEN
    IF NOT (COALESCE(auth.role(), '') = 'service_role'
            OR (session_user <> 'authenticator'
                AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
      RAISE EXCEPTION 'no autorizado a denegar la imagen de este niño'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    IF NOT privado.puede_consentir('imagen', p_nino_id) THEN
      RAISE EXCEPTION 'no autorizado a denegar la imagen de este niño'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_admin := v_centro IS NOT NULL AND public.es_admin(v_centro) AND NOT public.is_superadmin();
    IF NOT v_admin THEN
      p_tutor := v_uid;
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.vinculos_familiares vf
                  WHERE vf.nino_id = p_nino_id AND vf.usuario_id = p_tutor AND vf.deleted_at IS NULL
                    AND vf.tipo_vinculo IN ('tutor_legal_principal', 'tutor_legal_secundario')) THEN
    RAISE EXCEPTION 'el «no» de la imagen lo da un tutor legal del niño'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'no_es_tutor_legal';
  END IF;

  -- Cada tutor responde por sí: su «no» retira SU «sí», nunca el de otro.
  UPDATE public.consentimientos
     SET revocado_en = now()
   WHERE tipo = 'imagen' AND nino_id = p_nino_id AND usuario_id = p_tutor AND revocado_en IS NULL;

  INSERT INTO public.consentimientos
    (usuario_id, tipo, version, nino_id, ip_address, user_agent, metodo_firma)
  VALUES
    (p_tutor, 'imagen_denegada', p_version, p_nino_id, p_ip, p_user_agent, p_metodo)
  ON CONFLICT (nino_id, usuario_id) WHERE tipo = 'imagen_denegada' AND revocado_en IS NULL DO NOTHING
  RETURNING id INTO v_id;

  -- Repetirlo devuelve el que ya estaba.
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.consentimientos
     WHERE tipo = 'imagen_denegada' AND nino_id = p_nino_id AND usuario_id = p_tutor
       AND revocado_en IS NULL;
  END IF;

  RETURN v_id;
END
$function$;
REVOKE ALL ON FUNCTION public.denegar_consentimiento_imagen(uuid, uuid, text, inet, text, firma_metodo) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.denegar_consentimiento_imagen(uuid, uuid, text, inet, text, firma_metodo) TO authenticated, service_role;

CREATE FUNCTION public.retirar_denegacion_imagen(p_nino_id uuid, p_tutor uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_centro uuid := privado.centro_de_nino(p_nino_id);
BEGIN
  -- Un «no» lo retira quien lo puso, o Dirección (sin el superusuario) con su rastro.
  IF v_uid IS NULL THEN
    IF NOT (COALESCE(auth.role(), '') = 'service_role'
            OR (session_user <> 'authenticator'
                AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
      RAISE EXCEPTION 'no autorizado a retirar el «no» de imagen de este niño'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NOT ((v_uid = p_tutor AND privado.puede_consentir('imagen', p_nino_id))
             OR (v_centro IS NOT NULL AND public.es_admin(v_centro) AND NOT public.is_superadmin())) THEN
    RAISE EXCEPTION 'no autorizado a retirar el «no» de imagen de este niño'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN privado.retirar_no_imagen(p_nino_id, p_tutor);
END
$function$;
REVOKE ALL ON FUNCTION public.retirar_denegacion_imagen(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retirar_denegacion_imagen(uuid, uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────── guarda posterior
DO $guarda$
DECLARE
  f text;
BEGIN
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.existe_consentimiento_imagen(uuid)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g'))) = '9c75911b6852c5686d71a64d2b558bbb'
     OR position('''imagen_denegada''' IN regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.existe_consentimiento_imagen(uuid)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g')) = 0 THEN
    RAISE EXCEPTION 'public.existe_consentimiento_imagen(uuid) no quedó reescrita';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.tiene_consentimiento_imagen(uuid)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g'))) = '0a44ff7da038975a40c1de975ad4884d'
     OR position('''imagen_denegada''' IN regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.tiene_consentimiento_imagen(uuid)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g')) = 0 THEN
    RAISE EXCEPTION 'public.tiene_consentimiento_imagen(uuid) no quedó reescrita';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.consentimiento_imagen_sync()')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g'))) = '2dcf2809414c7f84098fcbd570d4bb55'
     OR position('''imagen_denegada''' IN regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.consentimiento_imagen_sync()')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g')) = 0 THEN
    RAISE EXCEPTION 'public.consentimiento_imagen_sync() no quedó reescrita';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.otorgar_consentimiento_imagen(uuid,uuid,text,inet,text,firma_metodo)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g'))) = 'f5e00d81d781bfc08db739ff6b41aed7'
     OR position('privado.retirar_no_imagen(' IN regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.otorgar_consentimiento_imagen(uuid,uuid,text,inet,text,firma_metodo)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g')) = 0 THEN
    RAISE EXCEPTION 'public.otorgar_consentimiento_imagen(uuid,uuid,text,inet,text,firma_metodo) no quedó reescrita';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.firma_imagen_sync()')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g'))) = '076bfc98921e031213cedda5f9c0952b'
     OR position('privado.retirar_no_imagen(' IN regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.firma_imagen_sync()')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g')) = 0 THEN
    RAISE EXCEPTION 'public.firma_imagen_sync() no quedó reescrita';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.registrar_consentimiento(uuid,consentimiento_tipo,text,inet,text,firma_metodo,uuid)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g'))) = '81ef5d0a62698bb9cae1ae81a965f3cb'
     OR position('p_tipo = ''imagen_denegada''' IN regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.registrar_consentimiento(uuid,consentimiento_tipo,text,inet,text,firma_metodo,uuid)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g')) = 0 THEN
    RAISE EXCEPTION 'public.registrar_consentimiento(uuid,consentimiento_tipo,text,inet,text,firma_metodo,uuid) no quedó reescrita';
  END IF;

  -- `tiene_` decide en una sentencia SQL; `existe_`, en un RETURN de una expresión.
  IF (SELECT l.lanname FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
       WHERE p.oid = to_regprocedure('public.tiene_consentimiento_imagen(uuid)')) <> 'sql' THEN
    RAISE EXCEPTION 'tiene_consentimiento_imagen dejó de ser SQL';
  END IF;

  FOREACH f IN ARRAY ARRAY['public.denegar_consentimiento_imagen(uuid,uuid,text,inet,text,firma_metodo)',
                           'public.retirar_denegacion_imagen(uuid,uuid)'] LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure(f))
       OR has_function_privilege('anon', to_regprocedure(f), 'EXECUTE')
       OR NOT has_function_privilege('authenticated', to_regprocedure(f), 'EXECUTE') THEN
      RAISE EXCEPTION '% no tiene la forma esperada', f;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', to_regprocedure('privado.retirar_no_imagen(uuid,uuid)'), 'EXECUTE')
     OR has_function_privilege('service_role', to_regprocedure('privado.retirar_no_imagen(uuid,uuid)'), 'EXECUTE') THEN
    RAISE EXCEPTION 'privado.retirar_no_imagen está abierta';
  END IF;
  IF to_regclass('public.consentimientos_un_no_imagen_vigente') IS NULL THEN
    RAISE EXCEPTION 'falta el índice de un «no» vigente';
  END IF;

  RAISE NOTICE '10a-2: seis reescritas, dos nuevas, un índice. «No» vigentes: %, «sí» vigentes: %',
    (SELECT count(*) FROM public.consentimientos WHERE tipo = 'imagen_denegada' AND revocado_en IS NULL),
    (SELECT count(*) FROM public.consentimientos WHERE tipo = 'imagen' AND revocado_en IS NULL);
END
$guarda$;
