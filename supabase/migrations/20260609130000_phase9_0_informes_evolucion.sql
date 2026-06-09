-- =============================================================================
-- Fase 9 — Informes de evolución (F9-0: modelo de datos + RLS, sin UI)
-- =============================================================================
-- ADITIVA: las tablas `plantillas_informe` e `informes_evolucion` NO existen → solo
-- CREATE. NUNCA drop+recreate. Fuente de verdad: docs/specs/informes-evolucion.md
-- (spec approved; resoluciones Q1–Q11 cerradas). ADR: docs/decisions/ADR-0042-...
--
-- QUÉ ES: boletines de desarrollo (cualitativos). NO es el parte diario (agenda F3).
-- Estructura áreas→ítems; cada ítem se valora con una escala de 3
-- (conseguido/en_proceso/no_iniciado) + comentario opcional; + observaciones
-- generales del informe.
--
-- 4 ENUMs:
--   periodo_informe          = trimestre_1 | trimestre_2 | trimestre_3 | fin_curso
--   estado_informe           = borrador | publicado
--   valoracion_item_informe  = conseguido | en_proceso | no_iniciado (escala de 3,
--                              ENUM NUEVO; NO reusa la escala 1-5 de cantidad_comida)
--   estado_plantilla_informe = activa | archivada (Q1: se archiva, no se borra)
--
-- DECISIONES DE MODELO (ver ADR):
--  - Q1  VARIAS plantillas por centro (sin UNIQUE que fuerce una sola). El tramo de
--        edad NO se ata en el modelo: es solo el `titulo` que ponga la dirección.
--  - Q2  Estructura áreas→ítems y respuestas en JSONB dentro de las 2 tablas,
--        SIN tablas hijo. (Matiz frente a ADR-0012: en F9 NO hay análisis por ítem;
--        el contenido es cualitativo, no se agrega → JSONB es la encaje correcto.)
--  - Q3/Q4 SNAPSHOT al crear: `informes_evolucion.estructura_snapshot` congela la
--        estructura de la plantilla en ese momento. Editar la plantilla DESPUÉS no
--        toca informes ya creados NI borradores en curso. Sin versionado formal.
--  - Q5  Autoría por tipo_personal_aula (ADR-0032): coordinadora y profesora
--        redactan/publican; tecnico y apoyo NO escriben (solo leen). admin todo.
--        → helper `es_redactor_de_nino` (filtra el tipo_personal_aula).
--  - Q6  SIN cierre temporal: se corrigen informes de trimestres/cursos pasados.
--        NO sigue la regla "día cerrado" de ADR-0016 (no son hechos diarios).
--  - Q7  Lectura familia: reusa el permiso EXISTENTE `puede_ver_datos_pedagogicos`.
--        Tutor legal ve siempre; autorizado solo si tiene el permiso. Sin permiso nuevo.
--  - Q8  `notificado_at`: sella la PRIMERA publicación notificada. El aviso in-app
--        (ADR-0025) y el sellado los hace el server action en F9-2; aquí solo la
--        columna. Republicaciones (notificado_at ya puesto) NO re-avisan.
--  - Q9  Para PUBLICAR: todos los ítems valorados (lo enforza el server action en
--        F9-2; aquí NO se enforza a nivel BD — el borrador puede estar incompleto).
--  - Q10 Contenido (áreas/ítems/comentarios/observaciones) en CASTELLANO, un idioma.
--  - Q11 PDF server-side (F9-2; no afecta a la capa de datos).
--
-- Helpers SQL nuevos (STABLE SECURITY DEFINER, search_path=public, GRANT authenticated):
--   es_redactor_de_nino(nino_id)        → boolean (profe del aula del niño con
--                                         tipo_personal_aula IN coordinadora/profesora).
--   es_tutor_legal_de(nino_id)          → boolean (vínculo tutor_legal_*; excluye
--                                         'autorizado'). Para "tutor legal ve siempre".
--   usuario_es_audiencia_informe_row(centro_id, nino_id, estado) → ROW-AWARE: NO
--                                         re-lee `informes_evolucion` (evita el gotcha
--                                         MVCC en INSERT…RETURNING, igual que F8). Sus
--                                         lookups van a OTRAS tablas (roles_usuario,
--                                         matriculas, profes_aulas, vinculos_familiares).
-- Reutiliza: es_admin, es_profe_de_nino, es_profe_en_centro, centro_de_nino,
--   tiene_permiso_sobre, set_updated_at.
--
-- audit_trigger_function ampliada con 2 ramas: `plantillas_informe` e
--   `informes_evolucion` (ambas centro_id directo). AMBAS se auditan. Sin Realtime.
--
-- Operación sobre esquema productivo → se aplica MANUALMENTE por SQL Editor (CLI con
-- bug SIGILL en este Chromebook). No la ejecuta el agente. Tras aplicarla, registrar
-- en supabase_migrations.schema_migrations y regenerar src/types/database.ts.
-- =============================================================================
BEGIN;

-- ─── 1. ENUMs ────────────────────────────────────────────────────────────────
CREATE TYPE public.periodo_informe          AS ENUM ('trimestre_1', 'trimestre_2', 'trimestre_3', 'fin_curso');
CREATE TYPE public.estado_informe           AS ENUM ('borrador', 'publicado');
CREATE TYPE public.valoracion_item_informe  AS ENUM ('conseguido', 'en_proceso', 'no_iniciado');
CREATE TYPE public.estado_plantilla_informe AS ENUM ('activa', 'archivada');

-- ─── 2. Tabla plantillas_informe (estructura áreas→ítems; varias por centro) ──
-- Q1: SIN índice único que fuerce una sola plantilla. El `titulo` puede nombrar el
-- tramo de edad ("Aula bebés", "1-2 años"), pero la edad NO se modela.
-- Q2: la estructura áreas→ítems vive en `estructura` (jsonb), en castellano (Q10).
-- Archivar (no borrar): estado='archivada' + archivada_at/por (patrón F8).
CREATE TABLE public.plantillas_informe (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id     uuid NOT NULL REFERENCES public.centros(id)  ON DELETE CASCADE,
  titulo        text NOT NULL,
  estructura    jsonb NOT NULL DEFAULT '[]'::jsonb,           -- [{ titulo, items: [{ id, texto }] }] (castellano)
  estado        public.estado_plantilla_informe NOT NULL DEFAULT 'activa',
  archivada_at  timestamptz,
  archivada_por uuid REFERENCES public.usuarios(id)          ON DELETE SET NULL,
  creado_por    uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT plantillas_informe_titulo_len CHECK (char_length(titulo) BETWEEN 1 AND 200),
  -- Coherencia de archivado: at/por van juntos, y solo si estado='archivada'.
  CONSTRAINT plantillas_informe_archivado_coherencia CHECK (
    (estado = 'archivada' AND archivada_at IS NOT NULL)
    OR (estado = 'activa' AND archivada_at IS NULL AND archivada_por IS NULL)
  )
);

COMMENT ON TABLE public.plantillas_informe IS
  'Plantillas de informe de evolución (F9). Estructura áreas→ítems en JSONB (castellano). VARIAS por centro (Q1). Se archiva, no se borra. Ver docs/specs/informes-evolucion.md.';
COMMENT ON COLUMN public.plantillas_informe.estructura IS
  'Áreas→ítems: [{ titulo, items: [{ id (clave estable), texto }] }]. En castellano (Q10).';

CREATE INDEX idx_plantillas_informe_centro
  ON public.plantillas_informe (centro_id) WHERE estado = 'activa';

-- ─── 3. Tabla informes_evolucion (informe de un niño en un período) ──────────
-- Cuelga de niño + curso académico (tabla existente) + período. UNIQUE por la terna
-- (un informe por niño/curso/período). `estructura_snapshot` congela la plantilla al
-- crear (Q3/Q4). `respuestas` = { item_id: { valoracion, comentario? } } (Q2).
CREATE TABLE public.informes_evolucion (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id               uuid NOT NULL REFERENCES public.centros(id)            ON DELETE CASCADE,
  nino_id                 uuid NOT NULL REFERENCES public.ninos(id)              ON DELETE RESTRICT,
  curso_academico_id      uuid NOT NULL REFERENCES public.cursos_academicos(id)  ON DELETE RESTRICT,
  periodo                 public.periodo_informe NOT NULL,
  plantilla_id            uuid NOT NULL REFERENCES public.plantillas_informe(id) ON DELETE RESTRICT,
  estructura_snapshot     jsonb NOT NULL,                       -- copia CONGELADA de plantillas_informe.estructura al crear
  respuestas              jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { item_id: { valoracion, comentario? } }
  observaciones_generales text,
  estado                  public.estado_informe NOT NULL DEFAULT 'borrador',
  creado_por              uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,  -- autor
  publicado_at            timestamptz,
  notificado_at           timestamptz,                          -- Q8: sella la 1.ª publicación notificada (server action F9-2)
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  -- Un informe por (niño, curso, período).
  CONSTRAINT informes_evolucion_terna_unica UNIQUE (nino_id, curso_academico_id, periodo),
  CONSTRAINT informes_evolucion_observaciones_len CHECK (
    observaciones_generales IS NULL OR char_length(observaciones_generales) <= 4000
  ),
  -- publicado_at coherente con el estado (borrador ⇒ sin fecha de publicación).
  CONSTRAINT informes_evolucion_publicado_coherencia CHECK (
    (estado = 'borrador' AND publicado_at IS NULL)
    OR (estado = 'publicado' AND publicado_at IS NOT NULL)
  ),
  -- notificado_at solo tiene sentido una vez publicado (Q8).
  CONSTRAINT informes_evolucion_notificado_coherencia CHECK (
    notificado_at IS NULL OR estado = 'publicado'
  )
);

COMMENT ON TABLE public.informes_evolucion IS
  'Informe de evolución de un niño en un período (F9). UNIQUE (nino, curso, periodo). estructura_snapshot congela la plantilla al crear (Q3/Q4). estado borrador→publicado; sin ventana temporal (Q6). Ver docs/specs/informes-evolucion.md.';
COMMENT ON COLUMN public.informes_evolucion.estructura_snapshot IS
  'Copia congelada de plantillas_informe.estructura al crear el informe. Editar la plantilla después NO afecta a este informe (Q3/Q4).';
COMMENT ON COLUMN public.informes_evolucion.respuestas IS
  'Valoraciones por ítem: { item_id: { valoracion (escala de 3), comentario? } }.';
COMMENT ON COLUMN public.informes_evolucion.notificado_at IS
  'Sella la PRIMERA publicación notificada (Q8). Si ya está puesto, las republicaciones NO re-avisan. Lo setea el server action (F9-2).';

CREATE INDEX idx_informes_evolucion_centro_curso
  ON public.informes_evolucion (centro_id, curso_academico_id);
CREATE INDEX idx_informes_evolucion_nino
  ON public.informes_evolucion (nino_id);
CREATE INDEX idx_informes_evolucion_plantilla
  ON public.informes_evolucion (plantilla_id);

-- ─── 4. Triggers updated_at ──────────────────────────────────────────────────
CREATE TRIGGER plantillas_informe_set_updated_at
  BEFORE UPDATE ON public.plantillas_informe
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER informes_evolucion_set_updated_at
  BEFORE UPDATE ON public.informes_evolucion
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 5. Helpers SQL ──────────────────────────────────────────────────────────
-- ¿Soy REDACTOR del informe del niño? = profe del aula del niño cuyo
-- tipo_personal_aula es coordinadora o profesora (Q5/ADR-0032). Espejo de
-- es_profe_de_nino + filtro de tipo. tecnico/apoyo NO son redactores.
CREATE OR REPLACE FUNCTION public.es_redactor_de_nino(p_nino_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.matriculas m
    JOIN public.profes_aulas pa ON pa.aula_id = m.aula_id
    WHERE m.nino_id = p_nino_id
      AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
      AND pa.profe_id = auth.uid()
      AND pa.fecha_fin IS NULL AND pa.deleted_at IS NULL
      AND pa.tipo_personal_aula IN ('coordinadora', 'profesora')
  );
$$;
GRANT EXECUTE ON FUNCTION public.es_redactor_de_nino(uuid) TO authenticated;

-- ¿Soy TUTOR LEGAL del niño? (excluye 'autorizado'). Para "tutor legal ve siempre"
-- (Q7); el autorizado pasa por tiene_permiso_sobre(puede_ver_datos_pedagogicos).
CREATE OR REPLACE FUNCTION public.es_tutor_legal_de(p_nino_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vinculos_familiares
    WHERE usuario_id = auth.uid()
      AND nino_id = p_nino_id
      AND deleted_at IS NULL
      AND tipo_vinculo IN ('tutor_legal_principal', 'tutor_legal_secundario')
  );
$$;
GRANT EXECUTE ON FUNCTION public.es_tutor_legal_de(uuid) TO authenticated;

-- Audiencia de lectura del informe. ROW-AWARE: recibe centro_id/nino_id/estado por
-- parámetro y NO re-lee `informes_evolucion` → evita el gotcha MVCC en
-- INSERT…RETURNING (los lookups van a OTRAS tablas). Reglas (Q7):
--  · admin del centro o personal del aula del niño (cualquier tipo) → cualquier estado.
--  · familia → SOLO publicados: tutor legal siempre; autorizado con permiso.
CREATE OR REPLACE FUNCTION public.usuario_es_audiencia_informe_row(
  p_centro_id uuid,
  p_nino_id   uuid,
  p_estado    public.estado_informe
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Staff: admin del centro o profe del niño (incluye tecnico/apoyo) → todos los estados.
  IF public.es_admin(p_centro_id) OR public.es_profe_de_nino(p_nino_id) THEN
    RETURN TRUE;
  END IF;
  -- Familia: SOLO publicados. Tutor legal ve siempre; autorizado solo con permiso.
  IF p_estado = 'publicado'
     AND (
       public.es_tutor_legal_de(p_nino_id)
       OR public.tiene_permiso_sobre(p_nino_id, 'puede_ver_datos_pedagogicos')
     ) THEN
    RETURN TRUE;
  END IF;
  RETURN FALSE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.usuario_es_audiencia_informe_row(uuid, uuid, public.estado_informe) TO authenticated;

-- ─── 6. RLS: plantillas_informe ──────────────────────────────────────────────
ALTER TABLE public.plantillas_informe ENABLE ROW LEVEL SECURITY;

-- SELECT: STAFF del centro (admin o cualquier profe del centro). La FAMILIA NO accede
-- a las plantillas (no se usa `pertenece_a_centro`, que incluiría a tutores).
CREATE POLICY plantillas_informe_select ON public.plantillas_informe
  FOR SELECT USING (
    public.es_admin(centro_id) OR public.es_profe_en_centro(centro_id)
  );

-- INSERT / UPDATE: solo dirección (admin). creado_por = auth.uid() (anti-suplantación).
CREATE POLICY plantillas_informe_insert ON public.plantillas_informe
  FOR INSERT WITH CHECK (
    public.es_admin(centro_id) AND creado_por = auth.uid()
  );

CREATE POLICY plantillas_informe_update ON public.plantillas_informe
  FOR UPDATE
  USING (public.es_admin(centro_id))
  WITH CHECK (public.es_admin(centro_id));

-- DELETE: sin policy → default DENY. Se archiva (estado='archivada'), no se borra.

-- ─── 7. RLS: informes_evolucion ──────────────────────────────────────────────
ALTER TABLE public.informes_evolucion ENABLE ROW LEVEL SECURITY;

-- SELECT: audiencia row-aware. Staff (admin/profe del niño) cualquier estado;
-- familia solo publicados (tutor legal siempre, autorizado con permiso). Q7.
CREATE POLICY informes_evolucion_select ON public.informes_evolucion
  FOR SELECT USING (
    public.usuario_es_audiencia_informe_row(centro_id, nino_id, estado)
  );

-- INSERT: admin del centro, o REDACTOR (coordinadora/profesora) del aula del niño.
-- tecnico/apoyo NO (es_redactor_de_nino los excluye). creado_por = auth.uid().
CREATE POLICY informes_evolucion_insert ON public.informes_evolucion
  FOR INSERT WITH CHECK (
    creado_por = auth.uid()
    AND (
      public.es_admin(centro_id)
      OR (public.es_redactor_de_nino(nino_id) AND public.centro_de_nino(nino_id) = centro_id)
    )
  );

-- UPDATE (editar / publicar / despublicar): admin o redactor del niño. Defensa
-- simétrica USING + WITH CHECK. La regla de publicación (todos los ítems valorados,
-- Q9) y el sellado de notificado_at (Q8) los enforza el server action en F9-2.
CREATE POLICY informes_evolucion_update ON public.informes_evolucion
  FOR UPDATE
  USING (public.es_admin(centro_id) OR public.es_redactor_de_nino(nino_id))
  WITH CHECK (public.es_admin(centro_id) OR public.es_redactor_de_nino(nino_id));

-- DELETE: sin policy → default DENY. Corrección = despublicar/editar (sin DELETE).

-- ─── 8. audit_trigger_function ampliada (plantillas_informe + informes_evolucion) ─
-- CREATE OR REPLACE preserva las ramas previas (Fases 2..8). Se añaden 2 ramas, ambas
-- con centro_id directo. AMBAS se auditan (igual que el resto de tablas con contenido).
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

CREATE TRIGGER audit_plantillas_informe
  AFTER INSERT OR UPDATE OR DELETE ON public.plantillas_informe
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

CREATE TRIGGER audit_informes_evolucion
  AFTER INSERT OR UPDATE OR DELETE ON public.informes_evolucion
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

COMMIT;
