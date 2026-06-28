import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

export interface ConceptoAsignable {
  id: string
  nombre: string
  tipo_concepto: Database['public']['Enums']['tipo_concepto']
}

// Conceptos a los que se les puede fijar modalidad mensual|diario por niño/mes:
// activos y de tipo mensual o diario (los esporádicos se cobran como recibos manuales).
export async function getConceptosAsignables(centroId: string): Promise<ConceptoAsignable[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('conceptos_cobro')
    .select('id, nombre, tipo_concepto')
    .eq('centro_id', centroId)
    .eq('activo', true)
    .is('deleted_at', null)
    .in('tipo_concepto', ['mensual', 'diario'])

  return (data ?? []).sort((a, b) => a.nombre.localeCompare(b.nombre))
}
