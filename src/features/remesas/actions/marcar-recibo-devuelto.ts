'use server'

import { revalidatePath } from 'next/cache'

import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'
import { usuarioAdminEn } from '@/features/centros/contexto/roles-del-usuario'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { eurosACentimos } from '@/shared/lib/format-money'
import { logger } from '@/shared/lib/logger'

import { marcarReciboDevueltoSchema, type MarcarReciboDevueltoInput } from '../schemas/remesa'

/**
 * Registra la devolución de un recibo 'enviado_banco' (PR-2): la fecha que dice el banco y los
 * gastos que cobra (0 si no hay), CONSERVANDO fecha_envio_banco (las R-transactions referencian el
 * envío original). Los gastos no se suman al recibo (su total está congelado): van en la
 * devolución, y la salida que se elija después cobra total + gastos (`resolverDevolucion`). Solo
 * cambia estado + datos de la devolución → pasa el congelado aunque el mes esté cerrado. La BD
 * repite las reglas (CHECK de gastos y de fecha tras el envío; trigger: fecha no futura).
 * Dirección (RLS).
 */
export async function marcarReciboDevuelto(
  input: MarcarReciboDevueltoInput
): Promise<ActionResult<null>> {
  const parsed = marcarReciboDevueltoSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'remesas.errors.invalid')
  const { reciboId, fecha, gastos_euros } = parsed.data
  if (fecha > hoyMadrid()) return fail('remesas.validation.fecha_devolucion_futura')

  const supabase = await createClient()

  const { data: recibo } = await supabase
    .from('recibos')
    .select('id, centro_id, estado, fecha_envio_banco')
    .eq('id', reciboId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!recibo) return fail('remesas.errors.no_encontrada')
  // Centro DEL REGISTRO (multicentro · Fase 1): admin en él, no en el centro activo.
  if (!(await usuarioAdminEn(supabase, recibo.centro_id)))
    return fail('remesas.errors.no_autorizado')
  if (recibo.estado !== 'enviado_banco') return fail('remesas.errors.no_devolvible')
  if (recibo.fecha_envio_banco && fecha < recibo.fecha_envio_banco) {
    return fail('remesas.validation.devolucion_antes_del_envio')
  }

  const { data: actualizado, error } = await supabase
    .from('recibos')
    .update({
      estado: 'devuelto',
      fecha_devolucion: fecha,
      devolucion_gastos_centimos: eurosACentimos(gastos_euros),
    })
    .eq('id', recibo.id)
    .eq('estado', 'enviado_banco')
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('marcarReciboDevuelto error', error.message)
    if (error.code === '42501') return fail('remesas.errors.no_autorizado')
    if (error.hint === 'fecha_devolucion_invalida')
      return fail('remesas.validation.fecha_devolucion_futura')
    return fail('remesas.errors.devolver_failed')
  }
  if (!actualizado) return fail('remesas.errors.no_devolvible')

  revalidatePath('/[locale]/admin/cuotas', 'page')
  return ok(null)
}
