-- =============================================================================
-- Fase 1 — Identidad y acceso
-- Tablas: usuarios, roles_usuario, invitaciones, auth_attempts
-- Helpers: auth.usuario_actual(), public.es_admin()
-- Trigger: handle_new_user en auth.users
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- Enum de roles
-- -----------------------------------------------------------------------------
CREATE TYPE public.user_role AS ENUM ('admin','profe','tutor_legal','autorizado');

-- -----------------------------------------------------------------------------
-- usuarios: extiende auth.users con datos de aplicación
-- -----------------------------------------------------------------------------
CREATE TABLE public.usuarios (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre_completo text NOT NULL,
  idioma_preferido text NOT NULL DEFAULT 'es' CHECK (idioma_preferido IN ('es','en','va')),
  consentimiento_terminos_version text,
  consentimiento_privacidad_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- -----------------------------------------------------------------------------
-- roles_usuario: un usuario puede tener N roles con scope por centro
-- -----------------------------------------------------------------------------
CREATE TABLE public.roles_usuario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  centro_id uuid NOT NULL,
  rol public.user_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (usuario_id, centro_id, rol)
);

CREATE INDEX idx_roles_usuario_usuario ON public.roles_usuario(usuario_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_roles_usuario_centro_rol ON public.roles_usuario(centro_id, rol) WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- invitaciones: token + expiración + binding opcional a niño/aula
-- -----------------------------------------------------------------------------
CREATE TABLE public.invitaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  email text NOT NULL,
  rol_objetivo public.user_role NOT NULL,
  centro_id uuid NOT NULL,
  nino_id uuid,
  aula_id uuid,
  invitado_por uuid REFERENCES public.usuarios(id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_invitaciones_token_open
  ON public.invitaciones(token)
  WHERE accepted_at IS NULL AND rejected_at IS NULL;

CREATE INDEX idx_invitaciones_email_pending
  ON public.invitaciones(email)
  WHERE accepted_at IS NULL AND rejected_at IS NULL;

-- -----------------------------------------------------------------------------
-- auth_attempts: rate limiting (service role only)
-- -----------------------------------------------------------------------------
CREATE TABLE public.auth_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash text NOT NULL,
  email_hash text NOT NULL,
  success boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_auth_attempts_ip_time ON public.auth_attempts(ip_hash, created_at);

-- -----------------------------------------------------------------------------
-- Trigger genérico updated_at
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER usuarios_updated_at
  BEFORE UPDATE ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- handle_new_user: crea fila en public.usuarios al insertarse en auth.users
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.usuarios (id, nombre_completo, idioma_preferido)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nombre_completo', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'idioma_preferido', 'es')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Helpers RLS (en schema public; Supabase no permite crear funciones en auth)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.usuario_actual()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.es_admin(p_centro_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.roles_usuario
    WHERE usuario_id = auth.uid()
      AND rol = 'admin'
      AND deleted_at IS NULL
      AND (p_centro_id IS NULL OR centro_id = p_centro_id)
  );
$$;

-- -----------------------------------------------------------------------------
-- RLS — Default DENY ALL
-- -----------------------------------------------------------------------------
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles_usuario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_attempts ENABLE ROW LEVEL SECURITY;

-- usuarios: cada uno lee/edita su fila; admin del centro lee usuarios de su centro
CREATE POLICY usuarios_self_select ON public.usuarios
  FOR SELECT USING (id = auth.uid());

CREATE POLICY usuarios_self_update ON public.usuarios
  FOR UPDATE USING (id = auth.uid());

CREATE POLICY usuarios_admin_select ON public.usuarios
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.roles_usuario ru
      WHERE ru.usuario_id = public.usuarios.id
        AND ru.deleted_at IS NULL
        AND public.es_admin(ru.centro_id)
    )
  );

-- roles_usuario: usuario lee sus propios roles; admin gestiona los del centro
CREATE POLICY roles_self_select ON public.roles_usuario
  FOR SELECT USING (usuario_id = auth.uid());

CREATE POLICY roles_admin_all ON public.roles_usuario
  FOR ALL USING (public.es_admin(centro_id));

-- invitaciones: solo admin del centro las gestiona
CREATE POLICY invitaciones_admin ON public.invitaciones
  FOR ALL USING (public.es_admin(centro_id));

-- auth_attempts: sin políticas → solo service role escribe/lee
