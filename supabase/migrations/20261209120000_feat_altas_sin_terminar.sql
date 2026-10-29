-- =============================================================================
-- FEAT — El alta que no se termina: la confirma Dirección (retención, PR-8, pieza 4)
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/retencion-plazos.md. Hasta ahora el alta abandonada (la invitación sin aceptar,
-- caducada hace 30 días) se borraba sola en el barrido, y se quedaban la familia y el perfil del
-- tutor invitado, con su nombre y su email. El alta a medias (la invitación aceptada y el alta sin
-- terminar) no la limpiaba nada. Decisiones de Jose (2026-10-29):
--
--   · No es automático: a los 30 días el alta se le propone a Dirección (la admin y las
--     directoras: «son altas nuevas», no el olvido), y Dirección confirma. Lo puede hacer cuando
--     quiera, sin esperar.
--   · Un solo botón. Si la invitación está sin aceptar y abierta, la cancela (se puede enviar otra:
--     el email mal escrito). Si ya está cancelada o caducada, o la familia ya empezó el alta, la
--     anula: «si la familia no quiere entrar se borra».
--   · Los 30 días cuentan desde que caduca o se cancela la invitación (o desde el alta, si nunca
--     salió), o desde que la familia la aceptó sin terminar.
--   · Familia nueva: desaparece todo, sin copia en audit_log. La familia, sus tutores con su nombre
--     y su email, los borradores con sus líneas, las asignaciones, el método de pago, el mandato y
--     la ficha de la lista de espera. La cuenta de quien entró: se le quita el rol en el centro y,
--     si no le queda nada en ningún otro, se borra de la base (y la app, de Auth).
--   · Familia que ya tuvo un hijo: se borra solo el alta (el niño, su matrícula, su invitación y
--     sus líneas en los borradores). Lo demás sigue su regla de 5 años.
--   · «Enviar una invitación nueva»: corrige el email del tutor y vuelve a invitar.
--
-- Solo entra la matrícula en `pendiente`: en `lista` la familia ya terminó y le toca a Dirección
-- validarla. Un niño que tuvo alguna vez una matrícula activa no es un alta sin terminar.
--
-- Quién lo hizo y cuándo queda en audit_log como evento propio (`alta_sin_terminar`), sin datos de
-- la familia. Lo que se borra lo borra el servidor, sin copia: con una persona delante, un DELETE se
-- audita siempre (20261129120000).
--
-- La aplica el responsable por SQL Editor. No reescribe ni revoca nada: la purga automática del
-- alta abandonada (`purgar_esqueleto_huerfano_nino`) se queda en la base, y es la app la que deja de
-- llamarla. Sin orden obligado con el despliegue. Tras aplicar: registrar en
-- supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
BEGIN
  IF to_regprocedure('public.anular_alta(uuid,uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'ya aplicada: public.anular_alta existe';
  END IF;
  IF to_regprocedure('privado.retenido(uuid,text,uuid)') IS NULL
     OR to_regprocedure('public._redactar_jsonb(jsonb,text[])') IS NULL THEN
    RAISE EXCEPTION 'faltan la retención (20261206120000) o _redactar_jsonb: esta va detrás';
  END IF;

  RAISE NOTICE 'guarda previa: % niños con la matrícula pendiente, % de ellos con vínculo, % invitaciones de niño sin aceptar',
    (SELECT count(DISTINCT m.nino_id) FROM public.matriculas m
      WHERE m.estado = 'pendiente' AND m.deleted_at IS NULL AND m.fecha_baja IS NULL),
    (SELECT count(DISTINCT m.nino_id) FROM public.matriculas m
      WHERE m.estado = 'pendiente' AND m.deleted_at IS NULL AND m.fecha_baja IS NULL
        AND EXISTS (SELECT 1 FROM public.vinculos_familiares v
                     WHERE v.nino_id = m.nino_id AND v.deleted_at IS NULL)),
    (SELECT count(*) FROM public.invitaciones
      WHERE nino_id IS NOT NULL AND accepted_at IS NULL);
END
$guarda$;

-- ---- 1. Los predicados ----

-- El alta sin terminar de un niño: vivo, con la matrícula en `pendiente` y ninguna que haya llegado
-- a `lista` (viva) o a activa (nunca). Una fila, o ninguna si no lo es.
--   · estado: `invitacion_abierta` (sin aceptar y sin caducar), `sin_invitacion` (caducada,
--     cancelada, rechazada o nunca enviada) o `iniciada` (aceptada, o con vínculo).
--   · desde: el instante desde el que cuentan los días. NULL con la invitación abierta.
--   · email: el de la última invitación, o el del tutor de la familia sin cuenta.
--   · familia_nueva: la familia no tiene ni tuvo ningún otro niño.
CREATE FUNCTION privado.alta_sin_terminar(p_nino_id uuid)
RETURNS TABLE(estado text, desde timestamptz, email text, familia_nueva boolean)
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  WITH n AS (
    SELECT n.id, n.familia_id FROM public.ninos n
     WHERE n.id = p_nino_id AND n.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM public.matriculas m
                    WHERE m.nino_id = n.id AND m.estado = 'pendiente'
                      AND m.deleted_at IS NULL AND m.fecha_baja IS NULL)
       AND NOT EXISTS (SELECT 1 FROM public.matriculas m
                        WHERE m.nino_id = n.id
                          AND (m.activada_at IS NOT NULL OR m.estado IN ('activa', 'baja')
                               OR (m.estado = 'lista' AND m.deleted_at IS NULL)))
  ), s AS (
    SELECT n.id, n.familia_id,
           EXISTS (SELECT 1 FROM public.vinculos_familiares v
                    WHERE v.nino_id = n.id AND v.deleted_at IS NULL AND v.tipo_vinculo <> 'admin')
             OR EXISTS (SELECT 1 FROM public.invitaciones i
                         WHERE i.nino_id = n.id AND i.accepted_at IS NOT NULL) AS iniciada,
           EXISTS (SELECT 1 FROM public.invitaciones i
                    WHERE i.nino_id = n.id AND i.accepted_at IS NULL AND i.rejected_at IS NULL
                      AND i.expires_at > now()) AS abierta
      FROM n
  )
  SELECT CASE WHEN s.iniciada THEN 'iniciada'
              WHEN s.abierta THEN 'invitacion_abierta'
              ELSE 'sin_invitacion' END,
         CASE WHEN s.iniciada THEN
                coalesce((SELECT max(i.accepted_at) FROM public.invitaciones i WHERE i.nino_id = s.id),
                         (SELECT min(v.created_at) FROM public.vinculos_familiares v
                           WHERE v.nino_id = s.id AND v.deleted_at IS NULL))
              WHEN s.abierta THEN NULL
              ELSE coalesce((SELECT max(GREATEST(i.expires_at, i.rejected_at)) FROM public.invitaciones i
                              WHERE i.nino_id = s.id AND i.accepted_at IS NULL),
                            (SELECT min(m.created_at) FROM public.matriculas m WHERE m.nino_id = s.id))
         END,
         coalesce((SELECT i.email FROM public.invitaciones i WHERE i.nino_id = s.id
                    ORDER BY i.created_at DESC LIMIT 1),
                  (SELECT ft.email FROM public.familia_tutores ft
                    WHERE ft.familia_id = s.familia_id AND ft.usuario_id IS NULL AND ft.deleted_at IS NULL
                    ORDER BY ft.rol_familia DESC LIMIT 1)),
         NOT EXISTS (SELECT 1 FROM public.ninos o WHERE o.familia_id = s.familia_id AND o.id <> s.id)
    FROM s;
$function$;

-- Quien actúa es de Dirección del centro: la admin o una directora con el rol vivo, o el
-- superusuario. La app lo comprueba con la sesión; aquí se vuelve a mirar, porque escribe el
-- servidor.
CREATE FUNCTION privado.es_direccion(p_usuario_id uuid, p_centro_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT p_usuario_id IS NOT NULL AND p_centro_id IS NOT NULL
     AND (EXISTS (SELECT 1 FROM public.roles_usuario r
                   WHERE r.usuario_id = p_usuario_id AND r.centro_id = p_centro_id
                     AND r.deleted_at IS NULL AND r.rol::text IN ('admin', 'directora'))
          OR (EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.usuario_id = p_usuario_id)
              AND EXISTS (SELECT 1 FROM public.centros c
                           WHERE c.id = p_centro_id AND c.deleted_at IS NULL)));
$function$;

-- Las cuentas del alta: los tutores con cuenta de la familia nueva (o, si no lo es, nadie de la
-- familia), quien tiene vínculo con el niño, y la cuenta de Auth que creó cada invitación sin
-- aceptar y nunca entró (sin confirmar, sin roles, sin vínculos).
CREATE FUNCTION privado.cuentas_del_alta(p_nino_id uuid, p_familia_nueva boolean)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT ft.usuario_id FROM public.familia_tutores ft
    JOIN public.ninos n ON n.familia_id = ft.familia_id
   WHERE n.id = p_nino_id AND p_familia_nueva AND ft.usuario_id IS NOT NULL
  UNION
  SELECT v.usuario_id FROM public.vinculos_familiares v
   WHERE v.nino_id = p_nino_id AND v.tipo_vinculo <> 'admin'
  UNION
  SELECT au.id FROM auth.users au
   WHERE au.email_confirmed_at IS NULL
     AND au.email IN (SELECT i.email FROM public.invitaciones i
                       WHERE i.nino_id = p_nino_id AND i.accepted_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.roles_usuario r WHERE r.usuario_id = au.id)
     AND NOT EXISTS (SELECT 1 FROM public.vinculos_familiares v
                      WHERE v.usuario_id = au.id AND v.nino_id <> p_nino_id);
$function$;

DO $permisos$
DECLARE
  v_f text;
BEGIN
  FOREACH v_f IN ARRAY ARRAY['privado.alta_sin_terminar(uuid)',
                             'privado.es_direccion(uuid,uuid)',
                             'privado.cuentas_del_alta(uuid,boolean)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_f);
  END LOOP;
END
$permisos$;

-- ---- 2. La lista, para Dirección ----

-- Las altas sin terminar del centro, con su estado, desde cuándo cuentan los días, si ya se
-- proponen para borrar (`p_dias` cumplidos), el email al que se invitó y si la familia es nueva.
-- Con sesión: Dirección del centro (es_admin). El centro NULL no entra: es_admin(NULL) da TRUE a
-- cualquier persona de Dirección.
CREATE FUNCTION public.altas_sin_terminar(p_centro_id uuid, p_dias integer)
RETURNS TABLE(nino_id uuid, estado text, desde timestamptz, propuesta boolean, email text,
              familia_nueva boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF p_centro_id IS NULL OR NOT public.es_admin(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_dias IS NULL OR p_dias < 1 THEN
    RAISE EXCEPTION 'plazo no válido' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
  SELECT n.id, a.estado, a.desde,
         a.desde IS NOT NULL AND a.desde <= now() - make_interval(days => p_dias),
         a.email, a.familia_nueva
    FROM public.ninos n
   CROSS JOIN LATERAL privado.alta_sin_terminar(n.id) a
   WHERE n.centro_id = p_centro_id AND n.deleted_at IS NULL
   ORDER BY a.desde NULLS LAST, n.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.altas_sin_terminar(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.altas_sin_terminar(uuid, integer) TO authenticated, service_role;

-- ---- 3. El botón (servidor) ----

-- Lo que la app necesita antes de borrar: el estado y la acción del botón, las cuentas del alta
-- (para sus ficheros) y las rutas de Storage que solo conoce la base: los mandatos y los DNI de los
-- tutores de la familia nueva, y los adjuntos de las firmas del niño. NULL si no es un alta sin
-- terminar. Solo el servicio.
CREATE FUNCTION public.datos_anular_alta(p_nino_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  a        record;
  v_centro uuid;
  v_fam    uuid;
BEGIN
  SELECT * INTO a FROM privado.alta_sin_terminar(p_nino_id);
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT centro_id, familia_id INTO v_centro, v_fam FROM public.ninos WHERE id = p_nino_id;
  RETURN jsonb_build_object(
    'centro_id', v_centro,
    'estado', a.estado,
    'accion', CASE WHEN a.estado = 'invitacion_abierta' THEN 'cancelar' ELSE 'borrar' END,
    'familia_nueva', a.familia_nueva,
    'cuentas', coalesce((SELECT jsonb_agg(c) FROM privado.cuentas_del_alta(p_nino_id, a.familia_nueva) c),
                        '[]'::jsonb),
    'mandatos', coalesce((SELECT jsonb_agg(m.documento_path) FROM public.mandatos_sepa m
                           WHERE a.familia_nueva AND m.familia_id = v_fam
                             AND nullif(m.documento_path, '') IS NOT NULL), '[]'::jsonb),
    'dnis', coalesce((SELECT jsonb_agg(ft.dni_documento_path) FROM public.familia_tutores ft
                       WHERE a.familia_nueva AND ft.familia_id = v_fam
                         AND nullif(ft.dni_documento_path, '') IS NOT NULL), '[]'::jsonb),
    'recogida', coalesce((SELECT jsonb_agg(adj->>'path') FROM public.firmas_autorizacion f
                           CROSS JOIN LATERAL jsonb_array_elements(coalesce(f.datos->'adjuntos', '[]'::jsonb)) adj
                          WHERE f.nino_id = p_nino_id AND adj->>'path' IS NOT NULL), '[]'::jsonb));
END;
$function$;
REVOKE ALL ON FUNCTION public.datos_anular_alta(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.datos_anular_alta(uuid) TO service_role;

-- El botón. `p_accion` es la que la app vio en datos_anular_alta: si el alta cambió entre medias
-- (la aceptaron, la reenviaron), no se hace nada (40001) y la app vuelve a mirar. Con `cancelar`, la
-- invitación abierta caduca ahora y el alta se queda. Con `borrar`, todo lo del alta, sin copia en
-- audit_log (ver la cabecera); devuelve las cuentas borradas de la base, para borrarlas de Auth, y
-- las que esperan porque algo las nombra todavía. Solo el servicio.
CREATE FUNCTION public.anular_alta(p_nino_id uuid, p_actor uuid, p_accion text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  a          record;
  v_centro   uuid;
  v_fam      uuid;
  v_accion   text;
  v_cuentas  uuid[];
  v_u        uuid;
  v_borradas uuid[] := '{}';
  v_esperan  integer := 0;
  v_n        integer;
  r          jsonb := '{}'::jsonb;
BEGIN
  IF p_accion IS NULL OR p_accion NOT IN ('cancelar', 'borrar') THEN
    RAISE EXCEPTION 'acción no válida' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT centro_id, familia_id INTO v_centro, v_fam FROM public.ninos WHERE id = p_nino_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF NOT privado.es_direccion(p_actor, v_centro) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO a FROM privado.alta_sin_terminar(p_nino_id);
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_accion := CASE WHEN a.estado = 'invitacion_abierta' THEN 'cancelar' ELSE 'borrar' END;
  IF v_accion <> p_accion THEN
    RAISE EXCEPTION 'el alta ha cambiado' USING ERRCODE = 'serialization_failure',
      HINT = 'el_alta_ha_cambiado';
  END IF;

  PERFORM set_config('app.audit_actor', 'system:anular_alta', true);

  IF v_accion = 'cancelar' THEN
    UPDATE public.invitaciones SET expires_at = now()
     WHERE nino_id = p_nino_id AND accepted_at IS NULL AND rejected_at IS NULL AND expires_at > now();
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO public.audit_log (tabla, registro_id, accion, usuario_id, centro_id, valores_despues)
    VALUES ('alta_sin_terminar', v_centro, 'UPDATE', p_actor, v_centro,
            jsonb_build_object('accion', 'cancelada'));
    PERFORM set_config('app.audit_actor', '', true);
    RETURN jsonb_build_object('accion', 'cancelada', 'invitaciones', v_n);
  END IF;

  -- Retención (PR-8): un niño o un tutor retenidos no se borran.
  IF privado.retenido(v_centro, 'nino', p_nino_id)
     OR EXISTS (SELECT 1 FROM privado.cuentas_del_alta(p_nino_id, a.familia_nueva) c
                 WHERE privado.retenido(v_centro, 'usuario', c)) THEN
    RAISE EXCEPTION 'hay alguien retenido en el alta'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'retenido';
  END IF;
  -- Un alta sin terminar no tiene operativa; si la tiene, algo no cuadra y no se borra.
  IF EXISTS (SELECT 1 FROM public.asistencias WHERE nino_id = p_nino_id)
     OR EXISTS (SELECT 1 FROM public.ausencias WHERE nino_id = p_nino_id)
     OR EXISTS (SELECT 1 FROM public.agendas_diarias WHERE nino_id = p_nino_id)
     OR EXISTS (SELECT 1 FROM public.conversaciones WHERE nino_id = p_nino_id)
     OR EXISTS (SELECT 1 FROM public.administraciones_medicacion WHERE nino_id = p_nino_id)
     OR EXISTS (SELECT 1 FROM public.informes_evolucion WHERE nino_id = p_nino_id) THEN
    RAISE EXCEPTION 'el niño tiene actividad'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'con_actividad';
  END IF;
  -- Solo se borran borradores: un recibo validado es de otra regla (lo fiscal).
  IF EXISTS (SELECT 1 FROM public.recibos x
              WHERE x.estado <> 'borrador'
                AND ((a.familia_nueva AND x.familia_id = v_fam) OR x.nino_id = p_nino_id
                     OR EXISTS (SELECT 1 FROM public.lineas_recibo l
                                 WHERE l.recibo_id = x.id AND l.nino_id = p_nino_id))) THEN
    RAISE EXCEPTION 'el alta tiene recibos validados'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'con_cobros';
  END IF;

  SELECT coalesce(array_agg(c), '{}') INTO v_cuentas
    FROM privado.cuentas_del_alta(p_nino_id, a.familia_nueva) c;
  PERFORM set_config('app.borrar_sin_copia', 'on', true);

  IF a.familia_nueva THEN
    DELETE FROM public.beca_comedor_transferencia WHERE familia_id = v_fam;
    DELETE FROM public.lineas_recibo l USING public.recibos x
     WHERE l.recibo_id = x.id AND x.familia_id = v_fam;
    DELETE FROM public.recibos WHERE familia_id = v_fam;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    r := r || jsonb_build_object('recibos', v_n);
    DELETE FROM public.mandatos_sepa WHERE familia_id = v_fam;
  ELSE
    -- La familia se queda: del alta, solo las líneas del niño en sus borradores, y el niño fuera
    -- de lo que es de la familia (el recibo y el mandato no se van con él en cascada).
    DELETE FROM public.lineas_recibo WHERE nino_id = p_nino_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    r := r || jsonb_build_object('lineas', v_n);
    UPDATE public.recibos x
       SET total_centimos = coalesce((SELECT sum(l.importe_centimos) FROM public.lineas_recibo l
                                       WHERE l.recibo_id = x.id), 0)
     WHERE x.familia_id = v_fam AND x.estado = 'borrador';
    DELETE FROM public.recibos x
     WHERE x.familia_id = v_fam AND x.estado = 'borrador'
       AND NOT EXISTS (SELECT 1 FROM public.lineas_recibo l WHERE l.recibo_id = x.id);
    UPDATE public.recibos SET nino_id = NULL WHERE nino_id = p_nino_id;
    UPDATE public.mandatos_sepa SET nino_id = NULL WHERE nino_id = p_nino_id;
  END IF;

  DELETE FROM public.acuses_alta WHERE nino_id = p_nino_id;
  DELETE FROM public.beca_comedor_tramo WHERE nino_id = p_nino_id;
  DELETE FROM public.beca_comedor_elegibilidad WHERE nino_id = p_nino_id;
  DELETE FROM public.info_medica_emergencia WHERE nino_id = p_nino_id;
  DELETE FROM public.datos_pedagogicos_nino WHERE nino_id = p_nino_id;
  DELETE FROM public.matriculas WHERE nino_id = p_nino_id;
  DELETE FROM public.lista_espera WHERE nino_id = p_nino_id;
  DELETE FROM public.ninos WHERE id = p_nino_id;
  r := r || jsonb_build_object('ninos', 1);

  IF a.familia_nueva THEN
    DELETE FROM public.familia_tutores WHERE familia_id = v_fam;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    r := r || jsonb_build_object('familia_tutores', v_n);
    DELETE FROM public.familias WHERE id = v_fam;
    r := r || jsonb_build_object('familias', 1);
  END IF;

  -- Las cuentas: fuera su rol en el centro, si no le queda allí otro niño ni otra familia; y la
  -- cuenta entera, si no le queda nada en ningún sitio y nada la nombra.
  FOREACH v_u IN ARRAY v_cuentas LOOP
    IF NOT EXISTS (SELECT 1 FROM public.vinculos_familiares v JOIN public.ninos n ON n.id = v.nino_id
                    WHERE v.usuario_id = v_u AND v.deleted_at IS NULL AND n.centro_id = v_centro)
       AND NOT EXISTS (SELECT 1 FROM public.familia_tutores ft
                        WHERE ft.usuario_id = v_u AND ft.centro_id = v_centro) THEN
      DELETE FROM public.roles_usuario
       WHERE usuario_id = v_u AND centro_id = v_centro AND rol::text IN ('tutor_legal', 'autorizado');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.roles_usuario WHERE usuario_id = v_u)
       AND NOT EXISTS (SELECT 1 FROM public.familia_tutores WHERE usuario_id = v_u)
       AND NOT EXISTS (SELECT 1 FROM public.vinculos_familiares WHERE usuario_id = v_u)
       AND NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE usuario_id = v_u) THEN
      BEGIN
        DELETE FROM public.consentimientos WHERE usuario_id = v_u;
        -- Las copias de su propio perfil (lo que cambió con su sesión) la nombran como autora, y la
        -- FK se comprueba antes de que el trigger se lleve las copias: se van primero. Lo demás que
        -- la nombre la sigue frenando.
        DELETE FROM public.audit_log WHERE tabla = 'usuarios' AND registro_id = v_u;
        DELETE FROM public.usuarios WHERE id = v_u;
        v_borradas := v_borradas || v_u;
      EXCEPTION WHEN foreign_key_violation THEN
        v_esperan := v_esperan + 1;
      END;
    END IF;
  END LOOP;

  -- Nada vive más en audit_log que en su tabla: las copias de filas del alta borradas antes.
  DELETE FROM public.audit_log x
   WHERE x.centro_id = v_centro
     AND (x.valores_antes->>'nino_id' = p_nino_id::text
          OR x.valores_despues->>'nino_id' = p_nino_id::text
          OR x.registro_id = p_nino_id
          OR (a.familia_nueva AND (x.valores_antes->>'familia_id' = v_fam::text
                                   OR x.valores_despues->>'familia_id' = v_fam::text
                                   OR x.registro_id = v_fam)));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || jsonb_build_object('copias_huerfanas', v_n);

  PERFORM set_config('app.borrar_sin_copia', '', true);
  INSERT INTO public.audit_log (tabla, registro_id, accion, usuario_id, centro_id, valores_despues)
  VALUES ('alta_sin_terminar', v_centro, 'DELETE', p_actor, v_centro,
          jsonb_build_object('accion', 'borrada'));
  PERFORM set_config('app.audit_actor', '', true);
  RETURN r || jsonb_build_object('accion', 'borrada', 'familia_nueva', a.familia_nueva,
                                 'cuentas', to_jsonb(v_borradas), 'esperan', v_esperan);
END;
$function$;
REVOKE ALL ON FUNCTION public.anular_alta(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anular_alta(uuid, uuid, text) TO service_role;

-- «Enviar una invitación nueva»: con el alta sin empezar, corrige el email del tutor sin cuenta (y
-- el de su ficha de la lista de espera, y el email viejo en sus copias de audit_log) y borra sin
-- copia las invitaciones sin aceptar del niño. Devuelve el tipo de vínculo que llevaban, para la
-- nueva, y las cuentas de Auth que creó el email viejo y nunca entraron, ya sin fila en usuarios,
-- para que la app las borre de Auth. La nueva la envía la app (sendInvitation). Solo el servicio.
CREATE FUNCTION public.reinvitar_alta(p_nino_id uuid, p_email text, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  a         record;
  v_centro  uuid;
  v_fam     uuid;
  v_email   text := lower(btrim(p_email));
  v_viejos  text[];
  v_tipo    text;
  v_stubs   uuid[];
  v_u       uuid;
  v_ft      uuid[];
BEGIN
  IF v_email IS NULL OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'email no válido' USING ERRCODE = 'invalid_parameter_value', HINT = 'email';
  END IF;
  SELECT centro_id, familia_id INTO v_centro, v_fam FROM public.ninos WHERE id = p_nino_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF NOT privado.es_direccion(p_actor, v_centro) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO a FROM privado.alta_sin_terminar(p_nino_id);
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF a.estado = 'iniciada' THEN
    RAISE EXCEPTION 'la familia ya empezó el alta'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'alta_iniciada';
  END IF;

  SELECT coalesce(array_agg(DISTINCT i.email), '{}'),
         (array_agg(i.tipo_vinculo::text ORDER BY i.created_at DESC))[1]
    INTO v_viejos, v_tipo
    FROM public.invitaciones i WHERE i.nino_id = p_nino_id AND i.accepted_at IS NULL;
  IF a.email IS NOT NULL AND NOT a.email = ANY (v_viejos) THEN
    v_viejos := v_viejos || a.email;
  END IF;

  PERFORM set_config('app.audit_actor', 'system:reinvitar_alta', true);

  -- El tutor sin cuenta de ese email: el nuevo, y el viejo fuera de sus copias.
  SELECT coalesce(array_agg(ft.id), '{}') INTO v_ft FROM public.familia_tutores ft
   WHERE ft.familia_id = v_fam AND ft.usuario_id IS NULL AND ft.deleted_at IS NULL
     AND lower(ft.email) = ANY (SELECT lower(x) FROM unnest(v_viejos) x);
  UPDATE public.familia_tutores SET email = v_email WHERE id = ANY (v_ft);
  UPDATE public.lista_espera SET email_tutor = v_email WHERE nino_id = p_nino_id;
  UPDATE public.audit_log SET
    valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY['email', 'email_tutor']),
    valores_despues = public._redactar_jsonb(valores_despues, ARRAY['email', 'email_tutor'])
  WHERE (tabla = 'familia_tutores' AND registro_id = ANY (v_ft))
     OR (tabla = 'lista_espera'
         AND registro_id IN (SELECT le.id FROM public.lista_espera le WHERE le.nino_id = p_nino_id));

  -- Las cuentas de Auth del email viejo que nunca entraron (antes de borrar sus invitaciones,
  -- que es como se las reconoce).
  SELECT coalesce(array_agg(au.id), '{}') INTO v_stubs FROM auth.users au
   WHERE au.email_confirmed_at IS NULL
     AND lower(au.email) = ANY (SELECT lower(x) FROM unnest(v_viejos) x)
     AND lower(au.email) <> v_email
     AND NOT EXISTS (SELECT 1 FROM public.roles_usuario r WHERE r.usuario_id = au.id)
     AND NOT EXISTS (SELECT 1 FROM public.vinculos_familiares v WHERE v.usuario_id = au.id)
     AND NOT EXISTS (SELECT 1 FROM public.invitaciones i
                      WHERE i.email = au.email AND (i.nino_id IS DISTINCT FROM p_nino_id
                                                    OR i.accepted_at IS NOT NULL));

  PERFORM set_config('app.borrar_sin_copia', 'on', true);
  DELETE FROM public.invitaciones WHERE nino_id = p_nino_id AND accepted_at IS NULL;
  FOREACH v_u IN ARRAY v_stubs LOOP
    DELETE FROM public.usuarios WHERE id = v_u;
  END LOOP;
  PERFORM set_config('app.borrar_sin_copia', '', true);

  INSERT INTO public.audit_log (tabla, registro_id, accion, usuario_id, centro_id, valores_despues)
  VALUES ('alta_sin_terminar', v_centro, 'UPDATE', p_actor, v_centro,
          jsonb_build_object('accion', 'reinvitada'));
  PERFORM set_config('app.audit_actor', '', true);
  RETURN jsonb_build_object('tipo_vinculo', coalesce(v_tipo, 'tutor_legal_principal'),
                            'stubs', to_jsonb(v_stubs), 'tutores', cardinality(v_ft));
END;
$function$;
REVOKE ALL ON FUNCTION public.reinvitar_alta(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reinvitar_alta(uuid, text, uuid) TO service_role;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_f   text;
  v_src text;
BEGIN
  FOREACH v_f IN ARRAY ARRAY['public.datos_anular_alta(uuid)',
                             'public.anular_alta(uuid,uuid,text)',
                             'public.reinvitar_alta(uuid,text,uuid)'] LOOP
    IF has_function_privilege('authenticated', v_f, 'EXECUTE')
       OR has_function_privilege('anon', v_f, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION 'guarda posterior: % tiene que ser solo del servicio', v_f;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.altas_sin_terminar(uuid,integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.altas_sin_terminar(uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'guarda posterior: altas_sin_terminar es de Dirección con sesión';
  END IF;
  FOREACH v_f IN ARRAY ARRAY['privado.alta_sin_terminar(uuid)',
                             'privado.es_direccion(uuid,uuid)',
                             'privado.cuentas_del_alta(uuid,boolean)'] LOOP
    IF has_function_privilege('authenticated', v_f, 'EXECUTE')
       OR has_function_privilege('anon', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION 'guarda posterior: % no puede abrirse a las sesiones', v_f;
    END IF;
  END LOOP;

  FOR v_f, v_src IN SELECT * FROM (VALUES
      ('public.altas_sin_terminar(uuid,integer)', 'IF p_centro_id IS NULL OR NOT public.es_admin(p_centro_id) THEN'),
      ('public.anular_alta(uuid,uuid,text)', 'IF NOT privado.es_direccion(p_actor, v_centro) THEN'),
      ('public.anular_alta(uuid,uuid,text)', 'IF v_accion <> p_accion THEN'),
      ('public.anular_alta(uuid,uuid,text)', 'IF privado.retenido(v_centro, ''nino'', p_nino_id)'),
      ('public.anular_alta(uuid,uuid,text)', 'EXCEPTION WHEN foreign_key_violation THEN'),
      ('public.reinvitar_alta(uuid,text,uuid)', 'IF NOT privado.es_direccion(p_actor, v_centro) THEN'),
      ('public.reinvitar_alta(uuid,text,uuid)', 'IF a.estado = ''iniciada'' THEN'),
      ('privado.alta_sin_terminar(uuid)', 'OR (m.estado = ''lista'' AND m.deleted_at IS NULL)))')
    ) AS t(f, ancla)
  LOOP
    IF strpos((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure(v_f)), v_src) = 0 THEN
      RAISE EXCEPTION 'guarda posterior: a % le falta «%»', v_f, v_src;
    END IF;
  END LOOP;

  RAISE NOTICE 'guarda posterior: funciones creadas y cerradas';
END
$guarda$;
