-- =============================================================================
-- Multicentro · contadores de la barra lateral por centro
--
-- `contar_recordatorios_pendientes()` y `contar_invitaciones_pendientes()` contaban lo del
-- usuario en TODOS sus centros: un profe en A que es tutor en B veía en el badge de A los
-- recordatorios y las invitaciones de B. Viene de la Fase 1 (decisión del responsable,
-- 2026-10-19: se arregla ahora, antes del PR B de la Fase 2).
--
-- 1. Guarda de entrada: las dos funciones son las vivas (md5 de la lógica normalizada: sin \r,
--    sin comentarios, espacios colapsados; calculado en Postgres sobre el cuerpo vivo) y las
--    versiones con centro no existen.
-- 2. Las dos versiones con `p_centro_id`: mismo cuerpo + `centro_id = p_centro_id`. Solo
--    cuentan lo del propio usuario (auth.uid()), así que pedir otro centro no enseña nada ajeno.
-- 3. Fuera las versiones sin centro: si se quedaran, cualquiera podría volver a llamarlas.
-- 4. Guarda de salida: quedan solo las versiones con centro, sin EXECUTE para anon.
--
-- ORDEN: va a producción ANTES del merge. Entre la migración y el despliegue, el código viejo
-- llama a la función sin centro, que ya no existe: los dos badges muestran 0 (la app trata el
-- error como 0 y lo registra) hasta que despliega el código nuevo. No rompe ninguna pantalla.
-- =============================================================================

-- 1. Guarda de entrada.
DO $guarda$
DECLARE
  f text[] := '{}';
  r record;
BEGIN
  FOR r IN SELECT e.nombre, e.esperado,
                  (SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure(format('public.%s()', e.nombre))) AS m
             FROM (VALUES ('contar_recordatorios_pendientes', 'd7b74b1eef85407bda6051200cc830bf'),
                          ('contar_invitaciones_pendientes',  '0f974fde78f6c37e55c4b15965559d1f')) e(nombre, esperado) LOOP
    IF r.m IS DISTINCT FROM r.esperado THEN
      f := f || format('%s() no es la viva esperada (md5 normalizado %s)', r.nombre, coalesce(r.m, 'no existe'));
    END IF;
  END LOOP;
  IF to_regprocedure('public.contar_recordatorios_pendientes(uuid)') IS NOT NULL
     OR to_regprocedure('public.contar_invitaciones_pendientes(uuid)') IS NOT NULL THEN
    f := f || 'las versiones con centro ya existen'::text;
  END IF;
  IF cardinality(f) > 0 THEN
    RAISE EXCEPTION 'guarda de entrada: %', array_to_string(f, ' | ');
  END IF;
  RAISE NOTICE 'guarda de entrada OK: las dos funciones sin centro son las vivas';
END
$guarda$;

-- 2. Versiones con centro.
CREATE FUNCTION public.contar_recordatorios_pendientes(p_centro_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int FROM public.recordatorios r
  WHERE r.centro_id = p_centro_id
    AND r.completado_en IS NULL AND r.erroneo = false
    AND (
      (r.destinatario = 'personal'          AND r.usuario_destinatario_id = auth.uid())
      OR (r.destinatario = 'profe_individual' AND r.usuario_destinatario_id = auth.uid())
      OR (r.destinatario = 'profes_centro'  AND public.es_profe_en_centro(r.centro_id))
      OR (r.destinatario = 'familia_individual' AND r.creado_por <> auth.uid()
           AND public.tiene_permiso_sobre(r.nino_id, 'puede_recibir_mensajes'))
      OR (r.destinatario = 'familias_aula'  AND r.creado_por <> auth.uid()
           AND public.es_tutor_en_aula(r.aula_id))
      OR (r.destinatario = 'familias_centro' AND r.creado_por <> auth.uid()
           AND public.es_tutor_en_centro(auth.uid(), r.centro_id))
    );
$$;

CREATE FUNCTION public.contar_invitaciones_pendientes(p_centro_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
  FROM public.cita_invitados ci
  JOIN public.citas c ON c.id = ci.cita_id
  WHERE c.centro_id = p_centro_id
    AND ci.usuario_id = auth.uid()
    AND ci.estado = 'pendiente'
    AND c.estado = 'programada'
    AND c.organizador_id <> auth.uid()
    AND ((c.fecha + c.hora_inicio) AT TIME ZONE 'Europe/Madrid') > now();
$$;

REVOKE ALL ON FUNCTION public.contar_recordatorios_pendientes(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contar_invitaciones_pendientes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contar_recordatorios_pendientes(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contar_invitaciones_pendientes(uuid) TO authenticated, service_role;

-- 3. Fuera las versiones sin centro.
DROP FUNCTION public.contar_recordatorios_pendientes();
DROP FUNCTION public.contar_invitaciones_pendientes();

-- 4. Guarda de salida.
DO $salida$
DECLARE
  f      text[] := '{}';
  nombre text;
BEGIN
  FOREACH nombre IN ARRAY ARRAY['contar_recordatorios_pendientes', 'contar_invitaciones_pendientes'] LOOP
    IF to_regprocedure(format('public.%s()', nombre)) IS NOT NULL THEN
      f := f || format('%s() sin centro sigue existiendo', nombre);
    END IF;
    IF to_regprocedure(format('public.%s(uuid)', nombre)) IS NULL THEN
      f := f || format('falta %s(uuid)', nombre);
    ELSIF has_function_privilege('anon', format('public.%s(uuid)', nombre), 'EXECUTE') THEN
      f := f || format('anon ejecuta %s(uuid)', nombre);
    ELSIF NOT has_function_privilege('authenticated', format('public.%s(uuid)', nombre), 'EXECUTE') THEN
      f := f || format('authenticated no ejecuta %s(uuid)', nombre);
    END IF;
  END LOOP;
  IF cardinality(f) > 0 THEN
    RAISE EXCEPTION 'guarda de salida: %', array_to_string(f, ' | ');
  END IF;
  RAISE NOTICE 'guarda de salida OK: 2 contadores con centro, 0 sin centro';
END
$salida$;
