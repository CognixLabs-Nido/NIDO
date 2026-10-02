-- =============================================================================
-- FIX — cerrar a anon las 35 RPCs del grupo B (limpieza de seguridad, PR-2)
-- -----------------------------------------------------------------------------
-- Los default privileges conceden EXECUTE a PUBLIC y a anon (por nombre) en cada función que se
-- crea, así que con la anon key (pública, va en el bundle) PostgREST deja entrar a estas 35. Todas
-- tienen guarda propia (uid NULL → rechazo; ninguna trata "sin uid" como el servicio), así que hoy
-- no filtran nada, pero exponen superficie que nadie necesita: ningún flujo las llama como anon
-- (las de pre-login usan service_role) y los helpers solo los invocan funciones SECURITY DEFINER,
-- que comprueban el permiso con la dueña, o policies TO authenticated.
--
-- Solo ACL: REVOKE de PUBLIC y anon. authenticated y service_role conservan EXECUTE (concedido
-- por nombre, no vía PUBLIC). No se toca ningún cuerpo.
--
-- Fuera de alcance: los 20 helpers usados en policies TO public (grupo C, PR-3). Revocarlos de
-- anon antes de pasar esas policies a TO authenticated cambiaría "0 filas" por 42501.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor (CLI SIGILL
-- en ARM). Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- Alta / niño
REVOKE EXECUTE ON FUNCTION public.crear_o_anadir_a_familia(text, text, date, uuid, uuid, text, text, text, text, uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.marcar_matricula_lista(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.baja_nino(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.archivar_nino(uuid, text, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.desarchivar_nino(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revocar_acceso_familia(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cerrar_curso(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.proponer_asignaciones(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reproponer_asignaciones(uuid) FROM PUBLIC, anon;

-- Recibos / SEPA
REVOKE EXECUTE ON FUNCTION public.generar_recibos_mes(uuid, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.crear_recibo_esporadico(uuid, uuid, uuid, integer, integer, text, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.confirmar_recibo(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.desconfirmar_recibo(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_mandatos_remesa(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_datos_acreedor(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_datos_acreedor(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.registrar_mandato_sepa(uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamptz, public.firma_metodo) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sustituir_mandato_sepa(uuid, uuid, text, text, text, text, text, text, text, inet, text, timestamptz, public.firma_metodo) FROM PUBLIC, anon;

-- Médico / datos del niño por el tutor
REVOKE EXECUTE ON FUNCTION public.get_info_medica_emergencia(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_info_medica_emergencia_cifrada(uuid, text, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_info_medica_emergencia_cifrada_tutor(uuid, text, text, text, text, text, text, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.borrar_info_medica_nino_tutor(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.actualizar_foto_nino_tutor(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.actualizar_identidad_nino_tutor(uuid, text, date, public.nino_sexo, text, text, text) FROM PUBLIC, anon;

-- Consentimientos / autorizaciones / imagen
REVOKE EXECUTE ON FUNCTION public.revocar_consentimiento(public.consentimiento_tipo) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.archivar_autorizacion(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.resolver_etiqueta_imagen(uuid) FROM PUBLIC, anon;

-- Contadores del nav
REVOKE EXECUTE ON FUNCTION public.contar_invitaciones_pendientes() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.contar_recordatorios_pendientes() FROM PUBLIC, anon;

-- Helpers sin policy TO public (solo policies TO authenticated o llamadas desde SECURITY DEFINER)
REVOKE EXECUTE ON FUNCTION public.es_tutor_de_familia(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.es_tutor_legal_de(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.familia_ve_aula(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.publicacion_etiqueta_hijo_de(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.usuario_es_invitado_cita(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.usuario_actual() FROM PUBLIC, anon;
