-- =============================================================================
-- Fase 2 — Entidades core + RLS + audit log + cifrado pgcrypto
-- =============================================================================
-- Tablas core (8): centros, cursos_academicos, aulas, ninos,
--                  info_medica_emergencia, matriculas, vinculos_familiares,
--                  profes_aulas.
-- Tablas transversales (2): audit_log, consentimientos.
-- FKs diferidos de Fase 1: roles_usuario.centro_id, invitaciones.{centro,nino,aula}_id.
-- Helpers RLS nuevos: pertenece_a_centro, es_profe_de_aula, es_tutor_de,
--                     tiene_permiso_sobre.
-- Audit log automático: triggers en centros, ninos, info_medica_emergencia,
--                       vinculos_familiares, roles_usuario, matriculas.
-- Cifrado pgcrypto a nivel columna en info_medica_emergencia
-- (alergias_graves, notas_emergencia). Clave en Supabase Vault con
-- name='medical_encryption_key'.
-- Seed: 1 centro (ANAIA), 1 curso (2026-27), 5 aulas.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- ENUMs
-- -----------------------------------------------------------------------------
CREATE TYPE public.curso_estado AS ENUM ('planificado', 'activo', 'cerrado');
CREATE TYPE public.nino_sexo AS ENUM ('F', 'M', 'X');
CREATE TYPE public.tipo_vinculo AS ENUM ('tutor_legal_principal', 'tutor_legal_secundario', 'autorizado');
CREATE TYPE public.parentesco AS ENUM ('madre', 'padre', 'abuela', 'abuelo', 'tia', 'tio', 'hermana', 'hermano', 'cuidadora', 'otro');
CREATE TYPE public.audit_accion AS ENUM ('INSERT', 'UPDATE', 'DELETE');
CREATE TYPE public.consentimiento_tipo AS ENUM ('terminos', 'privacidad', 'imagen', 'datos_medicos');

-- -----------------------------------------------------------------------------
-- centros
-- -----------------------------------------------------------------------------
CREATE TABLE public.centros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  direccion text NOT NULL,
  telefono text NOT NULL,
  email_contacto text NOT NULL,
  web text,
  idioma_default text NOT NULL DEFAULT 'es' CHECK (idioma_default IN ('es','en','va')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TRIGGER centros_updated_at BEFORE UPDATE ON public.centros
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- cursos_academicos
-- -----------------------------------------------------------------------------
CREATE TABLE public.cursos_academicos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id uuid NOT NULL REFERENCES public.centros(id) ON DELETE RESTRICT,
  nombre text NOT NULL,
  fecha_inicio date NOT NULL,
  fecha_fin date NOT NULL,
  estado public.curso_estado NOT NULL DEFAULT 'planificado',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (centro_id, nombre),
  CHECK (fecha_inicio < fecha_fin)
);

CREATE UNIQUE INDEX idx_un_curso_activo_por_centro
  ON public.cursos_academicos (centro_id)
  WHERE estado = 'activo' AND deleted_at IS NULL;

CREATE TRIGGER cursos_academicos_updated_at BEFORE UPDATE ON public.cursos_academicos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- aulas
-- -----------------------------------------------------------------------------
CREATE TABLE public.aulas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id uuid NOT NULL REFERENCES public.centros(id) ON DELETE RESTRICT,
  curso_academico_id uuid NOT NULL REFERENCES public.cursos_academicos(id) ON DELETE RESTRICT,
  nombre text NOT NULL,
  cohorte_anos_nacimiento int[] NOT NULL CHECK (
    array_length(cohorte_anos_nacimiento, 1) BETWEEN 1 AND 5
    AND 2020 <= ALL (cohorte_anos_nacimiento)
    AND 2030 >= ALL (cohorte_anos_nacimiento)
  ),
  descripcion text,
  capacidad_maxima int NOT NULL DEFAULT 12 CHECK (capacidad_maxima BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (curso_academico_id, nombre)
);

CREATE INDEX idx_aulas_centro ON public.aulas (centro_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_aulas_curso  ON public.aulas (curso_academico_id) WHERE deleted_at IS NULL;

CREATE TRIGGER aulas_updated_at BEFORE UPDATE ON public.aulas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- ninos
-- -----------------------------------------------------------------------------
CREATE TABLE public.ninos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id uuid NOT NULL REFERENCES public.centros(id) ON DELETE RESTRICT,
  nombre text NOT NULL,
  apellidos text NOT NULL,
  fecha_nacimiento date NOT NULL CHECK (fecha_nacimiento <= CURRENT_DATE),
  sexo public.nino_sexo,
  foto_url text,
  nacionalidad text,
  idioma_principal text NOT NULL DEFAULT 'es' CHECK (idioma_principal IN ('es','en','va')),
  notas_admin text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_ninos_centro ON public.ninos (centro_id) WHERE deleted_at IS NULL;

CREATE TRIGGER ninos_updated_at BEFORE UPDATE ON public.ninos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- info_medica_emergencia
-- alergias_graves y notas_emergencia se almacenan como BYTEA cifrado pgcrypto.
-- El flujo aplicativo siempre soft-delete del niño (deleted_at); el RESTRICT
-- en nino_id protege contra DELETE físico accidental.
-- -----------------------------------------------------------------------------
CREATE TABLE public.info_medica_emergencia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nino_id uuid NOT NULL UNIQUE REFERENCES public.ninos(id) ON DELETE RESTRICT,
  alergias_graves bytea,
  notas_emergencia bytea,
  medicacion_habitual text,
  alergias_leves text,
  medico_familia text,
  telefono_emergencia text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER ime_updated_at BEFORE UPDATE ON public.info_medica_emergencia
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- matriculas (histórico niño ↔ aula)
-- -----------------------------------------------------------------------------
CREATE TABLE public.matriculas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nino_id uuid NOT NULL REFERENCES public.ninos(id) ON DELETE RESTRICT,
  aula_id uuid NOT NULL REFERENCES public.aulas(id) ON DELETE RESTRICT,
  curso_academico_id uuid NOT NULL REFERENCES public.cursos_academicos(id) ON DELETE RESTRICT,
  fecha_alta date NOT NULL DEFAULT CURRENT_DATE,
  fecha_baja date,
  motivo_baja text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (fecha_baja IS NULL OR fecha_baja >= fecha_alta)
);

CREATE UNIQUE INDEX idx_matricula_activa_unica
  ON public.matriculas (nino_id, curso_academico_id)
  WHERE fecha_baja IS NULL AND deleted_at IS NULL;
CREATE INDEX idx_matriculas_aula ON public.matriculas (aula_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_matriculas_nino ON public.matriculas (nino_id) WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- vinculos_familiares (con permisos JSONB granulares)
-- -----------------------------------------------------------------------------
CREATE TABLE public.vinculos_familiares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nino_id uuid NOT NULL REFERENCES public.ninos(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  tipo_vinculo public.tipo_vinculo NOT NULL,
  parentesco public.parentesco NOT NULL,
  descripcion_parentesco text,
  permisos jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (nino_id, usuario_id)
);

CREATE INDEX idx_vinculos_usuario ON public.vinculos_familiares (usuario_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_vinculos_nino    ON public.vinculos_familiares (nino_id) WHERE deleted_at IS NULL;

CREATE TRIGGER vinculos_familiares_updated_at BEFORE UPDATE ON public.vinculos_familiares
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- profes_aulas
-- -----------------------------------------------------------------------------
CREATE TABLE public.profes_aulas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profe_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  aula_id uuid NOT NULL REFERENCES public.aulas(id) ON DELETE CASCADE,
  fecha_inicio date NOT NULL DEFAULT CURRENT_DATE,
  fecha_fin date,
  es_profe_principal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio)
);

CREATE UNIQUE INDEX idx_un_principal_activo_por_aula
  ON public.profes_aulas (aula_id)
  WHERE es_profe_principal AND fecha_fin IS NULL AND deleted_at IS NULL;
CREATE INDEX idx_profes_aulas_profe ON public.profes_aulas (profe_id) WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- audit_log (append-only, RLS bloquea UPDATE/DELETE)
-- -----------------------------------------------------------------------------
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tabla text NOT NULL,
  registro_id uuid,
  accion public.audit_accion NOT NULL,
  usuario_id uuid REFERENCES public.usuarios(id),
  valores_antes jsonb,
  valores_despues jsonb,
  centro_id uuid,
  ts timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_centro_ts ON public.audit_log (centro_id, ts DESC);
CREATE INDEX idx_audit_tabla_ts  ON public.audit_log (tabla, ts DESC);

-- -----------------------------------------------------------------------------
-- consentimientos (append-only)
-- -----------------------------------------------------------------------------
CREATE TABLE public.consentimientos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  tipo public.consentimiento_tipo NOT NULL,
  version text NOT NULL,
  aceptado_en timestamptz NOT NULL DEFAULT now(),
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_consentimientos_usuario ON public.consentimientos (usuario_id);

-- -----------------------------------------------------------------------------
-- Pre-seed: la fila de ANAIA en centros debe existir ANTES de añadir el FK
-- roles_usuario.centro_id → centros.id, porque el rol admin creado en Fase 1
-- ya apunta a este UUID. Sin esto el ADD CONSTRAINT fallaría con violación de FK.
-- El resto del seed (curso, aulas) se ejecuta al final del archivo, una vez
-- aplicadas las políticas RLS y el resto de la estructura.
-- -----------------------------------------------------------------------------
INSERT INTO public.centros (id, nombre, direccion, telefono, email_contacto, idioma_default)
VALUES (
  '33c79b50-13b5-4962-b849-d88dd6a21366',
  'ANAIA',
  'Valencia',
  '+34 000 000 000',
  'contacto@anaia.local',
  'es'
);

-- -----------------------------------------------------------------------------
-- FKs diferidos de Fase 1 (las columnas ya existen sin FK)
-- -----------------------------------------------------------------------------
ALTER TABLE public.roles_usuario
  ADD CONSTRAINT roles_usuario_centro_id_fkey
  FOREIGN KEY (centro_id) REFERENCES public.centros(id) ON DELETE RESTRICT;

ALTER TABLE public.invitaciones
  ADD CONSTRAINT invitaciones_centro_id_fkey FOREIGN KEY (centro_id) REFERENCES public.centros(id) ON DELETE CASCADE,
  ADD CONSTRAINT invitaciones_nino_id_fkey   FOREIGN KEY (nino_id)   REFERENCES public.ninos(id)   ON DELETE CASCADE,
  ADD CONSTRAINT invitaciones_aula_id_fkey   FOREIGN KEY (aula_id)   REFERENCES public.aulas(id)   ON DELETE CASCADE;

-- =============================================================================
-- Helpers RLS adicionales (en public.*; ADR-0002)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.pertenece_a_centro(p_centro_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.roles_usuario
    WHERE usuario_id = auth.uid()
      AND centro_id = p_centro_id
      AND deleted_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.es_profe_de_aula(p_aula_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profes_aulas
    WHERE profe_id = auth.uid()
      AND aula_id = p_aula_id
      AND fecha_fin IS NULL
      AND deleted_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.es_tutor_de(p_nino_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vinculos_familiares
    WHERE usuario_id = auth.uid()
      AND nino_id = p_nino_id
      AND deleted_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.tiene_permiso_sobre(p_nino_id uuid, p_permiso text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vinculos_familiares
    WHERE usuario_id = auth.uid()
      AND nino_id = p_nino_id
      AND deleted_at IS NULL
      AND COALESCE((permisos ->> p_permiso)::boolean, false) = true
  );
$$;

-- =============================================================================
-- RLS: enable + policies (default DENY ALL)
-- =============================================================================

ALTER TABLE public.centros                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cursos_academicos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aulas                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ninos                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.info_medica_emergencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matriculas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vinculos_familiares    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profes_aulas           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consentimientos        ENABLE ROW LEVEL SECURITY;

-- centros
CREATE POLICY centros_select_miembros ON public.centros
  FOR SELECT USING (public.pertenece_a_centro(id));
CREATE POLICY centros_admin_all ON public.centros
  FOR ALL USING (public.es_admin(id));

-- cursos_academicos
CREATE POLICY cursos_select_miembros ON public.cursos_academicos
  FOR SELECT USING (public.pertenece_a_centro(centro_id));
CREATE POLICY cursos_admin_all ON public.cursos_academicos
  FOR ALL USING (public.es_admin(centro_id));

-- aulas
CREATE POLICY aulas_select_miembros ON public.aulas
  FOR SELECT USING (public.pertenece_a_centro(centro_id));
CREATE POLICY aulas_admin_all ON public.aulas
  FOR ALL USING (public.es_admin(centro_id));

-- ninos
CREATE POLICY ninos_admin_all ON public.ninos
  FOR ALL USING (public.es_admin(centro_id));
CREATE POLICY ninos_profe_select ON public.ninos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.matriculas m
      WHERE m.nino_id = public.ninos.id
        AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
        AND public.es_profe_de_aula(m.aula_id)
    )
  );
CREATE POLICY ninos_tutor_select ON public.ninos
  FOR SELECT USING (public.es_tutor_de(id));

-- info_medica_emergencia
CREATE POLICY ime_admin_all ON public.info_medica_emergencia
  FOR ALL USING (
    public.es_admin((SELECT centro_id FROM public.ninos WHERE id = info_medica_emergencia.nino_id))
  );
CREATE POLICY ime_profe_select ON public.info_medica_emergencia
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.matriculas m
      WHERE m.nino_id = info_medica_emergencia.nino_id
        AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
        AND public.es_profe_de_aula(m.aula_id)
    )
  );
CREATE POLICY ime_tutor_select ON public.info_medica_emergencia
  FOR SELECT USING (public.tiene_permiso_sobre(nino_id, 'puede_ver_info_medica'));

-- matriculas
CREATE POLICY matriculas_admin_all ON public.matriculas
  FOR ALL USING (
    public.es_admin((SELECT centro_id FROM public.ninos WHERE id = matriculas.nino_id))
  );
CREATE POLICY matriculas_profe_select ON public.matriculas
  FOR SELECT USING (public.es_profe_de_aula(aula_id));
CREATE POLICY matriculas_tutor_select ON public.matriculas
  FOR SELECT USING (public.es_tutor_de(nino_id));

-- vinculos_familiares
CREATE POLICY vinculos_admin_all ON public.vinculos_familiares
  FOR ALL USING (
    public.es_admin((SELECT centro_id FROM public.ninos WHERE id = vinculos_familiares.nino_id))
  );
CREATE POLICY vinculos_self_select ON public.vinculos_familiares
  FOR SELECT USING (usuario_id = auth.uid());
CREATE POLICY vinculos_profe_select ON public.vinculos_familiares
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.matriculas m
      WHERE m.nino_id = vinculos_familiares.nino_id
        AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
        AND public.es_profe_de_aula(m.aula_id)
    )
  );

-- profes_aulas
CREATE POLICY profes_aulas_admin_all ON public.profes_aulas
  FOR ALL USING (
    public.es_admin((SELECT centro_id FROM public.aulas WHERE id = profes_aulas.aula_id))
  );
CREATE POLICY profes_aulas_self_select ON public.profes_aulas
  FOR SELECT USING (profe_id = auth.uid());

-- audit_log: solo SELECT por admin del centro. UPDATE/DELETE bloqueado a todos.
-- INSERT solo desde audit_trigger_function() (SECURITY DEFINER bypassa RLS).
CREATE POLICY audit_admin_select ON public.audit_log
  FOR SELECT USING (public.es_admin(centro_id));

-- consentimientos: lectura propia o por admin del centro. INSERT solo del propio
-- usuario (las server actions corren bajo auth del usuario). UPDATE/DELETE bloqueados.
CREATE POLICY consentimientos_self_select ON public.consentimientos
  FOR SELECT USING (usuario_id = auth.uid());
CREATE POLICY consentimientos_admin_select ON public.consentimientos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.roles_usuario ru
      WHERE ru.usuario_id = consentimientos.usuario_id
        AND ru.deleted_at IS NULL
        AND public.es_admin(ru.centro_id)
    )
  );
CREATE POLICY consentimientos_insert ON public.consentimientos
  FOR INSERT WITH CHECK (usuario_id = auth.uid());

-- =============================================================================
-- Audit log: función genérica + triggers en 6 tablas
-- =============================================================================

CREATE OR REPLACE FUNCTION public.audit_trigger_function()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_centro_id uuid;
  v_antes jsonb;
  v_despues jsonb;
  v_registro_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'centros' THEN
    v_centro_id := COALESCE((NEW).id, (OLD).id);
  ELSIF TG_TABLE_NAME = 'ninos' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'roles_usuario' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME IN ('info_medica_emergencia', 'vinculos_familiares', 'matriculas') THEN
    SELECT n.centro_id INTO v_centro_id
    FROM public.ninos n
    WHERE n.id = COALESCE((NEW).nino_id, (OLD).nino_id);
  END IF;

  v_antes   := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END;
  v_despues := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END;
  v_registro_id := COALESCE((NEW).id, (OLD).id);

  INSERT INTO public.audit_log
    (tabla, registro_id, accion, usuario_id, valores_antes, valores_despues, centro_id)
  VALUES
    (TG_TABLE_NAME, v_registro_id, TG_OP::public.audit_accion, auth.uid(), v_antes, v_despues, v_centro_id);

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER audit_centros
  AFTER INSERT OR UPDATE OR DELETE ON public.centros
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

CREATE TRIGGER audit_ninos
  AFTER INSERT OR UPDATE OR DELETE ON public.ninos
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

CREATE TRIGGER audit_info_medica
  AFTER INSERT OR UPDATE OR DELETE ON public.info_medica_emergencia
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

CREATE TRIGGER audit_vinculos
  AFTER INSERT OR UPDATE OR DELETE ON public.vinculos_familiares
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

CREATE TRIGGER audit_matriculas
  AFTER INSERT OR UPDATE OR DELETE ON public.matriculas
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

CREATE TRIGGER audit_roles_usuario
  AFTER INSERT OR UPDATE OR DELETE ON public.roles_usuario
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

-- =============================================================================
-- Cifrado pgcrypto a nivel columna en info_medica_emergencia
-- Clave leída de Supabase Vault (vault.decrypted_secrets) con
-- name='medical_encryption_key'. Configurada manualmente por el responsable
-- antes de aplicar esta migración. Ver ADR-0004.
-- =============================================================================

-- Función interna: lee la clave de Vault o falla con excepción explícita.
CREATE OR REPLACE FUNCTION public._get_medical_key()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_clave text;
BEGIN
  SELECT decrypted_secret INTO v_clave
  FROM vault.decrypted_secrets
  WHERE name = 'medical_encryption_key'
  LIMIT 1;

  IF v_clave IS NULL THEN
    RAISE EXCEPTION 'Clave de cifrado médico no configurada en Vault'
      USING HINT = 'Crea un secreto en Supabase Dashboard → Vault con name=medical_encryption_key';
  END IF;

  RETURN v_clave;
END;
$$;

-- Setter: solo admin del centro del niño puede escribir/actualizar datos médicos.
-- Cifra los campos sensibles con pgp_sym_encrypt usando la clave de Vault.
--
-- Contrato de NULL (relevante en UPDATE vía ON CONFLICT):
--   - Si el parámetro llega como NULL → el campo se PRESERVA (no se modifica).
--   - Si el parámetro llega como cadena vacía '' → se sobrescribe con '' (o con
--     pgp_sym_encrypt('') en los campos cifrados, que descifra a '').
--   - En INSERT inicial sin fila previa, los NULLs se guardan tal cual: no hay
--     valor que preservar.
--
-- Esto deja al cliente la responsabilidad de distinguir "no quiero tocar este
-- campo" (envía NULL) de "quiero borrar el contenido" (envía ''). Server actions
-- y schemas Zod deben mapear inputs ausentes a NULL, no a ''.
CREATE OR REPLACE FUNCTION public.set_info_medica_emergencia_cifrada(
  p_nino_id              uuid,
  p_alergias_graves      text,
  p_notas_emergencia     text,
  p_medicacion_habitual  text,
  p_alergias_leves       text,
  p_medico_familia       text,
  p_telefono_emergencia  text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_clave text := public._get_medical_key();
  v_centro_del_nino uuid;
  v_id uuid;
BEGIN
  SELECT centro_id INTO v_centro_del_nino FROM public.ninos WHERE id = p_nino_id;
  IF v_centro_del_nino IS NULL THEN
    RAISE EXCEPTION 'Niño no encontrado: %', p_nino_id;
  END IF;
  IF NOT public.es_admin(v_centro_del_nino) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  INSERT INTO public.info_medica_emergencia (
    nino_id, alergias_graves, notas_emergencia,
    medicacion_habitual, alergias_leves, medico_familia, telefono_emergencia
  ) VALUES (
    p_nino_id,
    CASE WHEN p_alergias_graves  IS NULL THEN NULL ELSE pgp_sym_encrypt(p_alergias_graves,  v_clave) END,
    CASE WHEN p_notas_emergencia IS NULL THEN NULL ELSE pgp_sym_encrypt(p_notas_emergencia, v_clave) END,
    p_medicacion_habitual, p_alergias_leves, p_medico_familia, p_telefono_emergencia
  )
  ON CONFLICT (nino_id) DO UPDATE SET
    -- NULL en EXCLUDED.* significa "no tocar" → COALESCE preserva el valor existente.
    alergias_graves      = COALESCE(EXCLUDED.alergias_graves,      public.info_medica_emergencia.alergias_graves),
    notas_emergencia     = COALESCE(EXCLUDED.notas_emergencia,     public.info_medica_emergencia.notas_emergencia),
    medicacion_habitual  = COALESCE(EXCLUDED.medicacion_habitual,  public.info_medica_emergencia.medicacion_habitual),
    alergias_leves       = COALESCE(EXCLUDED.alergias_leves,       public.info_medica_emergencia.alergias_leves),
    medico_familia       = COALESCE(EXCLUDED.medico_familia,       public.info_medica_emergencia.medico_familia),
    telefono_emergencia  = COALESCE(EXCLUDED.telefono_emergencia,  public.info_medica_emergencia.telefono_emergencia),
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Getter: admin del centro O profe del aula actual del niño O tutor con permiso
-- 'puede_ver_info_medica'. Descifra los campos sensibles y devuelve TABLE.
CREATE OR REPLACE FUNCTION public.get_info_medica_emergencia(p_nino_id uuid)
RETURNS TABLE (
  alergias_graves      text,
  notas_emergencia     text,
  medicacion_habitual  text,
  alergias_leves       text,
  medico_familia       text,
  telefono_emergencia  text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_clave text := public._get_medical_key();
  v_centro_del_nino uuid;
  v_autorizado boolean := false;
BEGIN
  SELECT centro_id INTO v_centro_del_nino FROM public.ninos WHERE id = p_nino_id;
  IF v_centro_del_nino IS NULL THEN
    RAISE EXCEPTION 'Niño no encontrado: %', p_nino_id;
  END IF;

  IF public.es_admin(v_centro_del_nino) THEN
    v_autorizado := true;
  ELSIF EXISTS (
    SELECT 1 FROM public.matriculas m
    WHERE m.nino_id = p_nino_id
      AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
      AND public.es_profe_de_aula(m.aula_id)
  ) THEN
    v_autorizado := true;
  ELSIF public.tiene_permiso_sobre(p_nino_id, 'puede_ver_info_medica') THEN
    v_autorizado := true;
  END IF;

  IF NOT v_autorizado THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  RETURN QUERY
  SELECT
    CASE WHEN ime.alergias_graves  IS NULL THEN NULL ELSE pgp_sym_decrypt(ime.alergias_graves,  v_clave) END,
    CASE WHEN ime.notas_emergencia IS NULL THEN NULL ELSE pgp_sym_decrypt(ime.notas_emergencia, v_clave) END,
    ime.medicacion_habitual,
    ime.alergias_leves,
    ime.medico_familia,
    ime.telefono_emergencia
  FROM public.info_medica_emergencia ime
  WHERE ime.nino_id = p_nino_id;
END;
$$;

-- =============================================================================
-- Seed (cont.): curso 2026-27 + 5 aulas para ANAIA.
-- La fila de ANAIA en centros se insertó arriba, antes de los FKs diferidos.
-- =============================================================================

INSERT INTO public.cursos_academicos (centro_id, nombre, fecha_inicio, fecha_fin, estado)
VALUES (
  '33c79b50-13b5-4962-b849-d88dd6a21366',
  '2026-27',
  '2026-09-01',
  '2027-07-31',
  'planificado'
);

INSERT INTO public.aulas (centro_id, curso_academico_id, nombre, cohorte_anos_nacimiento, capacidad_maxima)
SELECT
  '33c79b50-13b5-4962-b849-d88dd6a21366'::uuid,
  c.id,
  v.nombre,
  v.cohorte,
  12
FROM public.cursos_academicos c
CROSS JOIN (VALUES
  ('Sea',           ARRAY[2026, 2027]::int[]),
  ('Farm big',      ARRAY[2025]::int[]),
  ('Farm little',   ARRAY[2025]::int[]),
  ('Sabanna big',   ARRAY[2024]::int[]),
  ('Sabanna little',ARRAY[2024]::int[])
) AS v(nombre, cohorte)
WHERE c.centro_id = '33c79b50-13b5-4962-b849-d88dd6a21366'
  AND c.nombre = '2026-27';

-- =============================================================================
-- Verificación pre-flight: Vault tiene el secreto medical_encryption_key.
-- Si falla, toda la migración hace rollback (las tablas y funciones no se crean).
-- Evita terminar con esquema aplicado pero cifrado roto en runtime.
-- =============================================================================
DO $$
BEGIN
  PERFORM public._get_medical_key();
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION
    'Vault no tiene el secreto medical_encryption_key — abortando migración (%)', SQLERRM
    USING HINT = 'Crea el secreto en Supabase Dashboard → Vault → New secret con name=medical_encryption_key y valor base64 generado, después reintenta db push.';
END;
$$;

-- =============================================================================
-- FIN Fase 2
-- =============================================================================
