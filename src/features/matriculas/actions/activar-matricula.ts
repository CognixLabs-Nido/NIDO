'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, type ActionResult } from '../../centros/types'

const matriculaIdSchema = z.string().uuid()

/**
 * Pieza 2b — "Activar matrícula". Flipea una matrícula de esqueleto
 * `estado='pendiente'` → `'activa'`, momento en el que (gracias al endurecimiento
 * de la Pieza 2a) el niño entra en las lecturas operativas.
 *
 * RLS de `matriculas` gobierna el acceso (solo admin del centro actualiza). El
 * `.eq('estado','pendiente')` + `.maybeSingle()` da idempotencia (patrón "USING
 * falso → 0 filas"): si ya estaba activa o no existe, `data` es null.
 *
 * NOTA Pieza 4: aquí NO hay guard de "wizard completado" — el admin podría activar
 * un esqueleto vacío. El gate "no activar hasta que el tutor complete los datos"
 * llega con el wizard.
 */
export async function activarMatricula(matriculaId: string): Promise<ActionResult<{ id: string }>> {
  const parsed = matriculaIdSchema.safeParse(matriculaId)
  if (!parsed.success) return fail('matricula.validation.invalid')

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('matriculas')
    .update({ estado: 'activa' })
    .eq('id', parsed.data)
    .eq('estado', 'pendiente')
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('activarMatricula', error.message)
    if (error.code === '42501') return fail('matricula.errors.no_autorizado')
    return fail('matricula.errors.activar_failed')
  }
  if (!data) return fail('matricula.errors.no_pendiente')

  revalidatePath('/[locale]/admin/ninos', 'page')
  return ok({ id: data.id })
}
