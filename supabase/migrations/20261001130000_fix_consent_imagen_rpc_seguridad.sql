-- =============================================================================
-- FIX — RPCs de consentimiento de imagen: 3 agujeros de autorización
-- -----------------------------------------------------------------------------
-- otorgar_consentimiento_imagen / revocar_consentimiento_imagen (IU-0) son SECURITY DEFINER.
--
-- 1. EXECUTE para PUBLIC y anon (default privileges). Se revoca. Conservan EXECUTE:
--    authenticated (la app: alta IU-2 e IU-4 llaman con la sesión del usuario) y
--    service_role (6 ficheros de tests RLS llaman por serviceClient).
-- 2. El gate empezaba por `auth.uid() IS NOT NULL AND ...`: con uid NULL se saltaba ENTERO.
--    Ahora deniega por defecto: sin usuario autenticado solo pasan service_role (JWT con
--    role=service_role) y una sesión directa a la BD sin JWT (SQL Editor; session_user
--    distinto de `authenticator`, el rol con el que entra PostgREST). Un uid NULL por
--    cualquier otro camino (anon a través de otra función DEFINER, authenticated sin sub)
--    → 42501.
-- 3. otorgar aceptaba cualquier p_tutor: un tutor podía atribuir el consentimiento a OTRO
--    usuario (p. ej. fabricar el «sí» del otro progenitor con requiere_ambos_firmantes).
--    Ahora, si quien llama no es admin del centro, p_tutor se fuerza a auth.uid().
--    Admin y service_role siguen pudiendo otorgar en nombre de un tutor.
--
-- El resto de la lógica (INSERT / UPDATE, triggers derivadores) queda IDÉNTICA: el cambio
-- es solo el bloque del gate. El gate es_admin OR es_tutor_de NO se toca (la apertura al
-- tutor y el endurecimiento a tutor legal son de la feature posterior).
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor (CLI SIGILL
-- en ARM). Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.otorgar_consentimiento_imagen(p_nino_id uuid, p_tutor uuid, p_version text DEFAULT 'imagen-v1'::text, p_ip inet DEFAULT NULL::inet, p_user_agent text DEFAULT NULL::text, p_metodo firma_metodo DEFAULT 'digital'::firma_metodo)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_uid uuid := auth.uid();
  v_admin boolean;
BEGIN
  -- Gate que deniega por defecto. Sin usuario autenticado solo pasan:
  --   · service_role (JWT con role=service_role: servidor y tests), o
  --   · una sesión DIRECTA a la BD sin ningún JWT (SQL Editor / psql del responsable).
  -- PostgREST entra siempre como `authenticator`: una petición suya nunca cuenta como sesión
  -- directa, aunque llegase sin claims. anon llega con role=anon → rechazado.
  IF v_uid IS NULL THEN
    IF NOT (COALESCE(auth.role(), '') = 'service_role'
            OR (session_user <> 'authenticator'
                AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
      RAISE EXCEPTION 'no autorizado a otorgar consentimiento de imagen de este niño'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    v_admin := public.es_admin(public.centro_de_nino(p_nino_id));
    IF NOT v_admin AND NOT public.es_tutor_de(p_nino_id) THEN
      RAISE EXCEPTION 'no autorizado a otorgar consentimiento de imagen de este niño'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- El tutor solo otorga en su propio nombre; el admin puede hacerlo en nombre de un tutor.
    IF NOT v_admin THEN
      p_tutor := v_uid;
    END IF;
  END IF;

  INSERT INTO public.consentimientos
    (usuario_id, tipo, version, nino_id, ip_address, user_agent, metodo_firma)
  VALUES
    (p_tutor, 'imagen', p_version, p_nino_id, p_ip, p_user_agent, p_metodo)
  RETURNING id INTO v_id;   -- el trigger derivador recalcula el flag del niño

  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.revocar_consentimiento_imagen(p_nino_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
  v_uid uuid := auth.uid();
BEGIN
  -- Gate que deniega por defecto. Sin usuario autenticado solo pasan:
  --   · service_role (JWT con role=service_role: servidor y tests), o
  --   · una sesión DIRECTA a la BD sin ningún JWT (SQL Editor / psql del responsable).
  -- PostgREST entra siempre como `authenticator`: una petición suya nunca cuenta como sesión
  -- directa, aunque llegase sin claims. anon llega con role=anon → rechazado.
  IF v_uid IS NULL THEN
    IF NOT (COALESCE(auth.role(), '') = 'service_role'
            OR (session_user <> 'authenticator'
                AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
      RAISE EXCEPTION 'no autorizado a revocar consentimiento de imagen de este niño'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NOT public.es_admin(public.centro_de_nino(p_nino_id))
     AND NOT public.es_tutor_de(p_nino_id) THEN
    RAISE EXCEPTION 'no autorizado a revocar consentimiento de imagen de este niño'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH upd AS (
    UPDATE public.consentimientos
       SET revocado_en = now()            -- el trigger append-only lo re-normaliza a now()
     WHERE tipo = 'imagen' AND nino_id = p_nino_id AND revocado_en IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM upd;       -- el trigger derivador recalcula el flag

  RETURN v_n;
END $function$;

REVOKE EXECUTE ON FUNCTION public.otorgar_consentimiento_imagen(uuid, uuid, text, inet, text, firma_metodo)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revocar_consentimiento_imagen(uuid)
  FROM PUBLIC, anon;
