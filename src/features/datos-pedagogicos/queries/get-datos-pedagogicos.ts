import 'server-only'

import { createClient } from '@/lib/supabase/server'

export interface DatosPedagogicosRow {
  id: string
  nino_id: string
  lactancia_estado: 'materna' | 'biberon' | 'mixta' | 'finalizada' | 'no_aplica'
  lactancia_observaciones: string | null
  control_esfinteres: 'panal_completo' | 'transicion' | 'sin_panal_diurno' | 'sin_panal_total'
  control_esfinteres_observaciones: string | null
  siesta_horario_habitual: string | null
  siesta_numero_diario: number | null
  siesta_observaciones: string | null
  tipo_alimentacion:
    | 'omnivora'
    | 'vegetariana'
    | 'vegana'
    | 'sin_lactosa'
    | 'sin_gluten'
    | 'religiosa_halal'
    | 'religiosa_kosher'
    | 'otra'
  alimentacion_observaciones: string | null
  idiomas_casa: string[]
  tiene_hermanos_en_centro: boolean
  updated_at: string
}

/**
 * Lee la fila de `datos_pedagogicos_nino` para un niño. RLS decide si el
 * usuario actual puede verla; si no, devuelve null (Supabase devuelve la
 * lista vacía y maybeSingle convierte a null).
 */
export async function getDatosPedagogicos(ninoId: string): Promise<DatosPedagogicosRow | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('datos_pedagogicos_nino')
    .select(
      'id, nino_id, lactancia_estado, lactancia_observaciones, control_esfinteres, control_esfinteres_observaciones, siesta_horario_habitual, siesta_numero_diario, siesta_observaciones, tipo_alimentacion, alimentacion_observaciones, idiomas_casa, tiene_hermanos_en_centro, updated_at'
    )
    .eq('nino_id', ninoId)
    .is('deleted_at', null)
    .maybeSingle()

  return (data as DatosPedagogicosRow | null) ?? null
}
