-- =============================================================================
-- F12-B-6 — Devoluciones SEPA: conservar fecha_envio_banco + fecha_devolucion
-- =============================================================================
-- Ajuste de esquema anotado en B-0 (decisión I): el estado 'devuelto' debe
-- CONSERVAR fecha_envio_banco. Las R-transactions SEPA (devoluciones) referencian
-- el ENVÍO original, así que la fecha de envío no se pierde al marcar devuelto; se
-- añade fecha_devolucion para la fecha de la devolución.
--
-- CHECK reescrito recibos_envio_banco_fecha:
--   - enviado_banco → fecha_envio_banco NOT NULL, fecha_devolucion NULL.
--   - devuelto      → fecha_envio_banco NOT NULL (conservada), fecha_devolucion NOT NULL.
--   - resto (pendiente_procesar, cobrado_manual) → ambas NULL.
--
-- Sin RPC nueva: los gastos de devolución reusan crear_recibo_esporadico (B-4); el
-- marcado devuelto/cobrado_manual y el re-giro son operaciones de app (admin RLS).
-- El congelado afinado de B-5 ya encaja: marcar devuelto cambia solo estado +
-- fechas (no el contenido económico), y el re-giro es un recibo nuevo con
-- devuelto_de_recibo_id NOT NULL (exento del congelado y del índice regular único).
--
-- Orden de dependencias (verificado): ADD COLUMN fecha_devolucion ANTES de que el
-- nuevo CHECK la referencie. Migración aditiva; no toca datos (piloto sin arrancar).
-- Tras aplicar: src/types/database.ts se tipa A MANO (patrón H-0).
-- =============================================================================
BEGIN;

-- 1. Fecha de la devolución (R-transaction). NULL salvo estado 'devuelto'.
ALTER TABLE public.recibos
  ADD COLUMN IF NOT EXISTS fecha_devolucion date;

-- 2. CHECK reescrito: 'devuelto' conserva el envío + exige fecha_devolucion.
ALTER TABLE public.recibos
  DROP CONSTRAINT IF EXISTS recibos_envio_banco_fecha;
ALTER TABLE public.recibos
  ADD CONSTRAINT recibos_envio_banco_fecha CHECK (
    (estado = 'enviado_banco' AND fecha_envio_banco IS NOT NULL AND fecha_devolucion IS NULL) OR
    (estado = 'devuelto'      AND fecha_envio_banco IS NOT NULL AND fecha_devolucion IS NOT NULL) OR
    (estado NOT IN ('enviado_banco', 'devuelto') AND fecha_envio_banco IS NULL AND fecha_devolucion IS NULL)
  );

COMMIT;
