'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { asignarAulaPropuestaSchema, type AsignarAulaPropuestaInput } from '../schemas/rollover'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F11-H-2: asigna (o reasigna) a un niño una sala concreta del curso destino en la
 * propuesta. Resuelve los casos "requiere elección" (≥2 salas o sin fecha) y los
 * overrides manuales de la directora. Opera SOLO sobre la propuesta (estado
 * `pendiente`): si el niño ya tiene una pendiente en el destino la actualiza, si
 * no, la crea. No toca matrículas activas ni de baja.
 */
export async function asignarAulaPropuesta(
  input: AsignarAulaPropuestaInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = asignarAulaPropuestaSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'rollover.validation.invalid')
  const { curso_destino_id, nino_id, aula_id } = parsed.data

  const supabase = await createClient()

  // El destino debe ser planificado y la sala debe estar configurada en ese curso
  // (la FK compuesta lo exigiría; lo comprobamos para un error claro).
  const { data: destino } = await supabase
    .from('cursos_academicos')
    .select('estado')
    .eq('id', curso_destino_id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!destino) return fail('rollover.errors.destino_no_encontrado')
  if (destino.estado !== 'planificado') return fail('rollover.errors.destino_no_planificado')

  const { data: aulaCfg } = await supabase
    .from('aulas_curso')
    .select('aula_id')
    .eq('aula_id', aula_id)
    .eq('curso_academico_id', curso_destino_id)
    .maybeSingle()
  if (!aulaCfg) return fail('rollover.errors.aula_no_en_destino')

  // ¿Ya hay una pendiente para este niño en el destino?
  const { data: existente } = await supabase
    .from('matriculas')
    .select('id, estado')
    .eq('nino_id', nino_id)
    .eq('curso_academico_id', curso_destino_id)
    .is('deleted_at', null)
    .maybeSingle()

  if (existente) {
    if (existente.estado !== 'pendiente') return fail('rollover.errors.no_pendiente')
    const { error } = await supabase.from('matriculas').update({ aula_id }).eq('id', existente.id)
    if (error) {
      logger.warn('asignarAulaPropuesta update', error.message)
      return fail('rollover.errors.asignar_fallo')
    }
    revalidatePath('/[locale]/admin/pasar-de-curso', 'page')
    return ok({ id: existente.id })
  }

  const { data: nueva, error } = await supabase
    .from('matriculas')
    .insert({
      nino_id,
      aula_id,
      curso_academico_id: curso_destino_id,
      estado: 'pendiente',
    })
    .select('id')
    .single()
  if (error || !nueva) {
    logger.warn('asignarAulaPropuesta insert', error?.message)
    return fail('rollover.errors.asignar_fallo')
  }

  revalidatePath('/[locale]/admin/pasar-de-curso', 'page')
  return ok({ id: nueva.id })
}
