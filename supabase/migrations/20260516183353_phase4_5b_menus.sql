-- =============================================================================
-- Fase 4.5b — Menús mensuales + pase de lista comida por platos
-- =============================================================================
-- 2 ENUMs nuevos (estado_plantilla_menu, tipo_plato_comida).
-- 2 tablas nuevas (plantillas_menu_mensual, menu_dia).
-- Extensión de `comidas` (F3) con 2 columnas + índice único parcial.
-- 3 helpers SQL (nino_toma_comida_solida, centro_de_plantilla, menu_del_dia).
-- Trigger BEFORE INSERT/UPDATE en menu_dia que valida que `fecha` cae
-- dentro del mes/año de la plantilla padre (red de seguridad ante INSERT
-- por SQL directo o bugs de código; el server action valida con Zod para
-- la UX, este trigger es la defensa a nivel BD).
-- Políticas RLS por tabla. DELETE bloqueado a todos (plantillas se
-- archivan, no se borran).
-- Audit log automático extendiendo `audit_trigger_function()` con 2
-- ramas nuevas.
--
-- Spec: docs/specs/menus.md
-- ADRs: 0020 (plantilla mensual), 0021 (extensión comidas), 0022 (escala
--       1-5 mapeada al enum cantidad_comida existente).
-- =============================================================================

-- ─── 1. ENUMs ─────────────────────────────────────────────────────────────
CREATE TYPE public.estado_plantilla_menu AS ENUM (
  'borrador', 'publicada', 'archivada'
);

-- `unico` cubre desayuno/media_manana/merienda (1 plato por momento).
-- `primer_plato`/`segundo_plato`/`postre` cubren el momento `comida`.
CREATE TYPE public.tipo_plato_comida AS ENUM (
  'primer_plato', 'segundo_plato', 'postre', 'unico'
);

-- ─── 2. Tabla plantillas_menu_mensual ─────────────────────────────────────
CREATE TABLE public.plantillas_menu_mensual (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id   uuid NOT NULL REFERENCES public.centros(id) ON DELETE CASCADE,
  mes         smallint NOT NULL,
  anio        smallint NOT NULL,
  estado      public.estado_plantilla_menu NOT NULL DEFAULT 'borrador',
  creada_por  uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz NULL,
  CONSTRAINT plantillas_menu_mes_check CHECK (mes BETWEEN 1 AND 12),
  CONSTRAINT plantillas_menu_anio_check CHECK (anio BETWEEN 2024 AND 2100)
);

-- Una sola PUBLICADA activa por (centro, mes, año). Borradores y
-- archivadas pueden coexistir libremente.
CREATE UNIQUE INDEX plantillas_menu_publicada_unique_idx
  ON public.plantillas_menu_mensual (centro_id, mes, anio)
  WHERE estado = 'publicada' AND deleted_at IS NULL;

CREATE INDEX plantillas_menu_centro_anio_mes_idx
  ON public.plantillas_menu_mensual (centro_id, anio DESC, mes DESC);

CREATE TRIGGER plantillas_menu_set_updated_at
  BEFORE UPDATE ON public.plantillas_menu_mensual
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 3. Tabla menu_dia ────────────────────────────────────────────────────
CREATE TABLE public.menu_dia (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plantilla_id    uuid NOT NULL REFERENCES public.plantillas_menu_mensual(id) ON DELETE CASCADE,
  fecha           date NOT NULL,
  desayuno        text NULL,
  media_manana    text NULL,
  comida_primero  text NULL,
  comida_segundo  text NULL,
  comida_postre   text NULL,
  merienda        text NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT menu_dia_plantilla_fecha_unique UNIQUE (plantilla_id, fecha),
  CONSTRAINT menu_dia_desayuno_len CHECK (desayuno IS NULL OR length(desayuno) <= 300),
  CONSTRAINT menu_dia_media_manana_len CHECK (media_manana IS NULL OR length(media_manana) <= 300),
  CONSTRAINT menu_dia_comida_primero_len CHECK (comida_primero IS NULL OR length(comida_primero) <= 300),
  CONSTRAINT menu_dia_comida_segundo_len CHECK (comida_segundo IS NULL OR length(comida_segundo) <= 300),
  CONSTRAINT menu_dia_comida_postre_len CHECK (comida_postre IS NULL OR length(comida_postre) <= 300),
  CONSTRAINT menu_dia_merienda_len CHECK (merienda IS NULL OR length(merienda) <= 300)
);

CREATE INDEX menu_dia_fecha_idx ON public.menu_dia (fecha);

CREATE TRIGGER menu_dia_set_updated_at
  BEFORE UPDATE ON public.menu_dia
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 4. Trigger de integridad: fecha dentro del mes/año de la plantilla ──
-- Red de seguridad a nivel BD. El server action también valida con Zod
-- para UX, pero este trigger protege ante INSERT por SQL directo, bugs
-- de código futuros o cambios del lado cliente.
CREATE OR REPLACE FUNCTION public.menu_dia_validar_fecha_en_plantilla()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mes  smallint;
  v_anio smallint;
BEGIN
  SELECT mes, anio INTO v_mes, v_anio
  FROM public.plantillas_menu_mensual
  WHERE id = NEW.plantilla_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'menu_dia: plantilla % no existe', NEW.plantilla_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF EXTRACT(MONTH FROM NEW.fecha)::smallint <> v_mes
     OR EXTRACT(YEAR FROM NEW.fecha)::smallint <> v_anio THEN
    RAISE EXCEPTION 'menu_dia.fecha (%) cae fuera del mes/año de la plantilla (%/%)',
      NEW.fecha, v_mes, v_anio
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER menu_dia_validar_fecha
  BEFORE INSERT OR UPDATE ON public.menu_dia
  FOR EACH ROW EXECUTE FUNCTION public.menu_dia_validar_fecha_en_plantilla();

-- ─── 5. Extensión de `comidas` (tabla de F3) ──────────────────────────────
-- Añade 2 columnas NULLables (compatibilidad total con datos de F3):
--  - `tipo_plato`: distingue plato dentro del momento (NULL = legacy F3).
--  - `menu_dia_id`: traza opcional al menú origen (NULL = registro
--    individual sin batch).
-- ON DELETE SET NULL: si una plantilla se borrara (no se puede vía UI,
-- pero CASCADE desde centro sí), los registros históricos de comidas
-- preservan cantidad y descripción aunque pierdan el link al menú.
ALTER TABLE public.comidas
  ADD COLUMN tipo_plato public.tipo_plato_comida NULL,
  ADD COLUMN menu_dia_id uuid NULL REFERENCES public.menu_dia(id) ON DELETE SET NULL;

-- Índice único parcial que permite el UPSERT atómico del batch del
-- pase de lista (ON CONFLICT (agenda_id, momento, tipo_plato)). Las
-- filas legacy con tipo_plato=NULL NO entran al índice (WHERE) y por
-- tanto no chocan con la lógica F3 existente.
CREATE UNIQUE INDEX comidas_agenda_momento_tipo_plato_idx
  ON public.comidas (agenda_id, momento, tipo_plato)
  WHERE tipo_plato IS NOT NULL;

-- Índice secundario para los joins desde menu_dia_id (informes futuros,
-- análisis de qué se comió de cada menú).
CREATE INDEX comidas_menu_dia_idx ON public.comidas (menu_dia_id)
  WHERE menu_dia_id IS NOT NULL;

-- ─── 6. Helpers SQL ───────────────────────────────────────────────────────
-- `nino_toma_comida_solida(nino_id)`: recreado tras el revert de la F4.5
-- descartada. Devuelve FALSE si lactancia_estado IN ('materna','biberon');
-- TRUE en cualquier otro caso (mixta/finalizada/no_aplica/sin_datos).
-- El COALESCE a TRUE asegura que un niño sin datos pedagógicos aparezca
-- en el pase de lista — más vale registrar de más que excluir por error.
CREATE OR REPLACE FUNCTION public.nino_toma_comida_solida(p_nino_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (
      SELECT lactancia_estado NOT IN (
        'materna'::public.lactancia_estado,
        'biberon'::public.lactancia_estado
      )
      FROM public.datos_pedagogicos_nino
      WHERE nino_id = p_nino_id
    ),
    TRUE
  );
$$;

GRANT EXECUTE ON FUNCTION public.nino_toma_comida_solida(uuid) TO authenticated;

-- `centro_de_plantilla(plantilla_id)`: helper auxiliar para las RLS de
-- `menu_dia` (que no tiene centro_id directo). Mismo patrón que
-- `centro_de_nino` / `centro_de_agenda` (ADR-0007).
CREATE OR REPLACE FUNCTION public.centro_de_plantilla(p_plantilla_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT centro_id FROM public.plantillas_menu_mensual WHERE id = p_plantilla_id;
$$;

GRANT EXECUTE ON FUNCTION public.centro_de_plantilla(uuid) TO authenticated;

-- `menu_del_dia(centro, fecha)`: devuelve la fila `menu_dia` aplicable
-- a una fecha mirando la plantilla `publicada` (no archivada, no borrador)
-- del mes/año correspondiente. NULL si no hay plantilla publicada o si
-- la plantilla no tiene fila `menu_dia` para esa fecha.
CREATE OR REPLACE FUNCTION public.menu_del_dia(p_centro_id uuid, p_fecha date)
RETURNS public.menu_dia
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT md.*
  FROM public.menu_dia md
  JOIN public.plantillas_menu_mensual p ON p.id = md.plantilla_id
  WHERE p.centro_id = p_centro_id
    AND p.estado = 'publicada'::public.estado_plantilla_menu
    AND p.deleted_at IS NULL
    AND p.mes = EXTRACT(MONTH FROM p_fecha)::smallint
    AND p.anio = EXTRACT(YEAR FROM p_fecha)::smallint
    AND md.fecha = p_fecha
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.menu_del_dia(uuid, date) TO authenticated;

-- ─── 7. RLS: plantillas_menu_mensual ──────────────────────────────────────
-- SELECT: cualquier miembro del centro (admin, profe, tutor o autorizado).
-- INSERT/UPDATE: solo admin del centro.
-- DELETE: ninguna policy → default DENY. Las plantillas se archivan
-- (UPDATE estado='archivada'), no se borran.
ALTER TABLE public.plantillas_menu_mensual ENABLE ROW LEVEL SECURITY;

CREATE POLICY plantillas_menu_select ON public.plantillas_menu_mensual
  FOR SELECT
  USING (public.pertenece_a_centro(centro_id));

CREATE POLICY plantillas_menu_insert ON public.plantillas_menu_mensual
  FOR INSERT
  WITH CHECK (public.es_admin(centro_id));

CREATE POLICY plantillas_menu_update ON public.plantillas_menu_mensual
  FOR UPDATE
  USING (public.es_admin(centro_id))
  WITH CHECK (public.es_admin(centro_id));

-- ─── 8. RLS: menu_dia ─────────────────────────────────────────────────────
-- Mismo patrón pero derivando centro_id vía centro_de_plantilla.
ALTER TABLE public.menu_dia ENABLE ROW LEVEL SECURITY;

CREATE POLICY menu_dia_select ON public.menu_dia
  FOR SELECT
  USING (public.pertenece_a_centro(public.centro_de_plantilla(plantilla_id)));

CREATE POLICY menu_dia_insert ON public.menu_dia
  FOR INSERT
  WITH CHECK (public.es_admin(public.centro_de_plantilla(plantilla_id)));

CREATE POLICY menu_dia_update ON public.menu_dia
  FOR UPDATE
  USING (public.es_admin(public.centro_de_plantilla(plantilla_id)))
  WITH CHECK (public.es_admin(public.centro_de_plantilla(plantilla_id)));

-- ─── 9. audit_trigger_function ampliada ───────────────────────────────────
-- Añade 2 ramas: `plantillas_menu_mensual` (centro_id directo) y
-- `menu_dia` (derivado via centro_de_plantilla). CREATE OR REPLACE
-- preserva todas las ramas previas (Fases 2, 2.6, 3, 4, 4.5a).
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

-- ─── 10. Triggers de audit en las 2 tablas nuevas ─────────────────────────
CREATE TRIGGER audit_plantillas_menu_mensual
  AFTER INSERT OR UPDATE OR DELETE ON public.plantillas_menu_mensual
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

CREATE TRIGGER audit_menu_dia
  AFTER INSERT OR UPDATE OR DELETE ON public.menu_dia
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

-- `comidas` ya tiene trigger de audit desde F3 — NO se toca. La extensión
-- con `tipo_plato` y `menu_dia_id` queda recogida automáticamente porque
-- el trigger graba `to_jsonb(NEW)` con todas las columnas.
