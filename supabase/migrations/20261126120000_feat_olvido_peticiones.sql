-- =============================================================================
-- FEAT — Peticiones de olvido desde la app (F11-B, punto 5)
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/olvido-peticiones.md. Hasta ahora solo la titular podía pedir el olvido, y
-- pedirlo ya borraba (de forma lógica) y daba 30 días sin forma de deshacerlo. Ahora:
--
--   · La familia pide; la petición no borra nada (`pendiente`).
--   · La titular la confirma cuando no falta nada (lo que falta se calcula en el momento,
--     `privado.olvido_bloqueos`), la rechaza con motivo o la deja pendiente.
--   · Confirmar hace lo que antes hacía pedir y abre 7 días en los que solo la titular puede
--     deshacerla. Después la purga nocturna de siempre.
--   · Los recibos no bloquean el olvido del niño (la deuda es de la familia) y sí el del tutor
--     (art. 17.3.e). El dinero a favor de la familia solo avisa.
--
-- `olvido_solicitudes` tiene 0 filas en producción (2026-10-27). Las que hubiera se dan por
-- confirmadas: las creaba `solicitar_olvido_*`, que confirmaba al pedir.
--
-- La aplica el responsable por SQL Editor, DESPUÉS de `20261125120000`. Tras aplicar:
-- registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_n   integer;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'olvido_solicitudes'
                AND column_name = 'estado') THEN
    RAISE EXCEPTION 'ya aplicada: olvido_solicitudes ya tiene estado';
  END IF;

  -- Las cuatro funciones que se reescriben tienen que ser las leídas en producción
  -- (md5 normalizado: sin \r, sin comentarios, espacios colapsados).
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.solicitar_olvido_nino(uuid,boolean)');
  IF v_md5 IS DISTINCT FROM '65d0ed9dc1236a4b06d48d8bb43d3911' THEN
    RAISE EXCEPTION 'solicitar_olvido_nino no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.solicitar_olvido_usuario(uuid,uuid,boolean)');
  IF v_md5 IS DISTINCT FROM 'fdaefbed5a28a92e491656713236915d' THEN
    RAISE EXCEPTION 'solicitar_olvido_usuario no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.olvido_pendientes()');
  IF v_md5 IS DISTINCT FROM '1cc1766abade58760c1e31cb27286d4b' THEN
    RAISE EXCEPTION 'olvido_pendientes no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.olvido_es_ultimo_centro(uuid)');
  IF v_md5 IS DISTINCT FROM '97b7ab860db0ad715ba0ece094c2f7b2' THEN
    RAISE EXCEPTION 'olvido_es_ultimo_centro no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;

  SELECT count(*) INTO v_n FROM public.olvido_solicitudes;
  RAISE NOTICE 'guarda previa: % solicitudes de olvido (se dan por confirmadas)', v_n;
END
$guarda$;

-- ---- 1. Estados de la petición ----
CREATE TYPE public.olvido_estado AS ENUM ('pendiente', 'confirmada', 'rechazada', 'retirada');

ALTER TABLE public.olvido_solicitudes
  ADD COLUMN estado            public.olvido_estado NOT NULL DEFAULT 'pendiente',
  ADD COLUMN pedida_por_centro boolean NOT NULL DEFAULT false,
  ADD COLUMN confirmada_en     timestamptz,
  ADD COLUMN confirmada_por    uuid REFERENCES public.usuarios(id),
  ADD COLUMN rechazada_en      timestamptz,
  ADD COLUMN rechazada_por     uuid REFERENCES public.usuarios(id),
  ADD COLUMN motivo_rechazo    text,
  ADD COLUMN retirada_en       timestamptz,
  ADD COLUMN retirada_por      uuid REFERENCES public.usuarios(id),
  ADD COLUMN nota_centro       text,
  ADD COLUMN estado_previo     jsonb,
  ALTER COLUMN gracia_hasta DROP NOT NULL;

UPDATE public.olvido_solicitudes
   SET estado = 'confirmada', confirmada_en = solicitado_en, confirmada_por = solicitado_por;

ALTER TABLE public.olvido_solicitudes
  ADD CONSTRAINT olvido_estado_coherente CHECK (
    (estado = 'pendiente' AND confirmada_en IS NULL AND gracia_hasta IS NULL
       AND rechazada_en IS NULL AND retirada_en IS NULL AND purgado_en IS NULL)
    OR (estado = 'confirmada' AND confirmada_en IS NOT NULL AND gracia_hasta IS NOT NULL
       AND rechazada_en IS NULL AND retirada_en IS NULL)
    OR (estado = 'rechazada' AND rechazada_en IS NOT NULL AND confirmada_en IS NULL
       AND gracia_hasta IS NULL AND retirada_en IS NULL AND purgado_en IS NULL)
    OR (estado = 'retirada' AND retirada_en IS NOT NULL AND confirmada_en IS NULL
       AND gracia_hasta IS NULL AND rechazada_en IS NULL AND purgado_en IS NULL)
  ),
  ADD CONSTRAINT olvido_motivo_largo CHECK (
    motivo_rechazo IS NULL OR char_length(btrim(motivo_rechazo)) BETWEEN 1 AND 1000),
  ADD CONSTRAINT olvido_nota_larga CHECK (
    nota_centro IS NULL OR char_length(btrim(nota_centro)) BETWEEN 1 AND 1000);

-- Una petición abierta por persona y centro: pendiente, o confirmada sin purgar.
DROP INDEX public.olvido_solicitudes_sujeto_centro_pendiente;
CREATE UNIQUE INDEX olvido_solicitudes_sujeto_centro_abierta
  ON public.olvido_solicitudes (sujeto_tipo, sujeto_id, centro_id)
  WHERE purgado_en IS NULL AND estado IN ('pendiente', 'confirmada');

-- Al purgar, el motivo y la nota (texto libre que puede hablar de la persona) se vacían en
-- todas sus peticiones de ese centro, también en las rechazadas de antes.
CREATE FUNCTION privado.olvido_vaciar_textos()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  UPDATE public.olvido_solicitudes
     SET motivo_rechazo = NULL, nota_centro = NULL
   WHERE sujeto_tipo = NEW.sujeto_tipo AND sujeto_id = NEW.sujeto_id AND centro_id = NEW.centro_id
     AND (motivo_rechazo IS NOT NULL OR nota_centro IS NOT NULL);
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION privado.olvido_vaciar_textos() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER olvido_vaciar_textos_al_purgar
  AFTER UPDATE OF purgado_en ON public.olvido_solicitudes
  FOR EACH ROW
  WHEN (OLD.purgado_en IS NULL AND NEW.purgado_en IS NOT NULL)
  EXECUTE FUNCTION privado.olvido_vaciar_textos();

-- ---- 2. Lo que falta, calculado en el momento ----
-- Un tutor legal del niño a efectos del olvido: con el vínculo vivo, o retirado por la baja
-- (con la baja la familia pierde el vínculo, y sigue pudiendo pedir y retirar).
CREATE FUNCTION privado.es_tutor_legal_olvido(p_nino_id uuid, p_usuario_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.vinculos_familiares v
     WHERE v.nino_id = p_nino_id AND v.usuario_id = p_usuario_id
       AND v.tipo_vinculo IN ('tutor_legal_principal', 'tutor_legal_secundario')
       AND (v.deleted_at IS NULL OR v.deleted_reason = 'baja_nino'));
$function$;
REVOKE ALL ON FUNCTION privado.es_tutor_legal_olvido(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- {"bloqueos": [{"codigo", "n"}], "avisos": [{"codigo", "n"}]}. Un recibo sin cerrar: en
-- borrador o por procesar con importe, o devuelto sin resolver.
CREATE FUNCTION privado.olvido_bloqueos(
  p_sujeto_tipo public.olvido_sujeto_tipo, p_sujeto_id uuid, p_centro_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_bloqueos jsonb := '[]'::jsonb;
  v_avisos   jsonb := '[]'::jsonb;
  v_familias uuid[];
  v_n        integer;
BEGIN
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
      v_bloqueos := v_bloqueos || jsonb_build_object('codigo', 'recibos_familia_pendientes', 'n', v_n);
    END IF;
  ELSE
    SELECT count(DISTINCT n.id) INTO v_n FROM public.vinculos_familiares v
      JOIN public.ninos n ON n.id = v.nino_id
     WHERE v.usuario_id = p_sujeto_id AND v.deleted_at IS NULL AND n.centro_id = p_centro_id
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
REVOKE ALL ON FUNCTION privado.olvido_bloqueos(public.olvido_sujeto_tipo, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- ---- 3. Pedir ----
CREATE FUNCTION public.pedir_olvido_nino(p_nino_id uuid, p_inmediato boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_centro uuid;
  v_motivo public.motivo_borrado;
  v_tutor  boolean;
  v_id     uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no autorizado: hace falta una sesión' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT centro_id, deleted_reason INTO v_centro, v_motivo FROM public.ninos WHERE id = p_nino_id;
  IF v_centro IS NULL THEN
    RAISE EXCEPTION 'niño no encontrado' USING ERRCODE = 'no_data_found';
  END IF;
  v_tutor := privado.es_tutor_legal_olvido(p_nino_id, v_uid);
  IF NOT v_tutor AND NOT privado.es_responsable(v_centro) THEN
    RAISE EXCEPTION 'no autorizado a pedir el olvido de este niño'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_motivo = 'purga_rgpd' THEN
    RAISE EXCEPTION 'los datos de este niño ya se borraron'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'ya_borrado';
  END IF;

  BEGIN
    INSERT INTO public.olvido_solicitudes
      (sujeto_tipo, sujeto_id, centro_id, solicitado_por, inmediato, pedida_por_centro)
    VALUES ('nino', p_nino_id, v_centro, v_uid, p_inmediato, NOT v_tutor)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ya hay una petición abierta' USING ERRCODE = 'unique_violation', HINT = 'ya_pedida';
  END;
  RETURN v_id;
END;
$function$;

CREATE FUNCTION public.pedir_olvido_usuario(
  p_usuario_id uuid, p_centro_id uuid, p_inmediato boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_familia boolean;
  v_propio  boolean;
  v_id      uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no autorizado: hace falta una sesión' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.centros WHERE id = p_centro_id) THEN
    RAISE EXCEPTION 'centro no encontrado' USING ERRCODE = 'no_data_found';
  END IF;
  -- De una familia del centro: perfil de tutor, o un rol de familia (vivo o retirado).
  v_familia := EXISTS (SELECT 1 FROM public.familia_tutores
                        WHERE usuario_id = p_usuario_id AND centro_id = p_centro_id)
            OR EXISTS (SELECT 1 FROM public.roles_usuario
                        WHERE usuario_id = p_usuario_id AND centro_id = p_centro_id
                          AND rol::text IN ('tutor_legal', 'autorizado'));
  v_propio := p_usuario_id = v_uid;
  IF v_propio THEN
    -- Por sí misma, solo una persona de una familia: el personal lo tramita Dirección.
    IF NOT v_familia THEN
      RAISE EXCEPTION 'no autorizado a pedir el olvido en este centro'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NOT privado.es_responsable(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado a pedir el olvido en este centro'
      USING ERRCODE = 'insufficient_privilege';
  ELSIF NOT v_familia AND NOT EXISTS (SELECT 1 FROM public.roles_usuario
                                       WHERE usuario_id = p_usuario_id AND centro_id = p_centro_id) THEN
    RAISE EXCEPTION 'el usuario no está en este centro' USING ERRCODE = 'no_data_found';
  END IF;

  BEGIN
    INSERT INTO public.olvido_solicitudes
      (sujeto_tipo, sujeto_id, centro_id, solicitado_por, inmediato, pedida_por_centro)
    VALUES ('usuario', p_usuario_id, p_centro_id, v_uid, p_inmediato, NOT v_propio)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ya hay una petición abierta' USING ERRCODE = 'unique_violation', HINT = 'ya_pedida';
  END;
  RETURN v_id;
END;
$function$;

-- ---- 4. Retirar (la familia, mientras está pendiente) ----
CREATE FUNCTION public.retirar_peticion_olvido(p_solicitud_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  s     public.olvido_solicitudes%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no autorizado: hace falta una sesión' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO s FROM public.olvido_solicitudes WHERE id = p_solicitud_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'petición no encontrada' USING ERRCODE = 'no_data_found';
  END IF;
  -- Quien la pidió; en la de un hijo, cualquiera de sus tutores legales; en la de una cuenta,
  -- la propia persona.
  IF NOT (s.solicitado_por = v_uid
          OR (s.sujeto_tipo = 'usuario' AND s.sujeto_id = v_uid)) THEN
    RAISE EXCEPTION 'no autorizado a retirar esta petición' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF s.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'solo se retira una petición pendiente'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'no_pendiente';
  END IF;
  UPDATE public.olvido_solicitudes
     SET estado = 'retirada', retirada_en = now(), retirada_por = v_uid
   WHERE id = p_solicitud_id;
END;
$function$;

-- ---- 5. La titular: confirmar, rechazar, nota, deshacer ----
CREATE FUNCTION public.confirmar_peticion_olvido(p_solicitud_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  s        public.olvido_solicitudes%ROWTYPE;
  v_falta  jsonb;
  v_previo jsonb;
  v_gracia timestamptz;
BEGIN
  SELECT * INTO s FROM public.olvido_solicitudes WHERE id = p_solicitud_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'petición no encontrada' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_uid IS NULL OR NOT privado.es_responsable(s.centro_id) THEN
    RAISE EXCEPTION 'no autorizado a ejercer el olvido en este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF s.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'solo se confirma una petición pendiente'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'no_pendiente';
  END IF;
  v_falta := privado.olvido_bloqueos(s.sujeto_tipo, s.sujeto_id, s.centro_id);
  IF false AND jsonb_array_length(v_falta -> 'bloqueos') > 0 THEN
    RAISE EXCEPTION 'todavía falta algo para confirmar'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'hay_bloqueos',
            DETAIL = (v_falta -> 'bloqueos')::text;
  END IF;

  -- Lo que antes hacía pedir. Se guarda cómo estaba, para poder deshacerlo.
  IF s.sujeto_tipo = 'nino' THEN
    SELECT jsonb_build_object('deleted_at', deleted_at, 'deleted_reason', deleted_reason)
      INTO v_previo FROM public.ninos WHERE id = s.sujeto_id;
    UPDATE public.ninos
       SET deleted_at = COALESCE(deleted_at, now()),
           deleted_reason = CASE WHEN deleted_reason = 'purga_rgpd'
                                 THEN 'purga_rgpd'::public.motivo_borrado
                                 ELSE 'solicitud_olvido'::public.motivo_borrado END
     WHERE id = s.sujeto_id;
  ELSE
    SELECT jsonb_build_object('usuario_deleted_at', deleted_at)
      INTO v_previo FROM public.usuarios WHERE id = s.sujeto_id;
    UPDATE public.roles_usuario
       SET deleted_at = now(), deleted_reason = 'solicitud_olvido'
     WHERE usuario_id = s.sujeto_id AND centro_id = s.centro_id AND deleted_at IS NULL;
    IF NOT EXISTS (SELECT 1 FROM public.roles_usuario
                    WHERE usuario_id = s.sujeto_id AND deleted_at IS NULL
                      AND centro_id <> s.centro_id) THEN
      UPDATE public.usuarios SET deleted_at = COALESCE(deleted_at, now()) WHERE id = s.sujeto_id;
    END IF;
  END IF;

  v_gracia := CASE WHEN s.inmediato THEN now() ELSE now() + interval '7 days' END;
  UPDATE public.olvido_solicitudes
     SET estado = 'confirmada', confirmada_en = now(), confirmada_por = v_uid,
         gracia_hasta = v_gracia, estado_previo = v_previo
   WHERE id = p_solicitud_id;
  RETURN v_gracia;
END;
$function$;

CREATE FUNCTION public.rechazar_peticion_olvido(p_solicitud_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  s     public.olvido_solicitudes%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.olvido_solicitudes WHERE id = p_solicitud_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'petición no encontrada' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_uid IS NULL OR NOT privado.es_responsable(s.centro_id) THEN
    RAISE EXCEPTION 'no autorizado a ejercer el olvido en este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF s.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'solo se rechaza una petición pendiente'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'no_pendiente';
  END IF;
  IF p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'el motivo es obligatorio (hasta 1000 caracteres)'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'motivo_obligatorio';
  END IF;
  UPDATE public.olvido_solicitudes
     SET estado = 'rechazada', rechazada_en = now(), rechazada_por = v_uid,
         motivo_rechazo = btrim(p_motivo)
   WHERE id = p_solicitud_id;
END;
$function$;

CREATE FUNCTION public.nota_peticion_olvido(p_solicitud_id uuid, p_nota text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  IF s.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'solo se anota una petición pendiente'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'no_pendiente';
  END IF;
  IF char_length(btrim(coalesce(p_nota, ''))) > 1000 THEN
    RAISE EXCEPTION 'la nota tiene hasta 1000 caracteres' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE public.olvido_solicitudes
     SET nota_centro = nullif(btrim(coalesce(p_nota, '')), '')
   WHERE id = p_solicitud_id;
END;
$function$;

CREATE FUNCTION public.deshacer_confirmacion_olvido(p_solicitud_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- ---- 6. Lecturas ----
CREATE FUNCTION public.peticiones_olvido_centro(p_centro_id uuid)
RETURNS TABLE (
  id uuid, sujeto_tipo public.olvido_sujeto_tipo, sujeto_id uuid, sujeto_nombre text,
  solicitado_por_nombre text, pedida_por_centro boolean, solicitado_en timestamptz,
  estado public.olvido_estado, inmediato boolean, confirmada_en timestamptz,
  gracia_hasta timestamptz, rechazada_en timestamptz, motivo_rechazo text,
  retirada_en timestamptz, nota_centro text, purgado_en timestamptz, falta jsonb)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT privado.es_responsable(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado a ejercer el olvido en este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT s.id, s.sujeto_tipo, s.sujeto_id,
         CASE WHEN s.sujeto_tipo = 'nino'
              THEN (SELECT btrim(n.nombre || ' ' || coalesce(n.apellidos, '')) FROM public.ninos n WHERE n.id = s.sujeto_id)
              ELSE (SELECT u.nombre_completo FROM public.usuarios u WHERE u.id = s.sujeto_id) END,
         (SELECT u.nombre_completo FROM public.usuarios u WHERE u.id = s.solicitado_por),
         s.pedida_por_centro, s.solicitado_en, s.estado, s.inmediato, s.confirmada_en,
         s.gracia_hasta, s.rechazada_en, s.motivo_rechazo, s.retirada_en, s.nota_centro,
         s.purgado_en,
         CASE WHEN s.estado = 'pendiente'
              THEN privado.olvido_bloqueos(s.sujeto_tipo, s.sujeto_id, s.centro_id) END
    FROM public.olvido_solicitudes s
   WHERE s.centro_id = p_centro_id
     AND ((s.estado IN ('pendiente', 'confirmada') AND s.purgado_en IS NULL)
          OR coalesce(s.purgado_en, s.rechazada_en, s.retirada_en) >= now() - interval '90 days')
   ORDER BY s.solicitado_en;
END;
$function$;

CREATE FUNCTION public.mis_peticiones_olvido()
RETURNS TABLE (
  id uuid, sujeto_tipo public.olvido_sujeto_tipo, sujeto_id uuid, sujeto_nombre text,
  centro_id uuid, centro_nombre text, pedida_por_mi boolean, pedida_por_centro boolean,
  solicitado_en timestamptz, estado public.olvido_estado, inmediato boolean,
  confirmada_en timestamptz, gracia_hasta timestamptz, rechazada_en timestamptz,
  motivo_rechazo text, retirada_en timestamptz, nota_centro text, purgado_en timestamptz,
  falta jsonb, puede_retirar boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no autorizado: hace falta una sesión' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT s.id, s.sujeto_tipo, s.sujeto_id,
         CASE WHEN s.sujeto_tipo = 'nino'
              THEN (SELECT n.nombre FROM public.ninos n WHERE n.id = s.sujeto_id)
              ELSE (SELECT u.nombre_completo FROM public.usuarios u WHERE u.id = s.sujeto_id) END,
         s.centro_id, (SELECT c.nombre FROM public.centros c WHERE c.id = s.centro_id),
         s.solicitado_por = v_uid, s.pedida_por_centro, s.solicitado_en, s.estado, s.inmediato,
         s.confirmada_en, s.gracia_hasta, s.rechazada_en, s.motivo_rechazo, s.retirada_en,
         s.nota_centro, s.purgado_en,
         CASE WHEN s.estado = 'pendiente'
              THEN privado.olvido_bloqueos(s.sujeto_tipo, s.sujeto_id, s.centro_id) END,
         s.estado = 'pendiente'
    FROM public.olvido_solicitudes s
   WHERE s.solicitado_por = v_uid
      OR (s.sujeto_tipo = 'usuario' AND s.sujeto_id = v_uid)
      OR (s.sujeto_tipo = 'nino' AND privado.es_tutor_legal_olvido(s.sujeto_id, v_uid))
   ORDER BY s.solicitado_en DESC;
END;
$function$;

-- Lo que la persona puede pedir: sus hijos (tutor legal) y su cuenta en cada centro de familia,
-- sin una petición abierta.
CREATE FUNCTION public.opciones_olvido()
RETURNS TABLE (sujeto_tipo public.olvido_sujeto_tipo, sujeto_id uuid, centro_id uuid,
               nombre text, centro_nombre text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no autorizado: hace falta una sesión' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT 'nino'::public.olvido_sujeto_tipo, n.id, n.centro_id, n.nombre, c.nombre
    FROM public.ninos n JOIN public.centros c ON c.id = n.centro_id
   WHERE privado.es_tutor_legal_olvido(n.id, v_uid)
     AND n.deleted_reason IS DISTINCT FROM 'purga_rgpd'
     AND NOT EXISTS (SELECT 1 FROM public.olvido_solicitudes s
                      WHERE s.sujeto_tipo = 'nino' AND s.sujeto_id = n.id
                        AND s.purgado_en IS NULL AND s.estado IN ('pendiente', 'confirmada'))
  UNION ALL
  SELECT 'usuario'::public.olvido_sujeto_tipo, v_uid, c.id,
         (SELECT u.nombre_completo FROM public.usuarios u WHERE u.id = v_uid), c.nombre
    FROM public.centros c
   WHERE (EXISTS (SELECT 1 FROM public.familia_tutores ft
                   WHERE ft.usuario_id = v_uid AND ft.centro_id = c.id)
          OR EXISTS (SELECT 1 FROM public.roles_usuario r
                      WHERE r.usuario_id = v_uid AND r.centro_id = c.id
                        AND r.rol::text IN ('tutor_legal', 'autorizado')))
     AND NOT EXISTS (SELECT 1 FROM public.olvido_solicitudes s
                      WHERE s.sujeto_tipo = 'usuario' AND s.sujeto_id = v_uid AND s.centro_id = c.id
                        AND s.purgado_en IS NULL AND s.estado IN ('pendiente', 'confirmada'))
   ORDER BY 1, 4;
END;
$function$;

-- A quién se le escribe de una petición (solo el servidor): la familia. Quien la pidió (si no fue
-- el centro), los tutores legales del niño o la propia persona.
CREATE FUNCTION public.olvido_destinatarios(p_solicitud_id uuid)
RETURNS TABLE (usuario_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT DISTINCT x.u FROM public.olvido_solicitudes s
   CROSS JOIN LATERAL (
     SELECT s.solicitado_por WHERE NOT s.pedida_por_centro AND s.solicitado_por IS NOT NULL
     UNION
     SELECT v.usuario_id FROM public.vinculos_familiares v
      WHERE s.sujeto_tipo = 'nino' AND v.nino_id = s.sujeto_id
        AND v.tipo_vinculo IN ('tutor_legal_principal', 'tutor_legal_secundario')
        AND (v.deleted_at IS NULL OR v.deleted_reason = 'baja_nino')
     UNION
     SELECT s.sujeto_id WHERE s.sujeto_tipo = 'usuario'
   ) x(u)
   WHERE s.id = p_solicitud_id AND x.u IS NOT NULL;
$function$;

-- ---- 7. Lo que ya había ----
-- Registrar y confirmar de una vez: solo el servidor (los tests y las herramientas). Como al
-- confirmar, 7 días de gracia y el estado de antes guardado.
CREATE OR REPLACE FUNCTION public.solicitar_olvido_nino(p_nino_id uuid, p_inmediato boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro uuid;
  v_gracia timestamptz;
  v_previo jsonb;
  v_id     uuid;
BEGIN
  IF auth.uid() IS NULL
     AND NOT (COALESCE(auth.role(), '') = 'service_role'
              OR (session_user <> 'authenticator'
                  AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                  AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
    RAISE EXCEPTION 'no autorizado: sin sesión solo el servicio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT centro_id, jsonb_build_object('deleted_at', deleted_at, 'deleted_reason', deleted_reason)
    INTO v_centro, v_previo FROM public.ninos WHERE id = p_nino_id;
  IF v_centro IS NULL THEN
    RAISE EXCEPTION 'niño no encontrado: %', p_nino_id USING ERRCODE = 'no_data_found';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT privado.es_responsable(v_centro) THEN
    RAISE EXCEPTION 'no autorizado a ejercer el olvido en este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_gracia := CASE WHEN p_inmediato THEN now() ELSE now() + interval '7 days' END;

  UPDATE public.ninos
     SET deleted_at = COALESCE(deleted_at, now()),
         deleted_reason = CASE WHEN deleted_reason = 'purga_rgpd'
                               THEN 'purga_rgpd'::public.motivo_borrado
                               ELSE 'solicitud_olvido'::public.motivo_borrado END
   WHERE id = p_nino_id;

  INSERT INTO public.olvido_solicitudes
    (sujeto_tipo, sujeto_id, centro_id, solicitado_por, gracia_hasta, inmediato,
     estado, confirmada_en, confirmada_por, estado_previo, pedida_por_centro)
  VALUES ('nino', p_nino_id, v_centro, auth.uid(), v_gracia, p_inmediato,
          'confirmada', now(), auth.uid(), v_previo, true)
  ON CONFLICT (sujeto_tipo, sujeto_id, centro_id)
    WHERE purgado_en IS NULL AND estado IN ('pendiente', 'confirmada')
  DO UPDATE SET
    estado         = 'confirmada',
    confirmada_en  = COALESCE(public.olvido_solicitudes.confirmada_en, now()),
    confirmada_por = COALESCE(public.olvido_solicitudes.confirmada_por, auth.uid()),
    gracia_hasta   = LEAST(public.olvido_solicitudes.gracia_hasta, EXCLUDED.gracia_hasta),
    inmediato      = public.olvido_solicitudes.inmediato OR EXCLUDED.inmediato,
    estado_previo  = COALESCE(public.olvido_solicitudes.estado_previo, EXCLUDED.estado_previo)
  RETURNING id INTO v_id;

  RETURN v_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.solicitar_olvido_usuario(p_usuario_id uuid, p_centro_id uuid, p_inmediato boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gracia timestamptz;
  v_previo jsonb;
  v_id     uuid;
BEGIN
  IF auth.uid() IS NULL
     AND NOT (COALESCE(auth.role(), '') = 'service_role'
              OR (session_user <> 'authenticator'
                  AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                  AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
    RAISE EXCEPTION 'no autorizado: sin sesión solo el servicio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE id = p_usuario_id) THEN
    RAISE EXCEPTION 'usuario no encontrado: %', p_usuario_id USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.centros WHERE id = p_centro_id) THEN
    RAISE EXCEPTION 'centro no encontrado: %', p_centro_id USING ERRCODE = 'no_data_found';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT privado.es_responsable(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado a ejercer el olvido en este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.roles_usuario
                  WHERE usuario_id = p_usuario_id AND centro_id = p_centro_id)
     AND NOT EXISTS (SELECT 1 FROM public.familia_tutores
                      WHERE usuario_id = p_usuario_id AND centro_id = p_centro_id) THEN
    RAISE EXCEPTION 'el usuario no está en este centro' USING ERRCODE = 'no_data_found';
  END IF;

  v_gracia := CASE WHEN p_inmediato THEN now() ELSE now() + interval '7 days' END;
  SELECT jsonb_build_object('usuario_deleted_at', deleted_at) INTO v_previo
    FROM public.usuarios WHERE id = p_usuario_id;

  UPDATE public.roles_usuario
     SET deleted_at = now(), deleted_reason = 'solicitud_olvido'
   WHERE usuario_id = p_usuario_id AND centro_id = p_centro_id AND deleted_at IS NULL;

  IF NOT EXISTS (SELECT 1 FROM public.roles_usuario
                  WHERE usuario_id = p_usuario_id AND deleted_at IS NULL
                    AND centro_id <> p_centro_id) THEN
    UPDATE public.usuarios SET deleted_at = COALESCE(deleted_at, now()) WHERE id = p_usuario_id;
  END IF;

  INSERT INTO public.olvido_solicitudes
    (sujeto_tipo, sujeto_id, centro_id, solicitado_por, gracia_hasta, inmediato,
     estado, confirmada_en, confirmada_por, estado_previo, pedida_por_centro)
  VALUES ('usuario', p_usuario_id, p_centro_id, auth.uid(), v_gracia, p_inmediato,
          'confirmada', now(), auth.uid(), v_previo, true)
  ON CONFLICT (sujeto_tipo, sujeto_id, centro_id)
    WHERE purgado_en IS NULL AND estado IN ('pendiente', 'confirmada')
  DO UPDATE SET
    estado         = 'confirmada',
    confirmada_en  = COALESCE(public.olvido_solicitudes.confirmada_en, now()),
    confirmada_por = COALESCE(public.olvido_solicitudes.confirmada_por, auth.uid()),
    gracia_hasta   = LEAST(public.olvido_solicitudes.gracia_hasta, EXCLUDED.gracia_hasta),
    inmediato      = public.olvido_solicitudes.inmediato OR EXCLUDED.inmediato,
    estado_previo  = COALESCE(public.olvido_solicitudes.estado_previo, EXCLUDED.estado_previo)
  RETURNING id INTO v_id;

  RETURN v_id;
END
$function$;

-- La purga solo coge las confirmadas cuya gracia ha vencido.
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
    AND ((auth.uid() IS NULL
          AND (COALESCE(auth.role(), '') = 'service_role'
               OR (session_user <> 'authenticator'
                   AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                   AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)))
         OR privado.es_responsable(s.centro_id))
  ORDER BY s.gracia_hasta;
$function$;

-- «Su último centro»: otra petición pendiente de purga solo cuenta si está confirmada (una
-- pendiente no ha retirado nada; una rechazada o retirada no se purga nunca).
CREATE OR REPLACE FUNCTION public.olvido_es_ultimo_centro(p_solicitud_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.sujeto_tipo <> 'usuario'
      OR (NOT EXISTS (SELECT 1 FROM public.roles_usuario r
                       WHERE r.usuario_id = s.sujeto_id AND r.deleted_at IS NULL
                         AND r.centro_id <> s.centro_id)
          AND NOT EXISTS (SELECT 1 FROM public.olvido_solicitudes o
                           WHERE o.sujeto_tipo = 'usuario' AND o.sujeto_id = s.sujeto_id
                             AND o.purgado_en IS NULL AND o.estado = 'confirmada'
                             AND o.id <> s.id))
  FROM public.olvido_solicitudes s
  WHERE s.id = p_solicitud_id;
$function$;

-- ---- 8. Permisos ----
REVOKE ALL ON FUNCTION public.pedir_olvido_nino(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pedir_olvido_usuario(uuid, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.retirar_peticion_olvido(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirmar_peticion_olvido(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rechazar_peticion_olvido(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nota_peticion_olvido(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.deshacer_confirmacion_olvido(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.peticiones_olvido_centro(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mis_peticiones_olvido() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.opciones_olvido() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pedir_olvido_nino(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pedir_olvido_usuario(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retirar_peticion_olvido(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_peticion_olvido(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rechazar_peticion_olvido(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nota_peticion_olvido(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deshacer_confirmacion_olvido(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.peticiones_olvido_centro(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mis_peticiones_olvido() TO authenticated;
GRANT EXECUTE ON FUNCTION public.opciones_olvido() TO authenticated;

-- Solo el servidor.
REVOKE ALL ON FUNCTION public.olvido_destinatarios(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.olvido_destinatarios(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.solicitar_olvido_nino(uuid, boolean) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.solicitar_olvido_usuario(uuid, uuid, boolean) FROM authenticated;

COMMENT ON TABLE public.olvido_solicitudes IS
  'Peticiones de olvido (art. 17). pendiente → confirmada (la titular, sin bloqueos; borrado lógico y 7 días para deshacer) → purgado_en; o rechazada (con motivo) o retirada (la familia). Solo se escribe por funciones (20261126120000).';

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_md5 text;
  v_n   integer;
BEGIN
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'olvido_solicitudes'
     AND column_name IN ('estado', 'pedida_por_centro', 'confirmada_en', 'confirmada_por',
                         'rechazada_en', 'rechazada_por', 'motivo_rechazo', 'retirada_en',
                         'retirada_por', 'nota_centro', 'estado_previo');
  IF v_n <> 11 THEN
    RAISE EXCEPTION 'faltan columnas de olvido_solicitudes: % de 11', v_n;
  END IF;

  IF to_regclass('public.olvido_solicitudes_sujeto_centro_abierta') IS NULL
     OR to_regclass('public.olvido_solicitudes_sujeto_centro_pendiente') IS NOT NULL
     OR pg_get_indexdef('public.olvido_solicitudes_sujeto_centro_abierta'::regclass) NOT LIKE '%UNIQUE%'
     OR pg_get_indexdef('public.olvido_solicitudes_sujeto_centro_abierta'::regclass) NOT LIKE '%purgado_en IS NULL%'
     OR pg_get_indexdef('public.olvido_solicitudes_sujeto_centro_abierta'::regclass) NOT LIKE '%pendiente%confirmada%' THEN
    RAISE EXCEPTION 'el índice de la petición abierta no es el esperado';
  END IF;

  -- La familia y la titular, con sesión; el resto, solo el servidor.
  IF NOT has_function_privilege('authenticated', 'public.pedir_olvido_nino(uuid,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.confirmar_peticion_olvido(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.mis_peticiones_olvido()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated no puede pedir, confirmar o leer sus peticiones';
  END IF;
  IF has_function_privilege('authenticated', 'public.solicitar_olvido_nino(uuid,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.solicitar_olvido_usuario(uuid,uuid,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.olvido_destinatarios(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'privado.olvido_bloqueos(public.olvido_sujeto_tipo,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.pedir_olvido_nino(uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'una función del olvido quedó abierta a quien no toca';
  END IF;

  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.olvido_pendientes()');
  IF v_md5 IS DISTINCT FROM '486e64495d37898a6627f8e70cd563d8' THEN
    RAISE EXCEPTION 'olvido_pendientes no quedó como este fichero: %', v_md5;
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.olvido_es_ultimo_centro(uuid)');
  IF v_md5 IS DISTINCT FROM '6d7a4056d5679fa61fa084ce31085ec5' THEN
    RAISE EXCEPTION 'olvido_es_ultimo_centro no quedó como este fichero: %', v_md5;
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.solicitar_olvido_nino(uuid,boolean)');
  IF v_md5 IS DISTINCT FROM 'abe89af01de963eafc89576b31081cd4' THEN
    RAISE EXCEPTION 'solicitar_olvido_nino no quedó como este fichero: %', v_md5;
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.solicitar_olvido_usuario(uuid,uuid,boolean)');
  IF v_md5 IS DISTINCT FROM 'abe6442b19121a0f5eb6940c52717cc4' THEN
    RAISE EXCEPTION 'solicitar_olvido_usuario no quedó como este fichero: %', v_md5;
  END IF;

  SELECT count(*) INTO v_n FROM public.olvido_solicitudes WHERE estado <> 'confirmada';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% solicitudes anteriores no quedaron confirmadas', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.olvido_solicitudes;
  RAISE NOTICE 'guarda posterior: estados, funciones y permisos en su sitio; % solicitudes, todas confirmadas', v_n;
END
$guarda$;
