-- =============================================================================
-- Fase 11-F2 (Flag-2) — Borrado de info médica voluntaria por el tutor legal.
--
-- Cierra el modelo de F11-F: la info médica pasó a VOLUNTARIA y el tutor puede
-- COMPARTIRLA (set_info_medica_emergencia_cifrada_tutor), pero el contrato de esa
-- RPC es "NULL = preservar" (COALESCE), así que NO puede vaciar campos ni borrar
-- la fila. Este RPC añade el borrado real (derecho a retirar el dato compartido).
--
-- Gate: SOLO es_tutor_legal_de (excluye 'autorizado'); NO admin — es dato
-- voluntario de la familia, la dirección no lo borra (eso va por retención/olvido).
-- Borra la fila ENTERA = erasure real; el trigger de audit captura el DELETE.
-- Idempotente: 0 filas borradas = no-op sin error.
--
-- Migración NO destructiva (CREATE FUNCTION + GRANT). No toca esquema ni datos.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.borrar_info_medica_nino_tutor(p_nino_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Gate: tutor LEGAL del niño (principal/secundario; excluye 'autorizado').
  -- Sin gate de admin: es dato voluntario de la familia.
  IF NOT public.es_tutor_legal_de(p_nino_id) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Borra la fila entera = retirada real del dato compartido. Idempotente:
  -- si no hay fila, DELETE afecta 0 filas y no lanza error.
  DELETE FROM public.info_medica_emergencia
   WHERE nino_id = p_nino_id;
END $function$;

GRANT EXECUTE ON FUNCTION public.borrar_info_medica_nino_tutor(uuid) TO authenticated;

COMMIT;
