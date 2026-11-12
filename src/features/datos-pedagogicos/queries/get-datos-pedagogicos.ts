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
  tipo_alimentacion: 'omnivora' | 'vegetariana' | 'vegana' | 'sin_lactosa' | 'sin_gluten' | 'otra'
  alimentacion_observaciones: string | null
  idiomas_casa: string[]
  tiene_hermanos_en_centro: boolean
  updated_at: string
}

/**
 * Lee la fila de `datos_pedagogicos_nino` de un niño. Distingue «no hay fila» (`leidos: true`,
 * `datos: null`: la RLS no la deja ver o no existe) de «no se leyó» (`leidos: false`, cualquier
 * error). El formulario guarda el estado ENTERO: sobre una fila que no se leyó, abría con los valores
 * por defecto y guardar una hora de siesta devolvía la lactancia y el control de esfínteres a su
 * defecto y vaciaba las observaciones (2026-11-12, medido). Sin leerla no se ofrece guardar.
 */
export type LecturaDatosPedagogicos =
  | { leidos: true; datos: DatosPedagogicosRow | null }
  | { leidos: false }

export async function getDatosPedagogicos(ninoId: string): Promise<LecturaDatosPedagogicos> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('datos_pedagogicos_nino')
    .select(
      'id, nino_id, lactancia_estado, lactancia_observaciones, control_esfinteres, control_esfinteres_observaciones, siesta_horario_habitual, siesta_numero_diario, siesta_observaciones, tipo_alimentacion, alimentacion_observaciones, idiomas_casa, tiene_hermanos_en_centro, updated_at'
    )
    .eq('nino_id', ninoId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) return { leidos: false }
  return { leidos: true, datos: (data as DatosPedagogicosRow | null) ?? null }
}
