-- =============================================================================
-- F-4-2 · Asignación PERSISTENTE de conceptos por alumno/familia
-- -----------------------------------------------------------------------------
-- Separa las DOS capas de facturación que hasta ahora se colaban en una tabla
-- con (anio, mes):
--   (i)  PERMANENTE  = configuración del alumno/familia, SIN mes → esta tabla
--        NUEVA `asignacion_concepto`. "El concepto X aplica a Y de forma
--        permanente" (cuota, proyecto, comedor fijo, descuento…). Se define una
--        vez y se arrastra; el motor (F-4-3) la materializará cada mes.
--   (ii) MENSUAL     = la propuesta/edición de ese mes = las LÍNEAS del recibo
--        BORRADOR (F-4-1). NO se crea tabla intermedia. La edición mensual es un
--        override que vive en el recibo, NO toca la config permanente.
--
-- Decisiones cerradas de F-4-2:
--   · PERIODICIDAD = conceptos_cobro.tipo_concepto (fuente única). Desaparece
--     `modalidad`: `asignacion_concepto` NO la lleva. El motor (F-4-3) leerá
--     tipo_concepto (mensual/diario/esporadico) del propio concepto.
--   · Se DROPEAN `asignacion_cuota` (write-only-muerta tras F-4-1: la UI la
--     escribía pero el motor grano-niño ya no puede correr) y
--     `aplicaciones_concepto` (inerte, RLS deny-all, 0 consumidores). 0 datos
--     reales en ambas → drop libre.
--
-- Difiere a otras fases (NO en esta migración):
--   · Motor `cerrar_mes_cobros` reescrito a grano familia leyendo
--     asignacion_concepto  ................................................ F-4-3
--   · Cálculo del descuento hermanos ("el que más paga = 1º sin descuento") . F-4-3
--   · `crear_recibo_esporadico`  ......................................... F-4-3
--   · UX completa del panel de asignación permanente  .................... F-4-4
--
-- Aplicar por SQL Editor (rol postgres). NO por CLI. Regenerar database.ts DESPUÉS.
-- =============================================================================
BEGIN;

-- -----------------------------------------------------------------------------
-- 1. TABLA PERMANENTE — asignacion_concepto. Grano concepto → niño XOR familia,
--    SIN anio/mes, SIN modalidad. `origen` distingue lo sembrado por la propuesta
--    automática ('automatico') de lo que añade la directora a mano ('manual').
--    `vigencia_*` (opcional) permite altas/bajas de un concepto a mitad de curso
--    (espejo del rango de `becas`); NULL = vigente sin límite.
-- -----------------------------------------------------------------------------
CREATE TABLE public.asignacion_concepto (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id                 uuid NOT NULL REFERENCES public.centros(id)         ON DELETE CASCADE,
  concepto_id               uuid NOT NULL REFERENCES public.conceptos_cobro(id) ON DELETE RESTRICT,
  nino_id                   uuid REFERENCES public.ninos(id)                    ON DELETE CASCADE,
  familia_id                uuid REFERENCES public.familias(id)                 ON DELETE CASCADE,
  cantidad_default          integer NOT NULL DEFAULT 1 CHECK (cantidad_default >= 1),
  -- Precio pactado permanente distinto del catálogo (NULL = usar catálogo).
  importe_override_centimos integer CHECK (importe_override_centimos IS NULL OR importe_override_centimos >= 0),
  origen                    text NOT NULL CHECK (origen IN ('automatico', 'manual')),
  vigencia_desde            date,
  vigencia_hasta            date,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  deleted_at                timestamptz,
  -- Ámbito exclusivo: exactamente uno de niño/familia (mismo XOR que el catálogo).
  CONSTRAINT asignacion_concepto_ambito_xor
    CHECK ((nino_id IS NOT NULL) <> (familia_id IS NOT NULL)),
  CONSTRAINT asignacion_concepto_vigencia_coherente
    CHECK (vigencia_hasta IS NULL OR vigencia_desde IS NULL OR vigencia_hasta >= vigencia_desde)
);

-- Única asignación VIVA por (concepto, destino). Se usa COALESCE(nino_id,familia_id)
-- como "destino" porque un UNIQUE sobre (nino_id, familia_id) trataría los NULL como
-- distintos y NO deduplicaría. El XOR garantiza que exactamente uno no es NULL.
CREATE UNIQUE INDEX idx_asignacion_concepto_unica
  ON public.asignacion_concepto (concepto_id, COALESCE(nino_id, familia_id))
  WHERE deleted_at IS NULL;

-- Índices de acceso (panel por niño/familia + motor F-4-3 + RPC de propuesta).
CREATE INDEX idx_asignacion_concepto_nino
  ON public.asignacion_concepto (nino_id)    WHERE deleted_at IS NULL AND nino_id IS NOT NULL;
CREATE INDEX idx_asignacion_concepto_familia
  ON public.asignacion_concepto (familia_id) WHERE deleted_at IS NULL AND familia_id IS NOT NULL;
CREATE INDEX idx_asignacion_concepto_centro
  ON public.asignacion_concepto (centro_id)  WHERE deleted_at IS NULL;
CREATE INDEX idx_asignacion_concepto_concepto
  ON public.asignacion_concepto (concepto_id);

COMMENT ON TABLE public.asignacion_concepto IS
  'F-4-2: asignación PERMANENTE (sin mes) de un concepto a un niño XOR familia. Sustituye a asignacion_cuota (que llevaba mes+modalidad). La periodicidad ya no vive aquí: sale de conceptos_cobro.tipo_concepto. origen=automatico lo siembra proponer_asignaciones(); manual lo añade la directora. El motor F-4-3 la materializa en líneas de recibo cada mes; la edición del mes es un override sobre el recibo borrador, no sobre esta fila.';

-- centro_id derivado del destino (niño o familia). Función dedicada y genérica.
CREATE OR REPLACE FUNCTION public.derivar_centro_id_nino_o_familia()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.centro_id IS NULL THEN
    NEW.centro_id := COALESCE(
      public.centro_de_nino(NEW.nino_id),
      public.centro_de_familia(NEW.familia_id)
    );
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER asignacion_concepto_set_centro_id
  BEFORE INSERT ON public.asignacion_concepto
  FOR EACH ROW EXECUTE FUNCTION public.derivar_centro_id_nino_o_familia();
CREATE TRIGGER asignacion_concepto_set_updated_at
  BEFORE UPDATE ON public.asignacion_concepto
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: admin CRUD de su centro. El tutor NO accede (config interna; solo ve el
-- recibo final). DELETE sin policy → DENY (baja = soft-delete vía UPDATE).
ALTER TABLE public.asignacion_concepto ENABLE ROW LEVEL SECURITY;

CREATE POLICY asignacion_concepto_select ON public.asignacion_concepto
  FOR SELECT TO authenticated USING (public.es_admin(centro_id));
CREATE POLICY asignacion_concepto_insert ON public.asignacion_concepto
  FOR INSERT TO authenticated WITH CHECK (public.es_admin(centro_id));
CREATE POLICY asignacion_concepto_update ON public.asignacion_concepto
  FOR UPDATE TO authenticated USING (public.es_admin(centro_id)) WITH CHECK (public.es_admin(centro_id));

-- -----------------------------------------------------------------------------
-- 2. AUDITORÍA. Paridad con la vieja asignacion_cuota (billing/config sensible).
--    CREATE OR REPLACE de audit_trigger_function tomando la versión VIGENTE (F-3-A)
--    y sustituyendo 'asignacion_cuota' → 'asignacion_concepto' en la lista de
--    tablas con centro_id directo. El resto es idéntico a la definición vigente.
-- -----------------------------------------------------------------------------
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
  -- ── F-3-A: rollover_finaliza (centro_id directo) ─────────────────────────
  ELSIF TG_TABLE_NAME = 'rollover_finaliza' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  -- ── F-2a: familias (centro_id directo) ───────────────────────────────────
  ELSIF TG_TABLE_NAME = 'familias' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  -- ── F-2a: familia_tutores (centro derivado de la familia) ────────────────
  ELSIF TG_TABLE_NAME = 'familia_tutores' THEN
    v_centro_id := public.centro_de_familia(COALESCE((NEW).familia_id, (OLD).familia_id));
  ELSIF TG_TABLE_NAME IN (
    'conceptos_cobro',
    'tipos_beca',
    'asignacion_concepto',
    'becas',
    'metodo_pago_familia',
    'parte_servicio_diario',
    'cierre_mensual',
    'recibos',
    'lineas_recibo',
    'remesas',
    'recibos_remesa'
  ) THEN
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

CREATE TRIGGER audit_asignacion_concepto
  AFTER INSERT OR UPDATE OR DELETE ON public.asignacion_concepto
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

-- -----------------------------------------------------------------------------
-- 3. RPC de PROPUESTA — proponer_asignaciones. Siembra filas origen='automatico'
--    para los conceptos con aplicacion='automatico' del centro:
--      · ambito='nino'    → todos los niños con matrícula activa.
--      · ambito='familia' → todas las familias con ≥1 hijo matriculado;
--        EXCEPCIÓN descuento hermanos (signo=-1) → solo familias con ≥2.
--
--    IDEMPOTENCIA + RESPETO A LA EDICIÓN: solo inserta si NO existe NINGUNA fila
--    (viva NI soft-borrada) para ese (concepto, destino). Así (a) no duplica —el
--    UNIQUE parcial ya lo impediría para vivas— y (b) NO resucita una auto que la
--    directora borró (una fila soft-borrada cuenta como "ya existe" → se salta).
--    Devuelve el nº de filas sembradas.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.proponer_asignaciones(p_centro_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r_concepto record;
  v_total integer := 0;
  v_n integer;
BEGIN
  IF NOT public.es_admin(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  FOR r_concepto IN
    SELECT id, ambito, signo
    FROM public.conceptos_cobro
    WHERE centro_id = p_centro_id
      AND aplicacion = 'automatico'
      AND activo = true
      AND deleted_at IS NULL
  LOOP
    IF r_concepto.ambito = 'nino' THEN
      INSERT INTO public.asignacion_concepto (concepto_id, nino_id, origen)
      SELECT r_concepto.id, n.id, 'automatico'
      FROM public.ninos n
      JOIN public.matriculas m ON m.nino_id = n.id
      WHERE n.centro_id = p_centro_id
        AND m.estado = 'activa' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.asignacion_concepto a
          WHERE a.concepto_id = r_concepto.id AND a.nino_id = n.id
        );
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_total := v_total + v_n;

    ELSE  -- ambito = 'familia'
      INSERT INTO public.asignacion_concepto (concepto_id, familia_id, origen)
      SELECT r_concepto.id, f.id, 'automatico'
      FROM public.familias f
      WHERE f.centro_id = p_centro_id
        AND (
          SELECT count(*) FROM public.ninos n
          JOIN public.matriculas m ON m.nino_id = n.id
          WHERE n.familia_id = f.id
            AND m.estado = 'activa' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
        ) >= CASE WHEN r_concepto.signo = -1 THEN 2 ELSE 1 END
        AND NOT EXISTS (
          SELECT 1 FROM public.asignacion_concepto a
          WHERE a.concepto_id = r_concepto.id AND a.familia_id = f.id
        );
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_total := v_total + v_n;
    END IF;
  END LOOP;

  RETURN v_total;
END $$;
GRANT EXECUTE ON FUNCTION public.proponer_asignaciones(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. DROP de las tablas viejas. 0 datos reales:
--    · asignacion_cuota      → write-only-muerta tras F-4-1 (motor grano-niño ya
--                              no puede correr). CASCADE lleva sus policies,
--                              índices y el trigger audit_asignacion_cuota.
--    · aplicaciones_concepto → inerte desde F-1, RLS deny-all, 0 consumidores.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS public.asignacion_cuota CASCADE;
DROP TABLE IF EXISTS public.aplicaciones_concepto CASCADE;

-- El ENUM modalidad_cobro solo lo usaba asignacion_cuota → queda huérfano. La
-- periodicidad ahora sale de conceptos_cobro.tipo_concepto (fuente única).
DROP TYPE IF EXISTS public.modalidad_cobro;

COMMIT;
