import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

export interface ConceptoAsignable {
  id: string
  nombre: string
  tipo_concepto: Database['public']['Enums']['tipo_concepto']
}

// F-4-2: conceptos que la directora puede asignar A MANO a un niño (aplicacion='manual').
// Los conceptos aplicacion='automatico' se siembran solos vía proponer_asignaciones(), no
// se asignan aquí. La periodicidad ya no se elige en la asignación: es tipo_concepto.
export async function getConceptosAsignables(centroId: string): Promise<ConceptoAsignable[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('conceptos_cobro')
    .select('id, nombre, tipo_concepto')
    .eq('centro_id', centroId)
    .eq('activo', true)
    .eq('aplicacion', 'manual')
    .is('deleted_at', null)

  return (data ?? []).sort((a, b) => a.nombre.localeCompare(b.nombre))
}
