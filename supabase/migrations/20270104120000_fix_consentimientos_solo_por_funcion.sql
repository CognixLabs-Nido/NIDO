-- =============================================================================
-- FIX — Los consentimientos solo se escriben por sus funciones, y miran de quién es el niño (2026-11-06)
-- -----------------------------------------------------------------------------
-- El consentimiento de imagen decide si se publican fotos de un menor (`ninos.puede_aparecer_en_fotos`,
-- derivado por `consentimiento_imagen_sync`), y lo podía poner cualquiera con cuenta, por dos caminos:
--
-- - **La tabla.** `consentimientos_insert` era `WITH CHECK (usuario_id = auth.uid())`: la fila a tu
--   nombre, de cualquier tipo y para cualquier niño. Los arreglos del consentimiento de imagen (#284,
--   #286) tocaron las funciones y dejaron la tabla abierta. Medido en producción el 2026-11-06, en un
--   ensayo terminado en RAISE: el tutor de otro niño y una profe insertan el suyo para un niño ajeno y
--   su flag pasa de false a true; un INSERT a nombre de otro, 42501; el tutor legal del niño, pasa.
-- - **`registrar_consentimiento`** (`SECURITY DEFINER`): solo comprobaba que la fila fuera a tu
--   nombre, y aceptaba cualquier `p_tipo` (también `imagen`) y cualquier `p_nino_id`.
--
-- La regla, en un solo sitio (`privado.puede_consentir(tipo, niño)`), para quien tiene sesión:
--   · `terminos`, `privacidad`: de la cuenta, sin niño.
--   · `datos_medicos`: el acuse de un niño concreto, de su tutor legal miembro de su centro o de la
--     Dirección de su centro (la misma puerta que `marcar_matricula_lista`, que es quien lo lee).
--   · `imagen`: de su tutor legal miembro de su centro, o de la Dirección de su centro en persona
--     (sin el superusuario, como `otorgar_consentimiento_imagen` desde ADR-0061).
--   Un niño que no existe, o sin centro, no tiene a nadie que consienta por él (`es_admin(NULL)` daría
--   TRUE a cualquier persona de Dirección). Sin `ELSE`: un tipo nuevo sin decidir falla, y la guarda
--   posterior lo caza contra el enum.
--
-- Tres cerrojos, cada uno basta solo (se miden por separado en el ensayo):
--   1. La sesión no escribe la tabla: sin INSERT, UPDATE, DELETE ni TRUNCATE para `authenticated`
--      (`anon` ya no tenía nada). Escriben solo funciones `SECURITY DEFINER` (las de otorgar,
--      registrar y revocar, el trigger de la firma de imagen y las purgas) y `service_role`.
--   2. La policy de INSERT mira la regla, por si algún día vuelve el privilegio.
--   3. Las dos funciones de la sesión la miran: `registrar_consentimiento` ya no registra la imagen
--      (va por `otorgar_consentimiento_imagen`, que lleva el consentimiento al flag), y con sesión
--      exige la regla; sin sesión (el servidor), la forma: de la cuenta sin niño, de un niño con él.
--
-- Lo que no cambia: quien lee; las filas que ya hay (1 acuse médico sin niño, de antes de U-3, se
-- queda: la regla es para lo que se escribe); que la Dirección pueda atribuir el consentimiento de
-- imagen presencial a un tutor (`p_tutor`, decisión de #284).
--
-- Sin orden con el despliegue: la app no escribe la tabla con sesión (solo la lee) y las tres
-- llamadas que hace a estas funciones ya cumplen la regla. La aplica el responsable por SQL Editor,
-- copiando el fichero. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF to_regprocedure('privado.puede_consentir(public.consentimiento_tipo,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'ya aplicada: existe privado.puede_consentir';
  END IF;

  -- Lo que se reescribe es lo que hay, tal como quedó.
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.registrar_consentimiento(uuid,public.consentimiento_tipo,text,inet,text,public.firma_metodo,uuid)');
  IF v_md5 IS DISTINCT FROM '2b7c42a437542b5f75ed5cfc22d0d1b9' THEN
    RAISE EXCEPTION 'public.registrar_consentimiento no es la de 20261002140000: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.otorgar_consentimiento_imagen(uuid,uuid,text,inet,text,public.firma_metodo)');
  IF v_md5 IS DISTINCT FROM 'ff7f77888aa80719f08463301a094891' THEN
    RAISE EXCEPTION 'public.otorgar_consentimiento_imagen no es la de 20261028120000: %', coalesce(v_md5, 'falta');
  END IF;

  IF (SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy
       WHERE polrelid = 'public.consentimientos'::regclass AND polname = 'consentimientos_insert')
     IS DISTINCT FROM '(usuario_id = auth.uid())' THEN
    RAISE EXCEPTION 'consentimientos_insert no es la de la fase 2 (usuario_id = auth.uid())';
  END IF;

  RAISE NOTICE 'guarda previa: consentimientos por tipo y con niño: %',
    (SELECT string_agg(t || '=' || n, ', ' ORDER BY t) FROM (
       SELECT tipo::text || CASE WHEN nino_id IS NULL THEN '/sin_nino' ELSE '/con_nino' END AS t,
              count(*) AS n
         FROM public.consentimientos GROUP BY 1) s);
END
$guarda$;

-- ---- 1. La regla ----
-- Quién puede consentir, con sesión, un consentimiento de este tipo para este niño. La usan la policy
-- (por eso EXECUTE para authenticated) y las dos funciones. Vive en `privado`: la API no la publica.
CREATE FUNCTION privado.puede_consentir(p_tipo public.consentimiento_tipo, p_nino_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_centro uuid := privado.centro_de_nino(p_nino_id);
BEGIN
  CASE p_tipo
    WHEN 'terminos', 'privacidad' THEN
      RETURN p_nino_id IS NULL;
    WHEN 'datos_medicos' THEN
      RETURN v_centro IS NOT NULL
         AND ((public.es_tutor_legal_de(p_nino_id) AND public.pertenece_a_centro(v_centro))
              OR public.es_admin(v_centro));
    WHEN 'imagen' THEN
      RETURN v_centro IS NOT NULL
         AND ((public.es_tutor_legal_de(p_nino_id) AND public.pertenece_a_centro(v_centro))
              OR (public.es_admin(v_centro) AND NOT public.is_superadmin()));
  END CASE;
END $function$;

REVOKE ALL ON FUNCTION privado.puede_consentir(public.consentimiento_tipo, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION privado.puede_consentir(public.consentimiento_tipo, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION privado.puede_consentir(public.consentimiento_tipo, uuid) IS
  'Quién consiente con sesión: términos y privacidad, de la cuenta sin niño; acuse médico, el tutor legal miembro del centro del niño o su Dirección; imagen, el tutor legal miembro del centro o su Dirección en persona sin el superusuario. Un niño sin centro, nadie (20270104120000).';

-- ---- 2. La tabla: la sesión no la escribe ----
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.consentimientos FROM anon, authenticated;

-- ---- 3. La policy de INSERT, por si vuelve el privilegio ----
ALTER POLICY consentimientos_insert ON public.consentimientos
  WITH CHECK (usuario_id = auth.uid() AND privado.puede_consentir(tipo, nino_id));

COMMENT ON POLICY consentimientos_insert ON public.consentimientos IS
  'Segundo cerrojo: la sesión no tiene INSERT (20270104120000). Si lo recuperara, la fila a su nombre y con la regla de privado.puede_consentir: de quién es el niño y de qué centro.';

-- ---- 4. registrar_consentimiento ----
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

-- ---- 5. otorgar_consentimiento_imagen ----
-- La misma regla. Cambia, frente a 20261028120000: el tutor legal tiene que ser miembro del centro
-- del niño, y un niño sin centro (o que no existe) ya no deja pasar a cualquier persona de Dirección
-- (`es_admin(NULL)`). Lo demás, igual: la Dirección presencial (no el superusuario) atribuye el
-- consentimiento a `p_tutor`; los demás, a sí mismos.
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

  INSERT INTO public.consentimientos
    (usuario_id, tipo, version, nino_id, ip_address, user_agent, metodo_firma)
  VALUES
    (p_tutor, 'imagen', p_version, p_nino_id, p_ip, p_user_agent, p_metodo)
  RETURNING id INTO v_id;

  RETURN v_id;
END $function$;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  r record;
  v_n int := 0;
BEGIN
  -- 1. La sesión no escribe la tabla.
  FOR r IN SELECT rol, priv FROM unnest(ARRAY['anon', 'authenticated']) rol,
                                 unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) priv LOOP
    IF has_table_privilege(r.rol, 'public.consentimientos', r.priv) THEN
      RAISE EXCEPTION '% conserva % en consentimientos', r.rol, r.priv;
    END IF;
  END LOOP;

  -- 2. La policy de INSERT mira la regla, y no hay otra que deje insertar.
  IF (SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy
       WHERE polrelid = 'public.consentimientos'::regclass AND polname = 'consentimientos_insert')
     NOT LIKE '%privado.puede_consentir(tipo, nino_id)%' THEN
    RAISE EXCEPTION 'consentimientos_insert no mira privado.puede_consentir';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.consentimientos'::regclass
               AND polcmd IN ('a', 'w', 'd', '*') AND polpermissive
               AND polname <> 'consentimientos_insert') THEN
    RAISE EXCEPTION 'hay una policy permisiva de escritura además de consentimientos_insert';
  END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.consentimientos'::regclass
        AND polcmd = 'a') <> 1 THEN
    RAISE EXCEPTION 'consentimientos tiene más de una policy de INSERT';
  END IF;

  -- 3. Las dos funciones de la sesión la miran, y registrar ya no registra la imagen.
  IF (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.registrar_consentimiento(uuid,public.consentimiento_tipo,text,inet,text,public.firma_metodo,uuid)'))
     NOT LIKE '%privado.puede_consentir(p_tipo, p_nino_id)%' THEN
    RAISE EXCEPTION 'registrar_consentimiento no mira privado.puede_consentir';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.registrar_consentimiento(uuid,public.consentimiento_tipo,text,inet,text,public.firma_metodo,uuid)'))
     NOT LIKE '%IF p_tipo = ''imagen'' THEN%' THEN
    RAISE EXCEPTION 'registrar_consentimiento vuelve a registrar la imagen';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.otorgar_consentimiento_imagen(uuid,uuid,text,inet,text,public.firma_metodo)'))
     NOT LIKE '%privado.puede_consentir(''imagen'', p_nino_id)%' THEN
    RAISE EXCEPTION 'otorgar_consentimiento_imagen no mira privado.puede_consentir';
  END IF;

  -- 4. La regla: SECURITY DEFINER, sin EXECUTE para anon ni PUBLIC, y con decisión para cada tipo
  --    del enum (sin ELSE, un tipo nuevo da case_not_found aquí).
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('privado.puede_consentir(public.consentimiento_tipo,uuid)')) THEN
    RAISE EXCEPTION 'privado.puede_consentir no es SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', 'privado.puede_consentir(public.consentimiento_tipo,uuid)', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                 WHERE p.oid = to_regprocedure('privado.puede_consentir(public.consentimiento_tipo,uuid)')
                   AND a.grantee = 0) THEN
    RAISE EXCEPTION 'privado.puede_consentir abierta a anon o a PUBLIC';
  END IF;
  FOR r IN SELECT unnest(enum_range(NULL::public.consentimiento_tipo)) AS t LOOP
    PERFORM privado.puede_consentir(r.t, NULL);
    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'guarda posterior: % tipos con regla; la sesión sin INSERT/UPDATE/DELETE/TRUNCATE; % policies de INSERT', v_n,
    (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.consentimientos'::regclass AND polcmd = 'a');
END
$guarda$;
