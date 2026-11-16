-- =============================================================================
-- Fase 8b · la petición de servicios del alta (1 de 2: aditiva, ANTES del despliegue)
-- Spec: docs/specs/altas-serie.md, «Fase 8: servicios en el alta» y «8b».
--
-- Decisiones (2026-10-29, y 2026-11-14 de Jose y del responsable):
--   · Una fila por cada servicio que el centro tenga en Cuotas, con No / Todos los meses / Días
--     sueltos. Es una PETICIÓN: la familia nunca escribe en la facturación. La petición guarda QUÉ
--     concepto se pide (un centro puede tener dos mensuales del mismo servicio), y se ofrece solo
--     lo que existe.
--   · Dirección la ve al validar y la puede corregir; validar aplica las mensuales, desde el día 1
--     del mes siguiente al de la incorporación (el mes de entrada se cobra por días, por el parte).
--     No le bloquea la validación.
--   · «No» y «Días sueltos» no cambian el cobro del día suelto: si el niño se queda, come y se cobra.
--   · Después del alta, por la cola; una mensual nueva empieza el día 1 del mes siguiente a
--     aplicarla, y una que se quita termina el último día del mes en curso.
--   · La profe ve en su pase quién tiene la mensual. La petición sale en el export del art. 15, se
--     purga con el niño y no es retroactiva.
--
-- Aquí: la tabla y sus funciones; validar_alta aplica las mensuales; el pase, el export, la purga y
-- la auditoría la conocen. Que contestar sea obligatorio para cerrar el alta va en la segunda
-- (20270122130000), después del despliegue: con la app de antes, la familia no ve el paso y no
-- podría cerrar.
--
-- Las funciones que cambian se generan con un guion desde su cuerpo de main (md5 normalizado igual
-- al vivo, con la guarda). La aplica el responsable por SQL Editor, copiando el fichero de la rama.
-- Sin COMMIT ni BEGIN. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_esperado text;
  v_firma text;
BEGIN
  -- El prorrateo, aplicado y registrado: validar_alta y el motor de aquí cuentan con él.
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20270121120000') THEN
    RAISE EXCEPTION 'falta 20270121120000 (el prorrateo) en el registro';
  END IF;
  FOR v_firma, v_esperado IN VALUES
    ('public.validar_alta(uuid,date)', '00af03e8d2dd4ff27eea606932ad7055'),
    ('public.listado_pase_servicios(uuid)', '3765ccbfa83093b64882aac64eee6918'),
    ('privado.purgar_nino(uuid)', 'a9adabb7db9ae26485e04a5c3d5b9805'),
    ('public.export_datos_sujeto(text,uuid)', 'ff800fe9a8916a8afc7bca7eece1d4d1'),
    ('public.audit_trigger_function()', '1586db5ca71338478b8be55dfe320115')
  LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_firma);
    IF v_md5 IS DISTINCT FROM v_esperado THEN
      RAISE EXCEPTION '% no es la de antes: %', v_firma, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;
  IF to_regclass('public.peticion_servicio') IS NOT NULL THEN
    RAISE EXCEPTION 'peticion_servicio ya existe';
  END IF;
  IF to_regprocedure('public.alta_validada_de_nino(uuid)') IS NULL OR to_regprocedure('public.hoy_madrid()') IS NULL THEN
    RAISE EXCEPTION 'faltan alta_validada_de_nino o hoy_madrid';
  END IF;
END $guarda$;

-- ---- 1. La petición: una fila por niño y servicio ----
CREATE TABLE public.peticion_servicio (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Lo pone el trigger desde el niño: quien escribe no lo elige.
  centro_id   uuid NOT NULL REFERENCES public.centros(id) ON DELETE CASCADE,
  -- Anular un alta sin terminar borra al niño, y con él su petición.
  nino_id     uuid NOT NULL REFERENCES public.ninos(id) ON DELETE CASCADE,
  servicio    public.servicio_diario NOT NULL,
  respuesta   text NOT NULL CHECK (respuesta IN ('no', 'mensual', 'dias_sueltos')),
  -- QUÉ concepto se pide (un centro puede tener dos mensuales del mismo servicio): el mensual o el
  -- diario de ese servicio. «No» no pide ninguno.
  concepto_id uuid NULL REFERENCES public.conceptos_cobro(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT peticion_servicio_una_por_servicio UNIQUE (nino_id, servicio),
  CONSTRAINT peticion_servicio_concepto_si_pide CHECK ((respuesta = 'no') = (concepto_id IS NULL))
);
CREATE INDEX idx_peticion_servicio_centro ON public.peticion_servicio (centro_id);
CREATE INDEX idx_peticion_servicio_concepto ON public.peticion_servicio (concepto_id) WHERE concepto_id IS NOT NULL;

COMMENT ON TABLE public.peticion_servicio IS
  'Lo que la familia pide en el alta para cada servicio que el centro tiene en Cuotas (fase 8b, '
  '20270122120000): no, todos los meses (un concepto mensual) o días sueltos (el diario). Es una '
  'PETICIÓN: no es una asignación y no cobra nada. Dirección la ve al validar, la puede corregir, y '
  'validar aplica las mensuales (desde el día 1 del mes siguiente al de la incorporación). Después '
  'del alta, los cambios van por la cola (cambios_pendientes, entidad peticion_servicios). Solo se '
  'escribe por funciones: guardar_peticion_servicios y aplicar_peticion_servicios.';
COMMENT ON COLUMN public.peticion_servicio.respuesta IS
  'no | mensual | dias_sueltos. «No» y «días sueltos» no cambian el cobro del día suelto: si el '
  'niño se queda, come y se cobra por el parte (decisión de Jose, 2026-11-14).';

-- Coherencia: el centro sale del niño, y el concepto es de ese centro, de ese servicio y del tipo
-- de la respuesta (mensual o diario). Que siga ofreciéndose lo miran las funciones al escribir: una
-- fila vieja no se rompe porque el centro desactive el concepto después.
CREATE FUNCTION privado.peticion_servicio_coherente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ok boolean;
BEGIN
  NEW.centro_id := (SELECT n.centro_id FROM public.ninos n WHERE n.id = NEW.nino_id);
  IF NEW.concepto_id IS NOT NULL THEN
    SELECT c.centro_id = NEW.centro_id AND c.servicio = NEW.servicio
           AND c.tipo_concepto = CASE NEW.respuesta WHEN 'mensual' THEN 'mensual'::public.tipo_concepto
                                                    ELSE 'diario'::public.tipo_concepto END
      INTO v_ok
      FROM public.conceptos_cobro c WHERE c.id = NEW.concepto_id;
    IF v_ok IS NOT TRUE THEN
      RAISE EXCEPTION 'la petición no casa con su concepto (centro, servicio o tipo)'
        USING ERRCODE = 'check_violation', HINT = 'opcion_no_ofrecida';
    END IF;
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION privado.peticion_servicio_coherente() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER peticion_servicio_coherente
  BEFORE INSERT OR UPDATE ON public.peticion_servicio
  FOR EACH ROW EXECUTE FUNCTION privado.peticion_servicio_coherente();
-- La coherencia de centro de la casa (`20270108120000`, «Una fila y lo que nombra, del mismo centro»):
-- la misma comprobación que genera aquella migración para cada par, escrita aquí con sus dos
-- columnas. `zz_` para correr después de `peticion_servicio_coherente`, que pone el centro.
CREATE FUNCTION privado.peticion_servicio_centro_coherente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.concepto_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.conceptos_cobro r
     WHERE r.id = NEW.concepto_id AND r.centro_id IS DISTINCT FROM NEW.centro_id) THEN
    RAISE EXCEPTION 'public.peticion_servicio.concepto_id no es del centro de la fila'
      USING ERRCODE = '23514', HINT = 'centro_ajeno';
  END IF;
  IF NEW.nino_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.ninos r
     WHERE r.id = NEW.nino_id AND r.centro_id IS DISTINCT FROM NEW.centro_id) THEN
    RAISE EXCEPTION 'public.peticion_servicio.nino_id no es del centro de la fila'
      USING ERRCODE = '23514', HINT = 'centro_ajeno';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION privado.peticion_servicio_centro_coherente() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER zz_centro_coherente
  BEFORE INSERT OR UPDATE OF centro_id, concepto_id, nino_id ON public.peticion_servicio
  FOR EACH ROW EXECUTE FUNCTION privado.peticion_servicio_centro_coherente();
CREATE TRIGGER set_updated_at_peticion_servicio
  BEFORE UPDATE ON public.peticion_servicio
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER audit_peticion_servicio
  AFTER INSERT OR UPDATE OR DELETE ON public.peticion_servicio
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

-- ---- 2. Quién la lee. Nadie la escribe con su sesión ----
ALTER TABLE public.peticion_servicio ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.peticion_servicio FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.peticion_servicio TO authenticated;
GRANT SELECT ON public.peticion_servicio TO service_role;

-- Los tutores legales del niño y la Dirección del centro. La profe la ve en su pase
-- (listado_pase_servicios), no aquí.
CREATE POLICY peticion_servicio_select ON public.peticion_servicio
  FOR SELECT TO authenticated
  USING (public.es_tutor_legal_de(nino_id) OR public.es_admin(centro_id));

-- ---- 3. Lo que el centro ofrece a un niño ----
-- Los conceptos de servicio que se pueden pedir: activos, de cobro, fijos, por niño; mensual y
-- manual (uno automático lo tendría todo el mundo), o diario (siempre automático). Con el precio de
-- ese niño, con la misma precedencia que el motor sin override: la tarifa de su año, si el concepto
-- la tiene; si no, la base.
CREATE FUNCTION privado.servicios_ofrecidos(p_nino_id uuid)
 RETURNS TABLE(concepto_id uuid, servicio public.servicio_diario, tipo_concepto public.tipo_concepto,
               nombre text, importe_centimos integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT c.id, c.servicio, c.tipo_concepto, c.nombre::text,
         COALESCE(CASE WHEN c.tarifa_por_anio_nacimiento
                       THEN (SELECT t.importe_centimos FROM public.tarifa_concepto_anio t
                              WHERE t.concepto_id = c.id
                                AND t.anio_nacimiento = EXTRACT(YEAR FROM n.fecha_nacimiento)::int)
                  END,
                  c.importe_centimos)
    FROM public.ninos n
    JOIN public.conceptos_cobro c ON c.centro_id = n.centro_id
   WHERE n.id = p_nino_id
     AND c.activo AND c.deleted_at IS NULL
     AND c.servicio IS NOT NULL AND c.signo = 1 AND c.ambito = 'nino' AND c.tipo_valor = 'fijo'
     AND ((c.tipo_concepto = 'mensual' AND c.aplicacion = 'manual') OR c.tipo_concepto = 'diario')
$function$;
REVOKE ALL ON FUNCTION privado.servicios_ofrecidos(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Para la pantalla (el alta de la familia y la validación de Dirección): la familia no lee el
-- catálogo de conceptos (su RLS es de Dirección).
CREATE FUNCTION public.servicios_alta(p_nino_id uuid)
 RETURNS TABLE(concepto_id uuid, servicio public.servicio_diario, tipo_concepto public.tipo_concepto,
               nombre text, importe_centimos integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_nino_id IS NULL
     OR NOT (public.es_tutor_legal_de(p_nino_id) OR public.es_admin(privado.centro_de_nino(p_nino_id))) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT o.concepto_id, o.servicio, o.tipo_concepto, o.nombre, o.importe_centimos
    FROM privado.servicios_ofrecidos(p_nino_id) o
   ORDER BY o.servicio, o.tipo_concepto, o.nombre, o.concepto_id;
END $function$;
REVOKE ALL ON FUNCTION public.servicios_alta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.servicios_alta(uuid) TO authenticated;

-- Los servicios que el centro ofrece al niño y que su petición no contesta. El cierre del alta los
-- exige (la segunda migración, 20270122130000).
CREATE FUNCTION privado.servicios_sin_contestar(p_nino_id uuid)
 RETURNS public.servicio_diario[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(DISTINCT o.servicio ORDER BY o.servicio), '{}')
    FROM privado.servicios_ofrecidos(p_nino_id) o
   WHERE NOT EXISTS (SELECT 1 FROM public.peticion_servicio p
                      WHERE p.nino_id = p_nino_id AND p.servicio = o.servicio)
$function$;
REVOKE ALL ON FUNCTION privado.servicios_sin_contestar(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Las respuestas, comprobadas contra lo que se ofrece HOY. Cada una, {servicio, respuesta,
-- concepto_id}; una por servicio; «no» sin concepto; las otras con un concepto ofrecido de ese
-- servicio y de su tipo. Devuelve las respuestas como filas.
CREATE FUNCTION privado.respuestas_servicio(p_nino_id uuid, p_respuestas jsonb)
 RETURNS TABLE(servicio public.servicio_diario, respuesta text, concepto_id uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  e jsonb;
BEGIN
  IF p_respuestas IS NULL OR jsonb_typeof(p_respuestas) <> 'array'
     OR jsonb_array_length(p_respuestas) NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'petición de servicios: lista vacía o no válida' USING ERRCODE = '22023';
  END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p_respuestas) x LOOP
    IF jsonb_typeof(e) <> 'object'
       OR (e ->> 'servicio') IS NULL
       OR (e ->> 'servicio') NOT IN (SELECT unnest(enum_range(NULL::public.servicio_diario))::text)
       OR (e ->> 'respuesta') IS NULL OR (e ->> 'respuesta') NOT IN ('no', 'mensual', 'dias_sueltos')
       OR ((e ->> 'respuesta') = 'no') <> (jsonb_typeof(e -> 'concepto_id') IS DISTINCT FROM 'string')
       OR ((e ->> 'concepto_id') IS NOT NULL
           AND (e ->> 'concepto_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
      RAISE EXCEPTION 'petición de servicios: respuesta mal formada' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT x ->> 'servicio') FROM jsonb_array_elements(p_respuestas) x)
     <> jsonb_array_length(p_respuestas) THEN
    RAISE EXCEPTION 'petición de servicios: servicios repetidos' USING ERRCODE = '22023';
  END IF;

  -- El servicio se ofrece, y el concepto pedido es una de sus opciones, del tipo de la respuesta.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_respuestas) x
     WHERE NOT EXISTS (SELECT 1 FROM privado.servicios_ofrecidos(p_nino_id) o
                        WHERE o.servicio::text = x ->> 'servicio')
        OR ((x ->> 'respuesta') <> 'no' AND NOT EXISTS (
              SELECT 1 FROM privado.servicios_ofrecidos(p_nino_id) o
               WHERE o.servicio::text = x ->> 'servicio'
                 AND o.concepto_id = (x ->> 'concepto_id')::uuid
                 AND o.tipo_concepto = CASE x ->> 'respuesta' WHEN 'mensual' THEN 'mensual'::public.tipo_concepto
                                                              ELSE 'diario'::public.tipo_concepto END))) THEN
    RAISE EXCEPTION 'petición de servicios: una opción que el centro no ofrece'
      USING ERRCODE = '22023', HINT = 'opcion_no_ofrecida';
  END IF;

  RETURN QUERY
  SELECT (x ->> 'servicio')::public.servicio_diario, x ->> 'respuesta', (x ->> 'concepto_id')::uuid
    FROM jsonb_array_elements(p_respuestas) x;
END $function$;
REVOKE ALL ON FUNCTION privado.respuestas_servicio(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Guarda las respuestas (las que vengan; los demás servicios no se tocan). Una fila que no cambia
-- no se reescribe: el audit_log no se llena de nada.
CREATE FUNCTION privado.escribir_respuestas_servicio(p_nino_id uuid, p_respuestas jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO public.peticion_servicio AS p (centro_id, nino_id, servicio, respuesta, concepto_id)
  SELECT privado.centro_de_nino(p_nino_id), p_nino_id, r.servicio, r.respuesta, r.concepto_id
    FROM privado.respuestas_servicio(p_nino_id, p_respuestas) r
   ORDER BY r.servicio
  ON CONFLICT (nino_id, servicio) DO UPDATE
     SET respuesta = EXCLUDED.respuesta, concepto_id = EXCLUDED.concepto_id
   WHERE p.respuesta IS DISTINCT FROM EXCLUDED.respuesta
      OR p.concepto_id IS DISTINCT FROM EXCLUDED.concepto_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $function$;
REVOKE ALL ON FUNCTION privado.escribir_respuestas_servicio(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- ---- 4. La familia (o Dirección, en el alta en papel) contesta, antes de validar ----
CREATE FUNCTION public.guardar_peticion_servicios(p_nino_id uuid, p_respuestas jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_nino_id IS NULL
     OR NOT (public.es_tutor_legal_de(p_nino_id) OR public.es_admin(privado.centro_de_nino(p_nino_id))) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  -- Con el alta validada, un cambio cambia lo que se cobra: va por la cola, que lo aplica al aprobar.
  IF public.alta_validada_de_nino(p_nino_id) THEN
    RAISE EXCEPTION 'el alta ya está validada: el cambio va por la cola'
      USING ERRCODE = 'P0001', HINT = 'alta_validada';
  END IF;
  RETURN privado.escribir_respuestas_servicio(p_nino_id, p_respuestas);
END $function$;
REVOKE ALL ON FUNCTION public.guardar_peticion_servicios(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_peticion_servicios(uuid, jsonb) TO authenticated;

-- ---- 5. Poner y quitar una mensual, con su vigencia ----
-- El día 1 del mes siguiente al de una fecha.
CREATE FUNCTION privado.mes_siguiente(p_dia date)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT (date_trunc('month', p_dia) + interval '1 month')::date
$function$;
REVOKE ALL ON FUNCTION privado.mes_siguiente(date) FROM PUBLIC, anon, authenticated, service_role;

-- La mensual del concepto, viva desde p_desde. Una sola asignación viva por concepto y niño
-- (idx_asignacion_concepto_unica):
--   · sin ninguna: se crea desde p_desde;
--   · abierta (sin fin): se queda; al validar (p_al_validar) el niño aún no ha venido, y un comienzo
--     anterior a p_desde se mueve a p_desde (el mes de entrada va por días, por el parte);
--   · terminada justo antes de p_desde, o después: se reabre (sin fin);
--   · terminada antes, con un hueco: se cierra (borrado lógico) y se crea otra. Si queda un recibo
--     en borrador de un mes de la vieja, se para: regenerarlo la perdería.
CREATE FUNCTION privado.poner_mensual(p_nino_id uuid, p_concepto_id uuid, p_desde date, p_al_validar boolean)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
  SELECT a.id, a.vigencia_desde, a.vigencia_hasta INTO r
    FROM public.asignacion_concepto a
   WHERE a.concepto_id = p_concepto_id AND a.nino_id = p_nino_id AND a.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.asignacion_concepto (centro_id, nino_id, concepto_id, origen, vigencia_desde)
      VALUES (privado.centro_de_nino(p_nino_id), p_nino_id, p_concepto_id, 'manual', p_desde);
    RETURN 'puesta';
  END IF;
  IF r.vigencia_hasta IS NULL THEN
    IF p_al_validar AND (r.vigencia_desde IS NULL OR r.vigencia_desde < p_desde) THEN
      UPDATE public.asignacion_concepto SET vigencia_desde = p_desde WHERE id = r.id;
      RETURN 'movida';
    END IF;
    RETURN 'ya_estaba';
  END IF;
  IF r.vigencia_hasta >= p_desde - 1 THEN
    UPDATE public.asignacion_concepto SET vigencia_hasta = NULL WHERE id = r.id;
    RETURN 'reabierta';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.recibos rc
     WHERE rc.familia_id = (SELECT n.familia_id FROM public.ninos n WHERE n.id = p_nino_id)
       AND rc.estado = 'borrador' AND rc.deleted_at IS NULL
       AND make_date(rc.anio, rc.mes, 1) <= r.vigencia_hasta
       AND (r.vigencia_desde IS NULL OR make_date(rc.anio, rc.mes, 1) >= date_trunc('month', r.vigencia_desde)::date)) THEN
    RAISE EXCEPTION 'la mensual anterior de este concepto tiene un recibo en borrador: confírmalo antes'
      USING ERRCODE = 'P0001', HINT = 'mensual_anterior_en_borrador';
  END IF;
  UPDATE public.asignacion_concepto SET deleted_at = now() WHERE id = r.id;
  INSERT INTO public.asignacion_concepto (centro_id, nino_id, concepto_id, origen, vigencia_desde)
    VALUES (privado.centro_de_nino(p_nino_id), p_nino_id, p_concepto_id, 'manual', p_desde);
  RETURN 'puesta';
END $function$;
REVOKE ALL ON FUNCTION privado.poner_mensual(uuid, uuid, date, boolean) FROM PUBLIC, anon, authenticated, service_role;

-- La mensual termina el último día de p_hasta; si aún no había empezado, se borra (borrado lógico).
CREATE FUNCTION privado.quitar_mensual(p_asignacion_id uuid, p_hasta date)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
  SELECT a.vigencia_desde, a.vigencia_hasta INTO r
    FROM public.asignacion_concepto a WHERE a.id = p_asignacion_id AND a.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'sin_cambio';
  END IF;
  IF r.vigencia_desde IS NOT NULL AND r.vigencia_desde > p_hasta THEN
    UPDATE public.asignacion_concepto SET deleted_at = now() WHERE id = p_asignacion_id;
    RETURN 'borrada';
  END IF;
  IF r.vigencia_hasta IS NOT NULL AND r.vigencia_hasta <= p_hasta THEN
    RETURN 'sin_cambio';
  END IF;
  UPDATE public.asignacion_concepto SET vigencia_hasta = p_hasta WHERE id = p_asignacion_id;
  RETURN 'terminada';
END $function$;
REVOKE ALL ON FUNCTION privado.quitar_mensual(uuid, date) FROM PUBLIC, anon, authenticated, service_role;

-- ---- 6. La cola: Dirección aprueba un cambio de la familia después del alta ----
-- Guarda las respuestas y cambia lo que se cobra: una mensual nueva, desde el día 1 del mes
-- siguiente a hoy (Madrid), y nunca antes del mes siguiente al de la incorporación; la que se quita
-- (otra respuesta, u otra mensual del mismo servicio), hasta el último día del mes en curso.
CREATE FUNCTION public.aplicar_peticion_servicios(p_nino_id uuid, p_respuestas jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hoy date := public.hoy_madrid();
  v_inicio date;
  v_fin date;
  v_n integer;
  r record;
  a record;
BEGIN
  IF p_nino_id IS NULL OR NOT public.es_admin(privado.centro_de_nino(p_nino_id)) THEN
    RAISE EXCEPTION 'no autorizado: solo Dirección del centro del niño' USING ERRCODE = '42501';
  END IF;
  IF NOT public.alta_validada_de_nino(p_nino_id) THEN
    RAISE EXCEPTION 'el alta no está validada: la petición se guarda en el alta'
      USING ERRCODE = 'P0001', HINT = 'alta_sin_validar';
  END IF;
  v_inicio := GREATEST(privado.mes_siguiente(v_hoy),
                       privado.mes_siguiente((SELECT n.fecha_incorporacion FROM public.ninos n WHERE n.id = p_nino_id)));
  v_fin := privado.mes_siguiente(v_hoy) - 1;

  v_n := privado.escribir_respuestas_servicio(p_nino_id, p_respuestas);

  FOR r IN SELECT * FROM privado.respuestas_servicio(p_nino_id, p_respuestas) ORDER BY 1 LOOP
    FOR a IN
      SELECT ac.id FROM public.asignacion_concepto ac
        JOIN public.conceptos_cobro c ON c.id = ac.concepto_id
       WHERE ac.nino_id = p_nino_id AND ac.deleted_at IS NULL
         AND c.servicio = r.servicio AND c.tipo_concepto = 'mensual'
         AND (r.respuesta <> 'mensual' OR ac.concepto_id <> r.concepto_id)
       ORDER BY ac.id
    LOOP
      PERFORM privado.quitar_mensual(a.id, v_fin);
    END LOOP;
    IF r.respuesta = 'mensual' THEN
      PERFORM privado.poner_mensual(p_nino_id, r.concepto_id, v_inicio, false);
    END IF;
  END LOOP;
  RETURN v_n;
END $function$;
REVOKE ALL ON FUNCTION public.aplicar_peticion_servicios(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aplicar_peticion_servicios(uuid, jsonb) TO authenticated;

-- ---- 7. Validar el alta aplica las mensuales pedidas ----
CREATE OR REPLACE FUNCTION public.validar_alta(p_matricula_id uuid, p_fecha_incorporacion date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- Fase 8a. Dirección valida un alta terminada por la familia (matrícula 'lista' → 'activa') y dice
-- qué día empieza a venir el niño. Las dos cosas a la vez, o ninguna. Devuelve la matrícula, o NULL
-- si no estaba 'lista' (ya activa, a medias o borrada): el mismo «0 filas» de antes.
DECLARE
  v_centro uuid;
  v_nino uuid;
  v_id uuid;
  r record;
BEGIN
  SELECT n.centro_id, m.nino_id INTO v_centro, v_nino
    FROM public.matriculas m JOIN public.ninos n ON n.id = m.nino_id
   WHERE m.id = p_matricula_id;
  IF v_centro IS NULL OR NOT public.es_admin(v_centro) THEN
    RAISE EXCEPTION 'no autorizado: solo Dirección del centro del niño' USING ERRCODE = '42501';
  END IF;
  IF p_fecha_incorporacion IS NULL THEN
    RAISE EXCEPTION 'falta la fecha de incorporación' USING ERRCODE = 'null_value_not_allowed',
      HINT = 'falta_fecha_incorporacion';
  END IF;

  SELECT m.id INTO v_id FROM public.matriculas m
   WHERE m.id = p_matricula_id AND m.estado = 'lista' AND m.deleted_at IS NULL AND m.fecha_baja IS NULL
   FOR UPDATE;
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.ninos SET fecha_incorporacion = p_fecha_incorporacion WHERE id = v_nino;
  UPDATE public.matriculas SET estado = 'activa' WHERE id = v_id;

  -- Fase 8b: las mensuales que pide la petición (ya corregida por Dirección, si la corrigió), desde
  -- el día 1 del mes siguiente al de la incorporación: el mes de entrada se cobra por días, por el
  -- parte. «No» y «días sueltos» no tocan nada. Una petición sin contestar no bloquea: Dirección ya
  -- la ha visto en pantalla. Un concepto que el centro ya no ofrece no se aplica.
  FOR r IN
    SELECT p.concepto_id FROM public.peticion_servicio p
     WHERE p.nino_id = v_nino AND p.respuesta = 'mensual'
       AND EXISTS (SELECT 1 FROM privado.servicios_ofrecidos(v_nino) o
                    WHERE o.concepto_id = p.concepto_id AND o.tipo_concepto = 'mensual')
     ORDER BY p.servicio
  LOOP
    PERFORM privado.poner_mensual(v_nino, r.concepto_id, privado.mes_siguiente(p_fecha_incorporacion), true);
  END LOOP;
  RETURN v_id;
END $function$;

-- ---- 8. El pase de la profe: quién tiene la mensual, y qué pidió la familia ----
DROP FUNCTION public.listado_pase_servicios(uuid);
CREATE FUNCTION public.listado_pase_servicios(p_centro_id uuid, p_fecha date DEFAULT NULL)
 RETURNS TABLE(nino_id uuid, nombre text, apellidos text, aula_id uuid, aula_nombre text,
               mensuales public.servicio_diario[], pedidos jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- PR-12: el listado único del pase de servicios (nombre y clase de todos los niños del centro).
-- Fase 8b: con el día del pase (sin él, hoy en Madrid), los servicios de los que el niño tiene la
-- mensual vigente ese día (la de verdad, la que se cobra: las mismas condiciones que el motor) y lo
-- que la familia pidió en el alta (servicio → no | mensual | dias_sueltos). Ninguna de las dos cosas
-- es una puerta: si el niño se queda, se apunta y se cobra.
DECLARE
  v_fecha date := COALESCE(p_fecha, public.hoy_madrid());
BEGIN
  IF p_centro_id IS NULL
     OR NOT (public.es_admin(p_centro_id) OR public.es_profe_en_centro(p_centro_id)) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT n.id, n.nombre::text, n.apellidos::text, a.id, a.nombre::text,
         -- COALESCE: un ARRAY(…) nunca es NULL, pero así lo demuestra la regla de la casa
         -- (`src/test/tipos/nulabilidad.ts`), sin enseñarle a leer una forma nueva.
         COALESCE(ARRAY(SELECT DISTINCT c.servicio
                 FROM public.asignacion_concepto ac
                 JOIN public.conceptos_cobro c ON c.id = ac.concepto_id
                WHERE ac.nino_id = n.id AND ac.deleted_at IS NULL
                  AND c.deleted_at IS NULL AND c.activo AND c.signo = 1 AND c.tipo_valor = 'fijo'
                  AND c.tipo_concepto = 'mensual' AND c.servicio IS NOT NULL
                  AND (ac.vigencia_desde IS NULL OR ac.vigencia_desde <= v_fecha)
                  AND (ac.vigencia_hasta IS NULL OR ac.vigencia_hasta >= v_fecha)
                ORDER BY 1), '{}'),
         COALESCE((SELECT jsonb_object_agg(p.servicio, p.respuesta)
                     FROM public.peticion_servicio p WHERE p.nino_id = n.id), '{}'::jsonb)
    FROM public.ninos n
    JOIN public.matriculas m ON m.nino_id = n.id
    JOIN public.cursos_academicos c ON c.id = m.curso_academico_id
    JOIN public.aulas a ON a.id = m.aula_id
   WHERE n.centro_id = p_centro_id
     AND n.deleted_at IS NULL
     AND c.centro_id = p_centro_id
     AND c.estado = 'activo'
     AND m.estado = 'activa' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
   ORDER BY a.nombre, n.apellidos, n.nombre, n.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.listado_pase_servicios(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listado_pase_servicios(uuid, date) TO authenticated;

-- ---- 9. El export art. 15 del niño lleva su petición ----
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
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'actualizado_en', s.updated_at,
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
                 -- 2c (2026-11-02, columnas-export.ts)
                 'tipo_personal_aula', i.tipo_personal_aula,
                 'enviada_en', i.created_at, 'expira_en', i.expires_at,
                 'aceptada_en', i.accepted_at, 'rechazada_en', i.rejected_at)
               ORDER BY i.created_at)
          FROM public.invitaciones i
         WHERE v_email IS NOT NULL
           AND lower(i.email) = lower(v_email)
           AND (v_self OR privado.es_responsable(i.centro_id))), '[]'::jsonb),

      'lista_espera_contacto', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', le.created_at, 'actualizado_en', le.updated_at,
                 'telefono_tutor', le.telefono_tutor, 'email_tutor', le.email_tutor,
                 -- 2c (2026-11-02, columnas-export.ts): el prospecto entero, nota incluida
                 'nombre_nino', le.nombre_nino, 'apellidos_nino', le.apellidos_nino,
                 'fecha_nacimiento', le.fecha_nacimiento, 'nota', le.nota,
                 'posicion', le.posicion, 'estado', le.estado, 'curso', ca.nombre,
                 'descartado_en', le.descartado_at)
               ORDER BY le.created_at)
          FROM public.lista_espera le
          LEFT JOIN public.cursos_academicos ca ON ca.id = le.curso_academico_id
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
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', o.created_at,
                 -- 2c (2026-11-02, columnas-export.ts)
                 'por_plazo', o.por_plazo,
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
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', ft.created_at, 'actualizado_en', ft.updated_at, 'borrado_en', ft.deleted_at,
                 'familia_id', ft.familia_id, 'rol_familia', ft.rol_familia,
                 'nombre_completo', ft.nombre_completo, 'email', ft.email,
                 'direccion_calle', ft.direccion_calle, 'direccion_numero', ft.direccion_numero,
                 'direccion_cp', ft.direccion_cp, 'direccion_ciudad', ft.direccion_ciudad,
                 'dni_documento_path', ft.dni_documento_path,
                 -- Fase 6 (20270118120000): los cinco datos nuevos, de SU fila.
                 'telefono', ft.telefono, 'fecha_nacimiento', ft.fecha_nacimiento,
                 'dni_numero', ft.dni_numero, 'estudios', ft.estudios, 'empresa', ft.empresa)
               ORDER BY ft.created_at)
          FROM public.familia_tutores ft
          JOIN public.familias f ON f.id = ft.familia_id
         WHERE ft.usuario_id = p_sujeto_id AND ft.deleted_at IS NULL
           AND (v_self OR privado.es_responsable(f.centro_id))), '[]'::jsonb),

      -- Los mandatos que firmó él. Del IBAN, solo los 4 últimos dígitos.
      'mandatos_sepa', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'texto_hash', m.texto_hash, 'creado_en', m.created_at, 'actualizado_en', m.updated_at, 'borrado_en', m.deleted_at, 'familia_id', m.familia_id,
                 'identificador_mandato', m.identificador_mandato, 'titular', m.titular,
                 'iban_ultimos4', m.iban_ultimos4, 'estado', m.estado,
                 'metodo_firma', m.metodo_firma, 'fecha_firma', m.fecha_firma,
                 'nombre_tecleado', m.nombre_tecleado, 'firma_imagen', m.firma_imagen,
                 'ip_firma', host(m.ip_address), 'navegador_firma', m.user_agent,
                 'documento_path', m.documento_path,
                 -- 0c-1 (20261229120000): el texto canónico v2 y sus datos
                 'version_canonico', m.version_canonico,
                 'titular_documento', m.titular_documento, 'titular_direccion', m.titular_direccion,
                 'acreedor_cid', m.acreedor_cid, 'acreedor_nombre', m.acreedor_nombre)
               ORDER BY m.created_at)
          FROM public.mandatos_sepa m
         WHERE m.usuario_id = p_sujeto_id AND m.deleted_at IS NULL
           AND (v_self OR privado.es_responsable(m.centro_id))), '[]'::jsonb),

      -- Cobros de cada familia de la que es tutor (los dos tutores reciben lo mismo).
      'cobros_familia', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'id', f.id, 'creado_en', f.created_at, 'actualizado_en', f.updated_at, 'borrado_en', f.deleted_at, 'motivo_borrado', f.deleted_reason,
                 'familia', f.etiqueta, 'metodo_pago', f.metodo_pago,
                 -- 2c (2026-11-02, columnas-export.ts)
                 'metodo_pago_manual', f.metodo_pago_manual,
                 'recibos', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', r.created_at, 'actualizado_en', r.updated_at, 'borrado_en', r.deleted_at,
                            'id', r.id,
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
                            -- 20261215120000: la red del export (columnas-export.ts).
                            'regiro_de', r.devuelto_de_recibo_id,
                            'diferencia_de', r.diferencia_de_recibo_id,
                            'fecha_cobro_banco', r.fecha_cobro_banco,
                            'lineas', COALESCE((
                              SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', lr.created_at, 'arrastre_de_recibo_id', lr.arrastre_de_recibo_id, 'sobrante_de_desborde_id', lr.sobrante_de_desborde_id,
                                       'descripcion', lr.descripcion, 'cantidad', lr.cantidad,
                                       'precio_unitario_centimos', lr.precio_unitario_centimos,
                 -- 2c (2026-11-02, columnas-export.ts)
                 'origen', lr.origen,
                                       'importe_centimos', lr.importe_centimos)
                                     ORDER BY lr.created_at, lr.id)
                                FROM public.lineas_recibo lr
                               WHERE lr.recibo_id = r.id), '[]'::jsonb))
                          ORDER BY r.anio, r.mes, r.created_at)
                     FROM public.recibos r
                    WHERE r.familia_id = f.id AND r.deleted_at IS NULL), '[]'::jsonb),
                 'metodos_pago', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', mp.created_at, 'actualizado_en', mp.updated_at, 'borrado_en', mp.deleted_at,
                            'anio', mp.anio, 'mes', mp.mes, 'metodo', mp.metodo)
                          ORDER BY mp.anio, mp.mes)
                     FROM public.metodo_pago_familia mp
                    WHERE mp.familia_id = f.id AND mp.deleted_at IS NULL), '[]'::jsonb),
                 'conceptos_asignados', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', ac.created_at, 'actualizado_en', ac.updated_at, 'borrado_en', ac.deleted_at,
                 -- 2c (2026-11-02, columnas-export.ts)
                            'origen', ac.origen,
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
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'id', d.id, 'recibo_id', d.recibo_id, 'creado_en', d.created_at, 'actualizado_en', d.updated_at,
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
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'recibo_id', bt.recibo_id, 'creado_en', bt.created_at, 'actualizado_en', bt.updated_at,
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
           AND (v_self OR privado.es_responsable(f.centro_id))), '[]'::jsonb),

      -- Retención (PR-7): lo que se conserva por obligación legal y está bloqueado. No sale, y
      -- no se calla: qué es, cuánto y desde cuándo.
      'datos_bloqueados', privado.datos_bloqueados('usuario', p_sujeto_id, v_self),
      'consultas_datos_bloqueados', privado.consultas_datos_bloqueados('usuario', p_sujeto_id, v_self)
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
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'actualizado_en', le.updated_at,
                 'nombre_nino', le.nombre_nino, 'apellidos_nino', le.apellidos_nino,
                 'fecha_nacimiento', le.fecha_nacimiento, 'telefono_tutor', le.telefono_tutor,
                 'email_tutor', le.email_tutor, 'nota', le.nota, 'posicion', le.posicion,
                 'estado', le.estado, 'curso', ca.nombre, 'apuntado_en', le.created_at,
                 -- 2d (2026-11-02, columnas-export.ts)
                 'descartado_en', le.descartado_at)
               ORDER BY le.created_at)
          FROM public.lista_espera le
          LEFT JOIN public.cursos_academicos ca ON ca.id = le.curso_academico_id
         WHERE le.nino_id = p_sujeto_id), '[]'::jsonb),

      -- Sin motivo_baja. La familia, solo activa/baja (como get_recorrido_nino_familia).
      'matriculas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', m.created_at, 'borrado_en', m.deleted_at,
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
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', c.created_at,
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
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', ci.created_at, 'actualizado_en', ci.updated_at,
                 'titulo', ci.titulo, 'tipo', ci.tipo, 'fecha', ci.fecha,
                 'hora_inicio', ci.hora_inicio, 'hora_fin', ci.hora_fin, 'lugar', ci.lugar,
                 'descripcion', ci.descripcion, 'estado', ci.estado)
               ORDER BY ci.fecha, ci.hora_inicio)
          FROM public.citas ci
         WHERE ci.nino_id = p_sujeto_id), '[]'::jsonb),

      'eventos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'id', e.id, 'creado_en', e.created_at, 'actualizado_en', e.updated_at,
                 'titulo', e.titulo, 'tipo', e.tipo, 'fecha', e.fecha, 'fecha_fin', e.fecha_fin,
                 'hora_inicio', e.hora_inicio, 'hora_fin', e.hora_fin, 'lugar', e.lugar,
                 'descripcion', e.descripcion, 'estado', e.estado,
                 -- 2d (2026-11-02, columnas-export.ts)
                 'requiere_confirmacion', e.requiere_confirmacion)
               ORDER BY e.fecha, e.hora_inicio)
          FROM public.eventos e
         WHERE e.nino_id = p_sujeto_id), '[]'::jsonb),

      'confirmaciones_eventos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'evento_id', ce.evento_id, 'creado_en', ce.created_at, 'actualizado_en', ce.updated_at,
                 'evento', e.titulo, 'fecha_evento', e.fecha, 'estado', ce.estado,
                 'comentario', ce.comentario, 'confirmado_at', ce.confirmado_at)
               ORDER BY e.fecha)
          FROM public.confirmaciones_evento ce
          JOIN public.eventos e ON e.id = ce.evento_id
         WHERE ce.nino_id = p_sujeto_id), '[]'::jsonb),

      -- Los dirigidos a la familia sobre el niño; los del personal son trabajo del centro.
      'recordatorios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', r.created_at, 'actualizado_en', r.updated_at,
                 'titulo', r.titulo, 'descripcion', r.descripcion,
                 'vencimiento', r.vencimiento, 'completado_en', r.completado_en,
                 -- 2d (2026-11-02, columnas-export.ts)
                 'erroneo', r.erroneo)
               ORDER BY r.created_at)
          FROM public.recordatorios r
         WHERE r.nino_id = p_sujeto_id AND r.destinatario = 'familia_individual'), '[]'::jsonb),

      'conceptos_asignados', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', ac.created_at, 'actualizado_en', ac.updated_at, 'borrado_en', ac.deleted_at,
                 -- 2c (2026-11-02, columnas-export.ts)
                 'origen', ac.origen,
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
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', lr.created_at, 'beca_tramo_id', lr.beca_tramo_id,
                 'anio', r.anio, 'mes', r.mes, 'descripcion', lr.descripcion,
                 'cantidad', lr.cantidad, 'importe_centimos', lr.importe_centimos,
                 -- 2c (2026-11-02, columnas-export.ts)
                 'precio_unitario_centimos', lr.precio_unitario_centimos, 'origen', lr.origen)
               ORDER BY r.anio, r.mes, lr.created_at)
          FROM public.lineas_recibo lr
          JOIN public.recibos r ON r.id = lr.recibo_id
         WHERE lr.nino_id = p_sujeto_id AND r.deleted_at IS NULL), '[]'::jsonb),

      'servicios_diarios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', ps.created_at, 'actualizado_en', ps.updated_at,
                 'fecha', ps.fecha, 'servicio', ps.servicio, 'presente', ps.presente)
               ORDER BY ps.fecha, ps.servicio)
          FROM public.parte_servicio_diario ps
         WHERE ps.nino_id = p_sujeto_id), '[]'::jsonb),

      'servicios_pedidos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', sp.created_at, 'actualizado_en', sp.updated_at,
                 -- 8b (2026-11-14): lo que la familia pidió para cada servicio, y el concepto por su nombre.
                 'servicio', sp.servicio, 'respuesta', sp.respuesta, 'concepto', cc.nombre)
               ORDER BY sp.servicio)
          FROM public.peticion_servicio sp
          LEFT JOIN public.conceptos_cobro cc ON cc.id = sp.concepto_id
         WHERE sp.nino_id = p_sujeto_id), '[]'::jsonb),

      'beca_comedor_elegibilidad', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', be.created_at, 'actualizado_en', be.updated_at,
                 'curso', ca.nombre, 'fecha_alta', be.fecha_alta,
                 'fecha_baja', be.fecha_baja, 'activa', be.activa)
               ORDER BY be.fecha_alta)
          FROM public.beca_comedor_elegibilidad be
          JOIN public.cursos_academicos ca ON ca.id = be.curso_academico_id
         WHERE be.nino_id = p_sujeto_id), '[]'::jsonb),

      'beca_comedor_tramos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'id', bt.id, 'tramo_padre_id', bt.tramo_padre_id, 'creado_en', bt.created_at, 'actualizado_en', bt.updated_at,
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
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', o.created_at,
                 'solicitado_en', o.solicitado_en, 'estado', o.estado,
                 'pedida_por_centro', o.pedida_por_centro, 'inmediato', o.inmediato,
                 'confirmada_en', o.confirmada_en, 'gracia_hasta', o.gracia_hasta,
                 'rechazada_en', o.rechazada_en, 'motivo_rechazo', o.motivo_rechazo,
                 'retirada_en', o.retirada_en, 'nota_centro', o.nota_centro,
                 'purgado_en', o.purgado_en,
                 -- 2d (2026-11-02, columnas-export.ts)
                 'por_plazo', o.por_plazo)
               ORDER BY o.solicitado_en)
          FROM public.olvido_solicitudes o
         WHERE o.sujeto_tipo = 'nino' AND o.sujeto_id = p_sujeto_id), '[]'::jsonb),

      -- Quién ha leído su ficha médica (20261128120000). El nombre, solo si es de la familia del
      -- niño; del personal del centro y del soporte, solo el rol (R4, 2026-11-01).
      'lecturas_ficha_medica', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'leida_en', l.leida_en, 'lector', u.nombre_completo, 'rol_lector', l.rol_lector,
                 'origen', l.origen, 'campos', l.campos)
               ORDER BY l.leida_en)
          FROM public.lecturas_ficha_medica l
          LEFT JOIN public.usuarios u ON u.id = l.lector_id
                                     AND l.rol_lector IN ('tutor_legal', 'autorizado')
         WHERE l.nino_id = p_sujeto_id AND NOT v_bloq), '[]'::jsonb),

      -- Retención (PR-7): lo que se conserva por obligación legal y está bloqueado.
      'datos_bloqueados', privado.datos_bloqueados('nino', p_sujeto_id, v_admin),
      'consultas_datos_bloqueados', privado.consultas_datos_bloqueados('nino', p_sujeto_id, true)
    );
  END IF;

  -- ------------------------------------------------------------------ TUTOR
  -- Fase 6 (20270118120000): un tutor SIN cuenta (el segundo, antes de aceptar la invitación) no es
  -- un usuario y no podía exportarse por ningún camino (medido el 2026-11-13). Lo exporta la
  -- Dirección de su centro, por el id de su fila en `familia_tutores`: su fila entera, y nada del otro
  -- tutor ni del niño (eso va por sus propios sujetos).
  IF p_sujeto_tipo = 'tutor' THEN
    SELECT f.centro_id INTO v_centro
      FROM public.familia_tutores ft JOIN public.familias f ON f.id = ft.familia_id
     WHERE ft.id = p_sujeto_id;
    IF v_centro IS NULL OR NOT privado.es_responsable(v_centro) THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN jsonb_build_object(
      'perfiles_familia', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'creado_en', ft.created_at, 'actualizado_en', ft.updated_at, 'borrado_en', ft.deleted_at,
                 'familia_id', ft.familia_id, 'rol_familia', ft.rol_familia,
                 'nombre_completo', ft.nombre_completo, 'email', ft.email,
                 'direccion_calle', ft.direccion_calle, 'direccion_numero', ft.direccion_numero,
                 'direccion_cp', ft.direccion_cp, 'direccion_ciudad', ft.direccion_ciudad,
                 'dni_documento_path', ft.dni_documento_path,
                 'telefono', ft.telefono, 'fecha_nacimiento', ft.fecha_nacimiento,
                 'dni_numero', ft.dni_numero, 'estudios', ft.estudios, 'empresa', ft.empresa))
          FROM public.familia_tutores ft
         WHERE ft.id = p_sujeto_id), '[]'::jsonb)
    );
  END IF;

  RAISE EXCEPTION 'tipo de sujeto inválido: %', p_sujeto_tipo
    USING ERRCODE = 'invalid_parameter_value';
END
$function$;

-- ---- 10. La purga del niño se lleva su petición ----
CREATE OR REPLACE FUNCTION privado.purgar_nino(p_nino_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lista uuid[];
BEGIN
  -- D-5: motivo 'purga_rgpd' → desarchivar_nino RAISE (no reincorpora un sujeto purgado).
  UPDATE public.ninos SET
    nombre           = '[borrado]',
    -- 5a: `apellidos` la deriva la base de los dos; se borran los dos.
    primer_apellido  = '[borrado]',
    segundo_apellido = NULL,
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
    -- 5a: los campos nuevos de la ficha.
    lugar_nacimiento      = NULL,
    dni                   = NULL,
    hermanos_total        = NULL,
    hermanos_lugar        = NULL,
    direccion_provincia   = NULL,
    observaciones_familia = NULL,
    como_nos_conocio      = NULL,
    como_nos_conocio_otro = NULL,
    -- Fase 7: la tarjeta sanitaria, el número y la ruta de la imagen. El objeto del bucket
    -- `sip-ninos` lo borra antes el manifiesto de adjuntos, como el libro de familia.
    sip                   = NULL,
    sip_documento_path    = NULL,
    -- Fase 8a: la fecha de incorporación. Un niño purgado no tiene matrícula activa, que es lo
    -- único que la exige (`privado.ninos_incorporacion_no_se_quita`).
    fecha_incorporacion   = NULL,
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

  -- Fase 8b: la petición de servicios del alta (lo que la familia pidió). Lo que se cobró de verdad
  -- está en las asignaciones y los recibos, que son fiscales y se quedan.
  DELETE FROM public.peticion_servicio WHERE nino_id = p_nino_id;

  -- Retención (F11-B, punto 6, PR-4): su operativa (agenda, asistencia, mensajes, informes,
  -- citas, recordatorios, respuestas a eventos) se borra, con sus copias en audit_log.
  PERFORM privado.olvido_borrar_operativa_nino(p_nino_id);

  -- Purga RGPD del niño: la copia en audit_log, con la lista de claves personales por tabla
  -- (_claves_pii_nino).
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

-- ---- 11. La auditoría conoce la tabla nueva ----
CREATE OR REPLACE FUNCTION public.audit_trigger_function()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro_id uuid;
  v_antes jsonb;
  v_despues jsonb;
  v_registro_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'centros' THEN
    v_centro_id := COALESCE((NEW).id, (OLD).id);
  ELSIF TG_TABLE_NAME = 'ninos' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'roles_usuario' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'dias_centro' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'plantillas_menu_mensual' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'menu_dia' THEN
    v_centro_id := privado.centro_de_plantilla(COALESCE((NEW).plantilla_id, (OLD).plantilla_id));
  ELSIF TG_TABLE_NAME = 'conversaciones' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'mensajes' THEN
    v_centro_id := public.centro_de_conversacion(COALESCE((NEW).conversacion_id, (OLD).conversacion_id));
  ELSIF TG_TABLE_NAME = 'anuncios' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'recordatorios' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'eventos' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'citas' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'cita_invitados' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'autorizaciones' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'firmas_autorizacion' THEN
    v_centro_id := privado.centro_de_nino(COALESCE((NEW).nino_id, (OLD).nino_id));
  ELSIF TG_TABLE_NAME = 'administraciones_medicacion' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'plantillas_informe' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'informes_evolucion' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'campanas_informe' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'publicaciones' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'media' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'media_etiquetas' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'aulas_curso' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'lista_espera' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  -- ── F-3-A: rollover_finaliza (centro_id directo) ─────────────────────────
  ELSIF TG_TABLE_NAME = 'rollover_finaliza' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  -- ── F-2a: familias (centro_id directo) ───────────────────────────────────
  ELSIF TG_TABLE_NAME = 'familias' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  -- ── F-2a: familia_tutores (centro derivado de la familia) ────────────────
  ELSIF TG_TABLE_NAME = 'familia_tutores' THEN
    v_centro_id := privado.centro_de_familia(COALESCE((NEW).familia_id, (OLD).familia_id));
  ELSIF TG_TABLE_NAME IN (
    'conceptos_cobro',
    'tipos_beca',
    'asignacion_concepto',
    'becas',
    'metodo_pago_familia',
    'parte_servicio_diario',
    'cierre_mensual',
    'recibos',
    'lineas_recibo',
    'remesas',
    'recibos_remesa',
    -- ── B2: beca comedor v2 (centro_id directo) ────────────────────────────
    'beca_comedor_elegibilidad',
    'beca_comedor_tramo',
    'beca_comedor_desborde',
    'beca_comedor_transferencia',
    -- ── Serie de altas, 1b: los documentos del centro firmados ──────────────
    'firmas_documentos_centro',
    -- ── Fase 8b: la petición de servicios del alta ────────────────────────
    'peticion_servicio'
  ) THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME IN (
    'info_medica_emergencia',
    'vinculos_familiares',
    'matriculas',
    'datos_pedagogicos_nino',
    'asistencias',
    'ausencias'
  ) THEN
    SELECT n.centro_id INTO v_centro_id
    FROM public.ninos n
    WHERE n.id = COALESCE((NEW).nino_id, (OLD).nino_id);
  ELSIF TG_TABLE_NAME = 'agendas_diarias' THEN
    v_centro_id := privado.centro_de_nino(COALESCE((NEW).nino_id, (OLD).nino_id));
  ELSIF TG_TABLE_NAME IN ('comidas', 'biberones', 'suenos', 'deposiciones') THEN
    v_centro_id := privado.centro_de_agenda(COALESCE((NEW).agenda_id, (OLD).agenda_id));
  END IF;

  -- ── Grupo 1 (PR A): tablas auditadas desde 20261011120000 ────────────────
  -- profes_aulas no tiene centro_id: se deriva del aula. Si el aula ya no está (DELETE en
  -- cascada al borrar el aula), del curso. usuarios no es de un centro: centro_id NULL.
  IF TG_TABLE_NAME = 'profes_aulas' THEN
    v_centro_id := COALESCE(
      privado.centro_de_aula(COALESCE((NEW).aula_id, (OLD).aula_id)),
      (SELECT ca.centro_id FROM public.cursos_academicos ca
        WHERE ca.id = COALESCE((NEW).curso_academico_id, (OLD).curso_academico_id)));
  ELSIF TG_TABLE_NAME IN (
    'aulas',
    'cursos_academicos',
    'tarifa_concepto_anio',
    'acuses_alta',
    'cambios_pendientes',
    'mandatos_sepa'
  ) THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  END IF;

  -- ── Grupo 1 (PR B): invitaciones (centro_id directo) ─────────────────────
  IF TG_TABLE_NAME = 'invitaciones' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  END IF;

  v_antes   := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END;
  v_despues := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END;
  v_registro_id := COALESCE((NEW).id, (OLD).id);

  -- ── Grupo 1 (PR A): columnas que no entran en audit_log ──────────────────
  -- Nada entra en audit_log que la redacción de la purga RGPD no sepa limpiar.
  --   cambios_pendientes: el contenido del cambio (payload, valor_propuesto) lleva datos del
  --     niño (p. ej. la dirección) y acaba en la tabla real, que ya se audita.
  --   mandatos_sepa: el IBAN cifrado y la firma, y los datos del firmante que la purga no
  --     redacta en esta tabla (titular, nombre tecleado, IP, user agent).
  IF TG_TABLE_NAME = 'cambios_pendientes' THEN
    v_antes   := v_antes   - ARRAY['payload', 'valor_propuesto'];
    v_despues := v_despues - ARRAY['payload', 'valor_propuesto'];
  ELSIF TG_TABLE_NAME = 'mandatos_sepa' THEN
    v_antes   := v_antes   - ARRAY['iban_cifrado', 'firma_imagen', 'titular', 'nombre_tecleado',
                                   'ip_address', 'user_agent', 'titular_documento',
                                   'titular_direccion'];
    v_despues := v_despues - ARRAY['iban_cifrado', 'firma_imagen', 'titular', 'nombre_tecleado',
                                   'ip_address', 'user_agent', 'titular_documento',
                                   'titular_direccion'];
  ELSIF TG_TABLE_NAME = 'recibos' THEN
    -- recibos: la nota del cobro manual es texto libre de la directora, y la purga no redacta
    -- recibos (se conservan). La forma y la fecha del cobro sí entran.
    v_antes   := v_antes   - 'cobro_nota';
    v_despues := v_despues - 'cobro_nota';
  END IF;

  -- ── Grupo 1 (PR B): invitaciones sin token ───────────────────────────────
  IF TG_TABLE_NAME = 'invitaciones' THEN
    v_antes   := v_antes   - 'token';
    v_despues := v_despues - 'token';
  END IF;

  -- ── Retención (F11-B, punto 6): nada vive más en audit_log que en su tabla ──
  -- Un borrado por plazo o por olvido se lleva sus copias en audit_log: las anteriores (alta y
  -- cambios) y la que escribiría este DELETE. Lo pide la purga con
  -- set_config('app.borrar_sin_copia', 'on', true), y solo vale sin humano (auth.uid() NULL):
  -- con sesión, el DELETE se audita siempre. Las cascadas pasan por aquí fila a fila, así que
  -- también se llevan las suyas.
  -- TG_TABLE_NAME es `name`, de collation "C", y `::text` la conserva: comparado así con `tabla`
  -- el índice (tabla, registro_id) solo sirve para registro_id y recorre el índice entero en cada
  -- fila (~7 ms con 370 000 filas). Con COLLATE "default" va por clave exacta (0,05 ms).
  IF TG_OP = 'DELETE' AND auth.uid() IS NULL
     AND current_setting('app.borrar_sin_copia', true) = 'on' THEN
    DELETE FROM public.audit_log
     WHERE tabla = TG_TABLE_NAME::text COLLATE "default" AND registro_id = v_registro_id;
    RETURN OLD;
  END IF;

  -- ── Grupo 1 (PR B): actor_sistema ────────────────────────────────────────
  -- Solo sin humano (auth.uid() NULL): la etiqueta de app.audit_actor si empieza por
  -- 'system:' (la fijan las purgas con set_config(..., true)); si no la hay y el rol es
  -- service_role, 'system:service_role'. Con sesión humana nunca se rellena.
  INSERT INTO public.audit_log
    (tabla, registro_id, accion, usuario_id, valores_antes, valores_despues, centro_id, actor_sistema)
  VALUES
    (TG_TABLE_NAME, v_registro_id, TG_OP::public.audit_accion, auth.uid(), v_antes, v_despues, v_centro_id,
     CASE WHEN auth.uid() IS NULL THEN
       CASE
         WHEN current_setting('app.audit_actor', true) LIKE 'system:%'
              AND char_length(current_setting('app.audit_actor', true)) <= 100
           THEN current_setting('app.audit_actor', true)
         WHEN auth.role() = 'service_role' THEN 'system:service_role'
       END
     END);

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- ---- Guarda posterior: lo que dice este fichero, medido en la base ----
DO $guarda$
DECLARE
  v text;
BEGIN
  -- La tabla: con RLS, que la sesión solo lee.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.peticion_servicio'::regclass) THEN
    RAISE EXCEPTION 'peticion_servicio sin RLS';
  END IF;
  IF has_table_privilege('authenticated', 'public.peticion_servicio', 'INSERT')
     OR has_table_privilege('authenticated', 'public.peticion_servicio', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.peticion_servicio', 'DELETE')
     OR has_table_privilege('anon', 'public.peticion_servicio', 'SELECT') THEN
    RAISE EXCEPTION 'peticion_servicio: la sesión escribe, o anon lee';
  END IF;
  -- El mes siguiente, con sus bordes: a mitad, el día 1, el 31 de diciembre y el 29 de febrero.
  SELECT string_agg(privado.mes_siguiente(d)::text, ',' ORDER BY d) INTO v
    FROM unnest(ARRAY[DATE '2027-09-15', DATE '2027-09-01', DATE '2027-12-31', DATE '2028-02-29']) d;
  IF v IS DISTINCT FROM '2027-10-01,2027-10-01,2028-01-01,2028-03-01' THEN
    RAISE EXCEPTION 'mes_siguiente no da lo que dice: %', v;
  END IF;
  -- Cada pieza, en su cuerpo vivo.
  IF position('poner_mensual' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.validar_alta(uuid,date)'::regprocedure)) = 0
     OR position('peticion_servicio' IN (SELECT prosrc FROM pg_proc WHERE oid = 'privado.purgar_nino(uuid)'::regprocedure)) = 0
     OR position('servicios_pedidos' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.export_datos_sujeto(text,uuid)'::regprocedure)) = 0
     OR position('''peticion_servicio''' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.audit_trigger_function()'::regprocedure)) = 0
     OR to_regprocedure('public.listado_pase_servicios(uuid)') IS NOT NULL
     OR to_regprocedure('public.listado_pase_servicios(uuid,date)') IS NULL THEN
    RAISE EXCEPTION 'falta alguna pieza en su cuerpo vivo';
  END IF;
  -- La coherencia de centro de la casa (20270108120000): su trigger, sobre las dos columnas.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'zz_centro_coherente'
                  AND tgrelid = 'public.peticion_servicio'::regclass) THEN
    RAISE EXCEPTION 'peticion_servicio sin zz_centro_coherente';
  END IF;
  -- Las funciones de privado, cerradas; las de public, sin anon.
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY['privado.servicios_ofrecidos(uuid)', 'privado.servicios_sin_contestar(uuid)',
                               'privado.respuestas_servicio(uuid,jsonb)', 'privado.escribir_respuestas_servicio(uuid,jsonb)',
                               'privado.mes_siguiente(date)', 'privado.poner_mensual(uuid,uuid,date,boolean)',
                               'privado.quitar_mensual(uuid,date)', 'privado.peticion_servicio_coherente()',
                               'privado.peticion_servicio_centro_coherente()']) f
     WHERE has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE'))
  OR EXISTS (
    SELECT 1 FROM unnest(ARRAY['public.servicios_alta(uuid)', 'public.guardar_peticion_servicios(uuid,jsonb)',
                               'public.aplicar_peticion_servicios(uuid,jsonb)', 'public.listado_pase_servicios(uuid,date)']) f
     WHERE has_function_privilege('anon', f, 'EXECUTE') OR NOT has_function_privilege('authenticated', f, 'EXECUTE')) THEN
    RAISE EXCEPTION 'permisos de las funciones de la petición, mal';
  END IF;
END $guarda$;
