import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

/**
 * Cuenta los recordatorios PENDIENTES donde el usuario actual es DESTINATARIO
 * DIRECTO (no por mera visibilidad RLS: un admin ve todo el centro pero no es
 * destinatario). Delega en la RPC `contar_recordatorios_pendientes`
 * (`SECURITY DEFINER STABLE`, usa `auth.uid()`), que replica la matriz D7 sin
 * duplicar el predicado en JS. Devuelve 0 ante cualquier fallo (el badge no
 * debe romper el layout).
 */
export async function contarRecordatoriosPendientes(): Promise<number> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return 0

  const { data, error } = await supabase.rpc('contar_recordatorios_pendientes')
  if (error) {
    logger.warn('contarRecordatoriosPendientes', error.message)
    return 0
  }
  return data ?? 0
}
