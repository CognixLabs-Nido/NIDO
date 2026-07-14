-- =============================================================================
-- F-4-1 · Esquema de recibos a grano FAMILIA (base de la facturación familiar)
-- =============================================================================
-- El recibo pasa de grano NIÑO a grano FAMILIA: un recibo REGULAR por familia y mes
-- (con líneas de todos los hijos). Esto es SOLO el esquema base; el motor, la asignación
-- y el panel llegan en fases posteriores.
--
-- ⚠️ APLICACIÓN POR SQL EDITOR (Jose) — ORDEN OBLIGATORIO:
--   `ALTER TYPE ... ADD VALUE` NO puede ejecutarse dentro de la misma transacción en la
--   que el valor nuevo se referencia. Por eso los DOS `ADD VALUE` van PRIMERO y FUERA del
--   bloque `BEGIN/COMMIT`. En F-4-1 no se referencian los valores nuevos ('borrador',
--   'cheque_guarderia') en ningún DDL (los usará el motor en F-4-3), así que este orden es
--   suficiente. Ejecuta el bloque de `ALTER TYPE` primero; luego el `BEGIN … COMMIT`.
--
-- DECISIONES (cerradas en el diseño F-4-1):
--   · recibos.familia_id → NOT NULL (clave del recibo); nino_id → NULLABLE informativo.
--     Los ESPORÁDICOS también llevan familia_id NOT NULL (nino_id opcional si el cargo es
--     de un hijo concreto). Devoluciones heredan la familia del original.
--   · Índice único regular por (familia_id, anio, mes) — reemplaza el de niño.
--   · lineas_recibo.nino_id NULLABLE (NULL = línea familiar: descuento hermanos / saldo /
--     beca familiar; NOT NULL = línea de un hijo concreto, p. ej. "Cuota · Lucía").
--   · Estados: se AÑADE 'borrador' a estado_recibo (Opción A). El motor (F-4-3) creará los
--     regulares en 'borrador'; confirmar = UPDATE estado 'borrador'→'pendiente_procesar'
--     ("confirmado" = estado <> 'borrador'; solo esos son remesables). El DEFAULT de la
--     tabla SIGUE siendo 'pendiente_procesar' → esporádicos/devoluciones nacen confirmados.
--   · metodo_pago: se repone 'cheque_guarderia' (lo quitó B-4; decisión de producto revierte
--     a método de pago).
--   · centro_id de recibos se deriva de familia_id (nino_id ya puede ser NULL).
--   · RLS: el tutor ve recibos/líneas de su FAMILIA (es_tutor_de_familia), no por nino_id.
--
-- SE DIFIERE (NO entra en F-4-1):
--   · Motor `cerrar_mes_cobros` y `crear_recibo_esporadico` → F-4-3 (grano familia).
--   · Trigger de congelado de B-5 (deriva centro por nino_id; hay que re-derivar por familia
--     + permitir la transición de confirmación) → F-4-3.
--   · El acoplamiento "recibo regular ⇒ nino_id NULL" y su CHECK asociado → F-4-3.
--   · `get_mandatos_remesa` / selección de remesables (enlazan por nino_id) → fase remesa.
--   · Listas/detalle/pivote de la UI → F-4-4.
--
-- ⚠️ CONSECUENCIA ACEPTADA (0 datos reales, pre-piloto): tras F-4-1 el CIERRE DE MES queda
--    temporalmente inoperativo (el motor grano-niño es incompatible con familia_id NOT NULL
--    y el nuevo índice único) hasta que F-4-3 reescriba el motor. Es lo esperado.
-- =============================================================================

-- ── FUERA DE TRANSACCIÓN: valores de ENUM nuevos (no se referencian en F-4-1) ──
ALTER TYPE public.estado_recibo ADD VALUE IF NOT EXISTS 'borrador' BEFORE 'pendiente_procesar';
ALTER TYPE public.metodo_pago  ADD VALUE IF NOT EXISTS 'cheque_guarderia';

-- ── RESTO DEL ESQUEMA (transaccional) ────────────────────────────────────────
BEGIN;

-- 1. recibos → grano familia -------------------------------------------------
-- Backfill defensivo antes de NOT NULL (0 datos reales; por si hubiera fixtures).
UPDATE public.recibos
  SET familia_id = public.familia_de_nino(nino_id)
  WHERE familia_id IS NULL AND nino_id IS NOT NULL;

ALTER TABLE public.recibos ALTER COLUMN familia_id SET NOT NULL;
ALTER TABLE public.recibos ALTER COLUMN nino_id   DROP NOT NULL;

-- 2. Índice único regular por familia (reemplaza el de niño) ------------------
DROP INDEX IF EXISTS public.idx_recibos_regular_unico;
CREATE UNIQUE INDEX idx_recibos_regular_familia_unico
  ON public.recibos (familia_id, anio, mes)
  WHERE NOT es_esporadico AND devuelto_de_recibo_id IS NULL AND deleted_at IS NULL;

-- 3. lineas_recibo.nino_id (a qué hijo pertenece la línea; NULL = línea familiar) --
ALTER TABLE public.lineas_recibo
  ADD COLUMN nino_id uuid NULL REFERENCES public.ninos(id) ON DELETE SET NULL;
CREATE INDEX idx_lineas_recibo_nino
  ON public.lineas_recibo (nino_id) WHERE nino_id IS NOT NULL;

-- 4. centro_id de recibos derivado de familia_id (nino_id ya puede ser NULL) ---
CREATE OR REPLACE FUNCTION public.derivar_centro_id_de_recibo_familia()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.centro_id IS NULL THEN
    NEW.centro_id := COALESCE(
      public.centro_de_familia(NEW.familia_id),
      public.centro_de_nino(NEW.nino_id)
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS recibos_set_centro_id ON public.recibos;
CREATE TRIGGER recibos_set_centro_id
  BEFORE INSERT ON public.recibos
  FOR EACH ROW EXECUTE FUNCTION public.derivar_centro_id_de_recibo_familia();

-- 5. RLS por familia ---------------------------------------------------------
-- recibos: el tutor ve los recibos de SU familia (nino_id ya no sirve de gate).
DROP POLICY recibos_select ON public.recibos;
CREATE POLICY recibos_select ON public.recibos
  FOR SELECT TO authenticated
  USING (public.es_admin(centro_id) OR public.es_tutor_de_familia(familia_id));
-- INSERT/UPDATE siguen admin-only (sin cambio); DELETE sigue sin policy (DENY).

-- lineas_recibo: derivar la familia del recibo padre. El helper lee `recibos` (tabla
-- DISTINTA de `lineas_recibo`, ya commiteada) → sin gotcha MVCC en INSERT…RETURNING.
CREATE OR REPLACE FUNCTION public.familia_de_recibo(p_recibo_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT familia_id FROM public.recibos WHERE id = p_recibo_id;
$$;
GRANT EXECUTE ON FUNCTION public.familia_de_recibo(uuid) TO authenticated, service_role;

DROP POLICY lineas_recibo_select ON public.lineas_recibo;
CREATE POLICY lineas_recibo_select ON public.lineas_recibo
  FOR SELECT TO authenticated
  USING (
    public.es_admin(centro_id)
    OR public.es_tutor_de_familia(public.familia_de_recibo(recibo_id))
  );
-- INSERT/UPDATE/DELETE de lineas_recibo siguen admin-only (sin cambio).

COMMIT;
