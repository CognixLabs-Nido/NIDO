-- =============================================================================
-- FEAT — Retención (F11-B, punto 6, PR-8, segunda pieza): las firmas y la cuenta del tutor al vencer
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/retencion-plazos.md. Hasta aquí, lo que se conserva por obligación (las firmas,
-- los consentimientos, la medicación administrada…) quedaba bloqueado tras la purga, para siempre;
-- y la cuenta de un tutor solo se purgaba si la pedía. Decisiones de Jose (2026-10-29):
--
--   · Las firmas se destruyen a los 5 años de la baja del niño, y solo con el niño ya purgado (la
--     purga del expediente, al mismo plazo, va antes en el cron): sus firmas, sus acuses del alta,
--     sus consentimientos, la medicación administrada, sus autorizaciones y los eventos de ámbito
--     niño, de los que cuelgan. Sin copia en audit_log.
--   · La cuenta del tutor se purga, como en el olvido y sin que nadie lo pida, a los 5 años de la
--     baja de su último hijo en el centro, si no le queda otro rol vivo allí (admin, directora o
--     profe). «Sus hijos» son todos los que ha tenido, por vínculo o por familia, aunque el vínculo
--     esté borrado; todos tienen que estar de baja, y cuenta la baja más tardía. Las cuentas de
--     autorizado, igual, con sus hijos por vínculo. Multicentro: solo ese centro, y la cuenta
--     entera con el último, como el olvido.
--   · La purga por plazo crea una petición «del centro, por plazo» (`por_plazo`), sin gracia, y la
--     purga en el acto: así lo ya aplicado (Datos bloqueados, la exportación, qué firmas se
--     bloquean, la lista de sujetos) sigue funcionando sin tocarlo. Con su etiqueta en Olvido. Sin
--     correo al tutor, como el expediente del niño.
--   · Si la familia tiene un recibo pendiente o devuelto sin resolver, la cuenta espera: mientras
--     quede algo pendiente no se destruye nada (los bloqueos del olvido, los mismos).
--   · La retención manda: el niño retenido conserva todo lo suyo; el tutor retenido, su cuenta y
--     sus firmas y consentimientos, y la autorización de la que cuelgan.
--   · El registro de accesos de un sujeto se destruye cuando ya no le queda nada bloqueado en el
--     centro (las lecturas de la ficha tienen su plazo, de 60 meses, y el registro las espera).
--   · Los consentimientos de la cuenta (sin niño) se van con la cuenta, al mismo plazo.
--
-- La aplica el responsable por SQL Editor. Sin orden obligado con el despliegue: las dos funciones
-- de las listas de Olvido devuelven una columna más, que la app de main no lee, y no se revoca nada
-- de lo que usa. Hoy no vence nada (ningún niño de baja). Tras aplicar: registrar en
-- supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  r     record;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'olvido_solicitudes'
                AND column_name = 'por_plazo') THEN
    RAISE EXCEPTION 'ya aplicada: olvido_solicitudes ya tiene por_plazo';
  END IF;
  IF to_regclass('public.retenciones') IS NULL
     OR to_regprocedure('privado.retenido(uuid,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'falta 20261206120000 (la retención): esta va detrás';
  END IF;

  -- Lo que se reescribe es lo que hay, tal como quedó.
  FOR r IN SELECT * FROM (VALUES
      ('public.olvido_pendientes()', '4fe6841a64643392148f935228b3e18f', '20261206120000'),
      ('public.poner_retencion(uuid,jsonb,text,text)', '8f8cb63c24ff87ddd44f3c42c0edfc9e',
       '20261206120000'),
      ('public.purgar_sujeto_db(uuid)', 'b796e148c3401e16b723adfdba87ffad', '20261206120000'),
      ('public.peticiones_olvido_centro(uuid)', 'b025eac71447d50e8d5bf6a664295eb3',
       '20261126120000'),
      ('public.mis_peticiones_olvido()', '9464860b101153d838936ec4198d7e85', '20261126120000')
    ) AS t(f, md5, mig)
  LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f);
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION '% no es la de %: %', r.f, r.mig, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;

  RAISE NOTICE 'guarda previa: % niños de baja, % purgados, % firmas, % acuses, % consentimientos (% sin niño), % retenciones vivas',
    (SELECT count(*) FROM public.ninos WHERE deleted_reason = 'baja_nino'),
    (SELECT count(*) FROM public.ninos WHERE deleted_reason = 'purga_rgpd'),
    (SELECT count(*) FROM public.firmas_autorizacion),
    (SELECT count(*) FROM public.acuses_alta),
    (SELECT count(*) FROM public.consentimientos),
    (SELECT count(*) FROM public.consentimientos WHERE nino_id IS NULL),
    (SELECT count(*) FROM public.retenciones WHERE quitada_en IS NULL);
END
$guarda$;

-- ---- 1. La petición por plazo ----
-- La crea el cron (abrir_purga_cuenta), confirmada y sin gracia, y la purga en el acto. Nunca está
-- pendiente: ni la retención ni el «deshacer» la devuelven ahí (el CHECK es la red).
ALTER TABLE public.olvido_solicitudes ADD COLUMN por_plazo boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.olvido_solicitudes.por_plazo IS
  'La creó el plazo de la cuenta (20261207120000), no una persona: se purga en el acto y sin correo.';
ALTER TABLE public.olvido_solicitudes ADD CONSTRAINT olvido_por_plazo_coherente
  CHECK (NOT por_plazo OR (sujeto_tipo = 'usuario' AND pedida_por_centro AND solicitado_por IS NULL
                           AND estado = 'confirmada'));

-- ---- 2. Los predicados ----

-- La baja del niño, también purgado: la más tardía entre el archivado y la `fecha_baja` de sus
-- matrículas (la purga conserva las dos). NULL si no está de baja o tiene una matrícula viva.
CREATE FUNCTION privado.fecha_baja_destruccion(p_nino_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT GREATEST((n.deleted_at AT TIME ZONE 'Europe/Madrid')::date,
                  (SELECT max(m.fecha_baja) FROM public.matriculas m
                    WHERE m.nino_id = n.id AND m.deleted_at IS NULL))
    FROM public.ninos n
   WHERE n.id = p_nino_id AND n.deleted_reason IN ('baja_nino', 'purga_rgpd')
     AND NOT EXISTS (SELECT 1 FROM public.matriculas m
                      WHERE m.nino_id = n.id AND m.deleted_at IS NULL AND m.estado <> 'baja');
$function$;

-- Ha pasado el plazo desde el día siguiente a esa fecha (hora de Madrid), como el expediente.
CREATE FUNCTION privado.plazo_cumplido(p_fecha date, p_anios integer)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT COALESCE((p_fecha + 1)::timestamp AT TIME ZONE 'Europe/Madrid'
                  < now() - make_interval(years => p_anios), false);
$function$;

-- Las firmas del niño han vencido: purgado, con el plazo cumplido desde su baja, y sin retener.
CREATE FUNCTION privado.firmas_nino_vencidas(p_nino_id uuid, p_anios integer)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.ninos n
                  WHERE n.id = p_nino_id AND n.deleted_reason = 'purga_rgpd'
                    AND privado.plazo_cumplido(privado.fecha_baja_destruccion(n.id), p_anios)
                    AND NOT privado.retenido(n.centro_id, 'nino', n.id));
$function$;

-- Le queda algo de lo que se conserva por obligación y destruye este paso.
CREATE FUNCTION privado.queda_conservado_nino(p_nino_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.firmas_autorizacion WHERE nino_id = p_nino_id)
      OR EXISTS (SELECT 1 FROM public.acuses_alta WHERE nino_id = p_nino_id)
      OR EXISTS (SELECT 1 FROM public.consentimientos WHERE nino_id = p_nino_id)
      OR EXISTS (SELECT 1 FROM public.administraciones_medicacion WHERE nino_id = p_nino_id)
      OR EXISTS (SELECT 1 FROM public.autorizaciones WHERE nino_id = p_nino_id)
      OR EXISTS (SELECT 1 FROM public.eventos WHERE ambito = 'nino' AND nino_id = p_nino_id);
$function$;

-- Su registro de accesos ya no tiene nada que mirar: ni lo conservado ni las lecturas de su ficha
-- (que se van con su plazo, y el registro las espera).
CREATE FUNCTION privado.accesos_nino_sin_objeto(p_nino_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT NOT privado.queda_conservado_nino(p_nino_id)
     AND NOT EXISTS (SELECT 1 FROM public.lecturas_ficha_medica WHERE nino_id = p_nino_id);
$function$;

-- Le queda algo que destruir: lo conservado, o un registro de accesos que ya puede irse.
CREATE FUNCTION privado.quedan_firmas_nino(p_nino_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT privado.queda_conservado_nino(p_nino_id)
      OR (EXISTS (SELECT 1 FROM public.accesos_datos_bloqueados
                   WHERE sujeto_tipo = 'nino' AND sujeto_id = p_nino_id)
          AND privado.accesos_nino_sin_objeto(p_nino_id));
$function$;

-- Lo de un usuario en un centro que un acceso pudo mirar (privado.contenido_bloqueado).
CREATE FUNCTION privado.quedan_firmas_usuario(p_centro_id uuid, p_usuario_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.firmas_autorizacion f
                  WHERE f.firmante_id = p_usuario_id AND privado.centro_de_nino(f.nino_id) = p_centro_id)
      OR EXISTS (SELECT 1 FROM public.consentimientos c
                  WHERE c.usuario_id = p_usuario_id AND c.nino_id IS NOT NULL
                    AND privado.centro_de_nino(c.nino_id) = p_centro_id)
      OR EXISTS (SELECT 1 FROM public.acuses_alta aa
                  WHERE aa.firmante_id = p_usuario_id AND aa.centro_id = p_centro_id);
$function$;

-- Los hijos de un usuario en un centro: todos los que ha tenido, por vínculo (no el de Dirección)
-- o por familia, aunque el vínculo o su perfil de la familia estén borrados.
CREATE FUNCTION privado.hijos_cuenta(p_usuario_id uuid, p_centro_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT n.id FROM public.ninos n
   WHERE n.centro_id = p_centro_id
     AND (EXISTS (SELECT 1 FROM public.vinculos_familiares v
                   WHERE v.nino_id = n.id AND v.usuario_id = p_usuario_id
                     AND v.tipo_vinculo <> 'admin')
          OR EXISTS (SELECT 1 FROM public.familia_tutores ft
                      WHERE ft.familia_id = n.familia_id AND ft.usuario_id = p_usuario_id));
$function$;

-- La baja de su último hijo en el centro. NULL si no tiene hijos o alguno no está de baja.
CREATE FUNCTION privado.cuenta_baja(p_usuario_id uuid, p_centro_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT CASE WHEN count(*) = 0 OR bool_or(x.baja IS NULL) THEN NULL ELSE max(x.baja) END
    FROM (SELECT privado.fecha_baja_destruccion(h) AS baja
            FROM privado.hijos_cuenta(p_usuario_id, p_centro_id) h) x;
$function$;

-- Se puede purgar por plazo, sin mirar la fecha: todos sus hijos de baja y ningún otro rol vivo.
CREATE FUNCTION privado.cuenta_purgable(p_usuario_id uuid, p_centro_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT privado.cuenta_baja(p_usuario_id, p_centro_id) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.roles_usuario r
                      WHERE r.usuario_id = p_usuario_id AND r.centro_id = p_centro_id
                        AND r.deleted_at IS NULL AND r.rol NOT IN ('tutor_legal', 'autorizado'));
$function$;

-- Su cuenta ha vencido en el centro: sin purgar allí, purgable, con el plazo cumplido desde la
-- baja de su último hijo, sin retener y sin nada que impida el olvido (un hijo matriculado, un
-- recibo pendiente o devuelto sin resolver de su familia).
CREATE FUNCTION privado.cuenta_vencida(p_usuario_id uuid, p_centro_id uuid, p_anios integer)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT NOT privado.usuario_olvidado_en(p_usuario_id, p_centro_id)
     AND privado.cuenta_purgable(p_usuario_id, p_centro_id)
     AND privado.plazo_cumplido(privado.cuenta_baja(p_usuario_id, p_centro_id), p_anios)
     AND NOT privado.retenido(p_centro_id, 'usuario', p_usuario_id)
     AND jsonb_array_length(privado.olvido_bloqueos('usuario', p_usuario_id, p_centro_id)
                            -> 'bloqueos') = 0;
$function$;

-- La cuenta entera ha vencido: purgada en todos sus centros, el plazo cumplido en cada centro donde
-- tuvo hijos, y sin retener en ninguno. Para los consentimientos de la cuenta, que no son de nadie.
CREATE FUNCTION privado.cuenta_entera_vencida(p_usuario_id uuid, p_anios integer)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT privado.cuenta_olvidada(p_usuario_id)
     AND NOT EXISTS (SELECT 1 FROM public.retenciones r
                      WHERE r.sujeto_tipo = 'usuario' AND r.sujeto_id = p_usuario_id
                        AND r.quitada_en IS NULL)
     AND COALESCE((SELECT bool_and(privado.plazo_cumplido(privado.cuenta_baja(p_usuario_id, c.centro_id),
                                                          p_anios))
                     FROM (SELECT DISTINCT n.centro_id FROM public.ninos n
                            WHERE EXISTS (SELECT 1 FROM public.vinculos_familiares v
                                           WHERE v.nino_id = n.id AND v.usuario_id = p_usuario_id
                                             AND v.tipo_vinculo <> 'admin')
                               OR EXISTS (SELECT 1 FROM public.familia_tutores ft
                                           WHERE ft.familia_id = n.familia_id
                                             AND ft.usuario_id = p_usuario_id)) c), false);
$function$;

DO $permisos$
DECLARE
  v_f text;
BEGIN
  FOREACH v_f IN ARRAY ARRAY['privado.fecha_baja_destruccion(uuid)',
                             'privado.plazo_cumplido(date,integer)',
                             'privado.firmas_nino_vencidas(uuid,integer)',
                             'privado.queda_conservado_nino(uuid)',
                             'privado.accesos_nino_sin_objeto(uuid)',
                             'privado.quedan_firmas_nino(uuid)',
                             'privado.quedan_firmas_usuario(uuid,uuid)',
                             'privado.hijos_cuenta(uuid,uuid)', 'privado.cuenta_baja(uuid,uuid)',
                             'privado.cuenta_purgable(uuid,uuid)',
                             'privado.cuenta_vencida(uuid,uuid,integer)',
                             'privado.cuenta_entera_vencida(uuid,integer)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_f);
  END LOOP;
END
$permisos$;

-- ---- 3. Las firmas al vencer ----

-- Los niños con firmas vencidas y algo que destruir. Solo el servicio (el cron).
CREATE FUNCTION public.firmas_vencidas(p_anios integer)
RETURNS TABLE(nino_id uuid, centro_id uuid)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF p_anios IS NULL OR p_anios < 1 THEN
    RAISE EXCEPTION 'plazo de las firmas no válido' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
  SELECT n.id, n.centro_id FROM public.ninos n
   WHERE n.deleted_reason = 'purga_rgpd'
     AND privado.firmas_nino_vencidas(n.id, p_anios)
     AND privado.quedan_firmas_nino(n.id)
   ORDER BY n.deleted_at, n.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.firmas_vencidas(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.firmas_vencidas(integer) TO service_role;

-- La destrucción de uno. Vuelve a mirar, con el niño bloqueado, que siga vencido y sin retener:
-- entre la lista y aquí pudieron retenerlo. NULL si ya no toca; si no, cuántas filas por tabla.
CREATE FUNCTION public.destruir_firmas_nino(p_nino_id uuid, p_anios integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_centro    uuid;
  v_n         integer;
  v_ids       uuid[];
  v_firmantes uuid[] := '{}';
  r           jsonb := '{}'::jsonb;
BEGIN
  IF p_anios IS NULL OR p_anios < 1 THEN
    RAISE EXCEPTION 'plazo de las firmas no válido' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT centro_id INTO v_centro FROM public.ninos
   WHERE id = p_nino_id AND deleted_reason = 'purga_rgpd' FOR UPDATE;
  IF NOT FOUND OR NOT privado.firmas_nino_vencidas(p_nino_id, p_anios) THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('app.audit_actor', 'system:destruir_firmas_vencidas', true);
  PERFORM set_config('app.borrar_sin_copia', 'on', true);

  -- La medicación administrada primero: apunta a su autorización (RESTRICT).
  DELETE FROM public.administraciones_medicacion WHERE nino_id = p_nino_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || jsonb_build_object('medicacion_administrada', v_n);

  -- Lo firmado o consentido, salvo lo de un tutor retenido en el centro (Retención, PR-8).
  WITH b AS (
    DELETE FROM public.firmas_autorizacion f
     WHERE f.nino_id = p_nino_id AND NOT privado.retenido(v_centro, 'usuario', f.firmante_id)
    RETURNING f.firmante_id
  )
  SELECT count(*), coalesce(array_agg(DISTINCT firmante_id), '{}') INTO v_n, v_ids FROM b;
  v_firmantes := v_firmantes || v_ids;
  r := r || jsonb_build_object('firmas', v_n);

  WITH b AS (
    DELETE FROM public.acuses_alta aa
     WHERE aa.nino_id = p_nino_id
       AND NOT (aa.firmante_id IS NOT NULL AND privado.retenido(v_centro, 'usuario', aa.firmante_id))
    RETURNING aa.firmante_id
  )
  SELECT count(*), coalesce(array_agg(DISTINCT firmante_id) FILTER (WHERE firmante_id IS NOT NULL), '{}')
    INTO v_n, v_ids FROM b;
  v_firmantes := v_firmantes || v_ids;
  r := r || jsonb_build_object('acuses_alta', v_n);

  WITH b AS (
    DELETE FROM public.consentimientos c
     WHERE c.nino_id = p_nino_id AND NOT privado.retenido(v_centro, 'usuario', c.usuario_id)
    RETURNING c.usuario_id
  )
  SELECT count(*), coalesce(array_agg(DISTINCT usuario_id), '{}') INTO v_n, v_ids FROM b;
  v_firmantes := v_firmantes || v_ids;
  r := r || jsonb_build_object('consentimientos', v_n);

  -- Sus autorizaciones y las de sus eventos, si ya no les cuelga ninguna firma (la de un tutor
  -- retenido las sostiene), ni medicación, ni otra autorización que las use de plantilla.
  DELETE FROM public.autorizaciones a
   WHERE (a.nino_id = p_nino_id
          OR a.evento_id IN (SELECT e.id FROM public.eventos e
                              WHERE e.ambito = 'nino' AND e.nino_id = p_nino_id))
     AND NOT EXISTS (SELECT 1 FROM public.firmas_autorizacion f WHERE f.autorizacion_id = a.id)
     AND NOT EXISTS (SELECT 1 FROM public.administraciones_medicacion am
                      WHERE am.autorizacion_id = a.id)
     AND NOT EXISTS (SELECT 1 FROM public.autorizaciones x WHERE x.plantilla_id = a.id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || jsonb_build_object('autorizaciones', v_n);

  -- Los eventos de ámbito niño se quedaban por sus firmas (PR-4): se van con ellas.
  DELETE FROM public.eventos e
   WHERE e.ambito = 'nino' AND e.nino_id = p_nino_id
     AND NOT EXISTS (SELECT 1 FROM public.autorizaciones a WHERE a.evento_id = e.id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || jsonb_build_object('eventos', v_n);

  -- El registro de accesos se va cuando ya no queda nada bloqueado que mirar: del niño (también
  -- las lecturas de su ficha, que tienen su plazo), y de cada firmante en este centro.
  DELETE FROM public.accesos_datos_bloqueados x
   WHERE x.sujeto_tipo = 'nino' AND x.sujeto_id = p_nino_id
     AND privado.accesos_nino_sin_objeto(p_nino_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || jsonb_build_object('accesos_nino', v_n);

  DELETE FROM public.accesos_datos_bloqueados x
   WHERE x.centro_id = v_centro AND x.sujeto_tipo = 'usuario' AND x.sujeto_id = ANY (v_firmantes)
     AND NOT privado.retenido(v_centro, 'usuario', x.sujeto_id)
     AND NOT privado.quedan_firmas_usuario(v_centro, x.sujeto_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || jsonb_build_object('accesos_usuarios', v_n);

  PERFORM set_config('app.borrar_sin_copia', '', true);
  PERFORM set_config('app.audit_actor', '', true);
  RETURN r;
END;
$function$;
REVOKE ALL ON FUNCTION public.destruir_firmas_nino(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.destruir_firmas_nino(uuid, integer) TO service_role;

-- ---- 4. La cuenta del tutor al vencer ----

-- Las cuentas vencidas, por centro, con su petición por plazo si ya se abrió (un intento que falló
-- a medias). La que tiene abierta una petición suya espera a que se resuelva. Solo el servicio.
CREATE FUNCTION public.cuentas_vencidas(p_anios integer)
RETURNS TABLE(usuario_id uuid, centro_id uuid, solicitud_id uuid)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF p_anios IS NULL OR p_anios < 1 THEN
    RAISE EXCEPTION 'plazo de la cuenta no válido' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
  WITH candidatos AS (
    SELECT r.usuario_id, r.centro_id FROM public.roles_usuario r
     WHERE r.rol IN ('tutor_legal', 'autorizado')
    UNION
    SELECT v.usuario_id, n.centro_id FROM public.vinculos_familiares v
      JOIN public.ninos n ON n.id = v.nino_id
     WHERE v.tipo_vinculo <> 'admin'
    UNION
    SELECT ft.usuario_id, n.centro_id FROM public.familia_tutores ft
      JOIN public.ninos n ON n.familia_id = ft.familia_id
     WHERE ft.usuario_id IS NOT NULL
  )
  SELECT c.usuario_id, c.centro_id,
         (SELECT o.id FROM public.olvido_solicitudes o
           WHERE o.sujeto_tipo = 'usuario' AND o.sujeto_id = c.usuario_id
             AND o.centro_id = c.centro_id AND o.por_plazo AND o.purgado_en IS NULL)
    FROM candidatos c
   WHERE NOT EXISTS (SELECT 1 FROM public.olvido_solicitudes o
                      WHERE o.sujeto_tipo = 'usuario' AND o.sujeto_id = c.usuario_id
                        AND o.centro_id = c.centro_id AND NOT o.por_plazo
                        AND o.purgado_en IS NULL AND o.estado IN ('pendiente', 'confirmada'))
     AND privado.cuenta_vencida(c.usuario_id, c.centro_id, p_anios)
   ORDER BY c.usuario_id, c.centro_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.cuentas_vencidas(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cuentas_vencidas(integer) TO service_role;

-- Abre la petición por plazo (o devuelve la que ya estaba abierta), para que el cron la purgue con
-- la purga del olvido. Vuelve a mirar, con el usuario bloqueado, que la cuenta siga vencida. NULL
-- si ya no toca, o si tiene abierta una petición suya.
CREATE FUNCTION public.abrir_purga_cuenta(p_usuario_id uuid, p_centro_id uuid, p_anios integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF p_anios IS NULL OR p_anios < 1 OR p_usuario_id IS NULL OR p_centro_id IS NULL THEN
    RAISE EXCEPTION 'plazo de la cuenta no válido' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM 1 FROM public.usuarios WHERE id = p_usuario_id FOR UPDATE;
  IF NOT FOUND OR NOT privado.cuenta_vencida(p_usuario_id, p_centro_id, p_anios) THEN
    RETURN NULL;
  END IF;

  SELECT o.id INTO v_id FROM public.olvido_solicitudes o
   WHERE o.sujeto_tipo = 'usuario' AND o.sujeto_id = p_usuario_id AND o.centro_id = p_centro_id
     AND o.purgado_en IS NULL AND o.estado IN ('pendiente', 'confirmada');
  IF FOUND THEN
    RETURN CASE WHEN (SELECT por_plazo FROM public.olvido_solicitudes WHERE id = v_id)
                THEN v_id END;
  END IF;

  INSERT INTO public.olvido_solicitudes
    (sujeto_tipo, sujeto_id, centro_id, solicitado_por, solicitado_en, estado, pedida_por_centro,
     inmediato, confirmada_en, confirmada_por, gracia_hasta, por_plazo)
  VALUES
    ('usuario', p_usuario_id, p_centro_id, NULL, now(), 'confirmada', true,
     true, now(), NULL, now(), true)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.abrir_purga_cuenta(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.abrir_purga_cuenta(uuid, uuid, integer) TO service_role;

-- Los consentimientos de la cuenta (sin niño), con la cuenta entera vencida. En simulación, cuántos.
CREATE FUNCTION public.destruir_consentimientos_cuenta(p_anios integer, p_simular boolean)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_n integer;
BEGIN
  IF p_anios IS NULL OR p_anios < 1 OR p_simular IS NULL THEN
    RAISE EXCEPTION 'plazo de la cuenta no válido' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_simular THEN
    SELECT count(*) INTO v_n FROM public.consentimientos c
     WHERE c.nino_id IS NULL AND privado.cuenta_entera_vencida(c.usuario_id, p_anios);
  ELSE
    DELETE FROM public.consentimientos c
     WHERE c.nino_id IS NULL AND privado.cuenta_entera_vencida(c.usuario_id, p_anios);
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.destruir_consentimientos_cuenta(integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.destruir_consentimientos_cuenta(integer, boolean) TO service_role;

-- ---- 5. Las funciones que cambian ----
-- Cada una es la de producción (pg_get_functiondef) con su cambio marcado «Retención (PR-8, pieza 2)».

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
    -- Retención (PR-8, pieza 2): la petición por plazo la purga su paso del cron, sin correo.
    AND NOT s.por_plazo
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

CREATE OR REPLACE FUNCTION public.poner_retencion(p_centro_id uuid, p_sujetos jsonb, p_motivo_tipo text, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_n         integer;
  v_deshechas uuid[];
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
  -- pendiente, con los datos como estaban, y se queda ahí mientras dure. Se devuelven, para que la
  -- app avise a la familia con el correo de «deshecha»: le confirmaron el borrado y se lo paran.
  SELECT coalesce(array_agg(s.id ORDER BY s.id), '{}') INTO v_deshechas
    FROM public.olvido_solicitudes s
    JOIN privado.retencion_lista(p_centro_id, p_sujetos) l
      ON s.sujeto_tipo::text = l.tipo AND s.sujeto_id = l.id
   WHERE s.centro_id = p_centro_id AND s.estado = 'confirmada' AND s.purgado_en IS NULL
     -- Retención (PR-8, pieza 2): la petición por plazo nunca vuelve a pendiente (nadie la pidió):
     -- se queda confirmada y la purga no la coge mientras dure la retención.
     AND NOT s.por_plazo;
  PERFORM privado.olvido_volver_a_pendiente(d) FROM unnest(v_deshechas) AS d;
  RETURN jsonb_build_object('puestas', v_n, 'deshechas', to_jsonb(v_deshechas));
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

  -- Retención (PR-8, pieza 2): la petición por plazo vuelve a mirar que la cuenta siga purgable
  -- (todos sus hijos de baja y ningún otro rol vivo): entre abrirla y purgarla le pudieron dar un
  -- rol, o un hijo pudo volver. Sin la fecha: el plazo, una vez cumplido, no deja de estarlo.
  IF s.por_plazo AND NOT privado.cuenta_purgable(s.sujeto_id, s.centro_id) THEN
    RAISE EXCEPTION 'la cuenta ya no se purga por plazo'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'plazo';
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

-- Las dos listas de Olvido devuelven `por_plazo`, para la etiqueta. Cambia lo que devuelven:
-- DROP y CREATE, con los mismos privilegios.
DROP FUNCTION public.peticiones_olvido_centro(uuid);
CREATE FUNCTION public.peticiones_olvido_centro(p_centro_id uuid)
 RETURNS TABLE(id uuid, sujeto_tipo olvido_sujeto_tipo, sujeto_id uuid, sujeto_nombre text, solicitado_por_nombre text, pedida_por_centro boolean, solicitado_en timestamp with time zone, estado olvido_estado, inmediato boolean, confirmada_en timestamp with time zone, gracia_hasta timestamp with time zone, rechazada_en timestamp with time zone, motivo_rechazo text, retirada_en timestamp with time zone, nota_centro text, purgado_en timestamp with time zone, falta jsonb, por_plazo boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
              THEN privado.olvido_bloqueos(s.sujeto_tipo, s.sujeto_id, s.centro_id) END,
         -- Retención (PR-8, pieza 2): la etiqueta «por plazo».
         s.por_plazo
    FROM public.olvido_solicitudes s
   WHERE s.centro_id = p_centro_id
     AND ((s.estado IN ('pendiente', 'confirmada') AND s.purgado_en IS NULL)
          OR coalesce(s.purgado_en, s.rechazada_en, s.retirada_en) >= now() - interval '90 days')
   ORDER BY s.solicitado_en;
END;
$function$;
REVOKE ALL ON FUNCTION public.peticiones_olvido_centro(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.peticiones_olvido_centro(uuid) TO authenticated, service_role;

DROP FUNCTION public.mis_peticiones_olvido();
CREATE FUNCTION public.mis_peticiones_olvido()
 RETURNS TABLE(id uuid, sujeto_tipo olvido_sujeto_tipo, sujeto_id uuid, sujeto_nombre text, centro_id uuid, centro_nombre text, pedida_por_mi boolean, pedida_por_centro boolean, solicitado_en timestamp with time zone, estado olvido_estado, inmediato boolean, confirmada_en timestamp with time zone, gracia_hasta timestamp with time zone, rechazada_en timestamp with time zone, motivo_rechazo text, retirada_en timestamp with time zone, nota_centro text, purgado_en timestamp with time zone, falta jsonb, puede_retirar boolean, por_plazo boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
         s.estado = 'pendiente',
         -- Retención (PR-8, pieza 2): la etiqueta «por plazo».
         s.por_plazo
    FROM public.olvido_solicitudes s
   WHERE s.solicitado_por = v_uid
      OR (s.sujeto_tipo = 'usuario' AND s.sujeto_id = v_uid)
      OR (s.sujeto_tipo = 'nino' AND privado.es_tutor_legal_olvido(s.sujeto_id, v_uid))
      OR (s.sujeto_tipo = 'nino' AND s.purgado_en IS NOT NULL AND v_uid = ANY (s.tutores_legales))
   ORDER BY s.solicitado_en DESC;
END;
$function$;
REVOKE ALL ON FUNCTION public.mis_peticiones_olvido() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mis_peticiones_olvido() TO authenticated, service_role;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_f   text;
  v_src text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.olvido_solicitudes'::regclass
                    AND conname = 'olvido_por_plazo_coherente') THEN
    RAISE EXCEPTION 'guarda posterior: falta el CHECK de por_plazo';
  END IF;

  -- Las del cron, solo para el servicio.
  FOREACH v_f IN ARRAY ARRAY['public.firmas_vencidas(integer)',
                             'public.destruir_firmas_nino(uuid,integer)',
                             'public.cuentas_vencidas(integer)',
                             'public.abrir_purga_cuenta(uuid,uuid,integer)',
                             'public.destruir_consentimientos_cuenta(integer,boolean)'] LOOP
    IF has_function_privilege('authenticated', v_f, 'EXECUTE')
       OR has_function_privilege('anon', v_f, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION 'guarda posterior: % tiene que ser solo del servicio', v_f;
    END IF;
  END LOOP;
  -- Los predicados, de nadie con sesión.
  FOREACH v_f IN ARRAY ARRAY['privado.fecha_baja_destruccion(uuid)',
                             'privado.firmas_nino_vencidas(uuid,integer)',
                             'privado.cuenta_vencida(uuid,uuid,integer)',
                             'privado.cuenta_purgable(uuid,uuid)',
                             'privado.cuenta_entera_vencida(uuid,integer)'] LOOP
    IF has_function_privilege('authenticated', v_f, 'EXECUTE')
       OR has_function_privilege('anon', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION 'guarda posterior: % no puede abrirse a las sesiones', v_f;
    END IF;
  END LOOP;
  -- Las listas de Olvido, como estaban: con sesión sí, sin sesión no.
  FOREACH v_f IN ARRAY ARRAY['public.peticiones_olvido_centro(uuid)',
                             'public.mis_peticiones_olvido()'] LOOP
    IF NOT has_function_privilege('authenticated', v_f, 'EXECUTE')
       OR has_function_privilege('anon', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION 'guarda posterior: % perdió sus privilegios', v_f;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'public.purgar_sujeto_db(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'guarda posterior: purgar_sujeto_db no puede abrirse a las sesiones';
  END IF;

  -- Cada cambio, dentro de su función.
  FOR v_f, v_src IN SELECT * FROM (VALUES
      ('public.olvido_pendientes()', 'AND NOT s.por_plazo'),
      ('public.poner_retencion(uuid,jsonb,text,text)', 'AND NOT s.por_plazo;'),
      ('public.purgar_sujeto_db(uuid)', 'IF s.por_plazo AND NOT privado.cuenta_purgable(s.sujeto_id, s.centro_id) THEN'),
      ('public.peticiones_olvido_centro(uuid)', 's.por_plazo'),
      ('public.mis_peticiones_olvido()', 's.por_plazo'),
      ('public.destruir_firmas_nino(uuid,integer)', 'NOT privado.retenido(v_centro, ''usuario'', f.firmante_id)'),
      ('privado.cuenta_vencida(uuid,uuid,integer)', 'NOT privado.retenido(p_centro_id, ''usuario'', p_usuario_id)'),
      ('privado.firmas_nino_vencidas(uuid,integer)', 'NOT privado.retenido(n.centro_id, ''nino'', n.id)')
    ) AS t(f, ancla)
  LOOP
    IF strpos((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure(v_f)), v_src) = 0 THEN
      RAISE EXCEPTION 'guarda posterior: a % le falta «%»', v_f, v_src;
    END IF;
  END LOOP;

  RAISE NOTICE 'guarda posterior: md5 % (olvido_pendientes), % (poner_retencion), % (purgar_sujeto_db), % (peticiones_olvido_centro), % (mis_peticiones_olvido)',
    (SELECT md5(regexp_replace(regexp_replace(replace(prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
       FROM pg_proc WHERE oid = 'public.olvido_pendientes()'::regprocedure),
    (SELECT md5(regexp_replace(regexp_replace(replace(prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
       FROM pg_proc WHERE oid = 'public.poner_retencion(uuid,jsonb,text,text)'::regprocedure),
    (SELECT md5(regexp_replace(regexp_replace(replace(prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
       FROM pg_proc WHERE oid = 'public.purgar_sujeto_db(uuid)'::regprocedure),
    (SELECT md5(regexp_replace(regexp_replace(replace(prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
       FROM pg_proc WHERE oid = 'public.peticiones_olvido_centro(uuid)'::regprocedure),
    (SELECT md5(regexp_replace(regexp_replace(replace(prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
       FROM pg_proc WHERE oid = 'public.mis_peticiones_olvido()'::regprocedure);
END
$guarda$;
