'use server'

import { getRequestContext } from '@/features/autorizaciones/lib/request-context'
import { createClient } from '@/lib/supabase/server'

import { firmarDocumentoNino } from '@/features/documentos-centro/lib/firmar-documentos'

type Result = { success: true; data: { firmaId: string } } | { success: false; error: string }

/**
 * Firma un documento del centro, en el alta (4b-1) o en la ficha del niño (4c): la familia con el
 * dedo, o la Dirección en persona. El modo lo decide el servidor (`firmarDocumentoNino`).
 */
export async function firmarDocumentoCentroAction(input: unknown): Promise<Result> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'firmar_documentos.errors.no_autorizado' }
  const r = await firmarDocumentoNino(supabase, user.id, input, await getRequestContext())
  return r.ok
    ? { success: true, data: { firmaId: r.data.firmaId } }
    : { success: false, error: r.error }
}
