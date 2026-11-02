-- =============================================================================
-- FEAT — El fichero de cada versión de una remesa, guardado con su registro (R-1)
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/altas-serie.md, «Reabrir una remesa» (R-1 y P-1, decisiones del responsable
-- del 2026-10-31 y del 2026-11-01). Hasta ahora el XML no se guardaba (G1, «regenerable»): no había
-- prueba de lo que se pidió al banco, y dos descargas de la misma remesa podían llevar IBAN distintos
-- para la misma familia (`get_mandatos_remesa` toma el mandato activo en cada descarga).
--
--   · El fichero se guarda la primera vez que sale, en el bucket privado `remesas-ficheros`
--     (`{centro}/{remesa}/{MsgId}.xml`), y desde ahí cada descarga de esa versión sirve el guardado,
--     byte a byte. Sin políticas de Storage para las sesiones: lo sube y lo lee el servidor con
--     service_role, después de autorizar con la sesión de Dirección.
--   · `remesa_ficheros` y `remesa_fichero_adeudos`: el registro de cada versión (MsgId, sha256,
--     número de adeudos, importe; por adeudo, EndToEndId, importe y mandato con su MndtId). Sin IBAN
--     ni nombres. Sin políticas ni privilegios para nadie: se escriben y se leen por funciones.
--   · `registrar_fichero_remesa`: pone la marca (`fichero_generado_at`) y escribe el registro en la
--     MISMA transacción, con la sesión de Dirección (`es_admin`, que es quien queda en audit_log).
--     Exige que el fichero esté ya en el bucket, donde solo sube el servidor: una sesión no puede
--     registrar un fichero que NIDO no generó. Y que los adeudos sean exactamente los recibos
--     cobrables de la remesa: si entró o salió alguno entre la lectura y la marca, no registra nada.
--   · Plazo: el FISCAL (`ANIOS_FISCAL`, `retencion/lib/fiscal.ts`) desde `generado_at`; el número lo
--     pasa el cron, nunca va escrito aquí. `ficheros_remesa_vencidos` / `destruir_fichero_remesa`
--     (solo service_role) esperan a la retención de cualquier familia del fichero. Los objetos del
--     bucket sin registro (una subida que no llegó a registrarse) salen en
--     `ficheros_remesa_huerfanos` al día y se borran: un IBAN no se queda sin plazo.
--   · Lo fiscal de la familia espera a sus ficheros: `privado.familia_fiscal_vencida` añade «ningún
--     fichero vivo con un recibo suyo» (P-3). Sin eso se borraría la familia con su IBAN aún en un
--     fichero. Las FK de los adeudos a `recibos` y del fichero a `remesas` (RESTRICT) lo garantizan
--     además desde abajo.
--   · `retencion_pasadas`: el CHECK de los recuentos pasa de doce claves a trece (`ficherosRemesa`).
--     NOT VALID: las pasadas ya registradas tienen doce y no se tocan; las nuevas, trece.
--
-- Fuera de esta migración: marcar enviada por función y exigiendo el fichero (R-4) y reabrir, cada
-- una en su PR. Sin datos que migrar: en producción ninguna remesa tiene marca (medido el
-- 2026-11-02).
--
-- La aplica el responsable por SQL Editor. Sin BEGIN ni COMMIT. Tras aplicar: registrar en
-- supabase_migrations.schema_migrations. ORDEN: aplicar ANTES de desplegar la app de este PR, que
-- sin estas funciones no sirve ningún fichero (500).
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF to_regclass('public.remesa_ficheros') IS NOT NULL THEN
    RAISE EXCEPTION 'ya aplicada: existe remesa_ficheros';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'remesas-ficheros') THEN
    RAISE EXCEPTION 'el bucket remesas-ficheros ya existe';
  END IF;
  -- Lo que se reescribe es lo que hay, tal como quedó (20261208120000).
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p
   WHERE p.oid = to_regprocedure('privado.familia_fiscal_vencida(uuid,integer)');
  IF v_md5 IS DISTINCT FROM 'cf65646f8193ba58065c37ce20df1f86' THEN
    RAISE EXCEPTION 'privado.familia_fiscal_vencida no es la de 20261208120000: %', coalesce(v_md5, 'falta');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'retencion_pasadas_recuentos_check'
                    AND pg_get_constraintdef(oid) LIKE '%cuentasOlvidadas%'
                    AND pg_get_constraintdef(oid) NOT LIKE '%ficherosRemesa%') THEN
    RAISE EXCEPTION 'el CHECK de retencion_pasadas no es el de doce claves';
  END IF;
  RAISE NOTICE 'guarda previa: % remesas vivas, % con marca, % enviadas; % pasadas de retención registradas',
    (SELECT count(*) FROM public.remesas WHERE deleted_at IS NULL),
    (SELECT count(*) FROM public.remesas WHERE deleted_at IS NULL AND fichero_generado_at IS NOT NULL),
    (SELECT count(*) FROM public.remesas WHERE deleted_at IS NULL AND estado = 'enviada'),
    (SELECT count(*) FROM public.retencion_pasadas);
END
$guarda$;

-- ---- 1. El bucket ----
-- Privado y sin políticas en storage.objects: ninguna sesión lo lee ni lo escribe.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('remesas-ficheros', 'remesas-ficheros', false, 10485760, ARRAY['application/xml']);

-- ---- 2. El registro ----
CREATE TABLE public.remesa_ficheros (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id      uuid NOT NULL REFERENCES public.centros(id),
  -- RESTRICT: una remesa con un fichero vivo no se borra (lo fiscal espera a sus ficheros).
  remesa_id      uuid NOT NULL REFERENCES public.remesas(id) ON DELETE RESTRICT,
  msg_id         text NOT NULL UNIQUE CHECK (char_length(msg_id) BETWEEN 1 AND 35),
  -- La marca de la versión (`remesas.fichero_generado_at`).
  generado_at    timestamptz NOT NULL,
  sha256         text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  n_adeudos      integer NOT NULL CHECK (n_adeudos > 0),
  total_centimos bigint NOT NULL CHECK (total_centimos > 0),
  ruta           text NOT NULL UNIQUE,
  -- Las ponen marcar enviada (R-4) y reabrir, en sus PR.
  enviada_at     timestamptz NULL,
  reabierta_at   timestamptz NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT remesa_ficheros_version_unica UNIQUE (remesa_id, generado_at)
);
CREATE INDEX remesa_ficheros_generado_idx ON public.remesa_ficheros (generado_at);

CREATE TABLE public.remesa_fichero_adeudos (
  fichero_id       uuid NOT NULL REFERENCES public.remesa_ficheros(id) ON DELETE CASCADE,
  -- RESTRICT: el recibo de un fichero vivo no se borra.
  recibo_id        uuid NOT NULL REFERENCES public.recibos(id) ON DELETE RESTRICT,
  end_to_end_id    text NOT NULL CHECK (char_length(end_to_end_id) BETWEEN 1 AND 35),
  importe_centimos bigint NOT NULL CHECK (importe_centimos > 0),
  -- Sin FK: la purga del olvido borra los mandatos, y el fichero, que es fiscal, se queda. El MndtId
  -- es lo que dice el fichero.
  mandato_id       uuid NULL,
  mndt_id          text NOT NULL CHECK (char_length(mndt_id) BETWEEN 1 AND 35),
  PRIMARY KEY (fichero_id, recibo_id)
);
CREATE INDEX remesa_fichero_adeudos_recibo_idx ON public.remesa_fichero_adeudos (recibo_id);

-- Sin políticas ni privilegios para nadie: solo las funciones de abajo.
ALTER TABLE public.remesa_ficheros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remesa_fichero_adeudos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.remesa_ficheros FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.remesa_fichero_adeudos FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.remesa_ficheros IS
  'El fichero pain.008 de cada versión de una remesa (R-1, 20261220120000): MsgId, marca, sha256, número de adeudos, importe y su ruta en el bucket privado remesas-ficheros. Sin IBAN. Plazo fiscal desde generado_at (ficheros_remesa_vencidos). Sin políticas ni privilegios: se escribe con registrar_fichero_remesa y se lee con fichero_remesa_vigente.';
COMMENT ON TABLE public.remesa_fichero_adeudos IS
  'Los adeudos de cada fichero de remesa (R-1): recibo, EndToEndId, importe y mandato con su MndtId. Sin IBAN ni nombres. Se van con su fichero.';

-- ---- 3. Registrar la versión ----
-- La marca y el registro, en una transacción. Con la sesión de Dirección: quien la pone queda en
-- audit_log por el trigger de remesas. Devuelve el id del fichero.
CREATE FUNCTION public.registrar_fichero_remesa(
  p_remesa_id uuid,
  p_marca     timestamptz,
  p_msg_id    text,
  p_sha256    text,
  p_ruta      text,
  p_adeudos   jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_remesa  public.remesas%ROWTYPE;
  v_fichero uuid;
  v_n       integer;
  v_total   bigint;
  v_malos   integer;
  v_distintos integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_remesa FROM public.remesas WHERE id = p_remesa_id FOR UPDATE;
  IF NOT FOUND OR v_remesa.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'remesa no encontrada' USING ERRCODE = 'P0001', HINT = 'no_encontrada';
  END IF;
  IF NOT public.es_admin(v_remesa.centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- La versión: la marca que hay o, si no hay, la que trae la descarga (la hora del servidor).
  IF v_remesa.fichero_generado_at IS NULL THEN
    IF p_marca IS NULL OR p_marca > now() + interval '1 minute'
       OR p_marca < now() - interval '10 minutes' THEN
      RAISE EXCEPTION 'la marca no es de ahora' USING ERRCODE = 'P0001', HINT = 'marca_no_valida';
    END IF;
    UPDATE public.remesas SET fichero_generado_at = p_marca WHERE id = p_remesa_id;
  ELSIF v_remesa.fichero_generado_at IS DISTINCT FROM p_marca THEN
    RAISE EXCEPTION 'otra descarga ya fijó la versión' USING ERRCODE = 'P0001', HINT = 'marca_distinta';
  END IF;
  IF EXISTS (SELECT 1 FROM public.remesa_ficheros
              WHERE remesa_id = p_remesa_id AND generado_at = p_marca) THEN
    RAISE EXCEPTION 'esta versión ya está guardada' USING ERRCODE = 'P0001', HINT = 'ya_guardado';
  END IF;

  -- El fichero ya está en el bucket, donde solo sube el servidor, y en su sitio.
  IF p_msg_id IS NULL OR p_msg_id NOT LIKE 'NIDO-' || left(p_remesa_id::text, 8) || '-%'
     OR char_length(p_msg_id) > 35
     OR p_ruta IS DISTINCT FROM format('%s/%s/%s.xml', v_remesa.centro_id, p_remesa_id, p_msg_id) THEN
    RAISE EXCEPTION 'el MsgId o la ruta no son de esta remesa' USING ERRCODE = 'P0001', HINT = 'ruta_no_valida';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o
                  WHERE o.bucket_id = 'remesas-ficheros' AND o.name = p_ruta) THEN
    RAISE EXCEPTION 'el fichero no está guardado' USING ERRCODE = 'P0001', HINT = 'sin_fichero';
  END IF;

  -- Los adeudos son exactamente los recibos cobrables de la remesa (el filtro de
  -- get_mandatos_remesa y prepararRemesa: por banco, pendientes o enviados, vivos, con importe),
  -- cada uno con su importe, su EndToEndId y un mandato de su familia.
  IF jsonb_typeof(p_adeudos) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'adeudos no válidos' USING ERRCODE = 'P0001', HINT = 'recibos_cambiaron';
  END IF;
  WITH a AS (
    SELECT * FROM jsonb_to_recordset(p_adeudos)
      AS x(recibo_id uuid, end_to_end_id text, importe_centimos bigint, mndt_id text)
  ), cobrables AS (
    SELECT r.id, r.total_centimos, r.familia_id
      FROM public.recibos_remesa rr
      JOIN public.recibos r ON r.id = rr.recibo_id
     WHERE rr.remesa_id = p_remesa_id AND r.metodo = 'sepa'
       AND r.estado IN ('pendiente_procesar', 'enviado_banco')
       AND r.deleted_at IS NULL AND r.total_centimos > 0
  )
  SELECT count(*) INTO v_malos
    FROM cobrables c
    FULL JOIN a ON a.recibo_id = c.id
   WHERE c.id IS NULL OR a.recibo_id IS NULL
      OR a.importe_centimos IS DISTINCT FROM c.total_centimos
      OR a.end_to_end_id IS DISTINCT FROM upper(replace(c.id::text, '-', ''))
      OR NOT EXISTS (SELECT 1 FROM public.mandatos_sepa m
                      WHERE m.identificador_mandato = a.mndt_id AND m.familia_id = c.familia_id);
  SELECT count(*), count(DISTINCT recibo_id), sum(importe_centimos) INTO v_n, v_distintos, v_total
    FROM jsonb_to_recordset(p_adeudos) AS x(recibo_id uuid, importe_centimos bigint);
  IF v_malos > 0 OR v_n <> v_distintos THEN
    RAISE EXCEPTION 'los recibos de la remesa no son los del fichero (% distintos)', v_malos
      USING ERRCODE = 'P0001', HINT = 'recibos_cambiaron';
  END IF;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'un fichero sin adeudos no se guarda' USING ERRCODE = 'P0001', HINT = 'recibos_cambiaron';
  END IF;
  INSERT INTO public.remesa_ficheros
    (centro_id, remesa_id, msg_id, generado_at, sha256, n_adeudos, total_centimos, ruta)
  VALUES (v_remesa.centro_id, p_remesa_id, p_msg_id, p_marca, p_sha256, v_n, v_total, p_ruta)
  RETURNING id INTO v_fichero;
  INSERT INTO public.remesa_fichero_adeudos
    (fichero_id, recibo_id, end_to_end_id, importe_centimos, mandato_id, mndt_id)
  SELECT v_fichero, a.recibo_id, a.end_to_end_id, a.importe_centimos,
         (SELECT m.id FROM public.mandatos_sepa m WHERE m.identificador_mandato = a.mndt_id),
         a.mndt_id
    FROM jsonb_to_recordset(p_adeudos)
      AS a(recibo_id uuid, end_to_end_id text, importe_centimos bigint, mndt_id text);
  RETURN v_fichero;
END;
$function$;
REVOKE ALL ON FUNCTION public.registrar_fichero_remesa(uuid, timestamptz, text, text, text, jsonb)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_fichero_remesa(uuid, timestamptz, text, text, text, jsonb)
  TO authenticated;

-- ---- 4. El fichero de la versión vigente ----
-- Para servirlo: la ruta y su huella, de la versión de la marca actual. Vacío si la remesa no tiene
-- marca o su versión aún no está guardada (una marca de antes de esta pieza).
CREATE FUNCTION public.fichero_remesa_vigente(p_remesa_id uuid)
RETURNS TABLE(fichero_id uuid, msg_id text, generado_at timestamptz, sha256 text, ruta text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_centro uuid;
  v_marca  timestamptz;
BEGIN
  SELECT centro_id, fichero_generado_at INTO v_centro, v_marca
    FROM public.remesas WHERE id = p_remesa_id AND deleted_at IS NULL;
  IF NOT FOUND OR NOT public.es_admin(v_centro) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT f.id, f.msg_id, f.generado_at, f.sha256, f.ruta
    FROM public.remesa_ficheros f
   WHERE f.remesa_id = p_remesa_id AND f.generado_at = v_marca;
END;
$function$;
REVOKE ALL ON FUNCTION public.fichero_remesa_vigente(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fichero_remesa_vigente(uuid) TO authenticated;

-- ---- 5. El plazo ----
-- Un fichero espera mientras cualquier familia con un recibo en él tenga a alguien retenido.
CREATE FUNCTION privado.fichero_remesa_retenido(p_fichero_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.remesa_fichero_adeudos a
      JOIN public.recibos r ON r.id = a.recibo_id
     WHERE a.fichero_id = p_fichero_id
       AND (EXISTS (SELECT 1 FROM public.ninos n
                     WHERE n.familia_id = r.familia_id
                       AND privado.retenido(r.centro_id, 'nino', n.id))
            OR EXISTS (SELECT 1 FROM privado.familia_adultos(r.familia_id) x(usuario_id)
                        WHERE privado.retenido(r.centro_id, 'usuario', x.usuario_id))));
$function$;
REVOKE ALL ON FUNCTION privado.fichero_remesa_retenido(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION privado.fichero_remesa_retenido(uuid) TO service_role;

CREATE FUNCTION public.ficheros_remesa_vencidos(p_anios integer)
RETURNS TABLE(fichero_id uuid, ruta text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF p_anios IS NULL OR p_anios < 1 THEN
    RAISE EXCEPTION 'plazo fiscal no válido' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
  SELECT f.id, f.ruta
    FROM public.remesa_ficheros f
   WHERE privado.plazo_cumplido((f.generado_at AT TIME ZONE 'Europe/Madrid')::date, p_anios)
     AND NOT privado.fichero_remesa_retenido(f.id)
   ORDER BY f.generado_at, f.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.ficheros_remesa_vencidos(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ficheros_remesa_vencidos(integer) TO service_role;

-- La destrucción de uno, después de borrar su objeto de Storage. Vuelve a mirar, con la fila
-- bloqueada, que siga vencido: entre la lista y aquí pudieron retener a alguien. NULL si ya no
-- toca; si no, los adeudos que se fueron con él.
CREATE FUNCTION public.destruir_fichero_remesa(p_fichero_id uuid, p_anios integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_f public.remesa_ficheros%ROWTYPE;
  v_n integer;
BEGIN
  IF p_anios IS NULL OR p_anios < 1 THEN
    RAISE EXCEPTION 'plazo fiscal no válido' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_f FROM public.remesa_ficheros WHERE id = p_fichero_id FOR UPDATE;
  IF NOT FOUND
     OR NOT privado.plazo_cumplido((v_f.generado_at AT TIME ZONE 'Europe/Madrid')::date, p_anios)
     OR privado.fichero_remesa_retenido(v_f.id) THEN
    RETURN NULL;
  END IF;
  DELETE FROM public.remesa_fichero_adeudos WHERE fichero_id = v_f.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM public.remesa_ficheros WHERE id = v_f.id;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.destruir_fichero_remesa(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.destruir_fichero_remesa(uuid, integer) TO service_role;

-- Los objetos del bucket sin registro: una subida cuyo registro no llegó a escribirse (un fallo
-- entre las dos). Con un día de margen, para no llevarse una descarga en curso.
CREATE FUNCTION public.ficheros_remesa_huerfanos()
RETURNS TABLE(ruta text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT o.name
    FROM storage.objects o
   WHERE o.bucket_id = 'remesas-ficheros'
     AND o.created_at < now() - interval '1 day'
     AND NOT EXISTS (SELECT 1 FROM public.remesa_ficheros f WHERE f.ruta = o.name)
   ORDER BY o.name;
$function$;
REVOKE ALL ON FUNCTION public.ficheros_remesa_huerfanos() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ficheros_remesa_huerfanos() TO service_role;

-- ---- 6. Lo fiscal de la familia espera a sus ficheros (P-3) ----
-- La de 20261208120000 con una condición más, antes del dinero pendiente.
CREATE OR REPLACE FUNCTION privado.familia_fiscal_vencida(p_familia_id uuid, p_anios integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $function$
DECLARE
  v_centro uuid;
  v_pago   date;
  v_baja   date;
BEGIN
  SELECT centro_id INTO v_centro FROM public.familias WHERE id = p_familia_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Sus niños: al menos uno, todos purgados y sin nada que les quede.
  IF NOT EXISTS (SELECT 1 FROM public.ninos WHERE familia_id = p_familia_id)
     OR EXISTS (SELECT 1 FROM public.ninos n
                 WHERE n.familia_id = p_familia_id
                   AND (n.deleted_reason IS DISTINCT FROM 'purga_rgpd'
                        OR privado.queda_conservado_nino(n.id)
                        OR EXISTS (SELECT 1 FROM public.lecturas_ficha_medica l WHERE l.nino_id = n.id)
                        OR EXISTS (SELECT 1 FROM public.accesos_datos_bloqueados x
                                    WHERE x.sujeto_tipo = 'nino' AND x.sujeto_id = n.id)
                        -- Retención (PR-8): un niño retenido hace esperar a su familia entera.
                        OR privado.retenido(v_centro, 'nino', n.id))) THEN
    RETURN false;
  END IF;

  -- Sus adultos: purgados en el centro, o con otro rol vivo allí; ninguno retenido.
  IF EXISTS (SELECT 1 FROM privado.familia_adultos(p_familia_id) a(usuario_id)
              WHERE privado.retenido(v_centro, 'usuario', a.usuario_id)
                 OR NOT (privado.usuario_olvidado_en(a.usuario_id, v_centro)
                         OR EXISTS (SELECT 1 FROM public.roles_usuario r
                                     WHERE r.usuario_id = a.usuario_id AND r.centro_id = v_centro
                                       AND r.deleted_at IS NULL
                                       AND r.rol NOT IN ('tutor_legal', 'autorizado')))) THEN
    RETURN false;
  END IF;

  -- Sus ficheros de remesa (20261220120000): mientras uno con un recibo suyo siga vivo, su IBAN
  -- sigue en él, y la familia espera.
  IF EXISTS (SELECT 1 FROM public.remesa_fichero_adeudos a
               JOIN public.recibos r ON r.id = a.recibo_id
              WHERE r.familia_id = p_familia_id) THEN
    RETURN false;
  END IF;

  IF privado.familia_dinero_pendiente(p_familia_id) THEN
    RETURN false;
  END IF;

  v_pago := privado.familia_ultimo_pago(p_familia_id);
  IF v_pago IS NOT NULL THEN
    RETURN privado.plazo_cumplido(v_pago, p_anios);
  END IF;
  SELECT max(privado.fecha_baja_destruccion(n.id)) INTO v_baja
    FROM public.ninos n WHERE n.familia_id = p_familia_id;
  RETURN v_baja IS NOT NULL AND privado.curso_vencido(v_centro, v_baja, p_anios);
END;
$function$;

-- ---- 7. Cada pasada cuenta también los ficheros ----
ALTER TABLE public.retencion_pasadas DROP CONSTRAINT retencion_pasadas_recuentos_check;
ALTER TABLE public.retencion_pasadas ADD CONSTRAINT retencion_pasadas_recuentos_check
  CHECK (jsonb_typeof(recuentos) = 'object'
         AND recuentos ?& ARRAY['olvido', 'retencion', 'lecturasFichaMedica',
                                'auditLog', 'exportLog', 'listaEspera', 'operativa',
                                'expediente', 'firmas', 'cuentas', 'fiscal',
                                'cuentasOlvidadas', 'ficherosRemesa'])
  NOT VALID;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_t text;
  v_f text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'remesas-ficheros' AND NOT public) THEN
    RAISE EXCEPTION 'el bucket remesas-ficheros no es privado';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
              AND (qual LIKE '%remesas-ficheros%' OR with_check LIKE '%remesas-ficheros%')) THEN
    RAISE EXCEPTION 'hay políticas de Storage para remesas-ficheros';
  END IF;
  FOREACH v_t IN ARRAY ARRAY['public.remesa_ficheros', 'public.remesa_fichero_adeudos'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_t::regclass) THEN
      RAISE EXCEPTION '% sin RLS', v_t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = v_t::regclass) THEN
      RAISE EXCEPTION '% tiene políticas', v_t;
    END IF;
    IF has_table_privilege('authenticated', v_t, 'SELECT')
       OR has_table_privilege('anon', v_t, 'SELECT')
       OR has_table_privilege('service_role', v_t, 'SELECT')
       OR has_table_privilege('service_role', v_t, 'DELETE') THEN
      RAISE EXCEPTION '% tiene privilegios para alguien', v_t;
    END IF;
  END LOOP;
  -- Dirección registra y lee; el barrido es solo de service_role.
  FOREACH v_f IN ARRAY ARRAY['public.registrar_fichero_remesa(uuid,timestamptz,text,text,text,jsonb)',
                             'public.fichero_remesa_vigente(uuid)'] LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_f::regprocedure)
       OR NOT has_function_privilege('authenticated', v_f, 'EXECUTE')
       OR has_function_privilege('anon', v_f, 'EXECUTE')
       OR has_function_privilege('service_role', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION '% no es SECURITY DEFINER solo para authenticated', v_f;
    END IF;
  END LOOP;
  FOREACH v_f IN ARRAY ARRAY['public.ficheros_remesa_vencidos(integer)',
                             'public.destruir_fichero_remesa(uuid,integer)',
                             'public.ficheros_remesa_huerfanos()'] LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_f::regprocedure)
       OR NOT has_function_privilege('service_role', v_f, 'EXECUTE')
       OR has_function_privilege('authenticated', v_f, 'EXECUTE')
       OR has_function_privilege('anon', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION '% no es SECURITY DEFINER solo para service_role', v_f;
    END IF;
  END LOOP;
  IF (SELECT prosrc FROM pg_proc
       WHERE oid = 'privado.familia_fiscal_vencida(uuid,integer)'::regprocedure)
     NOT LIKE '%remesa_fichero_adeudos%' THEN
    RAISE EXCEPTION 'familia_fiscal_vencida no espera a los ficheros de remesa';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'retencion_pasadas_recuentos_check'
                    AND pg_get_constraintdef(oid) LIKE '%ficherosRemesa%') THEN
    RAISE EXCEPTION 'el CHECK de retencion_pasadas no pide ficherosRemesa';
  END IF;
  RAISE NOTICE 'guarda posterior: bucket, dos tablas, cinco funciones y el CHECK de trece claves';
END
$guarda$;
