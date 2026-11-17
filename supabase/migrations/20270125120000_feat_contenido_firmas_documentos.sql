-- El contenido de las firmas de los documentos del centro, por función (2026-11-16), primera de dos.
-- Spec: docs/specs/altas-serie.md, «Las cuatro de gravedad media y baja». Criterio de las firmas de
-- autorización (opción b, 2026-11-11): la fila se ve —quién firmó, en calidad de qué y cuándo—; el
-- trazo, la IP, el navegador y el nombre tecleado, solo por función.
--
-- SOLO AÑADE: una función nueva. No quita ningún permiso ni cambia ninguna política. La segunda
-- migración es la que cierra: quita a la sesión el SELECT de esas cuatro columnas. Va partida en dos
-- para que no haya ventana rota, como la 20270115120000 / 20270115130000:
--   - la app de antes no llama a esta función: con esta aplicada, no le cambia nada a nadie;
--   - la app nueva la llama (la exportación del niño y la del usuario): necesita esta aplicada ANTES
--     de desplegarse;
--   - y la segunda se aplica DESPUÉS del despliegue de la app nueva, que ya no lee de la tabla lo que
--     esa cierra.
--
-- ORDEN: mergear esta → aplicarla → mergear la app y la segunda → esperar el despliegue → aplicar la
-- segunda. Sin COMMIT ni BEGIN: el SQL Editor la envuelve en su transacción.

-- ─────────────────────────────────────────────────────────────── guarda previa
DO $guarda$
DECLARE
  v text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20270124120000') THEN
    RAISE EXCEPTION 'falta la 20270124120000 en el registro';
  END IF;

  SELECT string_agg(attname, ',' ORDER BY attname) INTO v
    FROM pg_attribute WHERE attrelid = 'public.firmas_documentos_centro'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v IS DISTINCT FROM 'centro_id,curso_academico_id,curso_nombre,documento_id,firma_imagen,firmado_at,firmante_id,id,ip_address,metodo_firma,nino_id,nombre_tecleado,numero,rol_firmante,sha256,titulo,user_agent,version_id' THEN
    RAISE EXCEPTION 'firmas_documentos_centro no tiene las columnas esperadas: %', v;
  END IF;

  IF to_regprocedure('privado.firma_bloqueada(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'falta privado.firma_bloqueada(uuid, uuid)';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'contenido_firmas_documentos') THEN
    RAISE EXCEPTION 'la función nueva ya existe';
  END IF;
END
$guarda$;

-- ─────────────────────────────────────────────────────────────── firmas_documentos_centro
-- El contenido de la firma: quien firmó, el tutor legal del niño y la Dirección. La profe no: la
-- tabla ya no se la dejaba leer (3b, `firmas_documentos_centro_select`), y esta función no amplía a
-- nadie lo que la política ya da; solo quita al autorizado lo personal. Respeta el bloqueo de la retención (`privado.firma_bloqueada`), como la política RESTRICTIVE de la
-- tabla. Las firmas que quien llama no puede leer no salen (ni error), como `contenido_firmas`.
CREATE FUNCTION public.contenido_firmas_documentos(p_firma_ids uuid[])
RETURNS TABLE (
  firma_id uuid,
  nombre_tecleado text,
  firma_imagen text,
  ip_address inet,
  user_agent text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT f.id, f.nombre_tecleado, f.firma_imagen, f.ip_address, f.user_agent
    FROM public.firmas_documentos_centro f
   WHERE f.id = ANY (p_firma_ids)
     AND auth.uid() IS NOT NULL
     AND NOT privado.firma_bloqueada(f.nino_id, f.firmante_id)
     AND (f.firmante_id = auth.uid()
          OR public.es_tutor_legal_de(f.nino_id)
          OR public.es_admin(privado.centro_de_nino(f.nino_id)));
$function$;

REVOKE ALL ON FUNCTION public.contenido_firmas_documentos(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contenido_firmas_documentos(uuid[]) TO authenticated;

-- ─────────────────────────────────────────────────────────────── guarda posterior
DO $guarda$
BEGIN
  -- SECURITY DEFINER, nada para anon, y la sesión la ejecuta.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = 'public.contenido_firmas_documentos(uuid[])'::regprocedure
                    AND p.prosecdef
                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'la función nueva no tiene la forma esperada';
  END IF;

  -- Nada cerrado todavía: la sesión sigue leyendo las cuatro columnas (lo cierra la segunda).
  IF NOT has_column_privilege('authenticated', 'public.firmas_documentos_centro', 'firma_imagen', 'SELECT') THEN
    RAISE EXCEPTION 'esta migración no quita permisos, y falta el SELECT de firma_imagen';
  END IF;
END
$guarda$;
