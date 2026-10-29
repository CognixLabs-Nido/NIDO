-- =============================================================================
-- FEAT — Retención (F11-B, punto 6, PR-8, primera pieza): la retención por procedimiento abierto
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/retencion-plazos.md. La destrucción al vencer no se deshace, y un requerimiento
-- (un juez, Hacienda, una reclamación) puede llegar el último mes del plazo. Antes de construir la
-- destrucción, el freno. Decisiones de Jose (2026-10-29):
--
--   · La titular del centro (ni la directora, ni la profe, ni el superusuario) retiene a un sujeto,
--     un niño o un tutor, con un motivo escrito (tipo y texto). Mientras está retenido no se
--     destruye nada suyo: del niño, su expediente, sus firmas y lo fiscal de su familia; del tutor,
--     su cuenta, sus firmas y consentimientos y lo fiscal de sus familias.
--   · Quitarla pide también un motivo. Queda registrado quién la puso y quién la quitó, cuándo y
--     por qué: la propia fila es el registro, y una retención nueva es una fila nueva.
--   · Se pone desde «Datos bloqueados», en un listado con TODOS los sujetos del centro (los
--     purgados y los que algún día se destruirán, sin límite de plazo), con filtro por clase,
--     búsqueda por nombre y selección múltiple para poner o quitar a varios de golpe.
--
-- Hoy solo hay una destrucción por plazo que frenar: la purga del expediente del niño
-- (20261204120000). Las demás (las firmas, la cuenta del tutor, lo fiscal) llegan en las piezas
-- siguientes y miran `privado.retenido` desde el principio.
--
-- La aplica el responsable por SQL Editor. Sin orden obligado con el despliegue: no revoca nada
-- de lo que usa main. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  r     record;
BEGIN
  IF to_regclass('public.retenciones') IS NOT NULL THEN
    RAISE EXCEPTION 'ya aplicada: public.retenciones existe';
  END IF;
  IF to_regclass('public.accesos_datos_bloqueados') IS NULL
     OR to_regprocedure('privado.es_titular(uuid)') IS NULL THEN
    RAISE EXCEPTION 'falta 20261205120000 (el bloqueo): esta va detrás';
  END IF;

  -- Lo que se reescribe es lo que hay, tal como quedó.
  FOR r IN SELECT * FROM (VALUES
      ('public.expedientes_vencidos(integer)', 'd78dbed8ed4c8e15ec34b51602738dcd', '20261204120000'),
      ('public.purgar_expediente_nino(uuid,integer)', '1f95d9e4b0f54dde5c58261f6c5fe003',
       '20261204120000')
    ) AS t(f, md5, mig)
  LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f);
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION '% no es la de %: %', r.f, r.mig, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;

  RAISE NOTICE 'guarda previa: % niños de baja, % purgados',
    (SELECT count(*) FROM public.ninos WHERE deleted_reason = 'baja_nino'),
    (SELECT count(*) FROM public.ninos WHERE deleted_reason = 'purga_rgpd');
END
$guarda$;

-- ---- 1. La tabla ----
-- Sin políticas ni privilegios para las sesiones: se escribe y se lee por función. No entra en
-- audit_log: el motivo es texto libre y puede llevar nombres. El sujeto no lleva FK: la retención se
-- destruye con lo que retiene, cuando se destruya, y no antes.
CREATE TABLE public.retenciones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id      uuid NOT NULL REFERENCES public.centros (id) ON DELETE CASCADE,
  sujeto_tipo    public.olvido_sujeto_tipo NOT NULL,
  sujeto_id      uuid NOT NULL,
  motivo_tipo    text NOT NULL CHECK (motivo_tipo IN ('agencia_tributaria', 'juzgado', 'reclamacion',
                                                      'proteccion_datos', 'otro')),
  motivo         text NOT NULL CHECK (char_length(btrim(motivo)) BETWEEN 10 AND 1000),
  puesta_por     uuid REFERENCES public.usuarios (id) ON DELETE SET NULL,
  puesta_en      timestamptz NOT NULL DEFAULT now(),
  quitada_por    uuid REFERENCES public.usuarios (id) ON DELETE SET NULL,
  quitada_motivo text CHECK (char_length(btrim(quitada_motivo)) BETWEEN 10 AND 1000),
  quitada_en     timestamptz,
  CONSTRAINT retenciones_quitada_entera CHECK ((quitada_en IS NULL) = (quitada_motivo IS NULL))
);
COMMENT ON TABLE public.retenciones IS
  'Sujetos cuya destrucción por plazo espera a un procedimiento abierto (20261206120000). Solo por función.';
-- Una sola retención viva por sujeto y centro.
CREATE UNIQUE INDEX uq_retenciones_viva
  ON public.retenciones (centro_id, sujeto_tipo, sujeto_id) WHERE quitada_en IS NULL;
CREATE INDEX idx_retenciones_centro ON public.retenciones (centro_id, puesta_en DESC);
ALTER TABLE public.retenciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.retenciones FROM PUBLIC, anon, authenticated;

-- ---- 2. Los predicados ----

-- ¿Está retenido este sujeto en este centro? Lo miran las destrucciones por plazo.
CREATE FUNCTION privado.retenido(p_centro_id uuid, p_sujeto_tipo text, p_sujeto_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.retenciones r
                  WHERE r.centro_id = p_centro_id AND r.sujeto_tipo::text = p_sujeto_tipo
                    AND r.sujeto_id = p_sujeto_id AND r.quitada_en IS NULL);
$function$;
REVOKE ALL ON FUNCTION privado.retenido(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION privado.retenido(uuid, text, uuid) TO service_role;

-- ¿Es este sujeto del centro? El niño, si es del centro; el tutor, si está en una de sus familias
-- o tiene un vínculo con uno de sus niños.
CREATE FUNCTION privado.sujeto_del_centro(p_centro_id uuid, p_sujeto_tipo text, p_sujeto_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT CASE p_sujeto_tipo
    WHEN 'nino' THEN EXISTS (SELECT 1 FROM public.ninos n
                              WHERE n.id = p_sujeto_id AND n.centro_id = p_centro_id)
    WHEN 'usuario' THEN
      EXISTS (SELECT 1 FROM public.familia_tutores ft
               WHERE ft.usuario_id = p_sujeto_id AND ft.centro_id = p_centro_id)
      OR EXISTS (SELECT 1 FROM public.vinculos_familiares v JOIN public.ninos n ON n.id = v.nino_id
                  WHERE v.usuario_id = p_sujeto_id AND n.centro_id = p_centro_id)
    ELSE false
  END;
$function$;
REVOKE ALL ON FUNCTION privado.sujeto_del_centro(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- ---- 3. El listado, para la titular ----
-- Todos los sujetos del centro: cada niño (activo, de baja o purgado) y cada tutor (de sus familias
-- o con vínculo con sus niños), con lo que ya se ve de ellos para encontrarlos: el nombre (el de un
-- purgado es «[borrado]»), la familia y la clase (la del tutor, la de su hijo más reciente). `desde`
-- es la baja del niño o su purga. No enseña nada bloqueado.
CREATE FUNCTION public.sujetos_retencion(p_centro_id uuid)
RETURNS TABLE (sujeto_tipo text, sujeto_id uuid, nombre text, familia text, aula text,
               estado text, desde date, retenido_desde timestamptz, motivo_tipo text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL OR p_centro_id IS NULL OR NOT privado.es_titular(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado a retener en este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  WITH ninos_c AS (
    SELECT n.id, btrim(concat_ws(' ', n.nombre, n.apellidos)) AS nombre, n.familia_id,
           n.deleted_at, n.deleted_reason, n.purgado_en,
           (SELECT a.nombre FROM public.matriculas m
              JOIN public.aulas a ON a.id = m.aula_id
              JOIN public.cursos_academicos ca ON ca.id = m.curso_academico_id
             WHERE m.nino_id = n.id AND m.deleted_at IS NULL
             ORDER BY ca.fecha_inicio DESC, m.fecha_alta DESC LIMIT 1) AS aula
      FROM public.ninos n
     WHERE n.centro_id = p_centro_id
  ),
  tutores_c AS (
    SELECT ft.usuario_id AS id, ft.familia_id FROM public.familia_tutores ft
     WHERE ft.centro_id = p_centro_id AND ft.usuario_id IS NOT NULL
    UNION
    SELECT v.usuario_id, n.familia_id FROM public.vinculos_familiares v
      JOIN public.ninos n ON n.id = v.nino_id
     WHERE n.centro_id = p_centro_id
       AND v.tipo_vinculo IN ('tutor_legal_principal', 'tutor_legal_secundario')
  )
  SELECT 'nino'::text, n.id, n.nombre, f.etiqueta, n.aula,
         CASE WHEN n.deleted_at IS NULL THEN 'activo'
              WHEN n.deleted_reason = 'purga_rgpd' THEN 'purgado'
              ELSE 'baja' END,
         CASE WHEN n.deleted_reason = 'purga_rgpd' THEN (n.purgado_en AT TIME ZONE 'Europe/Madrid')::date
              WHEN n.deleted_at IS NOT NULL
                THEN COALESCE(privado.fecha_baja_nino(n.id), (n.deleted_at AT TIME ZONE 'Europe/Madrid')::date)
         END,
         r.puesta_en, r.motivo_tipo
    FROM ninos_c n
    LEFT JOIN public.familias f ON f.id = n.familia_id
    LEFT JOIN public.retenciones r
      ON r.centro_id = p_centro_id AND r.sujeto_tipo = 'nino' AND r.sujeto_id = n.id
     AND r.quitada_en IS NULL
  UNION ALL
  SELECT 'usuario'::text, u.id, u.nombre_completo,
         (SELECT string_agg(DISTINCT f.etiqueta, ', ') FROM tutores_c t JOIN public.familias f ON f.id = t.familia_id
           WHERE t.id = u.id),
         (SELECT n.aula FROM ninos_c n
           WHERE n.familia_id IN (SELECT t.familia_id FROM tutores_c t WHERE t.id = u.id)
              OR n.id IN (SELECT v.nino_id FROM public.vinculos_familiares v WHERE v.usuario_id = u.id)
           ORDER BY n.deleted_at DESC NULLS FIRST LIMIT 1),
         CASE WHEN privado.usuario_olvidado_en(u.id, p_centro_id) THEN 'purgado'
              WHEN EXISTS (SELECT 1 FROM ninos_c n
                            WHERE n.deleted_at IS NULL
                              AND (n.familia_id IN (SELECT t.familia_id FROM tutores_c t WHERE t.id = u.id)
                                   OR n.id IN (SELECT v.nino_id FROM public.vinculos_familiares v
                                                WHERE v.usuario_id = u.id))) THEN 'activo'
              ELSE 'baja' END,
         CASE WHEN privado.usuario_olvidado_en(u.id, p_centro_id)
              THEN privado.usuario_olvidado_desde(u.id, p_centro_id) END,
         r.puesta_en, r.motivo_tipo
    FROM (SELECT DISTINCT t.id FROM tutores_c t) tu
    JOIN public.usuarios u ON u.id = tu.id
    LEFT JOIN public.retenciones r
      ON r.centro_id = p_centro_id AND r.sujeto_tipo = 'usuario' AND r.sujeto_id = u.id
     AND r.quitada_en IS NULL
   ORDER BY 1, 3, 2;
END;
$function$;
REVOKE ALL ON FUNCTION public.sujetos_retencion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sujetos_retencion(uuid) TO authenticated;

-- ---- 4. Poner y quitar ----
-- `p_sujetos`: [{"tipo": "nino"|"usuario", "id": uuid}, …], de 1 a 1000. Todo o nada: un sujeto
-- que no es del centro tumba la llamada entera. 42501 a quien no es la titular; 22023 sin motivo
-- válido (HINT motivo) o con la lista mal (HINT sujetos). Devuelve cuántas se han puesto o quitado:
-- poner a uno ya retenido, o quitar a uno que no lo está, no cuenta y no falla.

CREATE FUNCTION privado.retencion_lista(p_centro_id uuid, p_sujetos jsonb)
RETURNS TABLE (tipo text, id uuid)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_n integer;
BEGIN
  IF p_sujetos IS NULL OR jsonb_typeof(p_sujetos) <> 'array' THEN
    RAISE EXCEPTION 'la lista de sujetos no es válida' USING ERRCODE = 'invalid_parameter_value', HINT = 'sujetos';
  END IF;
  v_n := jsonb_array_length(p_sujetos);
  IF v_n NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'hacen falta de 1 a 1000 sujetos' USING ERRCODE = 'invalid_parameter_value', HINT = 'sujetos';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_sujetos) e
              WHERE jsonb_typeof(e) <> 'object'
                 OR e ->> 'tipo' IS NULL OR e ->> 'tipo' NOT IN ('nino', 'usuario')
                 OR e ->> 'id' IS NULL
                 OR e ->> 'id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') THEN
    RAISE EXCEPTION 'la lista de sujetos no es válida' USING ERRCODE = 'invalid_parameter_value', HINT = 'sujetos';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_sujetos) e
              WHERE NOT privado.sujeto_del_centro(p_centro_id, e ->> 'tipo', (e ->> 'id')::uuid)) THEN
    RAISE EXCEPTION 'algún sujeto no es de este centro' USING ERRCODE = 'invalid_parameter_value', HINT = 'sujetos';
  END IF;
  RETURN QUERY SELECT DISTINCT e ->> 'tipo', (e ->> 'id')::uuid FROM jsonb_array_elements(p_sujetos) e;
END;
$function$;
REVOKE ALL ON FUNCTION privado.retencion_lista(uuid, jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.poner_retencion(p_centro_id uuid, p_sujetos jsonb, p_motivo_tipo text, p_motivo text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_n   integer;
BEGIN
  IF v_uid IS NULL OR p_centro_id IS NULL OR NOT privado.es_titular(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado a retener en este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_motivo_tipo IS NULL OR p_motivo_tipo NOT IN ('agencia_tributaria', 'juzgado', 'reclamacion',
                                                    'proteccion_datos', 'otro')
     OR p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'hace falta un motivo (de 10 a 1000 caracteres) y su tipo'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'motivo';
  END IF;

  INSERT INTO public.retenciones (centro_id, sujeto_tipo, sujeto_id, motivo_tipo, motivo, puesta_por)
  SELECT p_centro_id, l.tipo::public.olvido_sujeto_tipo, l.id, p_motivo_tipo, btrim(p_motivo), v_uid
    FROM privado.retencion_lista(p_centro_id, p_sujetos) l
  ON CONFLICT (centro_id, sujeto_tipo, sujeto_id) WHERE quitada_en IS NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.poner_retencion(uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.poner_retencion(uuid, jsonb, text, text) TO authenticated;

CREATE FUNCTION public.quitar_retencion(p_centro_id uuid, p_sujetos jsonb, p_motivo text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_n   integer;
BEGIN
  IF v_uid IS NULL OR p_centro_id IS NULL OR NOT privado.es_titular(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado a retener en este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'hace falta un motivo (de 10 a 1000 caracteres)'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'motivo';
  END IF;

  UPDATE public.retenciones r
     SET quitada_por = v_uid, quitada_motivo = btrim(p_motivo), quitada_en = now()
    FROM privado.retencion_lista(p_centro_id, p_sujetos) l
   WHERE r.centro_id = p_centro_id AND r.sujeto_tipo::text = l.tipo AND r.sujeto_id = l.id
     AND r.quitada_en IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.quitar_retencion(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quitar_retencion(uuid, jsonb, text) TO authenticated;

-- El registro del centro, para la titular: cada retención con quién la puso y quién la quitó,
-- cuándo y por qué. La más reciente (puesta o quitada) primero.
CREATE FUNCTION public.retenciones_centro(p_centro_id uuid)
RETURNS TABLE (sujeto_tipo text, sujeto_id uuid, sujeto_nombre text, motivo_tipo text,
               motivo text, puesta_en timestamptz, puesta_por_nombre text,
               quitada_en timestamptz, quitada_por_nombre text, quitada_motivo text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL OR p_centro_id IS NULL OR NOT privado.es_titular(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado a retener en este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT r.sujeto_tipo::text, r.sujeto_id,
         CASE r.sujeto_tipo
           WHEN 'nino' THEN (SELECT btrim(concat_ws(' ', n.nombre, n.apellidos)) FROM public.ninos n
                              WHERE n.id = r.sujeto_id)
           ELSE (SELECT u.nombre_completo FROM public.usuarios u WHERE u.id = r.sujeto_id)
         END,
         r.motivo_tipo, r.motivo, r.puesta_en, up.nombre_completo, r.quitada_en,
         uq.nombre_completo, r.quitada_motivo
    FROM public.retenciones r
    LEFT JOIN public.usuarios up ON up.id = r.puesta_por
    LEFT JOIN public.usuarios uq ON uq.id = r.quitada_por
   WHERE r.centro_id = p_centro_id
   ORDER BY GREATEST(r.puesta_en, COALESCE(r.quitada_en, r.puesta_en)) DESC, r.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.retenciones_centro(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retenciones_centro(uuid) TO authenticated;

-- ---- 5. La purga del expediente espera a la retención ----
-- Cada una es la de producción (pg_get_functiondef) con su cambio marcado «Retención (PR-8)».

CREATE OR REPLACE FUNCTION public.expedientes_vencidos(p_anios integer)
 RETURNS TABLE(nino_id uuid, centro_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_anios IS NULL OR p_anios < 1 THEN
    RAISE EXCEPTION 'plazo del expediente no válido' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
  SELECT n.id, n.centro_id FROM public.ninos n
   WHERE n.deleted_reason = 'baja_nino' AND privado.expediente_vencido(n.id, p_anios)
     -- Retención (PR-8): el retenido espera.
     AND NOT privado.retenido(n.centro_id, 'nino', n.id)
   ORDER BY n.deleted_at, n.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.purgar_expediente_nino(p_nino_id uuid, p_anios integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro uuid;
BEGIN
  IF p_anios IS NULL OR p_anios < 1 THEN
    RAISE EXCEPTION 'plazo del expediente no válido' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT centro_id INTO v_centro FROM public.ninos
   WHERE id = p_nino_id AND deleted_reason = 'baja_nino' FOR UPDATE;
  IF NOT FOUND OR NOT privado.expediente_vencido(p_nino_id, p_anios) THEN
    RETURN false;
  END IF;
  -- Retención (PR-8): se vuelve a mirar en el punto de la purga; la lista pudo quedarse vieja.
  IF privado.retenido(v_centro, 'nino', p_nino_id) THEN
    RETURN false;
  END IF;

  PERFORM set_config('app.audit_actor', 'system:purgar_expediente_vencido', true);
  PERFORM privado.purgar_nino(p_nino_id);
  PERFORM set_config('app.audit_actor', '', true);
  RETURN true;
END;
$function$;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_f text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.retenciones'::regclass) THEN
    RAISE EXCEPTION 'retenciones sin RLS';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
              WHERE table_schema = 'public' AND table_name = 'retenciones'
                AND grantee IN ('PUBLIC', 'anon', 'authenticated')) THEN
    RAISE EXCEPTION 'retenciones abierta a las sesiones';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'retenciones') THEN
    RAISE EXCEPTION 'retenciones con políticas: se lee y se escribe solo por función';
  END IF;

  FOREACH v_f IN ARRAY ARRAY['public.sujetos_retencion(uuid)', 'public.poner_retencion(uuid,jsonb,text,text)',
                             'public.quitar_retencion(uuid,jsonb,text)', 'public.retenciones_centro(uuid)'] LOOP
    IF NOT has_function_privilege('authenticated', v_f, 'EXECUTE')
       OR has_function_privilege('anon', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION '% con permisos equivocados', v_f;
    END IF;
    IF strpos((SELECT prosrc FROM pg_proc WHERE oid = v_f::regprocedure), 'NOT privado.es_titular(p_centro_id)') = 0
       OR strpos((SELECT prosrc FROM pg_proc WHERE oid = v_f::regprocedure), 'es_admin') > 0 THEN
      RAISE EXCEPTION '% no la cierra a la titular', v_f;
    END IF;
  END LOOP;
  FOREACH v_f IN ARRAY ARRAY['privado.retenido(uuid,text,uuid)', 'privado.sujeto_del_centro(uuid,text,uuid)',
                             'privado.retencion_lista(uuid,jsonb)'] LOOP
    IF has_function_privilege('authenticated', v_f, 'EXECUTE')
       OR has_function_privilege('anon', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION '% abierta a las sesiones', v_f;
    END IF;
  END LOOP;

  IF strpos((SELECT prosrc FROM pg_proc WHERE oid = 'public.expedientes_vencidos(integer)'::regprocedure),
            'NOT privado.retenido(n.centro_id, ''nino'', n.id)') = 0 THEN
    RAISE EXCEPTION 'expedientes_vencidos no mira la retención';
  END IF;
  IF strpos((SELECT prosrc FROM pg_proc WHERE oid = 'public.purgar_expediente_nino(uuid,integer)'::regprocedure),
            'IF privado.retenido(v_centro, ''nino'', p_nino_id) THEN') = 0 THEN
    RAISE EXCEPTION 'purgar_expediente_nino no mira la retención';
  END IF;

  RAISE NOTICE 'guarda posterior: % retenciones; md5 expedientes_vencidos %, purgar_expediente_nino %',
    (SELECT count(*) FROM public.retenciones),
    (SELECT md5(regexp_replace(regexp_replace(replace(prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
       FROM pg_proc WHERE oid = 'public.expedientes_vencidos(integer)'::regprocedure),
    (SELECT md5(regexp_replace(regexp_replace(replace(prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
       FROM pg_proc WHERE oid = 'public.purgar_expediente_nino(uuid,integer)'::regprocedure);
END
$guarda$;
