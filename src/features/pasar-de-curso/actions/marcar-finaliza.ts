'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'

import { marcarFinalizaCore } from '../lib/mutaciones-rollover'
import { marcarFinalizaSchema, type MarcarFinalizaInput } from '../schemas/rollover'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F-3-A: marca a un niño como destino "Finaliza" en el curso destino (planificado).
 * Borra su matrícula `pendiente` si la tenía (exclusión mutua) y registra la fila
 * `rollover_finaliza`. Reversible con `asignarAulaPropuesta`. NO archiva nada (F-3-C).
 */
export async function marcarFinaliza(input: MarcarFinalizaInput): Promise<ActionResult<void>> {
  const parsed = marcarFinalizaSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'rollover.validation.invalid')

  const supabase = await createClient()
  const res = await marcarFinalizaCore(supabase, parsed.data.curso_destino_id, parsed.data.nino_id)
  if (!res.success) return res

  revalidatePath('/[locale]/admin/pasar-de-curso', 'page')
  return ok(undefined)
}
