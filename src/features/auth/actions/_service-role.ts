import { createClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

// Cliente con service role para operaciones que requieren bypass de RLS
// (envío de invitaciones, lectura de tokens, rate limiting).
// SOLO se usa desde server actions y nunca se expone al cliente.
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY no configurado')
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
