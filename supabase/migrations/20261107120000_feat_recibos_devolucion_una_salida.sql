-- =============================================================================
-- FEAT — Recibos, PR-2: una devolución se resuelve UNA sola vez
-- -----------------------------------------------------------------------------
-- El agujero: la app solo miraba que el recibo estuviera `devuelto`, y lo sigue estando después del
-- re-giro. Se podía re-girar dos veces, o re-girar y además marcarlo cobrado en efectivo: cobrar dos
-- veces a una familia. Decisiones del responsable:
--
--   · UNA SOLA SALIDA por devolución (`devolucion_salida`), cerrada de forma atómica por
--     `resolver_devolucion`: banco (re-giro), efectivo o transferencia. Una segunda se rechaza. El
--     arrastre al siguiente recibo es el PR-14.
--   · Al REGISTRAR la devolución se piden la fecha (la que dice el banco, no hoy) y los GASTOS
--     (`devolucion_gastos_centimos`, 0 si no hay). Los gastos no se suman al recibo devuelto (su
--     total está congelado): se guardan en la devolución, y la salida cobra total + gastos. Eso
--     sustituye al recibo esporádico «Gastos de devolución».
--   · Banco: un re-giro SEPA por total + gastos (solo con mandato activo), con una línea por cada
--     cosa. El original se queda `devuelto` con su salida. Efectivo o transferencia: el original
--     pasa a `cobrado_manual` con su forma y su fecha, y conserva el envío y la devolución.
--   · El trigger `recibos_validar_devolucion` no deja hacerlo por otro camino (marcador local
--     `app.resolver_devolucion`, el patrón de `promover_a_titular` y del PR-1b), tampoco a
--     service_role: ni salir de `devuelto`, ni poner la salida, ni crear un re-giro, ni cambiar
--     una devolución ya resuelta. Y un re-giro por devolución (índice único).
--   · El export del art. 15 (`export_datos_sujeto`) incluye los gastos y la salida.
--
-- `export_datos_sujeto` se recrea desde el texto de `20261106120000` (el vivo en producción el
-- 2026-10-23: md5 normalizado en la guarda previa), con solo ese cambio.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor, DESPUÉS de
-- `20261106120000`. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_firma text;
  v_md5 text;
  v_n integer;
  v_leido jsonb := jsonb_build_object(
    'public.export_datos_sujeto(text,uuid)', '3971ced2df431310ce3c93af89cf01c1',
    -- No se recrean, pero las cruza resolver_devolucion: tienen que ser las que se leyeron.
    'public.recibos_validar_cobro_manual()', 'a8bfcbac585f2787552967f4da12f38c',
    'public.congelar_si_mes_cerrado()', '2e4c101653c8456a89a04fed2e5245f6');
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'recibos'
                AND column_name IN ('devolucion_gastos_centimos', 'devolucion_salida'))
     OR to_regprocedure('public.resolver_devolucion(uuid,text,date,text)') IS NOT NULL
     OR to_regprocedure('public.recibos_validar_devolucion()') IS NOT NULL THEN
    RAISE EXCEPTION 'las columnas de la devolución o sus funciones ya existen';
  END IF;
  -- Las funciones que se recrean o se cruzan, con la lógica que se leyó en producción (md5
  -- normalizado: sin \r, sin comentarios, espacios colapsados).
  FOR v_firma IN SELECT jsonb_object_keys(v_leido) LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_firma);
    IF v_md5 IS DISTINCT FROM v_leido ->> v_firma THEN
      RAISE EXCEPTION '% no es la leída en producción: %', v_firma, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;
  -- Los CHECK nuevos piden gastos a toda devolución y que un devuelto cobrado tenga su salida: una
  -- devolución anterior a este PR no los tendría. Y un re-giro por devolución.
  SELECT count(*) INTO v_n FROM public.recibos WHERE fecha_devolucion IS NOT NULL;
  RAISE NOTICE 'recibos con devolución antes de aplicar: %', v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'hay % recibos con devolución, sin gastos ni salida', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.recibos WHERE devuelto_de_recibo_id IS NOT NULL;
  RAISE NOTICE 're-giros antes de aplicar: %', v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'hay % re-giros sin salida en su devolución', v_n;
  END IF;
END
$guarda$;

-- ---- Columnas y CHECK ----
ALTER TABLE public.recibos
  ADD COLUMN devolucion_gastos_centimos integer,
  ADD COLUMN devolucion_salida text;

COMMENT ON COLUMN public.recibos.devolucion_gastos_centimos IS
  'PR-2: gastos que cobra el banco por la devolución (0 si no hay). Van con fecha_devolucion; la salida cobra total + gastos.';
COMMENT ON COLUMN public.recibos.devolucion_salida IS
  'PR-2: cómo se resolvió la devolución, una sola vez (resolver_devolucion): banco (re-giro), efectivo o transferencia.';

ALTER TABLE public.recibos
  ADD CONSTRAINT recibos_devolucion_gastos CHECK (
    (fecha_devolucion IS NULL) = (devolucion_gastos_centimos IS NULL)
    AND (devolucion_gastos_centimos IS NULL OR devolucion_gastos_centimos >= 0)
  ),
  ADD CONSTRAINT recibos_devolucion_tras_envio CHECK (
    fecha_devolucion IS NULL OR fecha_devolucion >= fecha_envio_banco
  ),
  -- Banco deja el original devuelto; efectivo o transferencia lo dejan cobrado con esa forma. Y un
  -- devuelto cobrado siempre dice por dónde salió.
  ADD CONSTRAINT recibos_devolucion_salida CHECK (
    (devolucion_salida IS NULL
       OR (fecha_devolucion IS NOT NULL
           AND ((devolucion_salida = 'banco' AND estado = 'devuelto')
             OR (devolucion_salida IN ('efectivo', 'transferencia')
                 AND estado = 'cobrado_manual' AND cobro_forma::text = devolucion_salida))))
    AND NOT (estado = 'cobrado_manual' AND fecha_devolucion IS NOT NULL AND devolucion_salida IS NULL)
  );

-- Un re-giro por devolución.
CREATE UNIQUE INDEX idx_recibos_regiro_unico
  ON public.recibos (devuelto_de_recibo_id)
  WHERE devuelto_de_recibo_id IS NOT NULL;

-- ---- La devolución solo se resuelve por su función ----
CREATE FUNCTION public.recibos_validar_devolucion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_marca text := COALESCE(current_setting('app.resolver_devolucion', true), '');
BEGIN
  -- Vale para todos, también para service_role: un re-giro es la salida «banco» de una devolución.
  IF TG_OP = 'INSERT' THEN
    IF NEW.devuelto_de_recibo_id IS NOT NULL
       AND v_marca IS DISTINCT FROM NEW.devuelto_de_recibo_id::text THEN
      RAISE EXCEPTION 'un re-giro se crea con resolver_devolucion'
        USING ERRCODE = 'P0001', HINT = 'devolucion_por_funcion';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.devuelto_de_recibo_id IS DISTINCT FROM OLD.devuelto_de_recibo_id THEN
    RAISE EXCEPTION 'un re-giro se crea con resolver_devolucion'
      USING ERRCODE = 'P0001', HINT = 'devolucion_por_funcion';
  END IF;
  -- Una devolución resuelta no cambia: ni su salida, ni sus gastos, ni su fecha.
  IF OLD.devolucion_salida IS NOT NULL
     AND (NEW.devolucion_salida IS DISTINCT FROM OLD.devolucion_salida
          OR NEW.devolucion_gastos_centimos IS DISTINCT FROM OLD.devolucion_gastos_centimos
          OR NEW.fecha_devolucion IS DISTINCT FROM OLD.fecha_devolucion) THEN
    RAISE EXCEPTION 'esta devolución ya está resuelta (%)', OLD.devolucion_salida
      USING ERRCODE = 'P0001', HINT = 'devolucion_ya_resuelta';
  END IF;
  -- Poner la salida, o sacar el recibo de `devuelto`, solo lo hace resolver_devolucion.
  IF (NEW.devolucion_salida IS DISTINCT FROM OLD.devolucion_salida
      OR (OLD.estado = 'devuelto' AND NEW.estado IS DISTINCT FROM 'devuelto'))
     AND v_marca IS DISTINCT FROM NEW.id::text THEN
    RAISE EXCEPTION 'una devolución se resuelve con resolver_devolucion'
      USING ERRCODE = 'P0001', HINT = 'devolucion_por_funcion';
  END IF;
  -- La fecha de la devolución no puede ser futura (la del banco, no la de mañana).
  IF NEW.fecha_devolucion IS DISTINCT FROM OLD.fecha_devolucion
     AND NEW.fecha_devolucion > public.hoy_madrid() THEN
    RAISE EXCEPTION 'la fecha de la devolución no puede ser futura'
      USING ERRCODE = '22023', HINT = 'fecha_devolucion_invalida';
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.recibos_validar_devolucion() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER recibos_validar_devolucion
  BEFORE INSERT OR UPDATE OF estado, devolucion_salida, devolucion_gastos_centimos, fecha_devolucion, devuelto_de_recibo_id
  ON public.recibos
  FOR EACH ROW EXECUTE FUNCTION public.recibos_validar_devolucion();

-- ---- resolver_devolucion ----
-- De invocador: lee y escribe con la sesión (RLS de Dirección; el actor de audit_log es quien
-- resuelve). Devuelve el id del re-giro (banco), o NULL (efectivo o transferencia).
CREATE FUNCTION public.resolver_devolucion(
  p_recibo_id uuid,
  p_salida text,
  p_fecha date,
  p_nota text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_r public.recibos%ROWTYPE;
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
  -- Primero la salida: un devuelto cobrado en efectivo ya no está `devuelto`, y lo que hay que
  -- decir es que ya se resolvió.
  IF v_r.devolucion_salida IS NOT NULL THEN
    RAISE EXCEPTION 'esta devolución ya está resuelta (%)', v_r.devolucion_salida
      USING ERRCODE = 'P0001', HINT = 'devolucion_ya_resuelta';
  END IF;
  IF v_r.estado <> 'devuelto' THEN
    RAISE EXCEPTION 'solo se resuelve un recibo devuelto (este está en %)', v_r.estado
      USING ERRCODE = 'P0001', HINT = 'no_devuelto';
  END IF;
  IF p_salida IS NULL OR p_salida NOT IN ('banco', 'efectivo', 'transferencia') THEN
    RAISE EXCEPTION 'salida no válida' USING ERRCODE = '22023', HINT = 'salida_invalida';
  END IF;
  IF p_salida = 'banco' THEN
    IF NOT EXISTS (
         SELECT 1 FROM public.mandatos_sepa m
          WHERE m.familia_id = v_r.familia_id AND m.estado = 'activo' AND m.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'la familia no tiene mandato SEPA activo' USING ERRCODE = 'P0001', HINT = 'sin_mandato';
    END IF;
  ELSIF p_fecha IS NULL OR p_fecha > public.hoy_madrid() OR p_fecha < v_r.fecha_devolucion THEN
    RAISE EXCEPTION 'fecha de cobro inválida' USING ERRCODE = '22023', HINT = 'fecha_cobro_invalida';
  END IF;

  PERFORM set_config('app.resolver_devolucion', p_recibo_id::text, true);
  IF p_salida = 'banco' THEN
    INSERT INTO public.recibos
      (centro_id, familia_id, nino_id, anio, mes, metodo, estado, total_centimos, es_esporadico,
       devuelto_de_recibo_id)
      VALUES (v_r.centro_id, v_r.familia_id, v_r.nino_id, v_r.anio, v_r.mes, 'sepa',
              'pendiente_procesar', v_r.total_centimos + v_r.devolucion_gastos_centimos, false,
              v_r.id)
      RETURNING id INTO v_nuevo;
    INSERT INTO public.lineas_recibo
      (centro_id, recibo_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos)
      VALUES (v_r.centro_id, v_nuevo, 'Re-giro de recibo devuelto', 1, v_r.total_centimos,
              v_r.total_centimos);
    IF v_r.devolucion_gastos_centimos > 0 THEN
      INSERT INTO public.lineas_recibo
        (centro_id, recibo_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos)
        VALUES (v_r.centro_id, v_nuevo, 'Gastos de devolución', 1, v_r.devolucion_gastos_centimos,
                v_r.devolucion_gastos_centimos);
    END IF;
    UPDATE public.recibos
       SET devolucion_salida = 'banco'
     WHERE id = p_recibo_id AND estado = 'devuelto' AND devolucion_salida IS NULL;
  ELSE
    UPDATE public.recibos
       SET estado = 'cobrado_manual',
           cobro_forma = p_salida::public.metodo_pago,
           cobro_fecha = p_fecha,
           cobro_nota = NULLIF(btrim(p_nota), ''),
           devolucion_salida = p_salida
     WHERE id = p_recibo_id AND estado = 'devuelto' AND devolucion_salida IS NULL;
  END IF;
  -- Antes de quitar el marcador: PERFORM también pone FOUND.
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  PERFORM set_config('app.resolver_devolucion', '', true);
  IF v_filas = 0 THEN
    RAISE EXCEPTION 'esta devolución ya está resuelta' USING ERRCODE = 'P0001', HINT = 'devolucion_ya_resuelta';
  END IF;
  RETURN v_nuevo;
END $function$;

REVOKE ALL ON FUNCTION public.resolver_devolucion(uuid,text,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver_devolucion(uuid,text,date,text) TO authenticated;

-- ---- export_datos_sujeto: los gastos y la salida de la devolución ----
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
    'public.export_datos_sujeto(text,uuid)', '890a1d672ed3202520c26499a11ac8dd',
    'public.recibos_validar_devolucion()', '689b8a3bd25ae1dea5881b958bd7ff78',
    'public.resolver_devolucion(uuid,text,date,text)', '4c4d6d22bdc6a579394e4a5d9b01d245');
BEGIN
  FOR v_firma IN SELECT jsonb_object_keys(v_esperado) LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_firma);
    IF v_md5 IS DISTINCT FROM v_esperado ->> v_firma THEN
      RAISE EXCEPTION '% no quedó como este fichero: %', v_firma, coalesce(v_md5, 'falta');
    END IF;
    -- Las de trigger no se pueden llamar por RPC.
    IF (SELECT prorettype FROM pg_proc WHERE oid = v_firma::regprocedure) <> 'trigger'::regtype
       AND (has_function_privilege('anon', v_firma::regprocedure, 'EXECUTE')
            OR has_function_privilege('public', v_firma::regprocedure, 'EXECUTE')) THEN
      RAISE EXCEPTION '% abierta a anon o a PUBLIC', v_firma;
    END IF;
  END LOOP;
  -- Las dos las llama la app con sesión.
  IF NOT has_function_privilege('authenticated', 'public.export_datos_sujeto(text,uuid)'::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.resolver_devolucion(uuid,text,date,text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'export_datos_sujeto o resolver_devolucion no las puede ejecutar authenticated';
  END IF;
  -- De invocador: la RLS y el actor son los de la sesión.
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.resolver_devolucion(uuid,text,date,text)'::regprocedure) THEN
    RAISE EXCEPTION 'resolver_devolucion no debe ser SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.recibos'::regclass AND tgname = 'recibos_validar_devolucion'
                    AND tgenabled = 'O'
                    AND pg_get_triggerdef(oid) LIKE '%BEFORE INSERT OR UPDATE OF estado, devolucion_salida, devolucion_gastos_centimos, fecha_devolucion, devuelto_de_recibo_id ON%') THEN
    RAISE EXCEPTION 'el trigger recibos_validar_devolucion no vigila el alta y las columnas de la devolución';
  END IF;
  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'public.recibos'::regclass
         AND conname IN ('recibos_devolucion_gastos', 'recibos_devolucion_tras_envio',
                         'recibos_devolucion_salida', 'recibos_envio_banco_fecha',
                         'recibos_cobro_manual_datos')) <> 5 THEN
    RAISE EXCEPTION 'faltan CHECK de la devolución';
  END IF;
  IF to_regclass('public.idx_recibos_regiro_unico') IS NULL THEN
    RAISE EXCEPTION 'falta el índice de un re-giro por devolución';
  END IF;
  RAISE NOTICE 'guarda posterior: columnas, CHECK, índice, trigger, resolver_devolucion y export';
END
$guarda$;
