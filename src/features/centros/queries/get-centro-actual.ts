import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Devuelve el id del centro al que pertenece el usuario autenticado.
 * En Ola 1 solo existe un centro (ANAIA), pero esta utility está pensada
 * para que en el futuro el mismo usuario pueda navegar entre varios.
 * Devuelve null si no hay sesión o el usuario no tiene rol activo.
 */
export async function getCentroActualId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return null

  const { data } = await supabase
    .from('roles_usuario')
    .select('centro_id')
    .eq('usuario_id', userData.user.id)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()

  return data?.centro_id ?? null
}

/**
 * Devuelve el rol activo del usuario en el centro (primer rol encontrado).
 * Útil para gating server-side en server components.
 */
export async function getRolEnCentro(centroId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return null

  const { data } = await supabase
    .from('roles_usuario')
    .select('rol')
    .eq('usuario_id', userData.user.id)
    .eq('centro_id', centroId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()

  return data?.rol ?? null
}
