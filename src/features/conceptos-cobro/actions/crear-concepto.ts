'use server'

import { revalidatePath } from 'next/cache'

import { usuarioResponsableEn } from '@/features/centros/contexto/roles-del-usuario'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { buildConceptoRow } from '../lib/build-concepto-row'
import { conceptoCobroSchema, type ConceptoCobroInput } from '../schemas/concepto-cobro'

export async function crearConcepto(
  centroId: string,
  input: ConceptoCobroInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = conceptoCobroSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'conceptos_cobro.validation.invalid')
  }

  const supabase = await createClient()
  // Las cuotas son de la admin del centro, no de una directora (la RLS lo vuelve a comprobar).
  if (!(await usuarioResponsableEn(supabase, centroId)))
    return fail('conceptos_cobro.errors.no_autorizado')
  const { data, error } = await supabase
    .from('conceptos_cobro')
    .insert({ centro_id: centroId, ...buildConceptoRow(parsed.data) })
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
