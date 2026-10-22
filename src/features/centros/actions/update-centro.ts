'use server'

import { revalidatePath } from 'next/cache'

import { usuarioResponsableEn } from '@/features/centros/contexto/roles-del-usuario'
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
  // Los datos del centro son de la admin, no de una directora. Sin esta guarda, una directora
  // recibiría «guardado»: el UPDATE sin RETURNING que la RLS deja en 0 filas no da error.
  if (!(await usuarioResponsableEn(supabase, centroId))) return fail('centro.errors.no_autorizado')
  const { error } = await supabase.from('centros').update(parsed.data).eq('id', centroId)
  if (error) {
    logger.warn('updateCentro error', error.message)
    // Nombres de centro únicos entre los vivos (`idx_centros_nombre_vivo_unico`, Fase 5).
    if (error.code === '23505') return fail('centro.errors.nombre_duplicado')
    return fail('centro.errors.update_failed')
  }

  revalidatePath('/[locale]/admin/centro', 'page')
  return ok(undefined)
}
