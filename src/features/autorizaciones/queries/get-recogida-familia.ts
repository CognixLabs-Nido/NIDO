import 'server-only'

import type { AmbitoFamiliar } from '@/features/centros/contexto/ambito-familiar'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { firmaConDatosVigente } from '../lib/estado-firma'
import type { PersonaAutorizada } from '../types'

export interface RecogidaContextoFamilia {
  /** ¿Existe una plantilla de recogida publicada en el centro? (gatea el botón). */
  plantillaDisponible: boolean
  /** Hijos del tutor en el centro del ámbito, para elegir en el diálogo. */
  ninos: { id: string; nombre: string; apellidos: string }[]
  /** Prefill multi-tutor: lista habitual vigente por niño (de la firma vigente). */
  prefillPorNino: Record<string, PersonaAutorizada[]>
}

/**
 * Contexto para que la familia inicie una recogida (B2): si hay formato de
 * recogida publicado, los hijos del tutor, y —para el prefill multi-tutor
 * (afinado #3)— la lista habitual vigente de cada niño (`firmaConDatosVigente`
 * de su recogida habitual: una lista revocada no se ofrece). La RLS deja ver a todos sus
 * hijos y las plantillas de todos sus centros; el ámbito acota los dos al centro activo
 * (multicentro · Fase 2). Las listas habituales son de esos hijos.
 */
export async function getRecogidaContextoFamilia(
  ambito: AmbitoFamiliar
): Promise<RecogidaContextoFamilia> {
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
    .in(
      'id',
      ambito.hijos.map((h) => h.id)
    )
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
    .eq('centro_id', ambito.centroId)
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
      .select('autorizacion_id, firmante_id, decision, datos, firmado_at')
      .in('autorizacion_id', instIds)

    // La lista VIGENTE de cada habitual, no la última `firmado` del histórico: una
    // lista revocada no se vuelve a ofrecer rellena, o la familia firmaría otra vez,
    // sin darse cuenta, a una persona que había quitado.
    const firmasPorInst = new Map<string, NonNullable<typeof firmas>>()
    for (const f of firmas ?? []) {
      const arr = firmasPorInst.get(f.autorizacion_id) ?? []
      arr.push(f)
      firmasPorInst.set(f.autorizacion_id, arr)
    }
    for (const h of habituales) {
      if (!h.nino_id) continue
      const vigente = firmaConDatosVigente(firmasPorInst.get(h.id) ?? [])
      const personas = (vigente?.datos as { personas?: PersonaAutorizada[] } | null)?.personas ?? []
      if (personas.length > 0) prefillPorNino[h.nino_id] = personas
    }
  }

  return {
    plantillaDisponible: !!plantilla,
    // Esqueleto de niño (alta tutor-driven) puede traer apellidos NULL → coalesce.
    ninos: ninos.map((n) => ({ ...n, apellidos: n.apellidos ?? '' })),
    prefillPorNino,
  }
}
