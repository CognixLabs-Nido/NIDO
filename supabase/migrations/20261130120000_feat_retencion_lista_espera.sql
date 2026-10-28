-- =============================================================================
-- FEAT — La lista de espera a 1 año (F11-B, punto 6, PR-3)
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/retencion-plazos.md (`RETENCION_LISTA_ESPERA_ANIOS`, provisional). Un
-- prospecto que no llegó a alta se borra un año después de que deja de estar viva; el que llegó
-- (con `nino_id`) sigue al expediente del niño. Hasta ahora no tenía plazo.
--
-- «Deja de estar viva»: cuando se descarta, o cuando termina el curso para el que se apuntó, lo
-- que pase antes. Ahora:
--
--   · `lista_espera.descartado_at`: cuándo se descartó. Lo fija un trigger al pasar a
--     `descartado` y lo quita si sale de ahí; un CHECK lo ata al estado. Los descartados que ya
--     había toman su `updated_at` (la última vez que se tocaron, que es el descarte o después).
--   · `purgar_lista_espera_vencida(años, simular)`, para el cron: borra los prospectos sin niño
--     cuyo fin de vida (descarte o final del curso, el primero) tiene más de esos años. Sin humano
--     y con `app.borrar_sin_copia`: se llevan sus copias en audit_log (20261129120000).
--
-- La aplica el responsable por SQL Editor, DESPUÉS de `20261129120000`. Sin orden con el
-- despliegue: el código nuevo solo llama a la función nueva desde el cron, y si falla, el cron
-- lo registra y sigue. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_n   integer;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'lista_espera'
                AND column_name = 'descartado_at') THEN
    RAISE EXCEPTION 'ya aplicada: lista_espera tiene descartado_at';
  END IF;
  IF to_regprocedure('public.purgar_audit_log(integer,boolean)') IS NULL THEN
    RAISE EXCEPTION 'falta 20261129120000: no existe purgar_audit_log';
  END IF;

  -- El borrado sin copia depende del trigger de 20261129120000, tal como quedó.
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.audit_trigger_function()');
  IF v_md5 IS DISTINCT FROM '66dd84be5ede18ca18cec3f9af1e926d' THEN
    RAISE EXCEPTION 'audit_trigger_function no es la de 20261129120000: %', coalesce(v_md5, 'falta');
  END IF;

  SELECT count(*) INTO v_n FROM public.lista_espera WHERE estado = 'descartado';
  RAISE NOTICE 'guarda previa: % prospectos descartados a fechar', v_n;
END
$guarda$;

-- ---- 1. Cuándo se descartó ----
ALTER TABLE public.lista_espera ADD COLUMN descartado_at timestamptz;

COMMENT ON COLUMN public.lista_espera.descartado_at IS
  'Cuándo se descartó el prospecto (F11-B, punto 6). Lo fija lista_espera_fijar_descartado_at; NULL si no está descartado. Cuenta el plazo de purgar_lista_espera_vencida (20261130120000).';

DO $relleno$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.lista_espera SET descartado_at = updated_at WHERE estado = 'descartado';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'relleno: % descartados fechados con su updated_at', v_n;
END
$relleno$;

ALTER TABLE public.lista_espera ADD CONSTRAINT lista_espera_descartado_at
  CHECK ((estado = 'descartado') = (descartado_at IS NOT NULL));

CREATE FUNCTION privado.lista_espera_fijar_descartado_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.estado = 'descartado' THEN
    IF TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'descartado' THEN
      NEW.descartado_at := now();
    END IF;
  ELSE
    NEW.descartado_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION privado.lista_espera_fijar_descartado_at() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER lista_espera_fijar_descartado_at
  BEFORE INSERT OR UPDATE OF estado ON public.lista_espera
  FOR EACH ROW EXECUTE FUNCTION privado.lista_espera_fijar_descartado_at();

-- ---- 2. El plazo (provisional, lo pasa el cron) ----
-- Los vencidos, en un solo sitio para la simulación y el borrado. Fin de vida: el descarte o el
-- día siguiente al final del curso (hora de Madrid), el primero. Un prospecto con niño no entra:
-- sigue al expediente.
CREATE FUNCTION privado.lista_espera_vencida(p_anios integer)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT l.id
    FROM public.lista_espera l
    JOIN public.cursos_academicos c ON c.id = l.curso_academico_id
   WHERE l.nino_id IS NULL
     AND LEAST(l.descartado_at, (c.fecha_fin + 1)::timestamp AT TIME ZONE 'Europe/Madrid')
         < now() - make_interval(years => p_anios);
$function$;
REVOKE ALL ON FUNCTION privado.lista_espera_vencida(integer) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.purgar_lista_espera_vencida(p_anios integer, p_simular boolean)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_n integer;
BEGIN
  IF p_anios IS NULL OR p_anios < 1 OR p_simular IS NULL THEN
    RAISE EXCEPTION 'plazo de la lista de espera no válido' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_simular THEN
    SELECT count(*) INTO v_n FROM privado.lista_espera_vencida(p_anios);
  ELSE
    PERFORM set_config('app.audit_actor', 'system:purgar_lista_espera_vencida', true);
    PERFORM set_config('app.borrar_sin_copia', 'on', true);
    DELETE FROM public.lista_espera
     WHERE id IN (SELECT privado.lista_espera_vencida(p_anios));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM set_config('app.borrar_sin_copia', '', true);
    PERFORM set_config('app.audit_actor', '', true);
  END IF;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.purgar_lista_espera_vencida(integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purgar_lista_espera_vencida(integer, boolean) TO service_role;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_sin_fecha integer;
  v_vencidos  integer;
BEGIN
  IF has_function_privilege('authenticated', 'public.purgar_lista_espera_vencida(integer,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.purgar_lista_espera_vencida(integer,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'privado.lista_espera_fijar_descartado_at()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'privado.lista_espera_vencida(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'una función de la lista de espera quedó abierta a quien no toca';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc
           WHERE oid = 'public.purgar_lista_espera_vencida(integer,boolean)'::regprocedure) THEN
    RAISE EXCEPTION 'purgar_lista_espera_vencida tiene que ser SECURITY DEFINER';
  END IF;

  SELECT count(*) INTO v_sin_fecha FROM public.lista_espera
   WHERE estado = 'descartado' AND descartado_at IS NULL;
  IF v_sin_fecha <> 0 THEN
    RAISE EXCEPTION '% descartados sin fecha', v_sin_fecha;
  END IF;
  v_vencidos := public.purgar_lista_espera_vencida(1, true);
  RAISE NOTICE 'guarda posterior: descartados todos fechados; % prospectos vencidos a 1 año (simulado)', v_vencidos;
END
$guarda$;
