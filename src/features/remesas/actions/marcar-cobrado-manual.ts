'use server'

import { revalidatePath } from 'next/cache'

import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'
import { usuarioAdminEn } from '@/features/centros/contexto/roles-del-usuario'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { marcarCobradoManualSchema, type MarcarCobradoManualInput } from '../schemas/remesa'

/**
 * Marca un recibo como 'cobrado_manual' (cobrado en efectivo o por transferencia, fuera de SEPA),
 * con la forma, la fecha y una nota opcional (PR-1a). Vale para un recibo 'pendiente_procesar'
 * que no sea SEPA (un SEPA pendiente va por remesa); el método NO se toca (sigue congelado). Un
 * 'devuelto' no se cobra aquí: tiene una sola salida y va por `resolverDevolucion` (PR-2). La BD
 * repite las reglas (`recibos_validar_cobro_manual` y `recibos_validar_devolucion`). Dirección
 * (RLS). El cheque guardería / ticket restaurant pide su importe y va por `cobrarConCheque` (PR-1b).
 */
export async function marcarCobradoManual(
  input: MarcarCobradoManualInput
): Promise<ActionResult<null>> {
  const parsed = marcarCobradoManualSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'remesas.errors.invalid')
  const { reciboId, forma, fecha, nota } = parsed.data
  if (fecha > hoyMadrid()) return fail('remesas.validation.fecha_cobro_futura')

  const supabase = await createClient()

  const { data: recibo } = await supabase
    .from('recibos')
    .select('id, centro_id, estado, metodo')
    .eq('id', reciboId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!recibo) return fail('remesas.errors.no_encontrada')
  // Centro DEL REGISTRO (multicentro · Fase 1): admin en él, no en el centro activo.
  if (!(await usuarioAdminEn(supabase, recibo.centro_id)))
    return fail('remesas.errors.no_autorizado')
  if (recibo.estado === 'pendiente_procesar' && recibo.metodo === 'sepa') {
    return fail('remesas.errors.sepa_por_remesa')
  }
  if (recibo.estado === 'devuelto') return fail('remesas.errors.devolucion_por_resolver')
  if (recibo.estado !== 'pendiente_procesar') return fail('remesas.errors.no_cobrable_manual')

  const { data: actualizado, error } = await supabase
    .from('recibos')
    .update({
      estado: 'cobrado_manual',
      cobro_forma: forma,
      cobro_fecha: fecha,
      cobro_nota: nota ? nota : null,
    })
    .eq('id', recibo.id)
    .eq('estado', 'pendiente_procesar')
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('marcarCobradoManual error', error.message)
    if (error.code === '42501') return fail('remesas.errors.no_autorizado')
    if (error.hint === 'sepa_por_remesa') return fail('remesas.errors.sepa_por_remesa')
    if (error.hint === 'no_cobrable_manual') return fail('remesas.errors.no_cobrable_manual')
    if (error.hint === 'devolucion_por_funcion')
      return fail('remesas.errors.devolucion_por_resolver')
    return fail('remesas.errors.cobrar_manual_failed')
  }
  if (!actualizado) return fail('remesas.errors.no_cobrable_manual')

  revalidatePath('/[locale]/admin/cuotas', 'page')
  return ok(null)
}
