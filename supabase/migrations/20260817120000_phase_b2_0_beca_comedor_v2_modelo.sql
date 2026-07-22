-- =============================================================================
-- B2-0 · BECA COMEDOR v2 — MODELO (elegibilidad + tramos desacoplados + desborde
--        + transferencias). Reemplaza el modelo D-6 (`beca_comedor_mes`).
-- -----------------------------------------------------------------------------
-- Sustituye el acople "beca del mismo mes" de D-6 por un modelo con DESACOPLE
-- temporal: la beca de un alumno se registra en un TRAMO con el mes al que
-- CORRESPONDE y el mes/recibo de APLICACIÓN (donde se descuenta), que pueden ser
-- distintos (p. ej. el ayuntamiento paga en enero las becas de sep+oct+nov → tres
-- tramos correspondientes a sep/oct/nov, todos con aplicación en enero).
--
-- Esta migración es SOLO el modelo (sin motor, sin UI). El motor (nuevo PASE 2-bis
-- por "recibo de aplicación" + detección de desborde) llega en B2-1; la retirada de
-- la UI/feature/tests de `beca_comedor_mes` en B2-6.
--
-- DROP de `beca_comedor_mes`: 0 filas confirmadas en producción (D-P11).
--   ⚠️ ACOPLE DE APLICACIÓN (documentado en el PR, NO se fuerza aquí):
--     · El motor VIVO `generar_recibos_mes` aún lee `beca_comedor_mes` (PASE 2-bis).
--       Aplicar ESTA migración sin B2-1 rompería la generación de recibos en runtime
--       ("relation beca_comedor_mes does not exist"). → Aplicar B2-0 + B2-1 juntas.
--     · Al regenerar tipos TS tras aplicar, la feature `src/features/beca-comedor-mes/`
--       y los tests D-6 dejarán de compilar (tipo `beca_comedor_mes` desaparece). → La
--       limpieza (B2-6) debe acompañar al apply.
--
-- Decisiones de producto construidas aquí:
--   D-P3  baja de elegibilidad NO anula tramos ya registrados (tramos independientes
--         de la elegibilidad: NO hay FK a elegibilidad; el tramo lleva nino+curso).
--   D-P6  la transferencia (devolución del exceso) es por FAMILIA.
--   D-P7  se auditan las 4 tablas (rama en `audit_trigger_function`, centro_id directo).
--   D-P8/D-P9 (mes de aplicación abierto, diferir al mes siguiente) los enforza el
--         motor/acciones (B2-1/B2-4); el modelo solo guarda anio/mes de aplicación.
--
-- Decisiones de implementación (D-I):
--   D-I1  importes en CÉNTIMOS (int), coherente con recibos/conceptos (no euros como v1).
--   D-I2  UNIQUE del tramo = parcial (nino, anio_corr, mes_corr) WHERE origen='normal':
--         impide duplicar la beca "normal" de un mismo mes correspondiente, pero permite
--         múltiples tramos `resto` en la cadena de desborde (un resto puede volver a
--         desbordar y generar otro resto del mismo mes correspondiente).
--   D-I4  "transferencia realizada en el recibo" se modela con la tabla enlazada por
--         recibo_id (no columnas nuevas en `recibos`).
--
-- RLS: admin-only del centro (es_admin) en las 4 operaciones + coherencia de centro en
-- WITH CHECK (centro_de_nino / centro_de_recibo). La familia NO accede (D-P10).
--
-- Aplicar por SQL Editor / db push (rol postgres). Regenerar database.ts DESPUÉS.
-- =============================================================================
BEGIN;

-- ── DROP del modelo v1 (0 filas confirmadas, D-P11) ──────────────────────────
DROP TABLE public.beca_comedor_mes;

-- ── ENUMs ────────────────────────────────────────────────────────────────────
CREATE TYPE public.beca_tramo_origen        AS ENUM ('normal', 'resto');
CREATE TYPE public.beca_tramo_estado        AS ENUM ('pendiente', 'aplicada', 'anulada');
CREATE TYPE public.beca_desborde_estado     AS ENUM ('pendiente', 'resuelto');
CREATE TYPE public.beca_desborde_via        AS ENUM ('reducir', 'transferencia', 'resto');
CREATE TYPE public.beca_transferencia_estado AS ENUM ('pendiente', 'realizada');

-- ── 1. ELEGIBILIDAD (quién tiene beca, por curso) ────────────────────────────
CREATE TABLE public.beca_comedor_elegibilidad (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id          uuid NOT NULL REFERENCES public.centros(id),
  nino_id            uuid NOT NULL REFERENCES public.ninos(id),
  curso_academico_id uuid NOT NULL REFERENCES public.cursos_academicos(id),
  -- true = tiene beca; false = de baja (conserva la fila para historia/auditoría).
  activa             boolean NOT NULL DEFAULT true,
  fecha_alta         date NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/Madrid')::date,
  fecha_baja         date,
  created_by         uuid REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- Una fila de elegibilidad por alumno y curso: marcar/desmarcar togglea `activa`.
  UNIQUE (nino_id, curso_academico_id),
  -- Coherencia del estado: activa ⇒ sin baja; de baja ⇒ con fecha de baja.
  CONSTRAINT beca_elegibilidad_estado_coherente
    CHECK ((activa AND fecha_baja IS NULL) OR (NOT activa AND fecha_baja IS NOT NULL))
);

COMMENT ON TABLE public.beca_comedor_elegibilidad IS
  'B2: elegibilidad de beca comedor por alumno y curso. Baja NO anula tramos ya registrados (D-P3).';

-- ── 2. TRAMO (el importe con desacople correspondiente↔aplicación) ───────────
CREATE TABLE public.beca_comedor_tramo (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id             uuid NOT NULL REFERENCES public.centros(id),
  nino_id               uuid NOT NULL REFERENCES public.ninos(id),
  curso_academico_id    uuid NOT NULL REFERENCES public.cursos_academicos(id),
  -- Mes al que CORRESPONDE la beca (para la descripción de la línea).
  anio_correspondiente  int NOT NULL CHECK (anio_correspondiente BETWEEN 2024 AND 2100),
  mes_correspondiente   int NOT NULL CHECK (mes_correspondiente BETWEEN 1 AND 12),
  -- Recibo/mes de APLICACIÓN (donde se descuenta). El DESACOPLE vive aquí.
  anio_aplicacion       int NOT NULL CHECK (anio_aplicacion BETWEEN 2024 AND 2100),
  mes_aplicacion        int NOT NULL CHECK (mes_aplicacion BETWEEN 1 AND 12),
  importe_centimos      int NOT NULL CHECK (importe_centimos > 0),
  estado                public.beca_tramo_estado NOT NULL DEFAULT 'pendiente',
  origen                public.beca_tramo_origen NOT NULL DEFAULT 'normal',
  -- Si origen='resto', el tramo que lo generó (vía 3 del desborde, B2-4).
  tramo_padre_id        uuid REFERENCES public.beca_comedor_tramo(id),
  -- Recibo donde se aplicó (se sella en el motor, B2-1).
  aplicada_en_recibo_id uuid REFERENCES public.recibos(id),
  created_by            uuid REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- D-I2: un solo tramo NORMAL por (niño, mes correspondiente); los `resto` no colisionan.
CREATE UNIQUE INDEX beca_tramo_normal_unico
  ON public.beca_comedor_tramo (nino_id, anio_correspondiente, mes_correspondiente)
  WHERE origen = 'normal';

CREATE INDEX idx_beca_tramo_aplicacion
  ON public.beca_comedor_tramo (centro_id, anio_aplicacion, mes_aplicacion)
  WHERE estado = 'pendiente';

COMMENT ON TABLE public.beca_comedor_tramo IS
  'B2: importe de beca de un alumno con DESACOPLE mes-correspondiente vs mes-aplicación.';

-- ── 3. DESBORDE (por recibo: la beca supera la cuota del recibo familiar) ────
CREATE TABLE public.beca_comedor_desborde (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id            uuid NOT NULL REFERENCES public.centros(id),
  recibo_id            uuid NOT NULL REFERENCES public.recibos(id),
  familia_id           uuid NOT NULL REFERENCES public.familias(id),
  anio                 int NOT NULL CHECK (anio BETWEEN 2024 AND 2100),
  mes                  int NOT NULL CHECK (mes BETWEEN 1 AND 12),
  -- D-P4: la comparación es contra el TOTAL del recibo FAMILIAR.
  cuota_total_centimos int NOT NULL CHECK (cuota_total_centimos >= 0),
  beca_total_centimos  int NOT NULL CHECK (beca_total_centimos >= 0),
  exceso_centimos      int NOT NULL CHECK (exceso_centimos > 0),
  estado               public.beca_desborde_estado NOT NULL DEFAULT 'pendiente',
  via                  public.beca_desborde_via,
  resuelto_por         uuid REFERENCES auth.users(id),
  resuelto_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- Un desborde por recibo (recibo = familiar).
  UNIQUE (recibo_id),
  -- Coherencia: pendiente ⇒ sin vía/resolución; resuelto ⇒ vía + sello de resolución.
  CONSTRAINT beca_desborde_resolucion_coherente
    CHECK (
      (estado = 'pendiente' AND via IS NULL AND resuelto_at IS NULL AND resuelto_por IS NULL)
      OR (estado = 'resuelto' AND via IS NOT NULL AND resuelto_at IS NOT NULL)
    )
);

COMMENT ON TABLE public.beca_comedor_desborde IS
  'B2: registro de desborde de un recibo (beca > cuota familiar). Resolución por 3 vías (B2-4).';

-- ── 4. TRANSFERENCIA (devolución del exceso a la familia — vía 2) ────────────
CREATE TABLE public.beca_comedor_transferencia (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id        uuid NOT NULL REFERENCES public.centros(id),
  recibo_id        uuid NOT NULL REFERENCES public.recibos(id),
  familia_id       uuid NOT NULL REFERENCES public.familias(id),
  anio             int NOT NULL CHECK (anio BETWEEN 2024 AND 2100),
  mes              int NOT NULL CHECK (mes BETWEEN 1 AND 12),
  importe_centimos int NOT NULL CHECK (importe_centimos > 0),
  estado           public.beca_transferencia_estado NOT NULL DEFAULT 'pendiente',
  realizada_por    uuid REFERENCES auth.users(id),
  realizada_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- Una transferencia por recibo desbordado (D-P6: por familia; recibo = familiar).
  UNIQUE (recibo_id),
  CONSTRAINT beca_transferencia_estado_coherente
    CHECK (
      (estado = 'pendiente' AND realizada_at IS NULL AND realizada_por IS NULL)
      OR (estado = 'realizada' AND realizada_at IS NOT NULL)
    )
);

COMMENT ON TABLE public.beca_comedor_transferencia IS
  'B2: devolución del exceso de beca a la familia (vía 2). Listado de a quién pagar + estado.';

-- ── updated_at (trigger estándar del repo) ───────────────────────────────────
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.beca_comedor_elegibilidad
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.beca_comedor_tramo
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.beca_comedor_desborde
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.beca_comedor_transferencia
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS: admin-only del centro + coherencia de centro ────────────────────────
ALTER TABLE public.beca_comedor_elegibilidad   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beca_comedor_tramo          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beca_comedor_desborde       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beca_comedor_transferencia  ENABLE ROW LEVEL SECURITY;

-- elegibilidad (coherencia por centro_de_nino)
CREATE POLICY beca_elegibilidad_select ON public.beca_comedor_elegibilidad
  FOR SELECT USING (public.es_admin(centro_id));
CREATE POLICY beca_elegibilidad_insert ON public.beca_comedor_elegibilidad
  FOR INSERT WITH CHECK (public.es_admin(centro_id) AND centro_id = public.centro_de_nino(nino_id));
CREATE POLICY beca_elegibilidad_update ON public.beca_comedor_elegibilidad
  FOR UPDATE USING (public.es_admin(centro_id))
  WITH CHECK (public.es_admin(centro_id) AND centro_id = public.centro_de_nino(nino_id));
CREATE POLICY beca_elegibilidad_delete ON public.beca_comedor_elegibilidad
  FOR DELETE USING (public.es_admin(centro_id));

-- tramo (coherencia por centro_de_nino)
CREATE POLICY beca_tramo_select ON public.beca_comedor_tramo
  FOR SELECT USING (public.es_admin(centro_id));
CREATE POLICY beca_tramo_insert ON public.beca_comedor_tramo
  FOR INSERT WITH CHECK (public.es_admin(centro_id) AND centro_id = public.centro_de_nino(nino_id));
CREATE POLICY beca_tramo_update ON public.beca_comedor_tramo
  FOR UPDATE USING (public.es_admin(centro_id))
  WITH CHECK (public.es_admin(centro_id) AND centro_id = public.centro_de_nino(nino_id));
CREATE POLICY beca_tramo_delete ON public.beca_comedor_tramo
  FOR DELETE USING (public.es_admin(centro_id));

-- desborde (coherencia por centro_de_recibo)
CREATE POLICY beca_desborde_select ON public.beca_comedor_desborde
  FOR SELECT USING (public.es_admin(centro_id));
CREATE POLICY beca_desborde_insert ON public.beca_comedor_desborde
  FOR INSERT WITH CHECK (public.es_admin(centro_id) AND centro_id = public.centro_de_recibo(recibo_id));
CREATE POLICY beca_desborde_update ON public.beca_comedor_desborde
  FOR UPDATE USING (public.es_admin(centro_id))
  WITH CHECK (public.es_admin(centro_id) AND centro_id = public.centro_de_recibo(recibo_id));
CREATE POLICY beca_desborde_delete ON public.beca_comedor_desborde
  FOR DELETE USING (public.es_admin(centro_id));

-- transferencia (coherencia por centro_de_recibo)
CREATE POLICY beca_transferencia_select ON public.beca_comedor_transferencia
  FOR SELECT USING (public.es_admin(centro_id));
CREATE POLICY beca_transferencia_insert ON public.beca_comedor_transferencia
  FOR INSERT WITH CHECK (public.es_admin(centro_id) AND centro_id = public.centro_de_recibo(recibo_id));
CREATE POLICY beca_transferencia_update ON public.beca_comedor_transferencia
  FOR UPDATE USING (public.es_admin(centro_id))
  WITH CHECK (public.es_admin(centro_id) AND centro_id = public.centro_de_recibo(recibo_id));
CREATE POLICY beca_transferencia_delete ON public.beca_comedor_transferencia
  FOR DELETE USING (public.es_admin(centro_id));

-- ── Auditoría (D-P7): rama nueva en audit_trigger_function + triggers ────────
-- Las 4 tablas tienen centro_id directo → se añaden a la lista IN(...) existente.
CREATE OR REPLACE FUNCTION public.audit_trigger_function()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'recibos_remesa',
    -- ── B2: beca comedor v2 (centro_id directo) ────────────────────────────
    'beca_comedor_elegibilidad',
    'beca_comedor_tramo',
    'beca_comedor_desborde',
    'beca_comedor_transferencia'
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
$function$;

CREATE TRIGGER audit_beca_comedor_elegibilidad
  AFTER INSERT OR DELETE OR UPDATE ON public.beca_comedor_elegibilidad
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_beca_comedor_tramo
  AFTER INSERT OR DELETE OR UPDATE ON public.beca_comedor_tramo
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_beca_comedor_desborde
  AFTER INSERT OR DELETE OR UPDATE ON public.beca_comedor_desborde
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_beca_comedor_transferencia
  AFTER INSERT OR DELETE OR UPDATE ON public.beca_comedor_transferencia
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

COMMIT;
