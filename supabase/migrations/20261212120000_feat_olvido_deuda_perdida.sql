-- =============================================================================
-- FEAT — La deuda dada por perdida y las peticiones de olvido que esperan (PR-B1)
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/olvido-peticiones.md. Decisiones del responsable del 2026-10-30 (ADR-0064).
--
-- Un impago bloquea el olvido del tutor para siempre: su petición no se puede confirmar
-- (`recibos_pendientes`) y se queda pendiente. La salida es una decisión de la admin, que renuncia a
-- cobrar esa deuda:
--
--   · `recibos.deuda_perdida_en` / `deuda_perdida_por` / `deuda_perdida_solicitud_id`: la marca de
--     la renuncia. No cambia el estado, el importe ni la remesa del recibo: la contabilidad queda
--     entera, con la familia y sus apellidos (Hacienda puede pedir que se justifique la pérdida;
--     art. 17.3.e RGPD). La pone solo `dar_deuda_por_perdida` y la quita solo la vuelta atrás de la
--     confirmación (trigger `recibos_deuda_perdida_validar`, también para service_role). La pone la
--     admin con su sesión: el trigger de auditoría de `recibos` guarda quién, cuándo y el importe.
--   · `privado.recibos_pendientes_olvido(familias, centro)`: los recibos que bloquean el olvido, en
--     un solo sitio (los que tenía `olvido_bloqueos`), sin los de deuda dada por perdida.
--     `olvido_bloqueos` cuenta con ella y `familia_dinero_pendiente` deja fuera la deuda perdida.
--   · `privado.deuda_olvido(solicitud)`: cuánto debe la familia de quien pide el olvido y si se
--     puede dar por perdido: solo si es lo único que falta, y sin recibos en borrador (el motor los
--     rehace) ni en una remesa en borrador (el banco los acabaría cobrando).
--   · `dar_deuda_por_perdida(solicitud, importe)` (solo la admin, `privado.es_titular`): marca esos
--     recibos y confirma la petición, con sus 7 días de gracia. El importe es el que vio la admin: si
--     cambió entre medias, 40001. Deshacer la confirmación en la gracia quita también la marca
--     (`olvido_volver_a_pendiente`): la deuda vuelve. Solo borra a quien lo pidió.
--   · Una deuda dada por perdida no entra en una remesa (`recibos_remesa_sin_deuda_perdida`).
--   · `peticiones_olvido_centro` y `mis_peticiones_olvido` dan lo que falta también de las
--     confirmadas sin purgar (`privado.olvido_falta`, el cálculo de la purga), y
--     `peticiones_olvido_centro` la deuda de cada petición de un tutor.
--
-- La aplica el responsable por SQL Editor. Orden: aplicar antes de desplegar la app nueva, que
-- llama a `dar_deuda_por_perdida` y lee `deuda` de `peticiones_olvido_centro` (la app vieja no
-- lee esa columna). Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  r     record;
  v_md5 text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('privado.olvido_bloqueos(olvido_sujeto_tipo,uuid,uuid)', 'a25058d41c0f6d8054318ef77115fe1b', '20261206120000'),
      ('privado.familia_dinero_pendiente(uuid)', '7c9e0b3ceb4b10d9a19abaf7ea89048c', '20261208120000'),
      ('privado.olvido_volver_a_pendiente(uuid)', '611455e36be5d5fd0bb46ea91e5a8ff3', '20261206120000'),
      ('public.peticiones_olvido_centro(uuid)', '415f8518b0277a1416ef10080a0551a8', '20261207120000'),
      ('public.mis_peticiones_olvido()', '7fc52c7d38b6605a9532dc420465d27c', '20261207120000'),
      ('public.confirmar_peticion_olvido(uuid)', '6b73b524d0e100fc2751ecd7c73a1743', '20261126120000')
    ) AS t(f, md5, mig)
  LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f);
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION '% no es la de %: %', r.f, r.mig, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'recibos' AND column_name LIKE 'deuda_perdida%') THEN
    RAISE EXCEPTION 'recibos ya tiene columnas deuda_perdida';
  END IF;

  RAISE NOTICE 'guarda previa: % peticiones pendientes, % confirmadas sin purgar, % recibos con deuda viva',
    (SELECT count(*) FROM public.olvido_solicitudes WHERE estado = 'pendiente'),
    (SELECT count(*) FROM public.olvido_solicitudes WHERE estado = 'confirmada' AND purgado_en IS NULL),
    (SELECT count(*) FROM public.recibos rc WHERE rc.deleted_at IS NULL
       AND ((rc.estado IN ('borrador', 'pendiente_procesar') AND rc.total_centimos > 0)
         OR (rc.estado = 'devuelto' AND rc.devolucion_salida IS NULL)));
END
$guarda$;

-- ---- 1. La marca en el recibo ----
ALTER TABLE public.recibos
  ADD COLUMN deuda_perdida_en timestamptz,
  ADD COLUMN deuda_perdida_por uuid REFERENCES public.usuarios(id),
  ADD COLUMN deuda_perdida_solicitud_id uuid REFERENCES public.olvido_solicitudes(id),
  ADD CONSTRAINT recibos_deuda_perdida_coherente CHECK (
    (deuda_perdida_en IS NULL) = (deuda_perdida_por IS NULL)
    AND (deuda_perdida_en IS NULL) = (deuda_perdida_solicitud_id IS NULL));
COMMENT ON COLUMN public.recibos.deuda_perdida_en IS
  'La admin renunció a cobrarlo para ejecutar el olvido de quien lo pidió (dar_deuda_por_perdida, 20261212120000). El recibo no cambia: estado, importe y remesa siguen.';

-- Solo la pone `dar_deuda_por_perdida` (marcador con la petición) y solo la quita la vuelta atrás
-- de esa confirmación (marcador `deshacer:` con la petición). Para todos, también service_role.
CREATE FUNCTION public.recibos_deuda_perdida_validar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_marca text := COALESCE(current_setting('app.deuda_perdida', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.deuda_perdida_en IS NOT NULL OR NEW.deuda_perdida_solicitud_id IS NOT NULL THEN
      RAISE EXCEPTION 'la deuda se da por perdida con dar_deuda_por_perdida'
        USING ERRCODE = 'P0001', HINT = 'deuda_por_funcion';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.deuda_perdida_en IS NOT DISTINCT FROM OLD.deuda_perdida_en
     AND NEW.deuda_perdida_por IS NOT DISTINCT FROM OLD.deuda_perdida_por
     AND NEW.deuda_perdida_solicitud_id IS NOT DISTINCT FROM OLD.deuda_perdida_solicitud_id THEN
    RETURN NEW;
  END IF;
  IF OLD.deuda_perdida_en IS NULL AND NEW.deuda_perdida_solicitud_id IS NOT NULL
     AND v_marca = NEW.deuda_perdida_solicitud_id::text THEN
    RETURN NEW;
  END IF;
  IF OLD.deuda_perdida_en IS NOT NULL AND NEW.deuda_perdida_en IS NULL
     AND v_marca = 'deshacer:' || OLD.deuda_perdida_solicitud_id::text THEN
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.recibos_deuda_perdida_validar() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER recibos_deuda_perdida_validar
  BEFORE INSERT OR UPDATE ON public.recibos
  FOR EACH ROW EXECUTE FUNCTION public.recibos_deuda_perdida_validar();

-- Una deuda a la que se renunció no se cobra por banco.
CREATE FUNCTION public.recibos_remesa_sin_deuda_perdida()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF false AND EXISTS (SELECT 1 FROM public.recibos r WHERE r.id = NEW.recibo_id AND r.deuda_perdida_en IS NOT NULL) THEN
    RAISE EXCEPTION 'la admin renunció a cobrar este recibo: no entra en una remesa'
      USING ERRCODE = 'P0001', HINT = 'deuda_perdida';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.recibos_remesa_sin_deuda_perdida() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER recibos_remesa_sin_deuda_perdida
  BEFORE INSERT OR UPDATE OF recibo_id ON public.recibos_remesa
  FOR EACH ROW EXECUTE FUNCTION public.recibos_remesa_sin_deuda_perdida();

-- ---- 2. Los recibos que bloquean el olvido, en un solo sitio ----
-- Los de `olvido_bloqueos` (20261206120000): un borrador o un pendiente con importe, o un devuelto
-- sin resolver, de esas familias en el centro. Sin los de deuda dada por perdida.
CREATE FUNCTION privado.recibos_pendientes_olvido(p_familias uuid[], p_centro_id uuid)
RETURNS SETOF public.recibos
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT r.* FROM public.recibos r
   WHERE r.familia_id = ANY (p_familias) AND r.centro_id = p_centro_id AND r.deleted_at IS NULL
     AND r.deuda_perdida_en IS NULL
     AND ((r.estado IN ('borrador', 'pendiente_procesar') AND r.total_centimos > 0)
       OR (r.estado = 'devuelto' AND r.devolucion_salida IS NULL));
$function$;
REVOKE ALL ON FUNCTION privado.recibos_pendientes_olvido(uuid[], uuid) FROM PUBLIC, anon, authenticated;

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
  v_retenido text;
BEGIN
  -- Retención (PR-8): con un procedimiento abierto el olvido espera, también el que pide el
  -- interesado (art. 17.3.e). La familia ve que está retenida y por qué tipo de motivo.
  SELECT r.motivo_tipo INTO v_retenido FROM public.retenciones r
   WHERE r.centro_id = p_centro_id AND r.sujeto_tipo = p_sujeto_tipo AND r.sujeto_id = p_sujeto_id
     AND r.quitada_en IS NULL;
  IF FOUND THEN
    v_bloqueos := v_bloqueos || jsonb_build_object('codigo', 'retenido', 'n', 1, 'motivo_tipo', v_retenido);
  END IF;

  IF p_sujeto_tipo = 'nino' THEN
    SELECT count(*) INTO v_n FROM public.matriculas m
     WHERE m.nino_id = p_sujeto_id AND m.deleted_at IS NULL AND m.estado <> 'baja';
    IF v_n > 0 THEN
      v_bloqueos := v_bloqueos || jsonb_build_object('codigo', 'matricula_viva', 'n', v_n);
    END IF;

    -- Los recibos de su familia no bloquean: la deuda es de la familia, y sus datos se quedan.
    SELECT count(*) INTO v_n
      FROM privado.recibos_pendientes_olvido(
             ARRAY(SELECT n.familia_id FROM public.ninos n WHERE n.id = p_sujeto_id), p_centro_id);
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

    -- Sin la deuda que la admin dio por perdida (20261212120000).
    SELECT count(*) INTO v_n FROM privado.recibos_pendientes_olvido(v_familias, p_centro_id);
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

-- El dinero vivo de la familia, sin la deuda dada por perdida.
CREATE OR REPLACE FUNCTION privado.familia_dinero_pendiente(p_familia_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.recibos r
                  WHERE r.familia_id = p_familia_id AND r.deleted_at IS NULL
                    AND r.deuda_perdida_en IS NULL
                    AND ((r.estado = 'pendiente_procesar' AND r.total_centimos > 0)
                         OR (r.estado = 'devuelto' AND r.devolucion_salida IS NULL)
                         OR (r.estado = 'borrador'
                             AND EXISTS (SELECT 1 FROM public.lineas_recibo l
                                          WHERE l.recibo_id = r.id
                                            AND (l.arrastre_de_recibo_id IS NOT NULL
                                                 OR l.sobrante_de_desborde_id IS NOT NULL)))))
      OR EXISTS (SELECT 1 FROM public.beca_comedor_desborde d
                  WHERE d.familia_id = p_familia_id AND d.estado = 'pendiente')
      OR EXISTS (SELECT 1 FROM public.beca_comedor_transferencia t
                  WHERE t.familia_id = p_familia_id AND t.estado = 'pendiente');
$function$;

-- ---- 3. Lo que falta y la deuda de cada petición ----
-- Lo que falta, como lo mira la purga: la petición por plazo, con `bloqueos_por_plazo`; las demás,
-- con `olvido_bloqueos`. Para las pendientes y las confirmadas sin purgar.
CREATE FUNCTION privado.olvido_falta(p_solicitud_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT CASE WHEN s.estado = 'pendiente' THEN
           CASE WHEN s.por_plazo
                THEN jsonb_build_object('bloqueos', privado.bloqueos_por_plazo(s.sujeto_id, s.centro_id),
                                        'avisos', '[]'::jsonb)
                ELSE privado.olvido_bloqueos(s.sujeto_tipo, s.sujeto_id, s.centro_id) END
         END
    FROM public.olvido_solicitudes s WHERE s.id = p_solicitud_id;
$function$;
REVOKE ALL ON FUNCTION privado.olvido_falta(uuid) FROM PUBLIC, anon, authenticated;

-- La deuda de la familia de quien pide el olvido (un tutor, petición pendiente y no por plazo):
-- los recibos, el importe (total, y los gastos de una devolución) y si se puede dar por perdida.
-- NULL si la petición no es de las que la tienen.
CREATE FUNCTION privado.deuda_olvido(p_solicitud_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $function$
DECLARE
  s          public.olvido_solicitudes%ROWTYPE;
  v_familias uuid[];
  v_recibos  uuid[];
  v_centimos bigint;
  v_borrador integer;
  v_remesa   integer;
  v_otros    jsonb;
BEGIN
  SELECT * INTO s FROM public.olvido_solicitudes WHERE id = p_solicitud_id;
  IF NOT FOUND OR s.sujeto_tipo <> 'usuario' OR s.estado <> 'pendiente' OR s.por_plazo THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(array_agg(DISTINCT ft.familia_id), '{}') INTO v_familias
    FROM public.familia_tutores ft
   WHERE ft.usuario_id = s.sujeto_id AND ft.centro_id = s.centro_id AND ft.deleted_at IS NULL;
  SELECT coalesce(array_agg(r.id ORDER BY r.anio, r.mes, r.id), '{}'),
         coalesce(sum(r.total_centimos + CASE WHEN r.estado = 'devuelto'
                                              THEN coalesce(r.devolucion_gastos_centimos, 0) ELSE 0 END), 0),
         count(*) FILTER (WHERE r.estado = 'borrador'),
         count(*) FILTER (WHERE public.recibo_en_remesa(r.id))
    INTO v_recibos, v_centimos, v_borrador, v_remesa
    FROM privado.recibos_pendientes_olvido(v_familias, s.centro_id) r;
  IF cardinality(v_recibos) = 0 THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(jsonb_agg(b), '[]'::jsonb) INTO v_otros
    FROM jsonb_array_elements(privado.olvido_bloqueos(s.sujeto_tipo, s.sujeto_id, s.centro_id) -> 'bloqueos') b
   WHERE b->>'codigo' <> 'recibos_pendientes';
  RETURN jsonb_build_object(
    'recibos', to_jsonb(v_recibos),
    'n', cardinality(v_recibos),
    'centimos', v_centimos,
    'perdible', jsonb_array_length(v_otros) = 0 AND v_borrador = 0 AND v_remesa = 0,
    'no_perdible', CASE WHEN jsonb_array_length(v_otros) > 0 THEN 'otros_bloqueos'
                        WHEN v_borrador > 0 THEN 'recibo_borrador'
                        WHEN v_remesa > 0 THEN 'recibo_en_remesa' END);
END;
$function$;
REVOKE ALL ON FUNCTION privado.deuda_olvido(uuid) FROM PUBLIC, anon, authenticated;

DROP FUNCTION public.peticiones_olvido_centro(uuid);
CREATE FUNCTION public.peticiones_olvido_centro(p_centro_id uuid)
 RETURNS TABLE(id uuid, sujeto_tipo olvido_sujeto_tipo, sujeto_id uuid, sujeto_nombre text, solicitado_por_nombre text, pedida_por_centro boolean, solicitado_en timestamp with time zone, estado olvido_estado, inmediato boolean, confirmada_en timestamp with time zone, gracia_hasta timestamp with time zone, rechazada_en timestamp with time zone, motivo_rechazo text, retirada_en timestamp with time zone, nota_centro text, purgado_en timestamp with time zone, falta jsonb, por_plazo boolean, deuda jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT privado.es_responsable(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado a ejercer el olvido en este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT s.id, s.sujeto_tipo, s.sujeto_id,
         CASE WHEN s.sujeto_tipo = 'nino'
              THEN (SELECT btrim(n.nombre || ' ' || coalesce(n.apellidos, '')) FROM public.ninos n WHERE n.id = s.sujeto_id)
              ELSE (SELECT u.nombre_completo FROM public.usuarios u WHERE u.id = s.sujeto_id) END,
         (SELECT u.nombre_completo FROM public.usuarios u WHERE u.id = s.solicitado_por),
         s.pedida_por_centro, s.solicitado_en, s.estado, s.inmediato, s.confirmada_en,
         s.gracia_hasta, s.rechazada_en, s.motivo_rechazo, s.retirada_en, s.nota_centro,
         s.purgado_en,
         -- PR-B1: también de las confirmadas sin purgar, como lo mira la purga.
         privado.olvido_falta(s.id),
         -- Retención (PR-8, pieza 2): la etiqueta «por plazo».
         s.por_plazo,
         -- PR-B1: la deuda de la familia del tutor, y si se puede dar por perdida.
         privado.deuda_olvido(s.id)
    FROM public.olvido_solicitudes s
   WHERE s.centro_id = p_centro_id
     AND ((s.estado IN ('pendiente', 'confirmada') AND s.purgado_en IS NULL)
          OR coalesce(s.purgado_en, s.rechazada_en, s.retirada_en) >= now() - interval '90 days')
   ORDER BY s.solicitado_en;
END;
$function$;
REVOKE ALL ON FUNCTION public.peticiones_olvido_centro(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.peticiones_olvido_centro(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mis_peticiones_olvido()
 RETURNS TABLE(id uuid, sujeto_tipo olvido_sujeto_tipo, sujeto_id uuid, sujeto_nombre text, centro_id uuid, centro_nombre text, pedida_por_mi boolean, pedida_por_centro boolean, solicitado_en timestamp with time zone, estado olvido_estado, inmediato boolean, confirmada_en timestamp with time zone, gracia_hasta timestamp with time zone, rechazada_en timestamp with time zone, motivo_rechazo text, retirada_en timestamp with time zone, nota_centro text, purgado_en timestamp with time zone, falta jsonb, puede_retirar boolean, por_plazo boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
         -- PR-B1: también de las confirmadas sin purgar, como lo mira la purga.
         privado.olvido_falta(s.id),
         s.estado = 'pendiente',
         -- Retención (PR-8, pieza 2): la etiqueta «por plazo».
         s.por_plazo
    FROM public.olvido_solicitudes s
   WHERE s.solicitado_por = v_uid
      OR (s.sujeto_tipo = 'usuario' AND s.sujeto_id = v_uid)
      OR (s.sujeto_tipo = 'nino' AND privado.es_tutor_legal_olvido(s.sujeto_id, v_uid))
      OR (s.sujeto_tipo = 'nino' AND s.purgado_en IS NOT NULL AND v_uid = ANY (s.tutores_legales))
   ORDER BY s.solicitado_en DESC;
END;
$function$;

-- ---- 4. El botón y su vuelta atrás ----
-- Renunciar a la deuda y confirmar el olvido de quien lo pidió, en una transacción. Solo la admin.
CREATE FUNCTION public.dar_deuda_por_perdida(p_solicitud_id uuid, p_centimos bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  s        public.olvido_solicitudes%ROWTYPE;
  v_deuda  jsonb;
  v_n      integer;
  v_gracia timestamptz;
BEGIN
  SELECT * INTO s FROM public.olvido_solicitudes WHERE id = p_solicitud_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'petición no encontrada' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_uid IS NULL OR NOT privado.es_titular(s.centro_id) THEN
    RAISE EXCEPTION 'solo la admin del centro da una deuda por perdida'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_deuda := privado.deuda_olvido(s.id);
  IF v_deuda IS NULL THEN
    RAISE EXCEPTION 'esta petición no espera por una deuda'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'sin_deuda';
  END IF;
  IF NOT (v_deuda ->> 'perdible')::boolean THEN
    RAISE EXCEPTION 'la deuda no se puede dar por perdida: %', v_deuda ->> 'no_perdible'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = v_deuda ->> 'no_perdible';
  END IF;
  IF p_centimos IS DISTINCT FROM (v_deuda ->> 'centimos')::bigint THEN
    RAISE EXCEPTION 'la deuda ha cambiado: ahora son % céntimos', v_deuda ->> 'centimos'
      USING ERRCODE = 'serialization_failure', HINT = 'importe_cambiado';
  END IF;

  PERFORM set_config('app.deuda_perdida', s.id::text, true);
  UPDATE public.recibos
     SET deuda_perdida_en = now(), deuda_perdida_por = v_uid, deuda_perdida_solicitud_id = s.id
   WHERE id IN (SELECT jsonb_array_elements_text(v_deuda -> 'recibos')::uuid);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('app.deuda_perdida', '', true);
  IF v_n <> (v_deuda ->> 'n')::integer THEN
    RAISE EXCEPTION 'esperaba marcar % recibos y se marcaron %', v_deuda ->> 'n', v_n;
  END IF;

  -- La confirmación de siempre: sin bloqueos ya, con sus 7 días de gracia para deshacerla.
  v_gracia := public.confirmar_peticion_olvido(s.id);
  RETURN jsonb_build_object('recibos', v_n, 'centimos', (v_deuda ->> 'centimos')::bigint,
                            'gracia_hasta', v_gracia);
END;
$function$;
REVOKE ALL ON FUNCTION public.dar_deuda_por_perdida(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dar_deuda_por_perdida(uuid, bigint) TO authenticated;

-- La vuelta atrás de una confirmación (deshacer en la gracia, o una retención) devuelve también la
-- deuda a la que se renunció para ella: sin olvido, no hay renuncia.
CREATE OR REPLACE FUNCTION privado.olvido_volver_a_pendiente(p_solicitud_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  s public.olvido_solicitudes%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.olvido_solicitudes WHERE id = p_solicitud_id FOR UPDATE;
  IF NOT FOUND OR s.estado <> 'confirmada' OR s.purgado_en IS NOT NULL THEN
    RETURN;
  END IF;

  IF s.sujeto_tipo = 'nino' THEN
    UPDATE public.ninos
       SET deleted_at = (s.estado_previo ->> 'deleted_at')::timestamptz,
           deleted_reason = (s.estado_previo ->> 'deleted_reason')::public.motivo_borrado
     WHERE id = s.sujeto_id AND deleted_reason = 'solicitud_olvido';
  ELSE
    -- Los roles que retiró esta confirmación (mismo instante), salvo si ya tiene uno vivo igual.
    UPDATE public.roles_usuario r
       SET deleted_at = NULL, deleted_reason = NULL
     WHERE r.usuario_id = s.sujeto_id AND r.centro_id = s.centro_id
       AND r.deleted_reason = 'solicitud_olvido' AND r.deleted_at = s.confirmada_en
       AND NOT EXISTS (SELECT 1 FROM public.roles_usuario v
                        WHERE v.usuario_id = r.usuario_id AND v.centro_id = r.centro_id
                          AND v.rol = r.rol AND v.deleted_at IS NULL);
    UPDATE public.usuarios
       SET deleted_at = (s.estado_previo ->> 'usuario_deleted_at')::timestamptz
     WHERE id = s.sujeto_id;
    -- PR-B1: la deuda a la que se renunció para este olvido vuelve a cobrarse.
    PERFORM set_config('app.deuda_perdida', 'deshacer:' || s.id::text, true);
    UPDATE public.recibos
       SET deuda_perdida_en = NULL, deuda_perdida_por = NULL, deuda_perdida_solicitud_id = NULL
     WHERE false AND deuda_perdida_solicitud_id = s.id;
    PERFORM set_config('app.deuda_perdida', '', true);
  END IF;

  UPDATE public.olvido_solicitudes
     SET estado = 'pendiente', confirmada_en = NULL, confirmada_por = NULL,
         gracia_hasta = NULL, estado_previo = NULL
   WHERE id = p_solicitud_id;
END;
$function$;

