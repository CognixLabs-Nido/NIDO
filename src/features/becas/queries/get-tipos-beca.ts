import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

export interface TipoBecaListItem {
  id: string
  nombre: string
  activo: boolean
}

export async function getTiposBeca(centroId: string): Promise<TipoBecaListItem[]> {
  const supabase = await createClient()
  return getTiposBecaCore(supabase, centroId)
}

export async function getTiposBecaCore(
  supabase: SupabaseClient<Database>,
  centroId: string
): Promise<TipoBecaListItem[]> {
  const { data } = await supabase
    .from('tipos_beca')
    .select('id, nombre, activo')
    .eq('centro_id', centroId)
    .is('deleted_at', null)

  return (data ?? []).sort((a, b) => a.nombre.localeCompare(b.nombre))
}
