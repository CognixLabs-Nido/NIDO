'use server'

import { createClient } from '@/lib/supabase/server'

import { resetPasswordSchema, type ResetPasswordInput } from '../schemas/reset-password'

import { fail, ok, type ActionResult } from './types'

export async function resetPassword(input: ResetPasswordInput): Promise<ActionResult<void>> {
  const parsed = resetPasswordSchema.safeParse(input)
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message ?? 'auth.validation.invalid'
    return fail(firstError)
  }

  const supabase = await createClient()
  // El usuario debe llegar aquí con una sesión temporal establecida por el cliente
  // (vía exchangeCodeForSession con el token del email).
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) return fail('auth.reset.errors.update_failed')

  await supabase.auth.signOut()
  return ok(undefined)
}
