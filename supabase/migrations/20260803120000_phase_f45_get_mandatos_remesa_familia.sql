-- =============================================================================
-- F-4-5 · Remesa a grano FAMILIA — get_mandatos_remesa
--
-- CONTEXTO: tras F-4-1 (#220) los recibos REGULARES pasan a grano familia
-- (familia_id NOT NULL, nino_id NULL). La versión F-2c1 (#216) de esta RPC
-- resolvía el mandato POR FAMILIA pero PUENTEABA por `JOIN ninos n ON n.id =
-- r.nino_id` → con nino_id NULL el JOIN no casa y los recibos familiares se
-- caían: el fichero pain.008 salía vacío. Aquí se elimina el puente y se
-- resuelve el mandato con `r.familia_id` directo.
--
-- CAMBIOS (solo lo dicho; NO se toca el descifrado del IBAN ni el gate admin):
--   1. Deudor por familia directa: LEFT JOIN LATERAL ... WHERE ms.familia_id =
--      r.familia_id (antes n.familia_id vía JOIN ninos).
--   2. RETURNS TABLE: se quita `nino_id` (NULL e inútil en familiares) y se
--      añaden `familia_id` + `familia_etiqueta` (para listar las FAMILIAS sin
--      mandato en la UI).  → cambia el tipo de retorno ⇒ DROP + CREATE.
--   3. Gate defensivo `r.estado IN ('pendiente_procesar','enviado_banco')`.
--   4. ORDER BY r.familia_id.
--
-- ⚠️ POR QUÉ `IN (...)` EN LA RPC Y `= 'pendiente_procesar'` EN LA SELECCIÓN:
--   · La SELECCIÓN de remesables (getRecibosSepaRemesables) usa el corte ESTRICTO
--     `= 'pendiente_procesar'`: solo se remesan los CONFIRMADOS aún NO enviados.
--   · Esta RPC es la RED DE SEGURIDAD sobre un enlace recibos_remesa YA creado, no
--     un filtro de remesables. Debe aceptar también `enviado_banco` porque el XML
--     es REGENERABLE bajo demanda (G1): al marcar la remesa enviada, sus recibos
--     pasan a `enviado_banco`; con un gate estricto la re-descarga daría "remesa
--     vacía" (regresión). El `IN` bloquea `borrador`/`devuelto`/`cobrado_manual`
--     (lo que el cinturón-y-tirantes quiere impedir) y preserva la re-descarga.
--     NO cambiar a `=` aquí.
--
-- Aplicar por SQL Editor. Idempotente (solo redefine la función).
-- =============================================================================
BEGIN;

-- El tipo de retorno cambia (se quita nino_id, se añaden familia_id/etiqueta):
-- CREATE OR REPLACE no permite cambiar el RETURNS, así que se dropea primero.
DROP FUNCTION IF EXISTS public.get_mandatos_remesa(uuid);

CREATE FUNCTION public.get_mandatos_remesa(p_remesa_id uuid)
RETURNS TABLE (
  recibo_id             uuid,
  familia_id            uuid,
  familia_etiqueta      text,
  total_centimos        integer,
  identificador_mandato text,
  iban                  text,
  titular               text,
  fecha_mandato         date
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_clave  text := public._get_sepa_key();
  v_centro uuid := public.centro_de_remesa(p_remesa_id);
BEGIN
  IF v_centro IS NULL THEN
    RAISE EXCEPTION 'Remesa no encontrada';
  END IF;
  IF NOT public.es_admin(v_centro) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.familia_id,
    f.etiqueta,
    r.total_centimos,
    m.identificador_mandato,
    CASE
      WHEN m.iban_cifrado IS NULL THEN NULL
      ELSE pgp_sym_decrypt(m.iban_cifrado, v_clave)
    END,
    m.titular,
    m.fecha_mandato
  FROM public.recibos_remesa rr
  JOIN public.recibos r ON r.id = rr.recibo_id
  -- F-4-5: familia del recibo DIRECTA (antes se puenteaba por ninos; roto con nino_id NULL).
  JOIN public.familias f ON f.id = r.familia_id
  -- Mandato ACTIVO más reciente de la FAMILIA (determinista). LEFT JOIN: si no hay,
  -- la fila sale con los campos de mandato en NULL (el generador la señala y rechaza).
  LEFT JOIN LATERAL (
    SELECT
      ms.identificador_mandato,
      ms.iban_cifrado,
      ms.titular,
      COALESCE(ms.fecha_firma, ms.created_at)::date AS fecha_mandato
    FROM public.mandatos_sepa ms
    WHERE ms.familia_id = r.familia_id
      AND ms.estado = 'activo'
      AND ms.deleted_at IS NULL
    ORDER BY ms.fecha_firma DESC NULLS LAST, ms.created_at DESC, ms.id DESC
    LIMIT 1
  ) m ON true
  WHERE rr.remesa_id = p_remesa_id
    AND r.metodo = 'sepa'
    -- Gate defensivo (ver cabecera): red contra borradores/estados no cobrables en un
    -- enlace ya creado. Incluye enviado_banco para permitir la RE-DESCARGA (G1).
    AND r.estado IN ('pendiente_procesar', 'enviado_banco')
    AND r.deleted_at IS NULL
  ORDER BY r.familia_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_mandatos_remesa(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mandatos_remesa(uuid) TO authenticated;

COMMIT;
