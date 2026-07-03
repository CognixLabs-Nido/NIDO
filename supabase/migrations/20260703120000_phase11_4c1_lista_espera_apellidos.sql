-- Fase 11 — Alta tutor-driven, PR-4c-1: separar nombre y apellidos del prospecto EN ORIGEN.
--
-- Hoy `lista_espera` solo tiene `nombre_nino` (texto completo). Al invitar, ese texto entero
-- caía en `ninos.nombre` dejando `ninos.apellidos` NULL (desajuste). Decisión de producto: el
-- formulario de prospecto pasa a tener DOS campos (nombre y apellidos). Aquí se añade la
-- columna de destino en origen.
--
-- NULLABLE a propósito: los prospectos creados ANTES de esta columna quedan con
-- `apellidos_nino` NULL (se completan al editar/invitar; el wizard será editable en 4c-2). El
-- formulario nuevo lo exige en altas/ediciones; la BD solo valida longitud cuando hay valor.
--
-- Aditiva y no destructiva. Aplicar por el SQL Editor de Supabase (CLI inusable por SIGILL).

ALTER TABLE public.lista_espera
  ADD COLUMN apellidos_nino text;

ALTER TABLE public.lista_espera
  ADD CONSTRAINT lista_espera_apellidos_nino_longitud
  CHECK (apellidos_nino IS NULL OR char_length(apellidos_nino) BETWEEN 1 AND 120);

COMMENT ON COLUMN public.lista_espera.apellidos_nino IS
  'F11 PR-4c-1: apellidos del niño, separados de nombre_nino. Nullable: prospectos previos a esta columna quedan NULL (se completan al editar/invitar). El formulario nuevo lo exige.';
