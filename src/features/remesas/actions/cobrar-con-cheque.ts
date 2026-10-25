'use server'

import { revalidatePath } from 'next/cache'

import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'
import { usuarioAdminEn } from '@/features/centros/contexto/roles-del-usuario'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { eurosACentimos } from '@/shared/lib/format-money'
import { logger } from '@/shared/lib/logger'

import { cobrarConChequeSchema, type CobrarConChequeInput } from '../schemas/remesa'

// El HINT de cada RAISE de `cobrar_recibo_con_cheque` (y del trigger de la transición), a su clave.
const POR_HINT: Record<string, string> = {
  no_encontrado: 'remesas.errors.no_encontrada',
  sepa_por_remesa: 'remesas.errors.sepa_por_remesa',
  no_cobrable_manual: 'remesas.errors.no_cobrable_manual',
  recibo_sin_importe: 'remesas.errors.recibo_sin_importe',
  sin_mandato: 'remesas.errors.sin_mandato_diferencia',
  falta_metodo_diferencia: 'remesas.validation.falta_metodo_diferencia',
  importe_cheque_invalido: 'remesas.validation.importe_cheque_invalido',
  fecha_cobro_invalida: 'remesas.validation.fecha_cobro_invalida',
  // PR-2: un devuelto tiene una sola salida, y no es el cheque.
  devolucion_por_funcion: 'remesas.errors.devolucion_por_resolver',
}

/**
 * Cobra un recibo con cheque guardería / ticket restaurant (PR-1b). La directora introduce el
 * importe del cheque: si cubre el recibo, queda cobrado; si es menor, la diferencia va a un recibo
 * esporádico aparte del mismo periodo, por SEPA (con mandato activo), efectivo o transferencia,
 * que sigue su circuito normal. Las dos escrituras van juntas en la BD
 * (`cobrar_recibo_con_cheque`, con la sesión: RLS de Dirección y actor en audit_log), que repite
 * todas las reglas. Si es mayor, el recibo queda cobrado y el sobrante pendiente: la directora
 * elige después si lo difiere al mes siguiente o lo devuelve por transferencia (PR-1c).
 */
export async function cobrarConCheque(
  input: CobrarConChequeInput
): Promise<ActionResult<{ diferenciaId: string | null }>> {
  const parsed = cobrarConChequeSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'remesas.errors.invalid')
  const { reciboId, importe_euros, fecha, nota, metodoDiferencia } = parsed.data
  if (fecha > hoyMadrid()) return fail('remesas.validation.fecha_cobro_futura')

  const supabase = await createClient()

  const { data: recibo } = await supabase
    .from('recibos')
    .select('id, centro_id')
    .eq('id', reciboId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!recibo) return fail('remesas.errors.no_encontrada')
  // Centro DEL REGISTRO (multicentro · Fase 1): admin en él, no en el centro activo.
  if (!(await usuarioAdminEn(supabase, recibo.centro_id)))
    return fail('remesas.errors.no_autorizado')

  const { data, error } = await supabase.rpc('cobrar_recibo_con_cheque', {
    p_recibo_id: recibo.id,
    p_importe_centimos: eurosACentimos(importe_euros),
    p_fecha: fecha,
    // Los argumentos opcionales de la RPC aceptan NULL; el generador de tipos emite `string`.
    p_nota: (nota ? nota : null) as string,
    p_metodo_diferencia: (metodoDiferencia ?? null) as string,
  })

  if (error) {
    logger.warn('cobrarConCheque error', error.message)
    if (error.code === '42501') return fail('remesas.errors.no_autorizado')
    const clave = error.hint ? POR_HINT[error.hint] : undefined
    return fail(clave ?? 'remesas.errors.cobrar_manual_failed')
  }

  revalidatePath('/[locale]/admin/cuotas', 'page')
  return ok({ diferenciaId: data ?? null })
}
