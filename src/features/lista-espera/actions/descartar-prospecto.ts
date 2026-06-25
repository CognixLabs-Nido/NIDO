'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { descartarProspectoSchema, type DescartarProspectoInput } from '../schemas/lista-espera'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F11-H-3: "borrar" un prospecto desde la lista = baja BLANDA (estado='descartado',
 * ya en el ENUM). No hay DELETE físico: conserva la traza en `audit_log`. RLS admin.
 */
export async function descartarProspecto(
  input: DescartarProspectoInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = descartarProspectoSchema.safeParse(input)
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? 'listaEspera.validation.invalid')

  const supabase = await createClient()
  const { data: actualizado, error } = await supabase
    .from('lista_espera')
    .update({ estado: 'descartado' })
    .eq('id', parsed.data.id)
    .select('id')
    .maybeSingle()
  if (error) {
    logger.warn('descartarProspecto update', error.message)
    return fail('listaEspera.errors.descartar_fallo')
  }
  if (!actualizado) return fail('listaEspera.errors.no_encontrado')

  revalidatePath('/[locale]/admin/admisiones', 'page')
  return ok({ id: actualizado.id })
}
