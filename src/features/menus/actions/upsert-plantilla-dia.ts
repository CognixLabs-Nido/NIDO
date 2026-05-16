'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { plantillaMenuDiaSchema, type PlantillaMenuDiaInput } from '../schemas/menu'
import { fail, ok, type ActionResult } from '../types'

/**
 * Upsert idempotente del menú de un día concreto de una plantilla.
 * UNIQUE (plantilla_id, dia_semana) garantiza que sigue habiendo una
 * sola fila por día. RLS exige admin del centro de la plantilla.
 */
export async function upsertPlantillaDia(
  input: PlantillaMenuDiaInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = plantillaMenuDiaSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'menus.errors.guardar_fallo')
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('plantilla_menu_dia')
    .upsert(
      {
        plantilla_id: parsed.data.plantilla_id,
        dia_semana: parsed.data.dia_semana,
        desayuno: parsed.data.desayuno,
        media_manana: parsed.data.media_manana,
        comida: parsed.data.comida,
        merienda: parsed.data.merienda,
      },
      { onConflict: 'plantilla_id,dia_semana' }
    )
    .select('id')
    .single()

  if (error || !data) {
    logger.warn('upsertPlantillaDia failed', error?.message)
    if (error?.code === '42501' || error?.message.includes('row-level security')) {
      return fail('menus.errors.sin_permiso')
    }
    return fail('menus.errors.guardar_fallo')
  }

  revalidatePath('/[locale]/admin/menus/[id]', 'page')
  return ok({ id: data.id })
}
