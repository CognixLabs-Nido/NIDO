-- =============================================================================
-- FEAT — Recibos, PR-1b: cobrar con cheque guardería / ticket restaurant
-- -----------------------------------------------------------------------------
-- Decisiones del responsable:
--
--   · Al cobrar con cheque, la directora introduce el IMPORTE DEL CHEQUE (`cobro_importe_centimos`)
--     y la app resta. Cheque igual al recibo: cobrado, nada más que hacer. Cheque menor: la
--     diferencia va a un recibo ESPORÁDICO aparte (`diferencia_de_recibo_id` = el recibo del
--     cheque), del mismo periodo, con el método que elija la directora: pasar recibo (SEPA, solo
--     con mandato activo), efectivo o transferencia. El SEPA entra en la remesa como cualquier
--     esporádico; el de efectivo o transferencia queda pendiente y se marca cobrado después, por
--     el circuito del PR-1a.
--   · Cheque MAYOR que el recibo (el sobrante): PR-1c, que toca el generador mensual. Hasta
--     entonces el CHECK no lo admite (`recibos_cobro_importe_cheque`).
--   · El cobro con cheque y su diferencia se escriben juntos, en una transacción, por
--     `cobrar_recibo_con_cheque` (de invocador: la RLS de Dirección y el actor de audit_log son
--     los de la sesión). El trigger de la transición no deja escribir un cobro con cheque por
--     otro camino (marcador local `app.cobro_cheque`, el patrón de `promover_a_titular`): así no
--     puede quedar un cheque menor que el recibo sin el recibo de su diferencia.
--   · El export del art. 15 (`export_datos_sujeto`) incluye el importe del cheque.
--
-- `export_datos_sujeto` se recrea desde el texto de `20261105120000` (el vivo en producción el
-- 2026-10-23: md5 normalizado en la guarda previa), con solo ese cambio.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor, DESPUÉS de
-- `20261105120000`. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_firma text;
  v_md5 text;
  v_leido jsonb := jsonb_build_object(
    'public.export_datos_sujeto(text,uuid)', 'c82938fd00de723556c04dab62dfc840',
    'public.recibos_validar_cobro_manual()', '4ae47c28821127782a9bb86d2331b033',
    -- No se recrea, pero cobrar_recibo_con_cheque la llama: tiene que ser la que se leyó.
    'public.crear_recibo_esporadico(uuid,uuid,uuid,integer,integer,text,text,jsonb)', 'b8d86d20e4280e1c2acc7561e4bdfead');
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'recibos'
                AND column_name IN ('cobro_importe_centimos', 'diferencia_de_recibo_id'))
     OR to_regprocedure('public.cobrar_recibo_con_cheque(uuid,integer,date,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'las columnas del cobro con cheque o su función ya existen';
  END IF;
  -- Las funciones que se recrean o se llaman, con la lógica que se leyó en producción (md5
  -- normalizado: sin \r, sin comentarios, espacios colapsados).
  FOR v_firma IN SELECT jsonb_object_keys(v_leido) LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_firma);
    IF v_md5 IS DISTINCT FROM v_leido ->> v_firma THEN
      RAISE EXCEPTION '% no es la leída en producción: %', v_firma, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;
  -- El CHECK que se sustituye.
  SELECT md5(pg_get_constraintdef(c.oid)) INTO v_md5
    FROM pg_constraint c
   WHERE c.conrelid = 'public.recibos'::regclass AND c.conname = 'recibos_cobro_forma_manual';
  IF v_md5 IS DISTINCT FROM '8f7ced7c61c0e03e834d6a6f42a91531' THEN
    RAISE EXCEPTION 'recibos_cobro_forma_manual no es el leído en producción: %', coalesce(v_md5, 'falta');
  END IF;
END
$guarda$;

-- ---- Columnas y CHECK ----
ALTER TABLE public.recibos
  ADD COLUMN cobro_importe_centimos integer,
  ADD COLUMN diferencia_de_recibo_id uuid REFERENCES public.recibos(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.recibos.cobro_importe_centimos IS
  'PR-1b: importe del cheque guardería / ticket restaurant. Solo con cobro_forma cheque_guarderia; nunca mayor que el recibo (el sobrante es el PR-1c).';
COMMENT ON COLUMN public.recibos.diferencia_de_recibo_id IS
  'PR-1b: en el recibo esporádico de la diferencia, el recibo que se cobró con un cheque menor.';

ALTER TABLE public.recibos DROP CONSTRAINT recibos_cobro_forma_manual;
ALTER TABLE public.recibos
  ADD CONSTRAINT recibos_cobro_forma_manual CHECK (
    cobro_forma IS NULL OR cobro_forma IN ('efectivo', 'transferencia', 'cheque_guarderia')
  ),
  -- El importe va con el cheque, y solo con él (IS NOT DISTINCT: con forma NULL, `=` daría NULL
  -- y el CHECK lo dejaría pasar).
  ADD CONSTRAINT recibos_cobro_importe_cheque CHECK (
    (cobro_forma IS NOT DISTINCT FROM 'cheque_guarderia') = (cobro_importe_centimos IS NOT NULL)
    AND (cobro_importe_centimos IS NULL
         OR (cobro_importe_centimos > 0 AND cobro_importe_centimos <= total_centimos))
  ),
  ADD CONSTRAINT recibos_diferencia_esporadico CHECK (
    diferencia_de_recibo_id IS NULL OR es_esporadico
  );

-- Una diferencia por recibo.
CREATE UNIQUE INDEX idx_recibos_diferencia_unica
  ON public.recibos (diferencia_de_recibo_id)
  WHERE diferencia_de_recibo_id IS NOT NULL;

-- ---- La transición a cobrado_manual, y el cheque solo por su función ----
CREATE OR REPLACE FUNCTION public.recibos_validar_cobro_manual()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Se mira la TRANSICIÓN: solo al entrar en cobrado_manual. Vale para todos, también para
  -- service_role y para los esporádicos y re-giros (el congelado por estado no los cubre).
  IF NEW.estado = 'cobrado_manual' AND OLD.estado IS DISTINCT FROM 'cobrado_manual' THEN
    IF OLD.estado NOT IN ('pendiente_procesar', 'devuelto') THEN
      RAISE EXCEPTION 'solo se cobra a mano un recibo pendiente o devuelto (este está en %)', OLD.estado
        USING ERRCODE = 'P0001', HINT = 'no_cobrable_manual';
    END IF;
    -- Un SEPA pendiente se cobra por remesa. Para cobrarlo a mano, primero se desconfirma y se
    -- cambia el método del mes.
    IF OLD.estado = 'pendiente_procesar' AND OLD.metodo = 'sepa' THEN
      RAISE EXCEPTION 'un recibo SEPA pendiente se cobra por remesa'
        USING ERRCODE = 'P0001', HINT = 'sepa_por_remesa';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.recibos_validar_cobro_manual() FROM PUBLIC, anon, authenticated;

DROP TRIGGER recibos_validar_cobro_manual ON public.recibos;
CREATE TRIGGER recibos_validar_cobro_manual
  BEFORE UPDATE OF estado, cobro_forma, cobro_importe_centimos ON public.recibos
  FOR EACH ROW EXECUTE FUNCTION public.recibos_validar_cobro_manual();

-- ---- cobrar_recibo_con_cheque ----
-- De invocador: lee y escribe con la sesión (RLS de Dirección; el actor de audit_log es quien
-- cobra). Devuelve el id del recibo de la diferencia, o NULL si el cheque cubre el recibo.
CREATE FUNCTION public.cobrar_recibo_con_cheque(
  p_recibo_id uuid,
  p_importe_centimos integer,
  p_fecha date,
  p_nota text,
  p_metodo_diferencia text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_r public.recibos%ROWTYPE;
  v_diferencia integer;
  v_metodo text;
  v_nuevo uuid;
  v_filas integer;
BEGIN
  SELECT * INTO v_r FROM public.recibos
   WHERE id = p_recibo_id AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recibo no encontrado' USING ERRCODE = 'P0002', HINT = 'no_encontrado';
  END IF;
  IF NOT public.es_admin(v_r.centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_fecha IS NULL OR p_fecha > public.hoy_madrid() THEN
    RAISE EXCEPTION 'fecha de cobro inválida' USING ERRCODE = '22023', HINT = 'fecha_cobro_invalida';
  END IF;
  IF p_importe_centimos IS NULL OR p_importe_centimos <= 0 THEN
    RAISE EXCEPTION 'importe del cheque inválido' USING ERRCODE = '22023', HINT = 'importe_cheque_invalido';
  END IF;
  IF p_importe_centimos > v_r.total_centimos THEN
    RAISE EXCEPTION 'el cheque supera el recibo' USING ERRCODE = 'P0001', HINT = 'cheque_supera_recibo';
  END IF;

  v_diferencia := v_r.total_centimos - p_importe_centimos;
  v_metodo := NULLIF(p_metodo_diferencia, '');
  IF v_diferencia > 0 THEN
    IF v_metodo IS NULL OR v_metodo NOT IN ('sepa', 'efectivo', 'transferencia') THEN
      RAISE EXCEPTION 'falta cómo se cobra la diferencia' USING ERRCODE = '22023', HINT = 'falta_metodo_diferencia';
    END IF;
    IF v_metodo = 'sepa' AND NOT EXISTS (
         SELECT 1 FROM public.mandatos_sepa m
          WHERE m.familia_id = v_r.familia_id AND m.estado = 'activo' AND m.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'la familia no tiene mandato SEPA activo' USING ERRCODE = 'P0001', HINT = 'sin_mandato';
    END IF;
  END IF;

  PERFORM set_config('app.cobro_cheque', p_recibo_id::text, true);
  UPDATE public.recibos
     SET estado = 'cobrado_manual',
         cobro_forma = 'cheque_guarderia',
         cobro_fecha = p_fecha,
         cobro_nota = NULLIF(btrim(p_nota), ''),
         cobro_importe_centimos = p_importe_centimos
   WHERE id = p_recibo_id AND estado IN ('pendiente_procesar', 'devuelto');
  -- Antes de quitar el marcador: PERFORM también pone FOUND.
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  PERFORM set_config('app.cobro_cheque', '', true);
  IF v_filas = 0 THEN
    RAISE EXCEPTION 'solo se cobra a mano un recibo pendiente o devuelto (este está en %)', v_r.estado
      USING ERRCODE = 'P0001', HINT = 'no_cobrable_manual';
  END IF;

  IF v_diferencia > 0 THEN
    v_nuevo := public.crear_recibo_esporadico(
      v_r.centro_id, v_r.familia_id, v_r.nino_id, v_r.anio, v_r.mes,
      'Diferencia cheque guardería / Ticket restaurant', v_metodo,
      jsonb_build_array(jsonb_build_object(
        'descripcion', 'Diferencia cheque guardería / Ticket restaurant',
        'cantidad', 1,
        'precio_unitario_centimos', v_diferencia)));
    UPDATE public.recibos SET diferencia_de_recibo_id = p_recibo_id WHERE id = v_nuevo;
  END IF;
  RETURN v_nuevo;
END $function$;

REVOKE ALL ON FUNCTION public.cobrar_recibo_con_cheque(uuid,integer,date,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cobrar_recibo_con_cheque(uuid,integer,date,text,text) TO authenticated;

-- ---- export_datos_sujeto: el importe del cheque ----
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
                 'solicitado_en', o.solicitado_en, 'gracia_hasta', o.gracia_hasta,
                 'inmediato', o.inmediato, 'purgado_en', o.purgado_en)
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
                 'familia', f.etiqueta,
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
                            'vigencia_desde', ac.vigencia_desde,
                            'vigencia_hasta', ac.vigencia_hasta)
                          ORDER BY ac.created_at)
                     FROM public.asignacion_concepto ac
                     JOIN public.conceptos_cobro cc ON cc.id = ac.concepto_id
                    WHERE ac.familia_id = f.id AND ac.deleted_at IS NULL), '[]'::jsonb),
                 'beca_comedor_excesos', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'anio', d.anio, 'mes', d.mes,
                            'cuota_total_centimos', d.cuota_total_centimos,
                            'beca_total_centimos', d.beca_total_centimos,
                            'exceso_centimos', d.exceso_centimos,
                            'estado', d.estado, 'via', d.via, 'resuelto_en', d.resuelto_at)
                          ORDER BY d.anio, d.mes)
                     FROM public.beca_comedor_desborde d
                    WHERE d.familia_id = f.id), '[]'::jsonb),
                 'beca_comedor_transferencias', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'anio', bt.anio, 'mes', bt.mes,
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

      'becas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'tipo_beca', tb.nombre, 'importe_centimos', b.importe_centimos,
                 'fecha_desde', b.fecha_desde, 'fecha_hasta', b.fecha_hasta)
               ORDER BY b.fecha_desde)
          FROM public.becas b
          JOIN public.tipos_beca tb ON tb.id = b.tipo_beca_id
         WHERE b.nino_id = p_sujeto_id AND b.deleted_at IS NULL), '[]'::jsonb),

      'conceptos_asignados', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'concepto', cc.nombre, 'cantidad', ac.cantidad_default,
                 'importe_especial_centimos', ac.importe_override_centimos,
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
         WHERE bt.nino_id = p_sujeto_id), '[]'::jsonb)
    );
  END IF;

  RAISE EXCEPTION 'tipo de sujeto inválido: %', p_sujeto_tipo
    USING ERRCODE = 'invalid_parameter_value';
END
$function$;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_firma text;
  v_md5 text;
  v_esperado jsonb := jsonb_build_object(
    'public.export_datos_sujeto(text,uuid)', '3971ced2df431310ce3c93af89cf01c1',
    'public.recibos_validar_cobro_manual()', '4ae47c28821127782a9bb86d2331b033',
    'public.cobrar_recibo_con_cheque(uuid,integer,date,text,text)', '5de20f074a56d611b1117c1ee5ea36ff');
BEGIN
  FOR v_firma IN SELECT jsonb_object_keys(v_esperado) LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_firma);
    IF v_md5 IS DISTINCT FROM v_esperado ->> v_firma THEN
      RAISE EXCEPTION '% no quedó como este fichero: %', v_firma, coalesce(v_md5, 'falta');
    END IF;
    -- Las de trigger no se pueden llamar por RPC: conservan el EXECUTE que ya tenían.
    IF (SELECT prorettype FROM pg_proc WHERE oid = v_firma::regprocedure) <> 'trigger'::regtype
       AND (has_function_privilege('anon', v_firma::regprocedure, 'EXECUTE')
            OR has_function_privilege('public', v_firma::regprocedure, 'EXECUTE')) THEN
      RAISE EXCEPTION '% abierta a anon o a PUBLIC', v_firma;
    END IF;
  END LOOP;
  -- Las dos las llama la app con sesión.
  IF NOT has_function_privilege('authenticated', 'public.export_datos_sujeto(text,uuid)'::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.cobrar_recibo_con_cheque(uuid,integer,date,text,text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'export_datos_sujeto o cobrar_recibo_con_cheque no las puede ejecutar authenticated';
  END IF;
  -- De invocador: la RLS y el actor son los de la sesión.
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.cobrar_recibo_con_cheque(uuid,integer,date,text,text)'::regprocedure) THEN
    RAISE EXCEPTION 'cobrar_recibo_con_cheque no debe ser SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.recibos'::regclass AND tgname = 'recibos_validar_cobro_manual'
                    AND tgenabled = 'O'
                    AND pg_get_triggerdef(oid) LIKE '%UPDATE OF estado, cobro_forma, cobro_importe_centimos ON%') THEN
    RAISE EXCEPTION 'el trigger recibos_validar_cobro_manual no vigila el estado, la forma y el importe';
  END IF;
  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'public.recibos'::regclass
         AND conname IN ('recibos_cobro_manual_datos', 'recibos_cobro_forma_manual',
                         'recibos_cobro_nota_longitud', 'recibos_envio_banco_fecha',
                         'recibos_cobro_importe_cheque', 'recibos_diferencia_esporadico')) <> 6 THEN
    RAISE EXCEPTION 'faltan CHECK del cobro manual';
  END IF;
  IF to_regclass('public.idx_recibos_diferencia_unica') IS NULL THEN
    RAISE EXCEPTION 'falta el índice de una diferencia por recibo';
  END IF;
  RAISE NOTICE 'guarda posterior: columnas, CHECK, trigger, cobrar_recibo_con_cheque y export';
END
$guarda$;
