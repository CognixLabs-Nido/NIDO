import 'server-only'

import {
  direccionDelCentro,
  type MiembroDireccion,
} from '@/features/centros/contexto/roles-de-otros'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

/** Quién dirige el centro, con la sesión. `null` si la lectura falla. */
export async function getDireccionDelCentro(centroId: string): Promise<MiembroDireccion[] | null> {
  return direccionDelCentro(await createClient(), centroId)
}

export interface InvitacionDirectora {
  id: string
  email: string
  expiresAt: string
}

/** Las invitaciones de directora pendientes del centro. `null` si la lectura falla. */
export async function getInvitacionesDirectora(
  centroId: string
): Promise<InvitacionDirectora[] | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('invitaciones')
    .select('id, email, expires_at')
    .eq('centro_id', centroId)
    .eq('rol_objetivo', 'directora')
    .is('accepted_at', null)
    .is('rejected_at', null)
    .order('expires_at', { ascending: true })
  if (error) {
    logger.warn('getInvitacionesDirectora error', error.message)
    return null
  }
  return (data ?? []).map((i) => ({ id: i.id, email: i.email, expiresAt: i.expires_at }))
}
