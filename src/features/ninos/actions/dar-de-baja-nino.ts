'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { bajaNinoSchema, type BajaNinoInput } from '../schemas/baja'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F-3-D — Dirección da de baja a un niño en mitad de curso. Toda la lógica (archivar
 * + revocar acceso familiar si queda sin niños activos) vive en la RPC `baja_nino`
 * (todo-o-nada, SECURITY DEFINER). Esta action solo valida y la invoca. La RPC gatea
 * `es_admin(centro del niño)` → un no-admin recibe 42501.
 */
export async function darDeBajaNino(input: BajaNinoInput): Promise<ActionResult<null>> {
  const parsed = bajaNinoSchema.safeParse(input)
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? 'nino.baja.validation.invalid')

  const supabase = await createClient()
  const { error } = await supabase.rpc('baja_nino', {
    p_nino_id: parsed.data.nino_id,
    p_motivo: parsed.data.motivo,
  })
  if (error) {
    logger.warn('darDeBajaNino', error.message)
    if (error.code === '42501') return fail('nino.baja.errors.no_autorizado')
    return fail('nino.baja.errors.fallo')
  }

  revalidatePath('/[locale]/admin/ninos/[id]', 'page')
  revalidatePath('/[locale]/admin/ninos', 'page')
  return ok(null)
}
