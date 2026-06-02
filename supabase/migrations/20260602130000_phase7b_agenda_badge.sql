-- =============================================================================
-- Fase 7b (Agenda) — Badge de invitaciones pendientes (AG-14)
-- =============================================================================
-- Migración ADITIVA: añade SOLO la RPC del badge. No crea tablas, columnas ni
-- políticas; no toca la migración 20260602120000_phase7b_agenda.sql (inmutable).
--
-- Patrón exacto de `contar_recordatorios_pendientes()` (F6-C): SECURITY DEFINER
-- STABLE que cuenta sobre `auth.uid()`. Cuenta las invitaciones PENDIENTES del
-- usuario (filas `cita_invitados` con `usuario_id = auth.uid()` y
-- `estado = 'pendiente'`) cuya `citas` está `programada` y AÚN NO HA COMENZADO
-- (ventana de RSVP, AG-11: el instante de inicio en huso Europe/Madrid es futuro).
--
-- El organizador NO cuenta sus propias citas: estructuralmente no es invitado de
-- ellas (`crearCita` lo excluye del snapshot), pero se deja explícito
-- (`organizador_id <> auth.uid()`) como red de seguridad.
--
-- SECURITY DEFINER bypassa RLS, pero la función solo cuenta filas del propio
-- usuario (`usuario_id = auth.uid()`) → sin fuga (igual que la RPC de F6-C).
--
-- Sin push ni Realtime: el badge se calcula en server-render al navegar.
--
-- Spec: docs/specs/agenda-citas.md (AG-14).
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.contar_invitaciones_pendientes()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int
  FROM public.cita_invitados ci
  JOIN public.citas c ON c.id = ci.cita_id
  WHERE ci.usuario_id = auth.uid()
    AND ci.estado = 'pendiente'
    AND c.estado = 'programada'
    AND c.organizador_id <> auth.uid()
    AND ((c.fecha + c.hora_inicio) AT TIME ZONE 'Europe/Madrid') > now();
$$;

GRANT EXECUTE ON FUNCTION public.contar_invitaciones_pendientes() TO authenticated;

COMMIT;
