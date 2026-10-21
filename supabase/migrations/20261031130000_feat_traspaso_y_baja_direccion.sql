-- =============================================================================
-- FEAT — Traspaso de la administración y baja de Dirección (PR 4 del modelo de roles)
-- -----------------------------------------------------------------------------
-- La admin es una por centro (`idx_roles_usuario_una_admin_viva`, `20261030130000`). Hasta ahora
-- no había forma de cambiarla: dar de alta a la entrante choca con el índice mientras la saliente
-- siga viva, y retirar antes a la saliente deja el centro sin admin. Dos RPC:
--
--   · `traspasar_admin(centro, nueva_admin)`: la admin del centro traspasa la administración a
--     una directora del centro, en UNA transacción. La saliente queda como directora (decisión del
--     responsable): retira su fila `admin` y la de `directora` de la entrante (`traspaso_admin`),
--     da la fila `admin` a la entrante y la de `directora` a la saliente. Solo la persona con la
--     fila `admin` viva: el superusuario no tiene esa fila y no traspasa. Solo a una directora
--     viva del centro: quien es de fuera se invita antes como directora.
--   · `baja_de_direccion(centro, usuario)`: una directora deja la dirección (`baja_direccion`). La
--     da de baja la admin (o el superusuario) o se da de baja ella; desde `20261030130000` la RLS
--     no deja a una directora tocar su propia fila. La admin no se da de baja: primero traspasa
--     (55000, con el aviso).
--
-- `UNIQUE (usuario_id, centro_id, rol)` cuenta también las filas retiradas: dar otra vez un rol
-- que la persona tuvo reactiva su fila en vez de insertar otra (`ON CONFLICT … DO UPDATE`). Pasa
-- en cuanto una admin traspasa y la administración vuelve a ella.
--
-- Las dos son `SECURITY DEFINER` porque escriben filas que la RLS no deja escribir a quien llama
-- (la directora sobre sí misma, la fila de la saliente). `auth.uid()` sigue siendo quien llama:
-- `audit_log` la graba como actora. Sin uid, 42501: ni el servicio las necesita.
--
-- Sin cambio para nada existente: dos funciones nuevas. Hoy no hay ninguna directora.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor, DESPUÉS de
-- `20261031120000`. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_directoras int;
BEGIN
  IF (SELECT count(*) FROM pg_enum
       WHERE enumtypid = 'public.motivo_borrado'::regtype
         AND enumlabel IN ('baja_direccion', 'traspaso_admin')) <> 2 THEN
    RAISE EXCEPTION 'faltan los motivos baja_direccion y traspaso_admin: aplica antes 20261031120000';
  END IF;
  IF to_regprocedure('public.traspasar_admin(uuid, uuid)') IS NOT NULL
     OR to_regprocedure('public.baja_de_direccion(uuid, uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'traspasar_admin o baja_de_direccion ya existen';
  END IF;
  IF to_regclass('public.idx_roles_usuario_una_admin_viva') IS NULL THEN
    RAISE EXCEPTION 'falta idx_roles_usuario_una_admin_viva: aplica antes 20261030130000';
  END IF;
  SELECT count(*) INTO v_directoras FROM public.roles_usuario
   WHERE rol::text = 'directora' AND deleted_at IS NULL;
  RAISE NOTICE 'guarda previa: motivos e índice presentes; % directoras vivas', v_directoras;
END
$guarda$;

-- ---- Traspaso de la administración ----
CREATE FUNCTION public.traspasar_admin(p_centro_id uuid, p_nueva_admin uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_yo uuid := auth.uid();
  v_fila_admin uuid;
  v_fila_directora uuid;
BEGIN
  IF v_yo IS NULL THEN
    RAISE EXCEPTION 'sin sesión' USING ERRCODE = '42501';
  END IF;

  -- La fila admin viva de quien llama, bloqueada: dos traspasos a la vez no se cruzan.
  SELECT id INTO v_fila_admin
    FROM public.roles_usuario
   WHERE centro_id = p_centro_id AND usuario_id = v_yo
     AND rol = 'admin' AND deleted_at IS NULL
   FOR UPDATE;
  IF v_fila_admin IS NULL THEN
    RAISE EXCEPTION 'solo la admin del centro traspasa la administración' USING ERRCODE = '42501';
  END IF;

  IF p_nueva_admin IS NULL OR p_nueva_admin = v_yo THEN
    RAISE EXCEPTION 'la nueva admin tiene que ser otra persona' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_fila_directora
    FROM public.roles_usuario
   WHERE centro_id = p_centro_id AND usuario_id = p_nueva_admin
     AND rol = 'directora' AND deleted_at IS NULL
   FOR UPDATE;
  IF v_fila_directora IS NULL THEN
    RAISE EXCEPTION 'solo se traspasa a una directora del centro' USING ERRCODE = '23514';
  END IF;

  -- Primero se retira la saliente: el índice admite una admin viva por centro.
  UPDATE public.roles_usuario
     SET deleted_at = now(), deleted_reason = 'traspaso_admin'
   WHERE id IN (v_fila_admin, v_fila_directora);

  INSERT INTO public.roles_usuario (usuario_id, centro_id, rol)
  VALUES (p_nueva_admin, p_centro_id, 'admin')
  ON CONFLICT (usuario_id, centro_id, rol) DO UPDATE SET deleted_at = NULL, deleted_reason = NULL;

  INSERT INTO public.roles_usuario (usuario_id, centro_id, rol)
  VALUES (v_yo, p_centro_id, 'directora')
  ON CONFLICT (usuario_id, centro_id, rol) DO UPDATE SET deleted_at = NULL, deleted_reason = NULL;
END
$$;

COMMENT ON FUNCTION public.traspasar_admin(uuid, uuid) IS
  'La admin del centro traspasa la administración a una directora del centro, en una transacción; la saliente queda como directora.';

-- ---- Baja de Dirección ----
CREATE FUNCTION public.baja_de_direccion(p_centro_id uuid, p_usuario_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_yo uuid := auth.uid();
BEGIN
  IF v_yo IS NULL THEN
    RAISE EXCEPTION 'sin sesión' USING ERRCODE = '42501';
  END IF;
  IF NOT (p_usuario_id = v_yo OR public.es_admin(p_centro_id)) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  UPDATE public.roles_usuario
     SET deleted_at = now(), deleted_reason = 'baja_direccion'
   WHERE centro_id = p_centro_id AND usuario_id = p_usuario_id
     AND rol = 'directora' AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no es directora de este centro' USING ERRCODE = 'P0002';
  END IF;
END
$$;

COMMENT ON FUNCTION public.baja_de_direccion(uuid, uuid) IS
  'Una directora deja la dirección del centro: la da de baja la admin o se da de baja ella. La admin no: primero traspasa.';

REVOKE ALL ON FUNCTION public.traspasar_admin(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.baja_de_direccion(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.traspasar_admin(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.baja_de_direccion(uuid, uuid) TO authenticated;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_f text;
BEGIN
  FOREACH v_f IN ARRAY ARRAY['public.traspasar_admin(uuid, uuid)', 'public.baja_de_direccion(uuid, uuid)'] LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_f::regprocedure) THEN
      RAISE EXCEPTION '% no es SECURITY DEFINER', v_f;
    END IF;
    IF (SELECT proconfig FROM pg_proc WHERE oid = v_f::regprocedure) IS DISTINCT FROM ARRAY['search_path=public'] THEN
      RAISE EXCEPTION '% sin search_path = public', v_f;
    END IF;
    IF has_function_privilege('anon', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION '% la puede ejecutar anon', v_f;
    END IF;
    IF NOT has_function_privilege('authenticated', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION '% no la puede ejecutar authenticated', v_f;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.oid IN ('public.traspasar_admin(uuid, uuid)'::regprocedure,
                              'public.baja_de_direccion(uuid, uuid)'::regprocedure)
                AND has_function_privilege('public', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'traspasar_admin o baja_de_direccion abiertas a PUBLIC';
  END IF;
  RAISE NOTICE 'guarda posterior: las 2 funciones son SECURITY DEFINER, search_path public, solo authenticated';
END
$guarda$;
