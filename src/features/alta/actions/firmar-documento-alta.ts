'use server'

import { getRequestContext } from '@/features/autorizaciones/lib/request-context'
import { createClient } from '@/lib/supabase/server'

import { firmarDocumentoAlta } from '../lib/documentos-alta'

type Result = { success: true; data: { firmaId: string } } | { success: false; error: string }

/**
 * Firma un documento del centro desde el alta (fase 4, 4b-1): la familia con el dedo, o la
 * Dirección en persona en el modo Dirección. El modo lo decide el servidor (`firmarDocumentoAlta`).
 */
export async function firmarDocumentoAltaAction(input: unknown): Promise<Result> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'alta.documentos_centro.errors.no_autorizado' }
  const r = await firmarDocumentoAlta(supabase, user.id, input, await getRequestContext())
  return r.ok
    ? { success: true, data: { firmaId: r.data.firmaId } }
    : { success: false, error: r.error }
}
