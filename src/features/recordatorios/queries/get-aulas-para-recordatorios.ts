import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

export interface AulaParaRecordatorio {
  id: string
  nombre: string
}

/**
 * Aulas que el usuario puede destinar en un recordatorio `familias_aula`:
 *  - admin → todas las aulas activas del centro.
 *  - profe → solo sus aulas con asignación activa (`profes_aulas`).
 *
 * No basta con la RLS de `aulas` (cualquier miembro del centro ve todas las
 * aulas), así que para profe filtramos explícitamente por `profes_aulas`. La
 * RLS de INSERT de `recordatorios` (`es_profe_de_aula`) es la red de seguridad
 * final; esto es solo para que el picker muestre el set correcto.
 */
export async function getAulasParaRecordatorios(
  rol: 'admin' | 'profe',
  centroId: string
): Promise<AulaParaRecordatorio[]> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return []

  if (rol === 'admin') {
    const { data, error } = await supabase
      .from('aulas')
      .select('id, nombre')
      .eq('centro_id', centroId)
      .is('deleted_at', null)
      .order('nombre', { ascending: true })
    if (error) {
      logger.warn('getAulasParaRecordatorios(admin)', error.message)
      return []
    }
    return data ?? []
  }

  // profe → sus aulas activas vía profes_aulas.
  const { data, error } = await supabase
    .from('profes_aulas')
    .select('aula:aulas!inner(id, nombre, deleted_at)')
    .eq('profe_id', userId)
    .is('fecha_fin', null)
    .is('deleted_at', null)
  if (error) {
    logger.warn('getAulasParaRecordatorios(profe)', error.message)
    return []
  }

  const porId = new Map<string, AulaParaRecordatorio>()
  for (const row of data ?? []) {
    const aula = row.aula as { id: string; nombre: string; deleted_at: string | null } | null
    if (!aula || aula.deleted_at !== null) continue
    porId.set(aula.id, { id: aula.id, nombre: aula.nombre })
  }
  return Array.from(porId.values()).sort((a, b) => a.nombre.localeCompare(b.nombre))
}
