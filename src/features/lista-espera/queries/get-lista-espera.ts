import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

export interface ProspectoListItem {
  id: string
  nombre_nino: string
  apellidos_nino: string | null
  fecha_nacimiento: string | null
  telefono_tutor: string | null
  email_tutor: string | null
  nota: string | null
  posicion: number
  estado: Database['public']['Enums']['estado_lista_espera']
}

/**
 * F11-H-3: prospectos de la lista de espera de un curso, ordenados por `posicion`.
 * Excluye los `descartado` (baja blanda). RLS limita a admin del centro.
 */
export async function getListaEspera(cursoAcademicoId: string): Promise<ProspectoListItem[]> {
  const supabase = await createClient()
  return getListaEsperaCore(supabase, cursoAcademicoId)
}

/** Núcleo testeable (cliente inyectable). */
export async function getListaEsperaCore(
  supabase: SupabaseClient<Database>,
  cursoAcademicoId: string
): Promise<ProspectoListItem[]> {
  const { data } = await supabase
    .from('lista_espera')
    .select(
      'id, nombre_nino, apellidos_nino, fecha_nacimiento, telefono_tutor, email_tutor, nota, posicion, estado'
    )
    .eq('curso_academico_id', cursoAcademicoId)
    .neq('estado', 'descartado')
    .order('posicion', { ascending: true })

  return (data ?? []) as ProspectoListItem[]
}
