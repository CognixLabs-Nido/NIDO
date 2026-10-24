'use server'

import { revalidatePath } from 'next/cache'

import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'
import { usuarioAdminEn } from '@/features/centros/contexto/roles-del-usuario'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import {
  resolverDevolucionSchema,
  salidaConCobro,
  type ResolverDevolucionInput,
} from '../schemas/remesa'

// El HINT de cada RAISE de `resolver_devolucion` (y del trigger de la devolución), a su clave.
const POR_HINT: Record<string, string> = {
  no_encontrado: 'remesas.errors.no_encontrada',
  devolucion_ya_resuelta: 'remesas.errors.devolucion_ya_resuelta',
  no_devuelto: 'remesas.errors.no_devuelto',
  sin_mandato: 'remesas.errors.sin_mandato_devolucion',
  salida_invalida: 'remesas.errors.invalid',
  fecha_cobro_invalida: 'remesas.validation.fecha_cobro_devolucion',
  sin_recibo_siguiente: 'remesas.errors.sin_recibo_siguiente',
}

/**
 * Resuelve una devolución, UNA sola vez (PR-2): volver a pasarla por el banco (un re-giro SEPA por
 * total + gastos, solo con mandato activo), cobrarla en efectivo o por transferencia (el recibo
 * queda cobrado y conserva sus fechas de banco) o arrastrarla al siguiente recibo en borrador de la
 * familia, como una línea por total + gastos (PR-14). Lo hace la BD en una transacción
 * (`resolver_devolucion`, con la sesión: RLS de Dirección y actor en audit_log), que bloquea el
 * recibo y rechaza una segunda salida por cualquier camino. Devuelve el recibo nuevo o tocado: el
 * re-giro o el recibo al que se arrastra.
 */
export async function resolverDevolucion(
  input: ResolverDevolucionInput
): Promise<ActionResult<{ reciboId: string | null }>> {
  const parsed = resolverDevolucionSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'remesas.errors.invalid')
  const { reciboId, salida, fecha, nota } = parsed.data
  const conCobro = salidaConCobro(salida)
  if (conCobro && fecha && fecha > hoyMadrid()) {
    return fail('remesas.validation.fecha_cobro_futura')
  }

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

  const { data, error } = await supabase.rpc('resolver_devolucion', {
    p_recibo_id: recibo.id,
    p_salida: salida,
    // Los argumentos opcionales de la RPC aceptan NULL; el generador de tipos emite `string`.
    p_fecha: (conCobro ? fecha : null) as string,
    p_nota: (conCobro && nota ? nota : null) as string,
  })

  if (error) {
    logger.warn('resolverDevolucion error', error.message)
    if (error.code === '42501') return fail('remesas.errors.no_autorizado')
    const clave = error.hint ? POR_HINT[error.hint] : undefined
    return fail(clave ?? 'remesas.errors.resolver_failed')
  }

  revalidatePath('/[locale]/admin/cuotas', 'page')
  return ok({ reciboId: data ?? null })
}
