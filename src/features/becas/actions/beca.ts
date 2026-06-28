'use server'

import { revalidatePath } from 'next/cache'

import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { eurosACentimos } from '@/shared/lib/format-money'
import { logger } from '@/shared/lib/logger'

import { becaSchema, type BecaInput } from '../schemas/beca'

const RUTA = '/[locale]/admin/cuotas'

export async function crearBeca(
  centroId: string,
  input: BecaInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = becaSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'becas.validation.invalid')
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('becas')
    .insert({
      centro_id: centroId,
      nino_id: parsed.data.nino_id,
      tipo_beca_id: parsed.data.tipo_beca_id,
      importe_centimos: eurosACentimos(parsed.data.importe_euros),
      fecha_desde: parsed.data.fecha_desde,
      fecha_hasta: parsed.data.fecha_hasta || null,
    })
    .select('id')
    .single()

  if (error || !data) {
    logger.warn('crearBeca error', error?.message)
    if (error?.code === '42501') return fail('becas.errors.no_autorizado')
    return fail('becas.errors.create_failed')
  }

  revalidatePath(RUTA, 'page')
  return ok({ id: data.id })
}

export async function actualizarBeca(
  id: string,
  input: BecaInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = becaSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'becas.validation.invalid')
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('becas')
    .update({
      nino_id: parsed.data.nino_id,
      tipo_beca_id: parsed.data.tipo_beca_id,
      importe_centimos: eurosACentimos(parsed.data.importe_euros),
      fecha_desde: parsed.data.fecha_desde,
      fecha_hasta: parsed.data.fecha_hasta || null,
    })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('actualizarBeca error', error.message)
    if (error.code === '42501') return fail('becas.errors.no_autorizado')
    return fail('becas.errors.update_failed')
  }
  if (!data) return fail('becas.errors.no_encontrado')

  revalidatePath(RUTA, 'page')
  return ok({ id: data.id })
}

export async function eliminarBeca(id: string): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('becas')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('eliminarBeca error', error.message)
    if (error.code === '42501') return fail('becas.errors.no_autorizado')
    return fail('becas.errors.delete_failed')
  }
  if (!data) return fail('becas.errors.no_encontrado')

  revalidatePath(RUTA, 'page')
  return ok({ id: data.id })
}
