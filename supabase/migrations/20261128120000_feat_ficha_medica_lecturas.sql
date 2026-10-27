-- =============================================================================
-- FEAT — Quién ha leído la ficha médica (F11-B, punto 4)
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/ficha-medica-lecturas.md. Hasta ahora las lecturas de la ficha médica no se
-- registraban para nadie, y la tabla se podía leer directamente con sesión (tres políticas de
-- SELECT), así que un registro puesto solo en la función de lectura se podía saltar. Ahora:
--
--   · `get_info_medica_emergencia` escribe una fila en `lecturas_ficha_medica` por cada lectura
--     autorizada: niño, centro, quién, por qué pudo leer, desde dónde, qué campos vio y cuándo.
--     Cambia la firma: lleva el origen (`ficha`, `alta` o `export`).
--   · `info_medica_emergencia` deja de tener SELECT para las sesiones; las listas del aula usan
--     `alertas_medicas`, que solo dice alergia o medicación sí o no, con las mismas tres
--     condiciones que tenían las políticas.
--   · El registro lo leen los tutores legales del niño y la Dirección de su centro
--     (`lecturas_ficha_medica`), y sale en el export del niño (`export_datos_sujeto`). La Dirección
--     lo ve siempre, también con el niño de baja o el vínculo del tutor cerrado: el derecho de
--     acceso es de la persona. La familia se lo descarga, y si ya no entra, se lo descarga y se lo
--     entrega la Dirección.
--   · La purga del niño borra sus lecturas (trigger en `ninos`; con la fila borrada, en cascada).
--     El plazo provisional lo aplica el cron con `purgar_lecturas_ficha_medica`. La tabla no se
--     audita: nada de esto entra en audit_log.
--
-- `get_info_medica_emergencia` se recrea desde el texto de `20261123120000` y `export_datos_sujeto`
-- desde el de `20261127120000` (md5 normalizado en la guarda).
--
-- La aplica el responsable por SQL Editor, DESPUÉS de `20261127120000`. Tras aplicar: registrar en
-- supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_n   integer;
BEGIN
  IF to_regclass('public.lecturas_ficha_medica') IS NOT NULL THEN
    RAISE EXCEPTION 'ya aplicada: existe lecturas_ficha_medica';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'olvido_solicitudes'
                    AND column_name = 'tutores_legales') THEN
    RAISE EXCEPTION 'falta 20261127120000: olvido_solicitudes no tiene tutores_legales';
  END IF;

  -- Las dos funciones que se recrean tienen que ser las leídas en producción
  -- (md5 normalizado: sin \r, sin comentarios, espacios colapsados).
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.get_info_medica_emergencia(uuid)');
  IF v_md5 IS DISTINCT FROM '688878514101e68eb2e938cef4e37959' THEN
    RAISE EXCEPTION 'get_info_medica_emergencia no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.export_datos_sujeto(text,uuid)');
  IF v_md5 IS DISTINCT FROM 'a34f530df734488c9033d7fe73e7a094' THEN
    RAISE EXCEPTION 'export_datos_sujeto no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;

  -- Las tres políticas de lectura que se quitan, con la condición que copia `alertas_medicas`.
  SELECT count(*) INTO v_n FROM pg_policy
   WHERE polrelid = 'public.info_medica_emergencia'::regclass;
  IF v_n <> 3
     OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.info_medica_emergencia'::regclass
                     AND polname = 'ime_admin_select' AND polcmd = 'r'
                     AND md5(pg_get_expr(polqual, polrelid)) = 'a57d168ebd15fcc7a2b3415c8bfe8c0b')
     OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.info_medica_emergencia'::regclass
                     AND polname = 'ime_profe_select' AND polcmd = 'r'
                     AND md5(pg_get_expr(polqual, polrelid)) = '29fe92f526cf55b88de126ba442344dd')
     OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.info_medica_emergencia'::regclass
                     AND polname = 'ime_tutor_select' AND polcmd = 'r'
                     AND md5(pg_get_expr(polqual, polrelid)) = 'c1fdf12440fc213fa7e048988a05ec7c') THEN
    RAISE EXCEPTION 'las políticas de info_medica_emergencia no son las leídas en producción (% en total)', v_n;
  END IF;

  -- Nadie más lee la tabla con los permisos de quien llama: todas las funciones que la nombran son
  -- SECURITY DEFINER, y ninguna vista ni política de otra tabla la usa.
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'privado') AND NOT p.prosecdef
     AND p.prosrc ILIKE '%info_medica_emergencia%';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% funciones de invocador leen info_medica_emergencia', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_views WHERE definition ILIKE '%info_medica_emergencia%')
     OR EXISTS (SELECT 1 FROM pg_policies WHERE tablename <> 'info_medica_emergencia'
                 AND (qual ILIKE '%info_medica_emergencia%' OR with_check ILIKE '%info_medica_emergencia%')) THEN
    RAISE EXCEPTION 'una vista o una política de otra tabla lee info_medica_emergencia';
  END IF;

  SELECT count(*) INTO v_n FROM public.info_medica_emergencia;
  RAISE NOTICE 'guarda previa: % fichas médicas', v_n;
END
$guarda$;

-- ---- 1. El registro de lecturas ----
CREATE TABLE public.lecturas_ficha_medica (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nino_id     uuid NOT NULL REFERENCES public.ninos(id) ON DELETE CASCADE,
  centro_id   uuid NOT NULL REFERENCES public.centros(id) ON DELETE CASCADE,
  lector_id   uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  rol_lector  text NOT NULL CONSTRAINT lecturas_ficha_medica_rol_check
                CHECK (rol_lector IN ('admin', 'directora', 'superusuario', 'profe',
                                      'tutor_legal', 'autorizado')),
  origen      text NOT NULL CONSTRAINT lecturas_ficha_medica_origen_check
                CHECK (origen IN ('ficha', 'alta', 'export')),
  campos      text[] NOT NULL DEFAULT '{}' CONSTRAINT lecturas_ficha_medica_campos_check
                CHECK (campos <@ ARRAY['alergias_graves', 'notas_emergencia', 'medicacion_habitual',
                                       'alergias_leves', 'medico_familia', 'telefono_emergencia']),
  leida_en    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lecturas_ficha_medica_nino_idx ON public.lecturas_ficha_medica (nino_id, leida_en);
CREATE INDEX lecturas_ficha_medica_leida_idx ON public.lecturas_ficha_medica (leida_en);

-- Sin políticas: se escribe y se lee solo por funciones.
ALTER TABLE public.lecturas_ficha_medica ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lecturas_ficha_medica FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.lecturas_ficha_medica IS
  'Quién ha leído la ficha médica de cada niño (F11-B, punto 4): la escribe get_info_medica_emergencia en cada lectura autorizada; la leen los tutores legales y la Dirección (lecturas_ficha_medica) y sale en el export del niño. No se audita. La purga del niño la borra; el plazo provisional lo aplica purgar_lecturas_ficha_medica (20261128120000).';

-- La purga del niño (purgar_sujeto_db lo deja con deleted_reason = 'purga_rgpd') borra sus
-- lecturas. Si la fila del niño se borra, caen en cascada.
CREATE FUNCTION privado.ninos_purga_borra_lecturas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  DELETE FROM public.lecturas_ficha_medica WHERE nino_id = NEW.id;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION privado.ninos_purga_borra_lecturas() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER ninos_purga_borra_lecturas
  AFTER UPDATE OF deleted_reason ON public.ninos
  FOR EACH ROW
  WHEN (NEW.deleted_reason = 'purga_rgpd' AND OLD.deleted_reason IS DISTINCT FROM 'purga_rgpd')
  EXECUTE FUNCTION privado.ninos_purga_borra_lecturas();

-- ---- 2. La lectura descifrada deja su fila ----
DROP FUNCTION public.get_info_medica_emergencia(uuid);

CREATE FUNCTION public.get_info_medica_emergencia(p_nino_id uuid, p_origen text DEFAULT 'ficha')
 RETURNS TABLE(alergias_graves text, notas_emergencia text, medicacion_habitual text, alergias_leves text, medico_familia text, telefono_emergencia text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clave text := public._get_medical_key();
  v_centro_del_nino uuid;
  v_autorizado boolean := false;
  v_uid uuid := auth.uid();
  v_rol text;
  v_ime public.info_medica_emergencia%ROWTYPE;
  v_campos text[] := '{}';
BEGIN
  IF p_origen IS NULL OR p_origen NOT IN ('ficha', 'alta', 'export') THEN
    RAISE EXCEPTION 'origen de la lectura no válido: %', coalesce(p_origen, 'NULL')
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT centro_id INTO v_centro_del_nino FROM public.ninos WHERE id = p_nino_id;
  IF v_centro_del_nino IS NULL THEN
    RAISE EXCEPTION 'Niño no encontrado: %', p_nino_id;
  END IF;

  -- Por qué puede leer, en el mismo orden que autoriza: es lo que se registra.
  IF public.es_admin(v_centro_del_nino) THEN
    v_autorizado := true;
    SELECT CASE WHEN bool_or(r.rol::text = 'admin') THEN 'admin'
                WHEN bool_or(r.rol::text = 'directora') THEN 'directora' END
      INTO v_rol
      FROM public.roles_usuario r
     WHERE r.usuario_id = v_uid AND r.centro_id = v_centro_del_nino AND r.deleted_at IS NULL
       AND r.rol::text IN ('admin', 'directora');
    v_rol := coalesce(v_rol, 'superusuario');
  ELSIF EXISTS (
    SELECT 1 FROM public.matriculas m
    WHERE m.nino_id = p_nino_id
      AND m.fecha_baja IS NULL AND m.deleted_at IS NULL AND m.estado = 'activa'
      AND public.es_profe_de_aula(m.aula_id)
  ) THEN
    v_autorizado := true;
    v_rol := 'profe';
  ELSIF public.tiene_permiso_sobre(p_nino_id, 'puede_ver_info_medica') THEN
    v_autorizado := true;
    v_rol := CASE WHEN public.es_tutor_legal_de(p_nino_id) THEN 'tutor_legal' ELSE 'autorizado' END;
  END IF;

  IF NOT v_autorizado THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- La lectura queda registrada con los campos que se entregan (los que tienen contenido), en la
  -- misma transacción que descifra (20261128120000).
  SELECT * INTO v_ime FROM public.info_medica_emergencia WHERE nino_id = p_nino_id;
  IF FOUND THEN
    v_campos := array_remove(ARRAY[
      CASE WHEN v_ime.alergias_graves     IS NOT NULL THEN 'alergias_graves' END,
      CASE WHEN v_ime.notas_emergencia    IS NOT NULL THEN 'notas_emergencia' END,
      CASE WHEN v_ime.medicacion_habitual IS NOT NULL THEN 'medicacion_habitual' END,
      CASE WHEN v_ime.alergias_leves      IS NOT NULL THEN 'alergias_leves' END,
      CASE WHEN v_ime.medico_familia      IS NOT NULL THEN 'medico_familia' END,
      CASE WHEN v_ime.telefono_emergencia IS NOT NULL THEN 'telefono_emergencia' END], NULL);
  END IF;
  INSERT INTO public.lecturas_ficha_medica (nino_id, centro_id, lector_id, rol_lector, origen, campos)
  VALUES (p_nino_id, v_centro_del_nino, v_uid, v_rol, p_origen, v_campos);

  RETURN QUERY
  SELECT
    CASE WHEN ime.alergias_graves     IS NULL THEN NULL ELSE pgp_sym_decrypt(ime.alergias_graves,     v_clave) END,
    CASE WHEN ime.notas_emergencia    IS NULL THEN NULL ELSE pgp_sym_decrypt(ime.notas_emergencia,    v_clave) END,
    CASE WHEN ime.medicacion_habitual IS NULL THEN NULL ELSE pgp_sym_decrypt(ime.medicacion_habitual, v_clave) END,
    CASE WHEN ime.alergias_leves      IS NULL THEN NULL ELSE pgp_sym_decrypt(ime.alergias_leves,      v_clave) END,
    CASE WHEN ime.medico_familia      IS NULL THEN NULL ELSE pgp_sym_decrypt(ime.medico_familia,      v_clave) END,
    CASE WHEN ime.telefono_emergencia IS NULL THEN NULL ELSE pgp_sym_decrypt(ime.telefono_emergencia, v_clave) END
  FROM public.info_medica_emergencia ime
  WHERE ime.nino_id = p_nino_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_info_medica_emergencia(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_info_medica_emergencia(uuid, text) TO authenticated, service_role;

-- ---- 3. Las listas del aula: solo los avisos ----
-- Alergia grave y medicación, sí o no, de los niños que quien llama podía leer con las tres
-- políticas que se quitan abajo (mismas condiciones). Sin contenido: no se registra.
CREATE FUNCTION public.alertas_medicas(p_nino_ids uuid[])
RETURNS TABLE (nino_id uuid, alergia_grave boolean, medicacion boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT ime.nino_id, ime.alergias_graves IS NOT NULL, ime.medicacion_habitual IS NOT NULL
    FROM public.info_medica_emergencia ime
   WHERE ime.nino_id = ANY (p_nino_ids)
     AND (public.es_admin(privado.centro_de_nino(ime.nino_id))
          OR public.es_profe_de_nino(ime.nino_id)
          OR public.tiene_permiso_sobre(ime.nino_id, 'puede_ver_info_medica'));
$function$;
REVOKE ALL ON FUNCTION public.alertas_medicas(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.alertas_medicas(uuid[]) TO authenticated;

-- Con sesión, la ficha ya no se lee directamente: el contenido sale por get_info_medica_emergencia
-- (que lo registra) y los avisos por alertas_medicas.
DROP POLICY ime_admin_select ON public.info_medica_emergencia;
DROP POLICY ime_profe_select ON public.info_medica_emergencia;
DROP POLICY ime_tutor_select ON public.info_medica_emergencia;
REVOKE SELECT ON public.info_medica_emergencia FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.info_medica_emergencia IS
  'Ficha médica de urgencia del niño. Los seis campos van cifrados con pgcrypto (clave medical_encryption_key en Vault): solo los escriben set_info_medica_emergencia_cifrada(_tutor) y solo los descifra get_info_medica_emergencia, que registra cada lectura en lecturas_ficha_medica. Vacío = NULL (20261123120000). Las sesiones no la leen ni la escriben: los avisos de las listas salen de alertas_medicas (20261128120000).';

-- ---- 4. El registro, para la familia y la Dirección ----
CREATE FUNCTION public.lecturas_ficha_medica(p_nino_id uuid)
RETURNS TABLE (leida_en timestamptz, lector_nombre text, rol_lector text, origen text, campos text[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_centro uuid;
BEGIN
  SELECT n.centro_id INTO v_centro FROM public.ninos n WHERE n.id = p_nino_id;
  -- Los tutores legales del niño (con vínculo vivo) y la Dirección de su centro (es_admin: la
  -- titular, la directora y el superusuario), que lo ve siempre, aunque el niño esté de baja.
  IF auth.uid() IS NULL OR v_centro IS NULL
     OR NOT (public.es_tutor_legal_de(p_nino_id) OR public.es_admin(v_centro)) THEN
    RAISE EXCEPTION 'no autorizado a leer este registro' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT l.leida_en, u.nombre_completo, l.rol_lector, l.origen, l.campos
    FROM public.lecturas_ficha_medica l
    LEFT JOIN public.usuarios u ON u.id = l.lector_id
   WHERE l.nino_id = p_nino_id
   ORDER BY l.leida_en DESC;
END;
$function$;
REVOKE ALL ON FUNCTION public.lecturas_ficha_medica(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lecturas_ficha_medica(uuid) TO authenticated;

-- ---- 5. El plazo (provisional, PENDIENTE política F11-B) ----
-- Lo llama el cron de retención con los meses de la app; en simulación solo cuenta.
CREATE FUNCTION public.purgar_lecturas_ficha_medica(p_meses integer, p_simular boolean)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_n integer;
BEGIN
  IF p_meses IS NULL OR p_meses < 1 OR p_simular IS NULL THEN
    RAISE EXCEPTION 'plazo de las lecturas no válido' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_simular THEN
    SELECT count(*) INTO v_n FROM public.lecturas_ficha_medica
     WHERE leida_en < now() - make_interval(months => p_meses);
  ELSE
    DELETE FROM public.lecturas_ficha_medica WHERE leida_en < now() - make_interval(months => p_meses);
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.purgar_lecturas_ficha_medica(integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purgar_lecturas_ficha_medica(integer, boolean) TO service_role;

-- ---- 6. El export del niño lleva el registro ----
CREATE OR REPLACE FUNCTION public.export_datos_sujeto(p_sujeto_tipo text, p_sujeto_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_self   boolean;
  v_admin  boolean;
  v_centro uuid;
  v_email  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no autorizado a exportar este sujeto'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ---------------------------------------------------------------- USUARIO
  IF p_sujeto_tipo = 'usuario' THEN
    v_self := v_uid = p_sujeto_id;
    IF NOT v_self AND NOT EXISTS (
      SELECT 1 FROM public.roles_usuario ru
       WHERE ru.usuario_id = p_sujeto_id
         AND ru.deleted_at IS NULL
         AND privado.es_responsable(ru.centro_id)
    ) THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = p_sujeto_id;

    -- Cada fila con centro pasa si es el propio usuario o si quien exporta es admin de ese
    -- centro (centro NULL nunca: es_responsable(NULL) es FALSE).
    RETURN jsonb_build_object(
      'preferencias', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'clave', p.clave, 'valor', p.valor, 'actualizado_en', p.updated_at)
               ORDER BY p.clave)
          FROM public.preferencias_usuario p
         WHERE p.usuario_id = p_sujeto_id), '[]'::jsonb),

      'dispositivos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'navegador', s.user_agent, 'registrado_en', s.created_at,
                 'ultima_actividad', s.last_active_at)
               ORDER BY s.created_at)
          FROM public.push_subscriptions s
         WHERE s.usuario_id = p_sujeto_id), '[]'::jsonb),

      'lecturas_conversaciones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'conversacion_id', l.conversacion_id, 'leido_hasta', l.last_read_at)
               ORDER BY l.last_read_at)
          FROM public.lectura_conversacion l
          JOIN public.conversaciones c ON c.id = l.conversacion_id
         WHERE l.usuario_id = p_sujeto_id
           AND (v_self OR (c.centro_id IS NOT NULL AND privado.es_responsable(c.centro_id)))), '[]'::jsonb),

      'lecturas_anuncios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'anuncio_id', l.anuncio_id, 'anuncio', a.titulo, 'leido_en', l.leido_at)
               ORDER BY l.leido_at)
          FROM public.lectura_anuncio l
          JOIN public.anuncios a ON a.id = l.anuncio_id
         WHERE l.usuario_id = p_sujeto_id
           AND (v_self OR (a.centro_id IS NOT NULL AND privado.es_responsable(a.centro_id)))), '[]'::jsonb),

      'invitaciones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'email', i.email, 'nombre_completo', i.nombre_completo,
                 'rol_objetivo', i.rol_objetivo, 'tipo_vinculo', i.tipo_vinculo,
                 'enviada_en', i.created_at, 'expira_en', i.expires_at,
                 'aceptada_en', i.accepted_at, 'rechazada_en', i.rejected_at)
               ORDER BY i.created_at)
          FROM public.invitaciones i
         WHERE v_email IS NOT NULL
           AND lower(i.email) = lower(v_email)
           AND (v_self OR privado.es_responsable(i.centro_id))), '[]'::jsonb),

      'lista_espera_contacto', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'telefono_tutor', le.telefono_tutor, 'email_tutor', le.email_tutor)
               ORDER BY le.created_at)
          FROM public.lista_espera le
         WHERE le.tutor_usuario_id = p_sujeto_id
           AND (v_self OR privado.es_responsable(le.centro_id))), '[]'::jsonb),

      'exportaciones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'exportado_en', e.created_at,
                 'solicitado_por_ti', e.solicitado_por = p_sujeto_id)
               ORDER BY e.created_at)
          FROM public.export_log e
         WHERE e.sujeto_tipo = 'usuario' AND e.sujeto_id = p_sujeto_id
           AND (v_self OR privado.es_responsable(e.centro_id))), '[]'::jsonb),

      'solicitudes_olvido', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'solicitado_en', o.solicitado_en, 'estado', o.estado,
                 'pedida_por_centro', o.pedida_por_centro, 'inmediato', o.inmediato,
                 'confirmada_en', o.confirmada_en, 'gracia_hasta', o.gracia_hasta,
                 'rechazada_en', o.rechazada_en, 'motivo_rechazo', o.motivo_rechazo,
                 'retirada_en', o.retirada_en, 'nota_centro', o.nota_centro,
                 'purgado_en', o.purgado_en)
               ORDER BY o.solicitado_en)
          FROM public.olvido_solicitudes o
         WHERE o.sujeto_tipo = 'usuario' AND o.sujeto_id = p_sujeto_id
           AND (v_self OR privado.es_responsable(o.centro_id))), '[]'::jsonb),

      -- Su perfil de tutor en cada familia (solo su fila, no la del otro tutor).
      'perfiles_familia', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'familia_id', ft.familia_id, 'rol_familia', ft.rol_familia,
                 'nombre_completo', ft.nombre_completo, 'email', ft.email,
                 'direccion_calle', ft.direccion_calle, 'direccion_numero', ft.direccion_numero,
                 'direccion_cp', ft.direccion_cp, 'direccion_ciudad', ft.direccion_ciudad,
                 'dni_documento_path', ft.dni_documento_path)
               ORDER BY ft.created_at)
          FROM public.familia_tutores ft
          JOIN public.familias f ON f.id = ft.familia_id
         WHERE ft.usuario_id = p_sujeto_id AND ft.deleted_at IS NULL
           AND (v_self OR privado.es_responsable(f.centro_id))), '[]'::jsonb),

      -- Los mandatos que firmó él. Del IBAN, solo los 4 últimos dígitos.
      'mandatos_sepa', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'identificador_mandato', m.identificador_mandato, 'titular', m.titular,
                 'iban_ultimos4', m.iban_ultimos4, 'estado', m.estado,
                 'metodo_firma', m.metodo_firma, 'fecha_firma', m.fecha_firma,
                 'nombre_tecleado', m.nombre_tecleado, 'firma_imagen', m.firma_imagen,
                 'ip_firma', host(m.ip_address), 'navegador_firma', m.user_agent,
                 'documento_path', m.documento_path)
               ORDER BY m.created_at)
          FROM public.mandatos_sepa m
         WHERE m.usuario_id = p_sujeto_id AND m.deleted_at IS NULL
           AND (v_self OR privado.es_responsable(m.centro_id))), '[]'::jsonb),

      -- Cobros de cada familia de la que es tutor (los dos tutores reciben lo mismo).
      'cobros_familia', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'familia', f.etiqueta, 'metodo_pago', f.metodo_pago,
                 'recibos', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'anio', r.anio, 'mes', r.mes, 'estado', r.estado, 'metodo', r.metodo,
                            'total_centimos', r.total_centimos, 'es_esporadico', r.es_esporadico,
                            'concepto_esporadico', r.concepto_esporadico,
                            'fecha_envio_banco', r.fecha_envio_banco,
                            'fecha_devolucion', r.fecha_devolucion,
                            'cobro_forma', r.cobro_forma, 'cobro_fecha', r.cobro_fecha,
                            'cobro_nota', r.cobro_nota,
                            'cobro_importe_centimos', r.cobro_importe_centimos,
                            'devolucion_gastos_centimos', r.devolucion_gastos_centimos,
                            'devolucion_salida', r.devolucion_salida,
                            'lineas', COALESCE((
                              SELECT jsonb_agg(jsonb_build_object(
                                       'descripcion', lr.descripcion, 'cantidad', lr.cantidad,
                                       'precio_unitario_centimos', lr.precio_unitario_centimos,
                                       'importe_centimos', lr.importe_centimos)
                                     ORDER BY lr.created_at, lr.id)
                                FROM public.lineas_recibo lr
                               WHERE lr.recibo_id = r.id), '[]'::jsonb))
                          ORDER BY r.anio, r.mes, r.created_at)
                     FROM public.recibos r
                    WHERE r.familia_id = f.id AND r.deleted_at IS NULL), '[]'::jsonb),
                 'metodos_pago', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'anio', mp.anio, 'mes', mp.mes, 'metodo', mp.metodo)
                          ORDER BY mp.anio, mp.mes)
                     FROM public.metodo_pago_familia mp
                    WHERE mp.familia_id = f.id AND mp.deleted_at IS NULL), '[]'::jsonb),
                 'conceptos_asignados', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'concepto', cc.nombre, 'cantidad', ac.cantidad_default,
                            'importe_especial_centimos', ac.importe_override_centimos,
                            'porcentaje_especial_bp', ac.porcentaje_override_bp,
                            'vigencia_desde', ac.vigencia_desde,
                            'vigencia_hasta', ac.vigencia_hasta)
                          ORDER BY ac.created_at)
                     FROM public.asignacion_concepto ac
                     JOIN public.conceptos_cobro cc ON cc.id = ac.concepto_id
                    WHERE ac.familia_id = f.id AND ac.deleted_at IS NULL), '[]'::jsonb),
                 'beca_comedor_excesos', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'anio', d.anio, 'mes', d.mes, 'origen', d.origen,
                            'cuota_total_centimos', d.cuota_total_centimos,
                            'beca_total_centimos', d.beca_total_centimos,
                            'exceso_centimos', d.exceso_centimos,
                            'estado', d.estado, 'via', d.via, 'resuelto_en', d.resuelto_at)
                          ORDER BY d.anio, d.mes)
                     FROM public.beca_comedor_desborde d
                    WHERE d.familia_id = f.id), '[]'::jsonb),
                 'beca_comedor_transferencias', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'anio', bt.anio, 'mes', bt.mes, 'origen', bt.origen,
                            'importe_centimos', bt.importe_centimos,
                            'estado', bt.estado, 'realizada_en', bt.realizada_at)
                          ORDER BY bt.anio, bt.mes)
                     FROM public.beca_comedor_transferencia bt
                    WHERE bt.familia_id = f.id), '[]'::jsonb))
               ORDER BY f.created_at)
          FROM public.familias f
         WHERE f.id IN (SELECT ft.familia_id FROM public.familia_tutores ft
                         WHERE ft.usuario_id = p_sujeto_id AND ft.deleted_at IS NULL)
           AND (v_self OR privado.es_responsable(f.centro_id))), '[]'::jsonb)
    );
  END IF;

  -- ---------------------------------------------------------------- NIÑO
  IF p_sujeto_tipo = 'nino' THEN
    v_centro := privado.centro_de_nino(p_sujeto_id);
    IF v_centro IS NULL THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_admin := privado.es_responsable(v_centro);
    IF NOT v_admin AND NOT public.es_tutor_legal_de(p_sujeto_id) THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN jsonb_build_object(
      -- Su prospecto entero.
      'lista_espera', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'nombre_nino', le.nombre_nino, 'apellidos_nino', le.apellidos_nino,
                 'fecha_nacimiento', le.fecha_nacimiento, 'telefono_tutor', le.telefono_tutor,
                 'email_tutor', le.email_tutor, 'nota', le.nota, 'posicion', le.posicion,
                 'estado', le.estado, 'curso', ca.nombre, 'apuntado_en', le.created_at)
               ORDER BY le.created_at)
          FROM public.lista_espera le
          LEFT JOIN public.cursos_academicos ca ON ca.id = le.curso_academico_id
         WHERE le.nino_id = p_sujeto_id), '[]'::jsonb),

      -- Sin motivo_baja. La familia, solo activa/baja (como get_recorrido_nino_familia).
      'matriculas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', m.id, 'aula', a.nombre, 'curso', ca.nombre, 'estado', m.estado,
                 'fecha_alta', m.fecha_alta, 'fecha_baja', m.fecha_baja,
                 'activada_en', m.activada_at)
               ORDER BY ca.fecha_inicio, m.fecha_alta, m.id)
          FROM public.matriculas m
          JOIN public.aulas a ON a.id = m.aula_id
          JOIN public.cursos_academicos ca ON ca.id = m.curso_academico_id
         WHERE m.nino_id = p_sujeto_id AND m.deleted_at IS NULL
           AND (v_admin OR m.estado IN ('activa', 'baja'))), '[]'::jsonb),

      -- Por sujeto, no por quién firmó: sale también el que dio el otro tutor.
      'consentimientos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'tipo', c.tipo, 'version_texto', c.version, 'aceptado_en', c.aceptado_en,
                 'revocado_en', c.revocado_en, 'metodo_firma', c.metodo_firma,
                 'otorgado_por', u.nombre_completo)
               ORDER BY c.aceptado_en)
          FROM public.consentimientos c
          LEFT JOIN public.usuarios u ON u.id = c.usuario_id
         WHERE c.nino_id = p_sujeto_id), '[]'::jsonb),

      'acuses_alta', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'tipo', aa.tipo, 'metodo', aa.metodo, 'aceptado_en', aa.aceptado_en)
               ORDER BY aa.aceptado_en)
          FROM public.acuses_alta aa
         WHERE aa.nino_id = p_sujeto_id), '[]'::jsonb),

      'cambios_solicitados', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'entidad', cp.entidad, 'campo', cp.campo,
                 'valor_propuesto', cp.valor_propuesto, 'detalle', cp.payload,
                 'estado', cp.estado, 'solicitado_en', cp.created_at,
                 'decidido_en', cp.decided_at)
               ORDER BY cp.created_at)
          FROM public.cambios_pendientes cp
         WHERE cp.nino_id = p_sujeto_id), '[]'::jsonb),

      'fin_de_curso', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('curso', ca.nombre, 'registrado_en', rf.created_at)
               ORDER BY rf.created_at)
          FROM public.rollover_finaliza rf
          JOIN public.cursos_academicos ca ON ca.id = rf.curso_academico_id
         WHERE rf.nino_id = p_sujeto_id), '[]'::jsonb),

      'citas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'titulo', ci.titulo, 'tipo', ci.tipo, 'fecha', ci.fecha,
                 'hora_inicio', ci.hora_inicio, 'hora_fin', ci.hora_fin, 'lugar', ci.lugar,
                 'descripcion', ci.descripcion, 'estado', ci.estado)
               ORDER BY ci.fecha, ci.hora_inicio)
          FROM public.citas ci
         WHERE ci.nino_id = p_sujeto_id), '[]'::jsonb),

      'eventos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'titulo', e.titulo, 'tipo', e.tipo, 'fecha', e.fecha, 'fecha_fin', e.fecha_fin,
                 'hora_inicio', e.hora_inicio, 'hora_fin', e.hora_fin, 'lugar', e.lugar,
                 'descripcion', e.descripcion, 'estado', e.estado)
               ORDER BY e.fecha, e.hora_inicio)
          FROM public.eventos e
         WHERE e.nino_id = p_sujeto_id), '[]'::jsonb),

      'confirmaciones_eventos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'evento', e.titulo, 'fecha_evento', e.fecha, 'estado', ce.estado,
                 'comentario', ce.comentario, 'confirmado_at', ce.confirmado_at)
               ORDER BY e.fecha)
          FROM public.confirmaciones_evento ce
          JOIN public.eventos e ON e.id = ce.evento_id
         WHERE ce.nino_id = p_sujeto_id), '[]'::jsonb),

      -- Los dirigidos a la familia sobre el niño; los del personal son trabajo del centro.
      'recordatorios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'titulo', r.titulo, 'descripcion', r.descripcion,
                 'vencimiento', r.vencimiento, 'completado_en', r.completado_en)
               ORDER BY r.created_at)
          FROM public.recordatorios r
         WHERE r.nino_id = p_sujeto_id AND r.destinatario = 'familia_individual'), '[]'::jsonb),

      'conceptos_asignados', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'concepto', cc.nombre, 'cantidad', ac.cantidad_default,
                 'importe_especial_centimos', ac.importe_override_centimos,
                            'porcentaje_especial_bp', ac.porcentaje_override_bp,
                 'vigencia_desde', ac.vigencia_desde, 'vigencia_hasta', ac.vigencia_hasta)
               ORDER BY ac.created_at)
          FROM public.asignacion_concepto ac
          JOIN public.conceptos_cobro cc ON cc.id = ac.concepto_id
         WHERE ac.nino_id = p_sujeto_id AND ac.deleted_at IS NULL), '[]'::jsonb),

      'lineas_recibo', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'anio', r.anio, 'mes', r.mes, 'descripcion', lr.descripcion,
                 'cantidad', lr.cantidad, 'importe_centimos', lr.importe_centimos)
               ORDER BY r.anio, r.mes, lr.created_at)
          FROM public.lineas_recibo lr
          JOIN public.recibos r ON r.id = lr.recibo_id
         WHERE lr.nino_id = p_sujeto_id AND r.deleted_at IS NULL), '[]'::jsonb),

      'servicios_diarios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'fecha', ps.fecha, 'servicio', ps.servicio, 'presente', ps.presente)
               ORDER BY ps.fecha, ps.servicio)
          FROM public.parte_servicio_diario ps
         WHERE ps.nino_id = p_sujeto_id), '[]'::jsonb),

      'beca_comedor_elegibilidad', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'curso', ca.nombre, 'fecha_alta', be.fecha_alta,
                 'fecha_baja', be.fecha_baja, 'activa', be.activa)
               ORDER BY be.fecha_alta)
          FROM public.beca_comedor_elegibilidad be
          JOIN public.cursos_academicos ca ON ca.id = be.curso_academico_id
         WHERE be.nino_id = p_sujeto_id), '[]'::jsonb),

      'beca_comedor_tramos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'anio_correspondiente', bt.anio_correspondiente,
                 'mes_correspondiente', bt.mes_correspondiente,
                 'anio_aplicacion', bt.anio_aplicacion, 'mes_aplicacion', bt.mes_aplicacion,
                 'importe_centimos', bt.importe_centimos, 'estado', bt.estado,
                 'origen', bt.origen)
               ORDER BY bt.anio_correspondiente, bt.mes_correspondiente, bt.created_at)
          FROM public.beca_comedor_tramo bt
         WHERE bt.nino_id = p_sujeto_id), '[]'::jsonb),

      -- Sus peticiones de olvido, con su estado (las mismas columnas que en el usuario).
      'solicitudes_olvido', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'solicitado_en', o.solicitado_en, 'estado', o.estado,
                 'pedida_por_centro', o.pedida_por_centro, 'inmediato', o.inmediato,
                 'confirmada_en', o.confirmada_en, 'gracia_hasta', o.gracia_hasta,
                 'rechazada_en', o.rechazada_en, 'motivo_rechazo', o.motivo_rechazo,
                 'retirada_en', o.retirada_en, 'nota_centro', o.nota_centro,
                 'purgado_en', o.purgado_en)
               ORDER BY o.solicitado_en)
          FROM public.olvido_solicitudes o
         WHERE o.sujeto_tipo = 'nino' AND o.sujeto_id = p_sujeto_id), '[]'::jsonb),

      -- Quién ha leído su ficha médica (20261128120000).
      'lecturas_ficha_medica', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'leida_en', l.leida_en, 'lector', u.nombre_completo, 'rol_lector', l.rol_lector,
                 'origen', l.origen, 'campos', l.campos)
               ORDER BY l.leida_en)
          FROM public.lecturas_ficha_medica l
          LEFT JOIN public.usuarios u ON u.id = l.lector_id
         WHERE l.nino_id = p_sujeto_id), '[]'::jsonb)
    );
  END IF;

  RAISE EXCEPTION 'tipo de sujeto inválido: %', p_sujeto_tipo
    USING ERRCODE = 'invalid_parameter_value';
END
$function$;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_md5 text;
  v_n   integer;
  v_rol text;
BEGIN
  -- La ficha: sin políticas y sin ningún privilegio para las sesiones.
  SELECT count(*) INTO v_n FROM pg_policy WHERE polrelid = 'public.info_medica_emergencia'::regclass;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'quedan % políticas en info_medica_emergencia', v_n;
  END IF;
  FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_table_privilege(v_rol, 'public.info_medica_emergencia', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
       OR has_table_privilege(v_rol, 'public.lecturas_ficha_medica', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN
      RAISE EXCEPTION '% tiene privilegios sobre la ficha o sobre sus lecturas', v_rol;
    END IF;
  END LOOP;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.lecturas_ficha_medica'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.lecturas_ficha_medica'::regclass) THEN
    RAISE EXCEPTION 'lecturas_ficha_medica tiene que tener RLS y ninguna política';
  END IF;
  -- No se audita: ningún trigger de auditoría en la tabla nueva.
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.lecturas_ficha_medica'::regclass
              AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'lecturas_ficha_medica no lleva triggers (no se audita)';
  END IF;

  IF to_regprocedure('public.get_info_medica_emergencia(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'sigue existiendo get_info_medica_emergencia(uuid), que no registra';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t
       WHERE t.tgrelid = 'public.ninos'::regclass AND NOT t.tgisinternal AND t.tgenabled = 'O'
         AND t.tgname = 'ninos_purga_borra_lecturas'
         AND pg_get_triggerdef(t.oid) LIKE '%AFTER UPDATE OF deleted_reason ON public.ninos FOR EACH ROW%purga_rgpd%') <> 1 THEN
    RAISE EXCEPTION 'falta el trigger de la purga que borra las lecturas';
  END IF;

  -- Quién ejecuta qué.
  IF NOT has_function_privilege('authenticated', 'public.get_info_medica_emergencia(uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.alertas_medicas(uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.lecturas_ficha_medica(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.export_datos_sujeto(text,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.purgar_lecturas_ficha_medica(integer,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'falta un EXECUTE de las funciones de la ficha';
  END IF;
  IF has_function_privilege('anon', 'public.get_info_medica_emergencia(uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.alertas_medicas(uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.lecturas_ficha_medica(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.export_datos_sujeto(text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.purgar_lecturas_ficha_medica(integer,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'privado.ninos_purga_borra_lecturas()', 'EXECUTE') THEN
    RAISE EXCEPTION 'una función de la ficha quedó abierta a quien no toca';
  END IF;
  IF NOT (SELECT bool_and(prosecdef) FROM pg_proc
           WHERE oid IN ('public.get_info_medica_emergencia(uuid,text)'::regprocedure,
                         'public.alertas_medicas(uuid[])'::regprocedure,
                         'public.lecturas_ficha_medica(uuid)'::regprocedure,
                         'public.purgar_lecturas_ficha_medica(integer,boolean)'::regprocedure,
                         'privado.ninos_purga_borra_lecturas()'::regprocedure)) THEN
    RAISE EXCEPTION 'las funciones de la ficha tienen que ser SECURITY DEFINER';
  END IF;

  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.get_info_medica_emergencia(uuid,text)');
  IF v_md5 IS DISTINCT FROM '80e0b889b8b5c074c9d6bbc6ce8f4feb' THEN
    RAISE EXCEPTION 'get_info_medica_emergencia no quedó como este fichero: %', v_md5;
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.export_datos_sujeto(text,uuid)');
  IF v_md5 IS DISTINCT FROM '652585066c1ed5ddfef01c25fc77b295' THEN
    RAISE EXCEPTION 'export_datos_sujeto no quedó como este fichero: %', v_md5;
  END IF;

  SELECT count(*) INTO v_n FROM public.lecturas_ficha_medica;
  RAISE NOTICE 'guarda posterior: la ficha solo se lee por funciones, y cada lectura queda registrada; % lecturas', v_n;
END
$guarda$;
