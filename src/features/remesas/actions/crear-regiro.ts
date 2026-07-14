'use server'

import { revalidatePath } from 'next/cache'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { crearRegiroSchema, type CrearRegiroInput } from '../schemas/remesa'

/**
 * Re-gira el importe de un recibo DEVUELTO: crea un recibo NUEVO (mismo niño/periodo/
 * importe) ligado al original vía devuelto_de_recibo_id, método sepa y estado
 * pendiente_procesar, listo para entrar en una remesa nueva. El recibo con
 * devuelto_de_recibo_id NOT NULL queda exento del congelado y del índice regular único,
 * así que se crea aunque el mes esté cerrado. Solo admin (RLS).
 */
export async function crearRegiro(
  input: CrearRegiroInput
): Promise<ActionResult<{ reciboId: string }>> {
  const parsed = crearRegiroSchema.safeParse(input)
  if (!parsed.success) return fail('remesas.errors.invalid')

  const centroId = await getCentroActualId()
  if (!centroId) return fail('remesas.errors.no_autorizado')

  const supabase = await createClient()

  const { data: original } = await supabase
    .from('recibos')
    .select('id, centro_id, familia_id, nino_id, anio, mes, total_centimos, estado')
    .eq('id', parsed.data.reciboId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!original) return fail('remesas.errors.no_encontrada')
  if (original.estado !== 'devuelto') return fail('remesas.errors.no_regirable')

  // 1. Recibo de re-giro (ligado al original → exento de congelado/unique regular).
  const { data: regiro, error: errRecibo } = await supabase
    .from('recibos')
    .insert({
      centro_id: original.centro_id,
      familia_id: original.familia_id, // F-4-1: el re-giro hereda la familia del original
      nino_id: original.nino_id,
      anio: original.anio,
      mes: original.mes,
      metodo: 'sepa',
      estado: 'pendiente_procesar',
      total_centimos: original.total_centimos,
      es_esporadico: false,
      devuelto_de_recibo_id: original.id,
    })
    .select('id')
    .single()

  if (errRecibo || !regiro) {
    logger.warn('crearRegiro insert recibo error', errRecibo?.message)
    if (errRecibo?.code === '42501') return fail('remesas.errors.no_autorizado')
    return fail('remesas.errors.regiro_failed')
  }

  // 2. Línea única con el importe re-girado.
  const { error: errLinea } = await supabase.from('lineas_recibo').insert({
    centro_id: original.centro_id,
    recibo_id: regiro.id,
    concepto_id: null,
    descripcion: 'Re-giro de recibo devuelto',
    cantidad: 1,
    precio_unitario_centimos: original.total_centimos,
    importe_centimos: original.total_centimos,
  })

  if (errLinea) {
    logger.warn('crearRegiro insert linea error', errLinea.message)
    await supabase
      .from('recibos')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', regiro.id)
    return fail('remesas.errors.regiro_failed')
  }

  revalidatePath('/[locale]/admin/cuotas', 'page')
  return ok({ reciboId: regiro.id })
}
