-- =============================================================================
-- FEAT — Baja temporal y salida del centro del personal (2 de 2)
-- -----------------------------------------------------------------------------
-- Hasta ahora, sacar a una profe del centro era `terminar-asignacion`: cerraba su aula y dejaba
-- viva su fila `profe` de `roles_usuario`. Seguía entrando y leía lo del centro (calendario, menús,
-- eventos, los DNI de las recogidas). Decisión del responsable: quien no trabaja en el centro no
-- entra. Son dos estados distintos (`20261101120000`):
--
--   · `baja_temporal` (enfermedad, maternidad, excedencia): no entra y no ve nada; al volver,
--     Dirección la reactiva sin invitación (`reactivar_profe`).
--   · `salida_centro` (despido o se va): definitivo. Si vuelve, es un alta nueva con invitación.
--
-- `dar_de_baja_profe(centro, usuario, motivo)`, en UNA transacción: retira la fila `profe` con el
-- motivo y cierra todas sus asignaciones de aula abiertas en el centro (`fecha_fin`; si la
-- asignación empieza en el futuro, su `fecha_inicio`, por el CHECK). Cerrar el aula libera el puesto
-- de coordinadora para la sustituta. La hace Dirección (`es_admin`), como invitar a una profe.
--
-- Y la garantía, en un solo sitio: los helpers que dan acceso por la asignación de aula
-- (`es_profe_de_aula`, `es_profe_de_nino`, `es_redactor_de_aula`, `es_redactor_de_nino` y la rama de
-- centro de `usuario_es_audiencia_anuncio(_row)`) miraban solo `profes_aulas`. Ahora exigen además
-- un rol `profe` vivo en el centro (`es_profe_en_centro`). Sin rol, nada, aunque un camino deje una
-- asignación abierta. En producción todas las asignaciones abiertas tienen su rol `profe` vivo: la
-- guarda previa lo comprueba (si no, esta migración les quitaría el acceso al aula).
--
-- Sin otro cambio de comportamiento: las RPC son nuevas, y los helpers dan lo mismo a quien tiene
-- su rol vivo.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor, DESPUÉS de
-- `20261101120000`. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_esperado constant jsonb := '{
    "public.es_profe_de_aula(uuid)": "7bee8bd693af7c9b6cce92a255e58656",
    "public.es_profe_de_nino(uuid)": "fc257914f14e7331705a4c6c3e8a52a9",
    "public.es_redactor_de_aula(uuid)": "4cf09b6db278794f05f229d3a9d5f228",
    "public.es_redactor_de_nino(uuid)": "99ca578cbcbbef0c6ddf3438247d4d80",
    "public.usuario_es_audiencia_anuncio(uuid)": "70028074a4431324ec5a13dc0adafcd8",
    "public.usuario_es_audiencia_anuncio_row(uuid,uuid,ambito_anuncio,uuid)": "b4a29803a90cf53b3cebe630c8ef524f",
    "public.es_profe_en_centro(uuid)": "529a7048689278ad679a9225e2f4e1e1"
  }'::jsonb;
  v_mal text;
  v_sin_rol int;
  v_abiertas int;
BEGIN
  IF (SELECT count(*) FROM pg_enum
       WHERE enumtypid = 'public.motivo_borrado'::regtype
         AND enumlabel IN ('baja_temporal', 'salida_centro')) <> 2 THEN
    RAISE EXCEPTION 'faltan los motivos baja_temporal y salida_centro: aplica antes 20261101120000';
  END IF;
  IF to_regprocedure('public.dar_de_baja_profe(uuid, uuid, public.motivo_borrado)') IS NOT NULL
     OR to_regprocedure('public.reactivar_profe(uuid, uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'dar_de_baja_profe o reactivar_profe ya existen';
  END IF;

  -- Los 7 cuerpos que se reescriben o de los que se depende, con la lógica que se leyó en
  -- producción (md5 normalizado: sin \r, sin comentarios, espacios colapsados).
  SELECT string_agg(e.key || '=' || coalesce(a.md5, 'falta'), ', ')
    INTO v_mal
    FROM jsonb_each_text(v_esperado) e
    LEFT JOIN (
      SELECT 'public.' || p.proname || substr(p.oid::regprocedure::text, strpos(p.oid::regprocedure::text, '(')) AS sig,
             md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) AS md5
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
    ) a ON a.sig = e.key
   WHERE a.md5 IS DISTINCT FROM e.value;
  IF v_mal IS NOT NULL THEN
    RAISE EXCEPTION 'los cuerpos no son los esperados: %', v_mal;
  END IF;

  -- Toda asignación abierta tiene su rol `profe` vivo en el centro del aula. Si alguna no, los
  -- helpers nuevos le quitarían el aula: se para y se mira antes.
  SELECT count(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM public.roles_usuario r JOIN public.aulas au ON au.centro_id = r.centro_id
            WHERE au.id = pa.aula_id AND r.usuario_id = pa.profe_id
              AND r.rol = 'profe' AND r.deleted_at IS NULL)),
         count(*)
    INTO v_sin_rol, v_abiertas
    FROM public.profes_aulas pa
   WHERE pa.fecha_fin IS NULL AND pa.deleted_at IS NULL;
  IF v_sin_rol > 0 THEN
    RAISE EXCEPTION '% de % asignaciones abiertas sin rol profe vivo en su centro', v_sin_rol, v_abiertas;
  END IF;
  RAISE NOTICE 'guarda previa: motivos y cuerpos esperados; % asignaciones abiertas, todas con rol profe vivo', v_abiertas;
END
$guarda$;

-- ---- Dar de baja a una profe (temporal o salida) ----
CREATE FUNCTION public.dar_de_baja_profe(p_centro_id uuid, p_usuario_id uuid, p_motivo public.motivo_borrado)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fila uuid;
  v_cerradas int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'sin sesión' USING ERRCODE = '42501';
  END IF;
  -- es_admin(NULL) daría TRUE a cualquier persona de Dirección.
  IF p_centro_id IS NULL OR NOT public.es_admin(p_centro_id) THEN
    RAISE EXCEPTION 'solo Dirección da de baja al personal del centro' USING ERRCODE = '42501';
  END IF;
  IF p_motivo IS NULL OR p_motivo::text NOT IN ('baja_temporal', 'salida_centro') THEN
    RAISE EXCEPTION 'el motivo es baja_temporal o salida_centro' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_fila
    FROM public.roles_usuario
   WHERE centro_id = p_centro_id AND usuario_id = p_usuario_id
     AND rol = 'profe' AND deleted_at IS NULL
   FOR UPDATE;
  IF v_fila IS NULL THEN
    RAISE EXCEPTION 'no es personal activo de este centro' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.roles_usuario
     SET deleted_at = now(), deleted_reason = p_motivo
   WHERE id = v_fila;

  UPDATE public.profes_aulas pa
     SET fecha_fin = GREATEST(public.hoy_madrid(), pa.fecha_inicio)
    FROM public.aulas au
   WHERE au.id = pa.aula_id AND au.centro_id = p_centro_id
     AND pa.profe_id = p_usuario_id
     AND pa.fecha_fin IS NULL AND pa.deleted_at IS NULL;
  GET DIAGNOSTICS v_cerradas = ROW_COUNT;

  RETURN v_cerradas;
END
$$;

COMMENT ON FUNCTION public.dar_de_baja_profe(uuid, uuid, public.motivo_borrado) IS
  'Dirección da de baja a una profe del centro (baja_temporal o salida_centro): retira su rol y cierra sus aulas, en una transacción. Devuelve las asignaciones cerradas.';

-- ---- Reactivar a quien vuelve de una baja temporal ----
CREATE FUNCTION public.reactivar_profe(p_centro_id uuid, p_usuario_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_motivo text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'sin sesión' USING ERRCODE = '42501';
  END IF;
  IF p_centro_id IS NULL OR NOT public.es_admin(p_centro_id) THEN
    RAISE EXCEPTION 'solo Dirección reactiva al personal del centro' USING ERRCODE = '42501';
  END IF;

  SELECT deleted_reason::text INTO v_motivo
    FROM public.roles_usuario
   WHERE centro_id = p_centro_id AND usuario_id = p_usuario_id
     AND rol = 'profe' AND deleted_at IS NOT NULL
   FOR UPDATE;

  IF v_motivo = 'salida_centro' THEN
    RAISE EXCEPTION 'salió del centro: vuelve con una invitación' USING ERRCODE = '55000';
  END IF;
  IF v_motivo IS DISTINCT FROM 'baja_temporal' THEN
    RAISE EXCEPTION 'no está de baja temporal en este centro' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.roles_usuario
     SET deleted_at = NULL, deleted_reason = NULL
   WHERE centro_id = p_centro_id AND usuario_id = p_usuario_id AND rol = 'profe';
END
$$;

COMMENT ON FUNCTION public.reactivar_profe(uuid, uuid) IS
  'Dirección reactiva a una profe que vuelve de una baja temporal. Quien salió del centro vuelve con una invitación (55000). El aula se asigna aparte.';

REVOKE ALL ON FUNCTION public.dar_de_baja_profe(uuid, uuid, public.motivo_borrado) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reactivar_profe(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dar_de_baja_profe(uuid, uuid, public.motivo_borrado) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reactivar_profe(uuid, uuid) TO authenticated;

-- ---- Los helpers por aula exigen un rol profe vivo en el centro ----
-- Mismo cuerpo que en producción más `es_profe_en_centro`. CREATE OR REPLACE conserva los permisos.

CREATE OR REPLACE FUNCTION public.es_profe_de_aula(p_aula_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.es_profe_en_centro(privado.centro_de_aula(p_aula_id))
     AND EXISTS (
    SELECT 1 FROM public.profes_aulas pa
    WHERE pa.profe_id = auth.uid()
      AND pa.aula_id = p_aula_id
      AND pa.fecha_fin IS NULL AND pa.deleted_at IS NULL
      AND pa.curso_academico_id = public.curso_activo_de_centro(privado.centro_de_aula(p_aula_id))
  );
$function$;

CREATE OR REPLACE FUNCTION public.es_redactor_de_aula(p_aula_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.es_profe_en_centro(privado.centro_de_aula(p_aula_id))
     AND EXISTS (
    SELECT 1 FROM public.profes_aulas pa
    WHERE pa.profe_id = auth.uid()
      AND pa.aula_id = p_aula_id
      AND pa.fecha_fin IS NULL AND pa.deleted_at IS NULL
      AND pa.tipo_personal_aula IN ('coordinadora', 'profesora')
      AND pa.curso_academico_id = public.curso_activo_de_centro(privado.centro_de_aula(p_aula_id))
  );
$function$;

CREATE OR REPLACE FUNCTION public.es_profe_de_nino(p_nino_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.matriculas m
    JOIN public.profes_aulas pa
      ON pa.aula_id = m.aula_id
     AND pa.curso_academico_id = m.curso_academico_id
    WHERE m.nino_id = p_nino_id
      AND m.fecha_baja IS NULL AND m.deleted_at IS NULL AND m.estado = 'activa'
      AND pa.profe_id = auth.uid()
      AND pa.fecha_fin IS NULL AND pa.deleted_at IS NULL
  );
$function$;

CREATE OR REPLACE FUNCTION public.es_redactor_de_nino(p_nino_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.matriculas m
    JOIN public.profes_aulas pa
      ON pa.aula_id = m.aula_id
     AND pa.curso_academico_id = m.curso_academico_id
    WHERE m.nino_id = p_nino_id
      AND m.fecha_baja IS NULL AND m.deleted_at IS NULL AND m.estado = 'activa'
      AND pa.profe_id = auth.uid()
      AND pa.fecha_fin IS NULL AND pa.deleted_at IS NULL
      AND pa.tipo_personal_aula IN ('coordinadora', 'profesora')
      AND public.es_profe_en_centro(privado.centro_de_aula(pa.aula_id))
  );
$function$;

CREATE OR REPLACE FUNCTION public.usuario_es_audiencia_anuncio(p_anuncio_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a public.anuncios%ROWTYPE;
  v_usuario uuid := auth.uid();
BEGIN
  IF v_usuario IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO a FROM public.anuncios WHERE id = p_anuncio_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF public.es_admin(a.centro_id) THEN
    RETURN TRUE;
  END IF;

  IF a.autor_id = v_usuario THEN
    RETURN TRUE;
  END IF;

  IF a.ambito = 'aula' THEN
    IF privado.centro_de_aula(a.aula_id) IS DISTINCT FROM a.centro_id THEN
      RETURN FALSE;
    END IF;
    IF public.es_profe_de_aula(a.aula_id) THEN
      RETURN TRUE;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM public.matriculas m
      JOIN public.vinculos_familiares vf ON vf.nino_id = m.nino_id
      WHERE m.aula_id = a.aula_id
        AND m.fecha_baja IS NULL
        AND m.deleted_at IS NULL
        AND m.estado = 'activa'
        AND vf.usuario_id = v_usuario
        AND vf.deleted_at IS NULL
        AND COALESCE((vf.permisos ->> 'puede_recibir_mensajes')::boolean, false) = true
    );
  END IF;

  IF a.ambito = 'centro' THEN
    IF public.es_profe_en_centro(a.centro_id) AND EXISTS (
      SELECT 1
      FROM public.profes_aulas pa
      JOIN public.aulas au ON au.id = pa.aula_id
      WHERE pa.profe_id = v_usuario
        AND pa.fecha_fin IS NULL
        AND pa.deleted_at IS NULL
        AND au.centro_id = a.centro_id
    ) THEN
      RETURN TRUE;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM public.matriculas m
      JOIN public.aulas au ON au.id = m.aula_id
      JOIN public.vinculos_familiares vf ON vf.nino_id = m.nino_id
      WHERE au.centro_id = a.centro_id
        AND m.fecha_baja IS NULL
        AND m.deleted_at IS NULL
        AND m.estado = 'activa'
        AND vf.usuario_id = v_usuario
        AND vf.deleted_at IS NULL
        AND COALESCE((vf.permisos ->> 'puede_recibir_mensajes')::boolean, false) = true
    );
  END IF;

  RETURN FALSE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.usuario_es_audiencia_anuncio_row(p_centro_id uuid, p_autor_id uuid, p_ambito ambito_anuncio, p_aula_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_usuario uuid := auth.uid();
BEGIN
  IF v_usuario IS NULL THEN
    RETURN FALSE;
  END IF;

  IF public.es_admin(p_centro_id) THEN
    RETURN TRUE;
  END IF;

  IF p_autor_id = v_usuario THEN
    RETURN TRUE;
  END IF;

  IF p_ambito = 'aula' THEN
    IF privado.centro_de_aula(p_aula_id) IS DISTINCT FROM p_centro_id THEN
      RETURN FALSE;
    END IF;
    IF public.es_profe_de_aula(p_aula_id) THEN
      RETURN TRUE;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM public.matriculas m
      JOIN public.vinculos_familiares vf ON vf.nino_id = m.nino_id
      WHERE m.aula_id = p_aula_id
        AND m.fecha_baja IS NULL
        AND m.deleted_at IS NULL
        AND m.estado = 'activa'
        AND vf.usuario_id = v_usuario
        AND vf.deleted_at IS NULL
        AND COALESCE((vf.permisos ->> 'puede_recibir_mensajes')::boolean, false) = true
    );
  END IF;

  IF p_ambito = 'centro' THEN
    IF public.es_profe_en_centro(p_centro_id) AND EXISTS (
      SELECT 1
      FROM public.profes_aulas pa
      JOIN public.aulas au ON au.id = pa.aula_id
      WHERE pa.profe_id = v_usuario
        AND pa.fecha_fin IS NULL
        AND pa.deleted_at IS NULL
        AND au.centro_id = p_centro_id
    ) THEN
      RETURN TRUE;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM public.matriculas m
      JOIN public.aulas au ON au.id = m.aula_id
      JOIN public.vinculos_familiares vf ON vf.nino_id = m.nino_id
      WHERE au.centro_id = p_centro_id
        AND m.fecha_baja IS NULL
        AND m.deleted_at IS NULL
        AND m.estado = 'activa'
        AND vf.usuario_id = v_usuario
        AND vf.deleted_at IS NULL
        AND COALESCE((vf.permisos ->> 'puede_recibir_mensajes')::boolean, false) = true
    );
  END IF;

  RETURN FALSE;
END;
$function$;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  -- La lógica de este fichero (md5 normalizado), calculada en Postgres sobre los cuerpos creados.
  v_esperado constant jsonb := '{
    "es_profe_de_aula": "71873884f39dbc20dd924820b5b73e46",
    "es_profe_de_nino": "fc257914f14e7331705a4c6c3e8a52a9",
    "es_redactor_de_aula": "041b2862e39d890c4874f95bf1c05127",
    "es_redactor_de_nino": "75af6e52bd948617acbffa9bb6fc0626",
    "usuario_es_audiencia_anuncio": "887553efd81d2e2946cd294e7cee5819",
    "usuario_es_audiencia_anuncio_row": "1beadcd343cb5a9191da6d737cecc6f2"
  }'::jsonb;
  v_mal text;
  v_f text;
  v_sin text;
BEGIN
  SELECT string_agg(e.key || '=' || coalesce(a.md5, 'falta'), ', ')
    INTO v_mal
    FROM jsonb_each_text(v_esperado) e
    LEFT JOIN (
      SELECT p.proname AS f,
             md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) AS md5
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
    ) a ON a.f = e.key
   WHERE a.md5 IS DISTINCT FROM e.value;
  IF v_mal IS NOT NULL THEN
    RAISE EXCEPTION 'los helpers no quedaron como este fichero: %', v_mal;
  END IF;

  FOREACH v_f IN ARRAY ARRAY['public.dar_de_baja_profe(uuid, uuid, public.motivo_borrado)', 'public.reactivar_profe(uuid, uuid)'] LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_f::regprocedure) THEN
      RAISE EXCEPTION '% no es SECURITY DEFINER', v_f;
    END IF;
    IF (SELECT proconfig FROM pg_proc WHERE oid = v_f::regprocedure) IS DISTINCT FROM ARRAY['search_path=public'] THEN
      RAISE EXCEPTION '% sin search_path = public', v_f;
    END IF;
    IF has_function_privilege('anon', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION '% la puede ejecutar anon', v_f;
    END IF;
    IF NOT has_function_privilege('authenticated', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION '% no la puede ejecutar authenticated', v_f;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.oid IN ('public.dar_de_baja_profe(uuid, uuid, public.motivo_borrado)'::regprocedure,
                              'public.reactivar_profe(uuid, uuid)'::regprocedure)
                AND has_function_privilege('public', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'dar_de_baja_profe o reactivar_profe abiertas a PUBLIC';
  END IF;

  -- Los 6 helpers: siguen SECURITY DEFINER, con sus permisos, y piden el rol vivo.
  SELECT string_agg(p.oid::regprocedure::text, ', ')
    INTO v_sin
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('es_profe_de_aula', 'es_profe_de_nino', 'es_redactor_de_aula',
                       'es_redactor_de_nino', 'usuario_es_audiencia_anuncio',
                       'usuario_es_audiencia_anuncio_row')
     AND NOT (p.prosecdef
              AND p.prosrc LIKE '%public.es_profe_en_centro(%'
              AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
              AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'));
  IF v_sin IS NOT NULL THEN
    RAISE EXCEPTION 'helpers sin el rol vivo o con permisos cambiados: %', v_sin;
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('es_profe_de_aula', 'es_profe_de_nino', 'es_redactor_de_aula',
                           'es_redactor_de_nino', 'usuario_es_audiencia_anuncio',
                           'usuario_es_audiencia_anuncio_row')) <> 6 THEN
    RAISE EXCEPTION 'no son 6 helpers: hay una sobrecarga nueva';
  END IF;
  RAISE NOTICE 'guarda posterior: las 2 RPC solo authenticated; los 6 helpers piden el rol profe vivo';
END
$guarda$;
