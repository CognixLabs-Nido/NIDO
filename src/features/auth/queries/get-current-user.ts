import 'server-only'

import { createClient } from '@/lib/supabase/server'

interface CurrentUser {
  id: string
  email: string
  nombreCompleto: string | null
}

/**
 * Devuelve datos básicos del usuario autenticado incluyendo el nombre_completo
 * de la tabla `usuarios`. Pensado para el header / sidebar.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return null

  const { data } = await supabase
    .from('usuarios')
    .select('nombre_completo')
    .eq('id', userData.user.id)
    .maybeSingle()

  return {
    id: userData.user.id,
    email: userData.user.email ?? '',
    nombreCompleto: data?.nombre_completo ?? null,
  }
}
