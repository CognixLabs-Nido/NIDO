'use server'

import { revalidatePath } from 'next/cache'

import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { tipoBecaSchema, type TipoBecaInput } from '../schemas/tipo-beca'

const RUTA = '/[locale]/admin/cuotas'

export async function crearTipoBeca(
  centroId: string,
  input: TipoBecaInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = tipoBecaSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'becas.validation.invalid')
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tipos_beca')
    .insert({ centro_id: centroId, nombre: parsed.data.nombre, activo: parsed.data.activo })
    .select('id')
    .single()

  if (error || !data) {
    logger.warn('crearTipoBeca error', error?.message)
    if (error?.code === '23505') return fail('becas.errors.tipo_duplicado')
    if (error?.code === '42501') return fail('becas.errors.no_autorizado')
    return fail('becas.errors.tipo_create_failed')
  }

  revalidatePath(RUTA, 'page')
  return ok({ id: data.id })
}

export async function actualizarTipoBeca(
  id: string,
  input: TipoBecaInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = tipoBecaSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'becas.validation.invalid')
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tipos_beca')
    .update({ nombre: parsed.data.nombre, activo: parsed.data.activo })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('actualizarTipoBeca error', error.message)
    if (error.code === '23505') return fail('becas.errors.tipo_duplicado')
    if (error.code === '42501') return fail('becas.errors.no_autorizado')
    return fail('becas.errors.tipo_update_failed')
  }
  if (!data) return fail('becas.errors.tipo_no_encontrado')

  revalidatePath(RUTA, 'page')
  return ok({ id: data.id })
}

export async function eliminarTipoBeca(id: string): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tipos_beca')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('eliminarTipoBeca error', error.message)
    if (error.code === '42501') return fail('becas.errors.no_autorizado')
    return fail('becas.errors.tipo_delete_failed')
  }
  if (!data) return fail('becas.errors.tipo_no_encontrado')

  revalidatePath(RUTA, 'page')
  return ok({ id: data.id })
}
