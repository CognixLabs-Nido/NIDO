'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { desarchivarNinoSchema, type DesarchivarNinoInput } from '../schemas/desarchivar'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F-3-F — Dirección reincorpora a un niño dado de baja. Toda la lógica (revertir los
 * deleted_at en cadena + reactivar rol/familia si procede + abrir matrícula nueva en
 * el curso activo) vive en la RPC `desarchivar_nino` (todo-o-nada, SECURITY DEFINER).
 * Esta action solo valida y la invoca. La RPC gatea `es_admin(centro del niño)` → un
 * no-admin recibe 42501.
 */
export async function desarchivarNino(input: DesarchivarNinoInput): Promise<ActionResult<null>> {
  const parsed = desarchivarNinoSchema.safeParse(input)
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? 'nino.desarchivar.validation.invalid')

  const supabase = await createClient()
  const { error } = await supabase.rpc('desarchivar_nino', {
    p_nino_id: parsed.data.nino_id,
    p_aula_id: parsed.data.aula_id,
  })
  if (error) {
    logger.warn('desarchivarNino', error.message)
    if (error.code === '42501') return fail('nino.desarchivar.errors.no_autorizado')
    return fail('nino.desarchivar.errors.fallo')
  }

  revalidatePath('/[locale]/admin/ninos/[id]', 'page')
  revalidatePath('/[locale]/admin/ninos', 'page')
  return ok(null)
}
