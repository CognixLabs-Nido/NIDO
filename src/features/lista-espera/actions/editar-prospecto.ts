'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { editarProspectoSchema, type EditarProspectoInput } from '../schemas/lista-espera'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F11-H-3: edita los datos de un prospecto. No toca `posicion`, `estado`, `curso`
 * ni `centro` (eso lo gestionan reordenar/invitar/descartar). RLS limita a admin.
 */
export async function editarProspecto(
  input: EditarProspectoInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = editarProspectoSchema.safeParse(input)
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? 'listaEspera.validation.invalid')
  const data = parsed.data

  const supabase = await createClient()
  const { data: actualizado, error } = await supabase
    .from('lista_espera')
    .update({
      nombre_nino: data.nombre_nino,
      fecha_nacimiento: data.fecha_nacimiento,
      telefono_tutor: data.telefono_tutor,
      email_tutor: data.email_tutor,
      nota: data.nota,
    })
    .eq('id', data.id)
    .select('id')
    .maybeSingle()
  if (error) {
    logger.warn('editarProspecto update', error.message)
    return fail('listaEspera.errors.editar_fallo')
  }
  if (!actualizado) return fail('listaEspera.errors.no_encontrado')

  revalidatePath('/[locale]/admin/admisiones', 'page')
  return ok({ id: actualizado.id })
}
