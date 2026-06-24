'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { cursoDestinoSchema, type CursoDestinoInput } from '../schemas/rollover'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F11-H-2: descarta la propuesta del curso destino — borra todas las matrículas
 * `pendiente` de ese curso. Escape para empezar de cero si la directora abandona
 * o quiere rehacer. Solo afecta a `pendiente` (no toca activas/históricas) y solo
 * si el destino sigue planificado (no se "descarta" un rollover ya confirmado).
 */
export async function descartarPropuesta(
  input: CursoDestinoInput
): Promise<ActionResult<{ borradas: number }>> {
  const parsed = cursoDestinoSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'rollover.validation.invalid')

  const supabase = await createClient()

  const { data: destino } = await supabase
    .from('cursos_academicos')
    .select('estado')
    .eq('id', parsed.data.curso_destino_id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!destino) return fail('rollover.errors.destino_no_encontrado')
  if (destino.estado !== 'planificado') return fail('rollover.errors.destino_no_planificado')

  const { data: borradas, error } = await supabase
    .from('matriculas')
    .delete()
    .eq('curso_academico_id', parsed.data.curso_destino_id)
    .eq('estado', 'pendiente')
    .select('id')
  if (error) {
    logger.warn('descartarPropuesta', error.message)
    return fail('rollover.errors.descartar_fallo')
  }

  revalidatePath('/[locale]/admin/pasar-de-curso', 'page')
  return ok({ borradas: (borradas ?? []).length })
}
