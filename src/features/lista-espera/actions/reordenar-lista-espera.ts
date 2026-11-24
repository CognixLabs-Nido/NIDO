'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { reordenarListaEsperaSchema, type ReordenarListaEsperaInput } from '../schemas/lista-espera'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F11-H-3: persiste el nuevo orden de la cola tras un drag-and-drop. Recibe los ids NO descartados en
 * el orden deseado.
 *
 * Desde el 2026-11-24 (C, PR B) lo hace la base en UNA sentencia (`reordenar_lista_espera`): numera el
 * curso entero, los descartados detrás, y una restricción única impide repetir posición. Antes eran N
 * UPDATE en paralelo que numeraban 1..N solo los no descartados, y un descartado que conservaba la
 * suya chocaba (dos familias en la misma posición). Si el panel estaba desfasado, la base lo rechaza
 * (`orden_desfasado`) y el panel recarga.
 */
export async function reordenarListaEspera(
  input: ReordenarListaEsperaInput
): Promise<ActionResult<{ actualizadas: number }>> {
  const parsed = reordenarListaEsperaSchema.safeParse(input)
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? 'listaEspera.validation.invalid')
  const { curso_academico_id, orden } = parsed.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('reordenar_lista_espera', {
    p_curso: curso_academico_id,
    p_orden: orden,
  })
  if (error) {
    logger.warn('reordenarListaEspera', error.message)
    if (error.hint === 'orden_desfasado') return fail('listaEspera.errors.orden_desfasado')
    return fail('listaEspera.errors.reordenar_fallo')
  }

  revalidatePath('/[locale]/admin/admisiones', 'page')
  return ok({ actualizadas: data ?? 0 })
}
