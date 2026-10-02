-- =============================================================================
-- FIX — policies de la app a TO authenticated + cerrar a anon los 20 helpers de RLS
-- (limpieza de seguridad, PR-3, grupo C)
-- -----------------------------------------------------------------------------
-- Los 20 helpers de RLS (es_admin, es_tutor_de, usuario_ve_publicacion_row, …) tenían EXECUTE
-- para PUBLIC/anon (default privileges), así que la anon key podía llamarlos por PostgREST. No se
-- podían revocar sin más: las policies TO public los evalúan también para anon con SU permiso, y
-- revocarlos cambiaría las lecturas anon de "0 filas" a "permission denied for function" (que
-- además revela que la tabla existe y está protegida).
--
-- Orden:
--   1. ALTER POLICY … TO authenticated en las 156 policies del esquema public que eran TO public
--      (generado del censo pg_policies, no a mano). USING / WITH CHECK no cambian. anon deja de
--      evaluarlas → default deny → 0 filas, sin llamar a ningún helper. authenticated sigue
--      evaluando exactamente la misma policy; service_role y postgres tienen BYPASSRLS.
--   2. REVOKE EXECUTE de PUBLIC y anon en los 20 helpers. authenticated y service_role los
--      conservan (por nombre): las policies los evalúan con el rol de quien consulta y la app
--      llama a 5 directamente. Los 33 llamadores son SECURITY DEFINER (permiso de la dueña).
--   3. Guarda: si queda alguna policy TO public en el esquema public, o anon conserva EXECUTE en
--      algún helper, la migración aborta.
--
-- Fuera de alcance, a propósito: storage.objects · centro_assets_select sigue TO public (logos
-- del bucket público, ADR-0010).
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor (CLI SIGILL
-- en ARM). Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- 1. Policies: TO public → TO authenticated (156, por tabla)

-- acuses_alta
ALTER POLICY acuses_alta_insert ON public.acuses_alta TO authenticated;
ALTER POLICY acuses_alta_select ON public.acuses_alta TO authenticated;

-- administraciones_medicacion
ALTER POLICY adm_med_insert ON public.administraciones_medicacion TO authenticated;
ALTER POLICY adm_med_select ON public.administraciones_medicacion TO authenticated;
ALTER POLICY adm_med_update_confirmar ON public.administraciones_medicacion TO authenticated;

-- agendas_diarias
ALTER POLICY agenda_insert ON public.agendas_diarias TO authenticated;
ALTER POLICY agenda_select ON public.agendas_diarias TO authenticated;
ALTER POLICY agenda_update ON public.agendas_diarias TO authenticated;

-- anuncios
ALTER POLICY anuncios_insert ON public.anuncios TO authenticated;
ALTER POLICY anuncios_select ON public.anuncios TO authenticated;
ALTER POLICY anuncios_update_autor ON public.anuncios TO authenticated;

-- asistencias
ALTER POLICY asistencia_insert ON public.asistencias TO authenticated;
ALTER POLICY asistencia_select ON public.asistencias TO authenticated;
ALTER POLICY asistencia_update ON public.asistencias TO authenticated;

-- audit_log
ALTER POLICY audit_admin_select ON public.audit_log TO authenticated;

-- aulas
ALTER POLICY aulas_admin_all ON public.aulas TO authenticated;
ALTER POLICY aulas_select_miembros ON public.aulas TO authenticated;

-- aulas_curso
ALTER POLICY aulas_curso_admin_all ON public.aulas_curso TO authenticated;
ALTER POLICY aulas_curso_select_miembros ON public.aulas_curso TO authenticated;

-- ausencias
ALTER POLICY ausencia_insert ON public.ausencias TO authenticated;
ALTER POLICY ausencia_select ON public.ausencias TO authenticated;
ALTER POLICY ausencia_update ON public.ausencias TO authenticated;

-- autorizaciones
ALTER POLICY autorizaciones_insert ON public.autorizaciones TO authenticated;
ALTER POLICY autorizaciones_select ON public.autorizaciones TO authenticated;
ALTER POLICY autorizaciones_update ON public.autorizaciones TO authenticated;

-- beca_comedor_desborde
ALTER POLICY beca_desborde_delete ON public.beca_comedor_desborde TO authenticated;
ALTER POLICY beca_desborde_insert ON public.beca_comedor_desborde TO authenticated;
ALTER POLICY beca_desborde_select ON public.beca_comedor_desborde TO authenticated;
ALTER POLICY beca_desborde_update ON public.beca_comedor_desborde TO authenticated;

-- beca_comedor_elegibilidad
ALTER POLICY beca_elegibilidad_delete ON public.beca_comedor_elegibilidad TO authenticated;
ALTER POLICY beca_elegibilidad_insert ON public.beca_comedor_elegibilidad TO authenticated;
ALTER POLICY beca_elegibilidad_select ON public.beca_comedor_elegibilidad TO authenticated;
ALTER POLICY beca_elegibilidad_update ON public.beca_comedor_elegibilidad TO authenticated;

-- beca_comedor_tramo
ALTER POLICY beca_tramo_delete ON public.beca_comedor_tramo TO authenticated;
ALTER POLICY beca_tramo_insert ON public.beca_comedor_tramo TO authenticated;
ALTER POLICY beca_tramo_select ON public.beca_comedor_tramo TO authenticated;
ALTER POLICY beca_tramo_update ON public.beca_comedor_tramo TO authenticated;

-- beca_comedor_transferencia
ALTER POLICY beca_transferencia_delete ON public.beca_comedor_transferencia TO authenticated;
ALTER POLICY beca_transferencia_insert ON public.beca_comedor_transferencia TO authenticated;
ALTER POLICY beca_transferencia_select ON public.beca_comedor_transferencia TO authenticated;
ALTER POLICY beca_transferencia_update ON public.beca_comedor_transferencia TO authenticated;

-- biberones
ALTER POLICY biberon_insert ON public.biberones TO authenticated;
ALTER POLICY biberon_select ON public.biberones TO authenticated;
ALTER POLICY biberon_update ON public.biberones TO authenticated;

-- campanas_informe
ALTER POLICY campanas_informe_insert ON public.campanas_informe TO authenticated;
ALTER POLICY campanas_informe_select ON public.campanas_informe TO authenticated;
ALTER POLICY campanas_informe_update ON public.campanas_informe TO authenticated;

-- centros
ALTER POLICY centros_admin_all ON public.centros TO authenticated;
ALTER POLICY centros_select_miembros ON public.centros TO authenticated;

-- cita_invitados
ALTER POLICY cita_invitados_delete ON public.cita_invitados TO authenticated;
ALTER POLICY cita_invitados_insert ON public.cita_invitados TO authenticated;
ALTER POLICY cita_invitados_select ON public.cita_invitados TO authenticated;
ALTER POLICY cita_invitados_update ON public.cita_invitados TO authenticated;

-- citas
ALTER POLICY citas_insert ON public.citas TO authenticated;
ALTER POLICY citas_select ON public.citas TO authenticated;
ALTER POLICY citas_update ON public.citas TO authenticated;

-- comidas
ALTER POLICY comida_insert ON public.comidas TO authenticated;
ALTER POLICY comida_select ON public.comidas TO authenticated;
ALTER POLICY comida_update ON public.comidas TO authenticated;

-- confirmaciones_evento
ALTER POLICY confirmaciones_insert ON public.confirmaciones_evento TO authenticated;
ALTER POLICY confirmaciones_select ON public.confirmaciones_evento TO authenticated;
ALTER POLICY confirmaciones_update ON public.confirmaciones_evento TO authenticated;

-- consentimientos
ALTER POLICY consentimientos_admin_select ON public.consentimientos TO authenticated;
ALTER POLICY consentimientos_insert ON public.consentimientos TO authenticated;
ALTER POLICY consentimientos_self_select ON public.consentimientos TO authenticated;

-- conversaciones
ALTER POLICY conversaciones_insert ON public.conversaciones TO authenticated;
ALTER POLICY conversaciones_select ON public.conversaciones TO authenticated;
ALTER POLICY conversaciones_update_admin_familia ON public.conversaciones TO authenticated;

-- cursos_academicos
ALTER POLICY cursos_admin_all ON public.cursos_academicos TO authenticated;
ALTER POLICY cursos_select_miembros ON public.cursos_academicos TO authenticated;

-- deposiciones
ALTER POLICY deposicion_insert ON public.deposiciones TO authenticated;
ALTER POLICY deposicion_select ON public.deposiciones TO authenticated;
ALTER POLICY deposicion_update ON public.deposiciones TO authenticated;

-- dias_centro
ALTER POLICY dias_centro_delete ON public.dias_centro TO authenticated;
ALTER POLICY dias_centro_insert ON public.dias_centro TO authenticated;
ALTER POLICY dias_centro_select ON public.dias_centro TO authenticated;
ALTER POLICY dias_centro_update ON public.dias_centro TO authenticated;

-- eventos
ALTER POLICY eventos_insert ON public.eventos TO authenticated;
ALTER POLICY eventos_select ON public.eventos TO authenticated;
ALTER POLICY eventos_update ON public.eventos TO authenticated;

-- export_log
ALTER POLICY export_log_admin_select ON public.export_log TO authenticated;

-- firmas_autorizacion
ALTER POLICY firmas_insert ON public.firmas_autorizacion TO authenticated;
ALTER POLICY firmas_select ON public.firmas_autorizacion TO authenticated;

-- info_medica_emergencia
ALTER POLICY ime_admin_all ON public.info_medica_emergencia TO authenticated;
ALTER POLICY ime_profe_select ON public.info_medica_emergencia TO authenticated;
ALTER POLICY ime_tutor_select ON public.info_medica_emergencia TO authenticated;

-- informes_evolucion
ALTER POLICY informes_evolucion_insert ON public.informes_evolucion TO authenticated;
ALTER POLICY informes_evolucion_select ON public.informes_evolucion TO authenticated;
ALTER POLICY informes_evolucion_update ON public.informes_evolucion TO authenticated;

-- invitaciones
ALTER POLICY invitaciones_admin ON public.invitaciones TO authenticated;

-- lectura_anuncio
ALTER POLICY lectura_anuncio_insert_self ON public.lectura_anuncio TO authenticated;
ALTER POLICY lectura_anuncio_select_autor ON public.lectura_anuncio TO authenticated;
ALTER POLICY lectura_anuncio_select_self ON public.lectura_anuncio TO authenticated;

-- lectura_conversacion
ALTER POLICY lectura_conv_insert_self ON public.lectura_conversacion TO authenticated;
ALTER POLICY lectura_conv_select_self ON public.lectura_conversacion TO authenticated;
ALTER POLICY lectura_conv_update_self ON public.lectura_conversacion TO authenticated;

-- lista_espera
ALTER POLICY lista_espera_admin_all ON public.lista_espera TO authenticated;

-- matriculas
ALTER POLICY matriculas_admin_all ON public.matriculas TO authenticated;
ALTER POLICY matriculas_profe_select ON public.matriculas TO authenticated;
ALTER POLICY matriculas_tutor_select ON public.matriculas TO authenticated;

-- media
ALTER POLICY media_delete ON public.media TO authenticated;
ALTER POLICY media_insert ON public.media TO authenticated;
ALTER POLICY media_select ON public.media TO authenticated;

-- media_etiquetas
ALTER POLICY media_etiquetas_delete ON public.media_etiquetas TO authenticated;
ALTER POLICY media_etiquetas_insert ON public.media_etiquetas TO authenticated;
ALTER POLICY media_etiquetas_select ON public.media_etiquetas TO authenticated;

-- mensajes
ALTER POLICY mensajes_insert ON public.mensajes TO authenticated;
ALTER POLICY mensajes_select ON public.mensajes TO authenticated;
ALTER POLICY mensajes_update_autor ON public.mensajes TO authenticated;

-- menu_dia
ALTER POLICY menu_dia_insert ON public.menu_dia TO authenticated;
ALTER POLICY menu_dia_select ON public.menu_dia TO authenticated;
ALTER POLICY menu_dia_update ON public.menu_dia TO authenticated;

-- ninos
ALTER POLICY ninos_admin_all ON public.ninos TO authenticated;
ALTER POLICY ninos_profe_select ON public.ninos TO authenticated;
ALTER POLICY ninos_tutor_select ON public.ninos TO authenticated;

-- olvido_solicitudes
ALTER POLICY olvido_solicitudes_admin_select ON public.olvido_solicitudes TO authenticated;

-- plantillas_informe
ALTER POLICY plantillas_informe_insert ON public.plantillas_informe TO authenticated;
ALTER POLICY plantillas_informe_select ON public.plantillas_informe TO authenticated;
ALTER POLICY plantillas_informe_update ON public.plantillas_informe TO authenticated;

-- plantillas_menu_mensual
ALTER POLICY plantillas_menu_insert ON public.plantillas_menu_mensual TO authenticated;
ALTER POLICY plantillas_menu_select ON public.plantillas_menu_mensual TO authenticated;
ALTER POLICY plantillas_menu_update ON public.plantillas_menu_mensual TO authenticated;

-- preferencias_usuario
ALTER POLICY preferencias_usuario_delete ON public.preferencias_usuario TO authenticated;
ALTER POLICY preferencias_usuario_insert ON public.preferencias_usuario TO authenticated;
ALTER POLICY preferencias_usuario_select ON public.preferencias_usuario TO authenticated;
ALTER POLICY preferencias_usuario_update ON public.preferencias_usuario TO authenticated;

-- profes_aulas
ALTER POLICY profes_aulas_admin_all ON public.profes_aulas TO authenticated;
ALTER POLICY profes_aulas_self_select ON public.profes_aulas TO authenticated;

-- publicaciones
ALTER POLICY publicaciones_delete ON public.publicaciones TO authenticated;
ALTER POLICY publicaciones_insert ON public.publicaciones TO authenticated;
ALTER POLICY publicaciones_select ON public.publicaciones TO authenticated;
ALTER POLICY publicaciones_update ON public.publicaciones TO authenticated;

-- push_subscriptions
ALTER POLICY push_subscriptions_delete_self ON public.push_subscriptions TO authenticated;
ALTER POLICY push_subscriptions_insert_self ON public.push_subscriptions TO authenticated;
ALTER POLICY push_subscriptions_select_self ON public.push_subscriptions TO authenticated;
ALTER POLICY push_subscriptions_update_self ON public.push_subscriptions TO authenticated;

-- recordatorios
ALTER POLICY recordatorios_insert ON public.recordatorios TO authenticated;
ALTER POLICY recordatorios_select ON public.recordatorios TO authenticated;
ALTER POLICY recordatorios_update ON public.recordatorios TO authenticated;

-- retencion_ejecuciones
ALTER POLICY retencion_ejecuciones_admin_select ON public.retencion_ejecuciones TO authenticated;

-- roles_usuario
ALTER POLICY roles_admin_all ON public.roles_usuario TO authenticated;
ALTER POLICY roles_self_select ON public.roles_usuario TO authenticated;

-- rollover_finaliza
ALTER POLICY rollover_finaliza_admin_all ON public.rollover_finaliza TO authenticated;

-- suenos
ALTER POLICY sueno_insert ON public.suenos TO authenticated;
ALTER POLICY sueno_select ON public.suenos TO authenticated;
ALTER POLICY sueno_update ON public.suenos TO authenticated;

-- tarifa_concepto_anio
ALTER POLICY tarifa_concepto_anio_delete ON public.tarifa_concepto_anio TO authenticated;
ALTER POLICY tarifa_concepto_anio_insert ON public.tarifa_concepto_anio TO authenticated;
ALTER POLICY tarifa_concepto_anio_select ON public.tarifa_concepto_anio TO authenticated;
ALTER POLICY tarifa_concepto_anio_update ON public.tarifa_concepto_anio TO authenticated;

-- usuarios
ALTER POLICY usuarios_admin_select ON public.usuarios TO authenticated;
ALTER POLICY usuarios_self_select ON public.usuarios TO authenticated;
ALTER POLICY usuarios_self_update ON public.usuarios TO authenticated;

-- vinculos_familiares
ALTER POLICY vinculos_admin_all ON public.vinculos_familiares TO authenticated;
ALTER POLICY vinculos_profe_select ON public.vinculos_familiares TO authenticated;
ALTER POLICY vinculos_self_select ON public.vinculos_familiares TO authenticated;

-- 2. Helpers: fuera PUBLIC y anon (authenticated y service_role conservan EXECUTE por nombre)
REVOKE EXECUTE ON FUNCTION public.es_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.es_profe_de_aula(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.es_profe_de_evento(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.es_profe_de_nino(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.es_profe_en_centro(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.es_redactor_de_aula(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.es_redactor_de_nino(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.es_tutor_de(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.es_tutor_en_aula(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pertenece_a_centro(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.puede_participar_conversacion(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.puede_postear_en_conversacion(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tiene_permiso_sobre(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.usuario_es_audiencia_anuncio(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.usuario_es_audiencia_anuncio_row(uuid, uuid, public.ambito_anuncio, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.usuario_es_audiencia_autorizacion_row(uuid, public.tipo_autorizacion, boolean, public.autorizacion_ambito, uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.usuario_es_audiencia_cita_row(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.usuario_es_audiencia_evento_row(uuid, public.ambito_evento, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.usuario_es_audiencia_informe_row(uuid, uuid, public.estado_informe) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.usuario_ve_publicacion_row(uuid, uuid, uuid) FROM PUBLIC, anon;

-- 3. Guarda
DO $guard$
DECLARE v_pol int; v_anon int; v_auth int;
BEGIN
  SELECT count(*) INTO v_pol FROM pg_policies WHERE schemaname = 'public' AND 'public' = ANY (roles);
  SELECT count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE')),
         count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    INTO v_anon, v_auth
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('es_admin','es_profe_de_aula','es_profe_de_evento','es_profe_de_nino',
       'es_profe_en_centro','es_redactor_de_aula','es_redactor_de_nino','es_tutor_de','es_tutor_en_aula',
       'pertenece_a_centro','puede_participar_conversacion','puede_postear_en_conversacion',
       'tiene_permiso_sobre','usuario_es_audiencia_anuncio','usuario_es_audiencia_anuncio_row',
       'usuario_es_audiencia_autorizacion_row','usuario_es_audiencia_cita_row',
       'usuario_es_audiencia_evento_row','usuario_es_audiencia_informe_row','usuario_ve_publicacion_row');
  IF v_pol <> 0 OR v_anon <> 0 OR v_auth <> 20 THEN
    RAISE EXCEPTION 'guarda PR-3: policies TO public en public=%, helpers con anon=%, helpers con authenticated=% (esperado 0/0/20)',
      v_pol, v_anon, v_auth;
  END IF;
END $guard$;
