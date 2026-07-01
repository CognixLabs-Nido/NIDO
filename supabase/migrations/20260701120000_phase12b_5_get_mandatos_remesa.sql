-- =============================================================================
-- F12-B-5 — Remesa SEPA: RPC de descifrado + datos del acreedor (IBAN cifrado)
-- =============================================================================
-- Cierra el único camino de DESCIFRADO del IBAN (deudores y acreedor) para
-- generar el fichero pain.008.001.02. Espejo del cifrado médico/mandato SEPA
-- (ADR-0004, F11-G-2bis): en reposo cifrado, descifrado SOLO server-side por
-- dirección; nunca sale al cliente.
--
-- Contenido (decisiones confirmadas por el responsable, OPCIÓN A):
--  1) centros gana la config del ACREEDOR:
--       - identificador_acreedor (CID) text, EN CLARO (no es una cuenta).
--       - bic_acreedor text, EN CLARO (NOTPROVIDED si vacío en el XML).
--       - iban_acreedor_cifrado bytea, CIFRADO (mismo trato que
--         mandatos_sepa.iban_cifrado: un IBAN es dato sensible, decisión G-2bis).
--  2) get_mandatos_remesa(p_remesa_id): descifra el IBAN de los DEUDORES de esa
--     remesa (firma ACOTADA por remesa, no batch genérico). Deriva el centro con
--     centro_de_remesa y autoriza es_admin. Enlace recibo→mandato por nino_id;
--     mandato activo más reciente por fecha_firma (determinista); LEFT JOIN →
--     recibo sin mandato sale con campos de mandato en NULL (no se cae en
--     silencio; el generador lo señala y rechaza). Devuelve además fecha_mandato
--     (DtOfSgntr = COALESCE(fecha_firma, created_at)).
--  3) set_datos_acreedor(...): RPC admin-only de ESCRITURA. Fija CID/BIC y, si
--     llega un IBAN no vacío, lo CIFRA (NULL/'' = preservar el existente, patrón
--     del setter médico ADR-0004). El IBAN nunca es legible por cliente después.
--  4) get_datos_acreedor(p_centro_id): RPC admin-only de LECTURA para el GENERADOR
--     (descifra el IBAN del acreedor). El formulario NO usa esta RPC: lee CID/BIC
--     en claro y un booleano "IBAN configurado" (sin revelar el número).
--
-- Matices aprobados: recibo con total<=0 se excluye del adeudo (lo hace el
-- generador, no la RPC); secuencia RCUR por defecto (FRST/primera-vez DIFERIDA a
-- follow-up post-B-5: requiere marca por mandato).
--
-- Orden de dependencias (verificado): _get_sepa_key(), centro_de_remesa(uuid),
-- es_admin(uuid) y las tablas recibos/recibos_remesa/mandatos_sepa YA existen
-- (B-0..B-4 + F11-G-2bis). Dentro de la migración: primero el ALTER de centros,
-- luego las RPCs que lo referencian. pgp_sym_(en|de)crypt en `extensions`.
--
-- ⚠️ PRERREQUISITO DE OPERADOR: el secreto 'sepa_encryption_key' debe existir en
--    Vault (lo creó F11-G-2bis). La validación PERFORM del final revierte si no.
-- Tras aplicar: src/types/database.ts se tipa A MANO (patrón H-0).
-- =============================================================================
BEGIN;

-- ─── 1. Config del acreedor en centros (CID/BIC en claro, IBAN cifrado) ───────
ALTER TABLE public.centros
  ADD COLUMN IF NOT EXISTS identificador_acreedor text,
  ADD COLUMN IF NOT EXISTS bic_acreedor           text,
  ADD COLUMN IF NOT EXISTS iban_acreedor_cifrado   bytea;

ALTER TABLE public.centros
  DROP CONSTRAINT IF EXISTS centros_acreedor_longitudes;
ALTER TABLE public.centros
  ADD CONSTRAINT centros_acreedor_longitudes CHECK (
    (identificador_acreedor IS NULL OR char_length(identificador_acreedor) BETWEEN 8 AND 35) AND
    (bic_acreedor IS NULL OR char_length(bic_acreedor) BETWEEN 8 AND 11)
  );

-- ─── 2. get_mandatos_remesa: descifrado de los DEUDORES de una remesa ─────────
CREATE OR REPLACE FUNCTION public.get_mandatos_remesa(p_remesa_id uuid)
RETURNS TABLE (
  recibo_id             uuid,
  nino_id               uuid,
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
    r.nino_id,
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
  -- Mandato activo más reciente del niño (determinista). LEFT JOIN: si no hay,
  -- la fila sale con los campos de mandato en NULL (el generador la señala).
  LEFT JOIN LATERAL (
    SELECT
      ms.identificador_mandato,
      ms.iban_cifrado,
      ms.titular,
      COALESCE(ms.fecha_firma, ms.created_at)::date AS fecha_mandato
    FROM public.mandatos_sepa ms
    WHERE ms.nino_id = r.nino_id
      AND ms.estado = 'activo'
      AND ms.deleted_at IS NULL
    ORDER BY ms.fecha_firma DESC NULLS LAST, ms.created_at DESC, ms.id DESC
    LIMIT 1
  ) m ON true
  WHERE rr.remesa_id = p_remesa_id
    AND r.metodo = 'sepa'
    AND r.deleted_at IS NULL
  ORDER BY r.nino_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_mandatos_remesa(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mandatos_remesa(uuid) TO authenticated;

-- ─── 3. set_datos_acreedor: escritura admin-only (cifra el IBAN) ──────────────
CREATE OR REPLACE FUNCTION public.set_datos_acreedor(
  p_centro_id             uuid,
  p_identificador_acreedor text,
  p_bic_acreedor          text,
  p_iban                  text  -- NULL o '' = preservar el IBAN cifrado existente
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_clave text;
  v_iban  text := btrim(coalesce(p_iban, ''));
BEGIN
  IF NOT public.es_admin(p_centro_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  UPDATE public.centros SET
    identificador_acreedor = nullif(btrim(coalesce(p_identificador_acreedor, '')), ''),
    bic_acreedor           = nullif(btrim(coalesce(p_bic_acreedor, '')), '')
  WHERE id = p_centro_id;

  IF v_iban <> '' THEN
    IF char_length(v_iban) < 15 OR char_length(v_iban) > 34 THEN
      RAISE EXCEPTION 'IBAN inválido';
    END IF;
    v_clave := public._get_sepa_key();
    UPDATE public.centros
      SET iban_acreedor_cifrado = pgp_sym_encrypt(v_iban, v_clave)
      WHERE id = p_centro_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_datos_acreedor(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_datos_acreedor(uuid, text, text, text) TO authenticated;

-- ─── 4. get_datos_acreedor: lectura admin-only para el GENERADOR (descifra) ───
CREATE OR REPLACE FUNCTION public.get_datos_acreedor(p_centro_id uuid)
RETURNS TABLE (
  identificador_acreedor text,
  bic_acreedor           text,
  iban                   text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_clave text;
BEGIN
  IF NOT public.es_admin(p_centro_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  v_clave := public._get_sepa_key();

  RETURN QUERY
  SELECT
    c.identificador_acreedor,
    c.bic_acreedor,
    CASE
      WHEN c.iban_acreedor_cifrado IS NULL THEN NULL
      ELSE pgp_sym_decrypt(c.iban_acreedor_cifrado, v_clave)
    END
  FROM public.centros c
  WHERE c.id = p_centro_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_datos_acreedor(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_datos_acreedor(uuid) TO authenticated;

-- ─── 5. Congelado afinado: el ciclo de COBRO puede avanzar tras cerrar ────────
-- CREATE OR REPLACE (migración nueva; nunca se edita la aplicada). Redefine el
-- trigger de B-4 con una única excepción: en `recibos` REGULARES de un mes
-- cerrado, un UPDATE que SOLO cambie estado y/o fecha_envio_banco está PERMITIDO
-- (ciclo de cobro pendiente_procesar → enviado_banco → cobrado_manual/devuelto,
-- que usa B-5 al enviar la remesa y usará B-6 en devoluciones). Cualquier UPDATE
-- que toque contenido ECONÓMICO o de IDENTIDAD (total_centimos, metodo, nino_id,
-- anio, mes, es_esporadico, concepto_esporadico, devuelto_de_recibo_id), y todo
-- INSERT/DELETE, siguen bloqueados con P0001. El parte_servicio_diario y
-- lineas_recibo de mes cerrado quedan igual de inmutables. En resumen: la
-- inmutabilidad es del CONTENIDO ECONÓMICO y del CIERRE, NO del estado de cobro,
-- que evoluciona por diseño (el ENUM estado_recibo ya prevé los estados
-- post-cierre). Las ramas de parte y líneas son idénticas a B-4.
CREATE OR REPLACE FUNCTION public.congelar_si_mes_cerrado()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_centro uuid;
  v_anio integer;
  v_mes integer;
  r_recibo record;
BEGIN
  IF TG_TABLE_NAME = 'parte_servicio_diario' THEN
    v_centro := public.centro_de_nino(COALESCE(NEW.nino_id, OLD.nino_id));
    v_anio := EXTRACT(YEAR  FROM COALESCE(NEW.fecha, OLD.fecha))::integer;
    v_mes  := EXTRACT(MONTH FROM COALESCE(NEW.fecha, OLD.fecha))::integer;
    IF public.mes_cerrado(v_centro, v_anio, v_mes) THEN
      RAISE EXCEPTION 'mes cerrado: el parte de servicio de % no es editable',
        to_char(COALESCE(NEW.fecha, OLD.fecha), 'YYYY-MM') USING ERRCODE = 'P0001';
    END IF;

  ELSIF TG_TABLE_NAME = 'recibos' THEN
    -- Solo recibos REGULARES (no esporádicos, no devoluciones).
    IF COALESCE(NEW.es_esporadico, OLD.es_esporadico) = false
       AND COALESCE(NEW.devuelto_de_recibo_id, OLD.devuelto_de_recibo_id) IS NULL THEN
      v_centro := public.centro_de_nino(COALESCE(NEW.nino_id, OLD.nino_id));
      v_anio := COALESCE(NEW.anio, OLD.anio);
      v_mes  := COALESCE(NEW.mes, OLD.mes);
      IF public.mes_cerrado(v_centro, v_anio, v_mes) THEN
        IF TG_OP <> 'UPDATE' THEN
          -- INSERT y DELETE de un recibo regular de mes cerrado: bloqueados.
          RAISE EXCEPTION 'mes cerrado: el recibo regular de % no es editable',
            to_char(make_date(v_anio, v_mes, 1), 'YYYY-MM') USING ERRCODE = 'P0001';
        ELSIF NOT (
              NEW.total_centimos        IS NOT DISTINCT FROM OLD.total_centimos
          AND NEW.metodo                IS NOT DISTINCT FROM OLD.metodo
          AND NEW.nino_id               IS NOT DISTINCT FROM OLD.nino_id
          AND NEW.anio                  IS NOT DISTINCT FROM OLD.anio
          AND NEW.mes                   IS NOT DISTINCT FROM OLD.mes
          AND NEW.es_esporadico         IS NOT DISTINCT FROM OLD.es_esporadico
          AND NEW.concepto_esporadico   IS NOT DISTINCT FROM OLD.concepto_esporadico
          AND NEW.devuelto_de_recibo_id IS NOT DISTINCT FROM OLD.devuelto_de_recibo_id
        ) THEN
          -- UPDATE que toca contenido económico/identidad: bloqueado (F/J).
          RAISE EXCEPTION 'mes cerrado: el recibo regular de % es inmutable salvo estado/fecha de cobro',
            to_char(make_date(v_anio, v_mes, 1), 'YYYY-MM') USING ERRCODE = 'P0001';
        END IF;
        -- else: UPDATE que solo cambia estado/fecha_envio_banco → permitido.
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'lineas_recibo' THEN
    SELECT centro_id, anio, mes, es_esporadico, devuelto_de_recibo_id
      INTO r_recibo
      FROM public.recibos WHERE id = COALESCE(NEW.recibo_id, OLD.recibo_id);
    IF FOUND AND r_recibo.es_esporadico = false AND r_recibo.devuelto_de_recibo_id IS NULL THEN
      IF public.mes_cerrado(r_recibo.centro_id, r_recibo.anio, r_recibo.mes) THEN
        RAISE EXCEPTION 'mes cerrado: las líneas del recibo regular de % no son editables',
          to_char(make_date(r_recibo.anio, r_recibo.mes, 1), 'YYYY-MM') USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;

-- Validación: la clave de Vault debe existir (si no, revierte toda la migración).
DO $$ BEGIN PERFORM public._get_sepa_key(); END $$;

COMMIT;
