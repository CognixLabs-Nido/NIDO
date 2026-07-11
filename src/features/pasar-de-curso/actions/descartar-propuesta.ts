'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'

import { descartarPropuestaCore } from '../lib/mutaciones-rollover'
import { cursoDestinoSchema, type CursoDestinoInput } from '../schemas/rollover'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F11-H-2: descarta la propuesta del curso destino — borra todas las matrículas
 * `pendiente` de ese curso. F-3-A: borra también todas las filas `rollover_finaliza`
 * del destino (reset global). Solo si el destino sigue planificado.
 */
export async function descartarPropuesta(
  input: CursoDestinoInput
): Promise<ActionResult<{ borradas: number }>> {
  const parsed = cursoDestinoSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'rollover.validation.invalid')

  const supabase = await createClient()
  const res = await descartarPropuestaCore(supabase, parsed.data.curso_destino_id)
  if (!res.success) return res

  revalidatePath('/[locale]/admin/pasar-de-curso', 'page')
  return ok(res.data)
}
