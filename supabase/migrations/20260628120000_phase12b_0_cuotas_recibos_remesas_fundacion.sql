-- =============================================================================
-- Fase 12-B-0 — "Cuotas, recibos y remesas SEPA" · Fundación (capa de datos)
-- =============================================================================
-- ADITIVA: solo CREATE TYPE / CREATE TABLE / CREATE FUNCTION+TRIGGER / CREATE POLICY
-- y CREATE OR REPLACE de audit_trigger_function (preservando TODAS las ramas previas).
-- NUNCA drop+recreate de objetos vivos. SIN UI ni acciones (eso es B-1..B-8). Sucede a
-- F11-G/H; consume el mandato SEPA (mandatos_sepa.iban_cifrado + identificador_mandato)
-- que capturó F11-G-2/G-2bis. Fuente de verdad: decisiones A–K cerradas por el
-- responsable (2026-06-28), recogidas en memoria del proyecto (project_nido_f12b_*).
--
-- DECISIONES DE MODELADO (A–K):
--  A. Código F12-B (Ola 1, post-F11). Subfases B-0..B-8, un PR por subfase.
--  B. Señal de cobro diario = tabla NUEVA parte_servicio_diario (comedor/matinera/
--     vespertina, presente bool, por niño/fecha/servicio). NO se reutiliza `comidas`
--     (es señal nutricional, con su propia ventana de edición y semántica).
--  C. Modalidad por niño/mes = asignacion_cuota(nino,concepto,anio,mes,modalidad),
--     UNIQUE(nino,concepto,anio,mes). Sin prorrateo intra-mes (1 modalidad/mes).
--  D. Cálculo en el cierre (B-4, no aquí): mensual → 1 línea precio mensual; diario →
--     nº días marcados en parte_servicio_diario × precio diario.
--  E. BECAS = línea NEGATIVA propia (no exención total, no 0 €), importe configurable;
--     restan sobre el TOTAL del recibo. tipos_beca = lista estándar por centro
--     (Conselleria, beca comedor…). El total del recibo PUEDE ser negativo (saldo a
--     favor) → se arrastra al mes siguiente como línea de apertura negativa (la genera
--     el motor de cierre en B-4). Por eso recibos.total_centimos y lineas_recibo.*
--     admiten negativos (sin CHECK de signo). Saldo al irse del centro = manual.
--  F. Cierre de mes INMUTABLE (F2): cierre_mensual sin UPDATE/DELETE (no se reabre).
--     Los errores se corrigen con recibos correctivos/esporádicos y devoluciones.
--  G. XML SEPA G1: NO se almacena en servidor. Se genera bajo demanda y se descarga
--     (regenerable). → NO hay bucket remesas-sepa ni columna xml_path. `remesas` guarda
--     estado + fecha_envio_banco, no el fichero.
--  H. metodo_pago_familia a nivel NIÑO, por niño/mes; un hermano hereda la forma del
--     otro (copia en la UI de B-2, no aquí). Solo `sepa` entra al XML; el resto genera
--     recibo en estado 'pendiente_procesar'.
--  I. Estados de recibo: pendiente_procesar | enviado_banco (con fecha_envio_banco) |
--     devuelto | cobrado_manual. Sin reconciliación automática con el banco.
--  J. Precio CONGELADO: el catálogo guarda el precio vigente; la LÍNEA del recibo
--     congela el importe aplicado (precio_unitario_centimos + importe_centimos).
--     Cambiar un precio del catálogo NO reescribe recibos pasados.
--  K. Solo el admin (directora) cierra el mes y gestiona remesas; la profe solo apunta
--     el parte diario (no ve recibos ni remesas); el IBAN nunca es legible por cliente
--     (descifrado = RPC server-side admin-only de B-5). Dependencia RGPD con F11-B
--     (retención de recibos/remesas, IBAN, RAT) registrada en follow-ups.
--
-- Gotcha MVCC (ADR-0007 + §MVCC): las policies usan es_admin(centro_id),
-- es_tutor_legal_de(nino_id), es_profe_de_nino(nino_id) y los lookups nino_de_recibo /
-- centro_de_recibo / centro_de_remesa, que leen OTRAS tablas (roles_usuario /
-- vinculos_familiares / profes_aulas / recibos / remesas), nunca la propia tabla
-- insertada → INSERT…RETURNING seguro, sin helper row-aware.
--
-- Operación sobre esquema productivo → se aplica MANUALMENTE por SQL Editor (CLI con
-- bug SIGILL). Tras aplicarla: registrar la versión en
-- supabase_migrations.schema_migrations y regenerar src/types/database.ts
-- (`npm run db:types`). Esta migración trae además los tipos a database.ts a mano para
-- que los tests gated tipen antes de aplicar (patrón aulas_curso/lista_espera de H-0).
-- =============================================================================
BEGIN;

-- ─── 1. ENUMs nuevos ─────────────────────────────────────────────────────────
CREATE TYPE public.tipo_concepto  AS ENUM ('mensual', 'diario', 'esporadico');
CREATE TYPE public.modalidad_cobro AS ENUM ('mensual', 'diario');
CREATE TYPE public.metodo_pago    AS ENUM ('sepa', 'efectivo', 'cheque_guarderia', 'transferencia');
CREATE TYPE public.servicio_diario AS ENUM ('comedor', 'matinera', 'vespertina');
CREATE TYPE public.estado_recibo  AS ENUM ('pendiente_procesar', 'enviado_banco', 'devuelto', 'cobrado_manual');
CREATE TYPE public.estado_remesa  AS ENUM ('borrador', 'enviada');

-- ─── 2. Helpers nuevos (STABLE SECURITY DEFINER) ─────────────────────────────
-- Lookups de centro/niño desde recibo/remesa, para RLS simple y triggers de
-- derivación. Leen tablas distintas a la insertada → seguros frente al gotcha MVCC.
CREATE OR REPLACE FUNCTION public.centro_de_recibo(p_recibo_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT centro_id FROM public.recibos WHERE id = p_recibo_id;
$$;

CREATE OR REPLACE FUNCTION public.nino_de_recibo(p_recibo_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT nino_id FROM public.recibos WHERE id = p_recibo_id;
$$;

CREATE OR REPLACE FUNCTION public.centro_de_remesa(p_remesa_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT centro_id FROM public.remesas WHERE id = p_remesa_id;
$$;

GRANT EXECUTE ON FUNCTION public.centro_de_recibo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nino_de_recibo(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.centro_de_remesa(uuid) TO authenticated;

-- Triggers de derivación de centro_id desde la fila padre (recibo/remesa).
-- (derivar_centro_id_de_nino() ya existe desde F11-G-0 para las tablas con nino_id.)
CREATE OR REPLACE FUNCTION public.derivar_centro_id_de_recibo()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.centro_id := public.centro_de_recibo(NEW.recibo_id);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.derivar_centro_id_de_remesa()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.centro_id := public.centro_de_remesa(NEW.remesa_id);
  RETURN NEW;
END $$;

-- ─── 3. conceptos_cobro: catálogo editable por centro (con precio vigente) ────
CREATE TABLE public.conceptos_cobro (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id       uuid NOT NULL REFERENCES public.centros(id) ON DELETE CASCADE,
  nombre          text NOT NULL,
  tipo_concepto   public.tipo_concepto NOT NULL,
  precio_centimos integer NOT NULL,
  activo          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz NULL,
  CONSTRAINT conceptos_cobro_nombre_longitud CHECK (char_length(nombre) BETWEEN 1 AND 120),
  CONSTRAINT conceptos_cobro_precio_no_negativo CHECK (precio_centimos >= 0)
);

CREATE UNIQUE INDEX idx_conceptos_cobro_centro_nombre
  ON public.conceptos_cobro (centro_id, nombre) WHERE deleted_at IS NULL;

COMMENT ON TABLE public.conceptos_cobro IS
  'F12-B: catálogo de conceptos de cobro por centro (mensual/diario/esporadico) con precio vigente. El precio se CONGELA en la línea del recibo al cerrar (decisión J); cambiarlo aquí no reescribe recibos pasados.';

CREATE TRIGGER conceptos_cobro_set_updated_at
  BEFORE UPDATE ON public.conceptos_cobro
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.conceptos_cobro ENABLE ROW LEVEL SECURITY;

CREATE POLICY conceptos_cobro_select ON public.conceptos_cobro
  FOR SELECT TO authenticated USING (public.es_admin(centro_id));
CREATE POLICY conceptos_cobro_insert ON public.conceptos_cobro
  FOR INSERT TO authenticated WITH CHECK (public.es_admin(centro_id));
CREATE POLICY conceptos_cobro_update ON public.conceptos_cobro
  FOR UPDATE TO authenticated USING (public.es_admin(centro_id)) WITH CHECK (public.es_admin(centro_id));
-- DELETE: sin policy → default DENY (baja = soft delete vía UPDATE).

-- ─── 4. tipos_beca: lista estándar de becas por centro (Conselleria, comedor…) ─
CREATE TABLE public.tipos_beca (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id  uuid NOT NULL REFERENCES public.centros(id) ON DELETE CASCADE,
  nombre     text NOT NULL,
  activo     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  CONSTRAINT tipos_beca_nombre_longitud CHECK (char_length(nombre) BETWEEN 1 AND 120)
);

CREATE UNIQUE INDEX idx_tipos_beca_centro_nombre
  ON public.tipos_beca (centro_id, nombre) WHERE deleted_at IS NULL;

COMMENT ON TABLE public.tipos_beca IS
  'F12-B (decisión E): lista estándar de tipos/orígenes de beca configurable por centro. Las becas concretas (importe + periodo por niño) viven en `becas`.';

CREATE TRIGGER tipos_beca_set_updated_at
  BEFORE UPDATE ON public.tipos_beca
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.tipos_beca ENABLE ROW LEVEL SECURITY;

CREATE POLICY tipos_beca_select ON public.tipos_beca
  FOR SELECT TO authenticated USING (public.es_admin(centro_id));
CREATE POLICY tipos_beca_insert ON public.tipos_beca
  FOR INSERT TO authenticated WITH CHECK (public.es_admin(centro_id));
CREATE POLICY tipos_beca_update ON public.tipos_beca
  FOR UPDATE TO authenticated USING (public.es_admin(centro_id)) WITH CHECK (public.es_admin(centro_id));
-- DELETE: sin policy → default DENY.

-- ─── 5. asignacion_cuota: modalidad mensual|diario por niño/concepto/mes ──────
CREATE TABLE public.asignacion_cuota (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id   uuid NOT NULL REFERENCES public.centros(id) ON DELETE CASCADE,
  nino_id     uuid NOT NULL REFERENCES public.ninos(id)   ON DELETE CASCADE,
  concepto_id uuid NOT NULL REFERENCES public.conceptos_cobro(id) ON DELETE RESTRICT,
  anio        integer NOT NULL,
  mes         integer NOT NULL,
  modalidad   public.modalidad_cobro NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asignacion_cuota_anio_valido CHECK (anio BETWEEN 2024 AND 2100),
  CONSTRAINT asignacion_cuota_mes_valido  CHECK (mes BETWEEN 1 AND 12)
);

CREATE UNIQUE INDEX idx_asignacion_cuota_unica
  ON public.asignacion_cuota (nino_id, concepto_id, anio, mes);

COMMENT ON TABLE public.asignacion_cuota IS
  'F12-B (decisión C): modalidad de cobro (mensual|diario) que la directora fija por niño, concepto y mes. Sin prorrateo intra-mes. La derivación de centro_id usa el trigger compartido derivar_centro_id_de_nino().';

CREATE TRIGGER asignacion_cuota_set_centro_id
  BEFORE INSERT ON public.asignacion_cuota
  FOR EACH ROW EXECUTE FUNCTION public.derivar_centro_id_de_nino();
CREATE TRIGGER asignacion_cuota_set_updated_at
  BEFORE UPDATE ON public.asignacion_cuota
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.asignacion_cuota ENABLE ROW LEVEL SECURITY;

CREATE POLICY asignacion_cuota_select ON public.asignacion_cuota
  FOR SELECT TO authenticated USING (public.es_admin(centro_id));
CREATE POLICY asignacion_cuota_insert ON public.asignacion_cuota
  FOR INSERT TO authenticated WITH CHECK (public.es_admin(centro_id));
CREATE POLICY asignacion_cuota_update ON public.asignacion_cuota
  FOR UPDATE TO authenticated USING (public.es_admin(centro_id)) WITH CHECK (public.es_admin(centro_id));
CREATE POLICY asignacion_cuota_delete ON public.asignacion_cuota
  FOR DELETE TO authenticated USING (public.es_admin(centro_id));

-- ─── 6. becas: beca concreta por niño (tipo + importe + periodo) ──────────────
CREATE TABLE public.becas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id       uuid NOT NULL REFERENCES public.centros(id) ON DELETE CASCADE,
  nino_id         uuid NOT NULL REFERENCES public.ninos(id)   ON DELETE CASCADE,
  tipo_beca_id    uuid NOT NULL REFERENCES public.tipos_beca(id) ON DELETE RESTRICT,
  importe_centimos integer NOT NULL,
  fecha_desde     date NOT NULL,
  fecha_hasta     date NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz NULL,
  CONSTRAINT becas_importe_positivo CHECK (importe_centimos > 0),
  CONSTRAINT becas_periodo_coherente CHECK (fecha_hasta IS NULL OR fecha_hasta >= fecha_desde)
);

CREATE INDEX idx_becas_nino ON public.becas (nino_id) WHERE deleted_at IS NULL;

COMMENT ON TABLE public.becas IS
  'F12-B (decisión E): beca concreta de un niño (tipo de tipos_beca + importe en céntimos + periodo). El importe se guarda POSITIVO (magnitud); el motor de cierre (B-4) crea una línea NEGATIVA que resta sobre el total del recibo. El total puede quedar negativo (saldo a favor).';

CREATE TRIGGER becas_set_centro_id
  BEFORE INSERT ON public.becas
  FOR EACH ROW EXECUTE FUNCTION public.derivar_centro_id_de_nino();
CREATE TRIGGER becas_set_updated_at
  BEFORE UPDATE ON public.becas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.becas ENABLE ROW LEVEL SECURITY;

CREATE POLICY becas_select ON public.becas
  FOR SELECT TO authenticated USING (public.es_admin(centro_id));
CREATE POLICY becas_insert ON public.becas
  FOR INSERT TO authenticated WITH CHECK (public.es_admin(centro_id));
CREATE POLICY becas_update ON public.becas
  FOR UPDATE TO authenticated USING (public.es_admin(centro_id)) WITH CHECK (public.es_admin(centro_id));
-- DELETE: sin policy → default DENY (baja = soft delete vía UPDATE).

-- ─── 7. metodo_pago_familia: forma de pago por niño/mes ───────────────────────
CREATE TABLE public.metodo_pago_familia (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id  uuid NOT NULL REFERENCES public.centros(id) ON DELETE CASCADE,
  nino_id    uuid NOT NULL REFERENCES public.ninos(id)   ON DELETE CASCADE,
  anio       integer NOT NULL,
  mes        integer NOT NULL,
  metodo     public.metodo_pago NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT metodo_pago_familia_anio_valido CHECK (anio BETWEEN 2024 AND 2100),
  CONSTRAINT metodo_pago_familia_mes_valido  CHECK (mes BETWEEN 1 AND 12)
);

CREATE UNIQUE INDEX idx_metodo_pago_familia_unico
  ON public.metodo_pago_familia (nino_id, anio, mes);

COMMENT ON TABLE public.metodo_pago_familia IS
  'F12-B (decisión H): forma de pago (sepa|efectivo|cheque_guarderia|transferencia) por niño y mes, ajustable. Solo `sepa` entra al XML pain.008; el resto genera recibo en pendiente_procesar. La copia entre hermanos se hace en la UI de B-2.';

CREATE TRIGGER metodo_pago_familia_set_centro_id
  BEFORE INSERT ON public.metodo_pago_familia
  FOR EACH ROW EXECUTE FUNCTION public.derivar_centro_id_de_nino();
CREATE TRIGGER metodo_pago_familia_set_updated_at
  BEFORE UPDATE ON public.metodo_pago_familia
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.metodo_pago_familia ENABLE ROW LEVEL SECURITY;

CREATE POLICY metodo_pago_familia_select ON public.metodo_pago_familia
  FOR SELECT TO authenticated USING (public.es_admin(centro_id));
CREATE POLICY metodo_pago_familia_insert ON public.metodo_pago_familia
  FOR INSERT TO authenticated WITH CHECK (public.es_admin(centro_id));
CREATE POLICY metodo_pago_familia_update ON public.metodo_pago_familia
  FOR UPDATE TO authenticated USING (public.es_admin(centro_id)) WITH CHECK (public.es_admin(centro_id));
-- DELETE: sin policy → default DENY.

-- ─── 8. parte_servicio_diario: el parte de las profes (comedor/matinera/vesp.) ─
CREATE TABLE public.parte_servicio_diario (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id  uuid NOT NULL REFERENCES public.centros(id) ON DELETE CASCADE,
  nino_id    uuid NOT NULL REFERENCES public.ninos(id)   ON DELETE CASCADE,
  fecha      date NOT NULL,
  servicio   public.servicio_diario NOT NULL,
  presente   boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_parte_servicio_diario_unico
  ON public.parte_servicio_diario (nino_id, fecha, servicio);

COMMENT ON TABLE public.parte_servicio_diario IS
  'F12-B (decisión B): parte diario que apuntan las profes — quién se queda a comedor/matinera/vespertina cada día. Genera el cobro DIARIO de quien NO tiene la modalidad mensual de ese concepto (motor de cierre B-4). Tabla propia (NO se reutiliza `comidas`, que es señal nutricional).';

CREATE TRIGGER parte_servicio_diario_set_centro_id
  BEFORE INSERT ON public.parte_servicio_diario
  FOR EACH ROW EXECUTE FUNCTION public.derivar_centro_id_de_nino();
CREATE TRIGGER parte_servicio_diario_set_updated_at
  BEFORE UPDATE ON public.parte_servicio_diario
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.parte_servicio_diario ENABLE ROW LEVEL SECURITY;

-- La profe del niño (o admin) ve y apunta el parte; el tutor NO (es control interno).
CREATE POLICY parte_servicio_diario_select ON public.parte_servicio_diario
  FOR SELECT TO authenticated
  USING (public.es_admin(centro_id) OR public.es_profe_de_nino(nino_id));
CREATE POLICY parte_servicio_diario_insert ON public.parte_servicio_diario
  FOR INSERT TO authenticated
  WITH CHECK (public.es_admin(centro_id) OR public.es_profe_de_nino(nino_id));
CREATE POLICY parte_servicio_diario_update ON public.parte_servicio_diario
  FOR UPDATE TO authenticated
  USING (public.es_admin(centro_id) OR public.es_profe_de_nino(nino_id))
  WITH CHECK (public.es_admin(centro_id) OR public.es_profe_de_nino(nino_id));
-- DELETE: sin policy → default DENY.

-- ─── 9. cierre_mensual: cierre manual e INMUTABLE del mes (decisión F) ─────────
CREATE TABLE public.cierre_mensual (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id  uuid NOT NULL REFERENCES public.centros(id)  ON DELETE CASCADE,
  anio       integer NOT NULL,
  mes        integer NOT NULL,
  cerrado_por uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  cerrado_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cierre_mensual_anio_valido CHECK (anio BETWEEN 2024 AND 2100),
  CONSTRAINT cierre_mensual_mes_valido  CHECK (mes BETWEEN 1 AND 12)
);

CREATE UNIQUE INDEX idx_cierre_mensual_unico
  ON public.cierre_mensual (centro_id, anio, mes);

COMMENT ON TABLE public.cierre_mensual IS
  'F12-B (decisión F): registro del cierre manual de un mes por la directora (genera los recibos en B-4). Su existencia = mes cerrado. INMUTABLE: sin policy de UPDATE/DELETE (no se reabre); las correcciones van por recibos correctivos/esporádicos y devoluciones.';

ALTER TABLE public.cierre_mensual ENABLE ROW LEVEL SECURITY;

CREATE POLICY cierre_mensual_select ON public.cierre_mensual
  FOR SELECT TO authenticated USING (public.es_admin(centro_id));
CREATE POLICY cierre_mensual_insert ON public.cierre_mensual
  FOR INSERT TO authenticated WITH CHECK (public.es_admin(centro_id) AND cerrado_por = auth.uid());
-- UPDATE/DELETE: sin policy → default DENY (cierre inmutable, decisión F).

-- ─── 10. recibos: recibo por niño/mes (regular, esporádico o devolución) ───────
CREATE TABLE public.recibos (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id            uuid NOT NULL REFERENCES public.centros(id) ON DELETE CASCADE,
  nino_id              uuid NOT NULL REFERENCES public.ninos(id)   ON DELETE CASCADE,
  anio                 integer NOT NULL,
  mes                  integer NOT NULL,
  metodo               public.metodo_pago NOT NULL,
  estado               public.estado_recibo NOT NULL DEFAULT 'pendiente_procesar',
  total_centimos       integer NOT NULL DEFAULT 0, -- puede ser negativo (saldo a favor)
  es_esporadico        boolean NOT NULL DEFAULT false,
  concepto_esporadico  text NULL,
  devuelto_de_recibo_id uuid NULL REFERENCES public.recibos(id) ON DELETE RESTRICT,
  fecha_envio_banco    date NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz NULL,
  CONSTRAINT recibos_anio_valido CHECK (anio BETWEEN 2024 AND 2100),
  CONSTRAINT recibos_mes_valido  CHECK (mes BETWEEN 1 AND 12),
  CONSTRAINT recibos_concepto_esporadico_longitud CHECK (
    concepto_esporadico IS NULL OR char_length(concepto_esporadico) BETWEEN 1 AND 200
  ),
  -- enviado_banco exige fecha; el resto de estados NO la llevan.
  CONSTRAINT recibos_envio_banco_fecha CHECK (
    (estado = 'enviado_banco' AND fecha_envio_banco IS NOT NULL) OR
    (estado <> 'enviado_banco' AND fecha_envio_banco IS NULL)
  )
);

-- Un único recibo REGULAR por niño/mes (los esporádicos y las devoluciones quedan fuera
-- del UNIQUE: puede haber varios en un mes, p. ej. el devuelto + el del mes — decisión).
CREATE UNIQUE INDEX idx_recibos_regular_unico
  ON public.recibos (nino_id, anio, mes)
  WHERE NOT es_esporadico AND devuelto_de_recibo_id IS NULL AND deleted_at IS NULL;

CREATE INDEX idx_recibos_centro_periodo ON public.recibos (centro_id, anio, mes);
CREATE INDEX idx_recibos_nino ON public.recibos (nino_id) WHERE deleted_at IS NULL;

COMMENT ON TABLE public.recibos IS
  'F12-B: recibo de un niño en un mes. total_centimos puede ser NEGATIVO (saldo a favor, decisión E; se arrastra al mes siguiente como línea de apertura). es_esporadico = recibo manual (uniformes, excursión…); devuelto_de_recibo_id liga la devolución a su recibo original (decisión I). estado: pendiente_procesar|enviado_banco(+fecha)|devuelto|cobrado_manual, sin reconciliación con banco.';

CREATE TRIGGER recibos_set_centro_id
  BEFORE INSERT ON public.recibos
  FOR EACH ROW EXECUTE FUNCTION public.derivar_centro_id_de_nino();
CREATE TRIGGER recibos_set_updated_at
  BEFORE UPDATE ON public.recibos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.recibos ENABLE ROW LEVEL SECURITY;

-- Admin gestiona; el tutor legal VE los recibos de su hijo (recibos pasados, decisión M
-- de producto). Profe NO.
CREATE POLICY recibos_select ON public.recibos
  FOR SELECT TO authenticated
  USING (public.es_admin(centro_id) OR public.es_tutor_legal_de(nino_id));
CREATE POLICY recibos_insert ON public.recibos
  FOR INSERT TO authenticated WITH CHECK (public.es_admin(centro_id));
CREATE POLICY recibos_update ON public.recibos
  FOR UPDATE TO authenticated USING (public.es_admin(centro_id)) WITH CHECK (public.es_admin(centro_id));
-- DELETE: sin policy → default DENY.

-- ─── 11. lineas_recibo: desglose congelado del recibo (permite negativos) ──────
CREATE TABLE public.lineas_recibo (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id               uuid NOT NULL REFERENCES public.centros(id) ON DELETE CASCADE,
  recibo_id               uuid NOT NULL REFERENCES public.recibos(id) ON DELETE CASCADE,
  concepto_id             uuid NULL REFERENCES public.conceptos_cobro(id) ON DELETE SET NULL,
  descripcion             text NOT NULL,
  cantidad                integer NOT NULL DEFAULT 1,
  precio_unitario_centimos integer NOT NULL, -- congelado; negativo en becas / saldo arrastrado
  importe_centimos        integer NOT NULL,  -- congelado; puede ser negativo
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lineas_recibo_descripcion_longitud CHECK (char_length(descripcion) BETWEEN 1 AND 200),
  CONSTRAINT lineas_recibo_cantidad_positiva CHECK (cantidad >= 1)
);

CREATE INDEX idx_lineas_recibo_recibo ON public.lineas_recibo (recibo_id);

COMMENT ON TABLE public.lineas_recibo IS
  'F12-B (decisión J): desglose del recibo con importe CONGELADO al cerrar. concepto_id NULL = línea sin concepto del catálogo (beca negativa o "saldo mes anterior"). precio_unitario_centimos e importe_centimos admiten negativos (becas restan sobre el total; saldo arrastrado). centro_id se deriva del recibo.';

CREATE TRIGGER lineas_recibo_set_centro_id
  BEFORE INSERT ON public.lineas_recibo
  FOR EACH ROW EXECUTE FUNCTION public.derivar_centro_id_de_recibo();

ALTER TABLE public.lineas_recibo ENABLE ROW LEVEL SECURITY;

-- Quien ve el recibo ve sus líneas: admin del centro o tutor legal del niño del recibo.
CREATE POLICY lineas_recibo_select ON public.lineas_recibo
  FOR SELECT TO authenticated
  USING (
    public.es_admin(centro_id)
    OR public.es_tutor_legal_de(public.nino_de_recibo(recibo_id))
  );
CREATE POLICY lineas_recibo_insert ON public.lineas_recibo
  FOR INSERT TO authenticated WITH CHECK (public.es_admin(centro_id));
CREATE POLICY lineas_recibo_update ON public.lineas_recibo
  FOR UPDATE TO authenticated USING (public.es_admin(centro_id)) WITH CHECK (public.es_admin(centro_id));
CREATE POLICY lineas_recibo_delete ON public.lineas_recibo
  FOR DELETE TO authenticated USING (public.es_admin(centro_id));

-- ─── 12. remesas: lote SEPA del mes (estado + fecha; SIN fichero, decisión G1) ─
CREATE TABLE public.remesas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id         uuid NOT NULL REFERENCES public.centros(id) ON DELETE CASCADE,
  anio              integer NOT NULL,
  mes               integer NOT NULL,
  estado            public.estado_remesa NOT NULL DEFAULT 'borrador',
  fecha_envio_banco date NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz NULL,
  CONSTRAINT remesas_anio_valido CHECK (anio BETWEEN 2024 AND 2100),
  CONSTRAINT remesas_mes_valido  CHECK (mes BETWEEN 1 AND 12),
  CONSTRAINT remesas_envio_estado CHECK (
    (estado = 'enviada' AND fecha_envio_banco IS NOT NULL) OR
    (estado = 'borrador' AND fecha_envio_banco IS NULL)
  )
);

CREATE UNIQUE INDEX idx_remesas_centro_periodo
  ON public.remesas (centro_id, anio, mes) WHERE deleted_at IS NULL;

COMMENT ON TABLE public.remesas IS
  'F12-B (decisión G1): lote de domiciliaciones SEPA de un mes. NO almacena el XML pain.008 (se genera bajo demanda y se descarga, regenerable). Guarda estado (borrador|enviada) + fecha_envio_banco. Sin reconciliación con banco.';

CREATE TRIGGER remesas_set_updated_at
  BEFORE UPDATE ON public.remesas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.remesas ENABLE ROW LEVEL SECURITY;

CREATE POLICY remesas_select ON public.remesas
  FOR SELECT TO authenticated USING (public.es_admin(centro_id));
CREATE POLICY remesas_insert ON public.remesas
  FOR INSERT TO authenticated WITH CHECK (public.es_admin(centro_id));
CREATE POLICY remesas_update ON public.remesas
  FOR UPDATE TO authenticated USING (public.es_admin(centro_id)) WITH CHECK (public.es_admin(centro_id));
-- DELETE: sin policy → default DENY (baja = soft delete vía UPDATE).

-- ─── 13. recibos_remesa: qué recibos SEPA entraron en una remesa ──────────────
CREATE TABLE public.recibos_remesa (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id  uuid NOT NULL REFERENCES public.centros(id)  ON DELETE CASCADE,
  remesa_id  uuid NOT NULL REFERENCES public.remesas(id)  ON DELETE CASCADE,
  recibo_id  uuid NOT NULL REFERENCES public.recibos(id)  ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_recibos_remesa_unico
  ON public.recibos_remesa (remesa_id, recibo_id);
CREATE INDEX idx_recibos_remesa_recibo ON public.recibos_remesa (recibo_id);

COMMENT ON TABLE public.recibos_remesa IS
  'F12-B: relación remesa↔recibo (qué recibos de método sepa entraron en el lote). centro_id se deriva de la remesa. Admin-only.';

CREATE TRIGGER recibos_remesa_set_centro_id
  BEFORE INSERT ON public.recibos_remesa
  FOR EACH ROW EXECUTE FUNCTION public.derivar_centro_id_de_remesa();

ALTER TABLE public.recibos_remesa ENABLE ROW LEVEL SECURITY;

CREATE POLICY recibos_remesa_select ON public.recibos_remesa
  FOR SELECT TO authenticated USING (public.es_admin(centro_id));
CREATE POLICY recibos_remesa_insert ON public.recibos_remesa
  FOR INSERT TO authenticated WITH CHECK (public.es_admin(centro_id));
CREATE POLICY recibos_remesa_delete ON public.recibos_remesa
  FOR DELETE TO authenticated USING (public.es_admin(centro_id));
-- UPDATE: sin policy → default DENY (relación inmutable; se borra y recrea).

-- ─── 14. audit_trigger_function ampliada (+ 11 ramas) + triggers ──────────────
-- CREATE OR REPLACE preserva TODAS las ramas previas (Fases 2..11-H). Las 11 tablas
-- nuevas llevan centro_id poblado (directo o derivado por trigger BEFORE INSERT, que
-- corre antes del AFTER de audit) → rama uniforme COALESCE((NEW).centro_id,(OLD).centro_id).
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
    'conceptos_cobro',
    'tipos_beca',
    'asignacion_cuota',
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

CREATE TRIGGER audit_conceptos_cobro
  AFTER INSERT OR UPDATE OR DELETE ON public.conceptos_cobro
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_tipos_beca
  AFTER INSERT OR UPDATE OR DELETE ON public.tipos_beca
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_asignacion_cuota
  AFTER INSERT OR UPDATE OR DELETE ON public.asignacion_cuota
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_becas
  AFTER INSERT OR UPDATE OR DELETE ON public.becas
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_metodo_pago_familia
  AFTER INSERT OR UPDATE OR DELETE ON public.metodo_pago_familia
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_parte_servicio_diario
  AFTER INSERT OR UPDATE OR DELETE ON public.parte_servicio_diario
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_cierre_mensual
  AFTER INSERT OR UPDATE OR DELETE ON public.cierre_mensual
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_recibos
  AFTER INSERT OR UPDATE OR DELETE ON public.recibos
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_lineas_recibo
  AFTER INSERT OR UPDATE OR DELETE ON public.lineas_recibo
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_remesas
  AFTER INSERT OR UPDATE OR DELETE ON public.remesas
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_recibos_remesa
  AFTER INSERT OR UPDATE OR DELETE ON public.recibos_remesa
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

COMMIT;
