import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

export interface NinoParaRecordatorio {
  id: string
  nombre: string
  apellidos: string
}

/**
 * Niños que el usuario puede asociar a un recordatorio `familia`/`equipo`.
 * La RLS de `ninos` ya filtra el alcance por rol: admin → niños del centro;
 * profe → niños de sus aulas; tutor/autorizado → sus niños vinculados. No
 * hace falta lógica extra aquí — el SELECT bajo RLS devuelve el set correcto.
 */
export async function getNinosParaRecordatorios(): Promise<NinoParaRecordatorio[]> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return []

  const { data, error } = await supabase
    .from('ninos')
    .select('id, nombre, apellidos')
    .is('deleted_at', null)
    .order('nombre', { ascending: true })

  if (error) {
    logger.warn('getNinosParaRecordatorios', error.message)
    return []
  }
  return data ?? []
}
