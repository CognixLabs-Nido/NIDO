'use server'

import { revalidatePath } from 'next/cache'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { crearRemesaSchema, type CrearRemesaInput } from '../schemas/remesa'

/**
 * Crea una remesa en BORRADOR con los recibos SEPA marcados por la directora y sus
 * enlaces en recibos_remesa. NO genera el XML (eso es bajo demanda, G1). Solo admin
 * (RLS de remesas/recibos_remesa). Puede haber >1 remesa/mes (re-giros).
 */
export async function crearRemesa(
  input: CrearRemesaInput
): Promise<ActionResult<{ remesaId: string }>> {
  const parsed = crearRemesaSchema.safeParse(input)
  if (!parsed.success) return fail('remesas.errors.invalid')

  const centroId = await getCentroActualId()
  if (!centroId) return fail('remesas.errors.no_autorizado')

  const supabase = await createClient()

  const { data: remesa, error: errRemesa } = await supabase
    .from('remesas')
    .insert({
      centro_id: centroId,
      anio: parsed.data.anio,
      mes: parsed.data.mes,
      estado: 'borrador',
    })
    .select('id')
    .single()

  if (errRemesa || !remesa) {
    logger.warn('crearRemesa insert remesa error', errRemesa?.message)
    if (errRemesa?.code === '42501') return fail('remesas.errors.no_autorizado')
    return fail('remesas.errors.crear_failed')
  }

  const enlaces = parsed.data.reciboIds.map((reciboId) => ({
    remesa_id: remesa.id,
    recibo_id: reciboId,
    // centro_id lo deriva el trigger recibos_remesa_set_centro_id.
    centro_id: centroId,
  }))
  const { error: errEnlaces } = await supabase.from('recibos_remesa').insert(enlaces)

  if (errEnlaces) {
    logger.warn('crearRemesa insert enlaces error', errEnlaces.message)
    // Deshacer la remesa huérfana (soft delete) para no dejar borradores vacíos.
    await supabase
      .from('remesas')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', remesa.id)
    return fail('remesas.errors.crear_failed')
  }

  revalidatePath('/[locale]/admin/cuotas', 'page')
  return ok({ remesaId: remesa.id })
}
