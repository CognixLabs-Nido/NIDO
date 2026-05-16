'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { logger } from '@/shared/lib/logger'

import { plantillaMenuCrearSchema, type PlantillaMenuCrearInput } from '../schemas/menu'
import { fail, ok, type ActionResult } from '../types'

/**
 * Crea una plantilla en estado `borrador`. RLS exige que el usuario sea
 * admin del centro_id objetivo (CHECK del INSERT lo enforza).
 */
export async function crearPlantilla(
  input: PlantillaMenuCrearInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = plantillaMenuCrearSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'menus.errors.guardar_fallo')
  }
  const centroId = await getCentroActualId()
  if (!centroId) return fail('menus.errors.sin_centro')

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id ?? null

  const { data, error } = await supabase
    .from('plantillas_menu')
    .insert({
      centro_id: centroId,
      nombre: parsed.data.nombre.trim(),
      vigente_desde: parsed.data.vigente_desde,
      vigente_hasta: parsed.data.vigente_hasta,
      creada_por: userId,
    })
    .select('id')
    .single()

  if (error || !data) {
    logger.warn('crearPlantilla failed', error?.message)
    if (error?.code === '42501' || error?.message.includes('row-level security')) {
      return fail('menus.errors.sin_permiso')
    }
    return fail('menus.errors.guardar_fallo')
  }

  revalidatePath('/[locale]/admin/menus', 'page')
  return ok({ id: data.id })
}
