import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

/**
 * Cuenta las invitaciones PENDIENTES del usuario actual (RSVP sin responder de
 * citas programadas y aún no comenzadas, AG-14). Delega en la RPC
 * `contar_invitaciones_pendientes` (`SECURITY DEFINER STABLE`, usa `auth.uid()`),
 * que replica la ventana AG-11 sin duplicar el predicado en JS. Devuelve 0 ante
 * cualquier fallo (el badge no debe romper el layout). Patrón de
 * `contarRecordatoriosPendientes` (F6-C).
 */
export async function contarInvitacionesPendientes(): Promise<number> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return 0

  const { data, error } = await supabase.rpc('contar_invitaciones_pendientes')
  if (error) {
    logger.warn('contarInvitacionesPendientes', error.message)
    return 0
  }
  return data ?? 0
}
