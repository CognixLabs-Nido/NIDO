-- =============================================================================
-- FEAT — Firmar los documentos del centro: la base (serie de altas, paso 2, pieza 2a; 2026-11-05)
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/altas-serie.md, «Paso 2». La tabla de firmas es del 1b (20270102120000); esto es
-- quién firma, qué le toca firmar a cada niño y cómo lo ve cada uno. Sin pantalla: la familia firma
-- en el alta en el 2c y fuera del alta en el 2d; la refirma es el 2b.
--
-- - **Lo que le toca a cada niño** (`privado.documentos_del_nino`): por cada documento no retirado
--   de su centro, la versión vigente que le toca (la del curso de cada matrícula viva, en un
--   documento de curso; la última, en uno que no lo es), con su estado:
--     · `falta_documento`: no hay versión para ese curso. No hay nada que firmar y no es de la familia.
--     · `por_firmar`: la versión existe y el niño no tiene firma de ese documento y ese curso, con
--       `disponible_desde`: desde cuándo pudo firmarla (la primera versión subida, o la entrada del
--       niño si fue después). Un documento subido hoy dice «desde hoy».
--     · `firmado`: hay una firma de ese documento y ese curso, de cualquier versión (J4: una versión
--       corregida no obliga a firmar otra vez; la refirma, 2b, lo cambiará).
--   P-6 (decisión de Jose del 2026-11-05, «lo firmará cuando se genere el documento»): un documento
--   que no existe no bloquea el alta. La firma queda pendiente y se firma cuando se suba.
-- - **Quién lo lee**: los tutores legales del niño y la Dirección de su centro, por niño
--   (`documentos_firma_nino`), y la Dirección, todo el centro (`documentos_firma_centro`, para su
--   inicio en el 2d).
-- - **Firmar**: el tutor legal, con el dedo (`firmar_documento_centro`), o la Dirección del centro en
--   persona, sin trazo (`registrar_firma_documento_presencial`; el superusuario no, como el mandato
--   presencial). Solo la versión que le toca y está por firmar.
-- - **El PDF de lo que firma** (`ruta_version_documento_nino`): la ruta, para que la app lo sirva con
--   un enlace firmado, solo de una versión que le toca o que ya firmó.
-- - **U-3, corregido en la base** (`marcar_matricula_lista`): el acuse médico se exigía de quien
--   cierra el alta para cualquier niño. U-3 lo pasó a «por niño» solo en la app (`finalizarAlta`); la
--   base seguía con el fallo, y una llamada directa cerraba el alta del 2.º hijo con el acuse del 1.º.
--   Ahora exige el de quien cierra **para ese niño**, como la app. Medido en producción el
--   2026-11-05: 1 alta pendiente, sin acuse, que tampoco cierra hoy por la app.
--   La puerta de los documentos en el cierre NO va aquí: va en el 2c con la pantalla de firmar. Con
--   ella aquí, un documento subido desde la pantalla del 1c (ya desplegada) dejaría todas las altas
--   sin poder cerrarse y sin sitio donde firmar.
--
-- Sin orden con el despliegue: las funciones son nuevas y nadie las llama todavía; el cambio de
-- `marcar_matricula_lista` solo endurece lo que la app ya exige. La aplica el responsable por SQL
-- Editor, copiando el fichero. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF to_regprocedure('public.firmar_documento_centro(uuid,uuid,text,text,inet,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'ya aplicada: existe public.firmar_documento_centro';
  END IF;
  IF to_regclass('public.firmas_documentos_centro') IS NULL THEN
    RAISE EXCEPTION 'falta 20270102120000 (las firmas de los documentos): esta va detrás';
  END IF;

  -- Lo que se reescribe es lo que hay, tal como quedó.
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.marcar_matricula_lista(uuid)');
  IF v_md5 IS DISTINCT FROM 'dc4e015833762a4958adfb1d9afd4b47' THEN
    RAISE EXCEPTION 'public.marcar_matricula_lista(uuid) no es la de 20261028120000: %', coalesce(v_md5, 'falta');
  END IF;

  RAISE NOTICE 'guarda previa: % documentos, % versiones, % firmas, % matrículas pendientes',
    (SELECT count(*) FROM public.documentos_centro),
    (SELECT count(*) FROM public.documentos_centro_versiones),
    (SELECT count(*) FROM public.firmas_documentos_centro),
    (SELECT count(*) FROM public.matriculas WHERE estado = 'pendiente' AND fecha_baja IS NULL AND deleted_at IS NULL);
END
$guarda$;

-- ---- 1. Lo que le toca a cada niño ----
-- Una fila por documento no retirado del centro del niño y, en uno de curso, por cada curso no
-- cerrado de sus matrículas vivas. Sin comprobar quién llama: la llaman las funciones de abajo,
-- después de su puerta.
CREATE FUNCTION privado.documentos_del_nino(p_nino_id uuid)
RETURNS TABLE (
  documento_id       uuid,
  titulo             text,
  de_curso           boolean,
  obligatorio        boolean,
  orden              integer,
  curso_academico_id uuid,
  curso_nombre       text,
  estado             text,
  version_id         uuid,
  numero             integer,
  disponible_desde   timestamptz,
  firma_id           uuid,
  firmado_at         timestamptz,
  metodo_firma       public.firma_metodo
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH nino AS (
    SELECT n.id, n.centro_id FROM public.ninos n WHERE n.id = p_nino_id AND n.deleted_at IS NULL
  ),
  -- Las matrículas vivas del niño en un curso no cerrado: cada una pide el documento de su curso.
  cursos AS (
    SELECT m.curso_academico_id, c.nombre, min(m.created_at) AS desde
      FROM public.matriculas m
      JOIN public.cursos_academicos c ON c.id = m.curso_academico_id
     WHERE m.nino_id = p_nino_id AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
       AND c.estado <> 'cerrado' AND c.deleted_at IS NULL
     GROUP BY m.curso_academico_id, c.nombre
  ),
  -- Lo que se pide: (documento, curso). Un documento que no es de curso, una vez, sin curso, desde la
  -- primera matrícula viva.
  pedidos AS (
    SELECT d.id AS documento_id, d.titulo, d.de_curso, d.obligatorio, d.orden,
           k.curso_academico_id, k.nombre AS curso_nombre, k.desde
      FROM public.documentos_centro d JOIN nino ON nino.centro_id = d.centro_id
      JOIN cursos k ON d.de_curso
     WHERE d.retirado_at IS NULL
    UNION ALL
    SELECT d.id, d.titulo, d.de_curso, d.obligatorio, d.orden, NULL, NULL,
           (SELECT min(k.desde) FROM cursos k)
      FROM public.documentos_centro d JOIN nino ON nino.centro_id = d.centro_id
     WHERE d.retirado_at IS NULL AND NOT d.de_curso AND EXISTS (SELECT 1 FROM cursos)
  )
  SELECT p.documento_id, p.titulo, p.de_curso, p.obligatorio, p.orden,
         p.curso_academico_id, p.curso_nombre,
         CASE WHEN f.id IS NOT NULL THEN 'firmado'
              WHEN v.id IS NULL THEN 'falta_documento'
              ELSE 'por_firmar' END,
         CASE WHEN f.id IS NOT NULL THEN f.version_id ELSE v.id END,
         CASE WHEN f.id IS NOT NULL THEN f.numero ELSE v.numero END,
         CASE WHEN f.id IS NULL AND v.id IS NOT NULL THEN greatest(primera.subida_at, p.desde) END,
         f.id, f.firmado_at, f.metodo_firma
    FROM pedidos p
    -- La vigente de ese documento y ese curso: la de número mayor.
    LEFT JOIN LATERAL (
      SELECT x.id, x.numero FROM public.documentos_centro_versiones x
       WHERE x.documento_id = p.documento_id
         AND x.curso_academico_id IS NOT DISTINCT FROM p.curso_academico_id
       ORDER BY x.numero DESC LIMIT 1
    ) v ON true
    LEFT JOIN LATERAL (
      SELECT min(x.subida_at) AS subida_at FROM public.documentos_centro_versiones x
       WHERE x.documento_id = p.documento_id
         AND x.curso_academico_id IS NOT DISTINCT FROM p.curso_academico_id
    ) primera ON true
    -- J4: cualquier versión de ese documento y ese curso firmada vale. La última firma.
    LEFT JOIN LATERAL (
      SELECT y.id, y.version_id, y.numero, y.firmado_at, y.metodo_firma
        FROM public.firmas_documentos_centro y
       WHERE y.nino_id = p_nino_id AND y.documento_id = p.documento_id
         AND y.curso_academico_id IS NOT DISTINCT FROM p.curso_academico_id
       ORDER BY y.firmado_at DESC LIMIT 1
    ) f ON true;
$function$;
REVOKE ALL ON FUNCTION privado.documentos_del_nino(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---- 2. Quién lo lee ----
-- Por niño: sus tutores legales y la Dirección de su centro. El autorizado y la profe, no.
CREATE FUNCTION public.documentos_firma_nino(p_nino_id uuid)
RETURNS TABLE (
  documento_id uuid, titulo text, de_curso boolean, obligatorio boolean, orden integer,
  curso_academico_id uuid, curso_nombre text, estado text, version_id uuid, numero integer,
  disponible_desde timestamptz, firma_id uuid, firmado_at timestamptz, metodo_firma public.firma_metodo
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL OR p_nino_id IS NULL
     OR NOT (public.es_tutor_legal_de(p_nino_id)
             OR public.es_admin(privado.centro_de_nino(p_nino_id))) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY SELECT * FROM privado.documentos_del_nino(p_nino_id) d
    ORDER BY d.orden, d.titulo, d.curso_nombre NULLS FIRST;
END
$function$;

-- Todo el centro, para el inicio de Dirección (2d): cada niño con matrícula viva y lo que le falta
-- (`por_firmar` y `falta_documento`). Lo firmado no sale: es la lista de lo pendiente.
CREATE FUNCTION public.documentos_firma_centro(p_centro_id uuid)
RETURNS TABLE (
  nino_id uuid, documento_id uuid, titulo text, obligatorio boolean, curso_academico_id uuid,
  curso_nombre text, estado text, version_id uuid, disponible_desde timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- Con el centro NULL, es_admin daría TRUE a cualquier persona de Dirección: se corta antes.
  IF auth.uid() IS NULL OR p_centro_id IS NULL OR NOT public.es_admin(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT n.id, d.documento_id, d.titulo, d.obligatorio, d.curso_academico_id, d.curso_nombre,
           d.estado, d.version_id, d.disponible_desde
      FROM public.ninos n
     CROSS JOIN LATERAL privado.documentos_del_nino(n.id) d
     WHERE n.centro_id = p_centro_id AND n.deleted_at IS NULL AND d.estado <> 'firmado'
     ORDER BY d.disponible_desde NULLS LAST, n.id, d.orden;
END
$function$;

-- ---- 3. Firmar ----
-- Comprueba que la versión es la que le toca al niño y está por firmar; si no, lanza con su HINT
-- (`version_no_vigente` o `ya_firmado`).
CREATE FUNCTION privado.version_por_firmar(p_version_id uuid, p_nino_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_doc   uuid;
  v_curso uuid;
  v_estado text;
  v_vigente uuid;
BEGIN
  SELECT x.documento_id, x.curso_academico_id INTO v_doc, v_curso
    FROM public.documentos_centro_versiones x WHERE x.id = p_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'esa versión no existe' USING ERRCODE = 'P0001', HINT = 'version_no_vigente';
  END IF;
  SELECT d.estado, d.version_id INTO v_estado, v_vigente
    FROM privado.documentos_del_nino(p_nino_id) d
   WHERE d.documento_id = v_doc AND d.curso_academico_id IS NOT DISTINCT FROM v_curso;
  IF NOT FOUND THEN
    -- El documento no es del centro del niño, o el curso no es de sus matrículas vivas.
    RAISE EXCEPTION 'esa versión no le toca a este niño' USING ERRCODE = 'P0001', HINT = 'version_no_vigente';
  END IF;
  IF v_estado = 'firmado' THEN
    RAISE EXCEPTION 'ya está firmado' USING ERRCODE = 'P0001', HINT = 'ya_firmado';
  END IF;
  IF v_vigente IS DISTINCT FROM p_version_id THEN
    -- Hay una versión más nueva de ese documento y ese curso: se firma la vigente.
    RAISE EXCEPTION 'esa versión no es la vigente' USING ERRCODE = 'P0001', HINT = 'version_no_vigente';
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION privado.version_por_firmar(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Con el dedo: el tutor legal del niño, con su sesión. El rol es su vínculo. La IP y el navegador
-- los pone la app de la petición, como en las firmas de autorizaciones.
CREATE FUNCTION public.firmar_documento_centro(
  p_version_id uuid, p_nino_id uuid, p_nombre_tecleado text, p_firma_imagen text,
  p_ip_address inet, p_user_agent text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_rol public.tipo_vinculo;
  v_id  uuid;
BEGIN
  IF auth.uid() IS NULL OR p_nino_id IS NULL OR NOT public.es_tutor_legal_de(p_nino_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Dos tutores a la vez: el segundo espera aquí y después ve la firma del primero.
  PERFORM pg_advisory_xact_lock(hashtext('firma_documento:' || p_nino_id::text));
  PERFORM privado.version_por_firmar(p_version_id, p_nino_id);
  SELECT v.tipo_vinculo INTO v_rol FROM public.vinculos_familiares v
   WHERE v.usuario_id = auth.uid() AND v.nino_id = p_nino_id AND v.deleted_at IS NULL
     AND v.tipo_vinculo IN ('tutor_legal_principal', 'tutor_legal_secundario')
   ORDER BY v.tipo_vinculo LIMIT 1;
  INSERT INTO public.firmas_documentos_centro
    (version_id, documento_id, centro_id, titulo, numero, sha256, nino_id, firmante_id,
     rol_firmante, metodo_firma, nombre_tecleado, firma_imagen, ip_address, user_agent)
  -- La copia de lo firmado la pone el trigger desde la versión (1b): estos valores no cuentan.
  VALUES (p_version_id, gen_random_uuid(), gen_random_uuid(), '-', 1, repeat('0', 64), p_nino_id,
          auth.uid(), v_rol, 'digital', btrim(p_nombre_tecleado), p_firma_imagen, p_ip_address,
          p_user_agent)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$function$;

-- En persona: la Dirección del centro del niño registra que la familia firmó en papel (la prueba es
-- el papel, 1b). Sin trazo y con rol admin. El superusuario no: los registros presenciales en nombre
-- de una familia son de la directora (ADR-0061), como el mandato SEPA presencial.
CREATE FUNCTION public.registrar_firma_documento_presencial(
  p_version_id uuid, p_nino_id uuid, p_nombre_tecleado text, p_ip_address inet, p_user_agent text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_nino_id IS NULL
     OR NOT (public.es_admin(privado.centro_de_nino(p_nino_id)) AND NOT public.is_superadmin()) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('firma_documento:' || p_nino_id::text));
  PERFORM privado.version_por_firmar(p_version_id, p_nino_id);
  INSERT INTO public.firmas_documentos_centro
    (version_id, documento_id, centro_id, titulo, numero, sha256, nino_id, firmante_id,
     rol_firmante, metodo_firma, nombre_tecleado, firma_imagen, ip_address, user_agent)
  VALUES (p_version_id, gen_random_uuid(), gen_random_uuid(), '-', 1, repeat('0', 64), p_nino_id,
          auth.uid(), 'admin', 'presencial', btrim(p_nombre_tecleado), NULL, p_ip_address,
          p_user_agent)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$function$;

-- ---- 4. El PDF de lo que firma ----
-- La ruta de una versión que le toca al niño (por firmar o ya firmada), para quien puede leer sus
-- documentos. La app la sirve con un enlace firmado: el bucket no tiene políticas (1a).
CREATE FUNCTION public.ruta_version_documento_nino(p_version_id uuid, p_nino_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_ruta text;
BEGIN
  IF auth.uid() IS NULL OR p_nino_id IS NULL
     OR NOT (public.es_tutor_legal_de(p_nino_id)
             OR public.es_admin(privado.centro_de_nino(p_nino_id))) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT x.ruta INTO v_ruta FROM public.documentos_centro_versiones x
   WHERE x.id = p_version_id
     AND (EXISTS (SELECT 1 FROM privado.documentos_del_nino(p_nino_id) d WHERE d.version_id = x.id)
          OR EXISTS (SELECT 1 FROM public.firmas_documentos_centro f
                      WHERE f.version_id = x.id AND f.nino_id = p_nino_id));
  IF v_ruta IS NULL THEN
    -- Una versión de otro centro, de otro curso o que no existe: lo mismo, sin decir cuál.
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v_ruta;
END
$function$;

REVOKE ALL ON FUNCTION public.documentos_firma_nino(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.documentos_firma_centro(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.firmar_documento_centro(uuid, uuid, text, text, inet, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.registrar_firma_documento_presencial(uuid, uuid, text, inet, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.ruta_version_documento_nino(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.documentos_firma_nino(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.documentos_firma_centro(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.firmar_documento_centro(uuid, uuid, text, text, inet, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_firma_documento_presencial(uuid, uuid, text, inet, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ruta_version_documento_nino(uuid, uuid) TO authenticated;

-- ---- 5. U-3 en la base: el acuse médico, de quien cierra Y de ese niño ----
-- El cuerpo de 20261028120000 con un único cambio, el acuse: antes `tiene_consentimiento(auth.uid(),
-- 'datos_medicos')`, de cualquier niño. Ahora el de quien cierra para p_nino_id, vigente, como lee
-- `finalizarAlta` desde U-3. Las filas antiguas sin niño (`nino_id` NULL) ya no cuentan.
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

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_f text;
  v_def text;
BEGIN
  FOREACH v_f IN ARRAY ARRAY[
    'public.documentos_firma_nino(uuid)',
    'public.documentos_firma_centro(uuid)',
    'public.firmar_documento_centro(uuid,uuid,text,text,inet,text)',
    'public.registrar_firma_documento_presencial(uuid,uuid,text,inet,text)',
    'public.ruta_version_documento_nino(uuid,uuid)'] LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_f::regprocedure)
       OR NOT has_function_privilege('authenticated', v_f, 'EXECUTE')
       OR has_function_privilege('anon', v_f, 'EXECUTE')
       OR has_function_privilege('service_role', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION '% no es SECURITY DEFINER solo para authenticated', v_f;
    END IF;
    IF position('insufficient_privilege' IN pg_get_functiondef(v_f::regprocedure)) = 0 THEN
      RAISE EXCEPTION '% no tiene puerta', v_f;
    END IF;
  END LOOP;
  FOREACH v_f IN ARRAY ARRAY['privado.documentos_del_nino(uuid)', 'privado.version_por_firmar(uuid,uuid)'] LOOP
    IF has_function_privilege('authenticated', v_f, 'EXECUTE')
       OR has_function_privilege('anon', v_f, 'EXECUTE')
       OR has_function_privilege('service_role', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION '% la puede llamar alguien', v_f;
    END IF;
  END LOOP;
  -- El registro presencial deja fuera al superusuario.
  v_def := pg_get_functiondef('public.registrar_firma_documento_presencial(uuid,uuid,text,inet,text)'::regprocedure);
  IF position('NOT public.is_superadmin()' IN v_def) = 0 THEN
    RAISE EXCEPTION 'el registro presencial no deja fuera al superusuario';
  END IF;
  -- U-3: el acuse del cierre es por niño, y ya no se pregunta a tiene_consentimiento.
  v_def := pg_get_functiondef('public.marcar_matricula_lista(uuid)'::regprocedure);
  IF position('c.nino_id = p_nino_id' IN v_def) = 0 OR position('tiene_consentimiento' IN v_def) > 0 THEN
    RAISE EXCEPTION 'marcar_matricula_lista no exige el acuse médico por niño';
  END IF;
  RAISE NOTICE 'guarda posterior: 5 funciones de sesión con puerta, 2 internas cerradas, presencial sin superusuario, acuse por niño';
END
$guarda$;
