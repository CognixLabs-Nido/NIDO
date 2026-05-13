-- =============================================================================
-- Fase 2 — Fix: search_path de funciones de cifrado debe incluir extensions
-- =============================================================================
-- En Supabase managed, pgcrypto se instala en el schema `extensions`, no en
-- `public`. Las funciones SECURITY DEFINER tienen SET search_path = public
-- (buena práctica de seguridad), pero eso hace que pgp_sym_encrypt y
-- pgp_sym_decrypt no se encuentren ("function pgp_sym_encrypt(text, text)
-- does not exist").
--
-- Fix: ampliar search_path para incluir `extensions` además de public.
-- =============================================================================

ALTER FUNCTION public.set_info_medica_emergencia_cifrada(
  uuid, text, text, text, text, text, text
) SET search_path = public, extensions;

ALTER FUNCTION public.get_info_medica_emergencia(uuid)
  SET search_path = public, extensions;
