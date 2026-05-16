import 'server-only'

import { createClient } from '@/lib/supabase/server'

import type { PlantillaMenuRow } from '../types'

/**
 * Lista todas las plantillas vivas del centro al que el usuario tiene
 * acceso vía RLS. Orden: publicada primero, luego borradores recientes,
 * luego archivadas. Útil para `/admin/menus`.
 */
export async function getPlantillasCentro(): Promise<PlantillaMenuRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('plantillas_menu')
    .select(
      'id, centro_id, nombre, estado, vigente_desde, vigente_hasta, creada_por, created_at, updated_at'
    )
    .is('deleted_at', null)
    .order('estado', { ascending: true })
    .order('updated_at', { ascending: false })
  return (data ?? []) as PlantillaMenuRow[]
}

export async function getPlantillaPublicada(): Promise<PlantillaMenuRow | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('plantillas_menu')
    .select(
      'id, centro_id, nombre, estado, vigente_desde, vigente_hasta, creada_por, created_at, updated_at'
    )
    .eq('estado', 'publicada')
    .is('deleted_at', null)
    .maybeSingle()
  return (data as PlantillaMenuRow | null) ?? null
}
