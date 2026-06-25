'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { reordenarListaEsperaSchema, type ReordenarListaEsperaInput } from '../schemas/lista-espera'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F11-H-3: persiste el nuevo orden de la cola tras un drag-and-drop. Recibe los
 * ids en el orden deseado y fija `posicion = índice + 1`. Cada UPDATE se acota al
 * curso (un id de otro curso no casa) y RLS limita a admin del centro.
 */
export async function reordenarListaEspera(
  input: ReordenarListaEsperaInput
): Promise<ActionResult<{ actualizadas: number }>> {
  const parsed = reordenarListaEsperaSchema.safeParse(input)
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? 'listaEspera.validation.invalid')
  const { curso_academico_id, orden } = parsed.data

  const supabase = await createClient()

  const resultados = await Promise.all(
    orden.map((id, idx) =>
      supabase
        .from('lista_espera')
        .update({ posicion: idx + 1 })
        .eq('id', id)
        .eq('curso_academico_id', curso_academico_id)
        .select('id')
        .maybeSingle()
    )
  )

  const conError = resultados.find((r) => r.error)
  if (conError?.error) {
    logger.warn('reordenarListaEspera update', conError.error.message)
    return fail('listaEspera.errors.reordenar_fallo')
  }

  revalidatePath('/[locale]/admin/admisiones', 'page')
  return ok({ actualizadas: resultados.filter((r) => r.data).length })
}
