-- Las lecturas por función del autorizado (2026-11-11), primera de dos. Spec: docs/specs/altas-serie.md,
-- «El autorizado: lo que ve y lo que no». Decisiones del responsable del 2026-11-11.
--
-- SOLO AÑADE: cuatro funciones nuevas. No quita ningún permiso ni cambia ninguna política. La segunda
-- migración (`20270115130000_fix_autorizado_lee_solo_lo_suyo`) es la que cierra: quita a la sesión el
-- SELECT de las columnas de gestión de `ninos` y del contenido de `firmas_autorizacion`, y reescribe
-- tres políticas. Va partida en dos para que no haya ventana rota:
--   - la app de antes no llama a estas funciones: con esta aplicada, no le cambia nada a nadie;
--   - la app nueva las llama: necesita esta aplicada ANTES de desplegarse;
--   - y la segunda se aplica DESPUÉS del despliegue de la app nueva, que ya no lee de la tabla lo que
--     esa cierra.
--
-- ORDEN: mergear esta → aplicarla → mergear la app y la segunda → esperar el despliegue → aplicar la
-- segunda. Sin COMMIT ni BEGIN: el SQL Editor la envuelve en su transacción.
--
--   - `ficha_gestion_ninos(niños)`: las 14 columnas de gestión de `ninos`, a la Dirección del centro y
--     al tutor legal. Las filas que no le tocan a quien llama no vienen, sin error.
--   - `puede_exportar_nino(niño)`: la puerta de la exportación del niño (Dirección, profe del niño y
--     tutor legal).
--   - `contenido_firmas(firmas)`: el trazo, la IP, el navegador, el nombre tecleado, el comentario y
--     `datos` de una firma, a quien firmó, al tutor legal, a la profe del niño y a la Dirección,
--     respetando el bloqueo de la retención.
--   - `privado.firmo_autorizacion(autorización)`: ¿firmó quien llama? La usa la política de la segunda.

-- ─────────────────────────────────────────────────────────────── guarda previa
DO $guarda$
DECLARE
  v text;
BEGIN
  SELECT string_agg(attname, ',' ORDER BY attname) INTO v
    FROM pg_attribute WHERE attrelid = 'public.ninos'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v IS DISTINCT FROM 'apellidos,centro_id,como_nos_conocio,como_nos_conocio_otro,created_at,deleted_at,deleted_reason,direccion_calle,direccion_ciudad,direccion_cp,direccion_numero,direccion_provincia,dni,estado_civil_familia,familia_id,fecha_nacimiento,foto_url,hermanos_lugar,hermanos_total,id,idioma_principal,libro_familia_path,lugar_nacimiento,nacionalidad,nombre,notas_admin,observaciones_familia,primer_apellido,puede_aparecer_en_fotos,purgado_en,requiere_ambos_firmantes,segundo_apellido,sexo,updated_at' THEN
    RAISE EXCEPTION 'ninos no tiene las columnas esperadas: %', v;
  END IF;

  SELECT string_agg(attname, ',' ORDER BY attname) INTO v
    FROM pg_attribute WHERE attrelid = 'public.firmas_autorizacion'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v IS DISTINCT FROM 'autorizacion_id,comentario,created_at,datos,decision,firma_imagen,firmado_at,firmante_id,id,ip_address,metodo_firma,nino_id,nombre_tecleado,rol_firmante,texto_hash,texto_version,user_agent' THEN
    RAISE EXCEPTION 'firmas_autorizacion no tiene las columnas esperadas: %', v;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc
              WHERE proname IN ('ficha_gestion_ninos', 'puede_exportar_nino', 'contenido_firmas', 'firmo_autorizacion')) THEN
    RAISE EXCEPTION 'alguna función nueva ya existe';
  END IF;
END
$guarda$;

-- ─────────────────────────────────────────────────────────────── ninos
-- Las 14 de gestión, de la Dirección del centro y del tutor legal. Las filas que quien llama no
-- puede leer no salen (ni error): así la app distingue la ausencia (no le toca) del fallo (error).
CREATE FUNCTION public.ficha_gestion_ninos(p_nino_ids uuid[])
RETURNS TABLE (
  nino_id uuid,
  notas_admin text,
  dni text,
  observaciones_familia text,
  direccion_calle text,
  direccion_numero text,
  direccion_cp text,
  direccion_ciudad text,
  direccion_provincia text,
  estado_civil_familia public.estado_civil,
  libro_familia_path text,
  hermanos_total smallint,
  hermanos_lugar smallint,
  como_nos_conocio text,
  como_nos_conocio_otro text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT n.id, n.notas_admin, n.dni, n.observaciones_familia, n.direccion_calle, n.direccion_numero,
         n.direccion_cp, n.direccion_ciudad, n.direccion_provincia, n.estado_civil_familia,
         n.libro_familia_path, n.hermanos_total, n.hermanos_lugar, n.como_nos_conocio,
         n.como_nos_conocio_otro
    FROM public.ninos n
   WHERE n.id = ANY (p_nino_ids)
     AND auth.uid() IS NOT NULL
     AND (public.es_admin(n.centro_id) OR public.es_tutor_legal_de(n.id));
$function$;

REVOKE ALL ON FUNCTION public.ficha_gestion_ninos(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ficha_gestion_ninos(uuid[]) TO authenticated;

-- La exportación del niño (art. 15): la Dirección del centro, la profe del niño (su exportación por
-- sesión, sin las columnas de gestión) y el tutor legal. El autorizado, no.
CREATE FUNCTION public.puede_exportar_nino(p_nino_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND privado.centro_de_nino(p_nino_id) IS NOT NULL
     AND (public.es_admin(privado.centro_de_nino(p_nino_id))
          OR public.es_profe_de_nino(p_nino_id)
          OR public.es_tutor_legal_de(p_nino_id));
$function$;

REVOKE ALL ON FUNCTION public.puede_exportar_nino(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.puede_exportar_nino(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────── firmas_autorizacion
-- El contenido de la firma: quien firmó, el tutor legal del niño, la profe del niño y la Dirección.
-- Respeta el bloqueo de la retención (`privado.firma_bloqueada`), como la política RESTRICTIVE.
CREATE FUNCTION public.contenido_firmas(p_firma_ids uuid[])
RETURNS TABLE (
  firma_id uuid,
  nombre_tecleado text,
  firma_imagen text,
  ip_address inet,
  user_agent text,
  comentario text,
  datos jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT f.id, f.nombre_tecleado, f.firma_imagen, f.ip_address, f.user_agent, f.comentario, f.datos
    FROM public.firmas_autorizacion f
   WHERE f.id = ANY (p_firma_ids)
     AND auth.uid() IS NOT NULL
     AND NOT privado.firma_bloqueada(f.nino_id, f.firmante_id)
     AND (f.firmante_id = auth.uid()
          OR public.es_tutor_legal_de(f.nino_id)
          OR public.es_profe_de_nino(f.nino_id)
          OR public.es_admin(privado.centro_de_nino(f.nino_id)));
$function$;

REVOKE ALL ON FUNCTION public.contenido_firmas(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contenido_firmas(uuid[]) TO authenticated;

-- ─────────────────────────────────────────────────────────────── autorizaciones
-- ¿Firmó quien llama esta autorización? Lee `firmas_autorizacion` (otra tabla: sin el problema de
-- MVCC de `INSERT … RETURNING` sobre `autorizaciones`).
CREATE FUNCTION privado.firmo_autorizacion(p_autorizacion_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.firmas_autorizacion
                  WHERE autorizacion_id = p_autorizacion_id AND firmante_id = auth.uid());
$function$;

REVOKE ALL ON FUNCTION privado.firmo_autorizacion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION privado.firmo_autorizacion(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────── guarda posterior
DO $guarda$
BEGIN
  -- Las cuatro: SECURITY DEFINER, nada para anon ni PUBLIC, y la sesión las ejecuta.
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.oid IN ('public.ficha_gestion_ninos(uuid[])'::regprocedure,
                       'public.puede_exportar_nino(uuid)'::regprocedure,
                       'public.contenido_firmas(uuid[])'::regprocedure,
                       'privado.firmo_autorizacion(uuid)'::regprocedure)
         AND p.prosecdef
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) <> 4 THEN
    RAISE EXCEPTION 'alguna función nueva no tiene la forma esperada';
  END IF;

  -- Nada cerrado todavía: la sesión sigue leyendo las dos tablas enteras (lo cierra la segunda).
  IF NOT has_table_privilege('authenticated', 'public.ninos', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.firmas_autorizacion', 'SELECT') THEN
    RAISE EXCEPTION 'esta migración no quita permisos, y falta el SELECT de una tabla';
  END IF;
END
$guarda$;
