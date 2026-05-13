'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { updateCentroSchema, type UpdateCentroInput } from '../schemas/centro'

import { fail, ok, type ActionResult } from '../types'

export async function updateCentro(
  centroId: string,
  input: UpdateCentroInput
): Promise<ActionResult<void>> {
  const parsed = updateCentroSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'centro.validation.invalid')
  }

  const supabase = await createClient()
  // RLS bloquea el UPDATE si el usuario no es admin del centro.
  const { error } = await supabase.from('centros').update(parsed.data).eq('id', centroId)
  if (error) {
    logger.warn('updateCentro error', error.message)
    return fail('centro.errors.update_failed')
  }

  revalidatePath('/[locale]/admin/centro', 'page')
  return ok(undefined)
}
