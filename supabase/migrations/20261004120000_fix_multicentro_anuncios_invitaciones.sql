-- =============================================================================
-- FIX — multi-centro: anuncios (R3) e invitaciones (R2) no cruzan de centro
-- -----------------------------------------------------------------------------
-- R2 — `invitaciones`: la policy `invitaciones_admin` (FOR ALL, es_admin(centro_id), sin WITH
-- CHECK propio) deja a un admin del centro A escribir por PostgREST una invitación con
-- `centro_id = A` y el `nino_id` / `aula_id` del centro B. Al aceptarla, accept-invitation crea
-- con service role el vínculo (`vinculos_familiares`) o la asignación (`profes_aulas`) en el
-- centro B. Validarlo solo en `sendInvitation` no basta: trigger BEFORE INSERT OR UPDATE que
-- exige niño ∈ centro y aula ∈ centro (al final de esta migración). 4 filas en producción a
-- 2026-10-04, 0 cruzadas.
--
-- R3 — anuncios:
-- La rama admin de `anuncios_insert` solo pedía `es_admin(centro_id)`: un admin del centro A
-- podía insertar `{centro_id: A, ambito: 'aula', aula_id: <aula del centro B>}`. Tres puntos de
-- filtración, los tres se cierran aquí o en la app:
--   1. INSERT  — la policy lo aceptaba (esta migración endurece SOLO la rama admin).
--   2. LECTURA — `usuario_es_audiencia_anuncio_row` (policy `anuncios_select`) y su gemelo por id
--      `usuario_es_audiencia_anuncio` (lectura_anuncio) dejaban ver el anuncio a la profe y a las
--      familias del aula de B (rama 'aula' sin comprobar centro). Se añade SOLO esa comprobación.
--   3. PUSH    — `destinatariosPushDeAnuncio` notificaba a las familias del aula de B (app:
--      features/push/lib/audiencia.ts filtra las aulas objetivo por centro).
-- Más un trigger BEFORE INSERT OR UPDATE que exige aula ∈ centro para TODOS (también service
-- role y dueño con BYPASSRLS): sin filas incoherentes, las lecturas nunca pueden filtrar.
--
-- Equivalencia (caso normal de UN centro, donde el aula siempre es del centro):
--   - policy: la rama profe queda literalmente igual; la admin solo añade
--     `aula_id IS NULL OR centro_de_aula(aula_id) = centro_id`, siempre cierto en un centro.
--   - helpers: cuerpo vivo (pg_get_functiondef) + el bloque marcado "R3 (añadido)". Las guardas
--     de abajo exigen el md5 del cuerpo vivo ANTES y que, quitando el bloque añadido, el nuevo
--     cuerpo sea byte a byte el anterior DESPUÉS.
--
-- `anuncios` está vacía en producción a 2026-10-04 → no hay filas previas que contrastar.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor (CLI SIGILL
-- en ARM). Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa: lo que se va a tocar es exactamente lo que se auditó ----
DO $guarda$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.usuario_es_audiencia_anuncio_row(uuid, uuid, public.ambito_anuncio, uuid)'::regprocedure)
     IS DISTINCT FROM '2c2e4d7924bda3d0f943cd2ac2c7d814' THEN
    RAISE EXCEPTION 'R3: usuario_es_audiencia_anuncio_row ha cambiado desde la auditoría; revisar antes de aplicar';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.usuario_es_audiencia_anuncio(uuid)'::regprocedure)
     IS DISTINCT FROM 'f781db1fd0c1b641bf9ee24370b25bd3' THEN
    RAISE EXCEPTION 'R3: usuario_es_audiencia_anuncio ha cambiado desde la auditoría; revisar antes de aplicar';
  END IF;
  IF (SELECT with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'anuncios' AND policyname = 'anuncios_insert')
     IS DISTINCT FROM '((autor_id = auth.uid()) AND (es_admin(centro_id) OR ((ambito = ''aula''::ambito_anuncio) AND (aula_id IS NOT NULL) AND es_profe_de_aula(aula_id) AND (centro_de_aula(aula_id) = centro_id))))' THEN
    RAISE EXCEPTION 'R3: anuncios_insert ha cambiado desde la auditoría; revisar antes de aplicar';
  END IF;
END
$guarda$;

-- ---- 1. INSERT: endurecer SOLO la rama admin (la rama profe, intacta) ----
ALTER POLICY anuncios_insert ON public.anuncios
  WITH CHECK (
    autor_id = auth.uid()
    AND (
      (public.es_admin(centro_id) AND (aula_id IS NULL OR public.centro_de_aula(aula_id) = centro_id))
      OR (
        ambito = 'aula'::public.ambito_anuncio
        AND aula_id IS NOT NULL
        AND public.es_profe_de_aula(aula_id)
        AND public.centro_de_aula(aula_id) = centro_id
      )
    )
  );

-- ---- 2. LECTURA: helpers de audiencia (cuerpo vivo + bloque "R3 (añadido)") ----
CREATE OR REPLACE FUNCTION public.usuario_es_audiencia_anuncio_row(p_centro_id uuid, p_autor_id uuid, p_ambito ambito_anuncio, p_aula_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_usuario uuid := auth.uid();
BEGIN
  IF v_usuario IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Admin del centro: siempre
  IF public.es_admin(p_centro_id) THEN
    RETURN TRUE;
  END IF;

  -- Autor del anuncio: siempre (defensa en profundidad)
  IF p_autor_id = v_usuario THEN
    RETURN TRUE;
  END IF;

  -- Ámbito 'aula'
  IF p_ambito = 'aula' THEN
    -- R3 (añadido): el aula tiene que ser del centro del anuncio; si no, ni la profe ni las
    -- familias de esa aula lo ven. Admin y autor ya han salido arriba.
    IF public.centro_de_aula(p_aula_id) IS DISTINCT FROM p_centro_id THEN
      RETURN FALSE;
    END IF;
    IF public.es_profe_de_aula(p_aula_id) THEN
      RETURN TRUE;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM public.matriculas m
      JOIN public.vinculos_familiares vf ON vf.nino_id = m.nino_id
      WHERE m.aula_id = p_aula_id
        AND m.fecha_baja IS NULL
        AND m.deleted_at IS NULL
        AND m.estado = 'activa'
        AND vf.usuario_id = v_usuario
        AND vf.deleted_at IS NULL
        AND COALESCE((vf.permisos ->> 'puede_recibir_mensajes')::boolean, false) = true
    );
  END IF;

  -- Ámbito 'centro'
  IF p_ambito = 'centro' THEN
    IF EXISTS (
      SELECT 1
      FROM public.profes_aulas pa
      JOIN public.aulas au ON au.id = pa.aula_id
      WHERE pa.profe_id = v_usuario
        AND pa.fecha_fin IS NULL
        AND pa.deleted_at IS NULL
        AND au.centro_id = p_centro_id
    ) THEN
      RETURN TRUE;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM public.matriculas m
      JOIN public.aulas au ON au.id = m.aula_id
      JOIN public.vinculos_familiares vf ON vf.nino_id = m.nino_id
      WHERE au.centro_id = p_centro_id
        AND m.fecha_baja IS NULL
        AND m.deleted_at IS NULL
        AND m.estado = 'activa'
        AND vf.usuario_id = v_usuario
        AND vf.deleted_at IS NULL
        AND COALESCE((vf.permisos ->> 'puede_recibir_mensajes')::boolean, false) = true
    );
  END IF;

  RETURN FALSE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.usuario_es_audiencia_anuncio(p_anuncio_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a public.anuncios%ROWTYPE;
  v_usuario uuid := auth.uid();
BEGIN
  IF v_usuario IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO a FROM public.anuncios WHERE id = p_anuncio_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Admin del centro: siempre
  IF public.es_admin(a.centro_id) THEN
    RETURN TRUE;
  END IF;

  -- Autor del anuncio: siempre (defensa en profundidad)
  IF a.autor_id = v_usuario THEN
    RETURN TRUE;
  END IF;

  -- Ámbito 'aula'
  IF a.ambito = 'aula' THEN
    -- R3 (añadido): el aula tiene que ser del centro del anuncio; si no, ni la profe ni las
    -- familias de esa aula lo ven. Admin y autor ya han salido arriba.
    IF public.centro_de_aula(a.aula_id) IS DISTINCT FROM a.centro_id THEN
      RETURN FALSE;
    END IF;
    -- Profe activo del aula concreta
    IF public.es_profe_de_aula(a.aula_id) THEN
      RETURN TRUE;
    END IF;
    -- Tutor con permiso y niño matriculado activamente en esa aula
    RETURN EXISTS (
      SELECT 1
      FROM public.matriculas m
      JOIN public.vinculos_familiares vf ON vf.nino_id = m.nino_id
      WHERE m.aula_id = a.aula_id
        AND m.fecha_baja IS NULL
        AND m.deleted_at IS NULL
        AND m.estado = 'activa'
        AND vf.usuario_id = v_usuario
        AND vf.deleted_at IS NULL
        AND COALESCE((vf.permisos ->> 'puede_recibir_mensajes')::boolean, false) = true
    );
  END IF;

  -- Ámbito 'centro'
  IF a.ambito = 'centro' THEN
    -- Profe activo en cualquier aula del centro
    IF EXISTS (
      SELECT 1
      FROM public.profes_aulas pa
      JOIN public.aulas au ON au.id = pa.aula_id
      WHERE pa.profe_id = v_usuario
        AND pa.fecha_fin IS NULL
        AND pa.deleted_at IS NULL
        AND au.centro_id = a.centro_id
    ) THEN
      RETURN TRUE;
    END IF;
    -- Tutor con permiso y niño matriculado activamente en cualquier aula del centro
    RETURN EXISTS (
      SELECT 1
      FROM public.matriculas m
      JOIN public.aulas au ON au.id = m.aula_id
      JOIN public.vinculos_familiares vf ON vf.nino_id = m.nino_id
      WHERE au.centro_id = a.centro_id
        AND m.fecha_baja IS NULL
        AND m.deleted_at IS NULL
        AND m.estado = 'activa'
        AND vf.usuario_id = v_usuario
        AND vf.deleted_at IS NULL
        AND COALESCE((vf.permisos ->> 'puede_recibir_mensajes')::boolean, false) = true
    );
  END IF;

  RETURN FALSE;
END;
$function$;

-- ---- Trigger: aula ∈ centro para todos (también service role / BYPASSRLS) ----
CREATE OR REPLACE FUNCTION public.anuncios_validar_aula_centro()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.aula_id IS NOT NULL
     AND public.centro_de_aula(NEW.aula_id) IS DISTINCT FROM NEW.centro_id THEN
    RAISE EXCEPTION 'anuncios: el aula no pertenece al centro del anuncio'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

-- Función de trigger: nadie la invoca por RPC (el disparo del trigger no comprueba EXECUTE).
REVOKE EXECUTE ON FUNCTION public.anuncios_validar_aula_centro() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER anuncios_validar_aula_centro_trg
  BEFORE INSERT OR UPDATE OF aula_id, centro_id ON public.anuncios
  FOR EACH ROW EXECUTE FUNCTION public.anuncios_validar_aula_centro();

-- ---- R2: invitaciones — niño y aula del centro de la invitación (para todos) ----
CREATE OR REPLACE FUNCTION public.invitaciones_validar_centro()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.nino_id IS NOT NULL
     AND public.centro_de_nino(NEW.nino_id) IS DISTINCT FROM NEW.centro_id THEN
    RAISE EXCEPTION 'invitaciones: el niño no pertenece al centro de la invitación'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.aula_id IS NOT NULL
     AND public.centro_de_aula(NEW.aula_id) IS DISTINCT FROM NEW.centro_id THEN
    RAISE EXCEPTION 'invitaciones: el aula no pertenece al centro de la invitación'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.invitaciones_validar_centro() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER invitaciones_validar_centro_trg
  BEFORE INSERT OR UPDATE OF nino_id, aula_id, centro_id ON public.invitaciones
  FOR EACH ROW EXECUTE FUNCTION public.invitaciones_validar_centro();

-- ---- Guarda posterior: equivalencia de los helpers y ACL conservada ----
DO $guarda$
DECLARE
  v_add1 text := '    -- R3 (añadido): el aula tiene que ser del centro del anuncio; si no, ni la profe ni las
    -- familias de esa aula lo ven. Admin y autor ya han salido arriba.
    IF public.centro_de_aula(p_aula_id) IS DISTINCT FROM p_centro_id THEN
      RETURN FALSE;
    END IF;
';
  v_add2 text := '    -- R3 (añadido): el aula tiene que ser del centro del anuncio; si no, ni la profe ni las
    -- familias de esa aula lo ven. Admin y autor ya han salido arriba.
    IF public.centro_de_aula(a.aula_id) IS DISTINCT FROM a.centro_id THEN
      RETURN FALSE;
    END IF;
';
BEGIN
  IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.usuario_es_audiencia_anuncio_row(uuid, uuid, public.ambito_anuncio, uuid)'::regprocedure), v_add1, ''))
     IS DISTINCT FROM '2c2e4d7924bda3d0f943cd2ac2c7d814' THEN
    RAISE EXCEPTION 'R3: usuario_es_audiencia_anuncio_row difiere del cuerpo vivo en algo más que el bloque añadido';
  END IF;
  IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.usuario_es_audiencia_anuncio(uuid)'::regprocedure), v_add2, ''))
     IS DISTINCT FROM 'f781db1fd0c1b641bf9ee24370b25bd3' THEN
    RAISE EXCEPTION 'R3: usuario_es_audiencia_anuncio difiere del cuerpo vivo en algo más que el bloque añadido';
  END IF;
  IF has_function_privilege('anon', 'public.usuario_es_audiencia_anuncio_row(uuid, uuid, public.ambito_anuncio, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.usuario_es_audiencia_anuncio(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.usuario_es_audiencia_anuncio_row(uuid, uuid, public.ambito_anuncio, uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.usuario_es_audiencia_anuncio(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'R3: el ACL de los helpers de audiencia ha cambiado (anon NO, authenticated SÍ)';
  END IF;
END
$guarda$;
