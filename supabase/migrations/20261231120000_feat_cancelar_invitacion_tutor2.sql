-- =============================================================================
-- FEAT — Reenviar y cancelar la invitación del segundo tutor (serie de altas, 2026-11-04)
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/altas-serie.md, «La pantalla de altas en proceso». La invitación al segundo
-- tutor sale al validar el alta (invitar-tutor-2.ts) y, si no la acepta, nadie podía reenviarla ni
-- cancelarla. Y medido el 2026-11-04: si la familia corrige el email del segundo tutor, o añade uno
-- después de validar, la cola escribe la fila (aplicar.ts) y NO SE INVITA A NADIE. Esa persona se
-- queda fuera y nadie se entera. El botón de reenviar de «Altas en proceso» es lo que cierra los dos
-- casos; esta función es la parte de la base de los dos botones.
--
-- `cancelar_invitacion_tutor2(niño, actor, email_que_se_queda)` borra sin copia las invitaciones
-- sin aceptar del segundo tutor del niño y las cuentas provisionales de Auth que crearon y nunca
-- entraron, y devuelve esas cuentas para que la app las borre de Auth. Con `email_que_se_queda`
-- (el reenvío), la invitación a ese email se queda: `sendInvitation` la reutiliza, con su token y su
-- cuenta provisional, y no se duplica nada. Es lo que `reinvitar_alta` hace para el alta sin
-- terminar, con su mismo filtro de cuentas, acotado al segundo tutor: no toca la invitación del
-- tutor principal, ni el email de nadie (decisión del responsable del 2026-11-04: el email del
-- segundo tutor no lo corrige Dirección; lo corrige el tutor 1 por la cola y Dirección lo aprueba).
--
-- Quién lo hizo queda en audit_log como evento propio (`invitacion_tutor2`), sin datos de la
-- familia. Solo el servicio la ejecuta; la base vuelve a mirar que quien actúa sea de Dirección
-- del centro del niño (`privado.es_direccion`).
--
-- Sin orden con el despliegue: la función es nueva y nadie la llama hasta que la app llegue. La
-- aplica el responsable por SQL Editor, copiando el fichero. Tras aplicar: registrar en
-- supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
BEGIN
  IF to_regprocedure('public.cancelar_invitacion_tutor2(uuid,uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'ya aplicada: public.cancelar_invitacion_tutor2 existe';
  END IF;
  IF to_regprocedure('privado.es_direccion(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'falta privado.es_direccion (20261209120000): esta va detrás';
  END IF;
  RAISE NOTICE 'guarda previa: % invitaciones de segundo tutor sin aceptar, % de ellas con una cuenta provisional sin confirmar',
    (SELECT count(*) FROM public.invitaciones
      WHERE tipo_vinculo = 'tutor_legal_secundario' AND nino_id IS NOT NULL AND accepted_at IS NULL),
    (SELECT count(*) FROM public.invitaciones i
      WHERE i.tipo_vinculo = 'tutor_legal_secundario' AND i.nino_id IS NOT NULL AND i.accepted_at IS NULL
        AND EXISTS (SELECT 1 FROM auth.users au
                     WHERE lower(au.email) = lower(i.email) AND au.email_confirmed_at IS NULL));
END
$guarda$;

-- ---- 1. La función ----
CREATE FUNCTION public.cancelar_invitacion_tutor2(p_nino_id uuid, p_actor uuid,
                                                  p_email_se_queda text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_centro  uuid;
  v_queda   text := nullif(lower(btrim(p_email_se_queda)), '');
  v_viejos  text[];
  v_ids     uuid[];
  v_stubs   uuid[];
  v_u       uuid;
BEGIN
  SELECT centro_id INTO v_centro FROM public.ninos
   WHERE id = p_nino_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF NOT privado.es_direccion(p_actor, v_centro) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Las invitaciones del segundo tutor del niño que se van: sin aceptar, y no la del email que se
  -- queda.
  SELECT coalesce(array_agg(i.id), '{}'), coalesce(array_agg(DISTINCT lower(i.email)), '{}')
    INTO v_ids, v_viejos
    FROM public.invitaciones i
   WHERE i.nino_id = p_nino_id AND i.tipo_vinculo = 'tutor_legal_secundario'
     AND i.accepted_at IS NULL
     AND (v_queda IS NULL OR lower(i.email) <> v_queda);

  PERFORM set_config('app.audit_actor', 'system:cancelar_invitacion_tutor2', true);

  -- Las cuentas de Auth de esos emails que nunca entraron (antes de borrar sus invitaciones, que
  -- es como se las reconoce): el filtro de `reinvitar_alta`, tal cual.
  SELECT coalesce(array_agg(au.id), '{}') INTO v_stubs FROM auth.users au
   WHERE au.email_confirmed_at IS NULL
     AND lower(au.email) = ANY (v_viejos)
     AND lower(au.email) IS DISTINCT FROM v_queda
     AND NOT EXISTS (SELECT 1 FROM public.roles_usuario r WHERE r.usuario_id = au.id)
     AND NOT EXISTS (SELECT 1 FROM public.vinculos_familiares v WHERE v.usuario_id = au.id)
     AND NOT EXISTS (SELECT 1 FROM public.invitaciones i
                      WHERE i.email = au.email AND (i.nino_id IS DISTINCT FROM p_nino_id
                                                    OR i.accepted_at IS NOT NULL));

  PERFORM set_config('app.borrar_sin_copia', 'on', true);
  DELETE FROM public.invitaciones WHERE id = ANY (v_ids);
  FOREACH v_u IN ARRAY v_stubs LOOP
    DELETE FROM public.usuarios WHERE id = v_u;
  END LOOP;
  PERFORM set_config('app.borrar_sin_copia', '', true);

  -- Solo cuando se cancela algo: sin nada que cancelar no hay hecho que registrar (el reenvío en sí
  -- queda en audit_log por la invitación que actualiza sendInvitation).
  IF cardinality(v_ids) > 0 THEN
    INSERT INTO public.audit_log (tabla, registro_id, accion, usuario_id, centro_id, valores_despues)
    VALUES ('invitacion_tutor2', v_centro, 'UPDATE', p_actor, v_centro,
            jsonb_build_object('accion', CASE WHEN v_queda IS NULL THEN 'cancelada' ELSE 'reenviada' END,
                               'invitaciones', cardinality(v_ids)));
  END IF;
  PERFORM set_config('app.audit_actor', '', true);
  RETURN jsonb_build_object('invitaciones', cardinality(v_ids), 'stubs', to_jsonb(v_stubs));
END;
$function$;
REVOKE ALL ON FUNCTION public.cancelar_invitacion_tutor2(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_invitacion_tutor2(uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.cancelar_invitacion_tutor2(uuid, uuid, text) IS
  'Cancela las invitaciones sin aceptar del segundo tutor de un niño (salvo la del email que se queda, en el reenvío) y borra sin copia las cuentas provisionales que crearon y nunca entraron; devuelve esas cuentas para borrarlas de Auth. Solo el servicio; vuelve a mirar privado.es_direccion. docs/specs/altas-serie.md.';

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_oid oid := to_regprocedure('public.cancelar_invitacion_tutor2(uuid,uuid,text)');
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'guarda posterior: la función no existe';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 'guarda posterior: la función no es SECURITY DEFINER';
  END IF;
  IF has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'guarda posterior: una sesión puede ejecutarla';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'guarda posterior: el servicio no puede ejecutarla';
  END IF;
  IF position('privado.es_direccion(p_actor' IN (SELECT prosrc FROM pg_proc WHERE oid = v_oid)) = 0 THEN
    RAISE EXCEPTION 'guarda posterior: no vuelve a mirar quién actúa';
  END IF;
  RAISE NOTICE 'guarda posterior: función creada, solo service_role, SECURITY DEFINER, mira privado.es_direccion';
END
$guarda$;
