'use server'

import { revalidatePath } from 'next/cache'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { eurosACentimos } from '@/shared/lib/format-money'
import { logger } from '@/shared/lib/logger'

import { reciboEsporadicoSchema, type ReciboEsporadicoInput } from '../schemas/cierre'

/**
 * Crea un recibo esporádico (uniforme, excursión…) con sus líneas vía la RPC
 * `crear_recibo_esporadico`, fuera del cierre. Permitido aunque el mes esté cerrado
 * (los esporádicos están exentos del congelado). Solo admin (la RPC lo verifica).
 */
export async function crearReciboEsporadico(
  input: ReciboEsporadicoInput
): Promise<ActionResult<{ reciboId: string }>> {
  const parsed = reciboEsporadicoSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'cierre_cobros.errors.invalid')
  }

  const centroId = await getCentroActualId()
  if (!centroId) return fail('cierre_cobros.errors.no_autorizado')

  // Record<string, …> es asignable al tipo Json del parámetro jsonb de la RPC.
  const lineas: Array<Record<string, string | number>> = parsed.data.lineas.map((l) => ({
    descripcion: l.descripcion,
    cantidad: l.cantidad,
    precio_unitario_centimos: eurosACentimos(l.importe_euros),
  }))

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('crear_recibo_esporadico', {
    p_centro_id: centroId,
    p_nino_id: parsed.data.ninoId,
    p_anio: parsed.data.anio,
    p_mes: parsed.data.mes,
    p_concepto: parsed.data.concepto,
    // `as string`: el generador de tipos de Supabase NO expresa la nulabilidad de los
    // argumentos de RPC (Postgres no reporta si un parámetro admite NULL), así que emite
    // `p_metodo: string`. El runtime SÍ acepta null a propósito (la función SQL declara
    // `p_metodo text` sin NOT NULL). El cast solo compensa esa limitación del generador:
    // NO lo elimines ni lo "arregles" — sin él, cada regeneración de database.ts rompe el
    // typecheck. Ver PR de resync de database.ts.
    p_metodo: parsed.data.metodo as string,
    p_lineas: lineas,
  })

  if (error || !data) {
    logger.warn('crearReciboEsporadico error', error?.message)
    if (error?.code === '42501') return fail('cierre_cobros.errors.no_autorizado')
    return fail('cierre_cobros.errors.esporadico_failed')
  }

  revalidatePath('/[locale]/admin/cuotas', 'page')
  return ok({ reciboId: data })
}
