'use server'

import { escrituraSecundariaFallida } from '@/shared/lib/tras-escritura'
import { createHash } from 'crypto'
import { headers } from 'next/headers'

import { esSuperusuario } from '@/features/centros/contexto/roles-del-usuario'
import { createClient } from '@/lib/supabase/server'

import { signInSchema, type SignInInput } from '../schemas/sign-in'

import { fail, ok, type ActionResult } from './types'
import { createServiceRoleClient } from '@/lib/supabase/admin'

const MAX_FAILED_ATTEMPTS = 5
const WINDOW_MINUTES = 15
const DELAY_ON_THROTTLE_MS = 5_000

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function getIpHash(): Promise<string> {
  const h = await headers()
  const forwarded = h.get('x-forwarded-for') ?? ''
  const ip = forwarded.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown'
  return hash(ip)
}

/**
 * Los intentos fallidos recientes de esa IP, o `null` si no se pudieron contar. Censo C (2026-11-26): antes,
 * `count ?? 0` apagaba el freno contra la fuerza bruta cuando la lectura fallaba. Sin contar, no se deja
 * entrar (quien llama lo dice); no cuesta un inicio de sesión que hoy funcione: la tabla vive en la misma
 * base que GoTrue, y sin ella tampoco entraría.
 */
async function recentFailedAttempts(ipHash: string): Promise<number | null> {
  const service = createServiceRoleClient()
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString()
  const { count, error } = await service
    .from('auth_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .eq('success', false)
    .gte('created_at', since)
  if (error || count === null) return null
  return count
}

async function recordAttempt(ipHash: string, emailHash: string, success: boolean): Promise<void> {
  const service = createServiceRoleClient()
  const { error } = await service
    .from('auth_attempts')
    .insert({ ip_hash: ipHash, email_hash: emailHash, success })
  // El intento ya ocurrió: si no se apunta, el freno cuenta uno menos. No para; a Sentry.
  if (error) escrituraSecundariaFallida('auth_attempts insert', error)
}

export async function signIn(
  input: SignInInput
): Promise<ActionResult<{ userId: string; esSuperusuario: boolean }>> {
  const parsed = signInSchema.safeParse(input)
  if (!parsed.success) return fail('auth.validation.invalid')

  const ipHash = await getIpHash()
  const emailHash = hash(parsed.data.email.toLowerCase())

  const failed = await recentFailedAttempts(ipHash)
  // Sin contar los intentos, el freno no se apaga: no se entra, y se dice.
  if (failed === null) return fail('common.lectura_fallida')
  if (failed >= MAX_FAILED_ATTEMPTS) {
    await new Promise((r) => setTimeout(r, DELAY_ON_THROTTLE_MS))
    return fail('auth.login.errors.too_many_attempts')
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  await recordAttempt(ipHash, emailHash, !error && !!data.user)

  if (error || !data.user) {
    return fail('auth.login.errors.invalid_credentials')
  }

  // El superusuario entra al panel de plataforma (Fase 5), no al selector de centro: desde el panel
  // elige centro, y esa entrada se audita. Un fallo de la consulta cuenta como «no».
  return ok({ userId: data.user.id, esSuperusuario: await esSuperusuario(supabase) })
}
