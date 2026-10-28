-- =============================================================================
-- FEAT — Retención (F11-B, punto 6, PR-7): el bloqueo de lo que se conserva por obligación legal
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/retencion-plazos.md. Tras la purga (el olvido o el plazo del expediente) quedan filas
-- que la ley obliga a conservar: recibos, mandatos, firmas, consentimientos, la medicación
-- administrada… Hasta ahora la familia dejaba de verlas, pero Dirección y la profe seguían
-- viéndolas. Desde aquí están BLOQUEADAS (art. 32 LOPDGDD): se conservan tal cual, nadie las ve en
-- la app y solo se extraen a mano, con service_role, para un juez, la Administración o una
-- reclamación. Decisiones de Jose (2026-10-28):
--
--   · Lo del niño se bloquea cuando el niño está purgado (`deleted_reason = 'purga_rgpd'`).
--   · Lo de la familia (recibos con sus líneas, método de pago, becas, mandato) cuando ya no le
--     queda ningún niño sin purgar. Mientras le quede dinero vivo (un recibo sin cerrar, uno
--     enviado al banco hace menos de 8 semanas, una beca pendiente), no: es deuda que se gestiona,
--     no un dato que solo se guarda. El mandato, además, cuando se purga al titular que lo firmó.
--   · Lo de un tutor purgado en un centro (sus firmas, sus acuses, sus consentimientos), en ese
--     centro; con la cuenta purgada, en todos.
--   · El recibo viejo se queda ENTERO: de sus líneas solo cambia el nombre del niño, por
--     "[borrado]", también en su copia de audit_log.
--   · El registro de lecturas de la ficha deja de borrarse con la purga: se conserva bloqueado y
--     se va con su plazo (`purgar_lecturas_ficha_medica`, 60 meses).
--   · Ningún tutor se olvida con un hijo matriculado, haya otro tutor o no. `olvido_bloqueos` solo
--     miraba sus vínculos, y un tutor puede estar en la familia sin vínculo con el niño (en
--     producción hay uno, 2026-10-28). Y la purga vuelve a mirarlo: en los días de gracia el hijo
--     puede volver a matricularse.
--
-- El mecanismo es una política RESTRICTIVE por tabla, que se suma (AND) a las que ya hay sin
-- reescribir ninguna: la casa no tenía ninguna, y reescribir unas cuarenta para añadir la misma
-- condición era más fácil de equivocar. Las funciones del servidor (SECURITY DEFINER) siguen
-- leyendo lo bloqueado; la exportación, que es una de ellas, lo deja fuera y dice que existe.
--
-- La aplica el responsable por SQL Editor. Sin orden obligado con el despliegue: no revoca nada
-- de lo que usa main, y hoy no hay ningún niño purgado. Tras aplicar: registrar en
-- supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  r     record;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'ninos' AND column_name = 'purgado_en') THEN
    RAISE EXCEPTION 'ya aplicada: ninos ya tiene purgado_en';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'ya hay políticas RESTRICTIVE en public: esta migración contaba con ninguna';
  END IF;

  -- Lo que se reescribe es lo que hay, tal como quedó.
  FOR r IN SELECT * FROM (VALUES
      ('public.purgar_sujeto_db(uuid)', 'c7c7bdcc0fc44f151a8f702469424e2a', '20261204120000'),
      ('privado.purgar_nino(uuid)', '7ebbb7a2fdba6077d1bb54e4eaf1c68a', '20261204120000'),
      ('privado.olvido_bloqueos(public.olvido_sujeto_tipo,uuid,uuid)',
       '0510199576a4110d07b91b6c64345203', '20261126120000'),
      ('public.olvido_pendientes()', '486e64495d37898a6627f8e70cd563d8', '20261029120000'),
      ('public.congelar_si_mes_cerrado()', '2e4c101653c8456a89a04fed2e5245f6', 'producción'),
      ('public.lecturas_ficha_medica(uuid)', '879caf6414b36c36ce7657632c98ff45', '20261128120000'),
      ('privado.ninos_purga_borra_lecturas()', '4cbe19c780d7d475a1077eaf93dc9c9f', '20261128120000'),
      ('public.export_datos_sujeto(text,uuid)', '652585066c1ed5ddfef01c25fc77b295', '20261127120000')
    ) AS t(f, md5, mig)
  LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f);
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION '% no es la de %: %', r.f, r.mig, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;

  RAISE NOTICE 'guarda previa: % niños purgados, % olvidos de usuario purgados, % lecturas de ficha',
    (SELECT count(*) FROM public.ninos WHERE deleted_reason = 'purga_rgpd'),
    (SELECT count(*) FROM public.olvido_solicitudes
      WHERE sujeto_tipo = 'usuario' AND purgado_en IS NOT NULL),
    (SELECT count(*) FROM public.lecturas_ficha_medica);
END
$guarda$;

-- ---- 1. Desde cuándo está purgado el niño ----
-- La fija privado.purgar_nino. Los purgados de antes toman la purga de su olvido, o el archivado.
ALTER TABLE public.ninos ADD COLUMN purgado_en timestamptz;
COMMENT ON COLUMN public.ninos.purgado_en IS
  'Cuándo se purgó el niño (privado.purgar_nino): desde entonces lo que se conserva por obligación legal está bloqueado.';

DO $relleno$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.ninos n
     SET purgado_en = COALESCE((SELECT max(s.purgado_en) FROM public.olvido_solicitudes s
                                 WHERE s.sujeto_tipo = 'nino' AND s.sujeto_id = n.id),
                               n.deleted_at, now())
   WHERE n.deleted_reason = 'purga_rgpd' AND n.purgado_en IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'relleno: % niños purgados con su fecha', v_n;
END
$relleno$;

-- ---- 2. Qué está bloqueado ----
-- SECURITY DEFINER y abiertas a authenticated: las usan las políticas, que corren como quien lee.
-- Solo responden sí o no (o una fecha); no dejan ver ninguna fila.

-- El niño purgado.
CREATE FUNCTION privado.nino_bloqueado(p_nino_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.ninos n
                  WHERE n.id = p_nino_id AND n.deleted_reason = 'purga_rgpd');
$function$;

CREATE FUNCTION privado.nino_bloqueado_desde(p_nino_id uuid)
RETURNS date
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT (COALESCE(n.purgado_en, n.deleted_at) AT TIME ZONE 'Europe/Madrid')::date
    FROM public.ninos n
   WHERE n.id = p_nino_id AND n.deleted_reason = 'purga_rgpd';
$function$;

-- La cuenta purgada entera: su último centro se purgó (esa purga deja '[borrado]' en el nombre).
CREATE FUNCTION privado.cuenta_olvidada(p_usuario_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.usuarios u
                  WHERE u.id = p_usuario_id AND u.nombre_completo = '[borrado]'
                    AND u.deleted_at IS NOT NULL)
     AND EXISTS (SELECT 1 FROM public.olvido_solicitudes s
                  WHERE s.sujeto_tipo = 'usuario' AND s.sujeto_id = p_usuario_id
                    AND s.purgado_en IS NOT NULL);
$function$;

-- El usuario purgado en ese centro, o la cuenta entera.
CREATE FUNCTION privado.usuario_olvidado_en(p_usuario_id uuid, p_centro_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.olvido_solicitudes s
                  WHERE s.sujeto_tipo = 'usuario' AND s.sujeto_id = p_usuario_id
                    AND s.centro_id = p_centro_id AND s.purgado_en IS NOT NULL)
      OR privado.cuenta_olvidada(p_usuario_id);
$function$;

CREATE FUNCTION privado.usuario_olvidado_desde(p_usuario_id uuid, p_centro_id uuid)
RETURNS date
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT (min(s.purgado_en) AT TIME ZONE 'Europe/Madrid')::date
    FROM public.olvido_solicitudes s
   WHERE s.sujeto_tipo = 'usuario' AND s.sujeto_id = p_usuario_id AND s.purgado_en IS NOT NULL
     AND (s.centro_id = p_centro_id OR privado.cuenta_olvidada(p_usuario_id));
$function$;

-- La familia sin ningún niño sin purgar y sin dinero vivo. El dinero vivo es lo que bloquea el
-- olvido del tutor (un recibo sin cerrar) y lo que avisa (un cobro enviado al banco hace menos de
-- 8 semanas, que aún puede volver; una beca con dinero a favor de la familia).
CREATE FUNCTION privado.familia_bloqueada(p_familia_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.ninos n
                  WHERE n.familia_id = p_familia_id AND n.deleted_reason = 'purga_rgpd')
     AND NOT EXISTS (SELECT 1 FROM public.ninos n
                      WHERE n.familia_id = p_familia_id
                        AND n.deleted_reason IS DISTINCT FROM 'purga_rgpd')
     AND NOT EXISTS (SELECT 1 FROM public.recibos r
                      WHERE r.familia_id = p_familia_id AND r.deleted_at IS NULL
                        AND ((r.estado IN ('borrador', 'pendiente_procesar') AND r.total_centimos > 0)
                          OR (r.estado = 'devuelto' AND r.devolucion_salida IS NULL)
                          OR (r.estado = 'enviado_banco'
                              AND r.fecha_envio_banco >= (now() - interval '8 weeks')::date)))
     AND NOT EXISTS (SELECT 1 FROM public.beca_comedor_desborde d
                      WHERE d.familia_id = p_familia_id AND d.estado = 'pendiente')
     AND NOT EXISTS (SELECT 1 FROM public.beca_comedor_transferencia t
                      WHERE t.familia_id = p_familia_id AND t.estado = 'pendiente');
$function$;

-- Desde la purga de su último niño.
CREATE FUNCTION privado.familia_bloqueada_desde(p_familia_id uuid)
RETURNS date
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT CASE WHEN privado.familia_bloqueada(p_familia_id) THEN
           (SELECT max(privado.nino_bloqueado_desde(n.id)) FROM public.ninos n
             WHERE n.familia_id = p_familia_id) END;
$function$;

CREATE FUNCTION privado.recibo_bloqueado(p_recibo_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT COALESCE((SELECT privado.familia_bloqueada(r.familia_id)
                     FROM public.recibos r WHERE r.id = p_recibo_id), false);
$function$;

-- El mandato: el de su familia, o el de un titular purgado. Los viejos, sin familia, por su niño.
CREATE FUNCTION privado.mandato_bloqueado(
  p_familia_id uuid, p_usuario_id uuid, p_centro_id uuid, p_nino_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT (p_familia_id IS NOT NULL AND privado.familia_bloqueada(p_familia_id))
      OR (p_familia_id IS NULL AND privado.nino_bloqueado(p_nino_id))
      OR privado.usuario_olvidado_en(p_usuario_id, p_centro_id);
$function$;

-- La firma o el acuse: del niño purgado, o de un firmante purgado en el centro del niño.
CREATE FUNCTION privado.firma_bloqueada(p_nino_id uuid, p_firmante_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT privado.nino_bloqueado(p_nino_id)
      OR (p_firmante_id IS NOT NULL
          AND privado.usuario_olvidado_en(p_firmante_id, privado.centro_de_nino(p_nino_id)));
$function$;

-- El consentimiento: el de un niño, como una firma; el de la cuenta, con la cuenta purgada.
CREATE FUNCTION privado.consentimiento_bloqueado(p_usuario_id uuid, p_nino_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT CASE WHEN p_nino_id IS NULL THEN privado.cuenta_olvidada(p_usuario_id)
              ELSE privado.firma_bloqueada(p_nino_id, p_usuario_id) END;
$function$;

DO $permisos$
DECLARE
  v_f text;
BEGIN
  FOREACH v_f IN ARRAY ARRAY['privado.nino_bloqueado(uuid)', 'privado.nino_bloqueado_desde(uuid)',
                             'privado.cuenta_olvidada(uuid)', 'privado.usuario_olvidado_en(uuid,uuid)',
                             'privado.usuario_olvidado_desde(uuid,uuid)',
                             'privado.familia_bloqueada(uuid)', 'privado.familia_bloqueada_desde(uuid)',
                             'privado.recibo_bloqueado(uuid)',
                             'privado.mandato_bloqueado(uuid,uuid,uuid,uuid)',
                             'privado.firma_bloqueada(uuid,uuid)',
                             'privado.consentimiento_bloqueado(uuid,uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_f);
  END LOOP;
END
$permisos$;

-- ---- 3. Nadie lo ve en la app ----
-- Una política RESTRICTIVE por tabla: se cumple ADEMÁS de las que ya había. Para leer y para
-- escribir: lo bloqueado tampoco se toca.
CREATE POLICY bloqueo_retencion ON public.firmas_autorizacion AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT privado.firma_bloqueada(nino_id, firmante_id))
  WITH CHECK (NOT privado.firma_bloqueada(nino_id, firmante_id));
CREATE POLICY bloqueo_retencion ON public.acuses_alta AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT privado.firma_bloqueada(nino_id, firmante_id))
  WITH CHECK (NOT privado.firma_bloqueada(nino_id, firmante_id));
CREATE POLICY bloqueo_retencion ON public.consentimientos AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT privado.consentimiento_bloqueado(usuario_id, nino_id))
  WITH CHECK (NOT privado.consentimiento_bloqueado(usuario_id, nino_id));
-- Las autorizaciones de un niño; las de aula, evento o centro no son de nadie en concreto.
CREATE POLICY bloqueo_retencion ON public.autorizaciones AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT privado.nino_bloqueado(nino_id))
  WITH CHECK (NOT privado.nino_bloqueado(nino_id));
CREATE POLICY bloqueo_retencion ON public.administraciones_medicacion AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT privado.nino_bloqueado(nino_id))
  WITH CHECK (NOT privado.nino_bloqueado(nino_id));
CREATE POLICY bloqueo_retencion ON public.parte_servicio_diario AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT privado.nino_bloqueado(nino_id))
  WITH CHECK (NOT privado.nino_bloqueado(nino_id));
CREATE POLICY bloqueo_retencion ON public.beca_comedor_elegibilidad AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT privado.nino_bloqueado(nino_id))
  WITH CHECK (NOT privado.nino_bloqueado(nino_id));
CREATE POLICY bloqueo_retencion ON public.beca_comedor_tramo AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT privado.nino_bloqueado(nino_id))
  WITH CHECK (NOT privado.nino_bloqueado(nino_id));
-- El concepto asignado a un niño, por su niño; el de la familia, por su familia.
CREATE POLICY bloqueo_retencion ON public.asignacion_concepto AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (privado.nino_bloqueado(nino_id)
              OR (familia_id IS NOT NULL AND privado.familia_bloqueada(familia_id))))
  WITH CHECK (NOT (privado.nino_bloqueado(nino_id)
                   OR (familia_id IS NOT NULL AND privado.familia_bloqueada(familia_id))));
CREATE POLICY bloqueo_retencion ON public.recibos AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT COALESCE(privado.familia_bloqueada(familia_id), false))
  WITH CHECK (NOT COALESCE(privado.familia_bloqueada(familia_id), false));
CREATE POLICY bloqueo_retencion ON public.lineas_recibo AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT privado.recibo_bloqueado(recibo_id))
  WITH CHECK (NOT privado.recibo_bloqueado(recibo_id));
CREATE POLICY bloqueo_retencion ON public.recibos_remesa AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT privado.recibo_bloqueado(recibo_id))
  WITH CHECK (NOT privado.recibo_bloqueado(recibo_id));
CREATE POLICY bloqueo_retencion ON public.metodo_pago_familia AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT privado.familia_bloqueada(familia_id))
  WITH CHECK (NOT privado.familia_bloqueada(familia_id));
CREATE POLICY bloqueo_retencion ON public.beca_comedor_desborde AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT privado.familia_bloqueada(familia_id))
  WITH CHECK (NOT privado.familia_bloqueada(familia_id));
CREATE POLICY bloqueo_retencion ON public.beca_comedor_transferencia AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT privado.familia_bloqueada(familia_id))
  WITH CHECK (NOT privado.familia_bloqueada(familia_id));
CREATE POLICY bloqueo_retencion ON public.mandatos_sepa AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT privado.mandato_bloqueado(familia_id, usuario_id, centro_id, nino_id))
  WITH CHECK (NOT privado.mandato_bloqueado(familia_id, usuario_id, centro_id, nino_id));

-- ---- 4. Para la exportación: qué hay bloqueado ----
-- El art. 15 da derecho a saber qué datos se tratan, no solo a recibirlos: lo bloqueado no sale,
-- y no se calla. [{codigo, n, desde}], o NULL si no hay nada. Del usuario, lo de los centros que
-- alcanza quien exporta (él mismo, todos; Dirección, los suyos); del niño, todo (es de un centro).
-- Las mismas funciones que las políticas: lo que no se ve es lo que se cuenta.
CREATE FUNCTION privado.datos_bloqueados(p_sujeto_tipo text, p_sujeto_id uuid, p_todos boolean)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  WITH filas(codigo, desde) AS (
    -- ---- del niño ----
    SELECT 'firmas', LEAST(privado.nino_bloqueado_desde(f.nino_id),
                           privado.usuario_olvidado_desde(f.firmante_id, privado.centro_de_nino(f.nino_id)))
      FROM public.firmas_autorizacion f
     WHERE p_sujeto_tipo = 'nino' AND f.nino_id = p_sujeto_id
       AND privado.firma_bloqueada(f.nino_id, f.firmante_id)
    UNION ALL
    SELECT 'autorizaciones', privado.nino_bloqueado_desde(a.nino_id)
      FROM public.autorizaciones a
     WHERE p_sujeto_tipo = 'nino' AND a.nino_id = p_sujeto_id AND privado.nino_bloqueado(a.nino_id)
    UNION ALL
    SELECT 'consentimientos', LEAST(privado.nino_bloqueado_desde(c.nino_id),
                                    privado.usuario_olvidado_desde(c.usuario_id, privado.centro_de_nino(c.nino_id)))
      FROM public.consentimientos c
     WHERE p_sujeto_tipo = 'nino' AND c.nino_id = p_sujeto_id
       AND privado.consentimiento_bloqueado(c.usuario_id, c.nino_id)
    UNION ALL
    SELECT 'acuses_alta', LEAST(privado.nino_bloqueado_desde(aa.nino_id),
                                privado.usuario_olvidado_desde(aa.firmante_id, aa.centro_id))
      FROM public.acuses_alta aa
     WHERE p_sujeto_tipo = 'nino' AND aa.nino_id = p_sujeto_id
       AND privado.firma_bloqueada(aa.nino_id, aa.firmante_id)
    UNION ALL
    SELECT 'medicacion_administrada', privado.nino_bloqueado_desde(am.nino_id)
      FROM public.administraciones_medicacion am
     WHERE p_sujeto_tipo = 'nino' AND am.nino_id = p_sujeto_id AND privado.nino_bloqueado(am.nino_id)
    UNION ALL
    SELECT 'servicios_diarios', privado.nino_bloqueado_desde(ps.nino_id)
      FROM public.parte_servicio_diario ps
     WHERE p_sujeto_tipo = 'nino' AND ps.nino_id = p_sujeto_id AND privado.nino_bloqueado(ps.nino_id)
    UNION ALL
    SELECT 'conceptos_asignados', privado.nino_bloqueado_desde(ac.nino_id)
      FROM public.asignacion_concepto ac
     WHERE p_sujeto_tipo = 'nino' AND ac.nino_id = p_sujeto_id AND ac.deleted_at IS NULL
       AND privado.nino_bloqueado(ac.nino_id)
    UNION ALL
    SELECT 'beca_comedor', privado.nino_bloqueado_desde(be.nino_id)
      FROM public.beca_comedor_elegibilidad be
     WHERE p_sujeto_tipo = 'nino' AND be.nino_id = p_sujeto_id AND privado.nino_bloqueado(be.nino_id)
    UNION ALL
    SELECT 'beca_comedor', privado.nino_bloqueado_desde(bt.nino_id)
      FROM public.beca_comedor_tramo bt
     WHERE p_sujeto_tipo = 'nino' AND bt.nino_id = p_sujeto_id AND privado.nino_bloqueado(bt.nino_id)
    UNION ALL
    SELECT 'lineas_recibo', privado.familia_bloqueada_desde(r.familia_id)
      FROM public.lineas_recibo lr
      JOIN public.recibos r ON r.id = lr.recibo_id
     WHERE p_sujeto_tipo = 'nino' AND lr.nino_id = p_sujeto_id AND r.deleted_at IS NULL
       AND privado.recibo_bloqueado(r.id)
    UNION ALL
    SELECT 'lecturas_ficha_medica', privado.nino_bloqueado_desde(l.nino_id)
      FROM public.lecturas_ficha_medica l
     WHERE p_sujeto_tipo = 'nino' AND l.nino_id = p_sujeto_id AND privado.nino_bloqueado(l.nino_id)
    -- ---- del usuario ----
    UNION ALL
    SELECT 'firmas', LEAST(privado.nino_bloqueado_desde(f.nino_id),
                           privado.usuario_olvidado_desde(f.firmante_id, privado.centro_de_nino(f.nino_id)))
      FROM public.firmas_autorizacion f
     WHERE p_sujeto_tipo = 'usuario' AND f.firmante_id = p_sujeto_id
       AND privado.firma_bloqueada(f.nino_id, f.firmante_id)
       AND (p_todos OR privado.es_responsable(privado.centro_de_nino(f.nino_id)))
    UNION ALL
    SELECT 'consentimientos', CASE WHEN c.nino_id IS NULL
                                   THEN privado.usuario_olvidado_desde(c.usuario_id, NULL)
                                   ELSE LEAST(privado.nino_bloqueado_desde(c.nino_id),
                                              privado.usuario_olvidado_desde(c.usuario_id,
                                                                             privado.centro_de_nino(c.nino_id))) END
      FROM public.consentimientos c
     WHERE p_sujeto_tipo = 'usuario' AND c.usuario_id = p_sujeto_id
       AND privado.consentimiento_bloqueado(c.usuario_id, c.nino_id)
       AND (p_todos OR (c.nino_id IS NOT NULL AND privado.es_responsable(privado.centro_de_nino(c.nino_id))))
    UNION ALL
    SELECT 'acuses_alta', LEAST(privado.nino_bloqueado_desde(aa.nino_id),
                                privado.usuario_olvidado_desde(aa.firmante_id, aa.centro_id))
      FROM public.acuses_alta aa
     WHERE p_sujeto_tipo = 'usuario' AND aa.firmante_id = p_sujeto_id
       AND privado.firma_bloqueada(aa.nino_id, aa.firmante_id)
       AND (p_todos OR privado.es_responsable(aa.centro_id))
    UNION ALL
    SELECT 'mandatos_sepa', COALESCE(privado.familia_bloqueada_desde(m.familia_id),
                                     privado.usuario_olvidado_desde(m.usuario_id, m.centro_id),
                                     privado.nino_bloqueado_desde(m.nino_id))
      FROM public.mandatos_sepa m
     WHERE p_sujeto_tipo = 'usuario' AND m.usuario_id = p_sujeto_id AND m.deleted_at IS NULL
       AND privado.mandato_bloqueado(m.familia_id, m.usuario_id, m.centro_id, m.nino_id)
       AND (p_todos OR privado.es_responsable(m.centro_id))
    UNION ALL
    SELECT 'recibos', privado.familia_bloqueada_desde(r.familia_id)
      FROM public.recibos r
      JOIN public.familias f ON f.id = r.familia_id
     WHERE p_sujeto_tipo = 'usuario' AND r.deleted_at IS NULL
       AND f.id IN (SELECT ft.familia_id FROM public.familia_tutores ft
                     WHERE ft.usuario_id = p_sujeto_id AND ft.deleted_at IS NULL)
       AND privado.familia_bloqueada(f.id)
       AND (p_todos OR privado.es_responsable(f.centro_id))
  )
  SELECT jsonb_agg(jsonb_build_object('codigo', codigo, 'n', n, 'desde', desde) ORDER BY codigo)
    FROM (SELECT codigo, count(*) AS n, min(desde) AS desde FROM filas GROUP BY codigo) x;
$function$;
REVOKE ALL ON FUNCTION privado.datos_bloqueados(text, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- ---- 5. El nombre del niño, fuera de un texto ----
-- Como palabra entera (los apellidos, como frase): "Escolaridad · Pepe" pierde a Pepe, "Pepete"
-- no. Todo lo que no es letra, cifra o espacio se escapa, para que el nombre no sea un patrón.
CREATE FUNCTION privado.quitar_nombre(p_texto text, p_nombre text, p_apellidos text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT CASE WHEN p_texto IS NULL OR nullif(btrim(p_nombre), '') IS NULL THEN p_texto ELSE
    regexp_replace(
      CASE WHEN nullif(btrim(p_apellidos), '') IS NULL THEN p_texto
           ELSE regexp_replace(p_texto,
                  '\m' || regexp_replace(btrim(p_apellidos), '([^[:alnum:][:space:]])', '\\\1', 'g') || '\M',
                  '[borrado]', 'g') END,
      '\m' || regexp_replace(btrim(p_nombre), '([^[:alnum:][:space:]])', '\\\1', 'g') || '\M',
      '[borrado]', 'g') END;
$function$;
REVOKE ALL ON FUNCTION privado.quitar_nombre(text, text, text) FROM PUBLIC, anon, authenticated;

-- ---- 6. El registro de lecturas de la ficha se conserva tras la purga ----
-- Bloqueado (lecturas_ficha_medica, abajo) y hasta su plazo de 60 meses.
DROP TRIGGER ninos_purga_borra_lecturas ON public.ninos;
DROP FUNCTION privado.ninos_purga_borra_lecturas();

-- ---- 7. Las funciones que cambian ----
-- Cada una es la de producción (pg_get_functiondef) con su cambio marcado «Retención (PR-7)».

-- 7.1 Ningún tutor se olvida con un hijo matriculado: también los hijos de sus familias.
CREATE OR REPLACE FUNCTION privado.olvido_bloqueos(p_sujeto_tipo olvido_sujeto_tipo, p_sujeto_id uuid, p_centro_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bloqueos jsonb := '[]'::jsonb;
  v_avisos   jsonb := '[]'::jsonb;
  v_familias uuid[];
  v_n        integer;
BEGIN
  IF p_sujeto_tipo = 'nino' THEN
    SELECT count(*) INTO v_n FROM public.matriculas m
     WHERE m.nino_id = p_sujeto_id AND m.deleted_at IS NULL AND m.estado <> 'baja';
    IF v_n > 0 THEN
      v_bloqueos := v_bloqueos || jsonb_build_object('codigo', 'matricula_viva', 'n', v_n);
    END IF;

    -- Los recibos de su familia no bloquean: la deuda es de la familia, y sus datos se quedan.
    SELECT count(*) INTO v_n FROM public.recibos r
      JOIN public.ninos n ON n.familia_id = r.familia_id
     WHERE n.id = p_sujeto_id AND r.centro_id = p_centro_id AND r.deleted_at IS NULL
       AND ((r.estado IN ('borrador', 'pendiente_procesar') AND r.total_centimos > 0)
         OR (r.estado = 'devuelto' AND r.devolucion_salida IS NULL));
    IF v_n > 0 THEN
      v_avisos := v_avisos || jsonb_build_object('codigo', 'recibos_familia_pendientes', 'n', v_n);
    END IF;
  ELSE
    -- Retención (F11-B, punto 6, PR-7): ningún tutor se olvida con un hijo matriculado, haya otro
    -- tutor o no. Sus hijos son los de sus vínculos y los de sus familias: un tutor puede estar en
    -- la familia sin vínculo con el niño.
    SELECT count(DISTINCT n.id) INTO v_n FROM public.ninos n
     WHERE n.centro_id = p_centro_id
       AND (EXISTS (SELECT 1 FROM public.vinculos_familiares v
                     WHERE v.nino_id = n.id AND v.usuario_id = p_sujeto_id AND v.deleted_at IS NULL)
            OR EXISTS (SELECT 1 FROM public.familia_tutores ft
                        WHERE ft.familia_id = n.familia_id AND ft.usuario_id = p_sujeto_id
                          AND ft.deleted_at IS NULL))
       AND EXISTS (SELECT 1 FROM public.matriculas m
                    WHERE m.nino_id = n.id AND m.deleted_at IS NULL AND m.estado <> 'baja');
    IF v_n > 0 THEN
      v_bloqueos := v_bloqueos || jsonb_build_object('codigo', 'hijos_matriculados', 'n', v_n);
    END IF;

    SELECT coalesce(array_agg(DISTINCT ft.familia_id), '{}') INTO v_familias
      FROM public.familia_tutores ft
     WHERE ft.usuario_id = p_sujeto_id AND ft.centro_id = p_centro_id AND ft.deleted_at IS NULL;

    SELECT count(*) INTO v_n FROM public.recibos r
     WHERE r.familia_id = ANY (v_familias) AND r.centro_id = p_centro_id AND r.deleted_at IS NULL
       AND ((r.estado IN ('borrador', 'pendiente_procesar') AND r.total_centimos > 0)
         OR (r.estado = 'devuelto' AND r.devolucion_salida IS NULL));
    IF v_n > 0 THEN
      v_bloqueos := v_bloqueos || jsonb_build_object('codigo', 'recibos_pendientes', 'n', v_n);
    END IF;

    SELECT count(*) INTO v_n FROM public.recibos r
     WHERE r.familia_id = ANY (v_familias) AND r.centro_id = p_centro_id AND r.deleted_at IS NULL
       AND r.estado = 'enviado_banco' AND r.fecha_envio_banco >= (now() - interval '8 weeks')::date;
    IF v_n > 0 THEN
      v_avisos := v_avisos || jsonb_build_object('codigo', 'cobro_banco_reciente', 'n', v_n);
    END IF;

    SELECT (SELECT count(*) FROM public.beca_comedor_desborde d
             WHERE d.familia_id = ANY (v_familias) AND d.centro_id = p_centro_id
               AND d.estado = 'pendiente')
         + (SELECT count(*) FROM public.beca_comedor_transferencia t
             WHERE t.familia_id = ANY (v_familias) AND t.centro_id = p_centro_id
               AND t.estado = 'pendiente')
      INTO v_n;
    IF v_n > 0 THEN
      v_avisos := v_avisos || jsonb_build_object('codigo', 'dinero_a_favor', 'n', v_n);
    END IF;

    SELECT count(*) INTO v_n FROM public.mandatos_sepa ms
     WHERE ms.familia_id = ANY (v_familias) AND ms.centro_id = p_centro_id
       AND ms.estado = 'activo' AND ms.deleted_at IS NULL;
    IF v_n > 0 THEN
      v_avisos := v_avisos || jsonb_build_object('codigo', 'mandato_activo', 'n', v_n);
    END IF;
  END IF;

  RETURN jsonb_build_object('bloqueos', v_bloqueos, 'avisos', v_avisos);
END;
$function$;

-- 7.2 Lo que impide confirmar el olvido de un usuario impide purgarlo: la petición espera.
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
    -- Retención (PR-7): en los días de gracia el hijo puede volver a matricularse; la petición
    -- espera, sin purgarse, a que deje el centro.
    AND (s.sujeto_tipo <> 'usuario'
         OR jsonb_array_length(privado.olvido_bloqueos(s.sujeto_tipo, s.sujeto_id, s.centro_id)
                               -> 'bloqueos') = 0)
    AND ((auth.uid() IS NULL
          AND (COALESCE(auth.role(), '') = 'service_role'
               OR (session_user <> 'authenticator'
                   AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                   AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)))
         OR privado.es_responsable(s.centro_id))
  ORDER BY s.gracia_hasta;
$function$;

-- 7.3 La purga del niño fija su fecha y quita su nombre de las líneas de recibo.
CREATE OR REPLACE FUNCTION privado.purgar_nino(p_nino_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lista     uuid[];
  v_nombre    text;
  v_apellidos text;
BEGIN
  -- Retención (PR-7): el nombre, antes de borrarlo, para quitarlo de sus líneas de recibo. Si ya
  -- se purgó, no queda nombre que buscar.
  SELECT nullif(btrim(nombre), ''), nullif(btrim(apellidos), '') INTO v_nombre, v_apellidos
    FROM public.ninos WHERE id = p_nino_id AND deleted_reason IS DISTINCT FROM 'purga_rgpd';

  -- D-5: motivo 'purga_rgpd' → desarchivar_nino RAISE (no reincorpora un sujeto purgado).
  UPDATE public.ninos SET
    nombre           = '[borrado]',
    apellidos        = '[borrado]',
    fecha_nacimiento = DATE '1900-01-01',
    sexo             = NULL,
    nacionalidad     = NULL,
    foto_url         = NULL,
    notas_admin      = NULL,
    -- Purga RGPD del niño: el resto de columnas personales de la ficha. idioma_principal
    -- es NOT NULL: 'zz' (no es un idioma, como en idiomas_casa) en vez de inventar 'es'. El
    -- CHECK solo admite 'zz' con deleted_reason = 'purga_rgpd', que pone este mismo UPDATE.
    idioma_principal     = 'zz',
    direccion_calle      = NULL,
    direccion_numero     = NULL,
    direccion_cp         = NULL,
    direccion_ciudad     = NULL,
    libro_familia_path   = NULL,
    estado_civil_familia = NULL,
    deleted_reason   = 'purga_rgpd',
    deleted_at       = COALESCE(deleted_at, now()),
    -- Retención (PR-7): desde cuándo está bloqueado lo que se conserva.
    purgado_en       = COALESCE(purgado_en, now())
  WHERE id = p_nino_id;

  UPDATE public.info_medica_emergencia SET
    alergias_graves     = NULL,
    notas_emergencia    = NULL,
    medicacion_habitual = NULL,
    alergias_leves      = NULL,
    medico_familia      = NULL,
    telefono_emergencia = NULL
  WHERE nino_id = p_nino_id;

  UPDATE public.datos_pedagogicos_nino SET
    lactancia_observaciones          = NULL,
    control_esfinteres_observaciones = NULL,
    siesta_horario_habitual          = NULL,
    siesta_observaciones             = NULL,
    alimentacion_observaciones       = CASE WHEN tipo_alimentacion = 'otra'
                                            THEN '[borrado]' ELSE NULL END,
    -- Purga RGPD del niño: el CHECK exige de 1 a 8 códigos de 2 letras; 'zz' no es un idioma.
    idiomas_casa                     = ARRAY['zz'],
    deleted_at                       = COALESCE(deleted_at, now())
  WHERE nino_id = p_nino_id;

  -- Purga RGPD del niño: el motivo de baja es texto libre del centro sobre el niño.
  UPDATE public.matriculas SET motivo_baja = NULL
  WHERE nino_id = p_nino_id AND motivo_baja IS NOT NULL;

  -- Retención (PR-7): el recibo se conserva entero, con su total y sus líneas, porque justifica
  -- el cobro. De sus líneas solo cambia el nombre del niño, que las viejas llevaban tras « · »
  -- (B3, 20260814120000, dejó de ponerlo) y que un cargo puntual puede llevar en su texto. Como
  -- palabra entera, para no romper otra que lo contenga. Su copia en audit_log, igual. El recibo
  -- confirmado está congelado: congelar_si_mes_cerrado deja pasar este cambio, y solo este.
  IF v_nombre IS NOT NULL THEN
    UPDATE public.lineas_recibo
       SET descripcion = privado.quitar_nombre(descripcion, v_nombre, v_apellidos)
     WHERE nino_id = p_nino_id
       AND descripcion IS DISTINCT FROM privado.quitar_nombre(descripcion, v_nombre, v_apellidos);
    UPDATE public.audit_log SET
      valores_antes = CASE WHEN jsonb_typeof(valores_antes->'descripcion') = 'string'
        THEN jsonb_set(valores_antes, '{descripcion}', to_jsonb(
               privado.quitar_nombre(valores_antes->>'descripcion', v_nombre, v_apellidos)))
        ELSE valores_antes END,
      valores_despues = CASE WHEN jsonb_typeof(valores_despues->'descripcion') = 'string'
        THEN jsonb_set(valores_despues, '{descripcion}', to_jsonb(
               privado.quitar_nombre(valores_despues->>'descripcion', v_nombre, v_apellidos)))
        ELSE valores_despues END
    WHERE tabla = 'lineas_recibo'
      AND (valores_antes->>'nino_id' = p_nino_id::text OR valores_despues->>'nino_id' = p_nino_id::text)
      AND (valores_antes->>'descripcion'
             IS DISTINCT FROM privado.quitar_nombre(valores_antes->>'descripcion', v_nombre, v_apellidos)
           OR valores_despues->>'descripcion'
             IS DISTINCT FROM privado.quitar_nombre(valores_despues->>'descripcion', v_nombre, v_apellidos));
  END IF;

  -- D-5: motivo 'purga_rgpd' → desarchivar_nino NUNCA revive un vínculo purgado.
  UPDATE public.vinculos_familiares SET
    descripcion_parentesco = NULL,
    deleted_reason         = 'purga_rgpd',
    deleted_at             = COALESCE(deleted_at, now())
  WHERE nino_id = p_nino_id;

  DELETE FROM public.media m
  WHERE EXISTS (
          SELECT 1 FROM public.media_etiquetas e
          WHERE e.media_id = m.id AND e.nino_id = p_nino_id)
    AND NOT EXISTS (
          SELECT 1 FROM public.media_etiquetas e2
          WHERE e2.media_id = m.id AND e2.nino_id <> p_nino_id);
  DELETE FROM public.media_etiquetas WHERE nino_id = p_nino_id;

  -- Cierre de la purga: los cambios pendientes del niño (su dirección, su libro de familia,
  -- los datos de sus tutores) se borran; el payload no entra en audit_log, solo la tabla lo
  -- guarda. Los documentos en Storage los borra antes el manifiesto de adjuntos.
  DELETE FROM public.cambios_pendientes WHERE nino_id = p_nino_id;

  -- Retención (F11-B, punto 6, PR-4): su operativa (agenda, asistencia, mensajes, informes,
  -- citas, recordatorios, respuestas a eventos) se borra, con sus copias en audit_log.
  PERFORM privado.olvido_borrar_operativa_nino(p_nino_id);

  -- Purga RGPD del niño: la copia en audit_log, con la lista de claves por tabla que
  -- comparte con purgar_esqueleto_huerfano_nino (_claves_pii_nino).
  PERFORM public._redactar_auditoria_nino(p_nino_id);

  -- Purga de lista_espera: el prospecto del niño se borra entero (la plaza no tiene sentido
  -- sin el niño). Su copia en audit_log se redacta por registro_id: así se alcanza también el
  -- INSERT, que nace con nino_id NULL, y el DELETE que acaba de escribir esta purga.
  WITH borrados AS (
    DELETE FROM public.lista_espera WHERE nino_id = p_nino_id RETURNING id
  )
  SELECT array_agg(id) INTO v_lista FROM borrados;
  UPDATE public.audit_log SET
    valores_antes   = public._redactar_jsonb(valores_antes,   public._claves_pii_nino('lista_espera')),
    valores_despues = public._redactar_jsonb(valores_despues, public._claves_pii_nino('lista_espera'))
  WHERE tabla = 'lista_espera' AND registro_id = ANY (v_lista);

END;
$function$;

-- 7.4 El punto de commit vuelve a mirar lo que falta.
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

-- 7.5 La línea congelada deja pasar que la purga le quite el nombre, y nada más.
CREATE OR REPLACE FUNCTION public.congelar_si_mes_cerrado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro uuid;
  v_anio integer;
  v_mes integer;
  r_recibo record;
BEGIN
  -- Exención de service_role (backend de confianza, NUNCA expuesto al cliente): permite la
  -- limpieza/teardown, el CASCADE de borrado de centros y las correcciones server-side. El
  -- congelado protege frente a ediciones de ADMIN (authenticated), no frente al backend. El
  -- motor (SECURITY DEFINER llamado por admin) corre con auth.role()='authenticated' → NO se
  -- exime, pero solo toca borradores. auth.role() lee el claim del JWT (nivel request), no el
  -- rol de ejecución del DEFINER, así que distingue correctamente al llamante.
  IF auth.role() = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'parte_servicio_diario' THEN
    -- Congelado POR MES: el parte de un mes cerrado (cierre_mensual) es inmutable.
    v_centro := privado.centro_de_nino(COALESCE(NEW.nino_id, OLD.nino_id));
    v_anio := EXTRACT(YEAR  FROM COALESCE(NEW.fecha, OLD.fecha))::integer;
    v_mes  := EXTRACT(MONTH FROM COALESCE(NEW.fecha, OLD.fecha))::integer;
    IF public.mes_cerrado(v_centro, v_anio, v_mes) THEN
      RAISE EXCEPTION 'mes cerrado: el parte de servicio de % no es editable',
        to_char(COALESCE(NEW.fecha, OLD.fecha), 'YYYY-MM') USING ERRCODE = 'P0001';
    END IF;

  ELSIF TG_TABLE_NAME = 'recibos' THEN
    -- Congelado POR ESTADO. Solo recibos REGULARES (esporádicos y devoluciones fuera).
    IF COALESCE(NEW.es_esporadico, OLD.es_esporadico) = false
       AND COALESCE(NEW.devuelto_de_recibo_id, OLD.devuelto_de_recibo_id) IS NULL THEN
      IF TG_OP = 'DELETE' THEN
        -- Solo se borra un borrador (regeneración). Un confirmado no se borra.
        IF OLD.estado <> 'borrador' THEN
          RAISE EXCEPTION 'recibo confirmado: % no se borra',
            to_char(make_date(OLD.anio, OLD.mes, 1), 'YYYY-MM') USING ERRCODE = 'P0001';
        END IF;
      ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.estado <> 'borrador' THEN
          -- R-5: el retroceso a borrador ("desconfirmar") deja de estar prohibido, pero solo
          -- por la puerta estrecha. Se comprueba AQUÍ, y no solo en la RPC, porque esto es
          -- una invariante del dato: ningún UPDATE directo debe poder reabrir un recibo que
          -- ya viajó al banco, venga de la RPC, de otra action o de un arreglo a mano.
          IF NEW.estado = 'borrador' THEN
            IF OLD.estado <> 'pendiente_procesar' THEN
              RAISE EXCEPTION 'recibo en el circuito de cobro (%): ya no vuelve a borrador',
                OLD.estado USING ERRCODE = 'P0001';
            END IF;
            IF public.recibo_en_remesa(OLD.id) THEN
              RAISE EXCEPTION 'recibo en remesa: no se puede modificar'
                USING ERRCODE = 'P0001';
            END IF;
          END IF;
          IF NOT (
                NEW.total_centimos        IS NOT DISTINCT FROM OLD.total_centimos
            AND NEW.metodo                IS NOT DISTINCT FROM OLD.metodo
            AND NEW.familia_id            IS NOT DISTINCT FROM OLD.familia_id
            AND NEW.nino_id               IS NOT DISTINCT FROM OLD.nino_id
            AND NEW.anio                  IS NOT DISTINCT FROM OLD.anio
            AND NEW.mes                   IS NOT DISTINCT FROM OLD.mes
            AND NEW.es_esporadico         IS NOT DISTINCT FROM OLD.es_esporadico
            AND NEW.concepto_esporadico   IS NOT DISTINCT FROM OLD.concepto_esporadico
            AND NEW.devuelto_de_recibo_id IS NOT DISTINCT FROM OLD.devuelto_de_recibo_id
          ) THEN
            RAISE EXCEPTION 'recibo confirmado: inmutable salvo estado/fecha de cobro'
              USING ERRCODE = 'P0001';
          END IF;
        END IF;
        -- OLD.estado='borrador': edición libre, incluye la transición a pendiente_procesar.
      END IF;
      -- TG_OP='INSERT': permitido (el recibo regular nace en borrador).
    END IF;

  ELSIF TG_TABLE_NAME = 'lineas_recibo' THEN
    -- Retención (PR-7): la purga del niño quita su nombre de la descripción de la línea, también
    -- en un recibo confirmado. Solo ese cambio: el resto de la fila tiene que quedar igual, y la
    -- descripción nueva es la vieja sin el nombre.
    IF TG_OP = 'UPDATE'
       AND COALESCE(current_setting('app.audit_actor', true), '')
             IN ('system:purgar_sujeto_db', 'system:purgar_expediente_vencido')
       AND (to_jsonb(NEW) - 'descripcion') = (to_jsonb(OLD) - 'descripcion')
       AND strpos(NEW.descripcion, '[borrado]') > 0 THEN
      RETURN NEW;
    END IF;
    -- Congelado POR ESTADO del recibo padre.
    SELECT estado, es_esporadico, devuelto_de_recibo_id, anio, mes
      INTO r_recibo
      FROM public.recibos WHERE id = COALESCE(NEW.recibo_id, OLD.recibo_id);
    IF FOUND
       AND r_recibo.es_esporadico = false
       AND r_recibo.devuelto_de_recibo_id IS NULL
       AND r_recibo.estado <> 'borrador' THEN
      RAISE EXCEPTION 'recibo confirmado: las líneas de % no son editables',
        to_char(make_date(r_recibo.anio, r_recibo.mes, 1), 'YYYY-MM') USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END $function$;

-- 7.6 El registro de lecturas de un niño purgado, bloqueado.
CREATE OR REPLACE FUNCTION public.lecturas_ficha_medica(p_nino_id uuid)
 RETURNS TABLE(leida_en timestamp with time zone, lector_nombre text, rol_lector text, origen text, campos text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
  -- Retención (PR-7): purgado el niño, el registro se conserva bloqueado hasta su plazo
  -- (purgar_lecturas_ficha_medica) y nadie lo lee en la app. 55000 con la fecha en DETAIL,
  -- como la ficha bloqueada.
  IF privado.nino_bloqueado(p_nino_id) THEN
    RAISE EXCEPTION 'el registro de lecturas está bloqueado'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'bloqueado',
            DETAIL = privado.nino_bloqueado_desde(p_nino_id)::text;
  END IF;
  RETURN QUERY
  SELECT l.leida_en, u.nombre_completo, l.rol_lector, l.origen, l.campos
    FROM public.lecturas_ficha_medica l
    LEFT JOIN public.usuarios u ON u.id = l.lector_id
   WHERE l.nino_id = p_nino_id
   ORDER BY l.leida_en DESC;
END;
$function$;

-- 7.7 La exportación deja fuera lo bloqueado y dice que existe.
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
  v_bloq   boolean;
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
           AND (v_self OR privado.es_responsable(m.centro_id))
           -- Retención (PR-7): lo bloqueado no sale; datos_bloqueados dice que existe.
           AND NOT privado.mandato_bloqueado(m.familia_id, m.usuario_id, m.centro_id, m.nino_id)), '[]'::jsonb),

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
           AND (v_self OR privado.es_responsable(f.centro_id))
           AND NOT privado.familia_bloqueada(f.id)), '[]'::jsonb),

      -- Retención (PR-7): lo que se conserva por obligación legal y está bloqueado. No sale, y
      -- no se calla: qué es, cuánto y desde cuándo.
      'datos_bloqueados', privado.datos_bloqueados('usuario', p_sujeto_id, v_self)
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
    v_bloq  := privado.nino_bloqueado(p_sujeto_id);
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
         WHERE c.nino_id = p_sujeto_id AND NOT v_bloq
           AND NOT privado.usuario_olvidado_en(c.usuario_id, v_centro)), '[]'::jsonb),

      'acuses_alta', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'tipo', aa.tipo, 'metodo', aa.metodo, 'aceptado_en', aa.aceptado_en)
               ORDER BY aa.aceptado_en)
          FROM public.acuses_alta aa
         WHERE aa.nino_id = p_sujeto_id AND NOT v_bloq
           AND NOT (aa.firmante_id IS NOT NULL
                    AND privado.usuario_olvidado_en(aa.firmante_id, aa.centro_id))), '[]'::jsonb),

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
         WHERE ac.nino_id = p_sujeto_id AND ac.deleted_at IS NULL AND NOT v_bloq), '[]'::jsonb),

      'lineas_recibo', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'anio', r.anio, 'mes', r.mes, 'descripcion', lr.descripcion,
                 'cantidad', lr.cantidad, 'importe_centimos', lr.importe_centimos)
               ORDER BY r.anio, r.mes, lr.created_at)
          FROM public.lineas_recibo lr
          JOIN public.recibos r ON r.id = lr.recibo_id
         WHERE lr.nino_id = p_sujeto_id AND r.deleted_at IS NULL
           AND NOT privado.recibo_bloqueado(r.id)), '[]'::jsonb),

      'servicios_diarios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'fecha', ps.fecha, 'servicio', ps.servicio, 'presente', ps.presente)
               ORDER BY ps.fecha, ps.servicio)
          FROM public.parte_servicio_diario ps
         WHERE ps.nino_id = p_sujeto_id AND NOT v_bloq), '[]'::jsonb),

      'beca_comedor_elegibilidad', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'curso', ca.nombre, 'fecha_alta', be.fecha_alta,
                 'fecha_baja', be.fecha_baja, 'activa', be.activa)
               ORDER BY be.fecha_alta)
          FROM public.beca_comedor_elegibilidad be
          JOIN public.cursos_academicos ca ON ca.id = be.curso_academico_id
         WHERE be.nino_id = p_sujeto_id AND NOT v_bloq), '[]'::jsonb),

      'beca_comedor_tramos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'anio_correspondiente', bt.anio_correspondiente,
                 'mes_correspondiente', bt.mes_correspondiente,
                 'anio_aplicacion', bt.anio_aplicacion, 'mes_aplicacion', bt.mes_aplicacion,
                 'importe_centimos', bt.importe_centimos, 'estado', bt.estado,
                 'origen', bt.origen)
               ORDER BY bt.anio_correspondiente, bt.mes_correspondiente, bt.created_at)
          FROM public.beca_comedor_tramo bt
         WHERE bt.nino_id = p_sujeto_id AND NOT v_bloq), '[]'::jsonb),

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
         WHERE l.nino_id = p_sujeto_id AND NOT v_bloq), '[]'::jsonb),

      -- Retención (PR-7): lo que se conserva por obligación legal y está bloqueado.
      'datos_bloqueados', privado.datos_bloqueados('nino', p_sujeto_id, v_admin)
    );
  END IF;

  RAISE EXCEPTION 'tipo de sujeto inválido: %', p_sujeto_tipo
    USING ERRCODE = 'invalid_parameter_value';
END
$function$;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_t   text;
  v_f   text;
  v_src text;
BEGIN
  -- Cada tabla con lo que se conserva tiene su política, y nada la esquiva: todas sus políticas
  -- son de authenticated y anon no lee ninguna.
  FOREACH v_t IN ARRAY ARRAY['firmas_autorizacion', 'acuses_alta', 'consentimientos', 'autorizaciones',
                             'administraciones_medicacion', 'parte_servicio_diario',
                             'beca_comedor_elegibilidad', 'beca_comedor_tramo', 'asignacion_concepto',
                             'recibos', 'lineas_recibo', 'recibos_remesa', 'metodo_pago_familia',
                             'beca_comedor_desborde', 'beca_comedor_transferencia', 'mandatos_sepa'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'public' AND tablename = v_t AND policyname = 'bloqueo_retencion'
                      AND permissive = 'RESTRICTIVE' AND cmd = 'ALL' AND roles = '{authenticated}') THEN
      RAISE EXCEPTION '% no tiene su política de bloqueo', v_t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = v_t AND roles <> '{authenticated}') THEN
      RAISE EXCEPTION '% tiene una política que no es de authenticated: el bloqueo no la cubre', v_t;
    END IF;
    IF has_table_privilege('anon', format('public.%I', v_t), 'SELECT') THEN
      RAISE EXCEPTION 'anon lee %', v_t;
    END IF;
  END LOOP;
  IF has_table_privilege('authenticated', 'public.lecturas_ficha_medica', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated lee lecturas_ficha_medica directamente';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ninos_purga_borra_lecturas') THEN
    RAISE EXCEPTION 'la purga sigue borrando las lecturas de la ficha';
  END IF;

  -- Las preguntas, abiertas a quien las necesita; lo que deja ver filas, no.
  FOREACH v_f IN ARRAY ARRAY['privado.nino_bloqueado(uuid)', 'privado.nino_bloqueado_desde(uuid)',
                             'privado.cuenta_olvidada(uuid)', 'privado.usuario_olvidado_en(uuid,uuid)',
                             'privado.usuario_olvidado_desde(uuid,uuid)',
                             'privado.familia_bloqueada(uuid)', 'privado.familia_bloqueada_desde(uuid)',
                             'privado.recibo_bloqueado(uuid)',
                             'privado.mandato_bloqueado(uuid,uuid,uuid,uuid)',
                             'privado.firma_bloqueada(uuid,uuid)',
                             'privado.consentimiento_bloqueado(uuid,uuid)'] LOOP
    IF NOT has_function_privilege('authenticated', v_f, 'EXECUTE')
       OR has_function_privilege('anon', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION '% no tiene los permisos de este fichero', v_f;
    END IF;
  END LOOP;
  FOREACH v_f IN ARRAY ARRAY['privado.datos_bloqueados(text,uuid,boolean)',
                             'privado.quitar_nombre(text,text,text)',
                             'privado.olvido_bloqueos(public.olvido_sujeto_tipo,uuid,uuid)',
                             'privado.purgar_nino(uuid)',
                             'public.purgar_sujeto_db(uuid)', 'public.olvido_pendientes()'] LOOP
    IF has_function_privilege('authenticated', v_f, 'EXECUTE')
       OR has_function_privilege('anon', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION '% quedó abierta a quien no toca', v_f;
    END IF;
  END LOOP;
  FOREACH v_f IN ARRAY ARRAY['public.purgar_sujeto_db(uuid)', 'public.olvido_pendientes()'] LOOP
    IF NOT has_function_privilege('service_role', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION '% perdió el EXECUTE de service_role', v_f;
    END IF;
  END LOOP;
  FOREACH v_f IN ARRAY ARRAY['public.export_datos_sujeto(text,uuid)', 'public.lecturas_ficha_medica(uuid)'] LOOP
    IF NOT has_function_privilege('authenticated', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION '% perdió el EXECUTE de authenticated', v_f;
    END IF;
  END LOOP;

  -- Cada función dice lo que tiene que decir.
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.purgar_sujeto_db(uuid)'::regprocedure;
  IF strpos(v_src, 'privado.olvido_bloqueos(s.sujeto_tipo') = 0
     OR strpos(v_src, 'PERFORM privado.purgar_nino(s.sujeto_id);') = 0 THEN
    RAISE EXCEPTION 'purgar_sujeto_db no mira lo que falta o no llama a privado.purgar_nino';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'privado.purgar_nino(uuid)'::regprocedure;
  IF strpos(v_src, 'purgado_en       = COALESCE(purgado_en, now())') = 0
     OR strpos(v_src, 'privado.quitar_nombre(descripcion, v_nombre, v_apellidos)') = 0 THEN
    RAISE EXCEPTION 'privado.purgar_nino no fija la fecha o no quita el nombre de las líneas';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.export_datos_sujeto(text,uuid)'::regprocedure;
  IF (length(v_src) - length(replace(v_src, 'privado.datos_bloqueados(', ''))) / length('privado.datos_bloqueados(') <> 2 THEN
    RAISE EXCEPTION 'export_datos_sujeto no dice lo bloqueado del usuario y del niño';
  END IF;
  IF strpos((SELECT prosrc FROM pg_proc WHERE oid = 'privado.olvido_bloqueos(public.olvido_sujeto_tipo,uuid,uuid)'::regprocedure),
            'ft.familia_id = n.familia_id') = 0 THEN
    RAISE EXCEPTION 'olvido_bloqueos no mira los hijos de las familias del tutor';
  END IF;

  -- El nombre sale como palabra entera, también con tildes.
  IF privado.quitar_nombre('Escolaridad · Pepe', 'Pepe', NULL) <> 'Escolaridad · [borrado]'
     OR privado.quitar_nombre('Pepete', 'Pepe', NULL) <> 'Pepete'
     OR privado.quitar_nombre('Comedor · Íñigo (5 días)', 'Íñigo', NULL) <> 'Comedor · [borrado] (5 días)'
     OR privado.quitar_nombre('Excursión de Ana Gil Ruiz', 'Ana', 'Gil Ruiz') <> 'Excursión de [borrado] [borrado]'
     OR privado.quitar_nombre('Taller (a.b)', 'a.b', NULL) <> 'Taller ([borrado])'
     OR privado.quitar_nombre('Taller axb', 'a.b', NULL) <> 'Taller axb' THEN
    RAISE EXCEPTION 'quitar_nombre no quita el nombre como palabra entera';
  END IF;

  RAISE NOTICE 'guarda posterior: purgar_sujeto_db %, purgar_nino %, export %; % niños y % familias bloqueados',
    (SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
       FROM pg_proc p WHERE p.oid = 'public.purgar_sujeto_db(uuid)'::regprocedure),
    (SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
       FROM pg_proc p WHERE p.oid = 'privado.purgar_nino(uuid)'::regprocedure),
    (SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
       FROM pg_proc p WHERE p.oid = 'public.export_datos_sujeto(text,uuid)'::regprocedure),
    (SELECT count(*) FROM public.ninos WHERE privado.nino_bloqueado(id)),
    (SELECT count(*) FROM public.familias WHERE privado.familia_bloqueada(id));
END
$guarda$;
