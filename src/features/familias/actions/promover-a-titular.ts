'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, type ActionResult } from '../../centros/types'

const schema = z.object({ tutor_id: z.string().uuid() })

/**
 * Cierre de la purga RGPD — la familia se queda sin titular cuando se purga a su titular, y la
 * purga no asciende al otro tutor: lo decide la directora. Con su SESIÓN, por la RPC
 * `promover_a_titular` (`20261015120000`), que comprueba que es admin del centro de la familia,
 * que la familia no tiene titular activo y que la fila es un segundo tutor activo; pasa la
 * fila a titular y sus vínculos a tutor_legal_principal. La directora queda como actor en
 * `audit_log`.
 */
export async function promoverATitular(input: {
  tutor_id: string
}): Promise<ActionResult<{ id: string }>> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) return fail('admin.familias.validation.invalid')

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData?.user) return fail('auth.invitation.errors.unauthenticated')

  const { error } = await supabase.rpc('promover_a_titular', {
    p_familia_tutor_id: parsed.data.tutor_id,
  })
  if (error) {
    logger.warn('promoverATitular', error.code ?? '', error.message)
    if (error.code === '42501') return fail('admin.familias.errors.no_autorizado')
    // 23514: la familia ya tiene titular o la fila no es un segundo tutor (otra pestaña).
    if (error.code === '23514') return fail('admin.familias.promover.errors.no_aplicable')
    return fail('admin.familias.errors.guardado')
  }

  revalidatePath('/[locale]/admin/familias', 'page')
  revalidatePath('/[locale]/admin/familias/[id]', 'page')
  return ok({ id: parsed.data.tutor_id })
}
