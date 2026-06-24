-- =============================================================================
-- Fase 11-H-0 — "Matrícula multi-curso" · Fundación (remodel del modelo aula↔curso)
-- =============================================================================
-- DESTRUCTIVA y SIN BACKFILL: el piloto NO ha arrancado (no hay datos reales).
-- Patrón F6-C (drop+recreate), con una salvedad medida y aprobada por el responsable:
--
--   • `matriculas` y `profes_aulas` se DROP+RECREATE (0 FK entrantes → seguro).
--   • `aulas` se hace por ALTER, NO por DROP+CASCADE: tiene 7 FK entrantes desde
--     invitaciones, anuncios, recordatorios, citas, eventos, autorizaciones y
--     publicaciones. Un DROP CASCADE los borraría en silencio. Un ALTER llega al
--     MISMO esquema físico (aula física) sin tocar esos FK. Verificado: ningún
--     helper/policy SQL lee las 3 columnas que se eliminan de aulas.
--
-- DECISIONES A–J (cerradas por el responsable, 2026-06-24):
--   A) destructiva sin backfill.  B) profes_aulas por (aula, curso).
--   C) helpers RLS de staff cualificados por curso (firmas estables; cualificación
--      interna vía curso_activo_de_centro()). Reescritos UNO A UNO abajo, validando
--      aislamiento. Los helpers operativos restantes (es_tutor_en_aula, familia_ve_aula,
--      evento_aplica_a_nino, autorizacion_aplica_a_nino, get_info_medica_emergencia,
--      usuario_es_audiencia_anuncio*) SE QUEDAN COMO ESTÁN — confirmado: el curso
--      planificado es invisible para toda la app operativa y vive solo en el módulo
--      de admisiones (UI nueva, admin-only); una doble matrícula activa no genera fuga.
--   D) matriculas mantiene UNIQUE(nino, curso): 1 niño = 1 aula por curso.
--   E/F) lista_espera = PROSPECTO (sin crear niño): nombre, fecha_nac, teléfono+email
--      del tutor, nota, posición. Por (centro, curso). RLS admin del centro.
--   G/H) "pasar de curso" y continuidad → lógica en H-2 (no aquí).
--   I) NO se relaja el índice "1 activo por centro": ese índice YA implementa I
--      (1 activo + N planificados, nunca 2 activos). Relajarlo violaría "nunca 2
--      activos". Se mantiene intacto.
--
-- SIN UI ni acciones (eso es H-1..H-4). Transitorio H-0→H-1 ACEPTADO: get-aulas-con-personal
-- y queries que cuentan alumnos pueden romper hasta H-1.
--
-- Operación sobre esquema productivo → se aplica MANUALMENTE por SQL Editor (CLI SIGILL).
-- Tras aplicar: registrar versión en supabase_migrations.schema_migrations y `npm run db:types`.
-- =============================================================================
BEGIN;

-- ─── 0. ENUMs nuevos ─────────────────────────────────────────────────────────
CREATE TYPE public.estado_lista_espera AS ENUM ('en_espera', 'invitado', 'descartado');

-- ─── 1. Helpers de lookup nuevos ─────────────────────────────────────────────
-- Curso ACTIVO del centro (el índice parcial único garantiza ≤1). Base de la
-- cualificación por curso de los helpers de staff.
CREATE OR REPLACE FUNCTION public.curso_activo_de_centro(p_centro_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.cursos_academicos
  WHERE centro_id = p_centro_id
    AND estado = 'activo'
    AND deleted_at IS NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.centro_de_curso(p_curso_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT centro_id FROM public.cursos_academicos WHERE id = p_curso_id;
$$;

GRANT EXECUTE ON FUNCTION public.curso_activo_de_centro(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.centro_de_curso(uuid) TO authenticated;

-- ─── 2. DROP de las tablas a recrear (0 FK entrantes) ────────────────────────
-- DROP TABLE arrastra sus policies, índices y triggers de audit. Los helpers que
-- las referencian por nombre (es_profe_de_nino, etc.) re-vinculan al recrearlas
-- dentro de la misma transacción (funciones SQL: sin dependencia dura de tabla).
DROP TABLE IF EXISTS public.matriculas;
DROP TABLE IF EXISTS public.profes_aulas;

-- ─── 3. aulas → entidad física (ALTER, no DROP) ──────────────────────────────
-- DROP COLUMN arrastra automáticamente la UNIQUE(curso_academico_id, nombre), el
-- idx_aulas_curso, los CHECK de cohorte/capacidad y el FK a cursos. idx_aulas_centro
-- sobrevive (no involucra columnas eliminadas).
ALTER TABLE public.aulas
  DROP COLUMN curso_academico_id,
  DROP COLUMN cohorte_anos_nacimiento,
  DROP COLUMN capacidad_maxima;

-- Nombre único por centro (parcial, ignora soft-deleted). Sustituye a UNIQUE(curso, nombre).
CREATE UNIQUE INDEX idx_aulas_centro_nombre_unica
  ON public.aulas (centro_id, nombre)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.aulas IS
  'F11-H: aula FÍSICA (id, nombre, centro_id). La configuración por curso (tramo de edad, capacidad) vive en aulas_curso.';

-- ─── 4. aulas_curso: configuración del aula por curso ────────────────────────
CREATE TABLE public.aulas_curso (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id          uuid NOT NULL REFERENCES public.centros(id)            ON DELETE CASCADE,
  aula_id            uuid NOT NULL REFERENCES public.aulas(id)              ON DELETE CASCADE,
  curso_academico_id uuid NOT NULL REFERENCES public.cursos_academicos(id) ON DELETE CASCADE,
  tramo_edad         int[] NOT NULL CHECK (
    array_length(tramo_edad, 1) BETWEEN 1 AND 5
    AND 2020 <= ALL (tramo_edad)
    AND 2030 >= ALL (tramo_edad)
  ),
  capacidad          int NOT NULL DEFAULT 12 CHECK (capacidad BETWEEN 1 AND 40),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- UNIQUE NO parcial: es el destino de la FK compuesta de matriculas.
  CONSTRAINT aulas_curso_aula_curso_unica UNIQUE (aula_id, curso_academico_id)
);

CREATE INDEX idx_aulas_curso_curso  ON public.aulas_curso (curso_academico_id);
CREATE INDEX idx_aulas_curso_centro ON public.aulas_curso (centro_id);

COMMENT ON TABLE public.aulas_curso IS
  'F11-H: configuración de un aula física en un curso concreto (tramo de edad + capacidad). La capacidad es informativa: el aforo se avisa, NO se bloquea (decisión usuario).';

-- centro_id derivado del aula (denormalizado para RLS simple).
CREATE OR REPLACE FUNCTION public.aulas_curso_set_centro_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.centro_id := public.centro_de_aula(NEW.aula_id);
  RETURN NEW;
END $$;

CREATE TRIGGER aulas_curso_set_centro_id
  BEFORE INSERT ON public.aulas_curso
  FOR EACH ROW EXECUTE FUNCTION public.aulas_curso_set_centro_id();
CREATE TRIGGER aulas_curso_updated_at
  BEFORE UPDATE ON public.aulas_curso
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.aulas_curso ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier miembro del centro (staff + familia, igual que aulas/cursos).
CREATE POLICY aulas_curso_select_miembros ON public.aulas_curso
  FOR SELECT USING (public.pertenece_a_centro(centro_id));
-- Escritura: solo admin del centro.
CREATE POLICY aulas_curso_admin_all ON public.aulas_curso
  FOR ALL USING (public.es_admin(centro_id));

CREATE TRIGGER audit_aulas_curso
  AFTER INSERT OR UPDATE OR DELETE ON public.aulas_curso
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

-- ─── 5. matriculas (recreada) → referencia a aulas_curso (FK compuesta) ──────
-- Mantiene el ENUM matricula_estado (pendiente/lista/activa/baja, intacto) y el
-- UNIQUE(nino, curso) (decisión D). La FK compuesta (aula, curso) → aulas_curso
-- garantiza que no se matricule en un aula que no existe ese curso, y cubre la
-- validez de aula_id y curso_academico_id de una sola vez.
CREATE TABLE public.matriculas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nino_id            uuid NOT NULL REFERENCES public.ninos(id) ON DELETE RESTRICT,
  aula_id            uuid NOT NULL,
  curso_academico_id uuid NOT NULL,
  estado             public.matricula_estado NOT NULL DEFAULT 'activa',
  fecha_alta         date NOT NULL DEFAULT CURRENT_DATE,
  fecha_baja         date,
  motivo_baja        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  CHECK (fecha_baja IS NULL OR fecha_baja >= fecha_alta),
  CONSTRAINT matriculas_aula_curso_fkey
    FOREIGN KEY (aula_id, curso_academico_id)
    REFERENCES public.aulas_curso (aula_id, curso_academico_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_matricula_activa_unica
  ON public.matriculas (nino_id, curso_academico_id)
  WHERE fecha_baja IS NULL AND deleted_at IS NULL;
CREATE INDEX idx_matriculas_aula ON public.matriculas (aula_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_matriculas_nino ON public.matriculas (nino_id) WHERE deleted_at IS NULL;

ALTER TABLE public.matriculas ENABLE ROW LEVEL SECURITY;

-- admin del centro: todo. (centro_de_nino lee ninos → sin recursión ni MVCC.)
CREATE POLICY matriculas_admin_all ON public.matriculas
  FOR ALL USING (public.es_admin(public.centro_de_nino(nino_id)));
-- profe: SELECT de matrículas de su aula EN EL CURSO ACTIVO (cualificación operativa:
-- una matrícula planificada del módulo de admisiones no es visible para staff).
CREATE POLICY matriculas_profe_select ON public.matriculas
  FOR SELECT USING (
    public.es_profe_de_aula(aula_id)
    AND curso_academico_id = public.curso_activo_de_centro(public.centro_de_aula(aula_id))
  );
-- tutor: SELECT de las matrículas de sus hijos.
CREATE POLICY matriculas_tutor_select ON public.matriculas
  FOR SELECT USING (public.es_tutor_de(nino_id));

CREATE TRIGGER audit_matriculas
  AFTER INSERT OR UPDATE OR DELETE ON public.matriculas
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

-- ─── 6. profes_aulas (recreada) → asignación por (aula, curso) ───────────────
-- Conserva es_profe_principal (deprecated) y tipo_personal_aula. Añade
-- curso_academico_id: la asignación de personal es por curso (decisión B).
CREATE TABLE public.profes_aulas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profe_id           uuid NOT NULL REFERENCES public.usuarios(id)           ON DELETE CASCADE,
  aula_id            uuid NOT NULL REFERENCES public.aulas(id)              ON DELETE CASCADE,
  curso_academico_id uuid NOT NULL REFERENCES public.cursos_academicos(id) ON DELETE CASCADE,
  fecha_inicio       date NOT NULL DEFAULT CURRENT_DATE,
  fecha_fin          date,
  es_profe_principal boolean NOT NULL DEFAULT false,
  tipo_personal_aula public.tipo_personal_aula NOT NULL DEFAULT 'profesora',
  created_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio)
);

-- 1 coordinadora activa por (aula, curso) — antes era por aula.
CREATE UNIQUE INDEX idx_un_coordinadora_activa_por_aula_curso
  ON public.profes_aulas (aula_id, curso_academico_id)
  WHERE tipo_personal_aula = 'coordinadora' AND fecha_fin IS NULL AND deleted_at IS NULL;
CREATE INDEX idx_profes_aulas_profe ON public.profes_aulas (profe_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_profes_aulas_curso ON public.profes_aulas (curso_academico_id) WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.profes_aulas.es_profe_principal IS
  'DEPRECATED (F5B-#34) — sustituido por tipo_personal_aula. Se conserva en el recreate de F11-H-0 para no ampliar el blast radius; drop en PR posterior.';

ALTER TABLE public.profes_aulas ENABLE ROW LEVEL SECURITY;

CREATE POLICY profes_aulas_admin_all ON public.profes_aulas
  FOR ALL USING (public.es_admin(public.centro_de_aula(aula_id)));
CREATE POLICY profes_aulas_self_select ON public.profes_aulas
  FOR SELECT USING (profe_id = auth.uid());

-- (profes_aulas NO se audita — coherente con el modelo previo; aulas/cursos tampoco.)

-- ─── 7. lista_espera (prospecto, sin crear niño) ─────────────────────────────
CREATE TABLE public.lista_espera (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id          uuid NOT NULL REFERENCES public.centros(id)            ON DELETE CASCADE,
  curso_academico_id uuid NOT NULL REFERENCES public.cursos_academicos(id) ON DELETE CASCADE,
  nombre_nino        text NOT NULL,
  fecha_nacimiento   date,
  telefono_tutor     text,
  email_tutor        text,
  nota               text,
  posicion           int NOT NULL,
  estado             public.estado_lista_espera NOT NULL DEFAULT 'en_espera',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lista_espera_longitudes CHECK (
    char_length(nombre_nino) BETWEEN 1 AND 120
    AND (telefono_tutor IS NULL OR char_length(telefono_tutor) <= 30)
    AND (email_tutor     IS NULL OR char_length(email_tutor)   <= 255)
    AND (nota            IS NULL OR char_length(nota)          <= 1000)
  )
);

CREATE INDEX idx_lista_espera_cola
  ON public.lista_espera (centro_id, curso_academico_id, posicion);

COMMENT ON TABLE public.lista_espera IS
  'F11-H (decisión E): prospecto en lista de espera por (centro, curso). Datos previos a la creación del niño; "invitar al alta" (H-3) crea el niño + dispara sendInvitation. posicion editable a mano por la directora.';

CREATE OR REPLACE FUNCTION public.lista_espera_set_centro_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.centro_id := public.centro_de_curso(NEW.curso_academico_id);
  RETURN NEW;
END $$;

CREATE TRIGGER lista_espera_set_centro_id
  BEFORE INSERT ON public.lista_espera
  FOR EACH ROW EXECUTE FUNCTION public.lista_espera_set_centro_id();
CREATE TRIGGER lista_espera_updated_at
  BEFORE UPDATE ON public.lista_espera
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.lista_espera ENABLE ROW LEVEL SECURITY;

-- Lectura/escritura: solo admin del centro (datos de admisiones).
CREATE POLICY lista_espera_admin_all ON public.lista_espera
  FOR ALL USING (public.es_admin(centro_id));

CREATE TRIGGER audit_lista_espera
  AFTER INSERT OR UPDATE OR DELETE ON public.lista_espera
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

-- ─── 8. Helpers de staff cualificados por curso (decisión C, uno a uno) ──────
-- Firmas ESTABLES (no rompe llamadores en F3–F10). La cualificación es interna.

-- 8.1 es_profe_de_aula: "soy profe activo de este aula EN EL CURSO ACTIVO del centro".
--     Aislamiento: una asignación de un curso pasado/cerrado NO da acceso operativo hoy.
CREATE OR REPLACE FUNCTION public.es_profe_de_aula(p_aula_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profes_aulas pa
    WHERE pa.profe_id = auth.uid()
      AND pa.aula_id = p_aula_id
      AND pa.fecha_fin IS NULL AND pa.deleted_at IS NULL
      AND pa.curso_academico_id = public.curso_activo_de_centro(public.centro_de_aula(p_aula_id))
  );
$$;

-- 8.2 es_redactor_de_aula: igual + corte de autoría (coordinadora/profesora).
CREATE OR REPLACE FUNCTION public.es_redactor_de_aula(p_aula_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profes_aulas pa
    WHERE pa.profe_id = auth.uid()
      AND pa.aula_id = p_aula_id
      AND pa.fecha_fin IS NULL AND pa.deleted_at IS NULL
      AND pa.tipo_personal_aula IN ('coordinadora', 'profesora')
      AND pa.curso_academico_id = public.curso_activo_de_centro(public.centro_de_aula(p_aula_id))
  );
$$;

-- 8.3 es_profe_de_nino: profe del aula del niño EN EL MISMO CURSO de su matrícula
--     activa (JOIN curso-exacto pa.curso = m.curso). Aislamiento: un profe del aula
--     X en 25/26 no ve a un niño que sólo está en X en 26/27 (salvo que también esté
--     asignado en 26/27, que el admin controla). Conserva el endurecimiento estado='activa'.
CREATE OR REPLACE FUNCTION public.es_profe_de_nino(p_nino_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.matriculas m
    JOIN public.profes_aulas pa
      ON pa.aula_id = m.aula_id
     AND pa.curso_academico_id = m.curso_academico_id
    WHERE m.nino_id = p_nino_id
      AND m.fecha_baja IS NULL AND m.deleted_at IS NULL AND m.estado = 'activa'
      AND pa.profe_id = auth.uid()
      AND pa.fecha_fin IS NULL AND pa.deleted_at IS NULL
  );
$$;

-- 8.4 es_redactor_de_nino: igual + corte de autoría.
CREATE OR REPLACE FUNCTION public.es_redactor_de_nino(p_nino_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.matriculas m
    JOIN public.profes_aulas pa
      ON pa.aula_id = m.aula_id
     AND pa.curso_academico_id = m.curso_academico_id
    WHERE m.nino_id = p_nino_id
      AND m.fecha_baja IS NULL AND m.deleted_at IS NULL AND m.estado = 'activa'
      AND pa.profe_id = auth.uid()
      AND pa.fecha_fin IS NULL AND pa.deleted_at IS NULL
      AND pa.tipo_personal_aula IN ('coordinadora', 'profesora')
  );
$$;

-- Los siguientes helpers SE QUEDAN SIN CAMBIO (revisados uno a uno, confirmado por el
-- responsable): es_tutor_en_aula, familia_ve_aula, evento_aplica_a_nino,
-- autorizacion_aplica_a_nino, get_info_medica_emergencia, usuario_es_audiencia_anuncio(_row).
-- Razón: filtran por matrícula activa (estado='activa') del niño, que es siempre la del
-- curso operativo; el curso planificado sólo existe en el módulo de admisiones (admin-only).

-- ─── 9. audit_trigger_function: + ramas aulas_curso y lista_espera ───────────
-- Reproducida VERBATIM (F10-0) con dos ELSIF nuevos (centro_id directo). Sin esto,
-- el audit de las tablas nuevas dejaría centro_id NULL.
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
  ELSIF TG_TABLE_NAME = 'dias_centro' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'plantillas_menu_mensual' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'menu_dia' THEN
    v_centro_id := public.centro_de_plantilla(COALESCE((NEW).plantilla_id, (OLD).plantilla_id));
  ELSIF TG_TABLE_NAME = 'conversaciones' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'mensajes' THEN
    v_centro_id := public.centro_de_conversacion(COALESCE((NEW).conversacion_id, (OLD).conversacion_id));
  ELSIF TG_TABLE_NAME = 'anuncios' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'recordatorios' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'eventos' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'citas' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'cita_invitados' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'autorizaciones' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'firmas_autorizacion' THEN
    v_centro_id := public.centro_de_nino(COALESCE((NEW).nino_id, (OLD).nino_id));
  ELSIF TG_TABLE_NAME = 'administraciones_medicacion' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'plantillas_informe' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'informes_evolucion' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'campanas_informe' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'publicaciones' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'media' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'media_etiquetas' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'aulas_curso' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'lista_espera' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME IN (
    'info_medica_emergencia',
    'vinculos_familiares',
    'matriculas',
    'datos_pedagogicos_nino',
    'asistencias',
    'ausencias'
  ) THEN
    SELECT n.centro_id INTO v_centro_id
    FROM public.ninos n
    WHERE n.id = COALESCE((NEW).nino_id, (OLD).nino_id);
  ELSIF TG_TABLE_NAME = 'agendas_diarias' THEN
    v_centro_id := public.centro_de_nino(COALESCE((NEW).nino_id, (OLD).nino_id));
  ELSIF TG_TABLE_NAME IN ('comidas', 'biberones', 'suenos', 'deposiciones') THEN
    v_centro_id := public.centro_de_agenda(COALESCE((NEW).agenda_id, (OLD).agenda_id));
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

COMMIT;
