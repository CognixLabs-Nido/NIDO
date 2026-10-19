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
 * hace falta más lógica que el centro: la RLS deja ver los de todos los centros del usuario
 * (un admin de dos centros, un profe en A que es tutor en B), y aquí solo van los de la página.
 */
export async function getNinosParaRecordatorios(centroId: string): Promise<NinoParaRecordatorio[]> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return []

  const { data, error } = await supabase
    .from('ninos')
    .select('id, nombre, apellidos')
    .eq('centro_id', centroId)
    .is('deleted_at', null)
    .order('nombre', { ascending: true })

  if (error) {
    logger.warn('getNinosParaRecordatorios', error.message)
    return []
  }
  // Esqueleto de niño (alta tutor-driven) puede traer apellidos NULL → coalesce.
  return (data ?? []).map((n) => ({ ...n, apellidos: n.apellidos ?? '' }))
}
