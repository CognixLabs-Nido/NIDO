'use server'

import { revalidatePath } from 'next/cache'

import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { eurosACentimos } from '@/shared/lib/format-money'
import { logger } from '@/shared/lib/logger'

import { conceptoCobroSchema, type ConceptoCobroInput } from '../schemas/concepto-cobro'

export async function actualizarConcepto(
  id: string,
  input: ConceptoCobroInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = conceptoCobroSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'conceptos_cobro.validation.invalid')
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('conceptos_cobro')
    .update({
      nombre: parsed.data.nombre,
      tipo_concepto: parsed.data.tipo_concepto,
      precio_centimos: eurosACentimos(parsed.data.precio_euros),
      activo: parsed.data.activo,
    })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('actualizarConcepto error', error.message)
    if (error.code === '23505') return fail('conceptos_cobro.errors.nombre_duplicado')
    if (error.code === '42501') return fail('conceptos_cobro.errors.no_autorizado')
    return fail('conceptos_cobro.errors.update_failed')
  }
  // RLS USING falso (no es admin del centro) o ya borrado → 0 filas, sin error.
  if (!data) return fail('conceptos_cobro.errors.no_encontrado')

  revalidatePath('/[locale]/admin/cuotas', 'page')
  return ok({ id: data.id })
}
