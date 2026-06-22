import 'server-only'

import { createClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

/**
 * ⚠️ CLIENTE SERVICE-ROLE — BYPASSA TODA LA RLS. ⚠️
 *
 * NO está ligado a cookies ni a la sesión del usuario (a diferencia de `createClient`
 * de `./server`): usa la SERVICE_ROLE key y un cliente PLANO de supabase-js, SIN
 * cookies. En la BD `auth.uid()` es NULL y NINGUNA policy RLS aplica.
 *
 * USO PERMITIDO: SOLO elevación POST-autorización — cuando el código YA verificó el
 * permiso del usuario con el cliente de sesión (`createClient` de `./server`) y
 * necesita una operación concreta que la RLS bloquea: firmar/subir/borrar objetos de
 * Storage, resolver audiencia cross-user, escribir un log que el usuario no puede
 * tocar, o rollback de filas con DELETE en default-DENY.
 *
 * JAMÁS para autorización por-usuario: este cliente NO decide quién ve qué. Si lo usas
 * para leer el dato PRINCIPAL de una petición, te saltas la RLS EN SILENCIO.
 *
 * Este es el ÚNICO módulo autorizado a tocar `SUPABASE_SERVICE_ROLE_KEY` (lint-guard
 * en `eslint.config.mjs`). Sustituye al antiguo `createServiceClient` cookie-bound
 * (footgun: tenía la misma forma que el cliente de sesión — F11-D fase 2).
 */
export function createServiceRoleClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}
