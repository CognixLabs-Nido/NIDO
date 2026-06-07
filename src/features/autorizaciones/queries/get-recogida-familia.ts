import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { PersonaAutorizada } from '../types'

export interface RecogidaContextoFamilia {
  /** ¿Existe una plantilla de recogida publicada en el centro? (gatea el botón). */
  plantillaDisponible: boolean
  /** Hijos del tutor (RLS), para elegir en el diálogo. */
  ninos: { id: string; nombre: string; apellidos: string }[]
  /** Prefill multi-tutor: lista habitual vigente por niño (de la última firma). */
  prefillPorNino: Record<string, PersonaAutorizada[]>
}

/**
 * Contexto para que la familia inicie una recogida (B2): si hay formato de
 * recogida publicado, los hijos del tutor, y —para el prefill multi-tutor
 * (afinado #3)— la lista habitual vigente de cada niño (última firma `firmado`
 * de su recogida habitual). Todo bajo RLS: el tutor solo ve a sus hijos y las
 * plantillas/instancias de su centro.
 */
export async function getRecogidaContextoFamilia(): Promise<RecogidaContextoFamilia> {
  const vacio: RecogidaContextoFamilia = {
    plantillaDisponible: false,
    ninos: [],
    prefillPorNino: {},
  }
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
    logger.warn('getRecogidaContextoFamilia: ninos', ninosErr.message)
    return vacio
  }
  if (!ninos || ninos.length === 0) return vacio

  // ¿Hay plantilla de recogida publicada? (RLS la acota al centro del tutor.)
  const { data: plantilla } = await supabase
    .from('autorizaciones')
    .select('id')
    .eq('tipo', 'recogida')
    .eq('es_plantilla', true)
    .eq('estado', 'publicada')
    .eq('texto_definitivo', true)
    .limit(1)
    .maybeSingle()

  // Instancias habituales (vigencia abierta) de estos niños → prefill.
  const ninoIds = ninos.map((n) => n.id)
  const { data: habituales } = await supabase
    .from('autorizaciones')
    .select('id, nino_id')
    .eq('tipo', 'recogida')
    .eq('es_plantilla', false)
    .eq('estado', 'publicada')
    .is('vigencia_hasta', null)
    .in('nino_id', ninoIds)

  const prefillPorNino: Record<string, PersonaAutorizada[]> = {}
  if (habituales && habituales.length > 0) {
    const instIds = habituales.map((h) => h.id)
    const { data: firmas } = await supabase
      .from('firmas_autorizacion')
      .select('autorizacion_id, datos, firmado_at')
      .eq('decision', 'firmado')
      .in('autorizacion_id', instIds)
      .order('firmado_at', { ascending: false })

    const ninoPorInst = new Map(habituales.map((h) => [h.id, h.nino_id]))
    const yaVisto = new Set<string>()
    for (const f of firmas ?? []) {
      const instId = f.autorizacion_id
      if (yaVisto.has(instId)) continue // la primera por orden desc = la última firma
      yaVisto.add(instId)
      const ninoId = ninoPorInst.get(instId)
      if (!ninoId) continue
      const personas = (f.datos as { personas?: PersonaAutorizada[] } | null)?.personas ?? []
      if (personas.length > 0) prefillPorNino[ninoId] = personas
    }
  }

  return {
    plantillaDisponible: !!plantilla,
    ninos,
    prefillPorNino,
  }
}
