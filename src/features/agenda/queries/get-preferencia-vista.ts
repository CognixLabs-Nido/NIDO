import 'server-only'

import { createClient } from '@/lib/supabase/server'

import { PREF_VISTA_AGENDA, VISTA_AGENDA_DEFAULT, type VistaAgenda } from '../types'

/** Preferencia de vista persistida del usuario (AG-07); `dia` por defecto. */
export async function getPreferenciaVistaAgenda(): Promise<VistaAgenda> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return VISTA_AGENDA_DEFAULT

  const { data } = await supabase
    .from('preferencias_usuario')
    .select('valor')
    .eq('clave', PREF_VISTA_AGENDA)
    .maybeSingle()

  if (data?.valor === 'dia' || data?.valor === 'semana' || data?.valor === 'mes') {
    return data.valor
  }
  return VISTA_AGENDA_DEFAULT
}
