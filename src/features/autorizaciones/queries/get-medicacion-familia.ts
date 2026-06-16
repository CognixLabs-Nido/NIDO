import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

export interface MedicacionContextoFamilia {
  /** ¿Existe una plantilla de medicación publicada en el centro? (gatea el botón). */
  plantillaDisponible: boolean
  /** Hijos del tutor (RLS), para elegir en el diálogo. */
  ninos: { id: string; nombre: string; apellidos: string }[]
}

/**
 * Contexto para que la familia inicie una medicación (B2): si hay formato de
 * medicación publicado y los hijos del tutor. Sin prefill: medicación es
 * **multi-instancia** (cada tratamiento es una autorización nueva). Todo bajo
 * RLS: el tutor solo ve a sus hijos y la plantilla de su centro.
 */
export async function getMedicacionContextoFamilia(): Promise<MedicacionContextoFamilia> {
  const vacio: MedicacionContextoFamilia = { plantillaDisponible: false, ninos: [] }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return vacio

  const { data: ninos, error: ninosErr } = await supabase
    .from('ninos')
    .select('id, nombre, apellidos')
    .is('deleted_at', null)
    .order('nombre', { ascending: true })
  if (ninosErr) {
    logger.warn('getMedicacionContextoFamilia: ninos', ninosErr.message)
    return vacio
  }
  if (!ninos || ninos.length === 0) return vacio

  const { data: plantilla } = await supabase
    .from('autorizaciones')
    .select('id')
    .eq('tipo', 'medicacion')
    .eq('es_plantilla', true)
    .eq('estado', 'publicada')
    .eq('texto_definitivo', true)
    .limit(1)
    .maybeSingle()

  // Esqueleto de niño (alta tutor-driven) puede traer apellidos NULL → coalesce.
  return {
    plantillaDisponible: !!plantilla,
    ninos: ninos.map((n) => ({ ...n, apellidos: n.apellidos ?? '' })),
  }
}
