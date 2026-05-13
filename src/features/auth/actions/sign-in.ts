'use server'

import { createHash } from 'crypto'
import { headers } from 'next/headers'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { signInSchema, type SignInInput } from '../schemas/sign-in'

import { fail, ok, type ActionResult } from './types'
import { createServiceRoleClient } from './_service-role'

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

async function recentFailedAttempts(ipHash: string): Promise<number> {
  const service = createServiceRoleClient()
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString()
  const { count } = await service
    .from('auth_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .eq('success', false)
    .gte('created_at', since)
  return count ?? 0
}

async function recordAttempt(ipHash: string, emailHash: string, success: boolean): Promise<void> {
  const service = createServiceRoleClient()
  const { error } = await service
    .from('auth_attempts')
    .insert({ ip_hash: ipHash, email_hash: emailHash, success })
  if (error) {
    logger.warn('auth_attempts insert failed', error.message)
  }
}

export async function signIn(input: SignInInput): Promise<ActionResult<{ userId: string }>> {
  const parsed = signInSchema.safeParse(input)
  if (!parsed.success) return fail('auth.validation.invalid')

  const ipHash = await getIpHash()
  const emailHash = hash(parsed.data.email.toLowerCase())

  const failed = await recentFailedAttempts(ipHash)
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
  return ok({ userId: data.user.id })
}
