'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { plantillaMenuActualizarSchema, type PlantillaMenuActualizarInput } from '../schemas/menu'
import { fail, ok, type ActionResult } from '../types'

/**
 * Actualiza la cabecera de una plantilla (nombre y vigencia). El estado
 * se cambia con `publicar-plantilla` / `archivar-plantilla`. RLS exige
 * admin del centro de la plantilla.
 */
export async function actualizarPlantilla(
  input: PlantillaMenuActualizarInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = plantillaMenuActualizarSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'menus.errors.guardar_fallo')
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('plantillas_menu')
    .update({
      nombre: parsed.data.nombre.trim(),
      vigente_desde: parsed.data.vigente_desde,
      vigente_hasta: parsed.data.vigente_hasta,
    })
    .eq('id', parsed.data.id)
    .select('id')
    .single()

  if (error || !data) {
    logger.warn('actualizarPlantilla failed', error?.message)
    if (error?.code === '42501' || error?.message.includes('row-level security')) {
      return fail('menus.errors.sin_permiso')
    }
    return fail('menus.errors.guardar_fallo')
  }

  revalidatePath('/[locale]/admin/menus', 'page')
  revalidatePath('/[locale]/admin/menus/[id]', 'page')
  return ok({ id: data.id })
}
