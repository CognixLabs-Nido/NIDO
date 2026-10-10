-- =============================================================================
-- FIX — cerrar a anon las 46 funciones auxiliares que seguían abiertas (limpieza de seguridad)
-- -----------------------------------------------------------------------------
-- #293, #295 y #297 cerraron a anon 65 funciones. Quedaban 46 funciones de `public` que no son de
-- trigger con EXECUTE para PUBLIC y anon (default privileges), comprobado en producción el
-- 2026-10-10. Con la anon key (pública, va en el bundle) PostgREST las deja ejecutar.
--
-- Ninguna la necesita anon:
--   · ninguna policy TO public/anon las usa (todas las que las llaman son TO authenticated, y la
--     única policy TO public que queda, storage.objects · centro_assets_select, no llama a
--     ninguna);
--   · la app solo las llama con la sesión del usuario o con service_role, y ninguna ruta pública
--     (/, /login, /forgot-password, /reset-password, /invitation, /privacy, /terms, /forbidden)
--     las usa;
--   · ninguna mira auth.uid(), auth.role() ni el JWT: son consultas puras por el id recibido. No
--     hay patrón «uid NULL» que arreglar en los cuerpos.
--
-- Solo ACL: REVOKE de PUBLIC y anon. authenticated y service_role conservan EXECUTE (concedido
-- por nombre, no vía PUBLIC): lo necesitan 74 policies TO authenticated, el CHECK de
-- datos_pedagogicos_nino (idiomas_iso_2letras), la app y los triggers que corren con el rol de
-- quien escribe (media_validar_ruta, invitaciones_validar_centro, anuncios_validar_aula_centro).
-- No se toca ningún cuerpo ni el permiso de authenticated.
--
-- Fuera de alcance:
--   · las 34 funciones de trigger con EXECUTE para anon (no se pueden llamar por RPC);
--   · los privilegios de tabla de anon (INSERT/UPDATE/DELETE/TRUNCATE en 72 tablas): PR siguiente;
--   · que authenticated pueda usarlas con ids de otro centro: riesgo multicentro, como D4.
--
-- Guarda final: aborta si queda alguna función de public (no trigger) que anon pueda ejecutar, o si
-- authenticated o service_role pierden EXECUTE en alguna de las 46.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor (CLI SIGILL
-- en ARM). Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- A. Traducen un id en otro (24)
REVOKE EXECUTE ON FUNCTION public.centro_de_agenda(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.centro_de_aula(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.centro_de_cita(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.centro_de_concepto(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.centro_de_conversacion(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.centro_de_curso(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.centro_de_evento(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.centro_de_familia(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.centro_de_nino(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.centro_de_plantilla(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.centro_de_publicacion(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.centro_de_recibo(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.centro_de_remesa(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.familia_de_nino(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.familia_de_recibo(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.nino_de_agenda(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.nino_de_conversacion(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.nino_de_recibo(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.aula_de_publicacion(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.autor_de_publicacion(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.organizador_de_cita(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.publicacion_de_media(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fecha_de_agenda(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.curso_activo_de_centro(uuid) FROM PUBLIC, anon;

-- B. Devuelven sí o no (17)
REVOKE EXECUTE ON FUNCTION public.tiene_consentimiento(uuid, public.consentimiento_tipo) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.es_tutor_en_centro(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tiene_consentimiento_imagen(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.existe_consentimiento_imagen(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.nino_puede_aparecer(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.medicacion_administrable_hoy(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mes_cerrado(uuid, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.recibo_en_remesa(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.autorizacion_aplica_a_nino(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.autorizacion_firmable(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.autorizacion_plantilla_valida(uuid, uuid, public.tipo_autorizacion) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.evento_aplica_a_nino(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.conversacion_activa(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.publicacion_tiene_nino_sin_permiso(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.centro_abierto(uuid, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dentro_de_ventana_edicion(date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.nino_toma_comida_solida(uuid) FROM PUBLIC, anon;

-- C. Devuelven datos (2)
REVOKE EXECUTE ON FUNCTION public.menu_del_dia(uuid, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tipo_de_dia(uuid, date) FROM PUBLIC, anon;

-- D. No leen ninguna tabla (3)
REVOKE EXECUTE ON FUNCTION public._redactar_jsonb(jsonb, text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.idiomas_iso_2letras(text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.hoy_madrid() FROM PUBLIC, anon;

-- Guarda
DO $$
DECLARE
  v_anon_abiertas text;
  v_sin_auth      text;
  v_sin_service   text;
  v_lista regprocedure[] := ARRAY[
    'public.centro_de_agenda(uuid)'::regprocedure,
    'public.centro_de_aula(uuid)'::regprocedure,
    'public.centro_de_cita(uuid)'::regprocedure,
    'public.centro_de_concepto(uuid)'::regprocedure,
    'public.centro_de_conversacion(uuid)'::regprocedure,
    'public.centro_de_curso(uuid)'::regprocedure,
    'public.centro_de_evento(uuid)'::regprocedure,
    'public.centro_de_familia(uuid)'::regprocedure,
    'public.centro_de_nino(uuid)'::regprocedure,
    'public.centro_de_plantilla(uuid)'::regprocedure,
    'public.centro_de_publicacion(uuid)'::regprocedure,
    'public.centro_de_recibo(uuid)'::regprocedure,
    'public.centro_de_remesa(uuid)'::regprocedure,
    'public.familia_de_nino(uuid)'::regprocedure,
    'public.familia_de_recibo(uuid)'::regprocedure,
    'public.nino_de_agenda(uuid)'::regprocedure,
    'public.nino_de_conversacion(uuid)'::regprocedure,
    'public.nino_de_recibo(uuid)'::regprocedure,
    'public.aula_de_publicacion(uuid)'::regprocedure,
    'public.autor_de_publicacion(uuid)'::regprocedure,
    'public.organizador_de_cita(uuid)'::regprocedure,
    'public.publicacion_de_media(uuid)'::regprocedure,
    'public.fecha_de_agenda(uuid)'::regprocedure,
    'public.curso_activo_de_centro(uuid)'::regprocedure,
    'public.tiene_consentimiento(uuid, public.consentimiento_tipo)'::regprocedure,
    'public.es_tutor_en_centro(uuid, uuid)'::regprocedure,
    'public.tiene_consentimiento_imagen(uuid)'::regprocedure,
    'public.existe_consentimiento_imagen(uuid)'::regprocedure,
    'public.nino_puede_aparecer(uuid)'::regprocedure,
    'public.medicacion_administrable_hoy(uuid)'::regprocedure,
    'public.mes_cerrado(uuid, integer, integer)'::regprocedure,
    'public.recibo_en_remesa(uuid)'::regprocedure,
    'public.autorizacion_aplica_a_nino(uuid, uuid)'::regprocedure,
    'public.autorizacion_firmable(uuid)'::regprocedure,
    'public.autorizacion_plantilla_valida(uuid, uuid, public.tipo_autorizacion)'::regprocedure,
    'public.evento_aplica_a_nino(uuid, uuid)'::regprocedure,
    'public.conversacion_activa(uuid)'::regprocedure,
    'public.publicacion_tiene_nino_sin_permiso(uuid)'::regprocedure,
    'public.centro_abierto(uuid, date)'::regprocedure,
    'public.dentro_de_ventana_edicion(date)'::regprocedure,
    'public.nino_toma_comida_solida(uuid)'::regprocedure,
    'public.menu_del_dia(uuid, date)'::regprocedure,
    'public.tipo_de_dia(uuid, date)'::regprocedure,
    'public._redactar_jsonb(jsonb, text[])'::regprocedure,
    'public.idiomas_iso_2letras(text[])'::regprocedure,
    'public.hoy_madrid()'::regprocedure
  ];
BEGIN
  IF cardinality(v_lista) <> 46 THEN
    RAISE EXCEPTION 'guarda: la lista tiene % funciones (esperadas 46)', cardinality(v_lista);
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ')
    INTO v_anon_abiertas
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prorettype <> 'trigger'::regtype
     AND has_function_privilege('anon', p.oid, 'EXECUTE');

  SELECT string_agg(f::text, ', ') INTO v_sin_auth
    FROM unnest(v_lista) f WHERE NOT has_function_privilege('authenticated', f, 'EXECUTE');

  SELECT string_agg(f::text, ', ') INTO v_sin_service
    FROM unnest(v_lista) f WHERE NOT has_function_privilege('service_role', f, 'EXECUTE');

  IF v_anon_abiertas IS NOT NULL OR v_sin_auth IS NOT NULL OR v_sin_service IS NOT NULL THEN
    RAISE EXCEPTION 'guarda: anon aún ejecuta [%]; authenticated sin EXECUTE [%]; service_role sin EXECUTE [%]',
      coalesce(v_anon_abiertas, ''), coalesce(v_sin_auth, ''), coalesce(v_sin_service, '');
  END IF;
END $$;
