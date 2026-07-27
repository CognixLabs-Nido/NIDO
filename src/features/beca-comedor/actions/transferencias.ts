'use server'

import { revalidatePath } from 'next/cache'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { marcarTransferenciaSchema, type MarcarTransferenciaInput } from '../schemas/beca-comedor'

const RUTA = '/[locale]/admin/cuotas'
const ERR = 'admin.cuotas.beca_comedor.transferencias.errors'

/**
 * V2-5 — Marca una transferencia de beca comedor como REALIZADA (se hizo el pago por banco).
 * Solo pendiente→realizada; sella realizada_por/at. `.select().maybeSingle()` para detectar
 * que la RLS/USING no tocó filas (ya realizada o de otro centro). RLS admin del centro.
 */
export async function marcarTransferenciaRealizada(
  input: MarcarTransferenciaInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = marcarTransferenciaSchema.safeParse(input)
  if (!parsed.success) return fail(`${ERR}.invalid`)

  const centroId = await getCentroActualId()
  if (!centroId) return fail(`${ERR}.no_autorizado`)

  const supabase = await createClient()
  const { data: authData } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('beca_comedor_transferencia')
    .update({
      estado: 'realizada',
      realizada_por: authData.user?.id ?? null,
      realizada_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.id)
    .eq('centro_id', centroId)
    .eq('estado', 'pendiente')
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('marcarTransferenciaRealizada', error.message)
    if (error.code === '42501') return fail(`${ERR}.no_autorizado`)
    return fail(`${ERR}.save_failed`)
  }
  if (!data) return fail(`${ERR}.no_pendiente`) // USING falso → 0 filas

  revalidatePath(RUTA, 'page')
  return ok({ id: data.id })
}
