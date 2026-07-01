'use server'

import { revalidatePath } from 'next/cache'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { eurosACentimos } from '@/shared/lib/format-money'
import { logger } from '@/shared/lib/logger'

import { gastosDevolucionSchema, type GastosDevolucionInput } from '../schemas/remesa'

/**
 * Registra los gastos de devolución que cobra el banco como un recibo ESPORÁDICO
 * ligado al niño del recibo devuelto (reusa la RPC crear_recibo_esporadico de B-4,
 * exenta del congelado). Mismo niño/periodo que el original. Solo admin (RLS).
 */
export async function registrarGastosDevolucion(
  input: GastosDevolucionInput
): Promise<ActionResult<{ reciboId: string }>> {
  const parsed = gastosDevolucionSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'remesas.errors.invalid')
  }

  const centroId = await getCentroActualId()
  if (!centroId) return fail('remesas.errors.no_autorizado')

  const supabase = await createClient()

  const { data: original } = await supabase
    .from('recibos')
    .select('nino_id, anio, mes')
    .eq('id', parsed.data.reciboId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!original) return fail('remesas.errors.no_encontrada')

  const lineas: Array<Record<string, string | number>> = [
    {
      descripcion: 'Gastos de devolución',
      cantidad: 1,
      precio_unitario_centimos: eurosACentimos(parsed.data.importe_euros),
    },
  ]

  const { data, error } = await supabase.rpc('crear_recibo_esporadico', {
    p_centro_id: centroId,
    p_nino_id: original.nino_id,
    p_anio: original.anio,
    p_mes: original.mes,
    p_concepto: 'Gastos de devolución',
    p_metodo: parsed.data.metodo,
    p_lineas: lineas,
  })

  if (error || !data) {
    logger.warn('registrarGastosDevolucion error', error?.message)
    if (error?.code === '42501') return fail('remesas.errors.no_autorizado')
    return fail('remesas.errors.gastos_failed')
  }

  revalidatePath('/[locale]/admin/cuotas', 'page')
  return ok({ reciboId: data })
}
