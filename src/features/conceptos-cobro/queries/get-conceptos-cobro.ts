import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

export interface ConceptoCobroListItem {
  id: string
  nombre: string
  tipo_concepto: Database['public']['Enums']['tipo_concepto']
  precio_centimos: number
  activo: boolean
}

// Orden de presentación por tipo (mensual → diario → esporádico), luego alfabético.
const ORDEN_TIPO: Record<Database['public']['Enums']['tipo_concepto'], number> = {
  mensual: 0,
  diario: 1,
  esporadico: 2,
}

export async function getConceptosCobro(centroId: string): Promise<ConceptoCobroListItem[]> {
  const supabase = await createClient()
  return getConceptosCobroCore(supabase, centroId)
}

// Versión testeable (cliente inyectable). Excluye soft-deleted (deleted_at IS NULL).
export async function getConceptosCobroCore(
  supabase: SupabaseClient<Database>,
  centroId: string
): Promise<ConceptoCobroListItem[]> {
  const { data } = await supabase
    .from('conceptos_cobro')
    .select('id, nombre, tipo_concepto, precio_centimos, activo')
    .eq('centro_id', centroId)
    .is('deleted_at', null)

  return (data ?? []).sort(
    (a, b) =>
      ORDEN_TIPO[a.tipo_concepto] - ORDEN_TIPO[b.tipo_concepto] || a.nombre.localeCompare(b.nombre)
  )
}
