'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { cambioAulaSchema, type CambioAulaInput } from '../schemas/matricula'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * B13: cierra la matrícula actual con fecha_baja + motivo, y crea una nueva
 * matrícula en la nueva aula con fecha_alta = fecha_baja.
 */
export async function cambiarAula(input: CambioAulaInput): Promise<ActionResult<{ id: string }>> {
  const parsed = cambioAulaSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'matricula.validation.invalid')
  }

  const supabase = await createClient()

  const { data: actual, error: lookupErr } = await supabase
    .from('matriculas')
    .select('id, nino_id, aula_id, curso_academico_id, fecha_baja')
    .eq('id', parsed.data.matricula_actual_id)
    .maybeSingle()

  if (lookupErr || !actual) {
    logger.warn('cambiarAula lookup', lookupErr?.message)
    return fail('matricula.errors.no_encontrada')
  }
  if (actual.fecha_baja) {
    return fail('matricula.errors.ya_dada_de_baja')
  }
  if (actual.aula_id === parsed.data.nueva_aula_id) {
    return fail('matricula.errors.misma_aula')
  }

  // 1) Cerrar la matrícula actual.
  const { error: cerrarErr } = await supabase
    .from('matriculas')
    .update({ fecha_baja: parsed.data.fecha_baja, motivo_baja: parsed.data.motivo_baja ?? null })
    .eq('id', actual.id)
  if (cerrarErr) {
    logger.warn('cambiarAula cerrar', cerrarErr.message)
    return fail('matricula.errors.update_failed')
  }

  // 2) Abrir nueva matrícula.
  const { data: nueva, error: abrirErr } = await supabase
    .from('matriculas')
    .insert({
      nino_id: actual.nino_id,
      aula_id: parsed.data.nueva_aula_id,
      curso_academico_id: actual.curso_academico_id,
      fecha_alta: parsed.data.fecha_baja,
    })
    .select('id')
    .single()
  if (abrirErr || !nueva) {
    logger.warn('cambiarAula abrir nueva', abrirErr?.message)
    return fail('matricula.errors.create_failed')
  }

  revalidatePath('/[locale]/admin/ninos', 'page')
  return ok({ id: nueva.id })
}
