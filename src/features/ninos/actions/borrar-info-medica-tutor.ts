'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * Flag-2 (F11-F2) — el TUTOR LEGAL borra la info médica voluntaria de su hijo vía
 * la RPC `borrar_info_medica_nino_tutor` (SECURITY DEFINER). Cierra el modelo de
 * F11-F: la info médica es voluntaria y la RPC de escritura usa "NULL = preservar"
 * (COALESCE), así que no puede vaciarla; este borrado retira el dato compartido.
 * La RPC gatea solo con `es_tutor_legal_de(nino_id)` (excluye 'autorizado' y admin)
 * y borra la fila entera (erasure real, capturado por el trigger de audit).
 * Idempotente: si no hay fila, no falla. Si el llamante no es tutor legal, 42501.
 */
export async function borrarInfoMedicaTutor(ninoId: string): Promise<ActionResult<null>> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('borrar_info_medica_nino_tutor', { p_nino_id: ninoId })
  if (error) {
    logger.warn('borrarInfoMedicaTutor', error.message)
    // 42501 = no es tutor legal del niño (gate de la RPC).
    if (error.code === '42501') return fail('nino.errors.medica_no_autorizado')
    return fail('nino.errors.borrar_medica_fallo')
  }
  return ok(null)
}
