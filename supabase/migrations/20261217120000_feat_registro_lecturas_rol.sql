-- =============================================================================
-- FEAT — El registro de lecturas de la ficha médica: al tutor, el rol del personal; a Dirección,
-- el nombre
-- -----------------------------------------------------------------------------
-- La decisión de Jose del 2026-11-01 (R4) es por QUIÉN MIRA, no por qué pantalla: el nombre de
-- una trabajadora es un dato suyo, y lo que se da a la familia se puede reenviar (art. 15.4).
-- El export del niño ya da solo el rol (20261216120000); esta es la misma raya en la otra puerta,
-- `lecturas_ficha_medica(niño)`, que alimenta la pantalla del registro y el imprimible:
--   - quien mira es Dirección del centro del niño (`es_admin`: la titular, la directora y el
--     superusuario): el nombre, como hasta ahora;
--   - quien mira es un tutor legal: el nombre solo si quien leyó es de la familia del niño
--     (`rol_lector` tutor_legal o autorizado); del personal del centro y del soporte, el rol, que
--     ya salía.
-- La columna nueva `nombre_oculto` distingue el nombre que no se da del de una cuenta borrada (los
-- dos llegan como NULL): sin ella, la pantalla diría «cuenta borrada» de una profe que existe.
-- Cambia lo que devuelve la función, así que se borra y se crea, con los mismos permisos.
--
-- La otra vía con el nombre, `privado.contenido_bloqueado`, solo la usa `ver_datos_bloqueados`,
-- que es de la titular. La aplica el responsable por SQL Editor. Sin BEGIN ni COMMIT. Tras aplicar:
-- registrar en supabase_migrations.schema_migrations.
--
-- ORDEN: mergear, esperar el despliegue, aplicar. La app nueva sin la columna enseña lo de antes;
-- la app vieja con la función nueva diría «cuenta borrada» de la profe a la familia.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.lecturas_ficha_medica(uuid)');
  IF v_md5 = 'e25470eb86027ae99af5712a0ffc41dc' THEN
    RAISE EXCEPTION 'ya aplicada: lecturas_ficha_medica ya es la de 20261217120000';
  END IF;
  -- Lo que se borra es lo que hay, tal como quedó (20261205120000).
  IF v_md5 IS DISTINCT FROM '97ce37b4e6abae90687206d15d85fb26' THEN
    RAISE EXCEPTION 'lecturas_ficha_medica no es la de 20261205120000: %', coalesce(v_md5, 'falta');
  END IF;
  RAISE NOTICE 'guarda previa: % lecturas, % del personal o del soporte (las que un tutor verá sin nombre)',
    (SELECT count(*) FROM public.lecturas_ficha_medica),
    (SELECT count(*) FROM public.lecturas_ficha_medica WHERE rol_lector NOT IN ('tutor_legal', 'autorizado'));
END
$guarda$;

DROP FUNCTION public.lecturas_ficha_medica(uuid);

CREATE FUNCTION public.lecturas_ficha_medica(p_nino_id uuid)
 RETURNS TABLE(leida_en timestamp with time zone, lector_nombre text, nombre_oculto boolean,
               rol_lector text, origen text, campos text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro uuid;
  v_direccion boolean;
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
  -- R4 (2026-11-01): a Dirección, el nombre; al tutor, el del personal no (queda su rol).
  v_direccion := public.es_admin(v_centro);
  RETURN QUERY
  SELECT l.leida_en,
         CASE WHEN v_direccion OR l.rol_lector IN ('tutor_legal', 'autorizado')
              THEN u.nombre_completo END,
         NOT (v_direccion OR l.rol_lector IN ('tutor_legal', 'autorizado')),
         l.rol_lector, l.origen, l.campos
    FROM public.lecturas_ficha_medica l
    LEFT JOIN public.usuarios u ON u.id = l.lector_id
   WHERE l.nino_id = p_nino_id
   ORDER BY l.leida_en DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.lecturas_ficha_medica(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lecturas_ficha_medica(uuid) TO authenticated, service_role;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_md5 text;
  v_f   text := 'public.lecturas_ficha_medica(uuid)';
BEGIN
  SELECT md5(regexp_replace(regexp_replace(replace(prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc WHERE oid = v_f::regprocedure;
  IF v_md5 IS DISTINCT FROM 'e25470eb86027ae99af5712a0ffc41dc' THEN
    RAISE EXCEPTION 'lecturas_ficha_medica no quedó como en este fichero: %', v_md5;
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_f::regprocedure)
     OR (SELECT proconfig FROM pg_proc WHERE oid = v_f::regprocedure) IS DISTINCT FROM ARRAY['search_path=public'] THEN
    RAISE EXCEPTION 'lecturas_ficha_medica dejó de ser SECURITY DEFINER con search_path=public';
  END IF;
  IF NOT has_function_privilege('authenticated', v_f, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_f, 'EXECUTE')
     OR has_function_privilege('anon', v_f, 'EXECUTE') THEN
    RAISE EXCEPTION 'lecturas_ficha_medica no tiene los permisos de antes';
  END IF;
  IF (SELECT pg_get_function_result(v_f::regprocedure)) IS DISTINCT FROM
     'TABLE(leida_en timestamp with time zone, lector_nombre text, nombre_oculto boolean, rol_lector text, origen text, campos text[])' THEN
    RAISE EXCEPTION 'lecturas_ficha_medica no devuelve lo que lee la app: %',
      pg_get_function_result(v_f::regprocedure);
  END IF;
  RAISE NOTICE 'guarda posterior: lecturas_ficha_medica %', v_md5;
END
$guarda$;
