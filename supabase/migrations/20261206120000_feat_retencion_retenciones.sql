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
--   · La retención frena también el olvido que pide el interesado (art. 17.3.e): la petición queda
--     pendiente, la familia ve en su perfil que está retenida y por qué tipo de motivo, y la
--     titular puede explicarlo en su nota (§6).
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
       '20261204120000'),
      ('privado.olvido_bloqueos(public.olvido_sujeto_tipo,uuid,uuid)',
       '715e2b7da8417e832e8f3bb6c58904b9', '20261205120000'),
      ('public.olvido_pendientes()', '7edd6e5ff7c03f98c5ef35be54777c19', '20261205120000'),
      ('public.deshacer_confirmacion_olvido(uuid)', 'eae886a954a93552145db59adcb21b39',
       '20261126120000'),
      ('public.purgar_sujeto_db(uuid)', '0d8a878f659ba1d0d822aa78ed239005', '20261205120000')
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

  -- La retención frena también el olvido (§6): una petición suya confirmada y sin purgar vuelve a
  -- pendiente, con los datos como estaban, y se queda ahí mientras dure.
  PERFORM privado.olvido_volver_a_pendiente(s.id)
     FROM public.olvido_solicitudes s
     JOIN privado.retencion_lista(p_centro_id, p_sujetos) l
       ON s.sujeto_tipo::text = l.tipo AND s.sujeto_id = l.id
    WHERE s.centro_id = p_centro_id AND s.estado = 'confirmada' AND s.purgado_en IS NULL;
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

-- ---- 6. La retención frena también el olvido ----
-- Decidido por Jose (2026-10-29): el art. 17.3.e permite no borrar lo necesario para defenderse en
-- una reclamación, y sin freno el centro podría destruir pruebas de su propio caso justo cuando las
-- necesita. Se reutiliza lo que ya hay: la retención es un bloqueo más de la petición
-- (`olvido_bloqueos`), así que no se confirma y queda pendiente; la familia lo ve en su perfil con
-- el tipo de motivo, y la titular puede explicarlo en la nota. Una petición ya confirmada y sin
-- purgar vuelve a pendiente al retener (`privado.olvido_volver_a_pendiente`), y la purga no coge a
-- un retenido. Quién retuvo, cuándo y por qué queda en `retenciones`.
-- Cada función que cambia es la de producción (pg_get_functiondef) con su cambio marcado
-- «Retención (PR-8)».

-- Una petición confirmada y sin purgar vuelve a pendiente, con los datos como estaban antes de
-- confirmarla. Es el cuerpo de `deshacer_confirmacion_olvido` (20261126120000), sin su puerta ni su
-- plazo: lo llaman ella y la retención, que lo hace con la gracia vencida también.
CREATE FUNCTION privado.olvido_volver_a_pendiente(p_solicitud_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  s public.olvido_solicitudes%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.olvido_solicitudes WHERE id = p_solicitud_id FOR UPDATE;
  IF NOT FOUND OR s.estado <> 'confirmada' OR s.purgado_en IS NOT NULL THEN
    RETURN;
  END IF;

  IF s.sujeto_tipo = 'nino' THEN
    UPDATE public.ninos
       SET deleted_at = (s.estado_previo ->> 'deleted_at')::timestamptz,
           deleted_reason = (s.estado_previo ->> 'deleted_reason')::public.motivo_borrado
     WHERE id = s.sujeto_id AND deleted_reason = 'solicitud_olvido';
  ELSE
    -- Los roles que retiró esta confirmación (mismo instante), salvo si ya tiene uno vivo igual.
    UPDATE public.roles_usuario r
       SET deleted_at = NULL, deleted_reason = NULL
     WHERE r.usuario_id = s.sujeto_id AND r.centro_id = s.centro_id
       AND r.deleted_reason = 'solicitud_olvido' AND r.deleted_at = s.confirmada_en
       AND NOT EXISTS (SELECT 1 FROM public.roles_usuario v
                        WHERE v.usuario_id = r.usuario_id AND v.centro_id = r.centro_id
                          AND v.rol = r.rol AND v.deleted_at IS NULL);
    UPDATE public.usuarios
       SET deleted_at = (s.estado_previo ->> 'usuario_deleted_at')::timestamptz
     WHERE id = s.sujeto_id;
  END IF;

  UPDATE public.olvido_solicitudes
     SET estado = 'pendiente', confirmada_en = NULL, confirmada_por = NULL,
         gracia_hasta = NULL, estado_previo = NULL
   WHERE id = p_solicitud_id;
END;
$function$;
REVOKE ALL ON FUNCTION privado.olvido_volver_a_pendiente(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION privado.olvido_bloqueos(p_sujeto_tipo olvido_sujeto_tipo, p_sujeto_id uuid, p_centro_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bloqueos jsonb := '[]'::jsonb;
  v_avisos   jsonb := '[]'::jsonb;
  v_familias uuid[];
  v_n        integer;
  v_retenido text;
BEGIN
  -- Retención (PR-8): con un procedimiento abierto el olvido espera, también el que pide el
  -- interesado (art. 17.3.e). La familia ve que está retenida y por qué tipo de motivo.
  SELECT r.motivo_tipo INTO v_retenido FROM public.retenciones r
   WHERE r.centro_id = p_centro_id AND r.sujeto_tipo = p_sujeto_tipo AND r.sujeto_id = p_sujeto_id
     AND r.quitada_en IS NULL;
  IF FOUND THEN
    v_bloqueos := v_bloqueos || jsonb_build_object('codigo', 'retenido', 'n', 1, 'motivo_tipo', v_retenido);
  END IF;

  IF p_sujeto_tipo = 'nino' THEN
    SELECT count(*) INTO v_n FROM public.matriculas m
     WHERE m.nino_id = p_sujeto_id AND m.deleted_at IS NULL AND m.estado <> 'baja';
    IF v_n > 0 THEN
      v_bloqueos := v_bloqueos || jsonb_build_object('codigo', 'matricula_viva', 'n', v_n);
    END IF;

    -- Los recibos de su familia no bloquean: la deuda es de la familia, y sus datos se quedan.
    SELECT count(*) INTO v_n FROM public.recibos r
      JOIN public.ninos n ON n.familia_id = r.familia_id
     WHERE n.id = p_sujeto_id AND r.centro_id = p_centro_id AND r.deleted_at IS NULL
       AND ((r.estado IN ('borrador', 'pendiente_procesar') AND r.total_centimos > 0)
         OR (r.estado = 'devuelto' AND r.devolucion_salida IS NULL));
    IF v_n > 0 THEN
      v_avisos := v_avisos || jsonb_build_object('codigo', 'recibos_familia_pendientes', 'n', v_n);
    END IF;
  ELSE
    -- Retención (F11-B, punto 6, PR-7): ningún tutor se olvida con un hijo matriculado, haya otro
    -- tutor o no. Sus hijos son los de sus vínculos y los de sus familias: un tutor puede estar en
    -- la familia sin vínculo con el niño.
    SELECT count(DISTINCT n.id) INTO v_n FROM public.ninos n
     WHERE n.centro_id = p_centro_id
       AND (EXISTS (SELECT 1 FROM public.vinculos_familiares v
                     WHERE v.nino_id = n.id AND v.usuario_id = p_sujeto_id AND v.deleted_at IS NULL)
            OR EXISTS (SELECT 1 FROM public.familia_tutores ft
                        WHERE ft.familia_id = n.familia_id AND ft.usuario_id = p_sujeto_id
                          AND ft.deleted_at IS NULL))
       AND EXISTS (SELECT 1 FROM public.matriculas m
                    WHERE m.nino_id = n.id AND m.deleted_at IS NULL AND m.estado <> 'baja');
    IF v_n > 0 THEN
      v_bloqueos := v_bloqueos || jsonb_build_object('codigo', 'hijos_matriculados', 'n', v_n);
    END IF;

    SELECT coalesce(array_agg(DISTINCT ft.familia_id), '{}') INTO v_familias
      FROM public.familia_tutores ft
     WHERE ft.usuario_id = p_sujeto_id AND ft.centro_id = p_centro_id AND ft.deleted_at IS NULL;

    SELECT count(*) INTO v_n FROM public.recibos r
     WHERE r.familia_id = ANY (v_familias) AND r.centro_id = p_centro_id AND r.deleted_at IS NULL
       AND ((r.estado IN ('borrador', 'pendiente_procesar') AND r.total_centimos > 0)
         OR (r.estado = 'devuelto' AND r.devolucion_salida IS NULL));
    IF v_n > 0 THEN
      v_bloqueos := v_bloqueos || jsonb_build_object('codigo', 'recibos_pendientes', 'n', v_n);
    END IF;

    SELECT count(*) INTO v_n FROM public.recibos r
     WHERE r.familia_id = ANY (v_familias) AND r.centro_id = p_centro_id AND r.deleted_at IS NULL
       AND r.estado = 'enviado_banco' AND r.fecha_envio_banco >= (now() - interval '8 weeks')::date;
    IF v_n > 0 THEN
      v_avisos := v_avisos || jsonb_build_object('codigo', 'cobro_banco_reciente', 'n', v_n);
    END IF;

    SELECT (SELECT count(*) FROM public.beca_comedor_desborde d
             WHERE d.familia_id = ANY (v_familias) AND d.centro_id = p_centro_id
               AND d.estado = 'pendiente')
         + (SELECT count(*) FROM public.beca_comedor_transferencia t
             WHERE t.familia_id = ANY (v_familias) AND t.centro_id = p_centro_id
               AND t.estado = 'pendiente')
      INTO v_n;
    IF v_n > 0 THEN
      v_avisos := v_avisos || jsonb_build_object('codigo', 'dinero_a_favor', 'n', v_n);
    END IF;

    SELECT count(*) INTO v_n FROM public.mandatos_sepa ms
     WHERE ms.familia_id = ANY (v_familias) AND ms.centro_id = p_centro_id
       AND ms.estado = 'activo' AND ms.deleted_at IS NULL;
    IF v_n > 0 THEN
      v_avisos := v_avisos || jsonb_build_object('codigo', 'mandato_activo', 'n', v_n);
    END IF;
  END IF;

  RETURN jsonb_build_object('bloqueos', v_bloqueos, 'avisos', v_avisos);
END;
$function$;

CREATE OR REPLACE FUNCTION public.olvido_pendientes()
 RETURNS TABLE(solicitud_id uuid, sujeto_tipo olvido_sujeto_tipo, sujeto_id uuid, centro_id uuid, gracia_hasta timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.id, s.sujeto_tipo, s.sujeto_id, s.centro_id, s.gracia_hasta
  FROM public.olvido_solicitudes s
  WHERE s.purgado_en IS NULL
    AND s.estado = 'confirmada'
    AND s.gracia_hasta <= now()
    -- Retención (PR-7): en los días de gracia el hijo puede volver a matricularse; la petición
    -- espera, sin purgarse, a que deje el centro.
    AND (s.sujeto_tipo <> 'usuario'
         OR jsonb_array_length(privado.olvido_bloqueos(s.sujeto_tipo, s.sujeto_id, s.centro_id)
                               -> 'bloqueos') = 0)
    -- Retención (PR-8): el sujeto retenido espera, sea niño o adulto.
    AND NOT privado.retenido(s.centro_id, s.sujeto_tipo::text, s.sujeto_id)
    AND ((auth.uid() IS NULL
          AND (COALESCE(auth.role(), '') = 'service_role'
               OR (session_user <> 'authenticator'
                   AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                   AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)))
         OR privado.es_responsable(s.centro_id))
  ORDER BY s.gracia_hasta;
$function$;

CREATE OR REPLACE FUNCTION public.deshacer_confirmacion_olvido(p_solicitud_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s public.olvido_solicitudes%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.olvido_solicitudes WHERE id = p_solicitud_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'petición no encontrada' USING ERRCODE = 'no_data_found';
  END IF;
  IF auth.uid() IS NULL OR NOT privado.es_responsable(s.centro_id) THEN
    RAISE EXCEPTION 'no autorizado a ejercer el olvido en este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF s.estado <> 'confirmada' OR s.purgado_en IS NOT NULL OR s.gracia_hasta <= now() THEN
    RAISE EXCEPTION 'solo se deshace una confirmación dentro de sus 7 días'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'fuera_de_plazo';
  END IF;

  -- Retención (PR-8): lo mismo que hace la retención con una confirmada sin purgar.
  PERFORM privado.olvido_volver_a_pendiente(p_solicitud_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.purgar_sujeto_db(p_solicitud_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s        public.olvido_solicitudes%ROWTYPE;
  v_nombre text;
  v_lista  uuid[];
  v_ft     uuid[];
  k_nino  text[] := ARRAY['nombre','apellidos','fecha_nacimiento','sexo','nacionalidad',
                          'foto_url','notas_admin'];
  k_med   text[] := ARRAY['alergias_graves','notas_emergencia','medicacion_habitual',
                          'alergias_leves','medico_familia','telefono_emergencia'];
  k_user  text[] := ARRAY['nombre_completo','foto_url'];
  k_ft    text[] := ARRAY['nombre_completo','email','direccion_calle','direccion_numero',
                          'direccion_cp','direccion_ciudad','dni_documento_path'];
  k_extra text[] := ARRAY['ip_address','user_agent','descripcion_parentesco',
                          'nombre_externo','observaciones','observaciones_generales',
                          'contenido','nombre_tecleado','comentario'];
BEGIN
  -- [CRIT-ANON] Sin uid solo entra el servicio: service_role o sesión directa sin JWT
  -- (SQL Editor / psql). anon, o un JWT sin sub, ya no se cuela por la rama "uid NULL". Patrón #284.
  IF auth.uid() IS NULL
     AND NOT (COALESCE(auth.role(), '') = 'service_role'
              OR (session_user <> 'authenticator'
                  AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                  AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
    RAISE EXCEPTION 'no autorizado: sin sesión solo el servicio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- [/CRIT-ANON]
  SELECT * INTO s FROM public.olvido_solicitudes WHERE id = p_solicitud_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'solicitud de olvido no encontrada: %', p_solicitud_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT privado.es_responsable(s.centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF s.purgado_en IS NOT NULL THEN
    RETURN;
  END IF;

  -- Retención (PR-8): el sujeto retenido por un procedimiento abierto espera, también con la
  -- petición ya confirmada (olvido_pendientes ya no la lista; esto cubre cualquier otro camino).
  IF privado.retenido(s.centro_id, s.sujeto_tipo::text, s.sujeto_id) THEN
    RAISE EXCEPTION 'el sujeto está retenido por un procedimiento abierto'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'retenido';
  END IF;

  -- Retención (PR-7): ningún tutor se olvida con un hijo matriculado. Lo que impide confirmar
  -- impide purgar (olvido_pendientes ya no la lista; esto cubre cualquier otro camino).
  IF s.sujeto_tipo = 'usuario'
     AND jsonb_array_length(privado.olvido_bloqueos(s.sujeto_tipo, s.sujeto_id, s.centro_id)
                            -> 'bloqueos') > 0 THEN
    RAISE EXCEPTION 'todavía falta algo para purgar'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'hay_bloqueos',
            DETAIL = (privado.olvido_bloqueos(s.sujeto_tipo, s.sujeto_id, s.centro_id)
                      -> 'bloqueos')::text;
  END IF;

  -- Grupo 1 (PR B): las filas de auditoría que escribe la purga llevan su etiqueta.
  PERFORM set_config('app.audit_actor', 'system:purgar_sujeto_db', true);

  IF s.sujeto_tipo = 'nino' THEN
    -- Retención (F11-B, punto 6, PR-6): la purga del niño, la misma para el olvido y para el
    -- plazo del expediente (20261204120000).
    PERFORM privado.purgar_nino(s.sujeto_id);

  ELSE  -- usuario
    SELECT nombre_completo INTO v_nombre FROM public.usuarios WHERE id = s.sujeto_id;

    IF public.olvido_es_ultimo_centro(s.id) THEN
      -- Último centro: la cuenta entera y todo lo que quede, también lo de los centros sin
      -- solicitud. Es literal la rama del usuario de 20261019120000.
      IF v_nombre IS NOT NULL AND length(trim(v_nombre)) > 0 THEN
        UPDATE public.mensajes
          SET contenido = replace(contenido, v_nombre, '[borrado]')
          WHERE contenido LIKE '%' || v_nombre || '%';

        -- Grupo 1 (PR B): el nombre tampoco se queda en la auditoría de los mensajes: ni en la
        -- fila que acaba de escribir el UPDATE de arriba ni en las anteriores, de cualquier autor.
        UPDATE public.audit_log SET
          valores_antes = CASE WHEN strpos(valores_antes->>'contenido', v_nombre) > 0
            THEN jsonb_set(valores_antes, '{contenido}',
                           to_jsonb(replace(valores_antes->>'contenido', v_nombre, '[borrado]')))
            ELSE valores_antes END,
          valores_despues = CASE WHEN strpos(valores_despues->>'contenido', v_nombre) > 0
            THEN jsonb_set(valores_despues, '{contenido}',
                           to_jsonb(replace(valores_despues->>'contenido', v_nombre, '[borrado]')))
            ELSE valores_despues END
        WHERE tabla = 'mensajes'
          AND (strpos(valores_antes->>'contenido', v_nombre) > 0
               OR strpos(valores_despues->>'contenido', v_nombre) > 0);
      END IF;

      -- Cierre de la purga: también la foto de perfil (el objeto lo borra antes el manifiesto).
      UPDATE public.usuarios SET
        nombre_completo = '[borrado]',
        foto_url        = NULL,
        deleted_at      = COALESCE(deleted_at, now())
      WHERE id = s.sujeto_id;

      UPDATE public.consentimientos SET ip_address = NULL, user_agent = NULL
        WHERE usuario_id = s.sujeto_id;
      DELETE FROM public.push_subscriptions WHERE usuario_id = s.sujeto_id;
      -- Cierre de la purga: preferencias y lecturas, igual que los dispositivos.
      DELETE FROM public.preferencias_usuario WHERE usuario_id = s.sujeto_id;
      DELETE FROM public.lectura_conversacion WHERE usuario_id = s.sujeto_id;
      DELETE FROM public.lectura_anuncio      WHERE usuario_id = s.sujeto_id;

      -- Cierre de la purga: su perfil de tutor en familia_tutores. Se anonimiza y se da de baja;
      -- usuario_id, familia_id y rol_familia se quedan (seudónimos; el trigger los congela). No se
      -- asciende al otro tutor: lo decide la directora (promover_a_titular). Su copia en
      -- audit_log se redacta por registro_id, que alcanza también las filas de antes de tener
      -- cuenta. El DNI en Storage lo borra antes el manifiesto, por su ruta exacta.
      WITH anonimizados AS (
        UPDATE public.familia_tutores SET
          nombre_completo    = NULL,
          email              = NULL,
          direccion_calle    = NULL,
          direccion_numero   = NULL,
          direccion_cp       = NULL,
          direccion_ciudad   = NULL,
          dni_documento_path = NULL,
          deleted_at         = COALESCE(deleted_at, now())
        WHERE usuario_id = s.sujeto_id RETURNING id
      )
      SELECT array_agg(id) INTO v_ft FROM anonimizados;
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   k_ft),
        valores_despues = public._redactar_jsonb(valores_despues, k_ft)
      WHERE tabla = 'familia_tutores' AND registro_id = ANY (v_ft);

      -- Cierre de la purga: los cambios que pidió sobre sus propios datos de tutor (email,
      -- dirección, ruta de su DNI en el payload). Los que pidió sobre el niño son del niño.
      DELETE FROM public.cambios_pendientes
       WHERE solicitado_por = s.sujeto_id AND entidad IN ('datos_tutor', 'datos_tutor_dni');

      -- Cierre de la purga: su texto al responder a una cita (la auditoría la redacta k_extra).
      UPDATE public.cita_invitados SET comentario = NULL
       WHERE usuario_id = s.sujeto_id AND comentario IS NOT NULL;

      -- Purga de lista_espera: el teléfono y el email que el tutor dejó en sus prospectos. El
      -- prospecto es del niño y se queda; su copia en audit_log pierde esas dos claves.
      WITH limpiados AS (
        UPDATE public.lista_espera SET telefono_tutor = NULL, email_tutor = NULL
        WHERE tutor_usuario_id = s.sujeto_id RETURNING id
      )
      SELECT array_agg(id) INTO v_lista FROM limpiados;
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY['telefono_tutor', 'email_tutor']),
        valores_despues = public._redactar_jsonb(valores_despues, ARRAY['telefono_tutor', 'email_tutor'])
      WHERE tabla = 'lista_espera' AND registro_id = ANY (v_lista);

      -- D-5: motivo 'purga_rgpd' → la reactivación de familia NUNCA revive estas filas.
      UPDATE public.roles_usuario SET
        deleted_reason = 'purga_rgpd',
        deleted_at     = COALESCE(deleted_at, now())
        WHERE usuario_id = s.sujeto_id;
      UPDATE public.vinculos_familiares SET
        descripcion_parentesco = NULL,
        deleted_reason         = 'purga_rgpd',
        deleted_at             = COALESCE(deleted_at, now())
      WHERE usuario_id = s.sujeto_id;

      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   k_user || k_extra),
        valores_despues = public._redactar_jsonb(valores_despues, k_user || k_extra)
      WHERE registro_id = s.sujeto_id OR usuario_id = s.sujeto_id
         -- Grupo 1 (PR B): también las filas que LLEVAN al sujeto (vínculos, roles…), como su
         -- vínculo con descripcion_parentesco, escritas por otros o por esta misma purga.
         OR valores_antes->>'usuario_id'   = s.sujeto_id::text
         OR valores_despues->>'usuario_id' = s.sujeto_id::text;

      -- Grupo 1 (PR B): invitaciones. El paso 4 de la purga (purgar-vencidos.ts) ya marcó con
      -- '[borrado]' el email y el nombre de sus invitaciones; aquí se redactan sus copias en
      -- audit_log (la fila de ese UPDATE y las anteriores). Idempotente.
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY['email', 'nombre_completo']),
        valores_despues = public._redactar_jsonb(valores_despues, ARRAY['email', 'nombre_completo'])
      WHERE tabla = 'invitaciones'
        AND registro_id IN (SELECT i.id FROM public.invitaciones i WHERE i.email = '[borrado]');
    ELSE
      -- Multicentro (Fase 2 · PR B): le queda otro centro. Cada sentencia es la de la rama de
      -- arriba acotada a ESTE centro (s.centro_id). No se tocan usuarios, push, preferencias ni
      -- los consentimientos sin niño: son de la cuenta y se van con el último centro.

      -- Su nombre en los mensajes de las conversaciones de este centro, y en su auditoría.
      IF v_nombre IS NOT NULL AND length(trim(v_nombre)) > 0 THEN
        UPDATE public.mensajes
          SET contenido = replace(contenido, v_nombre, '[borrado]')
          WHERE contenido LIKE '%' || v_nombre || '%'
            AND conversacion_id IN (SELECT c.id FROM public.conversaciones c
                                     WHERE c.centro_id = s.centro_id);

        UPDATE public.audit_log SET
          valores_antes = CASE WHEN strpos(valores_antes->>'contenido', v_nombre) > 0
            THEN jsonb_set(valores_antes, '{contenido}',
                           to_jsonb(replace(valores_antes->>'contenido', v_nombre, '[borrado]')))
            ELSE valores_antes END,
          valores_despues = CASE WHEN strpos(valores_despues->>'contenido', v_nombre) > 0
            THEN jsonb_set(valores_despues, '{contenido}',
                           to_jsonb(replace(valores_despues->>'contenido', v_nombre, '[borrado]')))
            ELSE valores_despues END
        WHERE tabla = 'mensajes' AND centro_id = s.centro_id
          AND (strpos(valores_antes->>'contenido', v_nombre) > 0
               OR strpos(valores_despues->>'contenido', v_nombre) > 0);
      END IF;

      -- Los consentimientos ligados a un niño de este centro.
      UPDATE public.consentimientos SET ip_address = NULL, user_agent = NULL
        WHERE usuario_id = s.sujeto_id
          AND nino_id IN (SELECT n.id FROM public.ninos n WHERE n.centro_id = s.centro_id);
      -- Las lecturas de conversaciones y anuncios de este centro.
      DELETE FROM public.lectura_conversacion
        WHERE usuario_id = s.sujeto_id
          AND conversacion_id IN (SELECT c.id FROM public.conversaciones c
                                   WHERE c.centro_id = s.centro_id);
      DELETE FROM public.lectura_anuncio
        WHERE usuario_id = s.sujeto_id
          AND anuncio_id IN (SELECT a.id FROM public.anuncios a WHERE a.centro_id = s.centro_id);

      -- Su perfil de tutor en la familia de este centro (el DNI de esa familia lo borra antes el
      -- manifiesto, solo el de este centro).
      WITH anonimizados AS (
        UPDATE public.familia_tutores SET
          nombre_completo    = NULL,
          email              = NULL,
          direccion_calle    = NULL,
          direccion_numero   = NULL,
          direccion_cp       = NULL,
          direccion_ciudad   = NULL,
          dni_documento_path = NULL,
          deleted_at         = COALESCE(deleted_at, now())
        WHERE usuario_id = s.sujeto_id AND centro_id = s.centro_id RETURNING id
      )
      SELECT array_agg(id) INTO v_ft FROM anonimizados;
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   k_ft),
        valores_despues = public._redactar_jsonb(valores_despues, k_ft)
      WHERE tabla = 'familia_tutores' AND registro_id = ANY (v_ft);

      -- Los cambios que pidió sobre sus datos de tutor en este centro.
      DELETE FROM public.cambios_pendientes
       WHERE solicitado_por = s.sujeto_id AND entidad IN ('datos_tutor', 'datos_tutor_dni')
         AND centro_id = s.centro_id;

      -- Su texto al responder a las citas de este centro.
      UPDATE public.cita_invitados SET comentario = NULL
       WHERE usuario_id = s.sujeto_id AND comentario IS NOT NULL AND centro_id = s.centro_id;

      -- El teléfono y el email de sus prospectos de este centro.
      WITH limpiados AS (
        UPDATE public.lista_espera SET telefono_tutor = NULL, email_tutor = NULL
        WHERE tutor_usuario_id = s.sujeto_id AND centro_id = s.centro_id RETURNING id
      )
      SELECT array_agg(id) INTO v_lista FROM limpiados;
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY['telefono_tutor', 'email_tutor']),
        valores_despues = public._redactar_jsonb(valores_despues, ARRAY['telefono_tutor', 'email_tutor'])
      WHERE tabla = 'lista_espera' AND registro_id = ANY (v_lista);

      -- Sus roles en este centro y sus vínculos con niños de este centro.
      UPDATE public.roles_usuario SET
        deleted_reason = 'purga_rgpd',
        deleted_at     = COALESCE(deleted_at, now())
        WHERE usuario_id = s.sujeto_id AND centro_id = s.centro_id;
      UPDATE public.vinculos_familiares SET
        descripcion_parentesco = NULL,
        deleted_reason         = 'purga_rgpd',
        deleted_at             = COALESCE(deleted_at, now())
      WHERE usuario_id = s.sujeto_id
        AND nino_id IN (SELECT n.id FROM public.ninos n WHERE n.centro_id = s.centro_id);

      -- Su auditoría en este centro. Las filas sin centro (las de usuarios) son de la cuenta.
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   k_user || k_extra),
        valores_despues = public._redactar_jsonb(valores_despues, k_user || k_extra)
      WHERE centro_id = s.centro_id
        AND (registro_id = s.sujeto_id OR usuario_id = s.sujeto_id
             OR valores_antes->>'usuario_id'   = s.sujeto_id::text
             OR valores_despues->>'usuario_id' = s.sujeto_id::text);

      -- Sus invitaciones de este centro (purgar-vencidos.ts las marca antes, solo las de este
      -- centro), y su auditoría.
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY['email', 'nombre_completo']),
        valores_despues = public._redactar_jsonb(valores_despues, ARRAY['email', 'nombre_completo'])
      WHERE tabla = 'invitaciones' AND centro_id = s.centro_id
        AND registro_id IN (SELECT i.id FROM public.invitaciones i
                             WHERE i.email = '[borrado]' AND i.centro_id = s.centro_id);
    END IF;
  END IF;

  UPDATE public.olvido_solicitudes SET purgado_en = now() WHERE id = p_solicitud_id;
  PERFORM set_config('app.audit_actor', '', true);
END $function$;

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

  -- El olvido espera al retenido: no se confirma, no se lista para purgar y no se purga.
  IF strpos((SELECT prosrc FROM pg_proc
              WHERE oid = 'privado.olvido_bloqueos(public.olvido_sujeto_tipo,uuid,uuid)'::regprocedure),
            '''codigo'', ''retenido''') = 0 THEN
    RAISE EXCEPTION 'olvido_bloqueos no cuenta la retención';
  END IF;
  IF strpos((SELECT prosrc FROM pg_proc WHERE oid = 'public.olvido_pendientes()'::regprocedure),
            'AND NOT privado.retenido(s.centro_id, s.sujeto_tipo::text, s.sujeto_id)') = 0 THEN
    RAISE EXCEPTION 'olvido_pendientes no mira la retención';
  END IF;
  IF strpos((SELECT prosrc FROM pg_proc WHERE oid = 'public.purgar_sujeto_db(uuid)'::regprocedure),
            'IF privado.retenido(s.centro_id, s.sujeto_tipo::text, s.sujeto_id) THEN') = 0 THEN
    RAISE EXCEPTION 'purgar_sujeto_db no mira la retención';
  END IF;
  IF strpos((SELECT prosrc FROM pg_proc WHERE oid = 'public.poner_retencion(uuid,jsonb,text,text)'::regprocedure),
            'PERFORM privado.olvido_volver_a_pendiente(s.id)') = 0
     OR strpos((SELECT prosrc FROM pg_proc WHERE oid = 'public.deshacer_confirmacion_olvido(uuid)'::regprocedure),
               'PERFORM privado.olvido_volver_a_pendiente(p_solicitud_id)') = 0 THEN
    RAISE EXCEPTION 'la vuelta a pendiente no está en su sitio';
  END IF;
  IF has_function_privilege('authenticated', 'privado.olvido_volver_a_pendiente(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'olvido_volver_a_pendiente abierta a las sesiones';
  END IF;

  RAISE NOTICE 'guarda posterior: % retenciones; md5 expedientes_vencidos %, purgar_expediente_nino %',
    (SELECT count(*) FROM public.retenciones),
    (SELECT md5(regexp_replace(regexp_replace(replace(prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
       FROM pg_proc WHERE oid = 'public.expedientes_vencidos(integer)'::regprocedure),
    (SELECT md5(regexp_replace(regexp_replace(replace(prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
       FROM pg_proc WHERE oid = 'public.purgar_expediente_nino(uuid,integer)'::regprocedure);
END
$guarda$;
