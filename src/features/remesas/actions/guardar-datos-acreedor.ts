'use server'

import { revalidatePath } from 'next/cache'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { datosAcreedorSchema, type DatosAcreedorInput } from '../schemas/remesa'

/**
 * Guarda la config del acreedor (CID/BIC en claro + IBAN cifrado) vía la RPC
 * admin-only set_datos_acreedor. IBAN vacío = preservar el existente. Solo admin
 * (la RPC lo verifica). El IBAN nunca vuelve legible al cliente.
 */
export async function guardarDatosAcreedor(input: DatosAcreedorInput): Promise<ActionResult<null>> {
  const parsed = datosAcreedorSchema.safeParse(input)
  if (!parsed.success) return fail('remesas.errors.invalid')

  const centroId = await getCentroActualId()
  if (!centroId) return fail('remesas.errors.no_autorizado')

  const supabase = await createClient()
  const { error } = await supabase.rpc('set_datos_acreedor', {
    p_centro_id: centroId,
    p_identificador_acreedor: parsed.data.identificador_acreedor,
    p_bic_acreedor: parsed.data.bic_acreedor,
    p_iban: parsed.data.iban === '' ? null : parsed.data.iban,
  })

  if (error) {
    logger.warn('guardarDatosAcreedor error', error.message)
    if (error.code === '42501') return fail('remesas.errors.no_autorizado')
    return fail('remesas.errors.guardar_acreedor_failed')
  }

  revalidatePath('/[locale]/admin/cuotas', 'page')
  return ok(null)
}
