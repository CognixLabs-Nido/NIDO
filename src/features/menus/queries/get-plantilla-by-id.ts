import 'server-only'

import { createClient } from '@/lib/supabase/server'

import type { DiaSemana } from '../schemas/menu'
import type { PlantillaMenuDiaRow, PlantillaMenuRow } from '../types'

export interface PlantillaConDias {
  plantilla: PlantillaMenuRow
  dias: Partial<Record<DiaSemana, PlantillaMenuDiaRow>>
}

/**
 * Devuelve la plantilla + sus 5 días (los que existan). Si la plantilla
 * no existe o el usuario no la puede ver vía RLS, devuelve null.
 */
export async function getPlantillaById(plantillaId: string): Promise<PlantillaConDias | null> {
  const supabase = await createClient()
  const { data: plantilla } = await supabase
    .from('plantillas_menu')
    .select(
      'id, centro_id, nombre, estado, vigente_desde, vigente_hasta, creada_por, created_at, updated_at'
    )
    .eq('id', plantillaId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!plantilla) return null

  const { data: dias } = await supabase
    .from('plantilla_menu_dia')
    .select('id, plantilla_id, dia_semana, desayuno, media_manana, comida, merienda, updated_at')
    .eq('plantilla_id', plantillaId)

  const map: Partial<Record<DiaSemana, PlantillaMenuDiaRow>> = {}
  for (const d of (dias ?? []) as PlantillaMenuDiaRow[]) {
    map[d.dia_semana] = d
  }

  return {
    plantilla: plantilla as PlantillaMenuRow,
    dias: map,
  }
}
