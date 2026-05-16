'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { crearPlantillaMensualSchema, type CrearPlantillaMensualInput } from '../schemas/menu'
import { fail, ok, type ActionResult } from '../types'

/**
 * Crea una plantilla mensual en estado `borrador`. Si ya existe un
 * borrador para (centro, mes, anio), devuelve la existente (idempotente).
 *
 * Si existe una `publicada` o `archivada` para esa combinación, el
 * INSERT no choca con el índice único parcial (que solo cubre estado
 * `publicada`) — admin puede tener múltiples borradores históricos.
 */
export async function crearPlantillaMensual(
  input: CrearPlantillaMensualInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = crearPlantillaMensualSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'menus.toasts.error_guardar')
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id ?? null

  // Idempotencia: si ya hay un borrador, devolverlo.
  const { data: existente } = await supabase
    .from('plantillas_menu_mensual')
    .select('id')
    .eq('centro_id', parsed.data.centro_id)
    .eq('mes', parsed.data.mes)
    .eq('anio', parsed.data.anio)
    .eq('estado', 'borrador')
    .is('deleted_at', null)
    .maybeSingle()

  if (existente?.id) {
    return ok({ id: existente.id })
  }

  const { data, error } = await supabase
    .from('plantillas_menu_mensual')
    .insert({
      centro_id: parsed.data.centro_id,
      mes: parsed.data.mes,
      anio: parsed.data.anio,
      estado: 'borrador',
      creada_por: userId,
    })
    .select('id')
    .single()

  if (error || !data) {
    logger.warn('crearPlantillaMensual failed', error?.message)
    return fail('menus.toasts.error_guardar')
  }

  revalidatePath('/[locale]/admin/menus', 'page')
  return ok({ id: data.id })
}
