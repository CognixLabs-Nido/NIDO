-- =============================================================================
-- FIX — Peticiones de olvido: dos cabos que dejó 20261126120000
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/olvido-peticiones.md.
--
--   · Tras la purga, el otro tutor legal del niño dejaba de ver la petición en su perfil: la purga
--     pasa sus vínculos a 'purga_rgpd' y `privado.es_tutor_legal_olvido` ya no lo reconoce. Ahora
--     al confirmar se guarda quiénes eran los tutores legales (`tutores_legales`, por trigger: cubre
--     `confirmar_peticion_olvido` y `solicitar_olvido_nino`) y `mis_peticiones_olvido` se la sigue
--     enseñando a ellos una vez purgada. Al deshacer la confirmación se vacía. La tabla no está
--     auditada: la lista no entra en audit_log.
--   · El export del art. 15 (`export_datos_sujeto`) no decía el estado de la petición, y el del niño
--     no llevaba sus peticiones. Ahora las dos secciones llevan las mismas columnas.
--
-- `mis_peticiones_olvido` se recrea desde el texto de `20261126120000` y `export_datos_sujeto` desde
-- el de `20261119120000` (los vivos en producción el 2026-10-27: md5 normalizado en la guarda).
--
-- La aplica el responsable por SQL Editor, DESPUÉS de `20261126120000`. Tras aplicar: registrar en
-- supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_n   integer;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'olvido_solicitudes'
                AND column_name = 'tutores_legales') THEN
    RAISE EXCEPTION 'ya aplicada: olvido_solicitudes ya tiene tutores_legales';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'olvido_solicitudes'
                    AND column_name = 'estado') THEN
    RAISE EXCEPTION 'falta 20261126120000: olvido_solicitudes no tiene estado';
  END IF;

  -- Las dos funciones que se recrean tienen que ser las leídas en producción
  -- (md5 normalizado: sin \r, sin comentarios, espacios colapsados).
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.mis_peticiones_olvido()');
  IF v_md5 IS DISTINCT FROM '10c54554944d2dcf11d84df079b1e6cd' THEN
    RAISE EXCEPTION 'mis_peticiones_olvido no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.export_datos_sujeto(text,uuid)');
  IF v_md5 IS DISTINCT FROM '2f67be36dd5530ff76e9d2d18d28edc1' THEN
    RAISE EXCEPTION 'export_datos_sujeto no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;

  SELECT count(*) INTO v_n FROM public.olvido_solicitudes;
  RAISE NOTICE 'guarda previa: % solicitudes de olvido', v_n;
END
$guarda$;

-- ---- 1. Quiénes eran los tutores legales al confirmar ----
ALTER TABLE public.olvido_solicitudes ADD COLUMN tutores_legales uuid[];

COMMENT ON COLUMN public.olvido_solicitudes.tutores_legales IS
  'Tutores legales del niño al confirmar (privado.es_tutor_legal_olvido). La purga les quita el vínculo; con esto siguen viendo la petición en mis_peticiones_olvido. NULL si no está confirmada.';

-- La misma definición de tutor legal que usa el resto del olvido. SECURITY DEFINER: la función que
-- pregunta no se abre a nadie más, y el trigger corre con quien escriba la fila.
CREATE FUNCTION privado.olvido_guardar_tutores()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.sujeto_tipo = 'nino' AND NEW.estado = 'confirmada'
     AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'confirmada') THEN
    NEW.tutores_legales := ARRAY(
      SELECT DISTINCT v.usuario_id FROM public.vinculos_familiares v
       WHERE v.nino_id = NEW.sujeto_id
         AND privado.es_tutor_legal_olvido(NEW.sujeto_id, v.usuario_id)
       ORDER BY v.usuario_id);
  ELSIF NEW.estado <> 'confirmada' THEN
    NEW.tutores_legales := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION privado.olvido_guardar_tutores() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER olvido_guardar_tutores
  BEFORE INSERT OR UPDATE OF estado ON public.olvido_solicitudes
  FOR EACH ROW
  EXECUTE FUNCTION privado.olvido_guardar_tutores();

-- Las confirmadas que aún no se han purgado. Las ya purgadas no se pueden reconstruir: la purga
-- reescribió los vínculos (se cuentan abajo).
DO $relleno$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.olvido_solicitudes s
     SET tutores_legales = ARRAY(
           SELECT DISTINCT v.usuario_id FROM public.vinculos_familiares v
            WHERE v.nino_id = s.sujeto_id
              AND privado.es_tutor_legal_olvido(s.sujeto_id, v.usuario_id)
            ORDER BY v.usuario_id)
   WHERE s.sujeto_tipo = 'nino' AND s.estado = 'confirmada' AND s.purgado_en IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'relleno: % confirmadas sin purgar con sus tutores', v_n;
  SELECT count(*) INTO v_n FROM public.olvido_solicitudes
   WHERE sujeto_tipo = 'nino' AND purgado_en IS NOT NULL;
  RAISE NOTICE 'relleno: % ya purgadas de niños, sin tutores (no se pueden reconstruir)', v_n;
END
$relleno$;

-- ---- 2. La petición purgada sigue a la vista de los tutores de entonces ----
CREATE OR REPLACE FUNCTION public.mis_peticiones_olvido()
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
      OR (s.sujeto_tipo = 'nino' AND s.purgado_en IS NOT NULL AND v_uid = ANY (s.tutores_legales))
   ORDER BY s.solicitado_en DESC;
END;
$function$;

-- ---- 3. El export dice el estado de la petición, también la del niño ----
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
         WHERE o.sujeto_tipo = 'nino' AND o.sujeto_id = p_sujeto_id), '[]'::jsonb)
    );
  END IF;

  RAISE EXCEPTION 'tipo de sujeto inválido: %', p_sujeto_tipo
    USING ERRCODE = 'invalid_parameter_value';
END
$function$;

-- CREATE OR REPLACE conserva los permisos; se dejan escritos igual que estaban.
REVOKE ALL ON FUNCTION public.mis_peticiones_olvido() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mis_peticiones_olvido() TO authenticated;
REVOKE ALL ON FUNCTION public.export_datos_sujeto(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_datos_sujeto(text, uuid) TO authenticated;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_md5 text;
  v_n   integer;
BEGIN
  IF (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
       WHERE a.attrelid = 'public.olvido_solicitudes'::regclass AND a.attname = 'tutores_legales'
         AND NOT a.attisdropped) IS DISTINCT FROM 'uuid[]' THEN
    RAISE EXCEPTION 'tutores_legales no es uuid[]';
  END IF;

  IF (SELECT count(*) FROM pg_trigger t
       WHERE t.tgrelid = 'public.olvido_solicitudes'::regclass AND NOT t.tgisinternal
         AND t.tgenabled = 'O' AND t.tgname = 'olvido_guardar_tutores'
         AND pg_get_triggerdef(t.oid) LIKE '%BEFORE INSERT OR UPDATE OF estado ON public.olvido_solicitudes FOR EACH ROW%') <> 1 THEN
    RAISE EXCEPTION 'falta el trigger que guarda los tutores';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'privado.olvido_guardar_tutores()'::regprocedure)
     OR has_function_privilege('authenticated', 'privado.olvido_guardar_tutores()', 'EXECUTE') THEN
    RAISE EXCEPTION 'olvido_guardar_tutores tiene que ser SECURITY DEFINER y cerrada';
  END IF;

  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.mis_peticiones_olvido()'::regprocedure)
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.export_datos_sujeto(text,uuid)'::regprocedure)
     OR has_function_privilege('anon', 'public.mis_peticiones_olvido()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.export_datos_sujeto(text,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.mis_peticiones_olvido()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.export_datos_sujeto(text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'permisos de mis_peticiones_olvido o del export distintos de los de este fichero';
  END IF;

  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.mis_peticiones_olvido()');
  IF v_md5 IS DISTINCT FROM '9464860b101153d838936ec4198d7e85' THEN
    RAISE EXCEPTION 'mis_peticiones_olvido no quedó como este fichero: %', v_md5;
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.export_datos_sujeto(text,uuid)');
  IF v_md5 IS DISTINCT FROM 'a34f530df734488c9033d7fe73e7a094' THEN
    RAISE EXCEPTION 'export_datos_sujeto no quedó como este fichero: %', v_md5;
  END IF;

  SELECT count(*) INTO v_n FROM public.olvido_solicitudes
   WHERE sujeto_tipo = 'nino' AND estado = 'confirmada' AND purgado_en IS NULL
     AND tutores_legales IS NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% confirmadas sin purgar quedaron sin tutores', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.olvido_solicitudes WHERE tutores_legales IS NOT NULL;
  RAISE NOTICE 'guarda posterior: trigger, funciones y permisos en su sitio; % peticiones con tutores', v_n;
END
$guarda$;
