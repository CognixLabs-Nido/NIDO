'use server'

import { revalidatePath } from 'next/cache'

import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { eurosACentimos } from '@/shared/lib/format-money'
import { logger } from '@/shared/lib/logger'

import { conceptoCobroSchema, type ConceptoCobroInput } from '../schemas/concepto-cobro'

export async function crearConcepto(
  centroId: string,
  input: ConceptoCobroInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = conceptoCobroSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'conceptos_cobro.validation.invalid')
  }

  const tipo = parsed.data.tipo_concepto
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('conceptos_cobro')
    .insert({
      centro_id: centroId,
      nombre: parsed.data.nombre,
      tipo_concepto: tipo,
      // mensual/esporádico → solo precio mensual; diario → precio diario + servicio (mensual opcional).
      precio_mensual_centimos:
        parsed.data.precio_mensual_euros != null
          ? eurosACentimos(parsed.data.precio_mensual_euros)
          : null,
      precio_diario_centimos:
        tipo === 'diario' && parsed.data.precio_diario_euros != null
          ? eurosACentimos(parsed.data.precio_diario_euros)
          : null,
      servicio: tipo === 'diario' ? parsed.data.servicio : null,
      activo: parsed.data.activo,
    })
    .select('id')
    .single()

  if (error || !data) {
    logger.warn('crearConcepto error', error?.message)
    if (error?.code === '23505') return fail('conceptos_cobro.errors.nombre_duplicado')
    if (error?.code === '42501') return fail('conceptos_cobro.errors.no_autorizado')
    return fail('conceptos_cobro.errors.create_failed')
  }

  revalidatePath('/[locale]/admin/cuotas', 'page')
  return ok({ id: data.id })
}
