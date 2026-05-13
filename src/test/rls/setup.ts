import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

import type { Database } from '@/types/database'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_ANON || !SUPABASE_SERVICE) {
  throw new Error(
    'Tests RLS requieren NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY en .env.local'
  )
}

export const serviceClient: SupabaseClient<Database> = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_SERVICE,
  { auth: { persistSession: false, autoRefreshToken: false } }
)

export function anonClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL!, SUPABASE_ANON!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export interface TestUser {
  id: string
  email: string
  password: string
}

export async function createTestUser(opts?: { nombre?: string }): Promise<TestUser> {
  const email = `rls-${randomUUID()}@nido.test`
  const password = 'Rls-Test-Pass-2026!'
  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nombre_completo: opts?.nombre ?? 'Test Pruebas' },
  })
  if (error || !data.user) {
    throw new Error(`createTestUser falló: ${error?.message}`)
  }
  return { id: data.user.id, email, password }
}

export async function clientFor(user: TestUser): Promise<SupabaseClient<Database>> {
  const c = anonClient()
  const { error } = await c.auth.signInWithPassword({ email: user.email, password: user.password })
  if (error) throw new Error(`signIn falló: ${error.message}`)
  return c
}

export async function deleteTestUser(userId: string): Promise<void> {
  await serviceClient.auth.admin.deleteUser(userId).catch(() => {
    /* ignore */
  })
}

export function fakeCentroId(): string {
  return randomUUID()
}
