-- =============================================================================
-- FEAT — Las normas de régimen interno, fuera del catálogo de autorizaciones (fase 4, 4b-3; 2026-11-06)
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/altas-serie.md, «Decisiones (2026-11-06)», decisión 2 (opción A, de Jose). Las normas
-- son un documento del centro (fase 3) y se firman en el alta desde el 4b-1/4b-2; el tipo
-- `reglas_regimen_interno` de las autorizaciones era el otro camino para firmar lo mismo. Jose: «dos
-- caminos para firmar lo mismo significa que dentro de un año nadie sabrá cuál vale».
--
-- Postgres no quita un valor de un enum: se renombra el tipo viejo, se crea el nuevo sin
-- `reglas_regimen_interno`, se pasa la columna y se rehace lo que lo nombra, que es, medido en
-- producción el 2026-11-06 (catálogo: pg_attribute, pg_proc, pg_policies, pg_constraint, pg_depend):
--   · la columna `autorizaciones.tipo` (y su índice `idx_autorizaciones_plantilla_unica`, que se rehace
--     solo al cambiar el tipo de la columna);
--   · el CHECK `autorizaciones_tipo_coherencia`;
--   · las funciones con el tipo en su firma: `privado.autorizacion_plantilla_valida` y
--     `usuario_es_audiencia_autorizacion_row` (cuerpos idénticos; ninguna otra función las llama);
--   · las políticas que leen la columna: `autorizaciones_insert`, `_select` y `_update`.
-- Ninguna vista, ninguna otra columna, ningún cuerpo de función nombra el valor. Filas del tipo en
-- producción: 0 (ninguna autorización de ningún tipo). La guarda previa lo vuelve a contar y aborta con
-- el número si hay alguna: no se borra nada a ciegas.
--
-- La equivalencia, medida y no supuesta: la guarda previa guarda el texto vivo del CHECK y de las
-- políticas y el md5 normalizado de las dos funciones; la posterior exige que el CHECK y las políticas
-- sean ese texto menos el literal del valor quitado, y los cuerpos, idénticos. Se generó con un guion
-- desde las definiciones vivas, no reescrito a mano.
--
-- Sin orden con el despliegue respecto a la app: la app de antes ya no ofrece el tipo en el alta
-- (#511), y lo que aún lo ofrecía en el catálogo de autorizaciones se quita en este mismo PR. ORDEN:
-- mergear, esperar el despliegue, aplicar (la app de antes podría ofrecer el tipo y daría error al
-- crearlo). La aplica el responsable por SQL Editor, copiando el fichero. Tras aplicar: registrar en
-- supabase_migrations.schema_migrations. Regenerar `src/types/database.ts` (va ya en el PR).
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF enum_range(NULL::public.tipo_autorizacion)::text IS DISTINCT FROM
     '{salida,medicacion,recogida,reglas_regimen_interno,autorizacion_imagenes}' THEN
    RAISE EXCEPTION 'tipo_autorizacion no es el de antes: %', enum_range(NULL::public.tipo_autorizacion)::text;
  END IF;
  IF (SELECT count(*) FROM public.autorizaciones WHERE tipo::text = 'reglas_regimen_interno') > 0 THEN
    RAISE EXCEPTION 'hay % autorizaciones de reglas_regimen_interno (% con firmas): no se borran a ciegas',
      (SELECT count(*) FROM public.autorizaciones WHERE tipo::text = 'reglas_regimen_interno'),
      (SELECT count(DISTINCT a.id) FROM public.autorizaciones a JOIN public.firmas_autorizacion f ON f.autorizacion_id = a.id
        WHERE a.tipo::text = 'reglas_regimen_interno');
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('privado.autorizacion_plantilla_valida(uuid,uuid,tipo_autorizacion)');
  IF v_md5 IS DISTINCT FROM '8f06d18c112a4d0257548607f6210496' THEN
    RAISE EXCEPTION 'privado.autorizacion_plantilla_valida no es la de antes: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.usuario_es_audiencia_autorizacion_row(uuid,tipo_autorizacion,boolean,autorizacion_ambito,uuid,uuid,uuid)');
  IF v_md5 IS DISTINCT FROM '09675dd2ec2202f202618de24b495de1' THEN
    RAISE EXCEPTION 'usuario_es_audiencia_autorizacion_row no es la de antes: %', coalesce(v_md5, 'falta');
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'autorizaciones') <> 4 THEN
    RAISE EXCEPTION 'autorizaciones no tiene las 4 políticas de antes';
  END IF;
  RAISE NOTICE 'guarda previa: % autorizaciones en total, 0 de reglas_regimen_interno; funciones y políticas, las de antes',
    (SELECT count(*) FROM public.autorizaciones);
END
$guarda$;

-- Lo de antes, para compararlo después.
CREATE TEMP TABLE _4b3_antes AS
SELECT 'check' AS que, pg_get_constraintdef(oid) AS texto FROM pg_constraint
 WHERE conrelid = 'public.autorizaciones'::regclass AND conname = 'autorizaciones_tipo_coherencia'
UNION ALL SELECT policyname || ':' || cmd || ':qual', coalesce(qual, '-') FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'autorizaciones'
UNION ALL SELECT policyname || ':' || cmd || ':wc', coalesce(with_check, '-') FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'autorizaciones'
UNION ALL SELECT 'f:' || p.proname, md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
  FROM pg_proc p WHERE p.proname IN ('autorizacion_plantilla_valida', 'usuario_es_audiencia_autorizacion_row');

-- ---- 1. Lo que nombra el tipo, fuera ----
DROP POLICY autorizaciones_insert ON public.autorizaciones;
DROP POLICY autorizaciones_select ON public.autorizaciones;
DROP POLICY autorizaciones_update ON public.autorizaciones;
ALTER TABLE public.autorizaciones DROP CONSTRAINT autorizaciones_tipo_coherencia;
DROP FUNCTION privado.autorizacion_plantilla_valida(uuid, uuid, public.tipo_autorizacion);
DROP FUNCTION public.usuario_es_audiencia_autorizacion_row(uuid, public.tipo_autorizacion, boolean, public.autorizacion_ambito, uuid, uuid, uuid);

-- ---- 2. El tipo nuevo, sin reglas_regimen_interno ----
ALTER TYPE public.tipo_autorizacion RENAME TO tipo_autorizacion_4b3_viejo;
CREATE TYPE public.tipo_autorizacion AS ENUM ('salida', 'medicacion', 'recogida', 'autorizacion_imagenes');
ALTER TABLE public.autorizaciones
  ALTER COLUMN tipo TYPE public.tipo_autorizacion USING tipo::text::public.tipo_autorizacion;
-- Si algo lo nombrara todavía, esto falla.
DROP TYPE public.tipo_autorizacion_4b3_viejo;

-- ---- 3. Lo de antes, otra vez, sin el valor ----
ALTER TABLE public.autorizaciones ADD CONSTRAINT autorizaciones_tipo_coherencia
  CHECK ((((es_plantilla = true) AND (tipo = ANY (ARRAY['autorizacion_imagenes'::tipo_autorizacion, 'recogida'::tipo_autorizacion, 'medicacion'::tipo_autorizacion])) AND (evento_id IS NULL) AND (nino_id IS NULL) AND (aula_id IS NULL) AND (plantilla_id IS NULL) AND (ambito IS NULL)) OR ((es_plantilla = false) AND (tipo = 'salida'::tipo_autorizacion) AND (evento_id IS NOT NULL) AND (nino_id IS NULL) AND (aula_id IS NULL) AND (plantilla_id IS NULL) AND (ambito IS NULL)) OR ((es_plantilla = false) AND (tipo = ANY (ARRAY['autorizacion_imagenes'::tipo_autorizacion])) AND (plantilla_id IS NOT NULL) AND (evento_id IS NULL) AND (ambito IS NOT NULL) AND (((ambito = 'nino'::autorizacion_ambito) AND (nino_id IS NOT NULL) AND (aula_id IS NULL)) OR ((ambito = 'aula'::autorizacion_ambito) AND (aula_id IS NOT NULL) AND (nino_id IS NULL)) OR ((ambito = 'centro'::autorizacion_ambito) AND (nino_id IS NULL) AND (aula_id IS NULL)))) OR ((es_plantilla = false) AND (tipo = ANY (ARRAY['recogida'::tipo_autorizacion, 'medicacion'::tipo_autorizacion])) AND (plantilla_id IS NOT NULL) AND (ambito = 'nino'::autorizacion_ambito) AND (nino_id IS NOT NULL) AND (evento_id IS NULL) AND (aula_id IS NULL))));

CREATE FUNCTION privado.autorizacion_plantilla_valida(p_plantilla_id uuid, p_centro_id uuid, p_tipo tipo_autorizacion)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.autorizaciones p
    WHERE p.id = p_plantilla_id
      AND p.es_plantilla = true
      AND p.centro_id = p_centro_id
      AND p.tipo = p_tipo
      AND p.estado = 'publicada'
      AND p.texto_definitivo = true
  );
$function$;
REVOKE ALL ON FUNCTION privado.autorizacion_plantilla_valida(uuid, uuid, public.tipo_autorizacion) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION privado.autorizacion_plantilla_valida(uuid, uuid, public.tipo_autorizacion) TO authenticated, service_role;

CREATE FUNCTION public.usuario_es_audiencia_autorizacion_row(p_centro_id uuid, p_tipo tipo_autorizacion, p_es_plantilla boolean, p_ambito autorizacion_ambito, p_evento_id uuid, p_nino_id uuid, p_aula_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE e public.eventos%ROWTYPE;
BEGIN
  IF public.es_admin(p_centro_id) THEN
    RETURN TRUE;
  END IF;
  -- Catálogo: el formato estándar es legible por cualquier miembro del centro
  -- (el tutor necesita verlo para iniciar una recogida/medicación — patrón B).
  IF p_es_plantilla THEN
    RETURN public.pertenece_a_centro(p_centro_id);
  END IF;
  -- salida: delega en la audiencia del evento (lee `eventos`, otra tabla → sin MVCC).
  IF p_tipo = 'salida' THEN
    SELECT * INTO e FROM public.eventos WHERE id = p_evento_id;
    IF NOT FOUND THEN RETURN FALSE; END IF;
    RETURN public.usuario_es_audiencia_evento_row(e.centro_id, e.ambito, e.aula_id, e.nino_id);
  END IF;
  -- instancias A / B2: por ámbito (espejo de la audiencia de eventos F7).
  IF p_ambito = 'nino' THEN
    RETURN public.es_profe_de_nino(p_nino_id) OR public.es_tutor_de(p_nino_id);
  ELSIF p_ambito = 'aula' THEN
    RETURN public.es_profe_de_aula(p_aula_id) OR public.es_tutor_en_aula(p_aula_id);
  ELSIF p_ambito = 'centro' THEN
    RETURN public.pertenece_a_centro(p_centro_id);
  END IF;
  -- legacy (ambito NULL, nino_id seteado, tipo por-niño del modelo viejo).
  IF p_nino_id IS NOT NULL THEN
    RETURN public.es_profe_de_nino(p_nino_id) OR public.es_tutor_de(p_nino_id);
  END IF;
  RETURN FALSE;
END;
$function$;
REVOKE ALL ON FUNCTION public.usuario_es_audiencia_autorizacion_row(uuid, public.tipo_autorizacion, boolean, public.autorizacion_ambito, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usuario_es_audiencia_autorizacion_row(uuid, public.tipo_autorizacion, boolean, public.autorizacion_ambito, uuid, uuid, uuid) TO authenticated, service_role;

CREATE POLICY autorizaciones_insert ON public.autorizaciones FOR INSERT TO authenticated
  WITH CHECK ((creado_por = auth.uid()) AND (privado.es_responsable(centro_id) OR (es_admin(centro_id) AND (NOT (es_plantilla AND (tipo = ANY (ARRAY['autorizacion_imagenes'::tipo_autorizacion]))))) OR ((tipo = 'salida'::tipo_autorizacion) AND es_profe_de_evento(evento_id) AND (privado.centro_de_evento(evento_id) = centro_id)) OR ((es_plantilla = false) AND (tipo = ANY (ARRAY['recogida'::tipo_autorizacion, 'medicacion'::tipo_autorizacion, 'autorizacion_imagenes'::tipo_autorizacion])) AND (ambito = 'nino'::autorizacion_ambito) AND (nino_id IS NOT NULL) AND (plantilla_id IS NOT NULL) AND tiene_permiso_sobre(nino_id, 'puede_firmar_autorizaciones'::text) AND privado.autorizacion_plantilla_valida(plantilla_id, centro_id, tipo))));
CREATE POLICY autorizaciones_select ON public.autorizaciones FOR SELECT TO authenticated
  USING (usuario_es_audiencia_autorizacion_row(centro_id, tipo, es_plantilla, ambito, evento_id, nino_id, aula_id));
CREATE POLICY autorizaciones_update ON public.autorizaciones FOR UPDATE TO authenticated
  USING (privado.es_responsable(centro_id) OR ((NOT (es_plantilla AND (tipo = ANY (ARRAY['autorizacion_imagenes'::tipo_autorizacion])))) AND ((creado_por = auth.uid()) OR es_admin(centro_id))))
  WITH CHECK (privado.es_responsable(centro_id) OR ((NOT (es_plantilla AND (tipo = ANY (ARRAY['autorizacion_imagenes'::tipo_autorizacion])))) AND ((creado_por = auth.uid()) OR es_admin(centro_id))));

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  r record;
  v_ahora text;
  v_quitado constant text := '''reglas_regimen_interno''::tipo_autorizacion, ';
  v_n int := 0;
BEGIN
  IF enum_range(NULL::public.tipo_autorizacion)::text IS DISTINCT FROM '{salida,medicacion,recogida,autorizacion_imagenes}' THEN
    RAISE EXCEPTION 'tipo_autorizacion nuevo: %', enum_range(NULL::public.tipo_autorizacion)::text;
  END IF;
  IF to_regtype('public.tipo_autorizacion_4b3_viejo') IS NOT NULL THEN
    RAISE EXCEPTION 'el tipo viejo sigue';
  END IF;
  -- Cada cosa de antes, ahora: el mismo texto menos el valor quitado (las funciones, idénticas).
  FOR r IN SELECT * FROM _4b3_antes LOOP
    IF r.que = 'check' THEN
      SELECT pg_get_constraintdef(oid) INTO v_ahora FROM pg_constraint
       WHERE conrelid = 'public.autorizaciones'::regclass AND conname = 'autorizaciones_tipo_coherencia';
    ELSIF r.que LIKE 'f:%' THEN
      SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
        INTO v_ahora FROM pg_proc p WHERE p.proname = substr(r.que, 3);
    ELSE
      SELECT CASE WHEN r.que LIKE '%:qual' THEN coalesce(qual, '-') ELSE coalesce(with_check, '-') END
        INTO v_ahora FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'autorizaciones'
         AND policyname || ':' || cmd = regexp_replace(r.que, ':(qual|wc)$', '');
    END IF;
    IF v_ahora IS DISTINCT FROM replace(r.texto, v_quitado, '') THEN
      RAISE EXCEPTION '% no es lo de antes sin el valor: antes %, ahora %', r.que, r.texto, coalesce(v_ahora, 'falta');
    END IF;
    v_n := v_n + 1;
  END LOOP;
  IF v_n <> 11 THEN
    RAISE EXCEPTION 'se compararon % cosas, y eran 11 (1 CHECK, 4 políticas × 2, 2 funciones)', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE coalesce(qual, '') || coalesce(with_check, '') LIKE '%reglas_regimen_interno%')
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE pg_get_constraintdef(oid) LIKE '%reglas_regimen_interno%')
     OR EXISTS (SELECT 1 FROM pg_proc WHERE prosrc LIKE '%reglas_regimen_interno%') THEN
    RAISE EXCEPTION 'algo sigue nombrando reglas_regimen_interno';
  END IF;
  IF NOT has_function_privilege('authenticated', 'privado.autorizacion_plantilla_valida(uuid, uuid, public.tipo_autorizacion)', 'EXECUTE')
     OR has_function_privilege('anon', 'privado.autorizacion_plantilla_valida(uuid, uuid, public.tipo_autorizacion)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.usuario_es_audiencia_autorizacion_row(uuid, public.tipo_autorizacion, boolean, public.autorizacion_ambito, uuid, uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.usuario_es_audiencia_autorizacion_row(uuid, public.tipo_autorizacion, boolean, public.autorizacion_ambito, uuid, uuid, uuid)', 'EXECUTE')
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'privado.autorizacion_plantilla_valida(uuid, uuid, public.tipo_autorizacion)'::regprocedure)
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.usuario_es_audiencia_autorizacion_row(uuid, public.tipo_autorizacion, boolean, public.autorizacion_ambito, uuid, uuid, uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'las funciones no son SECURITY DEFINER para authenticated y cerradas a anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'autorizaciones'
                AND roles <> '{authenticated}') THEN
    RAISE EXCEPTION 'una política de autorizaciones no es TO authenticated';
  END IF;
  RAISE NOTICE 'guarda posterior: tipo_autorizacion sin reglas_regimen_interno; % cosas comparadas con las de antes', v_n;
END
$guarda$;

DROP TABLE _4b3_antes;
