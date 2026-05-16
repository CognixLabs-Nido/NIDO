'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { eliminarDiaCentroSchema, type EliminarDiaCentroInput } from '../schemas/dia-centro'
import { fail, ok, type ActionResult } from '../types'

/**
 * Elimina el override de un día. Idempotente: si no había fila, no hace
 * nada y devuelve success igual (devolver error confundiría al usuario
 * — el efecto deseado ya está garantizado: el día vuelve al default).
 *
 * DELETE permitido a admin como EXCEPCIÓN al patrón habitual (ADR-0019).
 * El trigger de audit captura `valores_antes` con la fila completa.
 */
export async function eliminarDiaCentro(
  input: EliminarDiaCentroInput
): Promise<ActionResult<void>> {
  const parsed = eliminarDiaCentroSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'calendario.toasts.error_eliminar')
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('dias_centro')
    .delete()
    .eq('centro_id', parsed.data.centro_id)
    .eq('fecha', parsed.data.fecha)

  if (error) {
    logger.warn('eliminarDiaCentro failed', error.message)
    return fail('calendario.toasts.error_eliminar')
  }

  revalidatePath('/[locale]/admin/calendario', 'page')
  revalidatePath('/[locale]/teacher/calendario', 'page')
  revalidatePath('/[locale]/family/calendario', 'page')
  revalidatePath('/[locale]/family', 'page')
  revalidatePath('/[locale]/teacher', 'page')

  return ok(undefined)
}
