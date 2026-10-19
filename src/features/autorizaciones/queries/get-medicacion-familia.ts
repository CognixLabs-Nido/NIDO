import 'server-only'

import type { AmbitoFamiliar } from '@/features/centros/contexto/ambito-familiar'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

export interface MedicacionContextoFamilia {
  /** ¿Existe una plantilla de medicación publicada en el centro? (gatea el botón). */
  plantillaDisponible: boolean
  /** Hijos del tutor en el centro del ámbito, para elegir en el diálogo. */
  ninos: { id: string; nombre: string; apellidos: string }[]
}

/**
 * Contexto para que la familia inicie una medicación (B2): si hay formato de
 * medicación publicado y los hijos del tutor. Sin prefill: medicación es
 * **multi-instancia** (cada tratamiento es una autorización nueva). La RLS deja ver
 * a todos sus hijos y las plantillas de todos sus centros; el ámbito acota los dos al
 * centro activo (multicentro · Fase 2).
 */
export async function getMedicacionContextoFamilia(
  ambito: AmbitoFamiliar
): Promise<MedicacionContextoFamilia> {
  const vacio: MedicacionContextoFamilia = { plantillaDisponible: false, ninos: [] }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return vacio

  const { data: ninos, error: ninosErr } = await supabase
    .from('ninos')
    .select('id, nombre, apellidos')
    .in(
      'id',
      ambito.hijos.map((h) => h.id)
    )
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
    .eq('centro_id', ambito.centroId)
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
