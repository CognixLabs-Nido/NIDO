'use server'

import { revalidatePath } from 'next/cache'

import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string }

const schema = z.object({
  nino_id: z.string().uuid(),
  puede_aparecer: z.boolean(),
})
export type SetPuedeAparecerInput = z.infer<typeof schema>

/**
 * Pone/quita el consentimiento de imagen del niño (`ninos.puede_aparecer_en_fotos`),
 * que **solo dirección** gestiona (F10, P1). Es el gate del etiquetado: revocarlo
 * oculta las publicaciones donde el niño está etiquetado (RLS de F10-0). Solo admin
 * del centro (RLS UPDATE de `ninos`). Queda en `audit_log`.
 */
export async function setPuedeAparecerEnFotos(
  input: SetPuedeAparecerInput
): Promise<ActionResult<{ puede_aparecer: boolean }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'nino.errors.no_autorizado' }

  const parsed = schema.safeParse(input)
  if (!parsed.success) return { success: false, error: 'nino.errors.actualizacion_fallo' }
  const { nino_id, puede_aparecer } = parsed.data

  const { data: upd, error } = await supabase
    .from('ninos')
    .update({ puede_aparecer_en_fotos: puede_aparecer })
    .eq('id', nino_id)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('setPuedeAparecerEnFotos: update', error.message)
    if (error.code === '42501') return { success: false, error: 'nino.errors.no_autorizado' }
    return { success: false, error: 'nino.errors.actualizacion_fallo' }
  }
  if (!upd) return { success: false, error: 'nino.errors.no_autorizado' }

  revalidatePath('/[locale]/admin/ninos/[id]', 'page')
  return { success: true, data: { puede_aparecer } }
}
