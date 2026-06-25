'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { quitarAulaPropuestaSchema, type QuitarAulaPropuestaInput } from '../schemas/rollover'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F11-H-2-1: quita la propuesta de un niño (lo marca como "se gradúa" desde la
 * tabla). Borra SU matrícula `pendiente` en el curso destino. Opera solo sobre
 * propuestas (estado `pendiente`) de un curso `planificado`: nunca toca activas
 * ni de baja. Idempotente: si no hay pendiente, no hace nada y devuelve ok.
 */
export async function quitarAulaPropuesta(
  input: QuitarAulaPropuestaInput
): Promise<ActionResult<{ borradas: number }>> {
  const parsed = quitarAulaPropuestaSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'rollover.validation.invalid')
  const { curso_destino_id, nino_id } = parsed.data

  const supabase = await createClient()

  const { data: destino } = await supabase
    .from('cursos_academicos')
    .select('estado')
    .eq('id', curso_destino_id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!destino) return fail('rollover.errors.destino_no_encontrado')
  if (destino.estado !== 'planificado') return fail('rollover.errors.destino_no_planificado')

  const { data: borradas, error } = await supabase
    .from('matriculas')
    .delete()
    .eq('nino_id', nino_id)
    .eq('curso_academico_id', curso_destino_id)
    .eq('estado', 'pendiente')
    .select('id')
  if (error) {
    logger.warn('quitarAulaPropuesta delete', error.message)
    return fail('rollover.errors.quitar_fallo')
  }

  revalidatePath('/[locale]/admin/pasar-de-curso', 'page')
  return ok({ borradas: borradas?.length ?? 0 })
}
