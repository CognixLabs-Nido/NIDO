import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { logger } from '@/shared/lib/logger'

/**
 * ¿Es la familia nueva en el centro? (fase 5b, decidido por el responsable el 2026-11-10: «cómo nos
 * has conocido» se pregunta SOLO a familias nuevas). Nueva = ningún otro niño con su `familia_id`,
 * vivo, de baja o archivado; una familia es de un solo centro (`familias_centro_inmutable`).
 *
 * Se cuenta con el servicio, y solo se devuelve un número: con la sesión no sale. La tutora no ve
 * a un hermano de baja (archivar borra su vínculo) y en modo Dirección no hay vínculos, así que
 * los dos casos darían «nueva» sin serlo. Lo llama la página del alta DESPUÉS de autorizar.
 *
 * `null` = no se ha podido leer: la pantalla no pregunta (un fallo no es «familia nueva»).
 */
export async function esFamiliaNuevaEnCentro(
  ninoId: string,
  familiaId: string
): Promise<boolean | null> {
  const { count, error } = await createServiceRoleClient()
    .from('ninos')
    .select('id', { count: 'exact', head: true })
    .eq('familia_id', familiaId)
    .neq('id', ninoId)
  if (error || count === null) {
    logger.warn('esFamiliaNuevaEnCentro', error?.code ?? 'sin_recuento')
    return null
  }
  return count === 0
}
