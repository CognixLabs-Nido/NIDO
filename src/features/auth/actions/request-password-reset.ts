'use server'

import { createClient } from '@/lib/supabase/server'
import { getAppUrl } from '@/shared/lib/app-url'
import { logger } from '@/shared/lib/logger'

import {
  requestPasswordResetSchema,
  type RequestPasswordResetInput,
} from '../schemas/reset-password'

import { fail, ok, type ActionResult } from './types'

export async function requestPasswordReset(
  input: RequestPasswordResetInput,
  locale: string = 'es'
): Promise<ActionResult<void>> {
  const parsed = requestPasswordResetSchema.safeParse(input)
  // Aunque el email sea inválido devolvemos success para no filtrar info.
  if (!parsed.success) return ok(undefined)

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${getAppUrl()}/${locale}/reset-password`,
  })

  if (error) {
    logger.warn('requestPasswordReset error', error.message)
  }
  // Política: respuesta uniforme aunque falle.
  return ok(undefined)
}

// Re-export para evitar warning unused
export { fail }
