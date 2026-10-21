-- =============================================================================
-- FEAT — Fase 5, PR 1: las métricas del panel de plataforma (`platform_metricas`)
-- -----------------------------------------------------------------------------
-- El panel del superusuario (`/plataforma`) enseña, por cada centro vivo, recuentos y alertas.
-- Solo recuentos: ningún nombre de niño, familia ni persona. Por eso no se audita que el
-- superusuario mire el panel (decisión del responsable); su entrada en un centro sí, con
-- `elegirCentro` → `registrar_entrada_superusuario`.
--
-- Lección de MisterFC (BC-8): un contador que incluye bajas, archivados o retirados miente, y aquí
-- hay filas retiradas por media base de datos (la unicidad cuenta solo las vivas, `20261102120000`).
-- Cada recuento lleva su predicado de «activo» escrito y cuenta PERSONAS (o niños, familias, aulas)
-- DISTINTAS con fila viva, nunca filas:
--
--   · ninos_matriculados: niños vivos con matrícula `activa` viva (sin baja ni borrado) en el curso
--     activo del centro (el predicado de `matricula-activa.ts`).
--   · ninos_en_alta: niños vivos con matrícula `pendiente` o `lista` viva en el curso activo y sin
--     matrícula activa en él. Aparte: un niño en pleno alta no es un matriculado.
--   · familias: familias vivas con al menos un niño matriculado.
--   · personal: personas con rol `profe` vivo en el centro.
--   · personal_baja_temporal: personas sin rol `profe` vivo cuya última fila `profe` retirada es
--     `baja_temporal` (las que `reactivar_profe` devolvería). Aparte: no es personal disponible.
--   · direccion: personas con rol `admin` o `directora` vivo.
--   · aulas: aulas vivas con configuración en el curso activo.
--   · invitaciones_pendientes: sin aceptar, sin rechazar y sin caducar.
--   · Alertas (las que dejan un centro bloqueado): `sin_admin` (ninguna admin viva),
--     `sin_curso_activo`, e `invitacion_admin` ('pendiente' o 'caducada': la última invitación de
--     admin sin aceptar ni rechazar, solo si el centro no tiene admin; con admin viva no se puede
--     aceptar otra).
--   · Solo centros vivos (`deleted_at IS NULL`).
--
-- `SECURITY DEFINER` (cuenta en todos los centros, por encima de la RLS) y su PRIMERA sentencia es
-- `is_superadmin()`: si no, 42501. Nunca `es_admin(NULL)`, que da TRUE a cualquier persona de
-- Dirección de cualquier centro. Sin `EXECUTE` para `anon` ni `PUBLIC`.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor, DESPUÉS de
-- `20261102120000`. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF to_regprocedure('public.platform_metricas()') IS NOT NULL THEN
    RAISE EXCEPTION 'platform_metricas ya existe';
  END IF;
  -- La puerta de la que depende todo: is_superadmin, con la lógica que se leyó en producción
  -- (md5 normalizado: sin \r, sin comentarios, espacios colapsados).
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.is_superadmin()');
  IF v_md5 IS DISTINCT FROM 'e5b750968737756e992fc03aacc862d6' THEN
    RAISE EXCEPTION 'is_superadmin no es la leída en producción: %', coalesce(v_md5, 'falta');
  END IF;
  -- Los valores de enum que usan los predicados.
  IF (SELECT count(*) FROM pg_enum WHERE enumtypid = 'public.matricula_estado'::regtype
        AND enumlabel IN ('activa', 'pendiente', 'lista')) <> 3
     OR (SELECT count(*) FROM pg_enum WHERE enumtypid = 'public.user_role'::regtype
        AND enumlabel IN ('admin', 'directora', 'profe')) <> 3
     OR (SELECT count(*) FROM pg_enum WHERE enumtypid = 'public.motivo_borrado'::regtype
        AND enumlabel = 'baja_temporal') <> 1
     OR (SELECT count(*) FROM pg_enum WHERE enumtypid = 'public.curso_estado'::regtype
        AND enumlabel = 'activo') <> 1 THEN
    RAISE EXCEPTION 'faltan valores de enum que usan los recuentos';
  END IF;
  RAISE NOTICE 'guarda previa: platform_metricas no existe; is_superadmin es la de producción';
END
$guarda$;

CREATE FUNCTION public.platform_metricas()
RETURNS TABLE (
  centro_id uuid,
  nombre text,
  curso_activo text,
  ninos_matriculados integer,
  ninos_en_alta integer,
  familias integer,
  personal integer,
  personal_baja_temporal integer,
  direccion integer,
  aulas integer,
  invitaciones_pendientes integer,
  sin_admin boolean,
  sin_curso_activo boolean,
  invitacion_admin text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Solo la plataforma ve las métricas de los centros' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.nombre::text,
    cu.nombre::text,
    -- Niños vivos con matrícula activa viva en el curso activo.
    (SELECT count(DISTINCT m.nino_id)::integer
       FROM public.matriculas m
       JOIN public.ninos n ON n.id = m.nino_id
      WHERE m.curso_academico_id = cu.id
        AND m.estado = 'activa' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
        AND n.centro_id = c.id AND n.deleted_at IS NULL),
    -- Niños vivos en pleno alta (pendiente o lista) en el curso activo, sin matrícula activa en él.
    (SELECT count(DISTINCT m.nino_id)::integer
       FROM public.matriculas m
       JOIN public.ninos n ON n.id = m.nino_id
      WHERE m.curso_academico_id = cu.id
        AND m.estado IN ('pendiente', 'lista') AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
        AND n.centro_id = c.id AND n.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.matriculas ma
           WHERE ma.nino_id = m.nino_id AND ma.curso_academico_id = cu.id
             AND ma.estado = 'activa' AND ma.fecha_baja IS NULL AND ma.deleted_at IS NULL)),
    -- Familias vivas con al menos un niño matriculado.
    (SELECT count(DISTINCT f.id)::integer
       FROM public.matriculas m
       JOIN public.ninos n ON n.id = m.nino_id
       JOIN public.familias f ON f.id = n.familia_id
      WHERE m.curso_academico_id = cu.id
        AND m.estado = 'activa' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
        AND n.centro_id = c.id AND n.deleted_at IS NULL
        AND f.deleted_at IS NULL),
    -- Personas con rol profe vivo.
    (SELECT count(DISTINCT r.usuario_id)::integer
       FROM public.roles_usuario r
      WHERE r.centro_id = c.id AND r.rol = 'profe' AND r.deleted_at IS NULL),
    -- Personas sin rol profe vivo cuya última fila profe retirada es baja_temporal.
    (SELECT count(*)::integer
       FROM (SELECT DISTINCT ON (r.usuario_id) r.usuario_id, r.deleted_reason
               FROM public.roles_usuario r
              WHERE r.centro_id = c.id AND r.rol = 'profe' AND r.deleted_at IS NOT NULL
              ORDER BY r.usuario_id, r.deleted_at DESC) ultima
      WHERE ultima.deleted_reason = 'baja_temporal'
        AND NOT EXISTS (
          SELECT 1 FROM public.roles_usuario v
           WHERE v.centro_id = c.id AND v.usuario_id = ultima.usuario_id
             AND v.rol = 'profe' AND v.deleted_at IS NULL)),
    -- Personas con rol admin o directora vivo.
    (SELECT count(DISTINCT r.usuario_id)::integer
       FROM public.roles_usuario r
      WHERE r.centro_id = c.id AND r.rol IN ('admin', 'directora') AND r.deleted_at IS NULL),
    -- Aulas vivas configuradas en el curso activo.
    (SELECT count(DISTINCT a.id)::integer
       FROM public.aulas a
       JOIN public.aulas_curso ac ON ac.aula_id = a.id
      WHERE a.centro_id = c.id AND a.deleted_at IS NULL AND ac.curso_academico_id = cu.id),
    -- Invitaciones sin aceptar, sin rechazar y sin caducar.
    (SELECT count(*)::integer
       FROM public.invitaciones i
      WHERE i.centro_id = c.id AND i.accepted_at IS NULL AND i.rejected_at IS NULL
        AND i.expires_at > now()),
    -- Alertas.
    NOT EXISTS (SELECT 1 FROM public.roles_usuario r
                 WHERE r.centro_id = c.id AND r.rol = 'admin' AND r.deleted_at IS NULL),
    cu.id IS NULL,
    CASE
      WHEN EXISTS (SELECT 1 FROM public.roles_usuario r
                    WHERE r.centro_id = c.id AND r.rol = 'admin' AND r.deleted_at IS NULL) THEN NULL
      ELSE (SELECT CASE WHEN i.expires_at > now() THEN 'pendiente' ELSE 'caducada' END
              FROM public.invitaciones i
             WHERE i.centro_id = c.id AND i.rol_objetivo = 'admin'
               AND i.accepted_at IS NULL AND i.rejected_at IS NULL
             ORDER BY i.created_at DESC
             LIMIT 1)
    END
  FROM public.centros c
  LEFT JOIN public.cursos_academicos cu
    ON cu.centro_id = c.id AND cu.estado = 'activo' AND cu.deleted_at IS NULL
  WHERE c.deleted_at IS NULL
  ORDER BY c.nombre, c.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_metricas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_metricas() TO authenticated;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_f constant regprocedure := 'public.platform_metricas()'::regprocedure;
  v_md5 text;
  v_src text;
BEGIN
  -- La lógica de este fichero (md5 normalizado), calculada en Postgres sobre el cuerpo creado.
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')),
         p.prosrc
    INTO v_md5, v_src
    FROM pg_proc p WHERE p.oid = v_f;
  IF v_md5 IS DISTINCT FROM '1ee1f8018847b6fc364eb6760817442c' THEN
    RAISE EXCEPTION 'platform_metricas no quedó como este fichero: %', v_md5;
  END IF;
  -- La primera sentencia es la puerta del superusuario (y no es_admin).
  IF regexp_replace(regexp_replace(replace(v_src, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')
     !~ '^ ?#variable_conflict use_column BEGIN IF NOT public\.is_superadmin\(\) THEN RAISE EXCEPTION' THEN
    RAISE EXCEPTION 'la primera sentencia de platform_metricas no es la puerta is_superadmin';
  END IF;
  IF v_src ~ 'es_admin' THEN
    RAISE EXCEPTION 'platform_metricas no puede usar es_admin';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_f) THEN
    RAISE EXCEPTION 'platform_metricas no es SECURITY DEFINER';
  END IF;
  IF (SELECT proconfig FROM pg_proc WHERE oid = v_f) IS DISTINCT FROM ARRAY['search_path=public'] THEN
    RAISE EXCEPTION 'platform_metricas sin search_path = public';
  END IF;
  IF has_function_privilege('anon', v_f, 'EXECUTE') OR has_function_privilege('public', v_f, 'EXECUTE') THEN
    RAISE EXCEPTION 'platform_metricas abierta a anon o a PUBLIC';
  END IF;
  IF NOT has_function_privilege('authenticated', v_f, 'EXECUTE') THEN
    RAISE EXCEPTION 'platform_metricas no la puede ejecutar authenticated';
  END IF;
  RAISE NOTICE 'guarda posterior: platform_metricas con la puerta is_superadmin; solo authenticated';
END
$guarda$;
